/* The exchange's own previous close, for instruments whose day does not end
 * when the calendar day does.
 *
 * Every page here derives a day change by dividing the last daily bar by the
 * one before it. For a listed equity or fund that is exactly right: the bar and
 * the session are the same thing. For anything trading round the clock it is
 * not, and the error is not small.
 *
 * Yahoo cuts GC=F daily bars at midnight New York while the contract settles at
 * 17:00 New York. On 2026-08-28 the bar labelled Thursday closed at 4609.7
 * against a real settlement of 4664.0, so the Commodities, Markets, Overview
 * and Lookup pages all showed gold up 1.2% on a day it was up 0.03%. Measured
 * across the futures on one page that morning: copper +1.8% against +0.27%,
 * palladium +4.9% against +3.45%, silver +3.1% against +1.92%, and Brent -1.8%
 * against -0.52% — more than three times the real move. Six of eight wrong.
 *
 * Equities stayed correct throughout, which is why it survived so long: the
 * instruments it breaks are the ones nobody cross-checks against a broker, and
 * the ones it leaves alone are the ones you would.
 *
 * The fix is to stop deriving the number and ask for it. A batched spark call
 * at interval=5m returns `previousClose` in its metadata — the reference the
 * exchange itself uses — alongside a `regularMarketPrice` fresher than the last
 * daily bar. This module fetches that for the symbols that need it and hands
 * back both.
 *
 * Both, together, always. Taking the reference from here while leaving the
 * price on the daily bar would subtract two different conventions from each
 * other, which is the original bug wearing a hat. apply() replaces the pair or
 * neither.
 *
 * Only the round-the-clock symbols are fetched. The rest are already right, and
 * asking for them would double the request count to change nothing.
 */
(function () {
  "use strict";

  const MAP = Object.create(null);
  let loaded = false;

  /* Futures, crypto and FX. Everything else is a listed instrument whose daily
     bar closes when its session does. */
  const isRoundTheClock = s =>
    /=F$/.test(s) || /=X$/.test(s) || /-USD$/.test(s) || /^\^?[A-Z]+=F$/.test(s);

  function proxies() {
    /* Borrowed from the page rather than duplicated: whichever proxy list the
       host page carries is the one that has already been proven to work in this
       browser, and a second copy here would be one more place to update when a
       proxy dies — which, on the evidence, they do. */
    if (typeof PROXIES !== "undefined" && Array.isArray(PROXIES)) return PROXIES;
    return [u => "https://macro-compass-proxy.joe-edessa.workers.dev/?url=" + encodeURIComponent(u)];
  }

  async function fetchChunk(chunk) {
    const url = "https://query1.finance.yahoo.com/v7/finance/spark?symbols=" +
      chunk.map(encodeURIComponent).join(",") + "&range=1d&interval=5m";
    for (const wrap of proxies()) {
      try {
        const r = await fetch(wrap(url), { cache: "no-store" });
        if (!r.ok) continue;
        const j = await r.json();
        for (const row of (j.spark?.result || [])) {
          const m = row.response?.[0]?.meta;
          if (!m || m.regularMarketPrice == null || m.previousClose == null) continue;
          MAP[row.symbol] = { px: m.regularMarketPrice, prev: m.previousClose };
        }
        return;
      } catch { /* next proxy */ }
    }
  }

  /* Fire and forget is deliberate: a page must render on the daily bars whether
     or not this succeeds. When it does, apply() corrects what it can. */
  async function load(symbols) {
    const want = [...new Set(symbols)].filter(isRoundTheClock);
    if (!want.length) { loaded = true; return; }
    for (let i = 0; i < want.length; i += 10) await fetchChunk(want.slice(i, i + 10));
    loaded = true;
  }

  /* Correct one metrics object in place. `last` and the day change move
     together or not at all — see the note at the top about pairing. The longer
     windows are untouched: a 1-week or 1-month change spans whole bars either
     side, so the boundary convention cancels out and only the newest bar's
     reference is ever in question. */
  function apply(sym, m, dayKey) {
    const q = MAP[sym];
    if (!q || !m) return m;
    m[dayKey || "d1"] = (q.px / q.prev - 1) * 100;
    m.last = q.px;
    m.quoted = true;                       // so a caller can tell, and say so
    return m;
  }

  window.QUOTES = { load, apply, isRoundTheClock,
                    get: s => MAP[s], get ready() { return loaded; } };
})();
