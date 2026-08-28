/* A floor under the live price feed.
 *
 * Every price on this site reaches the browser through a free public CORS
 * proxy, because Yahoo sends no access-control-allow-origin and a static page
 * cannot call it directly. On 2026-08-23 every proxy in the list failed inside
 * the same hour — corsproxy.io started charging, allorigins and codetabs went
 * to 522, cors.lol rate-limited under the fifty-odd requests a watchlist load
 * makes — and the whole site went dark. Not one page drew a price.
 *
 * data/prices.json is written hourly by CI, which runs server-side where there
 * is no CORS at all. This file makes the pages fall back to it when the live
 * feed cannot be reached, so the worst case is an hour-old close with an honest
 * timestamp rather than an empty table.
 *
 * How it works, and why it is a fetch patch rather than a change to ten call
 * sites: the proxy loop is copied into ten files with slightly different
 * surroundings, and editing all ten by hand to add a fallback is ten chances to
 * get it wrong. Patching fetch once means every caller — including any added
 * later — gets the floor without knowing it exists.
 *
 * The rules that keep this honest:
 *
 *   Only spark requests. The watchlist's intraday negation check reads highs
 *   and lows from v8/chart, and a close cannot stand in for a low. Those are
 *   left to fail, because a fabricated low would silently mark trades as
 *   negated that never touched their level.
 *
 *   Only after the real fetch has failed. The floor never pre-empts live data.
 *
 *   A full year of closes, not the last one. Callers derive 21-day changes,
 *   52-week ranges and 200-day averages from the array they are handed. Given
 *   two points those calculations do not go blank, they go wrong — a 52-week
 *   range computed from two consecutive closes still renders as a number. So
 *   the snapshot carries real history and the same code paths reach the same
 *   answers they would have reached live.
 *
 *   Loud, not silent. Once the floor has served anything, the page says so.
 */
(function () {
  "use strict";

  const PROXY_HOSTS = ["api.cors.lol", "api.allorigins.win", "api.codetabs.com"];
  const FILE = "data/prices.json";

  let cache = null;          // the parsed snapshot, once
  let inflight = null;       // so a burst of failures loads it once, not fifty times
  let served = 0;            // how many requests the floor has answered

  /* Hosts that have already failed this page load. Without this the watchlist
     spent twenty-five seconds booting: eighteen batches each tried all three
     proxies, so fifty-four doomed round trips ran before the floor answered
     anything. A proxy that just refused one request is not going to accept the
     next one seconds later, so the first failure retires it and every
     subsequent request for a symbol the snapshot covers is answered straight
     from the file. Retired only for this page load — a reload gives every
     proxy another chance, which is what makes recovery automatic when they
     come back. */
  const dead = new Set();

  function load() {
    if (cache) return Promise.resolve(cache);
    if (inflight) return inflight;
    inflight = fetch(FILE, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(j => { cache = j; return j; })
      .catch(() => null);
    return inflight;
  }

  /* Pull the real Yahoo URL back out of whatever the proxy wrapped it in.
     Each proxy carries it differently — encoded in a query parameter, or
     appended raw — so both shapes are tried. */
  function innerUrl(u) {
    try {
      const url = new URL(u, location.href);
      if (!PROXY_HOSTS.includes(url.hostname)) return null;
      for (const k of ["url", "quest"]) {
        const v = url.searchParams.get(k);
        if (v) return v;
      }
      const raw = u.slice(u.indexOf(url.hostname) + url.hostname.length + 1);
      return raw.startsWith("http") ? decodeURIComponent(raw) : null;
    } catch { return null; }
  }

  function symbolsOf(yahooUrl) {
    const m = /[?&]symbols=([^&]+)/.exec(yahooUrl);
    if (!m) return null;
    return decodeURIComponent(m[1]).split(",").filter(Boolean);
  }

  /* Rebuild the exact shape spark returns, so callers parse it unchanged. Only
     the fields anything on this site actually reads are populated: the close
     series, its timestamps, the currency and the previous close. */
  function sparkFrom(snapshot, symbols, tf) {
    const result = [];
    for (const sym of symbols) {
      const rec = snapshot.prices[sym];
      if (!rec) continue;
      // Daily lives at the top level; weekly and monthly hang off it.
      const series = tf === "d" ? rec : rec[tf];
      if (!series || !series.c || !series.c.length) continue;
      result.push({
        symbol: sym,
        response: [{
          meta: {
            currency: rec.ccy,
            symbol: sym,
            previousClose: series.c.length > 1 ? series.c[series.c.length - 2] : null,
            fromPriceFloor: true,
          },
          timestamp: series.t || [],
          indicators: { quote: [{ close: series.c }] },
        }],
      });
    }
    return { spark: { result } };
  }

  /* Pinned to the bottom of the viewport and attached to <body>, not to the
     page container. The first version inserted it under the nav inside .wrap,
     and several pages rebuild .wrap once their data lands — which quietly took
     the banner with it, leaving the floor serving every price on the page and
     saying nothing. Attached outside anything a page redraws, it cannot be
     lost that way. */
  function announce(snapshot) {
    if (document.getElementById("pricefloor-note")) return;
    const when = snapshot.generated_at
      ? new Date(snapshot.generated_at).toLocaleString(undefined,
          { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "the last hourly run";
    const el = document.createElement("div");
    el.id = "pricefloor-note";
    el.textContent = "Live price feed unreachable — showing the hourly snapshot from " +
      when + ". End-of-session figures, not intraday. Reload to retry.";
    el.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:60;padding:8px 14px;" +
      "font:500 12.5px/1.45 ui-sans-serif,-apple-system,'Segoe UI',Roboto,sans-serif;" +
      "text-align:center;border-top:1px solid rgba(237,161,0,0.55);" +
      "background:#3a2d05;color:#ffd97a;";
    document.body.appendChild(el);
  }

  const realFetch = window.fetch.bind(window);

  function hostOf(u) {
    try { return new URL(u, location.href).hostname; } catch { return ""; }
  }

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const host = hostOf(url);

    /* Known-dead proxy and a request the snapshot can answer: skip the network
       entirely rather than paying for a failure we have already seen. */
    if (dead.has(host)) {
      const short = await floorFor(url);
      if (short) return short;
    }

    let res = null, threw = null;
    try {
      res = await realFetch(input, init);
      if (res.ok) return res;
      if (PROXY_HOSTS.includes(host)) dead.add(host);
    } catch (e) {
      threw = e;
      if (PROXY_HOSTS.includes(host)) dead.add(host);
    }

    const inner = innerUrl(url);
    // Not a proxied call, or not one the floor can honestly answer.
    if (!inner || inner.indexOf("/v7/finance/spark") === -1) {
      if (threw) throw threw;
      return res;
    }
    const floored = await floorFor(url);
    if (floored) return floored;
    if (threw) throw threw;
    return res;
  };

  /* Everything the floor can answer, or null when it cannot: a non-proxied
     URL, a v8/chart call needing highs and lows, or a symbol absent from the
     snapshot. Returning null means the caller falls through to its own error
     handling exactly as it did before this file existed. */
  async function floorFor(url) {
    const inner = innerUrl(url);
    if (!inner || inner.indexOf("/v7/finance/spark") === -1) return null;

    /* Serve the timeframe that was asked for, or nothing. The first version
       answered every request with the daily series, which does not fail — it
       computes a "30-week average" from thirty days and a "10-month average"
       from ten, and renders both as ordinary numbers. It drew a complete
       alignment read for 139 instruments on the trend map off weekly and
       monthly lines that were really daily ones. The floor has to give the
       answer the live feed would give or decline; approximating is the one
       thing it must never do. */
    const interval = (/[?&]interval=([^&]+)/.exec(inner) || [])[1] || "1d";
    const tf = { "1d": "d", "1wk": "w", "1mo": "m" }[interval];
    if (!tf) return null;

    const symbols = symbolsOf(inner);
    if (!symbols) return null;
    const snapshot = await load();
    if (!snapshot || !snapshot.prices) return null;
    const body = sparkFrom(snapshot, symbols, tf);
    if (!body.spark.result.length) return null;
    served++;
    try { announce(snapshot); } catch { /* a missing banner must not break a page */ }
    window.PRICEFLOOR_ACTIVE = true;
    return new Response(JSON.stringify(body),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }

  window.PRICEFLOOR = {
    get served() { return served; },
    snapshot: load,
  };
})();
