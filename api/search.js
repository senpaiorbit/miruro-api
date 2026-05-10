// api/search.js — Search & Discovery routes
// Routes: GET /search  GET /suggestions  GET /filter

import { Hono } from "hono";
import { handle } from "hono/vercel";
import {
  createSecurityMiddleware,
  addCors,
  anilistQuery,
  withErrorHandler,
  MEDIA_LIST_FIELDS,
} from "../lib/utils.js";

const app = new Hono();

app.use("*", createSecurityMiddleware());

// ─── Helpers ────────────────────────────────────────────────────────────────

function paginatedResponse(pageInfo, media, page, perPage) {
  return {
    page: pageInfo.currentPage ?? page,
    perPage: pageInfo.perPage ?? perPage,
    total: pageInfo.total ?? 0,
    hasNextPage: pageInfo.hasNextPage ?? false,
    results: media,
  };
}

const SORT_MAP = {
  SCORE_DESC: "SCORE_DESC",
  POPULARITY_DESC: "POPULARITY_DESC",
  TRENDING_DESC: "TRENDING_DESC",
  START_DATE_DESC: "START_DATE_DESC",
  FAVOURITES_DESC: "FAVOURITES_DESC",
  UPDATED_AT_DESC: "UPDATED_AT_DESC",
};

// ─── GET /search ─────────────────────────────────────────────────────────────

app.get(
  "/search",
  withErrorHandler(async (c) => {
    addCors(c);
    const query = c.req.query("query");
    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
    const perPage = Math.min(
      50,
      Math.max(1, parseInt(c.req.query("per_page") ?? "20", 10))
    );

    if (!query) return c.json({ detail: "query parameter is required" }, 422);

    const gql = `
      query ($search: String, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            ${MEDIA_LIST_FIELDS}
          }
        }
      }
    `;

    const data = await anilistQuery(gql, {
      search: query,
      page,
      perPage,
    });
    const pageData = data.Page ?? {};
    return c.json(
      paginatedResponse(
        pageData.pageInfo ?? {},
        pageData.media ?? [],
        page,
        perPage
      )
    );
  })
);

// ─── GET /suggestions ────────────────────────────────────────────────────────

app.get(
  "/suggestions",
  withErrorHandler(async (c) => {
    addCors(c);
    const query = c.req.query("query");
    if (!query || query.length < 1)
      return c.json({ detail: "query parameter is required (min length 1)" }, 422);

    const gql = `
      query ($search: String) {
        Page(page: 1, perPage: 8) {
          media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
            id
            title { romaji english }
            coverImage { large }
            format
            status
            startDate { year }
            episodes
          }
        }
      }
    `;

    const data = await anilistQuery(gql, { search: query });
    const results = (data.Page?.media ?? []).map((item) => ({
      id: item.id,
      title: item.title?.english || item.title?.romaji,
      title_romaji: item.title?.romaji,
      poster: item.coverImage?.large,
      format: item.format,
      status: item.status,
      year: item.startDate?.year ?? null,
      episodes: item.episodes ?? null,
    }));

    return c.json({ suggestions: results });
  })
);

// ─── GET /filter ─────────────────────────────────────────────────────────────

app.get(
  "/filter",
  withErrorHandler(async (c) => {
    addCors(c);

    const genre = c.req.query("genre") ?? null;
    const tag = c.req.query("tag") ?? null;
    const yearRaw = c.req.query("year") ?? null;
    const year = yearRaw ? parseInt(yearRaw, 10) : null;
    const season = c.req.query("season")?.toUpperCase() ?? null;
    const format = c.req.query("format")?.toUpperCase() ?? null;
    const status = c.req.query("status")?.toUpperCase() ?? null;
    const sort = c.req.query("sort") ?? "POPULARITY_DESC";
    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10));
    const perPage = Math.min(
      50,
      Math.max(1, parseInt(c.req.query("per_page") ?? "20", 10))
    );

    // Build dynamic argument string and variable type declarations
    const resolvedSort = SORT_MAP[sort] ?? "POPULARITY_DESC";
    const args = ["type: ANIME", `sort: [${resolvedSort}]`];
    const varTypes = ["$page: Int", "$perPage: Int"];
    const variables = { page, perPage };

    if (genre) { args.push("genre: $genre"); varTypes.push("$genre: String"); variables.genre = genre; }
    if (tag) { args.push("tag: $tag"); varTypes.push("$tag: String"); variables.tag = tag; }
    if (year) { args.push("seasonYear: $seasonYear"); varTypes.push("$seasonYear: Int"); variables.seasonYear = year; }
    if (season) { args.push("season: $season"); varTypes.push("$season: MediaSeason"); variables.season = season; }
    if (format) { args.push("format: $format"); varTypes.push("$format: MediaFormat"); variables.format = format; }
    if (status) { args.push("status: $status"); varTypes.push("$status: MediaStatus"); variables.status = status; }

    const gql = `
      query (${varTypes.join(", ")}) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage perPage }
          media(${args.join(", ")}) {
            ${MEDIA_LIST_FIELDS}
          }
        }
      }
    `;

    const data = await anilistQuery(gql, variables);
    const pageData = data.Page ?? {};
    return c.json(
      paginatedResponse(
        pageData.pageInfo ?? {},
        pageData.media ?? [],
        page,
        perPage
      )
    );
  })
);

export const GET = handle(app);
