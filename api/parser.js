// api/parser.js — Streaming / Pipe routes
// Routes:
//   GET /episodes/:anilist_id
//   GET /sources
//   GET /watch/:provider/:anilist_id/:category/:slug

import { Hono } from "hono";
import { handle } from "hono/vercel";
import {
  createSecurityMiddleware,
  addCors,
  withErrorHandler,
  ApiError,
  encodePipeRequest,
  decodePipeResponse,
  fetchRawEpisodes,
  injectSourceSlugs,
  HEADERS,
  MIRURO_PIPE_URL,
} from "../lib/utils.js";

const app = new Hono();

app.use("*", createSecurityMiddleware());

// ─── GET /episodes/:anilist_id ───────────────────────────────────────────────

app.get(
  "/episodes/:anilist_id",
  withErrorHandler(async (c) => {
    addCors(c);
    const anilistId = parseInt(c.req.param("anilist_id"), 10);
    if (isNaN(anilistId)) throw new ApiError(422, "anilist_id must be an integer");

    const data = await fetchRawEpisodes(anilistId);
    return c.json(injectSourceSlugs(data, anilistId));
  })
);

// ─── GET /sources ────────────────────────────────────────────────────────────

app.get(
  "/sources",
  withErrorHandler(async (c) => {
    addCors(c);

    const episodeId = c.req.query("episodeId");
    const provider = c.req.query("provider");
    const anilistIdRaw = c.req.query("anilistId");
    const category = c.req.query("category") ?? "sub";

    if (!episodeId) throw new ApiError(422, "episodeId is required");
    if (!provider) throw new ApiError(422, "provider is required");
    if (!anilistIdRaw) throw new ApiError(422, "anilistId is required");

    const anilistId = parseInt(anilistIdRaw, 10);
    if (isNaN(anilistId)) throw new ApiError(422, "anilistId must be an integer");

    return c.json(await _fetchSources(episodeId, provider, anilistId, category));
  })
);

// ─── GET /watch/:provider/:anilist_id/:category/:slug ────────────────────────

app.get(
  "/watch/:provider/:anilist_id/:category/:slug",
  withErrorHandler(async (c) => {
    addCors(c);

    const provider = c.req.param("provider");
    const anilistId = parseInt(c.req.param("anilist_id"), 10);
    const category = c.req.param("category");
    const slug = c.req.param("slug");

    if (isNaN(anilistId)) throw new ApiError(422, "anilist_id must be an integer");

    // Fetch raw episodes (without slug injection) to resolve slug → original ID
    const data = await fetchRawEpisodes(anilistId);
    const provData = data.providers?.[provider] ?? {};
    let epList = provData.episodes ?? {};

    // Normalise flat list → { sub: [...] }
    if (Array.isArray(epList)) epList = { sub: epList };

    const episodes = epList[category];
    if (!Array.isArray(episodes)) {
      throw new ApiError(
        404,
        `No ${category} episodes found for provider ${provider}`
      );
    }

    // Resolve slug (prefix-number) → original episode ID
    let targetId = null;
    for (const ep of episodes) {
      const origId = ep.id ?? "";
      const prefix = origId.includes(":") ? origId.split(":")[0] : origId;
      const generated = `${prefix}-${ep.number}`;
      if (generated === slug) {
        targetId = origId;
        break;
      }
    }

    if (!targetId) {
      throw new ApiError(
        404,
        `Episode slug '${slug}' not found for provider ${provider}`
      );
    }

    return c.json(await _fetchSources(targetId, provider, anilistId, category));
  })
);

// ─── Internal: fetch sources from Miruro pipe ────────────────────────────────

async function _fetchSources(episodeId, provider, anilistId, category) {
  // Base64-URL encode the plain episode ID (mirrors Python base64.urlsafe_b64encode)
  const encId = Buffer.from(episodeId).toString("base64url");

  const payload = {
    path: "sources",
    method: "GET",
    query: {
      episodeId: encId,
      provider,
      category,
      anilistId,
    },
    body: null,
    version: "0.1.0",
  };

  const encoded = encodePipeRequest(payload);
  const res = await fetch(`${MIRURO_PIPE_URL}?e=${encoded}`, {
    headers: HEADERS,
  });

  if (!res.ok) throw new ApiError(res.status, "Pipe request failed");
  return decodePipeResponse((await res.text()).trim());
}

export const GET = handle(app);
