// lib/utils.js — shared helpers, constants, security middleware, AniList fetch

export const ANILIST_URL = "https://graphql.anilist.co";
export const MIRURO_PIPE_URL = "https://www.miruro.tv/api/secure/pipe";
export const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Referer": "https://www.miruro.tv/",
};

// ─── Security Middleware ─────────────────────────────────────────────────────

const PUBLIC_PATHS = new Set(["/", "/docs"]);
const API_KEY_NAME = "x-api-key";

/**
 * Returns a Hono middleware that enforces API key / origin checks.
 * Logic mirrors the Python secure_api middleware exactly.
 */
export function createSecurityMiddleware() {
  const rawOrigins = process.env.ALLOWED_ORIGINS ?? "";
  const allowedOrigins =
    rawOrigins.trim() === "" || rawOrigins === "*"
      ? ["*"]
      : rawOrigins.split(",").map((o) => o.trim()).filter(Boolean);

  const validApiKey = process.env.API_KEY ?? "";

  return async (c, next) => {
    const path = new URL(c.req.url).pathname;

    // Public paths — no check needed
    if (PUBLIC_PATHS.has(path)) return next();

    // 1. Valid API key → pass through
    const apiKey = c.req.header(API_KEY_NAME) ?? "";
    if (validApiKey && apiKey === validApiKey) return next();

    // 2. Origin / Referer check
    const origin = c.req.header("origin") ?? "";
    const referer = c.req.header("referer") ?? "";

    const allowed = allowedOrigins.some((a) => {
      if (a === "*") return true;
      return origin.startsWith(a) || referer.startsWith(a);
    });

    if (!allowed) {
      return c.json(
        { detail: "Access forbidden: Invalid Origin, Referer, or API Key." },
        403
      );
    }

    return next();
  };
}

// ─── CORS helper (applied per response) ─────────────────────────────────────

export function addCors(c) {
  const rawOrigins = process.env.ALLOWED_ORIGINS ?? "";
  const origin =
    rawOrigins.trim() === "" || rawOrigins === "*"
      ? "*"
      : (c.req.header("origin") ?? "*");

  c.header("Access-Control-Allow-Origin", origin);
  c.header("Access-Control-Allow-Methods", "*");
  c.header("Access-Control-Allow-Headers", "*");
  if (origin !== "*") c.header("Access-Control-Allow-Credentials", "true");
}

// ─── Pipe Codec ──────────────────────────────────────────────────────────────

/** Base64-URL encode a JSON payload (no padding) — matches Python _encode_pipe_request */
export function encodePipeRequest(payload) {
  const json = JSON.stringify(payload);
  return Buffer.from(json).toString("base64url");
}

/**
 * Decode a base64url+gzip pipe response into a plain object.
 * Mirrors Python _decode_pipe_response.
 */
export async function decodePipeResponse(encoded) {
  // Re-pad if needed
  const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
  const compressed = Buffer.from(padded, "base64url");

  // Decompress gzip
  const { createGunzip } = await import("node:zlib");
  const { pipeline } = await import("node:stream/promises");
  const { Readable, Writable } = await import("node:stream");

  const chunks = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk);
      cb();
    },
  });

  await pipeline(Readable.from(compressed), createGunzip(), sink);
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
}

// ─── ID translation helpers ──────────────────────────────────────────────────

/** Decode a base64-encoded episode ID — mirrors Python _translate_id */
function translateId(encodedId) {
  try {
    const padded = encodedId + "=".repeat((4 - (encodedId.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64url").toString("utf-8");
    return decoded.includes(":") ? decoded : encodedId;
  } catch {
    return encodedId;
  }
}

/** Recursively decode all 'id' fields — mirrors Python _deep_translate */
export function deepTranslate(obj) {
  if (Array.isArray(obj)) {
    obj.forEach(deepTranslate);
  } else if (obj && typeof obj === "object") {
    for (const [key, val] of Object.entries(obj)) {
      if (key === "id" && typeof val === "string") {
        obj[key] = translateId(val);
      } else if (val && typeof val === "object") {
        deepTranslate(val);
      }
    }
  }
}

// ─── Source slug injector ────────────────────────────────────────────────────

/**
 * Transform episode IDs into path-based slugs: watch/PROV/ALID/CAT/PREFIX-NUMBER
 * Mirrors Python _inject_source_slugs.
 */
export function injectSourceSlugs(data, anilistId) {
  const providers = data.providers ?? {};
  for (const [providerName, providerData] of Object.entries(providers)) {
    if (!providerData || typeof providerData !== "object") continue;
    let episodes = providerData.episodes ?? {};

    // Some providers return a flat list — normalise to { sub: [...] }
    if (Array.isArray(episodes)) {
      providerData.episodes = { sub: episodes };
      episodes = providerData.episodes;
    }

    for (const [category, epList] of Object.entries(episodes)) {
      if (!Array.isArray(epList)) continue;
      for (const ep of epList) {
        if (!ep || typeof ep !== "object") continue;
        if ("id" in ep && "number" in ep) {
          const origId = ep.id;
          const prefix = origId.includes(":") ? origId.split(":")[0] : origId;
          ep.id = `watch/${providerName}/${anilistId}/${category}/${prefix}-${ep.number}`;
        }
      }
    }
  }
  return data;
}

// ─── AniList GraphQL helper ──────────────────────────────────────────────────

/** Execute an AniList GraphQL query and return the data object. */
export async function anilistQuery(query, variables = {}) {
  const body = { query };
  if (Object.keys(variables).length) body.variables = variables;

  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new ApiError(500, "AniList query failed");
  const json = await res.json();
  return json.data ?? {};
}

// ─── Pipe fetch helper ───────────────────────────────────────────────────────

/** Internal helper to fetch raw, decoded episode data from Miruro pipe. */
export async function fetchRawEpisodes(anilistId) {
  const payload = {
    path: "episodes",
    method: "GET",
    query: { anilistId },
    body: null,
    version: "0.1.0",
  };
  const encoded = encodePipeRequest(payload);
  const res = await fetch(`${MIRURO_PIPE_URL}?e=${encoded}`, { headers: HEADERS });
  if (!res.ok) throw new ApiError(res.status, "Pipe request failed");
  const data = await decodePipeResponse((await res.text()).trim());
  deepTranslate(data);
  return data;
}

// ─── Shared GraphQL field fragments ─────────────────────────────────────────

export const MEDIA_LIST_FIELDS = `
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
`;

export const MEDIA_FULL_FIELDS = `
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
`;

// ─── Custom error class ──────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Wrap a Hono handler to catch ApiError and generic errors uniformly. */
export function withErrorHandler(fn) {
  return async (c) => {
    try {
      return await fn(c);
    } catch (err) {
      if (err instanceof ApiError) {
        return c.json({ detail: err.message }, err.status);
      }
      console.error(err);
      return c.json({ detail: "Internal server error" }, 500);
    }
  };
}
