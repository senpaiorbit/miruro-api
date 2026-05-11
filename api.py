import base64, json, gzip, httpx, os, re, math
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Anime API (Multi-Provider)", version="2.0")

# --- Security / CORS configuration (same as original) ---
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "")
if ALLOWED_ORIGINS.strip() == "" or ALLOWED_ORIGINS == "*":
    ALLOWED_ORIGINS = ["*"]
else:
    ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS.split(",") if origin.strip()]

API_KEY_NAME = "x-api-key"
VALID_API_KEY = os.getenv("API_KEY")
DEFAULT_PROVIDER = os.getenv("DEFAULT_PROVIDER", "anikoto")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def secure_api(request: Request, call_next):
    if request.url.path in ["/", "/docs", "/redoc", "/openapi.json"]:
        return await call_next(request)

    api_key = request.headers.get(API_KEY_NAME)
    if VALID_API_KEY and api_key == VALID_API_KEY:
        return await call_next(request)

    origin = request.headers.get("origin")
    referer = request.headers.get("referer")
    is_allowed = False
    for allowed in ALLOWED_ORIGINS:
        if allowed == "*":
            is_allowed = True
            break
        if (origin and origin.startswith(allowed)) or (referer and referer.startswith(allowed)):
            is_allowed = True
            break
    if not is_allowed:
        return JSONResponse(status_code=403, content={"detail": "Access forbidden"})
    return await call_next(request)

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Referer": "https://www.miruro.tv/"}
ANILIST_URL = "https://graphql.anilist.co"
MIRURO_PIPE_URL = "https://www.miruro.tv/api/secure/pipe"

# ---------- Utility functions (unchanged from original) ----------
def _translate_id(encoded_id: str) -> str:
    try:
        decoded = base64.urlsafe_b64decode(encoded_id + '=' * (4 - len(encoded_id) % 4)).decode()
        if ':' in decoded:
            return decoded
        return encoded_id
    except Exception:
        return encoded_id

def _deep_translate(obj):
    if isinstance(obj, dict):
        for key, value in obj.items():
            if key == 'id' and isinstance(value, str):
                obj[key] = _translate_id(value)
            elif isinstance(value, (dict, list)):
                _deep_translate(value)
    elif isinstance(obj, list):
        for item in obj:
            if isinstance(item, (dict, list)):
                _deep_translate(item)

def _decode_pipe_response(encoded_str: str) -> dict:
    try:
        encoded_str += '=' * (4 - len(encoded_str) % 4)
        compressed = base64.urlsafe_b64decode(encoded_str)
        return json.loads(gzip.decompress(compressed).decode('utf-8'))
    except Exception:
        raise ValueError("Failed to decode pipe response")

def _encode_pipe_request(payload: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip('=')

async def _anilist_query(query: str, variables: dict = None):
    body = {"query": query}
    if variables:
        body["variables"] = variables
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.post(ANILIST_URL, json=body)
        if res.status_code != 200:
            raise HTTPException(status_code=500, detail="AniList query failed")
        return res.json().get("data", {})

async def _fetch_raw_episodes(anilist_id: int) -> dict:
    payload = {
        "path": "episodes",
        "method": "GET",
        "query": {"anilistId": anilist_id},
        "body": None,
        "version": "0.1.0",
    }
    encoded_req = _encode_pipe_request(payload)
    async with httpx.AsyncClient(timeout=15.0) as client:
        res = await client.get(f"{MIRURO_PIPE_URL}?e={encoded_req}", headers=HEADERS)
        if res.status_code != 200:
            raise HTTPException(status_code=res.status_code, detail="Pipe request failed")
        data = _decode_pipe_response(res.text.strip())
        _deep_translate(data)
        return data

# ---------- GraphQL fragments ----------
MEDIA_LIST_FIELDS = """
    id
    title { romaji english native }
    coverImage { large extraLarge }
    bannerImage
    format
    season
    seasonYear
    episodes
    duration
    status
    averageScore
    meanScore
    popularity
    favourites
    genres
    source
    countryOfOrigin
    isAdult
    studios(isMain: true) { nodes { name isAnimationStudio } }
    nextAiringEpisode { episode airingAt timeUntilAiring }
    startDate { year month day }
    endDate { year month day }
"""

MEDIA_FULL_FIELDS = """
    id
    idMal
    title { romaji english native }
    description(asHtml: false)
    coverImage { large extraLarge color }
    bannerImage
    format
    season
    seasonYear
    episodes
    duration
    status
    averageScore
    meanScore
    popularity
    favourites
    trending
    genres
    tags { name rank isMediaSpoiler }
    source
    countryOfOrigin
    isAdult
    hashtag
    synonyms
    siteUrl
    trailer { id site thumbnail }
    studios { nodes { id name isAnimationStudio siteUrl } }
    nextAiringEpisode { episode airingAt timeUntilAiring }
    startDate { year month day }
    endDate { year month day }
    characters(sort: [ROLE, RELEVANCE], perPage: 25) {
        edges {
            role
            node { id name { full native } image { large } }
            voiceActors(language: JAPANESE) { id name { full native } image { large } languageV2 }
        }
    }
    staff(sort: RELEVANCE, perPage: 25) {
        edges {
            role
            node { id name { full native } image { large } }
        }
    }
    relations {
        edges {
            relationType(version: 2)
            node {
                id
                title { romaji english native }
                coverImage { large }
                format
                type
                status
                episodes
                meanScore
            }
        }
    }
    recommendations(sort: RATING_DESC, perPage: 10) {
        nodes {
            rating
            mediaRecommendation {
                id
                title { romaji english native }
                coverImage { large }
                format
                episodes
                status
                meanScore
                averageScore
            }
        }
    }
    externalLinks { url site type }
    streamingEpisodes { title thumbnail url site }
    stats {
        scoreDistribution { score amount }
        statusDistribution { status amount }
    }
"""

# ---------- Helper: map AniList media to README's anime object ----------
def _map_anime_basic(media: dict) -> dict:
    return {
        "id": str(media["id"]),
        "name": media["title"].get("english") or media["title"].get("romaji") or "",
        "jname": media["title"].get("native"),
        "poster": media["coverImage"]["large"] if media.get("coverImage") else None,
        "type": media.get("format"),
        "episodes": {
            "sub": media.get("episodes"),
            "dub": None  # not available from AniList
        }
    }

def _map_anime_full(media: dict) -> dict:
    return {
        "id": str(media["id"]),
        "animeId": str(media.get("idMal", media["id"])),
        "name": media["title"].get("english") or media["title"].get("romaji") or "",
        "jname": media["title"].get("native"),
        "synonyms": ", ".join(media.get("synonyms", [])) if media.get("synonyms") else None,
        "japanese": media["title"].get("native"),
        "poster": media["coverImage"]["large"] if media.get("coverImage") else None,
        "description": media.get("description"),
        "type": media.get("format"),
        "rating": str(media.get("averageScore")) if media.get("averageScore") else None,
        "episodes": {
            "sub": media.get("episodes"),
            "dub": None
        },
        "duration": f"{media.get('duration')} min" if media.get("duration") else None,
        "premiered": f"{media.get('season')} {media.get('seasonYear')}" if media.get("season") and media.get("seasonYear") else None,
        "aired": _format_date(media.get("startDate")),
        "broadcast": None,
        "status": media.get("status"),
        "score": str(media.get("averageScore")) if media.get("averageScore") else None,
        "episodesTotal": media.get("episodes"),
        "country": media.get("countryOfOrigin"),
        "genres": media.get("genres", []),
        "studios": [s["node"]["name"] for s in media.get("studios", {}).get("nodes", []) if s.get("node", {}).get("isAnimationStudio")],
        "producers": [],
        "malId": str(media.get("idMal")) if media.get("idMal") else None,
        "alId": str(media["id"])
    }

def _format_date(date: dict) -> str:
    if not date:
        return None
    parts = [str(date.get(y)) for y in ["year", "month", "day"] if date.get(y)]
    return "-".join(parts) if parts else None

def _generate_source_url(provider: str, anilist_id: int, category: str, prefix: str, episode_num: int) -> str:
    # Build a URL that points to our own /watch endpoint (as per README)
    slug = f"{prefix}-{episode_num}"
    return f"/api/v2/{provider}/watch/{anilist_id}/{category}/{slug}"

# ---------- Provider router wrapper ----------
def _get_provider_or_default(provider: Optional[str]) -> str:
    if provider in ["anikoto", "anikai"]:
        return provider
    return DEFAULT_PROVIDER

def _provider_prefix(provider: str) -> str:
    return f"/api/v2/{provider}"

# ---------- Endpoints exactly as in README ----------
@app.get("/")
async def root():
    return HTMLResponse("""<!DOCTYPE html><html><head><title>Anime API (Multi-Provider)</title></head><body><h1>Anime API</h1><p>See /docs for interactive documentation.</p></body></html>""")

# ---- Home ----
@app.get("/api/v2/{provider}/home")
async def home(provider: str):
    provider = _get_provider_or_default(provider)
    # Fetch trending and popular for spotlight, latest, top10
    gql_trending = f"""
    query {{ Page(page: 1, perPage: 10) {{ media(sort: TRENDING_DESC, type: ANIME) {{ {MEDIA_LIST_FIELDS} }} }} }}
    """
    gql_popular = f"""
    query {{ Page(page: 1, perPage: 10) {{ media(sort: POPULARITY_DESC, type: ANIME) {{ {MEDIA_LIST_FIELDS} }} }} }}
    """
    gql_upcoming = f"""
    query {{ Page(page: 1, perPage: 10) {{ media(sort: POPULARITY_DESC, status: NOT_YET_RELEASED, type: ANIME) {{ {MEDIA_LIST_FIELDS} }} }} }}
    """
    gql_recent = f"""
    query {{ Page(page: 1, perPage: 10) {{ media(sort: START_DATE_DESC, status: RELEASING, type: ANIME) {{ {MEDIA_LIST_FIELDS} }} }} }}
    """
    trending_data = await _anilist_query(gql_trending)
    popular_data = await _anilist_query(gql_popular)
    upcoming_data = await _anilist_query(gql_upcoming)
    recent_data = await _anilist_query(gql_recent)

    spotlight = []
    for m in trending_data.get("Page", {}).get("media", [])[:5]:
        spotlight.append({
            "id": str(m["id"]),
            "name": m["title"].get("english") or m["title"].get("romaji"),
            "jname": m["title"].get("native"),
            "poster": m["coverImage"]["large"] if m.get("coverImage") else None,
            "description": None,  # AniList description not fetched in list query
            "rating": str(m.get("averageScore")),
            "rank": 0,
            "otherInfo": [m.get("format"), m.get("status")],
            "genres": m.get("genres", [])[:3],
            "episodes": {"sub": m.get("episodes"), "dub": None}
        })

    latest_episodes = []
    for m in recent_data.get("Page", {}).get("media", []):
        latest_episodes.append(_map_anime_basic(m))

    new_releases = []
    for m in upcoming_data.get("Page", {}).get("media", [])[:6]:
        new_releases.append(_map_anime_basic(m))

    top_upcoming = []
    for m in upcoming_data.get("Page", {}).get("media", [])[:10]:
        top_upcoming.append(_map_anime_basic(m))

    top10 = {
        "today": [_map_anime_basic(m) for m in popular_data.get("Page", {}).get("media", [])[:10]],
        "day": [],
        "week": [],
        "month": []
    }

    # Hardcoded genres for demo
    genres = list(set([g for m in popular_data.get("Page", {}).get("media", []) for g in m.get("genres", [])]))[:15]

    return {
        "success": True,
        "data": {
            "genres": genres,
            "spotlightAnimes": spotlight,
            "latestEpisodeAnimes": latest_episodes,
            "newReleases": new_releases,
            "topUpcomingAnimes": top_upcoming,
            "top10Animes": top10
        }
    }

# ---- Index ----
@app.get("/api/v2/{provider}/index")
async def index(provider: str):
    return {
        "success": True,
        "data": {
            "meta": {
                "title": "Anime API",
                "description": "Free anime API",
                "ogImage": "",
                "canonical": ""
            },
            "mostSearched": [{"label": "Naruto", "keyword": "naruto"}, {"label": "One Piece", "keyword": "one piece"}],
            "genres": ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Sci-Fi"],
            "azList": [{"label": "All", "href": "/az-list/"}],
            "footerMenu": [{"label": "DMCA", "href": "/pages/dmca"}]
        }
    }

# ---- Nav ----
@app.get("/api/v2/{provider}/nav")
async def nav(provider: str):
    provider = _get_provider_or_default(provider)
    base_url = _provider_prefix(provider)
    return {
        "success": True,
        "data": {
            "header": {
                "brand": {"link": "/", "logo": ""},
                "buttons": {"menu": True, "search": True, "watch2gether": None, "random": None},
                "search": {"action": f"{base_url}/search", "placeholder": "Search anime...", "filter_link": f"{base_url}/browse"},
                "menu": {
                    "genres": [
                        {"name": "Action", "url": f"{base_url}/genre/action"},
                        {"name": "Adventure", "url": f"{base_url}/genre/adventure"}
                    ],
                    "types": [
                        {"name": "Movie", "url": f"{base_url}/type/movie"},
                        {"name": "TV", "url": f"{base_url}/type/tv"}
                    ],
                    "links": [
                        {"name": "Home", "url": f"{base_url}/home"},
                        {"name": "Updated", "url": f"{base_url}/category/latest-updated"},
                        {"name": "Popular", "url": f"{base_url}/category/most-viewed"}
                    ]
                },
                "browse": {
                    "url": f"{base_url}/browse",
                    "sortOptions": [
                        {"label": "Default", "value": "default"},
                        {"label": "Score", "value": "score"}
                    ],
                    "filters": {
                        "type": ["TV", "Movie"],
                        "status": ["finished-airing", "currently-airing"],
                        "season": ["fall", "summer", "spring", "winter"],
                        "rating": ["PG", "PG-13"],
                        "language": ["sub", "dub"]
                    }
                }
            }
        }
    }

# ---- Anime Details ----
@app.get("/api/v2/{provider}/anime/{anime_id}")
async def anime_details(provider: str, anime_id: str):
    # anime_id can be AniList ID (int) or MAL ID. We'll try both.
    try:
        aid = int(anime_id)
    except:
        # try to resolve by MAL id? For simplicity assume AniList id
        raise HTTPException(400, "Anime ID must be integer (AniList ID)")
    gql = f"""
    query ($id: Int) {{ Media(id: $id, type: ANIME) {{ {MEDIA_FULL_FIELDS} }} }}
    """
    data = await _anilist_query(gql, {"id": aid})
    media = data.get("Media")
    if not media:
        raise HTTPException(404, "Anime not found")
    anime = _map_anime_full(media)

    related = []
    for edge in media.get("relations", {}).get("edges", []):
        rel_node = edge["node"]
        related.append({
            "id": str(rel_node["id"]),
            "name": rel_node["title"].get("english") or rel_node["title"].get("romaji"),
            "jname": rel_node["title"].get("native"),
            "poster": rel_node["coverImage"]["large"] if rel_node.get("coverImage") else None,
            "type": rel_node.get("format"),
            "relationType": edge.get("relationType"),
            "episodes": {"sub": rel_node.get("episodes"), "dub": None}
        })

    recommended = []
    for rec in media.get("recommendations", {}).get("nodes", []):
        rec_media = rec.get("mediaRecommendation", {})
        recommended.append({
            "id": str(rec_media["id"]),
            "name": rec_media["title"].get("english") or rec_media["title"].get("romaji"),
            "poster": rec_media["coverImage"]["large"] if rec_media.get("coverImage") else None,
            "type": rec_media.get("format"),
            "episodes": {"sub": rec_media.get("episodes"), "dub": None}
        })

    seasons = []  # not directly available; could build from relations
    return {
        "success": True,
        "data": {
            "anime": anime,
            "related": related,
            "recommended": recommended,
            "seasons": seasons
        }
    }

# ---- Anime Episodes ----
@app.get("/api/v2/{provider}/anime/{anime_id}/episodes")
async def anime_episodes(provider: str, anime_id: str):
    provider = _get_provider_or_default(provider)
    try:
        aid = int(anime_id)
    except:
        raise HTTPException(400, "Anime ID must be integer")
    raw = await _fetch_raw_episodes(aid)
    # Get MAL/AL IDs from mappings
    mappings = raw.get("mappings", {})
    mal_id = mappings.get("malId")
    al_id = mappings.get("anilistId")

    # Build episodes from the first provider that has episodes
    all_eps = []
    for prov_name, prov_data in raw.get("providers", {}).items():
        ep_dict = prov_data.get("episodes", {})
        for cat, eps in ep_dict.items():
            if isinstance(eps, list):
                for ep in eps:
                    if not isinstance(ep, dict):
                        continue
                    ep_num = ep.get("number")
                    if ep_num is None:
                        continue
                    orig_id = ep.get("id", "")
                    prefix = orig_id.split(":")[0] if ":" in orig_id else prov_name
                    # Build source URLs (point to our /watch endpoint)
                    sub_url = _generate_source_url(provider, aid, "sub", prefix, ep_num) if cat == "sub" else None
                    dub_url = _generate_source_url(provider, aid, "dub", prefix, ep_num) if cat == "dub" else None
                    all_eps.append({
                        "number": ep_num,
                        "title": ep.get("title", f"Episode {ep_num}"),
                        "isFiller": ep.get("filler", False),
                        "hasSub": cat == "sub",
                        "hasDub": cat == "dub",
                        "sources": {
                            "sub": sub_url,
                            "dub": dub_url,
                            "aniSub": None,
                            "aniDub": None
                        }
                    })
                break  # take first category that gave episodes
        if all_eps:
            break

    all_eps.sort(key=lambda x: x["number"])
    return {
        "success": True,
        "data": {
            "totalEpisodes": len(all_eps),
            "malId": str(mal_id) if mal_id else None,
            "alId": str(al_id) if al_id else None,
            "episodes": all_eps
        }
    }

# ---- Single Episode ----
@app.get("/api/v2/{provider}/anime/{anime_id}/ep/{number}")
async def single_episode(provider: str, anime_id: str, number: int):
    provider = _get_provider_or_default(provider)
    try:
        aid = int(anime_id)
    except:
        raise HTTPException(400, "Invalid anime_id")
    raw = await _fetch_raw_episodes(aid)
    mappings = raw.get("mappings", {})
    mal_id = mappings.get("malId")
    al_id = mappings.get("anilistId")

    for prov_name, prov_data in raw.get("providers", {}).items():
        ep_dict = prov_data.get("episodes", {})
        for cat, eps in ep_dict.items():
            if isinstance(eps, list):
                for ep in eps:
                    if ep.get("number") == number:
                        orig_id = ep.get("id", "")
                        prefix = orig_id.split(":")[0] if ":" in orig_id else prov_name
                        sub_url = _generate_source_url(provider, aid, "sub", prefix, number) if cat == "sub" else None
                        dub_url = _generate_source_url(provider, aid, "dub", prefix, number) if cat == "dub" else None
                        episode = {
                            "number": number,
                            "title": ep.get("title", f"Episode {number}"),
                            "isFiller": ep.get("filler", False),
                            "hasSub": cat == "sub",
                            "hasDub": cat == "dub",
                            "sources": {
                                "sub": sub_url,
                                "dub": dub_url,
                                "aniSub": None,
                                "aniDub": None
                            }
                        }
                        return {
                            "success": True,
                            "data": {
                                "malId": str(mal_id) if mal_id else None,
                                "alId": str(al_id) if al_id else None,
                                "episode": episode
                            }
                        }
    raise HTTPException(404, f"Episode {number} not found")

# ---- Search ----
@app.get("/api/v2/{provider}/search")
async def search(provider: str, q: str, page: int = 1, sort: Optional[str] = None, **filters):
    provider = _get_provider_or_default(provider)
    gql = f"""
    query ($search: String, $page: Int, $perPage: Int) {{
        Page(page: $page, perPage: $perPage) {{
            pageInfo {{ total currentPage lastPage hasNextPage perPage }}
            media(search: $search, type: ANIME, sort: SEARCH_MATCH) {{
                {MEDIA_LIST_FIELDS}
            }}
        }}
    }}
    """
    per_page = 20
    data = await _anilist_query(gql, {"search": q, "page": page, "perPage": per_page})
    page_data = data.get("Page", {})
    animes = [_map_anime_basic(m) for m in page_data.get("media", [])]
    page_info = page_data.get("pageInfo", {})
    return {
        "success": True,
        "data": {
            "animes": animes,
            "currentPage": page_info.get("currentPage", page),
            "totalPages": page_info.get("lastPage", 1),
            "hasNextPage": page_info.get("hasNextPage", False),
            "totalCount": page_info.get("total"),
            "searchQuery": q,
            "searchFilters": {}
        }
    }

# ---- Browse (same as search but without mandatory q) ----
@app.get("/api/v2/{provider}/browse")
async def browse(provider: str, keyword: Optional[str] = None, page: int = 1, sort: str = "default", **filters):
    if keyword:
        return await search(provider, keyword, page, sort)
    # fallback to popular
    gql = f"""
    query ($page: Int, $perPage: Int) {{
        Page(page: $page, perPage: $perPage) {{
            pageInfo {{ total currentPage lastPage hasNextPage perPage }}
            media(type: ANIME, sort: POPULARITY_DESC) {{
                {MEDIA_LIST_FIELDS}
            }}
        }}
    }}
    """
    per_page = 20
    data = await _anilist_query(gql, {"page": page, "perPage": per_page})
    page_data = data.get("Page", {})
    animes = [_map_anime_basic(m) for m in page_data.get("media", [])]
    page_info = page_data.get("pageInfo", {})
    return {
        "success": True,
        "data": {
            "animes": animes,
            "currentPage": page_info.get("currentPage", page),
            "totalPages": page_info.get("lastPage", 1),
            "hasNextPage": page_info.get("hasNextPage", False),
            "totalCount": page_info.get("total"),
            "filters": {}
        }
    }

# ---- A-Z List ----
@app.get("/api/v2/{provider}/azlist/{sort_option}")
async def azlist(provider: str, sort_option: str, page: int = 1):
    # Use search with a dummy char filter (simplified)
    return await search(provider, sort_option if len(sort_option) == 1 else "", page)

# ---- Genre ----
@app.get("/api/v2/{provider}/genre/{genre_name}")
async def genre_animes(provider: str, genre_name: str, page: int = 1, sort: Optional[str] = None):
    gql = f"""
    query ($genre: String, $page: Int, $perPage: Int) {{
        Page(page: $page, perPage: $perPage) {{
            pageInfo {{ total currentPage lastPage hasNextPage perPage }}
            media(genre: $genre, type: ANIME, sort: POPULARITY_DESC) {{
                {MEDIA_LIST_FIELDS}
            }}
        }}
    }}
    """
    per_page = 20
    data = await _anilist_query(gql, {"genre": genre_name.title(), "page": page, "perPage": per_page})
    page_data = data.get("Page", {})
    animes = [_map_anime_basic(m) for m in page_data.get("media", [])]
    page_info = page_data.get("pageInfo", {})
    return {
        "success": True,
        "data": {
            "genreName": genre_name,
            "animes": animes,
            "currentPage": page_info.get("currentPage", page),
            "totalPages": page_info.get("lastPage", 1),
            "hasNextPage": page_info.get("hasNextPage", False)
        }
    }

# ---- Category ----
@app.get("/api/v2/{provider}/category/{category_name}")
async def category_animes(provider: str, category_name: str, page: int = 1, sort: Optional[str] = None):
    # map category to status/format
    sort_map = {"latest-updated": "START_DATE_DESC", "most-viewed": "POPULARITY_DESC", "tv": "POPULARITY_DESC"}
    sort_val = sort_map.get(category_name, "POPULARITY_DESC")
    gql = f"""
    query ($page: Int, $perPage: Int) {{
        Page(page: $page, perPage: $perPage) {{
            pageInfo {{ total currentPage lastPage hasNextPage perPage }}
            media(type: ANIME, sort: {sort_val}) {{
                {MEDIA_LIST_FIELDS}
            }}
        }}
    }}
    """
    per_page = 20
    data = await _anilist_query(gql, {"page": page, "perPage": per_page})
    page_data = data.get("Page", {})
    animes = [_map_anime_basic(m) for m in page_data.get("media", [])]
    page_info = page_data.get("pageInfo", {})
    return {
        "success": True,
        "data": {
            "category": category_name,
            "animes": animes,
            "currentPage": page_info.get("currentPage", page),
            "totalPages": page_info.get("lastPage", 1),
            "hasNextPage": page_info.get("hasNextPage", False)
        }
    }

# ---- Type ----
@app.get("/api/v2/{provider}/type/{type_name}")
async def type_animes(provider: str, type_name: str, page: int = 1, sort: Optional[str] = None):
    format_map = {"movie": "MOVIE", "tv": "TV", "ova": "OVA", "ona": "ONA", "special": "SPECIAL", "music": "MUSIC"}
    fmt = format_map.get(type_name.lower(), "TV")
    gql = f"""
    query ($format: MediaFormat, $page: Int, $perPage: Int) {{
        Page(page: $page, perPage: $perPage) {{
            pageInfo {{ total currentPage lastPage hasNextPage perPage }}
            media(format: $format, type: ANIME, sort: POPULARITY_DESC) {{
                {MEDIA_LIST_FIELDS}
            }}
        }}
    }}
    """
    per_page = 20
    data = await _anilist_query(gql, {"format": fmt, "page": page, "perPage": per_page})
    page_data = data.get("Page", {})
    animes = [_map_anime_basic(m) for m in page_data.get("media", [])]
    page_info = page_data.get("pageInfo", {})
    return {
        "success": True,
        "data": {
            "type": type_name,
            "animes": animes,
            "currentPage": page_info.get("currentPage", page),
            "totalPages": page_info.get("lastPage", 1),
            "hasNextPage": page_info.get("hasNextPage", False)
        }
    }

# ---- Watch endpoint (for sources resolution) ----
@app.get("/api/v2/{provider}/watch/{anilist_id}/{category}/{slug}")
async def watch_sources(provider: str, anilist_id: int, category: str, slug: str):
    # Resolve slug to original episode ID
    raw = await _fetch_raw_episodes(anilist_id)
    for prov_name, prov_data in raw.get("providers", {}).items():
        ep_dict = prov_data.get("episodes", {})
        for cat, eps in ep_dict.items():
            if cat != category:
                continue
            if isinstance(eps, list):
                for ep in eps:
                    orig_id = ep.get("id", "")
                    prefix = orig_id.split(":")[0] if ":" in orig_id else prov_name
                    generated = f"{prefix}-{ep.get('number')}"
                    if generated == slug:
                        # Now call the original sources endpoint
                        enc_id = base64.urlsafe_b64encode(orig_id.encode()).decode().rstrip('=')
                        payload = {
                            "path": "sources",
                            "method": "GET",
                            "query": {
                                "episodeId": enc_id,
                                "provider": prov_name,
                                "category": category,
                                "anilistId": anilist_id,
                            },
                            "body": None,
                            "version": "0.1.0",
                        }
                        encoded_req = _encode_pipe_request(payload)
                        async with httpx.AsyncClient(timeout=15.0) as client:
                            res = await client.get(f"{MIRURO_PIPE_URL}?e={encoded_req}", headers=HEADERS)
                            if res.status_code != 200:
                                raise HTTPException(500, "Failed to fetch sources")
                            sources_data = _decode_pipe_response(res.text.strip())
                            _deep_translate(sources_data)
                            return sources_data
    raise HTTPException(404, "Episode not found")

# ---- Shorthand routes (without provider prefix) ----
@app.get("/api/home")
async def shorthand_home(provider: Optional[str] = Query(None)):
    return await home(provider or DEFAULT_PROVIDER)

@app.get("/api/index")
async def shorthand_index(provider: Optional[str] = Query(None)):
    return await index(provider or DEFAULT_PROVIDER)

@app.get("/api/nav")
async def shorthand_nav(provider: Optional[str] = Query(None)):
    return await nav(provider or DEFAULT_PROVIDER)

@app.get("/api/anime/{anime_id}")
async def shorthand_details(anime_id: str, provider: Optional[str] = Query(None)):
    return await anime_details(provider or DEFAULT_PROVIDER, anime_id)

@app.get("/api/anime/{anime_id}/episodes")
async def shorthand_episodes(anime_id: str, provider: Optional[str] = Query(None)):
    return await anime_episodes(provider or DEFAULT_PROVIDER, anime_id)

@app.get("/api/anime/{anime_id}/ep/{number}")
async def shorthand_single_ep(anime_id: str, number: int, provider: Optional[str] = Query(None)):
    return await single_episode(provider or DEFAULT_PROVIDER, anime_id, number)

@app.get("/api/search")
async def shorthand_search(q: str, page: int = 1, provider: Optional[str] = Query(None)):
    return await search(provider or DEFAULT_PROVIDER, q, page)

@app.get("/api/browse")
async def shorthand_browse(keyword: Optional[str] = None, page: int = 1, provider: Optional[str] = Query(None)):
    return await browse(provider or DEFAULT_PROVIDER, keyword, page)

@app.get("/api/genre/{name}")
async def shorthand_genre(name: str, page: int = 1, provider: Optional[str] = Query(None)):
    return await genre_animes(provider or DEFAULT_PROVIDER, name, page)

@app.get("/api/category/{name}")
async def shorthand_category(name: str, page: int = 1, provider: Optional[str] = Query(None)):
    return await category_animes(provider or DEFAULT_PROVIDER, name, page)

@app.get("/api/type/{name}")
async def shorthand_type(name: str, page: int = 1, provider: Optional[str] = Query(None)):
    return await type_animes(provider or DEFAULT_PROVIDER, name, page)

@app.get("/api/azlist/{sort_option}")
async def shorthand_azlist(sort_option: str, page: int = 1, provider: Optional[str] = Query(None)):
    return await azlist(provider or DEFAULT_PROVIDER, sort_option, page)

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("API_PORT", 3000))
    uvicorn.run(app, host="0.0.0.0", port=port)
