/* Macro Compass — CORS proxy on Cloudflare Workers.
 *
 * Yahoo sends no access-control-allow-origin, so a static page cannot call it
 * directly. That job was done by free public proxies until August 2026, when
 * five of them failed in three days: corsproxy.io went paid, allorigins and
 * codetabs returned 522, cors.lol rate-limited below what one page load needs,
 * and killcors advertised an endpoint with no DNS record at all. The site went
 * dark. This replaces all of them with one you own.
 *
 * Free tier is 100,000 requests a day. A watchlist load is about fifty, so that
 * is roughly two thousand page loads a day before anything is charged.
 *
 * Two restrictions, both deliberate, because an unrestricted proxy is an open
 * relay: anyone who finds the URL can push arbitrary traffic through it, spend
 * the quota, and make your account the apparent source of whatever they fetch.
 *
 *   ALLOWED_HOSTS — it will only fetch Yahoo. A request for anything else is
 *   refused before it leaves Cloudflare.
 *
 *   ALLOWED_ORIGINS — it only answers pages served from the dashboard's own
 *   origins. Requests from anywhere else get no CORS header, so a browser
 *   discards the response even if the fetch succeeds.
 *
 * Neither is security in the strong sense — Origin is set by the browser and a
 * script outside one can forge it — but together they mean the worst a stranger
 * can do is proxy public Yahoo data, which is the same thing Yahoo already
 * serves them for free.
 */

const ALLOWED_HOSTS = new Set([
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
]);

const ALLOWED_ORIGINS = new Set([
  "https://joeedessa.github.io",
  "http://localhost:8899",     // the local server used while developing
  "http://127.0.0.1:8899",
]);

/* Yahoo's own data is fifteen minutes delayed, so holding a response for sixty
   seconds costs nothing in freshness and takes a large bite out of the request
   count when a page is reloaded or several tabs are open. */
const EDGE_CACHE_SECONDS = 60;

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function refuse(status, message, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return refuse(405, "GET only", origin);

    /* Same shape the site already uses for every other proxy — ?url=<encoded> —
       so switching to this one is a one-line change at the call sites. */
    const target = new URL(request.url).searchParams.get("url");
    if (!target) return refuse(400, "missing ?url=", origin);

    let upstream;
    try { upstream = new URL(target); }
    catch { return refuse(400, "malformed url", origin); }

    if (upstream.protocol !== "https:") return refuse(400, "https only", origin);
    if (!ALLOWED_HOSTS.has(upstream.hostname)) {
      return refuse(403, "host not allowed: " + upstream.hostname, origin);
    }

    let res;
    try {
      res = await fetch(upstream.toString(), {
        // A browser-ish user agent; Yahoo is terse with unfamiliar clients.
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        cf: { cacheTtl: EDGE_CACHE_SECONDS, cacheEverything: true },
      });
    } catch (e) {
      return refuse(502, "upstream fetch failed: " + e, origin);
    }

    /* Yahoo's own headers are replaced rather than forwarded: its caching
       directives are written for its own site, and passing them through here
       would let a browser hold a quote far longer than it should. */
    const out = new Headers(cors);
    out.set("Content-Type", res.headers.get("Content-Type") || "application/json");
    out.set("Cache-Control", "public, max-age=" + EDGE_CACHE_SECONDS);
    return new Response(res.body, { status: res.status, headers: out });
  },
};
