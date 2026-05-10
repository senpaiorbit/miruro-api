// api/index.js — Homepage (GET /)
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { createSecurityMiddleware, addCors } from "../lib/utils.js";

const app = new Hono().basePath("/");

app.use("*", createSecurityMiddleware());

app.get("/", (c) => {
  addCors(c);
  c.header("Content-Type", "text/html; charset=utf-8");
  return c.body(HTML);
});

export const GET = handle(app);

// ─── Homepage HTML (identical look & content to the Python version) ──────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Miruro API v2.0</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;500;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Outfit', sans-serif; transition: all 0.3s ease; }
        body { background: radial-gradient(circle at top, #0f172a, #020617); color: #e2e8f0; min-height: 100vh; padding: 50px 20px; }
        .container { max-width: 960px; margin: 0 auto; background: rgba(30, 41, 59, 0.5); backdrop-filter: blur(10px); padding: 40px; border-radius: 24px; border: 1px solid rgba(255, 255, 255, 0.05); box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
        .header { text-align: center; margin-bottom: 50px; }
        .logo { width: 120px; border-radius: 20px; box-shadow: 0 0 30px rgba(56, 189, 248, 0.3); border: 1px solid rgba(255,255,255,0.1); margin-bottom: 25px; object-fit: cover; }
        h1 { font-size: 3em; font-weight: 700; background: linear-gradient(to right, #38bdf8, #818cf8); -webkit-background-clip: text; color: transparent; margin-bottom: 10px; }
        .subtitle { color: #94a3b8; font-size: 1.1em; font-weight: 300; }
        .version { display: inline-block; background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 4px 14px; border-radius: 20px; font-size: 0.85em; margin-top: 10px; border: 1px solid rgba(56, 189, 248, 0.2); }
        .section-title { font-size: 1.3em; font-weight: 700; color: #818cf8; margin: 35px 0 15px; border-left: 3px solid #818cf8; padding-left: 12px; }
        .endpoint { background: rgba(15, 23, 42, 0.8); border-left: 4px solid #38bdf8; padding: 25px; margin: 15px 0; border-radius: 0 16px 16px 0; border: 1px solid rgba(255,255,255,0.02); }
        .endpoint:hover { transform: translateX(5px); box-shadow: 0 10px 20px rgba(0,0,0,0.2); border-left-color: #818cf8; background: rgba(30, 41, 59, 0.9); }
        .method { color: #10b981; font-weight: 700; background: rgba(16, 185, 129, 0.1); padding: 4px 10px; border-radius: 6px; font-size: 0.9em; margin-right: 10px; }
        .url { font-family: monospace; color: #cbd5e1; font-size: 1.1em; }
        .params { margin-top: 10px; font-size: 0.85em; color: #64748b; font-family: monospace; line-height: 1.8; }
        .params span { color: #a5b4fc; }
        .example { margin-top: 15px; font-size: 0.95em; color: #64748b; }
        a { color: #38bdf8; text-decoration: none; word-break: break-all; font-weight: 500; }
        a:hover { color: #818cf8; text-shadow: 0 0 10px rgba(129, 140, 248, 0.5); }
        .desc { color: #cbd5e1; font-size: 1em; margin-top: 10px; font-weight: 300; line-height: 1.6; }
        .badge { display: inline-block; font-size: 0.7em; padding: 2px 8px; border-radius: 6px; margin-left: 8px; font-weight: 500; vertical-align: middle; }
        .badge-new { background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); }
        .badge-improved { background: rgba(129, 140, 248, 0.15); color: #818cf8; border: 1px solid rgba(129, 140, 248, 0.3); }
        .returns { margin-top: 12px; font-size: 0.85em; color: #94a3b8; line-height: 1.6; }
        .returns b { color: #a5b4fc; font-weight: 500; }
        pre.snippet { background: #020617; padding: 14px; border-radius: 10px; margin-top: 12px; color: #a5b4fc; font-family: monospace; font-size: 0.82em; border: 1px solid rgba(255,255,255,0.05); overflow-x: auto; line-height: 1.5; }
        .step-num { display: inline-block; background: rgba(56, 189, 248, 0.15); color: #38bdf8; width: 26px; height: 26px; text-align: center; line-height: 26px; border-radius: 50%; font-size: 0.85em; font-weight: 700; margin-right: 8px; }
        .note { background: rgba(250, 204, 21, 0.08); border: 1px solid rgba(250, 204, 21, 0.15); border-radius: 10px; padding: 14px 18px; margin-top: 12px; font-size: 0.88em; color: #fbbf24; line-height: 1.5; }
        .note b { color: #fde68a; }
        table.param-table { width: 100%; margin-top: 12px; border-collapse: collapse; font-size: 0.85em; }
        table.param-table th { text-align: left; color: #818cf8; font-weight: 500; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.08); }
        table.param-table td { padding: 6px 10px; color: #94a3b8; border-bottom: 1px solid rgba(255,255,255,0.03); }
        table.param-table td:first-child { color: #a5b4fc; font-family: monospace; white-space: nowrap; }
        .footer { text-align: center; margin-top: 50px; color: #475569; font-size: 0.9em; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="https://www.miruro.to/icon-512x512.png" alt="Logo" class="logo">
            <h1>Miruro Native API</h1>
            <div class="subtitle">Decrypted, bypassed, and reverse-engineered anime streaming API</div>
            <div class="version">v2.0 — Full Data &amp; Pagination</div>
        </div>

        <div class="note" style="background: rgba(16, 185, 129, 0.08); border-color: rgba(16, 185, 129, 0.2); color: #10b981;">
            <b>Runtime:</b> Node.js / Hono on Vercel Edge — same routes, same response shape as v1.
        </div>

        <!-- ───────── SEARCH & DISCOVERY ───────── -->
        <div class="section-title">🔍 Search &amp; Discovery</div>

        <div class="endpoint">
            <div><span class="method">GET</span> <span class="url">/search</span></div>
            <div class="desc">Search anime by name. Returns full metadata per result — title, cover art, genres, studios, scores, airing status, and more.</div>
            <div class="params">Params: <span>query</span> (required), <span>page</span>=1, <span>per_page</span>=20</div>
            <div class="returns">Returns: <b>page</b>, <b>perPage</b>, <b>total</b>, <b>hasNextPage</b>, <b>results[]</b></div>
            <div class="example">Try: <a target="_blank" href="/search?query=naruto&page=1&per_page=5">/search?query=naruto&page=1&per_page=5</a></div>
        </div>

        <div class="endpoint">
            <div><span class="method">GET</span> <span class="url">/suggestions</span> <span class="badge badge-new">NEW</span></div>
            <div class="desc">Lightweight search for autocomplete / dropdown. Max 8 results.</div>
            <div class="params">Params: <span>query</span> (required)</div>
            <div class="example">Try: <a target="_blank" href="/suggestions?query=one piece">/suggestions?query=one piece</a></div>
        </div>

        <div class="endpoint">
            <div><span class="method">GET</span> <span class="url">/spotlight</span> <span class="badge badge-new">HOT</span></div>
            <div class="desc">Top 10 currently trending &amp; popular anime — perfect for hero banners.</div>
            <div class="example">Try: <a target="_blank" href="/spotlight">/spotlight</a></div>
        </div>

        <div class="endpoint">
            <div><span class="method">GET</span> <span class="url">/filter</span> <span class="badge badge-new">NEW</span></div>
            <div class="desc">Advanced filter / browse. All params optional.</div>
            <table class="param-table">
                <tr><th>Param</th><th>Values</th></tr>
                <tr><td>genre</td><td>Action, Romance, Comedy, Drama, Fantasy, Sci-Fi…</td></tr>
                <tr><td>tag</td><td>Isekai, Time Skip, Reincarnation…</td></tr>
                <tr><td>year</td><td>2025, 2024…</td></tr>
                <tr><td>season</td><td>WINTER · SPRING · SUMMER · FALL</td></tr>
                <tr><td>format</td><td>TV · MOVIE · OVA · ONA · SPECIAL</td></tr>
                <tr><td>status</td><td>RELEASING · FINISHED · NOT_YET_RELEASED · CANCELLED</td></tr>
                <tr><td>sort</td><td>SCORE_DESC · POPULARITY_DESC · TRENDING_DESC · START_DATE_DESC</td></tr>
                <tr><td>page / per_page</td><td>Pagination (default 1 / 20)</td></tr>
            </table>
            <div class="example">Try: <a target="_blank" href="/filter?genre=Action&format=TV&sort=SCORE_DESC&per_page=5">/filter?genre=Action&format=TV&sort=SCORE_DESC&per_page=5</a></div>
        </div>

        <!-- ───────── COLLECTIONS ───────── -->
        <div class="section-title">📊 Collections (Paginated)</div>

        <div class="endpoint">
            <div><span class="method">GET</span> <span class="url">/trending</span></div>
            <div class="params">Params: <span>page</span>=1, <span>per_page</span>=20</div>
            <div class="example">Try: <a target="_blank" href="/trending?per_page=5">/trending?per_page=5</a></div>
        </div>
        <div class="endpoint">
            <div><span class="method">GET</span> <span class="url">/popular</span></div>
            <div class="params">Params: <span>page</span>=1, <span>per_page</span>=20</div>
            <div class="example">Try: <a target="_blank" href="/popular">/popular</a></div>
        </div>
        <div class="endpoint">
            <div><span class="method">GET</span> <span class="url">/upcoming</span></div>
            <div class="params">Params: <span>page</span>=1, <span>per_page</span>=20</div>
            <div class="example">Try: <a target="_blank" href="/upcoming">/upcoming</a></div>
        </div>
        <div class="endpoint">
            <div><span class="method">GET</span> <span class="url">/recent</span></div>
            <div class="params">Params: <span>page</span>=1, <span>per_page</span>=20</div>
            <div class="example">Try: <a target="_blank" href="/recent">/recent</a></div>
        </div>
        <div class="endpoint">
            <div><span class="method">GET</span> <span class="url">/schedule</span></div>
            <div class="desc">Next episodes airing soon with <b>airingAt</b>, <b>timeUntilAiring</b>, and <b>next_episode</b>.</div>
            <div class="params">Params: <span>page</span>=1, <span>per_page</span>=20</div>
            <div class="example">Try: <a target="_blank" href="/schedule">/schedule</a></div>
        </div>

        <!-- ───────── ANIME DETAILS ───────── -->
        <div class="section-title">📖 Anime Details</div>

        <div class="endpoint">
            <div><span class="method">GET</span> <span class="url">/info/{anilist_id}</span></div>
            <div class="desc">Complete anime page — title, description, characters (25), staff (25), relations, recommendations (10), trailer, stats, and more.</div>
            <div class="example">Try: <a target="_blank" href="/info/20">/info/20</a> (Naruto) · <a target="_blank" href="/info/21">/info/21</a> (One Piece)</div>
        </div>
        <div class="endpoint">
            <div><span class="method">GET</span> <span class="url">/anime/{id}/characters</span></div>
            <div class="params">Params: <span>page</span>=1, <span>per_page</span>=25</div>
            <div class="example">Try: <a target="_blank" href="/anime/20/characters">/anime/20/characters</a></div>
        </div>
        <div class="endpoint">
            <div><span class="method">GET</span> <span class="url">/anime/{id}/relations</span></div>
            <div class="example">Try: <a target="_blank" href="/anime/20/relations">/anime/20/relations</a></div>
        </div>
        <div class="endpoint">
            <div><span class="method">GET</span> <span class="url">/anime/{id}/recommendations</span></div>
            <div class="params">Params: <span>page</span>=1, <span>per_page</span>=10</div>
            <div class="example">Try: <a target="_blank" href="/anime/20/recommendations">/anime/20/recommendations</a></div>
        </div>

        <!-- ───────── STREAMING ───────── -->
        <div class="section-title">▶️ Streaming (3-Step Flow)</div>
        <div class="note"><b>How streaming works:</b> Follow these 3 steps in order.</div>

        <div class="endpoint">
            <div><span class="step-num">1</span><span class="method">GET</span> <span class="url">/episodes/{anilist_id}</span></div>
            <div class="desc">All episodes organized by provider and audio type (sub / dub). Each episode id is a ready-to-use slug.</div>
            <div class="example">Try: <a target="_blank" href="/episodes/178005">/episodes/178005</a></div>
        </div>

        <div class="endpoint" style="border-left-color: #10b981; background: rgba(16, 185, 129, 0.05);">
            <div><span class="step-num">2</span> <span class="url">/watch/{provider}/{anilistId}/{category}/{slug}</span> <span class="badge badge-new">RECOMMENDED</span></div>
            <div class="desc">Take the <b>id</b> from Step 1 and use it directly as the URL path.</div>
            <div class="example">Try: <a target="_blank" href="/watch/kiwi/178005/sub/animepahe-1">/watch/kiwi/178005/sub/animepahe-1</a></div>
            <pre class="snippet">{
  "streams": [{ "url": "https://.../master.m3u8", "type": "hls", "quality": "1080p" }],
  "subtitles": [{ "file": "...", "label": "English" }],
  "intro": { "start": 0, "end": 90 },
  "outro": { "start": 1300, "end": 1420 }
}</pre>
            <div style="margin-top:16px; border-top:1px solid rgba(255,255,255,0.05); padding-top:12px; font-size:0.85em; color:#64748b;">
                DETAILED OPTION: <code>GET /sources?episodeId=...&amp;provider=...&amp;anilistId=...&amp;category=...</code>
            </div>
        </div>

        <div class="endpoint" style="border-left-color: #818cf8;">
            <div><span class="step-num">3</span> <span class="url" style="color:#818cf8;">Play the stream</span></div>
            <div class="desc">Feed <b>streams[0].url</b> into any HLS player (Video.js, hls.js, VLC, mpv). Use <b>intro/outro</b> for skip buttons.</div>
        </div>

        <div class="footer">
            All collection endpoints return: <span style="color:#a5b4fc; font-family:monospace;">{ page, perPage, total, hasNextPage, results[] }</span><br><br>
            Developed by Walter | <a href="https://github.com/walterwhite-69" target="_blank">github.com/walterwhite-69</a>
        </div>
    </div>
</body>
</html>`;
