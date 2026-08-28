/* Moving-average structure, shared by every price page.
 *
 * Built once and included rather than copied: the cross-detection logic already
 * exists in four near-identical copies across this site and that is three too
 * many. Pages differ in what they hold, not in how a 200-week average works.
 *
 * Exposes window.MA:
 *   MA.PERIODS            21 / 50 / 150 / 200, the lengths the structure block reads
 *   MA.COL_PERIODS        5 / 21 / 50 / 150 / 200, the lengths the columns show
 *   MA.smaSeries(v, n)    rolling mean, O(n)
 *   MA.emaSeries(v, n)    exponential mean, seeded from the first value
 *   MA.read(vals, n)      where the last close sits, and the last level test
 *   MA.load(symbols)      weekly and monthly bars, batched and cached
 *   MA.events(rows)       fresh level changes, ranked by timeframe
 *   MA.panel(rows, opts)  the standard Structure block — breadth plus events
 *   MA.crosses(vals, n)   sign changes on the five-tier ladder
 *   MA.scan(rows, opts)   the ladder grid with its daily/weekly/monthly toggle
 *   MA.colDefs()          active MA columns, daily plus whichever are toggled on
 *   MA.colCell(row, key)  one distance cell, with the level tag on 150 and 200
 *   MA.colValue(row, key) the same as a number, for a page's own sort
 *   MA.colToggles(...)    the + Weekly / + Monthly control
 *
 * Three questions, three shapes: where does this sit now (columns), what just
 * changed (events), and how is the group placed (breadth). The columns exist
 * because the first of those was answerable on two pages out of eight.
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
    /* Yahoo sends no access-control-allow-origin, so every price on this site
       reaches the browser through one of these. They are free, public and
       therefore mortal: on 2026-08-23 corsproxy.io began answering 401 to
       everyone without a paid key and allorigins went to 522, and because
       corsproxy.io was FIRST in this list every request on every page spent
       its first attempt on a guaranteed failure before falling through to a
       proxy that was also down. Nothing loaded anywhere.

       Ordered by what was measured working that day, dead ones removed. Each
       is tried in turn, so the cost of one being slow is bounded by the next
       one succeeding — but none of them is dependable on its own, which is
       why data/prices.json exists as a floor beneath all of them. */
    u => "https://macro-compass-proxy.joe-edessa.workers.dev/?url=" + encodeURIComponent(u),
    u => "https://api.cors.lol/?url=" + encodeURIComponent(u),
    u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
    u => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
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

    /* Was the average tested recently, and what happened.
       Two things had to change from the first version, and both showed up on
       VIX reading "rejected" beside "-26%": a tag that is technically true and
       useless in the same breath.

       The tolerance is now scaled to how much the instrument actually moves,
       not fixed at 2%. VIX swings twenty per cent in a week, so coming within
       two per cent of its 30-week is not a test, it is Tuesday. The threshold
       is half the typical bar-to-bar move, floored at 1% and capped at 4%, so
       a quiet bond fund and a volatility index each get a "test" that means
       something for them.

       And a test only counts as news while price is still near the level.
       "Rejected" fifteen bars ago with price since gone 26% the other way is
       history, not structure; the caller wants to know if the average is in
       play NOW. So the tag stays only while the latest close sits within three
       times the tolerance of the average. Beyond that the position is simply
       above or below, and the caret already says so. */
    const LOOK = Math.min(15, ma.length - 1);
    let sumAbs = 0, cnt = 0;
    for (let k = Math.max(1, vals.length - 40); k < vals.length; k++) {
      if (!vals[k - 1]) continue;              // a zero print is not a price
      sumAbs += Math.abs(vals[k] / vals[k - 1] - 1); cnt++;
    }
    const typical = cnt ? sumAbs / cnt : 0.02;
    const tol = Math.min(0.04, Math.max(0.01, typical * 0.5));
    let best = null;
    for (let k = ma.length - LOOK; k < ma.length; k++) {
      const d = vals[k + off] / ma[k] - 1;
      if (best === null || Math.abs(d) < Math.abs(best.d)) best = { d, k };
    }
    let state = null;
    const stillNear = Math.abs(dist / 100) <= tol * 3;
    if (best && Math.abs(best.d) <= tol && stillNear) {
      const wasAbove = best.d >= 0;
      state = wasAbove && isAbove ? "held"
            : !wasAbove && !isAbove ? "rejected"
            : !wasAbove && isAbove ? "reclaimed" : "lost";
    }
    let crossedAgo = null;
    for (let k = ma.length - 2; k >= 0; k--) {
      if ((vals[k + off] >= ma[k]) !== isAbove) { crossedAgo = ma.length - 1 - k; break; }
    }
    return { ma: lastMa, dist, state, crossedAgo, above: isAbove, tol };
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
            const resp = row.response?.[0];
            const raw = resp?.indicators?.quote?.[0]?.close || [];
            const ts = resp?.timestamp || [];
            /* Yahoo pads a phantom bar onto every weekly and monthly series:
               stamped with the last trade's time and carrying the same close
               as the period already in progress. Left in, the current week or
               month is counted twice in every average — biasing each one
               toward the latest price by up to a point and a half on a
               10-month, always in the flattering direction. It shipped that
               way and my own recomputation missed it, because I fed the same
               padded input back in.

               The signature is clean: every genuine bar sits on its period
               boundary — Monday for weekly, the 1st for monthly — and the
               phantom does not. Checked over 561 historical bars with zero
               false positives. So the tail bar is dropped only when it is off
               the boundary AND repeats the prior close, which also keeps a
               genuinely flat final period that happens to land on a boundary. */
            const onBoundary = (t) => {
              const d = new Date(t * 1000);
              return interval === "1wk" ? d.getUTCDay() === 1 : d.getUTCDate() === 1;
            };
            const closes = [];
            for (let i = 0; i < raw.length; i++) {
              if (raw[i] == null) continue;
              const isLast = i === raw.length - 1;
              const dupOfPrev = closes.length && raw[i] === closes[closes.length - 1];
              if (isLast && dupOfPrev && ts[i] && !onBoundary(ts[i])) continue;
              closes.push(raw[i]);
            }
            if (closes.length) out[row.symbol] = closes;
          }
          break;
        } catch { /* next proxy */ }
      }
    }
    return out;
  }

  /* Both higher timeframes for a universe, fetching only what is missing.
     The first version skipped the whole call once any data had been cached,
     which is right for a page holding one fixed universe and wrong for Lookup,
     where the universe changes with every subject. Opening Gold cached Gold's
     symbols; every country selected afterwards then found the cache non-empty,
     fetched nothing, and rendered a row of dashes under the weekly and monthly
     columns. Missing symbols are now fetched and merged, so the cache grows
     across subjects instead of freezing on the first one.

     Symbols that come back with nothing are recorded as null rather than left
     absent, or every visit would re-request the ones that have no bars. */
  async function load(symbols) {
    const syms = [...new Set(symbols)].filter(Boolean);
    await Promise.all(Object.keys(TF).map(async key => {
      const tf = TF[key];
      if (tf.loading) await tf.loading;              // let an in-flight pass land first
      const missing = syms.filter(s => !tf.data || !(s in tf.data));
      if (!missing.length) return;
      tf.loading = (async () => {
        const got = await fetchBars(missing, tf.range, tf.interval);
        tf.data = Object.assign(tf.data || {}, got);
        for (const s of missing) if (!(s in tf.data)) tf.data[s] = null;
      })();
      await tf.loading;
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
    /* When a page is showing one subject beside its peers — Lookup does, and
       the peers are the point — the subject's own rows have to be findable at a
       glance, or the reader is scanning nine near-identical lines for the one
       they asked about. Marked in a channel that is not red or green, since
       those already mean direction here. */
    const hl = new Set([].concat(o.highlight || []));
    for (const e of evs.slice(0, o.limit || 12)) {
      const row = el("div", "marow " + (e.helps ? "good" : "bad") +
        (hl.has(e.sym) ? " subj" : ""));
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

  /* =====================================================================
     The cross scan
     =====================================================================
     Moved here from four near-identical copies in countries, themes, lookup
     and app.js. They had already drifted — different loop forms, one emitting
     `key` and `when` where the others emitted `tier`, one null-guarding its
     input and the rest not — while computing exactly the same thing. Adding a
     timeframe toggle to four copies would have made that five.

     On what the periods mean once the timeframe moves: a 200 on weekly bars is
     200 weeks, close to four years, and on monthly bars roughly seventeen.
     That is the point — the same ladder read at a horizon where a crossing is
     rare enough to matter — but it also means the monthly scan can only cover
     names with eighteen years of history, so the panel counts and states how
     many qualified rather than quietly scanning fewer.
     --------------------------------------------------------------------- */

  const SCAN_TF = {
    daily:   { label: "Daily",   unit: "d",  lookback: 10, word: "sessions" },
    monthly: { label: "Monthly", unit: "mo", lookback: 12, word: "months" },
    weekly:  { label: "Weekly",  unit: "w",  lookback: 13, word: "weeks" },
  };
  const SCAN_ORDER = ["daily", "weekly", "monthly"];
  /* 200 periods for the slowest average plus room for the window. Anything
     shorter cannot produce a 50-by-200 cross at all. */
  const MIN_BARS = 220;

  /* Seeded from the first value and iterated over the whole series, then the
     first n dropped — matching what the pages have always done, so the crosses
     this reports are the same ones they reported yesterday. */
  function emaSeries(vals, n) {
    if (!vals || vals.length < n) return [];
    const k = 2 / (n + 1);
    let prev = vals[0];
    const out = [];
    for (let i = 0; i < vals.length; i++) {
      prev = vals[i] * k + prev * (1 - k);
      out.push(prev);
    }
    return out.slice(n);
  }

  /* The escalation ladder, left to right: each step costs time and buys
     confidence. Price leads its own averages arithmetically, so a name
     normally lights up on the left and works rightward. */
  const TIERS = [
    { key: "e5x21",  label: "5 × 21",      sub: "EMA timing trigger",
      pick: (P, S) => [S.e5, S.e21] },
    { key: "px50",   label: "price × 50",  sub: "swing trend break",
      pick: (P, S) => [P, S.s50] },
    { key: "e21x50", label: "21 × 50",     sub: "intermediate turn",
      pick: (P, S) => [S.e21, S.s50] },
    { key: "px200",  label: "price × 200", sub: "regime change",
      pick: (P, S) => [P, S.s200] },
    { key: "s50x200", label: "50 × 200",   sub: "golden / death",
      pick: (P, S) => [S.s50, S.s200] },
  ];

  /* Sign changes in (fast − slow) inside the window.
     Every series here is end-aligned — smaSeries and emaSeries both drop their
     warm-up from the front — so the two legs are compared by offset from the
     last bar rather than joined on a date. That is what lets the same function
     read a daily array and a monthly one without caring which it has. */
  function crosses(vals, lookback) {
    if (!vals || vals.length < MIN_BARS) return [];
    const S = { s50: smaSeries(vals, 50), s200: smaSeries(vals, 200),
                e21: emaSeries(vals, 21), e5: emaSeries(vals, 5) };
    const out = [];
    for (const t of TIERS) {
      const [fast, slow] = t.pick(vals, S);
      if (!fast.length || !slow.length) continue;
      const span = Math.min(fast.length, slow.length, lookback + 1);
      if (span < 2) continue;
      const d = [];
      for (let i = span - 1; i >= 0; i--) d.push(fast[fast.length - 1 - i] - slow[slow.length - 1 - i]);
      for (let i = 1; i < d.length; i++) {
        const prev = d[i - 1], now = d[i];
        if (prev === 0 || now === 0 || (prev < 0) === (now < 0)) continue;
        /* Whipsaw: does the sign flip back again later inside the window? A
           cross that has already been given back is not the same event as one
           that has held, and the tag says so rather than dropping it. */
        let whip = false;
        for (let k = i + 1; k < d.length; k++) {
          if ((d[k] < 0) !== (now < 0)) { whip = true; break; }
        }
        out.push({ key: t.key, label: t.label, bullish: now > 0,
                   ago: d.length - 1 - i, whip });
      }
    }
    return out;
  }

  /* The scan panel: a timeframe toggle over the ladder grid.
     `rows` is [{sym, name, daily}]; higher timeframes come from the shared
     cache and are fetched on first use, so the default view costs nothing
     extra and the toggle pays for itself only when pressed. */
  function scan(container, rows, opts) {
    const o = opts || {};
    const st = container.__scan || (container.__scan = { tf: o.tf || "daily", loading: false });

    const valsFor = (r, tf) => tf === "daily" ? r.daily : bars(tf, r.sym);

    const hlSet = new Set([].concat(o.highlight || []));

    function draw() {
      container.textContent = "";
      const cfg = SCAN_TF[st.tf];

      const sw = el("div", "switch");
      sw.appendChild(el("span", "slabel", "Timeframe"));
      for (const key of SCAN_ORDER) {
        const b = el("button", "rangebtn", SCAN_TF[key].label);
        b.type = "button";
        b.setAttribute("aria-pressed", String(key === st.tf));
        b.addEventListener("click", () => select(key));
        sw.appendChild(b);
      }
      const note = el("span", "manote");
      sw.appendChild(note);
      container.appendChild(sw);

      if (st.loading) {
        note.textContent = "Loading " + cfg.label.toLowerCase() + " bars…";
        return;
      }

      const found = [];
      let covered = 0;
      for (const r of rows) {
        const vals = valsFor(r, st.tf);
        if (!vals || vals.length < MIN_BARS) continue;
        covered++;
        for (const ev of crosses(vals, cfg.lookback)) {
          found.push({ sym: r.sym, name: r.name || r.sym, ...ev });
        }
      }
      note.textContent = "crosses in the last " + cfg.lookback + " " + cfg.word +
        " · " + covered + " of " + rows.length + " with enough history";

      if (!covered) {
        container.appendChild(el("p", "signone",
          "None of these carry the " + (MIN_BARS) + " " + cfg.word +
          " a 200-period average needs."));
        return;
      }
      if (!found.length) {
        container.appendChild(el("p", "signone",
          "No crosses in the last " + cfg.lookback + " " + cfg.word + "."));
        return;
      }

      for (const bullish of [true, false]) {
        const block = el("div", "sigblock " + (bullish ? "bull" : "bear"));
        const head = el("h3", null, bullish ? "▲ Bullish crosses" : "▼ Bearish crosses");
        head.appendChild(el("span", "ladder",
          "earliest and noisiest on the left → latest and most reliable on the right"));
        block.appendChild(head);
        const grid = el("div", "sigcols");
        for (const t of TIERS) {
          const col = el("div", "sigcol " + (bullish ? "bull" : "bear"));
          col.appendChild(el("p", "tierhead", t.label));
          col.appendChild(el("p", "sigsub", t.sub));
          const mine = found.filter(f => f.bullish === bullish && f.key === t.key)
            .sort((a, b) => a.ago - b.ago);
          if (!mine.length) {
            col.appendChild(el("p", "signone", "none"));
            grid.appendChild(col);
            continue;
          }
          for (const f of mine) {
            const it = el("div", "sigitem" + (hlSet.has(f.sym) ? " subj" : ""));
            const a = el("a", null, f.name);
            const href = o.link ? o.link(f.sym) : null;
            if (href) { a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; }
            it.appendChild(a);
            if (f.whip) it.appendChild(el("span", "whiptag", "whipsawed"));
            it.appendChild(el("span", "sighint", f.sym + " · " +
              (f.ago === 0 ? "latest close" : f.ago + cfg.unit + " ago")));
            col.appendChild(it);
          }
          grid.appendChild(col);
        }
        block.appendChild(grid);
        container.appendChild(block);
      }
    }

    function select(tf) {
      if (tf === st.tf) return;
      st.tf = tf;
      /* Always ask — load is cheap when nothing is missing, and gating on
         "is the cache non-empty" is what broke this across subjects. */
      if (tf !== "daily") {
        st.loading = true;
        draw();
        load(rows.map(r => r.sym)).then(() => { st.loading = false; draw(); });
        return;
      }
      draw();
    }

    draw();
    return st;
  }


  /* =====================================================================
     The moving-average column block
     =====================================================================
     Five periods, three timeframes, one implementation.

     The ladder above reports crosses — events. It cannot answer "where does
     this sit right now", which is a different and more often asked question:
     a name that reclaimed its 200 six months ago and has held it appears in no
     cross column at all. Countries, Commodities, AI and Lookup carried a single
     "vs 200-day"; Themes carried neither. Portfolio and the watchlist had four
     periods across three timeframes and were the only places you could see it.

     On 5 and 21 being simple averages here while the ladder's "5 × 21" tier
     uses exponential ones: that split already existed — the watchlist's 21
     column has always been an SMA beside a ladder tier calling the same number
     an EMA — and the columns are left simple so no figure anyone has been
     reading moves. The header says which, rather than leaving it to be assumed.
     --------------------------------------------------------------------- */

  /* One period set per timeframe. Daily lengths do not transplant onto
     slower bars — a 200-period monthly is seventeen years, not a trend line —
     so weekly and monthly use the lengths chartists actually read. Weekly: 10,
     30 (Weinstein's stage line), 40 (the 200-day in weeks), 200 (the cycle
     floor). Monthly: 10 (Faber's line, the 200-day in months), 12, 20. The
     trend map settled these; this makes every other page agree with it. */
  const COL_PERIODS = [5, 21, 50, 150, 200];
  const PERIODS_BY_TF = { d: COL_PERIODS, w: [10, 30, 40, 200], m: [10, 12, 20] };
  const COL_STATE = { w: false, m: false };
  const TF_OF = { w: "weekly", m: "monthly" };

  /* Active columns, daily always and the higher timeframes when toggled on.
     Returned as [key, label] so a page can splice them straight into whatever
     header array it already walks. */
  function colDefs() {
    const set = tf => PERIODS_BY_TF[tf].map(n => ["ma_" + tf + n, n + tf]);
    return set("d")
      .concat(COL_STATE.w ? set("w") : [])
      .concat(COL_STATE.m ? set("m") : []);
  }
  const isColKey = k => typeof k === "string" && k.startsWith("ma_");

  function colRead(row, key) {
    const tf = key[3], n = +key.slice(4);
    const vals = tf === "d" ? row.daily : bars(TF_OF[tf], row.sym);
    return read(vals, n);
  }
  /* Sortable value for a column, so a page's existing comparator keeps working. */
  const colValue = (row, key) => {
    const m = colRead(row, key);
    return m ? m.dist : null;
  };

  function colCell(row, key) {
    const m = colRead(row, key);
    const td = el("td");
    if (!m) { td.className = "madim"; td.textContent = "–"; return td; }
    /* Above or below stated, not inferred.
       A signed percentage in a table full of signed percentages does not read
       as a position — you have to know that plus means above, and the returns
       columns beside it use the same sign for something else entirely. The
       caret says which side of the average price is on; the number says how
       far. */
    td.className = m.dist >= 0 ? "maup" : "madown";
    td.appendChild(el("span", "maside", m.above ? "▲" : "▼"));
    td.appendChild(document.createTextNode(
      " " + (m.dist > 0 ? "+" : "") + fmt(m.dist, 1) + "%"));
    /* The level test is shown only on the lines a chartist treats as support
       and resistance on that timeframe — daily 150/200, weekly 30/40/200,
       monthly 10/20. Tagging every column would bury them. */
    const n = +key.slice(4), tfk = key[3];
    const TAGGED = { d: [150, 200], w: [30, 40, 200], m: [10, 20] };
    if (m.state && TAGGED[tfk].includes(n)) td.appendChild(el("span", "matag " + m.state, m.state));
    td.title = (m.above ? "Above" : "Below") + " the " + n + "-period average, "
      + "which sits at " + fmt(m.ma, Math.abs(m.ma) >= 100 ? 1 : 3);
    return td;
  }

  /* The toggle row. Higher timeframes are fetched on first press and cached,
     so the daily default costs nothing and pressing one is paid for once. */
  function colToggles(container, symbols, onChange) {
    container.textContent = "";
    const sw = el("div", "switch");
    sw.appendChild(el("span", "slabel", "Moving averages"));
    sw.appendChild(el("span", "mafixed", COL_PERIODS.join(" · ") + " daily"));
    sw.appendChild(el("span", "mafixed", "10 · 30 · 40 · 200 weekly · 10 · 12 · 20 monthly"));
    for (const [k, label] of [["w", "+ Weekly"], ["m", "+ Monthly"]]) {
      const b = el("button", "rangebtn", label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(COL_STATE[k]));
      b.addEventListener("click", async () => {
        const turningOn = !COL_STATE[k];
        if (turningOn) {
          b.textContent = "loading…";
          b.disabled = true;
          await load(typeof symbols === "function" ? symbols() : symbols);
          b.disabled = false;
          b.textContent = label;
        }
        COL_STATE[k] = turningOn;
        b.setAttribute("aria-pressed", String(COL_STATE[k]));
        onChange();
      });
      sw.appendChild(b);
    }
    sw.appendChild(el("span", "manote",
      "▲ means price is above that average and ▼ below it; the number is how far. On the " +
      "daily set the last bar is the running session while the market is open, so a name " +
      "close to a line can be on either side of it intraday and settle on the other — the " +
      "watchlist alone acts on settled closes and says so. held / rejected / reclaimed / lost " +
      "appear on the 150 and 200 while price is still near the line, with \"near\" scaled to how " +
      "much that instrument normally moves. The cross ladder uses exponential averages for its " +
      "5 and 21 tiers; these columns are simple throughout."));
    container.appendChild(sw);
  }

  window.MA = { PERIODS, COL_PERIODS, PERIODS_BY_TF, smaSeries, emaSeries, read, load, bars, events,
                breadth, panel, crosses, scan, TIERS, SCAN_TF, TF,
                colDefs, colCell, colValue, colToggles, colRead, isColKey, COL_STATE };
})();
