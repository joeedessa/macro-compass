/* Moving-average structure, shared by every price page.
 *
 * Built once and included rather than copied: the cross-detection logic already
 * exists in four near-identical copies across this site and that is three too
 * many. Pages differ in what they hold, not in how a 200-week average works.
 *
 * Exposes window.MA:
 *   MA.PERIODS            the four lengths, 21 / 50 / 150 / 200
 *   MA.smaSeries(v, n)    rolling mean, O(n)
 *   MA.read(vals, n)      where the last close sits, and the last level test
 *   MA.load(symbols)      weekly and monthly bars, batched and cached
 *   MA.events(rows)       fresh level changes, ranked by timeframe
 *   MA.panel(rows, opts)  the standard Structure block
 *
 * Two things about the data, learned the hard way:
 *
 * Spark honours the interval on a bounded range but silently ignores it on
 * range=max, returning the same ~168 downsampled bars whether you ask for
 * daily, weekly or monthly. Hence the explicit 5y and 25y windows, which give
 * roughly 263 weekly and 301 monthly bars — enough for a 200-period average.
 *
 * Everything here is close-only; the feed carries no intraday high or low. A
 * spike through a level that closed back above it therefore reads as held,
 * which is the outcome that matters, but pages must say so.
 */
(function () {
  "use strict";

  const PERIODS = [21, 50, 150, 200];
  const PROXIES = [
    u => "https://corsproxy.io/?url=" + encodeURIComponent(u),
    u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  ];
  const TF = {
    weekly:  { label: "weekly",  range: "5y",  interval: "1wk", data: null, loading: false, maxAgo: 1 },
    monthly: { label: "monthly", range: "25y", interval: "1mo", data: null, loading: false, maxAgo: 1 },
  };

  function smaSeries(vals, n) {
    if (!vals || vals.length < n) return [];
    const out = []; let s = 0;
    for (let i = 0; i < vals.length; i++) {
      s += vals[i];
      if (i >= n) s -= vals[i - n];
      if (i >= n - 1) out.push(s / n);
    }
    return out;
  }

  /* Where the last close sits against an average, whether it has been tested
     lately, and how long ago it last changed sides. The last of those is what
     separates news from context: "reclaimed at some point in the window" is
     background, "reclaimed on the latest bar" is an alert. */
  function read(vals, period) {
    if (!vals || vals.length < period + 2) return null;
    const ma = smaSeries(vals, period);
    const off = vals.length - ma.length;
    const last = vals[vals.length - 1], lastMa = ma[ma.length - 1];
    const dist = (last / lastMa - 1) * 100;
    const isAbove = dist >= 0;

    const LOOK = Math.min(15, ma.length - 1);
    let best = null;
    for (let k = ma.length - LOOK; k < ma.length; k++) {
      const d = vals[k + off] / ma[k] - 1;
      if (best === null || Math.abs(d) < Math.abs(best.d)) best = { d, k };
    }
    let state = null;
    if (best && Math.abs(best.d) <= 0.02) {
      const wasAbove = best.d >= 0;
      state = wasAbove && isAbove ? "held"
            : !wasAbove && !isAbove ? "rejected"
            : !wasAbove && isAbove ? "reclaimed" : "lost";
    }
    let crossedAgo = null;
    for (let k = ma.length - 2; k >= 0; k--) {
      if ((vals[k + off] >= ma[k]) !== isAbove) { crossedAgo = ma.length - 1 - k; break; }
    }
    return { ma: lastMa, dist, state, crossedAgo, above: isAbove };
  }

  async function fetchBars(symbols, range, interval) {
    const out = {};
    for (let i = 0; i < symbols.length; i += 10) {
      const chunk = symbols.slice(i, i + 10);
      const url = "https://query1.finance.yahoo.com/v7/finance/spark?symbols=" +
        chunk.map(encodeURIComponent).join(",") + "&range=" + range + "&interval=" + interval;
      for (const wrap of PROXIES) {
        try {
          const r = await fetch(wrap(url), { cache: "no-store" });
          if (!r.ok) continue;
          const j = await r.json();
          for (const row of (j.spark?.result || [])) {
            const closes = (row.response?.[0]?.indicators?.quote?.[0]?.close || [])
              .filter(c => c != null);
            if (closes.length) out[row.symbol] = closes;
          }
          break;
        } catch { /* next proxy */ }
      }
    }
    return out;
  }

  /* Both higher timeframes for a universe. Cached, so a page can call this
     without worrying about repeat renders. */
  async function load(symbols) {
    const syms = [...new Set(symbols)].filter(Boolean);
    await Promise.all(Object.keys(TF).map(async key => {
      const tf = TF[key];
      if (tf.data || tf.loading) return;
      tf.loading = true;
      tf.data = await fetchBars(syms, tf.range, tf.interval);
      tf.loading = false;
    }));
    return TF;
  }
  const bars = (key, sym) => (TF[key].data || {})[sym] || null;

  /* Fresh level changes across the timeframes a page has loaded.
     `rows` is [{sym, name, daily, dir}] where daily is an array of closes and
     dir is "long"/"short" or omitted for anything unpositioned. */
  function events(rows, opts) {
    const o = opts || {};
    const tfs = [["monthly", 0, 1], ["weekly", 1, 1], ["daily", 2, o.dailyMaxAgo ?? 2]];
    const out = [];
    for (const r of rows) {
      for (const [tf, rank, maxAgo] of tfs) {
        const vals = tf === "daily" ? r.daily : bars(tf, r.sym);
        if (!vals) continue;
        for (const n of [200, 150]) {
          const m = read(vals, n);
          if (!m || (m.state !== "reclaimed" && m.state !== "lost")) continue;
          if (m.crossedAgo == null || m.crossedAgo > maxAgo) continue;
          /* Direction matters where a position exists: a short whose name just
             lost its 200-day is being helped, and calling that bearish says the
             opposite of the truth. Unpositioned rows read plainly. */
          const helps = r.dir ? (r.dir === "long" ? m.state === "reclaimed" : m.state === "lost")
                              : m.state === "reclaimed";
          out.push({ sym: r.sym, name: r.name || r.sym, tf, period: n, rank,
                     state: m.state, ago: m.crossedAgo, ma: m.ma, dist: m.dist, helps,
                     dir: r.dir || null });
        }
      }
    }
    out.sort((a, b) => a.rank - b.rank || a.period - b.period || b.ago - a.ago);
    return out;
  }

  /* Standing structure: how much of a universe sits above each average. Useful
     where a list of individual events would be less telling than the balance. */
  function breadth(rows, tf, period) {
    let above = 0, total = 0;
    for (const r of rows) {
      const vals = tf === "daily" ? r.daily : bars(tf, r.sym);
      const m = read(vals, period);
      if (!m) continue;
      total++; if (m.above) above++;
    }
    return total ? { above, total, pct: Math.round(above / total * 100) } : null;
  }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const fmt = (v, d = 1) => v == null || !isFinite(v) ? "–"
    : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

  /* The standard Structure block: a breadth strip over the three timeframes,
     then the fresh level changes. Pages hand in their rows and a link builder. */
  function panel(container, rows, opts) {
    const o = opts || {};
    container.textContent = "";

    const strip = el("div", "mabreadth");
    for (const [tf, label] of [["daily", "Daily"], ["weekly", "Weekly"], ["monthly", "Monthly"]]) {
      for (const period of [50, 200]) {
        const b = breadth(rows, tf, period);
        if (!b) continue;
        const card = el("div", "macard" + (b.pct >= 60 ? " on" : b.pct <= 40 ? " off" : ""));
        card.appendChild(el("div", "mal", label + " " + period));
        card.appendChild(el("div", "mav", b.pct + "%"));
        card.appendChild(el("div", "mas", b.above + " of " + b.total + " above"));
        strip.appendChild(card);
      }
    }
    if (strip.children.length) container.appendChild(strip);

    const evs = events(rows, o);
    const list = el("div", "malist");
    const head = el("h4", null, "Level changes");
    head.appendChild(el("span", "masub",
      " · fresh crosses of the 150 and 200, newest timeframe first"));
    list.appendChild(head);
    if (!evs.length) {
      list.appendChild(el("p", "manone",
        "Nothing has changed sides on a 150 or 200 recently."));
    }
    for (const e of evs.slice(0, o.limit || 12)) {
      const row = el("div", "marow " + (e.helps ? "good" : "bad"));
      const a = el("a", null, e.name);
      const href = o.link ? o.link(e.sym) : null;
      if (href) { a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; }
      row.appendChild(a);
      row.appendChild(el("span", "mawhat",
        e.state + " its " + e.tf + " " + e.period +
        (e.ago === 0 ? " on the latest bar"
          : " " + e.ago + " bar" + (e.ago > 1 ? "s" : "") + " ago")));
      row.appendChild(el("span", "madist", (e.dist > 0 ? "+" : "") + fmt(e.dist) + "% vs the average"));
      list.appendChild(row);
    }
    container.appendChild(list);
    return evs.length;
  }

  window.MA = { PERIODS, smaSeries, read, load, bars, events, breadth, panel, TF };
})();
