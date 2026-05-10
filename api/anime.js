// api/anime.js — Collections & Anime Detail routes
// Routes:
//   GET /spotlight
//   GET /trending
//   GET /popular
//   GET /upcoming
//   GET /recent
//   GET /schedule
//   GET /info/:anilist_id
//   GET /anime/:anilist_id/characters
//   GET /anime/:anilist_id/relations
//   GET /anime/:anilist_id/recommendations

import { Hono } from "hono";
import { handle } from "hono/vercel";
import {
  createSecurityMiddleware,
  addCors,
  anilistQuery,
  withErrorHandler,
  ApiError,
  MEDIA_LIST_FIELDS,
  MEDIA_FULL_FIELDS,
} from "../lib/utils.js";

const app = new Hono();

app.use("*", createSecurityMiddleware());

// ─── Helper: build a paginated response ─────────────────────────────────────

function paginated(pageInfo, items, page, perPage) {
  return {
    page: pageInfo.currentPage ?? page,
    perPage: pageInfo.perPage ?? perPage,
    total: pageInfo.total ?? 0,
    hasNextPage: pageInfo.hasNextPage ?? false,
    results: items,
  };
}

// ─── Helper: fetch a simple sorted collection ────────────────────────────────

async function fetchCollection(sortType, statusFilter, page, perPage) {
  const statusClause = statusFilter ? `, status: ${statusFilter}` : "";
  const gql = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total currentPage lastPage hasNextPage perPage }
        media(type: ANIME, sort: [${sortType}]${statusClause}) {
          ${MEDIA_LIST_FIELDS}
        }
      }
    }
  `;
  const data = await anilistQuery(gql, { page, perPage });
  const pageData = data.Page ?? {};
  return paginated(pageData.pageInfo ?? {}, pageData.media ?? [], page, perPage);
}

// ─── Pagination query helpers ─────────────────────────────────────────────────

function getPage(c) {
  return Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
}
function getPerPage(c, def = 20, max = 50) {
  return Math.min(max, Math.max(1, parseInt(c.req.query("per_page") ?? String(def), 10)));
}

// ─── GET /spotlight ──────────────────────────────────────────────────────────

app.get(
  "/spotlight",
  withErrorHandler(async (c) => {
    addCors(c);
    const gql = `
      query {
        Page(page: 1, perPage: 10) {
          media(sort: [TRENDING_DESC, POPULARITY_DESC], type: ANIME) {
            ${MEDIA_LIST_FIELDS}
          }
        }
      }
    `;
    const data = await anilistQuery(gql);
    const media = data.Page?.media ?? [];
    return c.json({ results: media });
  })
);

// ─── GET /trending ───────────────────────────────────────────────────────────

app.get(
  "/trending",
  withErrorHandler(async (c) => {
    addCors(c);
    return c.json(await fetchCollection("TRENDING_DESC", null, getPage(c), getPerPage(c)));
  })
);

// ─── GET /popular ────────────────────────────────────────────────────────────

app.get(
  "/popular",
  withErrorHandler(async (c) => {
    addCors(c);
    return c.json(await fetchCollection("POPULARITY_DESC", null, getPage(c), getPerPage(c)));
  })
);

// ─── GET /upcoming ───────────────────────────────────────────────────────────

app.get(
  "/upcoming",
  withErrorHandler(async (c) => {
    addCors(c);
    return c.json(
      await fetchCollection("POPULARITY_DESC", "NOT_YET_RELEASED", getPage(c), getPerPage(c))
    );
  })
);

// ─── GET /recent ─────────────────────────────────────────────────────────────

app.get(
  "/recent",
  withErrorHandler(async (c) => {
    addCors(c);
    return c.json(
      await fetchCollection("START_DATE_DESC", "RELEASING", getPage(c), getPerPage(c))
    );
  })
);

// ─── GET /schedule ───────────────────────────────────────────────────────────

app.get(
  "/schedule",
  withErrorHandler(async (c) => {
    addCors(c);
    const page = getPage(c);
    const perPage = getPerPage(c);

    const gql = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          airingSchedules(notYetAired: true, sort: TIME) {
            episode
            airingAt
            timeUntilAiring
            media {
              ${MEDIA_LIST_FIELDS}
            }
          }
        }
      }
    `;

    const data = await anilistQuery(gql, { page, perPage });
    const pageData = data.Page ?? {};
    const results = (pageData.airingSchedules ?? []).map((item) => {
      const entry = { ...item.media };
      entry.next_episode = item.episode;
      entry.airingAt = item.airingAt;
      entry.timeUntilAiring = item.timeUntilAiring;
      return entry;
    });

    return c.json(paginated(pageData.pageInfo ?? {}, results, page, perPage));
  })
);

// ─── GET /info/:anilist_id ───────────────────────────────────────────────────

app.get(
  "/info/:anilist_id",
  withErrorHandler(async (c) => {
    addCors(c);
    const id = parseInt(c.req.param("anilist_id"), 10);
    if (isNaN(id)) throw new ApiError(422, "anilist_id must be an integer");

    const gql = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${MEDIA_FULL_FIELDS}
        }
      }
    `;
    const data = await anilistQuery(gql, { id });
    const media = data.Media;
    if (!media) throw new ApiError(404, "Anime not found");
    return c.json(media);
  })
);

// ─── GET /anime/:anilist_id/characters ──────────────────────────────────────

app.get(
  "/anime/:anilist_id/characters",
  withErrorHandler(async (c) => {
    addCors(c);
    const id = parseInt(c.req.param("anilist_id"), 10);
    if (isNaN(id)) throw new ApiError(422, "anilist_id must be an integer");

    const page = getPage(c);
    const perPage = getPerPage(c, 25);

    const gql = `
      query ($id: Int, $page: Int, $perPage: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { romaji english }
          characters(sort: [ROLE, RELEVANCE], page: $page, perPage: $perPage) {
            pageInfo { total currentPage lastPage hasNextPage perPage }
            edges {
              role
              node {
                id
                name { full native userPreferred }
                image { large medium }
                description
                gender
                dateOfBirth { year month day }
                age
                favourites
                siteUrl
              }
              voiceActors {
                id
                name { full native }
                image { large }
                languageV2
              }
            }
          }
        }
      }
    `;
    const data = await anilistQuery(gql, { id, page, perPage });
    const media = data.Media;
    if (!media) throw new ApiError(404, "Anime not found");

    const chars = media.characters ?? {};
    const pageInfo = chars.pageInfo ?? {};
    return c.json({
      page: pageInfo.currentPage ?? page,
      perPage: pageInfo.perPage ?? perPage,
      total: pageInfo.total ?? 0,
      hasNextPage: pageInfo.hasNextPage ?? false,
      characters: chars.edges ?? [],
    });
  })
);

// ─── GET /anime/:anilist_id/relations ───────────────────────────────────────

app.get(
  "/anime/:anilist_id/relations",
  withErrorHandler(async (c) => {
    addCors(c);
    const id = parseInt(c.req.param("anilist_id"), 10);
    if (isNaN(id)) throw new ApiError(422, "anilist_id must be an integer");

    const gql = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { romaji english }
          relations {
            edges {
              relationType(version: 2)
              node {
                id
                title { romaji english native }
                coverImage { large }
                bannerImage
                format
                type
                status
                episodes
                chapters
                meanScore
                averageScore
                popularity
                startDate { year month day }
              }
            }
          }
        }
      }
    `;
    const data = await anilistQuery(gql, { id });
    const media = data.Media;
    if (!media) throw new ApiError(404, "Anime not found");

    return c.json({
      id: media.id,
      title: media.title,
      relations: media.relations?.edges ?? [],
    });
  })
);

// ─── GET /anime/:anilist_id/recommendations ─────────────────────────────────

app.get(
  "/anime/:anilist_id/recommendations",
  withErrorHandler(async (c) => {
    addCors(c);
    const id = parseInt(c.req.param("anilist_id"), 10);
    if (isNaN(id)) throw new ApiError(422, "anilist_id must be an integer");

    const page = getPage(c);
    const perPage = getPerPage(c, 10, 25);

    const gql = `
      query ($id: Int, $page: Int, $perPage: Int) {
        Media(id: $id, type: ANIME) {
          id
          title { romaji english }
          recommendations(sort: RATING_DESC, page: $page, perPage: $perPage) {
            pageInfo { total currentPage lastPage hasNextPage perPage }
            nodes {
              rating
              mediaRecommendation {
                id
                title { romaji english native }
                coverImage { large extraLarge }
                bannerImage
                format
                episodes
                status
                meanScore
                averageScore
                popularity
                genres
                startDate { year }
              }
            }
          }
        }
      }
    `;
    const data = await anilistQuery(gql, { id, page, perPage });
    const media = data.Media;
    if (!media) throw new ApiError(404, "Anime not found");

    const recs = media.recommendations ?? {};
    const pageInfo = recs.pageInfo ?? {};
    return c.json({
      page: pageInfo.currentPage ?? page,
      perPage: pageInfo.perPage ?? perPage,
      total: pageInfo.total ?? 0,
      hasNextPage: pageInfo.hasNextPage ?? false,
      recommendations: recs.nodes ?? [],
    });
  })
);

export const GET = handle(app);
