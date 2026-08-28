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
  // Same three, as wrappers, so the startup probe exercises the real paths.
  const PROXIES_FOR_PROBE = [
    u => "https://api.cors.lol/?url=" + encodeURIComponent(u),
    u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
    u => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
  ];
  const FILE = "data/prices.json";                // long series, hourly
  const FILE_TIP = "data/prices-latest.json";     // last close, every 15 min

  /* The history is cached for the life of the page — three megabytes that gain
     one bar a day. The tip is not: it is thirteen kilobytes, CI rewrites it
     every quarter hour, and caching it forever made "Refresh prices" a no-op.
     With the proxies down, pressing it retried them, fell back to the same
     cached object and redrew identical numbers — the button looked broken,
     which is a fair reading of a control that cannot change anything. Re-reading
     the tip when it is older than a minute costs almost nothing and gives the
     button its meaning back. */
  let cache = null;          // history, kept for the page's life
  let inflight = null;       // so a burst of failures loads it once, not fifty times
  let tipData = null, tipAt = 0, tipInflight = null;
  const TIP_TTL_MS = 60000;
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

  /* Started the moment any proxy is seen to fail, not when the snapshot is
     first needed. The download is over half a megabyte, and fetching it only
     after the probe has finished put it in series behind the slowest dead
     proxy. Overlapping the two takes that off the critical path; calling this
     more than once is harmless because the first call owns the request. */
  function load() {
    if (cache) return Promise.resolve(cache);
    if (inflight) return inflight;
    /* Two files, fetched together. The history is three megabytes and moves
       once an hour; the tip is thirteen kilobytes and moves every fifteen
       minutes. Splitting them is what keeps a quarter-hourly refresh from
       adding 1.7GB a month to the repository — see scripts/fetch_prices.py.
       The tip is optional: if it is missing or stale the history alone is
       still a correct, if slightly older, answer. */
    inflight = fetch(FILE, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(hist => { cache = hist; return hist; });
    return inflight;
  }

  /* The tip, re-read once it is older than a minute. Concurrent callers share
     one request; a failure leaves whatever was already loaded in place, since a
     slightly old tip beats none at all. */
  function loadTip() {
    if (tipData && (Date.now() - tipAt) < TIP_TTL_MS) return Promise.resolve(tipData);
    if (tipInflight) return tipInflight;
    tipInflight = fetch(FILE_TIP, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(j => {
        if (j && j.latest) { tipData = j; tipAt = Date.now(); }
        tipInflight = null;
        return tipData;
      });
    return tipInflight;
  }

  /* History plus the current tip as one object. The prices map is shared by
     reference, not copied — it is the three-megabyte half. */
  async function snapshot() {
    const [hist, tip] = await Promise.all([load(), loadTip()]);
    if (!hist) return null;
    return { prices: hist.prices, generated_at: hist.generated_at,
             tip: tip && tip.latest, tip_at: tip && tip.generated_at };
  }

  /* The daily series with the freshest close spliced on. Same timestamp as the
     last bar means that bar has moved and is replaced; a later one means a new
     session and is appended.

     Daily only. A final bar up to an hour old changes a thirty-week or
     ten-month average by nothing worth having, and appending to those risks
     colliding with the phantom-bar rule ma.js applies to weekly and monthly
     series — a fabricated trailing bar is exactly what that rule exists to
     remove. */
  function withTip(snapshot, sym, series) {
    const t = snapshot.tip && snapshot.tip[sym];
    if (!t || t.c == null || !series.c.length) return series;
    const stamps = series.t || [];
    const lastT = stamps.length ? stamps[stamps.length - 1] : null;
    if (t.t == null || lastT == null) return series;
    if (t.t < lastT) return series;                 // tip is behind; keep history
    const c = series.c.slice(), ts = stamps.slice();
    if (t.t === lastT) { c[c.length - 1] = t.c; }
    else { c.push(t.c); ts.push(t.t); }
    return { c, t: ts };
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
      let series = tf === "d" ? rec : rec[tf];
      if (!series || !series.c || !series.c.length) continue;
      if (tf === "d") series = withTip(snapshot, sym, series);
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
    /* Updated in place rather than skipped when it already exists: the tip is
       re-read as the page runs, and a banner still quoting the first snapshot
       it saw would understate how fresh the prices actually are. */
    const existing = document.getElementById("pricefloor-note");
    // The tip is what sets the prices on screen; the history behind it is older
    // by design and quoting that would overstate the staleness.
    const stamp = snapshot.tip_at || snapshot.generated_at;
    const when = stamp
      ? new Date(stamp).toLocaleString(undefined,
          { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "the last hourly run";
    const el = existing || document.createElement("div");
    el.id = "pricefloor-note";
    /* Worded as a condition, not a failure. The first version opened with
       "Live price feed unreachable", which reads as a broken site — the page is
       in fact fully populated and correct, just from the snapshot rather than
       the tick. The snapshot refreshes every fifteen minutes and Yahoo's own
       feed is fifteen-minute delayed anyway, so the practical difference is
       usually nil, and saying so is more honest than sounding an alarm. */
    el.textContent = "Prices from the " + when + " snapshot, refreshed about every " +
      "15 minutes. The live feed is unavailable right now — reload to retry it.";
    el.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;z-index:60;padding:8px 14px;" +
      "font:500 12.5px/1.45 ui-sans-serif,-apple-system,'Segoe UI',Roboto,sans-serif;" +
      "text-align:center;border-top:1px solid rgba(237,161,0,0.55);" +
      "background:#3a2d05;color:#ffd97a;";
    if (!existing) document.body.appendChild(el);
  }

  const realFetch = window.fetch.bind(window);

  function hostOf(u) {
    try { return new URL(u, location.href).hostname; } catch { return ""; }
  }

  /* A proxy that is going to fail must fail quickly. Two of the three answer a
     dead request with a Cloudflare 522, which arrives only after their own
     twenty-second timeout — so the first batch on a cold page waited a minute
     before anything rendered, which reads as a broken site however correct the
     eventual result is. Anything worth waiting for comes back in well under
     four seconds; past that the snapshot is the better answer.

     Only proxy hosts get the deadline. The page's own files — prices.json
     among them — are on the same origin and must be allowed to take as long as
     they take. */
  const PROXY_DEADLINE_MS = 1500;

  function withDeadline(input, init, host) {
    if (!PROXY_HOSTS.includes(host)) return realFetch(input, init);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROXY_DEADLINE_MS);
    return realFetch(input, Object.assign({}, init, { signal: ctrl.signal }))
      .finally(() => clearTimeout(timer));
  }

  /* One probe at startup, all proxies at once, instead of discovering they are
     down request by request.

     Marking a host dead only after it has failed sounds sufficient, but the
     page issues its batches in waves, and a wave that starts before the first
     failure has landed still walks the whole list — so a cold load with every
     proxy down took between nine and fourteen seconds depending on how the
     waves happened to line up. A single parallel probe settles the question
     once, in the time of the slowest single attempt, before the first real
     request is answered.

     A tiny one-symbol request, because the answer only has to prove the proxy
     is alive. Whatever it costs is paid once per page load rather than per
     batch. */
  const PROBE_URL = "https://query1.finance.yahoo.com/v7/finance/spark" +
    "?symbols=SPY&range=5d&interval=1d";

  const probed = (async () => {
    await Promise.all(PROXIES_FOR_PROBE.map(async wrap => {
      const u = wrap(PROBE_URL);
      const host = hostOf(u);
      try {
        const r = await withDeadline(u, { cache: "no-store" }, host);
        if (!r.ok) { dead.add(host); load(); }
      } catch { dead.add(host); load(); }
    }));
  })();

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const host = hostOf(url);

    // Let the startup probe settle before walking a list that may all be down.
    if (PROXY_HOSTS.includes(host)) await probed;

    /* A host already known to be down is not contacted again, whatever is being
       asked of it. Serve the snapshot if it covers the request; otherwise fail
       instantly so the caller can move on.

       The instant failure is the important half. The watchlist asks v8/chart
       for a high and a low per symbol with a negation — forty-three requests
       the floor must refuse, because a close cannot stand in for a low. Those
       were still walking all three dead proxies at two and a half seconds
       each, in waves, which is what kept a page busy for thirty seconds after
       its tables had already been drawn. Declining to answer them is right;
       spending eight seconds per symbol to rediscover that the proxies are
       down is not. */
    if (dead.has(host)) {
      const short = await floorFor(url);
      if (short) return short;
      throw new TypeError("pricefloor: " + host + " is down, not retrying");
    }

    let res = null, threw = null;
    try {
      res = await withDeadline(input, init, host);
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
    const snap = await snapshot();
    if (!snap || !snap.prices) return null;
    const body = sparkFrom(snap, symbols, tf);
    if (!body.spark.result.length) return null;
    served++;
    try { announce(snap); } catch { /* a missing banner must not break a page */ }
    window.PRICEFLOOR_ACTIVE = true;

    /* Duck-typed rather than a real Response, because a real one has to be
       constructed from a string: the object would be serialised here and
       immediately parsed back by the caller. Across a watchlist load that is
       twenty-five payloads of ten symbols by up to three hundred closes,
       stringified and re-parsed for nothing. Callers only ever touch .ok and
       .json(), so handing them the object directly is both faster and less
       work. The rest of the shape is filled in so anything reading .status or
       .headers still finds what it expects. */
    return {
      ok: true, status: 200, statusText: "OK", redirected: false,
      type: "basic", url: "", bodyUsed: false,
      headers: new Headers({ "Content-Type": "application/json" }),
      json: async () => body,
      text: async () => JSON.stringify(body),
      clone() { return this; },
    };
  }

  window.PRICEFLOOR = {
    get served() { return served; },
    snapshot,
  };
})();
