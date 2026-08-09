"use strict";
/* Macro Compass — morning read.
   Live prices come from Yahoo Finance on every page load, via a keyless CORS
   proxy (a static page cannot call Yahoo directly — no CORS header). Official
   macro fundamentals come from data/macro.json, refreshed hourly by CI, which
   also serves as the floor if the live feed is unavailable. */

const PROXIES = [
  u => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  u => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
];
const SPARK = "https://query1.finance.yahoo.com/v7/finance/spark?symbols=";
const CHUNK = 10;                       // Yahoo 400s on much more than this
const YQ = s => "https://finance.yahoo.com/quote/" + encodeURIComponent(s);

const GROUPS = [
  ["us", "US equity"],
  ["mag7", "Magnificent Seven"],
  ["style", "Size and style"],
  ["global", "World equity benchmarks"],
  ["sector", "Sectors"],
  ["commodities", "Commodities"],
  ["miners", "Miners"],
  ["rates", "Rates & credit"],
  ["fx", "FX & volatility"],
];

// symbol, display name, group, kind
const UNIVERSE = [
  ["^GSPC", "S&P 500", "us"],
  ["^IXIC", "Nasdaq Composite", "us"],
  ["^RUT", "Russell 2000", "us"],
  ["DIA", "Dow Jones (DIA)", "us"],
  ["SPY", "S&P 500 (SPY)", "us"],
  ["QQQ", "Nasdaq 100 (QQQ)", "us"],
  ["IWM", "Russell 2000 (IWM)", "us"],
  ["RSP", "S&P 500 equal weight", "us"],
  ["MAGS", "Magnificent 7 (MAGS)", "mag7"],
  ["AAPL", "Apple", "mag7"],
  ["MSFT", "Microsoft", "mag7"],
  ["GOOGL", "Alphabet", "mag7"],
  ["AMZN", "Amazon", "mag7"],
  ["NVDA", "Nvidia", "mag7"],
  ["META", "Meta", "mag7"],
  ["TSLA", "Tesla", "mag7"],
  ["XRT", "Retail", "family"],
  ["KRE", "Regional banks", "family"],
  ["IYT", "Transportation", "family"],
  ["IBB", "Biotech", "family"],
  ["BTC-USD", "Bitcoin", "family"],
  ["IVV", "S&P 500 large blend", "style"],
  ["IVE", "S&P 500 large value", "style"],
  ["IVW", "S&P 500 large growth", "style"],
  ["IJH", "S&P 400 mid blend", "style"],
  ["IJJ", "S&P 400 mid value", "style"],
  ["IJK", "S&P 400 mid growth", "style"],
  ["IJR", "S&P 600 small blend", "style"],
  ["IJS", "S&P 600 small value", "style"],
  ["IJT", "S&P 600 small growth", "style"],
  ["ACWI", "MSCI ACWI", "global"],
  ["GVAL", "Global value (GVAL)", "global"],
  ["EEM", "Emerging markets", "global"],
  ["EFA", "Developed ex-US", "global"],
  ["XLK", "Technology", "sector"],
  ["SMH", "Semiconductors", "sector"],
  ["XLF", "Financials", "sector"],
  ["XLY", "Consumer discretionary", "sector"],
  ["XLI", "Industrials", "sector"],
  ["XLE", "Energy", "sector"],
  ["XLB", "Materials", "sector"],
  ["XLC", "Communication services", "sector"],
  ["XLV", "Health care", "sector"],
  ["XLP", "Consumer staples", "sector"],
  ["XLU", "Utilities", "sector"],
  ["XLRE", "Real estate", "sector"],
  ["GC=F", "Gold", "commodities"],
  ["SI=F", "Silver", "commodities"],
  ["PL=F", "Platinum", "commodities"],
  ["PA=F", "Palladium", "commodities"],
  ["HG=F", "Copper", "commodities"],
  ["ALI=F", "Aluminum", "commodities"],
  ["CL=F", "WTI crude", "commodities"],
  ["URA", "Uranium (URA)", "commodities"],
  ["BCI", "Broad commodities", "commodities"],
  ["GLD", "Gold (GLD)", "commodities"],
  ["GDX", "Gold miners", "miners"],
  ["GDXJ", "Junior gold miners", "miners"],
  ["SIL", "Silver miners", "miners"],
  ["SILJ", "Junior silver miners", "miners"],
  ["COPX", "Copper miners", "miners"],
  ["URNM", "Uranium miners", "miners"],
  ["XME", "Metals & mining", "miners"],
  ["REMX", "Rare earth & strategic metals", "miners"],
  ["^TNX", "US 10-year yield", "rates", "yield"],
  ["^TYX", "US 30-year yield", "rates", "yield"],
  ["TLT", "20y+ Treasuries", "rates"],
  ["IEF", "7-10y Treasuries", "rates"],
  ["STIP", "0-5y TIPS", "rates"],
  ["HYG", "High yield credit", "rates"],
  ["LQD", "Investment grade", "rates"],
  ["DX-Y.NYB", "US dollar index", "fx"],
  ["JPY=X", "USD/JPY", "fx"],
  ["EURUSD=X", "EUR/USD", "fx"],
  ["^VIX", "VIX", "fx"],
  ["^VIX3M", "VIX 3-month", "fx"],
];

/* Relative strength. `up` and `down` state in words what each direction means,
   so the reader never has to remember which way is bullish. */
const RATIOS = [
  ["QQQ", "SPY", "Growth vs broad market", "Growth leading", "Growth lagging"],
  ["MAGS", "SPY", "Magnificent 7 vs market", "Mega-cap concentration rising", "Concentration easing"],
  ["SPY", "RSP", "Cap-weight vs equal-weight", "Leadership narrowing", "Leadership broadening"],
  ["IWM", "SPY", "Small vs large cap", "Small caps leading", "Large caps leading"],
  ["QQQ", "IWM", "Nasdaq vs Russell 2000", "Mega-cap tech leading", "Small caps leading"],
  ["EEM", "SPY", "Emerging vs US", "EM leading", "US leading"],
  ["EFA", "SPY", "Developed ex-US vs US", "Ex-US leading", "US leading"],
  ["XLY", "XLP", "Cyclical vs defensive", "Risk appetite rising", "Defensives bid, risk appetite falling"],
  ["HYG", "IEF", "High yield vs Treasuries", "Credit risk appetite rising", "Credit risk appetite falling"],
  ["HG=F", "GC=F", "Copper vs gold", "Growth expectations over fear", "Fear over growth expectations"],
  ["SMH", "SPY", "Semis vs market", "Semis leading", "Semis lagging"],
  ["SPY", "GLD", "Equities vs gold", "Equities preferred over gold", "Gold preferred over equities"],
  ["GVAL", "SPY", "Global deep value vs US", "Value markets leading the US", "US leading global value markets"],
  ["GDX", "GLD", "Gold miners vs gold", "Miners leading the metal", "Miners lagging the metal"],
  ["GDXJ", "GDX", "Junior vs senior gold miners", "Risk appetite within miners rising", "Juniors being derisked"],
  ["COPX", "HG=F", "Copper miners vs copper", "Miners leading the metal", "Miners lagging the metal"],
  ["XLU", "SPY", "Utilities vs market", "Defensive bid building", "Defensives being sold"],
  ["IVE", "IVW", "Large value vs large growth", "Value leading", "Growth leading"],
  ["IJS", "IVE", "Small value vs large value", "Value breadth widening down-cap", "Value concentrating in large caps"],
  ["SPY", "TLT", "Equities vs long Treasuries", "Equities preferred over duration", "Duration preferred over equities"],
  ["GLD", "STIP", "Gold vs short TIPS", "Gold outrunning real-rate protection", "Real-rate protection preferred"],
  ["LQD", "IEF", "Credit vs Treasuries", "Investment-grade risk rewarded", "Quality being favoured"],
];

/* ---- US equity internals ----------------------------------------------
   The size-and-style box: three capitalisation bands by three style tilts.
   Reading it as a grid rather than a list is the point — leadership usually
   travels along a row or a column, and that is the shape you want to see. */
const STYLE_BOX = {
  rows: [["Large", "IVE", "IVV", "IVW"],
         ["Mid", "IJJ", "IJH", "IJK"],
         ["Small", "IJS", "IJR", "IJT"]],
  cols: ["Value", "Blend", "Growth"],
};
/* Risk appetite read as sector pairs. Each is a cyclical leg over a defensive
   one, so all four rising together is a clean risk-on tape and a split is the
   more common, more informative case. */
const RISK_PAIRS = [
  ["XLY", "XLP", "Discretionary vs staples"],
  ["XLK", "XLU", "Technology vs utilities"],
  ["XLI", "XLV", "Industrials vs health care"],
  ["XLF", "XLU", "Financials vs utilities"],
];

/* The Economic Modern Family — a framework published by Mish Schneider of
   MarketGauge, which reads the economy through six sector ETFs, each standing
   for a different part of it. Implemented here from her public description;
   this is not affiliated with or endorsed by MarketGauge.
   Reference: https://marketgauge.com/modern-family/ */
const FAMILY = [
  ["IWM", "Grandpa Russell", "Small caps — the domestic economy and its access to credit"],
  ["XRT", "Granny Retail", "Retail — the consumer, who carries most of US demand"],
  ["KRE", "Prodigal Son", "Regional banks — credit creation, and the first to show stress"],
  ["IYT", "Tran", "Transportation — goods actually moving, the physical economy"],
  ["IBB", "Big Brother", "Biotech — speculative risk appetite at the frontier"],
  ["SMH", "Sister Semiconductors", "Semiconductors — innovation and the global capex cycle"],
  ["BTC-USD", "Cousin Crypto", "Bitcoin — the newest member, liquidity and speculative froth"],
];

// Trading-day windows. YTD is resolved against the calendar at render time.
const WINDOWS = [
  ["1W", 5], ["1M", 21], ["3M", 63], ["6M", 126], ["YTD", "ytd"], ["1Y", 252], ["2Y", 9999],
];
let RS_WINDOW = "3M";

// ------------------------------------------------------------------ helpers
const $ = (s, el) => (el || document).querySelector(s);
const NS = "http://www.w3.org/2000/svg";
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function el(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;   // never innerHTML with data
  return n;
}
const fmtNum = (v, d) => v == null || !isFinite(v) ? "–"
  : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const price = v => v == null ? "–" : fmtNum(v, Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 10 ? 2 : 3);
const pct = v => v == null ? "–" : (v > 0 ? "+" : "") + fmtNum(v, 1) + "%";
const bp = v => v == null ? "–" : (v > 0 ? "+" : "") + fmtNum(v, 0) + "bp";

// Axis labels for big series: 3,482,385 is wider than the gutter, 3.5M is not.
function compact(v, digits) {
  const a = Math.abs(v);
  if (a >= 1e12) return fmtNum(v / 1e12, 1) + "T";
  if (a >= 1e9) return fmtNum(v / 1e9, 1) + "B";
  if (a >= 1e6) return fmtNum(v / 1e6, 1) + "M";
  return fmtNum(v, digits);
}

/* Headline value for an official-flows series. The unit decides the scale:
   FRED reports these in millions of dollars, the World Bank in raw dollars,
   and treating one as the other is off by six orders of magnitude. */
function scaledValue(value, unit) {
  const u = unit || "";
  if (!/\$/.test(u)) return fmtNum(value, 2);
  const dollars = /\$bn/i.test(u) ? value * 1e9 : /\$m/i.test(u) ? value * 1e6 : value;
  const a = Math.abs(dollars);
  if (a >= 1e12) return "$" + fmtNum(dollars / 1e12, 2) + "tn";
  if (a >= 1e9) return "$" + fmtNum(dollars / 1e9, 1) + "bn";
  return "$" + fmtNum(dollars / 1e6, 0) + "m";
}

// ------------------------------------------------------------------- fetch
async function proxiedJson(url) {
  let lastErr;
  for (const wrap of PROXIES) {
    try {
      const r = await fetch(wrap(url), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("all proxies failed");
}

async function fetchSeries(symbols) {
  const chunks = [];
  for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK));
  const results = await Promise.all(chunks.map(async c => {
    try {
      // 2y of history so the 200-day average spans the whole 1y chart window.
      const url = SPARK + c.map(encodeURIComponent).join(",") + "&range=2y&interval=1d";
      return (await proxiedJson(url)).spark?.result || [];
    } catch { return []; }          // one bad chunk must not sink the page
  }));
  const out = {};
  for (const row of results.flat()) {
    const resp = row.response?.[0];
    const closes = resp?.indicators?.quote?.[0]?.close;
    const stamps = resp?.timestamp;
    if (!closes || !stamps) continue;
    const pts = [];
    for (let i = 0; i < stamps.length; i++) if (closes[i] != null) pts.push([stamps[i] * 1000, closes[i]]);
    if (pts.length) out[row.symbol] = pts;
  }
  return out;
}

// ------------------------------------------------------------------ metrics
function windowSlice(pts, spec) {
  if (spec === "ytd") {
    const y = new Date(pts[pts.length - 1][0]).getUTCFullYear();
    const i = pts.findIndex(p => new Date(p[0]).getUTCFullYear() === y);
    return i > 0 ? pts.slice(i - 1) : pts;      // include the prior close as the base
  }
  return pts.slice(-Math.min(spec, pts.length));
}

function metrics(pts, isYield) {
  const v = pts.map(p => p[1]);
  const last = v[v.length - 1];
  const back = n => v.length > n ? v[v.length - 1 - n] : null;
  const chg = n => {
    const p = back(n);
    if (!p) return null;
    return isYield ? (last - p) * 100 : (last / p - 1) * 100;
  };
  const yr = pts.slice(-252);
  const year = new Date(pts[pts.length - 1][0]).getUTCFullYear();
  const firstOfYear = pts.find(p => new Date(p[0]).getUTCFullYear() === year);
  const win = v.slice(-200);
  const ma200 = win.length >= 150 ? win.reduce((a, b) => a + b, 0) / win.length : null;
  const yv = yr.map(p => p[1]);
  const hi = Math.max(...yv), lo = Math.min(...yv);
  return {
    isYield, last, d1: chg(1), w1: chg(5), m1: chg(21), m3: chg(63),
    ytd: firstOfYear ? (isYield ? (last - firstOfYear[1]) * 100 : (last / firstOfYear[1] - 1) * 100) : null,
    ma200, aboveMa: ma200 == null ? null : last >= ma200,
    maGap: ma200 == null ? null : (last / ma200 - 1) * 100,
    hi, lo, rangePos: hi === lo ? 50 : ((last - lo) / (hi - lo)) * 100,
    asOf: pts[pts.length - 1][0],
  };
}

/* Aligned on calendar date rather than raw timestamp: futures and ETFs carry
   different session times, so an exact timestamp join silently produces no
   overlap at all for a pair like COPX / HG=F. */
function ratioSeries(a, b) {
  if (!a || !b) return null;
  const day = t => new Date(t).toISOString().slice(0, 10);
  const mb = new Map();
  for (const [t, v] of b) mb.set(day(t), v);
  const out = [];
  for (const [t, va] of a) {
    const vb = mb.get(day(t));
    if (vb) out.push([t, va / vb]);
  }
  return out.length > 30 ? out : null;
}

// Rolling sum: O(n) rather than O(n × period). With sixty charts each carrying
// three long averages, the naive version is the difference between 10s and 1s.
const sma = (pts, n) => {
  if (pts.length < n) return [];
  const out = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    s += pts[i][1];
    if (i >= n) s -= pts[i - n][1];
    if (i >= n - 1) out.push([pts[i][0], s / n]);
  }
  return out;
};
const ema = (pts, n) => {
  const k = 2 / (n + 1), out = [];
  let prev = pts[0][1];
  for (let i = 0; i < pts.length; i++) { prev = pts[i][1] * k + prev * (1 - k); out.push([pts[i][0], prev]); }
  return out.slice(n);
};

// ------------------------------------------------------------------ drawing
function sparkline(pts, w, hgt, colorVar) {
  const svg = el("svg", { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, "aria-hidden": "true" });
  const v = pts.map(p => p[1]);
  const lo = Math.min(...v), hi = Math.max(...v);
  const x = i => 1 + (i / (pts.length - 1)) * (w - 6);
  const y = val => hi === lo ? hgt / 2 : 2 + (1 - (val - lo) / (hi - lo)) * (hgt - 4);
  el("path", { d: pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p[1]).toFixed(1)).join(""),
    fill: "none", stroke: css(colorVar || "--baseline"), "stroke-width": 1.5,
    "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  el("circle", { cx: x(pts.length - 1), cy: y(v[v.length - 1]), r: 2.5, fill: css("--series-1"),
    stroke: css("--surface-1"), "stroke-width": 1.5 }, svg);
  return svg;
}

/* Line chart with optional overlays, crosshair tooltip and keyboard readout.
   `overlays` are [label, points, cssVar, width] drawn beneath the price line. */
function lineChart(pts, opts) {
  opts = opts || {};
  const W = 520, H = opts.tall ? 230 : 190, M = { t: 12, r: 12, b: 22, l: 48 };
  const box = h("div", "chart");
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, box);
  el("title", {}, svg).textContent = opts.title || "";

  const overlays = (opts.overlays || []).map(o => [o[0], o[1].filter(p => p[0] >= pts[0][0]), o[2], o[3]])
    .filter(o => o[1].length > 1);
  const all = pts.map(p => p[1]).concat(overlays.flatMap(o => o[1].map(p => p[1])));
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const x = t => M.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - M.l - M.r);
  const y = val => M.t + (1 - (val - lo) / (hi - lo)) * (H - M.t - M.b);
  const rng = hi - lo;
  const digits = rng >= 100 ? 0 : rng >= 5 ? 1 : rng >= 0.5 ? 2 : 3;

  const step0 = rng / 4, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => rng / s <= 4) || 10 * mag;
  for (let tv = Math.ceil(lo / step) * step; tv <= hi; tv += step) {
    el("line", { x1: M.l, x2: W - M.r, y1: y(tv), y2: y(tv), stroke: css("--grid"), "stroke-width": 1 }, svg);
    el("text", { x: M.l - 6, y: y(tv) + 3.5, "text-anchor": "end", "font-size": 10,
      fill: css("--text-muted"), style: "font-variant-numeric:tabular-nums" }, svg).textContent = compact(tv, digits);
  }
  /* Time axis: aim for about six labels whatever the span. Macro series run a
     decade and price series run months, so month ticks have to give way to year
     ticks or the labels collide into an unreadable smear. */
  const days = (t1 - t0) / 864e5;
  const d0 = new Date(t0);
  const ticks = [];
  if (days > 800) {
    const years = days / 365.25;
    const step = Math.max(1, Math.ceil(years / 6));
    for (let y = d0.getUTCFullYear() + 1; ; y++) {
      const dt = Date.UTC(y, 0, 1);
      if (dt > t1) break;
      if ((y - d0.getUTCFullYear()) % step === 0) ticks.push([dt, String(y)]);
    }
  } else {
    const months = days / 30.4;
    const step = Math.max(1, Math.round(months / 6));
    for (let m = 1; m <= 40; m++) {
      const dt = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1);
      if (dt > t1) break;
      if (m % step) continue;
      const d = new Date(dt);
      ticks.push([dt, days > 300
        ? d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })
        : d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })]);
    }
  }
  for (const [dt, label] of ticks) {
    el("text", { x: x(dt), y: H - 7, "text-anchor": "middle", "font-size": 10, fill: css("--text-muted") }, svg)
      .textContent = label;
  }
  el("line", { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, stroke: css("--baseline"), "stroke-width": 1 }, svg);

  for (const [, opts2, colorVar, width] of overlays) {
    el("path", { d: opts2.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join(""),
      fill: "none", stroke: css(colorVar), "stroke-width": width || 1.4, "stroke-linecap": "round" }, svg);
  }

  const line = pts.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join("");
  if (!opts.noFill) {
    el("path", { d: line + `L${x(t1).toFixed(1)} ${H - M.b}L${x(t0).toFixed(1)} ${H - M.b}Z`,
      fill: css("--series-1"), opacity: 0.09, stroke: "none" }, svg);
  }
  el("path", { d: line, fill: "none", stroke: css("--series-1"), "stroke-width": 2,
    "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  el("circle", { cx: x(t1), cy: y(pts[pts.length - 1][1]), r: 4, fill: css("--series-1"),
    stroke: css("--surface-1"), "stroke-width": 2 }, svg);

  const tip = h("div", "tooltip");
  box.appendChild(tip);
  const cross = el("line", { y1: M.t, y2: H - M.b, stroke: css("--baseline"), "stroke-width": 1, visibility: "hidden" }, svg);
  const dot = el("circle", { r: 4, fill: css("--series-1"), stroke: css("--surface-1"), "stroke-width": 2, visibility: "hidden" }, svg);
  function show(clientX) {
    const r = svg.getBoundingClientRect();
    const target = t0 + (((clientX - r.left) * (W / r.width) - M.l) / (W - M.l - M.r)) * (t1 - t0);
    let best = 0, bd = Infinity;
    pts.forEach((p, i) => { const dd = Math.abs(p[0] - target); if (dd < bd) { bd = dd; best = i; } });
    const p = pts[best];
    cross.setAttribute("x1", x(p[0])); cross.setAttribute("x2", x(p[0])); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", x(p[0])); dot.setAttribute("cy", y(p[1])); dot.setAttribute("visibility", "visible");
    tip.textContent = "";
    tip.appendChild(h("div", "tdate", new Date(p[0]).toISOString().slice(0, 10)));
    const row = h("div", "trow");
    row.appendChild(h("span", "tkey"));
    row.appendChild(h("span", "tval", fmtNum(p[1], digits)));
    row.appendChild(h("span", "tname", opts.unit || ""));
    tip.appendChild(row);
    for (const [label, series, colorVar] of overlays) {
      let nearest = null, nd = Infinity;
      for (const q of series) { const dd = Math.abs(q[0] - p[0]); if (dd < nd) { nd = dd; nearest = q; } }
      if (!nearest || nd > 5 * 864e5) continue;
      const r2 = h("div", "trow");
      const k = h("span", "tkey"); k.style.borderTopColor = css(colorVar); r2.appendChild(k);
      r2.appendChild(h("span", "tval", fmtNum(nearest[1], digits)));
      r2.appendChild(h("span", "tname", label));
      tip.appendChild(r2);
    }
    tip.style.display = "block";
    const bw = box.clientWidth;
    tip.style.left = Math.min(Math.max(0, (x(p[0]) / W) * bw + 10), Math.max(0, bw - tip.offsetWidth)) + "px";
    tip.style.top = "6px";
  }
  const hide = () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.style.display = "none"; };
  svg.addEventListener("pointermove", e => show(e.clientX));
  svg.addEventListener("pointerleave", hide);
  svg.setAttribute("tabindex", "0");
  let fi = null;
  svg.addEventListener("keydown", e => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    fi = fi === null ? pts.length - 1 : Math.max(0, Math.min(pts.length - 1, fi + (e.key === "ArrowRight" ? 1 : -1)));
    const r = svg.getBoundingClientRect();
    show(r.left + (x(pts[fi][0]) / W) * r.width);
  });
  svg.addEventListener("blur", () => { fi = null; hide(); });
  return box;
}

// -------------------------------------------------------------- components
function deltaEl(value, isYield) {
  const s = h("span", "delta", isYield ? bp(value) : pct(value));
  const flat = value == null || Math.abs(value) < (isYield ? 0.5 : 0.05);
  s.className = "delta " + (flat ? "flat" : value > 0 ? "up" : "down");
  return s;
}

/* A card with a front face and an info face. The [i] button turns the card
   over; the ↗ button opens the underlying source in a new tab. */
function makeCard(title, infoKey, sourceUrl, sourceLabel) {
  const card = h("div", "card");
  const inner = h("div", "card-inner");
  const front = h("div", "face front");
  const head = h("div", "card-head");
  head.appendChild(h("h3", null, title));
  const tools = h("div", "tools");
  const info = window.INFO && window.INFO[infoKey];
  if (info) {
    const b = h("button", "icon", "i");
    b.type = "button";
    b.title = "How this signal is read";
    b.setAttribute("aria-label", "How this signal is read: " + title);
    b.addEventListener("click", () => card.classList.add("flipped"));
    tools.appendChild(b);
  }
  if (sourceUrl) {
    const a = h("a", "icon", "↗");
    a.href = sourceUrl; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.title = "Open source" + (sourceLabel ? ": " + sourceLabel : "");
    a.setAttribute("aria-label", "Open source data for " + title);
    tools.appendChild(a);
  }
  head.appendChild(tools);
  front.appendChild(head);
  inner.appendChild(front);

  if (info) {
    const back = h("div", "face back");
    const bh = h("div", "card-head");
    bh.appendChild(h("h3", null, info.title));
    const close = h("button", "icon", "✕");
    close.type = "button";
    close.title = "Back to the chart";
    close.setAttribute("aria-label", "Back to the chart");
    close.addEventListener("click", () => card.classList.remove("flipped"));
    const bt = h("div", "tools"); bt.appendChild(close);
    bh.appendChild(bt);
    back.appendChild(bh);
    for (const para of info.body) back.appendChild(h("p", "ibody", para));
    inner.appendChild(back);
  }
  card.appendChild(inner);
  card.body = front;                       // callers append content here
  return card;
}

// -------------------------------------------------------------------- boot
let SERIES = {}, METRICS = {}, MACRO = null, CHARTS_BUILT = false;

async function load() {
  const status = $("#status");
  status.textContent = "Fetching live prices…";
  status.hidden = false;

  const macroP = fetch("data/macro.json?t=" + Date.now(), { cache: "no-store" })
    .then(r => r.ok ? r.json() : null).catch(() => null);
  macroP.then(m => { if (m) { MACRO = m; renderMacro(); renderOfficial(); } });
  // renderSentiment needs both MACRO (COT) and SERIES (VIX), so it runs after the join below.

  const [series, macro] = await Promise.all([
    fetchSeries(UNIVERSE.map(u => u[0])).catch(() => ({})),
    macroP,
  ]);
  SERIES = series; MACRO = macro;
  METRICS = {};
  const yields = new Set(UNIVERSE.filter(u => u[3] === "yield").map(u => u[0]));
  for (const s in series) METRICS[s] = metrics(series[s], yields.has(s));

  const live = Object.keys(series).length;
  if (!live) {
    status.textContent = "Live price feed unavailable right now. Showing official end-of-day macro data only — reload to retry.";
    $("#markets").hidden = true;
  } else {
    status.hidden = true;
    $("#markets").hidden = false;
  }
  CHARTS_BUILT = false;
  renderStamp(live);
  if (live) { renderRegime(); renderMovers(); renderFamily(); renderInternals(); renderCross(); renderRatios(); renderTables(); renderGroupJump(); renderRotationSnapshot(); renderSignals(); }
  renderMacro();
  renderOfficial();
  renderSentiment();
  renderSentiStrip();
  initScrollSpy();
  if (live && $("#tab-charts") && $("#tab-charts").getAttribute("aria-selected") === "true") buildCharts();
}

function renderStamp(live) {
  const t = new Date();
  const bits = [];
  if (live) {
    bits.push("Live prices fetched " + t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) +
      " · " + live + " instruments");
    const spy = METRICS.SPY || METRICS["^GSPC"];
    if (spy) bits.push("latest close " + new Date(spy.asOf).toISOString().slice(0, 10));
  }
  if (MACRO) bits.push("macro data " + MACRO.generated_at.slice(0, 10));
  $("#stamp").textContent = bits.join(" · ");
}

/* Evaluated at an offset in trading days, so the same function produces both
   today's regime and yesterday's — which is what makes "what flipped overnight"
   computable without storing any state between visits. */
function regimeChecks(off) {
  off = off || 0;
  const cut = pts => (off && pts && pts.length > off) ? pts.slice(0, pts.length - off) : pts;
  const checks = [];
  const add = (label, ok, detail) => checks.push({ label, ok, detail });
  const yields = new Set(["^TNX", "^TYX"]);
  const M = sym => {
    const p = cut(SERIES[sym]);
    return p && p.length > 210 ? metrics(p, yields.has(sym)) : null;
  };
  const ratio3m = (a, b) => {
    const r = ratioSeries(cut(SERIES[a]), cut(SERIES[b]));
    return r ? metrics(r) : null;
  };
  let m;
  if ((m = M("ACWI"))) add("Global equity above 200-day average", m.aboveMa, pct(m.maGap) + " vs 200d");
  if ((m = M("SPY"))) add("US equity above 200-day average", m.aboveMa, pct(m.maGap) + " vs 200d");
  if ((m = M("^VIX"))) add("Volatility subdued (VIX under 20)", m.last < 20, "VIX " + fmtNum(m.last, 1));

  // Credit: the option-adjusted spread itself, with HYG/IEF only as a fallback.
  const oas = MACRO && MACRO.series && MACRO.series.cr_hy_oas;
  if (oas && oas.points.length > 25) {
    const p = oas.points.slice(0, oas.points.length - Math.min(off, 2));
    const now = p[p.length - 1][1], prior = p[p.length - 22][1];
    add("Credit spreads not widening", now <= prior,
      fmtNum(now, 2) + "pp HY OAS, " + (now > prior ? "+" : "") + fmtNum(now - prior, 2) + " 1m");
  } else if ((m = ratio3m("HYG", "IEF"))) {
    add("Credit appetite improving (HYG/IEF)", m.m3 > 0, pct(m.m3) + " 3m");
  }
  if ((m = ratio3m("XLY", "XLP"))) add("Cyclicals leading defensives", m.m3 > 0, pct(m.m3) + " 3m");
  if ((m = ratio3m("HG=F", "GC=F"))) add("Copper outperforming gold", m.m3 > 0, pct(m.m3) + " 3m");
  const tnx = M("^TNX"), tyx = M("^TYX");
  if (tnx && tyx) add("Long end not inverted", tyx.last >= tnx.last,
    fmtNum(tyx.last - tnx.last, 2) + "pp 30y-10y");
  return checks;
}

function renderRegime() {
  if (!$("#regime")) return;
  const checks = regimeChecks();
  const on = checks.filter(c => c.ok).length;
  const box = $("#regime");
  box.textContent = "";
  const label = on >= 5 ? "Risk-on" : on >= 3 ? "Mixed" : "Risk-off";
  const cls = on >= 5 ? "on" : on >= 3 ? "mixed" : "off";

  const head = h("div", "regime-head " + cls);
  const top = h("div", "regime-top");
  const lt = h("div");
  lt.appendChild(h("div", "regime-label", label));
  lt.appendChild(h("div", "regime-score", on + " of " + checks.length + " risk conditions met"));
  top.appendChild(lt);
  const tools = h("div", "tools");
  const ib = h("button", "icon", "i");
  ib.type = "button"; ib.title = "How the regime score is built";
  ib.setAttribute("aria-label", "How the regime score is built");
  ib.addEventListener("click", () => $("#regime-info").hidden = !$("#regime-info").hidden);
  tools.appendChild(ib);
  top.appendChild(tools);
  head.appendChild(top);

  const eq = UNIVERSE.filter(u => ["us", "mag7", "global", "sector"].includes(u[2]) && METRICS[u[0]]);
  const above = eq.filter(u => METRICS[u[0]].aboveMa).length;
  if (eq.length) {
    const b = h("div", "breadth");
    const bar = h("div", "breadth-bar");
    const fill = h("div", "breadth-fill");
    fill.style.width = Math.round((above / eq.length) * 100) + "%";
    bar.appendChild(fill);
    b.appendChild(bar);
    b.appendChild(h("span", "breadth-text", above + " of " + eq.length + " markets above their 200-day average"));
    head.appendChild(b);
  }

  /* What changed since the previous close. Recomputed from the same series
     shifted a day, so it needs no stored state and is right on a first visit. */
  const prev = regimeChecks(1);
  const prevBy = new Map(prev.map(c => [c.label, c.ok]));
  const flips = checks.filter(c => prevBy.has(c.label) && prevBy.get(c.label) !== c.ok);
  const change = h("div", "regime-change");
  if (flips.length) {
    change.appendChild(h("span", "clabel", "Changed since yesterday"));
    for (const f of flips) {
      const t = h("span", "flip " + (f.ok ? "gained" : "lost"));
      t.appendChild(h("span", "fmark", f.ok ? "✓" : "✕"));
      t.appendChild(h("span", null, f.label));
      change.appendChild(t);
    }
  } else {
    change.appendChild(h("span", "clabel", "No conditions changed since yesterday"));
  }
  head.appendChild(change);
  box.appendChild(head);

  const list = h("div", "regime-list");
  for (const c of checks) {
    const flipped = prevBy.has(c.label) && prevBy.get(c.label) !== c.ok;
    const row = h("div", "regime-item " + (c.ok ? "yes" : "no") + (flipped ? " flipped-today" : ""));
    row.appendChild(h("span", "mark", c.ok ? "✓" : "✕"));
    const txt = h("span", "rtext");
    const lab = h("span", "rlabel");
    lab.appendChild(document.createTextNode(c.label));
    if (flipped) lab.appendChild(h("span", "newtag", "new"));
    txt.appendChild(lab);
    txt.appendChild(h("span", "rdetail", c.detail));
    row.appendChild(txt);
    list.appendChild(row);
  }
  box.appendChild(list);

  const panel = h("div", "infopanel");
  panel.id = "regime-info"; panel.hidden = true;
  for (const key of ["regime", "breadth"]) {
    const info = window.INFO[key];
    panel.appendChild(h("h4", null, info.title));
    for (const p of info.body) panel.appendChild(h("p", "ibody", p));
  }
  box.appendChild(panel);
}

function renderMovers() {
  if (!$("#movers")) return;
  const rows = UNIVERSE.filter(u => METRICS[u[0]] && METRICS[u[0]].d1 != null).map(u => {
    const m = METRICS[u[0]], pts = SERIES[u[0]];
    const rets = [];
    for (let i = Math.max(1, pts.length - 60); i < pts.length; i++) {
      const a = pts[i - 1][1], b = pts[i][1];
      if (a) rets.push(m.isYield ? (b - a) * 100 : (b / a - 1) * 100);
    }
    const mean = rets.reduce((x, y) => x + y, 0) / (rets.length || 1);
    const sd = Math.sqrt(rets.reduce((x, y) => x + (y - mean) ** 2, 0) / (rets.length || 1)) || 1;
    return { sym: u[0], name: u[1], m, sigma: m.d1 / sd };
  });
  rows.sort((a, b) => Math.abs(b.sigma) - Math.abs(a.sigma));
  const box = $("#movers");
  box.textContent = "";

  // One-line takeaway: the biggest move, how unusual, and any group concentration.
  const top7 = rows.slice(0, 7);
  if (top7.length) {
    const big = rows.filter(r => Math.abs(r.sigma) >= 2).length;
    const groupOf = sym => (UNIVERSE.find(u => u[0] === sym) || [])[2];
    const counts = {};
    top7.forEach(r => { const g = groupOf(r.sym); counts[g] = (counts[g] || 0) + 1; });
    const [gName, gCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const groupLabel = (GROUPS.find(g => g[0] === gName) || [null, gName])[1];
    const sum = h("p", "secsum");
    sum.appendChild(document.createTextNode("Biggest move: " + top7[0].name + " "));
    sum.appendChild(deltaEl(top7[0].m.d1, top7[0].m.isYield));
    sum.appendChild(document.createTextNode(" (" + fmtNum(Math.abs(top7[0].sigma), 1) + "σ). " +
      (big ? big + " move" + (big > 1 ? "s" : "") + " at 2σ or more." : "Nothing at 2σ — a quiet tape.") +
      (gCount >= 4 ? " " + gCount + " of 7 from " + groupLabel.toLowerCase() + " — a concentrated story." : "")));
    box.appendChild(sum);
  }
  for (const r of top7) {
    const t = h("a", "mover");
    t.href = YQ(r.sym); t.target = "_blank"; t.rel = "noopener noreferrer";
    t.appendChild(h("div", "mname", r.name));
    const d = deltaEl(r.m.d1, r.m.isYield);
    d.classList.add("mbig");
    t.appendChild(d);
    const sub = h("div", "msub");
    sub.appendChild(document.createTextNode(price(r.m.last) + " · "));
    sub.appendChild(h("span", Math.abs(r.sigma) >= 2 ? "sig" : null, fmtNum(Math.abs(r.sigma), 1) + "σ"));
    t.appendChild(sub);
    box.appendChild(t);
  }
}

/* ---- US equity internals: style box, risk appetite, breadth -------------
   Markets answers two questions since Countries took geography: what is the
   US equity market doing underneath the index, and what is moving across
   asset classes. This renders the first. */
function renderInternals() {
  const box = $("#internals");
  if (!box) return;
  box.textContent = "";
  const spec = WINDOWS.find(w => w[0] === RS_WINDOW)[1];
  const winRet = sym => {
    const s = SERIES[sym];
    if (!s || s.length < 3) return null;
    const view = windowSlice(s, spec);
    if (!view || view.length < 2) return null;
    return (view[view.length - 1][1] / view[0][1] - 1) * 100;
  };
  const spx = winRet("SPY");
  const label = (WINDOWS.find(w => w[0] === RS_WINDOW) || [null, null, RS_WINDOW])[2] || RS_WINDOW;

  // --- style box: 3 x 3, coloured by excess over SPY ---
  const sec = h("section", "intblock");
  const head = h("h3", null, "Size and style");
  head.appendChild(h("span", "intsub", "return over " + label + ", shaded by excess over SPY"));
  sec.appendChild(head);
  const grid = h("div", "stylebox");
  grid.appendChild(h("div", "sbcorner", ""));
  for (const c of STYLE_BOX.cols) grid.appendChild(h("div", "sbcol", c));
  for (const [rowName, ...syms] of STYLE_BOX.rows) {
    grid.appendChild(h("div", "sbrow", rowName));
    for (const sym of syms) {
      const v = winRet(sym);
      const cell = h("div", "sbcell");
      if (v == null) { cell.appendChild(h("div", "sbval", "–")); grid.appendChild(cell); continue; }
      const ex = spx == null ? null : v - spx;
      if (ex != null) {
        const a = Math.min(Math.abs(ex) / 8, 1) * 0.45;
        cell.setAttribute("style", "background:rgba(" +
          (ex >= 0 ? "12,163,12," : "208,59,59,") + a.toFixed(2) + ")");
      }
      cell.appendChild(h("div", "sbval", (v > 0 ? "+" : "") + fmtNum(v, 1) + "%"));
      cell.appendChild(h("div", "sbex", ex == null ? sym
        : sym + " · " + (ex > 0 ? "+" : "") + fmtNum(ex, 1) + " vs SPY"));
      grid.appendChild(cell);
    }
  }
  sec.appendChild(grid);
  // read the grid out loud: which row and which column is winning
  const rowAvg = STYLE_BOX.rows.map(([n, ...s]) => {
    const v = s.map(winRet).filter(x => x != null);
    return [n, v.length ? v.reduce((a, b) => a + b, 0) / v.length : null];
  }).filter(x => x[1] != null);
  const colAvg = STYLE_BOX.cols.map((c, i) => {
    const v = STYLE_BOX.rows.map(r => winRet(r[i + 1])).filter(x => x != null);
    return [c, v.length ? v.reduce((a, b) => a + b, 0) / v.length : null];
  }).filter(x => x[1] != null);
  if (rowAvg.length && colAvg.length) {
    const bestRow = rowAvg.slice().sort((a, b) => b[1] - a[1])[0];
    const worstRow = rowAvg.slice().sort((a, b) => a[1] - b[1])[0];
    const bestCol = colAvg.slice().sort((a, b) => b[1] - a[1])[0];
    sec.appendChild(h("p", "secsum",
      bestRow[0].toLowerCase() + " caps lead over " + label + " (" + fmtNum(bestRow[1], 1) + "%) and " +
      worstRow[0].toLowerCase() + " lag (" + fmtNum(worstRow[1], 1) + "%); " +
      bestCol[0].toLowerCase() + " is the winning tilt across sizes. " +
      (bestRow[0] === "Large" ? "Leadership is still up-cap — the index is carrying the market."
                              : "Leadership has moved down-cap, which is a broader tape.")));
  }
  box.appendChild(sec);

  // --- risk appetite: cyclical over defensive pairs ---
  const sec2 = h("section", "intblock");
  const head2 = h("h3", null, "Risk appetite");
  head2.appendChild(h("span", "intsub", "cyclical leg over defensive leg, " + label));
  sec2.appendChild(head2);
  const strip = h("div", "riskstrip");
  let on = 0, tot = 0;
  for (const [a, b, name] of RISK_PAIRS) {
    const va = winRet(a), vb = winRet(b);
    if (va == null || vb == null) continue;
    const sp = va - vb;
    tot++; if (sp > 0) on++;
    const card = h("div", "riskcard " + (sp > 0 ? "on" : "off"));
    card.appendChild(h("div", "rcname", name));
    card.appendChild(h("div", "rcval", (sp > 0 ? "+" : "") + fmtNum(sp, 1) + "pp"));
    card.appendChild(h("div", "rcsub", a + " " + (va > 0 ? "+" : "") + fmtNum(va, 1) +
      "% vs " + b + " " + (vb > 0 ? "+" : "") + fmtNum(vb, 1) + "%"));
    strip.appendChild(card);
  }
  sec2.appendChild(strip);
  if (tot) {
    sec2.appendChild(h("p", "secsum", on + " of " + tot + " cyclical-over-defensive pairs positive over " +
      label + " — " + (on === tot ? "a clean risk-on tape."
        : on === 0 ? "defensives are winning across the board, a risk-off tape."
        : "a split tape: risk appetite is selective, not general.")));
  }
  box.appendChild(sec2);

  // --- breadth: how much of the market is actually participating ---
  const eq = UNIVERSE.filter(u => ["us", "style", "sector", "mag7", "family"].includes(u[2]));
  const withMa = eq.map(u => METRICS[u[0]]).filter(m => m && m.aboveMa != null);
  if (withMa.length >= 10) {
    const above = withMa.filter(m => m.aboveMa).length;
    const share = Math.round(above / withMa.length * 100);
    const up1 = eq.map(u => METRICS[u[0]]).filter(m => m && m.d1 != null);
    const upToday = up1.filter(m => m.d1 > 0).length;
    const sec3 = h("section", "intblock");
    const head3 = h("h3", null, "Breadth");
    head3.appendChild(h("span", "intsub", "US equity instruments on this page"));
    sec3.appendChild(head3);
    const bs = h("div", "riskstrip");
    const mk = (name, val, sub, good) => {
      const c = h("div", "riskcard " + (good ? "on" : "off"));
      c.appendChild(h("div", "rcname", name));
      c.appendChild(h("div", "rcval", val));
      c.appendChild(h("div", "rcsub", sub));
      return c;
    };
    bs.appendChild(mk("Above the 200-day", share + "%", above + " of " + withMa.length, share >= 50));
    bs.appendChild(mk("Higher today", Math.round(upToday / up1.length * 100) + "%",
      upToday + " of " + up1.length, upToday * 2 >= up1.length));
    sec3.appendChild(bs);
    sec3.appendChild(h("p", "secsum", share >= 70
      ? "Broad participation — the trend is carried by the many, not the few."
      : share >= 40
        ? "Mixed participation: roughly half the market is above its own 200-day, so index strength is selective."
        : "Narrow participation — most instruments are below their 200-day, and the index is being held up by a few."));
    box.appendChild(sec3);
  }
}

/* ---- cross-asset map ----------------------------------------------------
   The second question Markets owns: what is driving what across asset
   classes. Each row pairs an official macro series (real yields, breakevens,
   credit, the curve) with the market that trades off it, and states the
   relationship in words rather than leaving the reader to infer it. */
const CROSS = [
  { macro: "us_real_10y", mkt: "GLD", name: "Real yields \u2192 gold",
    why: "Gold pays no coupon, so the real yield is its opportunity cost. Rising real yields are a headwind; gold rising anyway means something else is bidding it.",
    align: {
      upUp: "Real yields rising and gold rising anyway \u2014 gold is being bid for a reason other than rates.",
      upDown: "Real yields rising and gold falling \u2014 the textbook headwind, working as expected.",
      downUp: "Real yields falling with gold rising \u2014 the textbook tailwind.",
      downDown: "Real yields falling but gold soft \u2014 the tailwind is not being taken." } },
  { macro: "us_breakeven_10y", mkt: "CL=F", name: "Breakevens \u2192 oil",
    why: "Market-implied inflation and crude feed each other; energy is the largest single input to headline inflation expectations.",
    align: {
      upUp: "Breakevens and crude rising together \u2014 an inflation impulse with a real driver behind it.",
      upDown: "Breakevens rising without crude \u2014 inflation expectations building on something other than energy.",
      downUp: "Crude rising while breakevens ease \u2014 the market is reading it as supply, not inflation.",
      downDown: "Both easing \u2014 the inflation impulse is draining." } },
  { macro: "cr_hy_oas", mkt: "SPY", name: "Credit spreads \u2192 equity",
    why: "Credit usually cracks before equity does. Spreads widening while equity holds is the classic warning; the reverse is a healthy risk tape.",
    align: {
      upUp: "Spreads widening while equity rises \u2014 credit is not confirming the equity move.",
      upDown: "Spreads widening with equity falling \u2014 both markets derisking together.",
      downUp: "Spreads tightening with equity rising \u2014 risk appetite confirmed by both markets.",
      downDown: "Spreads tightening but equity soft \u2014 credit says the tape is fine." } },
  { macro: "us_yield_spread", mkt: "XLF", name: "Curve \u2192 banks",
    why: "Banks borrow short and lend long, so a steepening 2s10s curve widens net interest margin. Financials leading a steepening is the market pricing that through.",
    align: {
      upUp: "Curve steepening with financials leading \u2014 margin expansion being priced.",
      upDown: "Curve steepening but financials lagging \u2014 the market doubts banks capture it.",
      downUp: "Curve flattening while financials lead \u2014 leadership is coming from somewhere other than margin.",
      downDown: "Curve flattening with financials lagging \u2014 margin pressure being priced." } },
];

function renderCross() {
  const box = $("#crossasset");
  if (!box) return;
  box.textContent = "";
  const M = (MACRO && MACRO.series) || {};
  const chg = (pts, days) => {
    if (!pts || pts.length < 2) return null;
    const last = pts[pts.length - 1][1];
    const i = Math.max(0, pts.length - 1 - days);
    const base = pts[i][1];
    return { last, delta: last - base, pct: base ? (last / base - 1) * 100 : null };
  };
  const DAYS = 63;                    // about a quarter of trading
  let built = 0;
  for (const row of CROSS) {
    const ms = M[row.macro];
    const mpts = ms && (ms.points || ms.data);
    const mk = SERIES[row.mkt];
    if (!mpts || !mk) continue;
    const a = chg(mpts, Math.min(DAYS, mpts.length - 1));
    const b = chg(mk, Math.min(DAYS, mk.length - 1));
    if (!a || !b) continue;
    /* Keyed by the sign pair (macro leg, market leg) rather than by position:
       the four rows describe their combinations in different natural orders,
       and a positional lookup silently mismatched two of them. */
    const key = (a.delta >= 0 ? "up" : "down") + (b.pct >= 0 ? "Up" : "Down");
    const verdict = row.align[key] || "";
    const card = h("div", "crosscard");
    const hd = h("div", "chead");
    hd.appendChild(h("span", "cname", row.name));
    hd.appendChild(h("span", "cwin", "3-month"));
    card.appendChild(hd);
    const legs = h("div", "clegs");
    const leg = (label, val, up) => {
      const d = h("div", "cleg " + (up ? "up" : "down"));
      d.appendChild(h("span", "clabel", label));
      d.appendChild(h("span", "cval", val));
      return d;
    };
    legs.appendChild(leg(ms.label || row.macro,
      (a.delta > 0 ? "+" : "") + fmtNum(a.delta, 2) + (ms.unit === "pp" ? "pp" : "pp") +
      " → " + fmtNum(a.last, 2) + (ms.unit === "pp" ? "pp" : "%"), a.delta >= 0));
    legs.appendChild(leg(row.mkt, (b.pct > 0 ? "+" : "") + fmtNum(b.pct, 1) + "%", b.pct >= 0));
    card.appendChild(legs);
    card.appendChild(h("p", "cverdict", verdict));
    card.appendChild(h("p", "cwhy", row.why));
    box.appendChild(card);
    built++;
  }
  if (!built) box.appendChild(h("p", "muted", "Cross-asset pairs need the macro feed; it has not loaded."));
}

function renderRatios() {
  const box = $("#ratios");
  if (!box) return;
  box.textContent = "";
  const spec = WINDOWS.find(w => w[0] === RS_WINDOW)[1];
  for (const [a, b, question, upMeans, downMeans] of RATIOS) {
    const full = ratioSeries(SERIES[a], SERIES[b]);
    if (!full) continue;
    const view = windowSlice(full, spec);
    if (view.length < 3) continue;
    const change = (view[view.length - 1][1] / view[0][1] - 1) * 100;

    const card = makeCard(a + " / " + b, a + "/" + b, YQ(a), a + " on Yahoo Finance");
    const body = card.body;
    body.appendChild(h("p", "meta", question));
    const read = h("p", "latest");
    read.appendChild(h("strong", null, fmtNum(view[view.length - 1][1], 3)));
    read.appendChild(document.createTextNode("  "));
    read.appendChild(deltaEl(change));
    read.appendChild(document.createTextNode(" over " + RS_WINDOW));
    body.appendChild(read);
    const rising = change > 0;
    body.appendChild(h("p", "verdict " + (rising ? "up" : "down"),
      (rising ? "▲ " : "▼ ") + (rising ? upMeans : downMeans)));
    // The 200-day average is only meaningful once the window is long enough.
    const showMa = spec === 9999 || spec === "ytd" || spec >= 126;
    const overlays = showMa ? [["200d avg", sma(full, 200), "--text-muted", 1.5]] : [];
    body.appendChild(lineChart(view, { title: a + "/" + b, unit: "ratio", overlays }));
    box.appendChild(card);
  }
}

/* The framework's own question is whether the family is "in gear" — moving
   together — or split, so the summary leads with the count and names the
   laggards rather than showing seven charts and leaving you to compare them. */
function renderFamily() {
  const box = $("#family");
  if (!box) return;
  box.textContent = "";
  const rows = FAMILY.map(([sym, nick, role]) => {
    const m = METRICS[sym];
    if (!m) return null;
    const rel = ratioSeries(SERIES[sym], SERIES.SPY);
    return { sym, nick, role, m, rel3m: rel ? metrics(rel).m3 : null };
  }).filter(Boolean);
  if (!rows.length) return;

  const core = rows.filter(r => r.sym !== "BTC-USD");
  const up = core.filter(r => r.m.aboveMa).length;
  const laggards = core.filter(r => !r.m.aboveMa).map(r => r.nick);

  const head = h("div", "regime-head " + (up >= core.length - 1 ? "on" : up >= core.length / 2 ? "mixed" : "off"));
  const top = h("div", "regime-top");
  const lt = h("div");
  lt.appendChild(h("div", "regime-label", up + " of " + core.length + " in gear"));
  lt.appendChild(h("div", "regime-score", laggards.length
    ? "Out of gear: " + laggards.join(", ")
    : "Every member above its 200-day average"));
  top.appendChild(lt);
  const tools = h("div", "tools");
  const ib = h("button", "icon", "i");
  ib.type = "button"; ib.title = "About this framework";
  ib.setAttribute("aria-label", "About the Economic Modern Family framework");
  ib.addEventListener("click", () => { const p = $("#family-info"); p.hidden = !p.hidden; });
  tools.appendChild(ib);
  const a = h("a", "icon", "↗");
  a.href = "https://marketgauge.com/modern-family/";
  a.target = "_blank"; a.rel = "noopener noreferrer";
  a.title = "MarketGauge — the Economic Modern Family";
  tools.appendChild(a);
  top.appendChild(tools);
  head.appendChild(top);

  // Attribution stays visible rather than hidden behind the info button.
  const cred = h("div", "regime-change");
  cred.appendChild(h("span", "clabel",
    "Framework by Mish Schneider, MarketGauge · independent implementation, unaffiliated"));
  head.appendChild(cred);
  box.appendChild(head);

  const panel = h("div", "infopanel");
  panel.id = "family-info"; panel.hidden = true;
  for (const p of window.INFO.family.body) panel.appendChild(h("p", "ibody", p));
  box.appendChild(panel);

  /* Compact grid in the same vocabulary as the regime list. Full content per
     member is kept in the row; clicking a row opens its chart in one shared
     detail panel below rather than expanding inline. */
  const list = h("div", "family-list compact");
  const detail = h("div");
  detail.id = "family-detail";
  detail.hidden = true;
  let selected = null;
  const showDetail = (r, btn) => {
    if (selected === r.sym) {                 // second click closes
      selected = null; detail.hidden = true;
      list.querySelectorAll(".family-row").forEach(b => b.setAttribute("aria-expanded", "false"));
      return;
    }
    selected = r.sym;
    list.querySelectorAll(".family-row").forEach(b => b.setAttribute("aria-expanded", String(b === btn)));
    detail.hidden = false;
    detail.textContent = "";
    detail.appendChild(h("div", "dtitle", r.nick + " (" + r.sym + ") — 1y daily with 200-day average"));
    detail.appendChild(lineChart(SERIES[r.sym].slice(-252), {
      title: r.nick, noFill: true,
      overlays: [["SMA 200", sma(SERIES[r.sym], 200), "--text-secondary", 1.6]],
    }));
    const leg = h("div", "legend");
    [["Price", "--series-1"], ["SMA 200", "--text-secondary"]].forEach(([lb, v]) => {
      const k = h("span", "key");
      const sw = h("span", "swatch"); sw.style.borderTopColor = css(v);
      k.append(sw, h("span", null, lb));
      leg.appendChild(k);
    });
    detail.appendChild(leg);
    detail.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  };
  for (const r of rows) {
    const rowBtn = h("button", "family-row " + (r.m.aboveMa ? "yes" : "no"));
    rowBtn.type = "button";
    rowBtn.setAttribute("aria-expanded", "false");
    rowBtn.appendChild(h("span", "mark", r.m.aboveMa ? "✓" : "✕"));
    const txt = h("span", "rtext");
    const lab = h("span", "rlabel");
    lab.appendChild(document.createTextNode(r.nick));
    lab.appendChild(h("span", "tick", r.sym));
    txt.appendChild(lab);
    const bits = [(r.m.aboveMa ? "above" : "below") + " 200d by " + fmtNum(Math.abs(r.m.maGap), 1) + "%"];
    if (r.rel3m != null) bits.push((r.rel3m > 0 ? "+" : "−") + fmtNum(Math.abs(r.rel3m), 1) + "% vs SPY 3m");
    txt.appendChild(h("span", "rdetail", r.role));
    txt.appendChild(h("span", "rdetail", bits.join(" · ")));
    rowBtn.appendChild(txt);
    const right = h("span", "rowright");
    right.appendChild(deltaEl(r.m.d1));
    right.appendChild(h("span", "chev", "▾"));
    rowBtn.appendChild(right);
    rowBtn.addEventListener("click", () => showDetail(r, rowBtn));
    list.appendChild(rowBtn);
  }
  box.appendChild(list);
  box.appendChild(detail);
}

/* Overview-only compact form of the relative strength section: one row per
   ratio with its 1-month verdict, no charts. The full version lives on the
   Markets page. */
function renderRotationSnapshot() {
  const box = $("#rsnap");
  if (!box) return;
  box.textContent = "";
  const verdicts = [];
  const list = h("div", "rsnap-list");
  for (const [a, b, question, upMeans, downMeans] of RATIOS) {
    const full = ratioSeries(SERIES[a], SERIES[b]);
    if (!full) continue;
    const view = windowSlice(full, 21);
    if (view.length < 3) continue;
    const change = (view[view.length - 1][1] / view[0][1] - 1) * 100;
    const rising = change > 0;
    verdicts.push({ a, b, change, rising });
    const row = h("a", "rsnap-row");
    row.href = "markets.html#s-rs";
    row.appendChild(h("span", "mark " + (rising ? "up" : "down"), rising ? "▲" : "▼"));
    const txt = h("span", "rtext");
    txt.appendChild(h("span", "rlabel", rising ? upMeans : downMeans));
    txt.appendChild(h("span", "rdetail", a + "/" + b + " · " + question));
    row.appendChild(txt);
    const d = deltaEl(change);
    d.classList.add("rsnap-delta");
    row.appendChild(d);
    list.appendChild(row);
  }
  if (verdicts.length) {
    const biggest = [...verdicts].sort((x, y) => Math.abs(y.change) - Math.abs(x.change))[0];
    const rising = verdicts.filter(v => v.rising).length;
    box.appendChild(h("p", "secsum",
      rising + " of " + verdicts.length + " ratios rising over 1M. Biggest shift: " +
      biggest.a + "/" + biggest.b + " " + pct(biggest.change) + "."));
  }
  box.appendChild(list);
}

/* ---- cross detection --------------------------------------------------
   Five moving-average cross signals, ordered from slow to fast:
     price × SMA200   — regime change, the one the source report keys on
     SMA50 × SMA200   — golden/death cross; confirms late, whipsaws least
     price × SMA50    — swing-level trend break
     EMA21 × SMA50    — intermediate momentum turn
     EMA5  × EMA21    — short-term trigger; noisy, only meaningful with trend
   A cross that reverses again within the window is flagged as a whipsaw
   rather than hidden — a whipsawing signal is itself information. */
const CROSS_DEFS = [
  ["price-200", "price crossed the 200-day SMA", (P, S) => [P, S.s200]],
  ["50-200", "50-day crossed the 200-day (golden/death)", (P, S) => [S.s50, S.s200]],
  ["price-50", "price crossed the 50-day SMA", (P, S) => [P, S.s50]],
  ["21-50", "21-day EMA crossed the 50-day SMA", (P, S) => [S.e21, S.s50]],
  ["5-21", "5-day EMA crossed the 21-day EMA", (P, S) => [S.e5, S.e21]],
];

function crossEvents(pts, lookback) {
  lookback = lookback || 10;
  if (pts.length < 220) return [];
  const S = { s50: sma(pts, 50), s200: sma(pts, 200), e21: ema(pts, 21), e5: ema(pts, 5) };
  const events = [];
  for (const [key, label, pick] of CROSS_DEFS) {
    const [fast, slow] = pick(pts, S);
    const bySlow = new Map(slow.map(p => [p[0], p[1]]));
    const pair = fast.filter(p => bySlow.has(p[0])).map(p => [p[0], p[1] - bySlow.get(p[0])]);
    if (pair.length < lookback + 2) continue;
    const tail = pair.slice(-(lookback + 1));
    for (let i = 1; i < tail.length; i++) {
      const prev = tail[i - 1][1], now = tail[i][1];
      if (prev === 0 || now === 0 || (prev < 0) === (now < 0)) continue;
      const daysAgo = tail.length - 1 - i;
      // Whipsaw: does the sign flip back later inside the window?
      let whip = false;
      for (let k = i + 1; k < tail.length; k++) {
        if ((tail[k][1] < 0) !== (now < 0)) { whip = true; break; }
      }
      events.push({ key, label, bullish: now > 0, daysAgo, whip, when: tail[i][0] });
    }
  }
  return events;
}

/* Signal scan (Markets page): six columns reading left to right from
   short-term bullish through long-term bullish, then bearish in the same
   fast-to-slow order. ST = 5×21 and 21×50 EMA triggers; Swing = price×50;
   LT = price×200 and the 50×200 golden/death cross. */
function renderSignals() {
  const box = $("#signals");
  if (!box) return;
  box.textContent = "";
  const found = [];
  for (const [sym, name] of UNIVERSE) {
    if (!SERIES[sym]) continue;
    for (const ev of crossEvents(SERIES[sym])) found.push({ sym, name, ...ev });
  }
  if (!found.length) {
    box.appendChild(h("p", "muted", "No moving-average crosses in the last ten sessions."));
    return;
  }
  const bulls = found.filter(f => f.bullish && !f.whip).length;
  const bears = found.filter(f => !f.bullish && !f.whip).length;
  box.appendChild(h("p", "secsum",
    found.length + " crosses in the last 10 sessions — " + bulls + " bullish and " +
    bears + " bearish still standing" +
    (found.some(f => f.whip) ? ", " + found.filter(f => f.whip).length + " whipsawed" : "") + "."));
  const tierOf = f => CROSS_DEFS.findIndex(d => d[0] === f.key);
  box.appendChild(sigColumns(found.map(f => ({ ...f, tier: tierOf(f) }))));
}

/* Shared column builder for the signal scan. Expects events carrying
   {sym, name, tier (0 slow … 4 fast), bullish, whip, daysAgo}. */
function sigColumns(found) {
  const box = h("div");
    /* Columns are the escalation ladder, left to right: each step costs time
       and buys confidence. Price leads its own averages arithmetically, so a
       name normally lights up left first and works rightward — measured over
       5 years, price crosses the 200 before the 50/200 golden cross 100% of
       the time, by a median of 18 sessions. Bull block sits above bear. */
    const TIERS = [
      [4, "5 \u00d7 21", "EMA timing trigger"],
      [2, "price \u00d7 50", "swing trend break"],
      [3, "21 \u00d7 50", "intermediate turn"],
      [0, "price \u00d7 200", "regime change"],
      [1, "50 \u00d7 200", "golden / death"],
    ];
    for (const bullish of [true, false]) {
      const block = h("div", "sigblock " + (bullish ? "bull" : "bear"));
      const head = h("h3", null, bullish ? "\u25b2 Bullish crosses" : "\u25bc Bearish crosses");
      head.appendChild(h("span", "ladder", "earliest and noisiest on the left \u2192 latest and most reliable on the right"));
      block.appendChild(head);
      const grid = h("div", "sigcols");
      for (const [tier, label, sub] of TIERS) {
        const col = h("div", "sigcol " + (bullish ? "bull" : "bear"));
        col.appendChild(h("p", "tierhead", label));
        col.appendChild(h("p", "sigsub", sub));
        const mine = found.filter(f => f.bullish === bullish && f.tier === tier)
          .sort((a, b) => a.daysAgo - b.daysAgo);
        if (!mine.length) { col.appendChild(h("p", "signone", "none")); grid.appendChild(col); continue; }
        for (const f of mine) {
          const it = h("div", "sigitem");
          const a = h("a", null, f.name);
          a.href = YQ(f.sym); a.target = "_blank"; a.rel = "noopener noreferrer";
          it.appendChild(a);
          if (f.whip) it.appendChild(h("span", "whiptag", "whipsawed"));
          it.appendChild(h("span", "sighint", f.sym + " \u00b7 " +
            (f.daysAgo === 0 ? "latest close" : f.daysAgo + "d ago")));
          col.appendChild(it);
        }
        grid.appendChild(col);
      }
      block.appendChild(grid);
      box.appendChild(block);
    }
  return box;
}

function renderTables() {
  const box = $("#tables");
  if (!box) return;
  box.textContent = "";
  for (const [key, title] of GROUPS) {
    const rows = UNIVERSE.filter(u => u[2] === key && METRICS[u[0]]);
    if (!rows.length) continue;
    box.appendChild(h("h3", "tabletitle", title));
    const wrap = h("div", "tablewrap");
    const table = h("table", "mkt");
    const thead = h("thead"), hr = h("tr");
    ["Instrument", "Last", "1d", "1w", "1m", "3m", "YTD", "vs 200d", "52w range", "1y"].forEach((c, i) =>
      hr.appendChild(h("th", i === 0 ? "left" : null, c)));
    thead.appendChild(hr); table.appendChild(thead);
    const tb = h("tbody");
    for (const [sym, name] of rows) {
      const m = METRICS[sym];
      const tr = h("tr");
      const nameCell = h("td", "left");
      const link = h("a", "iname", name);
      link.href = YQ(sym); link.target = "_blank"; link.rel = "noopener noreferrer";
      nameCell.appendChild(link);
      nameCell.appendChild(h("span", "isym", sym));
      tr.appendChild(nameCell);
      tr.appendChild(h("td", "num", price(m.last)));
      [m.d1, m.w1, m.m1, m.m3, m.ytd].forEach(v => {
        const td = h("td", "num"); td.appendChild(deltaEl(v, m.isYield)); tr.appendChild(td);
      });
      const ma = h("td", "num");
      if (m.aboveMa == null) ma.textContent = "–";
      else ma.appendChild(h("span", "trend " + (m.aboveMa ? "up" : "down"),
        (m.aboveMa ? "above " : "below ") + pct(m.maGap).replace("+", "")));
      tr.appendChild(ma);
      const rng = h("td", "num"); rng.appendChild(rangeBar(m)); tr.appendChild(rng);
      const sp = h("td", "num");
      sp.appendChild(sparkline(SERIES[sym], 70, 22, m.aboveMa ? "--series-1" : "--text-muted"));
      tr.appendChild(sp);
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    wrap.appendChild(table);
    box.appendChild(wrap);
  }
}

/* Markets → Charts tab. One 1-year daily chart per instrument with SMA 200/150/50
   and EMA 21. Built on first view and rendered lazily as cards scroll in, since
   sixty charts at once is a lot of SVG. */
function buildCharts() {
  if (CHARTS_BUILT || !$("#charts")) return;
  const box = $("#charts");
  box.textContent = "";
  const pending = [];
  for (const [key, title] of GROUPS) {
    const rows = UNIVERSE.filter(u => u[2] === key && SERIES[u[0]]);
    if (!rows.length) continue;
    box.appendChild(h("h3", "tabletitle", title));
    const grid = h("div", "grid");
    for (const [sym, name] of rows) {
      const card = makeCard(name, key === "mag7" ? "mag7" : "movingAverages", YQ(sym), sym + " on Yahoo Finance");
      const m = METRICS[sym];
      const meta = h("p", "meta", sym);
      card.body.appendChild(meta);
      const read = h("p", "latest");
      read.appendChild(h("strong", null, price(m.last)));
      read.appendChild(document.createTextNode("  "));
      read.appendChild(deltaEl(m.d1, m.isYield));
      read.appendChild(document.createTextNode(" today"));
      card.body.appendChild(read);
      const slot = h("div", "chartslot");
      card.body.appendChild(slot);
      pending.push([slot, sym]);
      grid.appendChild(card);
    }
    box.appendChild(grid);
  }
  const draw = slotSym => {
    const [slot, sym] = slotSym;
    if (slot.dataset.done) return;
    slot.dataset.done = "1";
    const full = SERIES[sym];
    const view = full.slice(-252);
    slot.appendChild(lineChart(view, {
      title: sym, tall: true, noFill: true,
      overlays: [
        ["EMA 21", ema(full, 21), "--series-2", 1.3],
        ["SMA 50", sma(full, 50), "--series-3", 1.3],
        ["SMA 150", sma(full, 150), "--ma150", 1.3],
        ["SMA 200", sma(full, 200), "--text-secondary", 1.7],
      ],
    }));
    const legend = h("div", "legend");
    [["Price", "--series-1"], ["EMA 21", "--series-2"], ["SMA 50", "--series-3"],
     ["SMA 150", "--ma150"], ["SMA 200", "--text-secondary"]].forEach(([lab, v]) => {
      const k = h("span", "key");
      const sw = h("span", "swatch"); sw.style.borderTopColor = css(v);
      k.appendChild(sw); k.appendChild(h("span", null, lab));
      legend.appendChild(k);
    });
    slot.appendChild(legend);
  };
  /* Drawn synchronously. Deferred schemes were tried and rejected: scroll-based
     lazy loading renders nothing where the viewport measures zero height, and
     rAF batching stalls outright in a background tab. With the rolling-sum
     averages the whole set costs a few tens of milliseconds, so the simple
     thing is also the correct one. */
  pending.forEach(draw);
  CHARTS_BUILT = true;
}

function rangeBar(m) {
  const w = 74, hgt = 16;
  const svg = el("svg", { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, role: "img" });
  el("title", {}, svg).textContent =
    `52-week range ${price(m.lo)} to ${price(m.hi)}; now ${Math.round(m.rangePos)}% of the way up`;
  el("line", { x1: 3, x2: w - 3, y1: hgt / 2, y2: hgt / 2, stroke: css("--grid"), "stroke-width": 4, "stroke-linecap": "round" }, svg);
  el("circle", { cx: 3 + (m.rangePos / 100) * (w - 6), cy: hgt / 2, r: 4,
    fill: css(m.rangePos >= 50 ? "--series-1" : "--series-2"), stroke: css("--surface-1"), "stroke-width": 2 }, svg);
  return svg;
}

/* Sentiment: positioning-based reads, not surveys. Smart and dumb money come
   from CFTC COT data (weekly); the volatility term structure is computed live
   from VIX and VIX3M. Each card names the conventional reading and its limits. */
/* The headline strip is shared: the overview shows it alone, the macro page
   shows it above the full history charts. */
function buildSentiStrip() {
  const strip = h("div", "senti-strip");
  const addPill = (label, value, tone, detail) => {
    const p = h("div", "senti-pill " + tone);
    p.appendChild(h("div", "sp-label", label));
    p.appendChild(h("div", "sp-value", value));
    p.appendChild(h("div", "sp-detail", detail));
    strip.appendChild(p);
  };

  const cot = k => MACRO && MACRO.series && MACRO.series[k];
  const sc = cot("cot_commercial"), sd = cot("cot_small");
  if (sc && sc.points.length > 52) {
    const v = sc.points[sc.points.length - 1][1];
    const hist = sc.points.map(p => p[1]);
    const rank = hist.filter(x => x <= v).length / hist.length * 100;
    addPill("Smart money (hedgers)", fmtNum(v, 1) + "% of OI",
      rank >= 70 ? "good" : rank <= 30 ? "bad" : "neutral",
      Math.round(rank) + "th percentile of 5y — " + (rank >= 70 ? "unusually long" : rank <= 30 ? "unusually short" : "mid-range"));
  }
  if (sd && sd.points.length > 52) {
    const v = sd.points[sd.points.length - 1][1];
    const hist = sd.points.map(p => p[1]);
    const rank = hist.filter(x => x <= v).length / hist.length * 100;
    // For dumb money, crowded-long is the warning state.
    addPill("Dumb money (small specs)", fmtNum(v, 1) + "% of OI",
      rank >= 80 ? "bad" : rank <= 25 ? "good" : "neutral",
      Math.round(rank) + "th percentile of 5y — " + (rank >= 80 ? "crowded long" : rank <= 25 ? "washed out" : "mid-range"));
  }
  const vix = METRICS["^VIX"], vix3 = METRICS["^VIX3M"];
  if (vix && vix3 && vix.last) {
    const ts = vix3.last / vix.last;
    addPill("Vol term structure", fmtNum(ts, 2) + "×",
      ts >= 1.1 ? "good" : ts < 1 ? "bad" : "neutral",
      ts < 1 ? "inverted — spot fear exceeds 3-month, stress regime"
        : ts >= 1.1 ? "steep contango — complacent-to-calm"
        : "flat — watchful");
  }
  return strip.children.length ? strip : null;
}

function renderSentiStrip() {
  const host = $("#senti-strip");
  if (!host) return;
  host.textContent = "";
  const strip = buildSentiStrip();
  if (strip) host.appendChild(strip);
}

function renderSentiment() {
  const box = $("#sentiment");
  if (!box) return;
  box.textContent = "";
  const strip = buildSentiStrip();
  if (strip) box.appendChild(strip);
  const cot = k => MACRO && MACRO.series && MACRO.series[k];

  // Charts: the two COT series with 5y history, and the VIX3M/VIX ratio.
  const grid = h("div", "grid");
  const mk = (id, title) => {
    const s = cot(id);
    if (!s) return;
    const pts = s.points.map(p => [new Date(p[0]).getTime(), p[1]]);
    const card = makeCard(title, id, s.source_url, s.source);
    card.body.appendChild(h("p", "meta", s.unit + " · " + s.freq + " · " + s.source));
    const read = h("p", "latest");
    read.appendChild(h("strong", null, fmtNum(s.points[s.points.length - 1][1], 1) + "%"));
    read.appendChild(document.createTextNode(" (" + s.points[s.points.length - 1][0] + ")"));
    card.body.appendChild(read);
    card.body.appendChild(lineChart(pts, { title, unit: s.unit }));
    grid.appendChild(card);
  };
  mk("cot_commercial", "Smart money: commercial hedgers");
  mk("cot_small", "Dumb money: small speculators");

  const rv = ratioSeries(SERIES["^VIX3M"], SERIES["^VIX"]);
  if (rv) {
    const card = makeCard("VIX term structure (3m / spot)", "vix_term", YQ("^VIX"), "VIX on Yahoo Finance");
    card.body.appendChild(h("p", "meta", "ratio · daily · Cboe via Yahoo"));
    const read = h("p", "latest");
    read.appendChild(h("strong", null, fmtNum(rv[rv.length - 1][1], 2) + "×"));
    read.appendChild(document.createTextNode(" — below 1.0 is inversion"));
    card.body.appendChild(read);
    card.body.appendChild(lineChart(rv.slice(-252), { title: "VIX3M/VIX", unit: "ratio" }));
    grid.appendChild(card);
  }
  box.appendChild(grid);
}

/* Official flows: who is buying Treasuries, how auctions are clearing, and what
   the big reserve managers hold. Built from the same macro.json as the
   fundamentals below, just grouped separately because it answers its own
   question — official demand, rather than the state of the economy. */
function renderOfficial() {
  const box = $("#official");
  if (!box) return;
  box.textContent = "";
  if (!MACRO) return;
  const PICKS = [
    ["cb_foreign_custody", "Foreign official Treasuries held at the Fed"],
    ["cb_fed_treasuries", "Fed Treasury holdings (QT pace)"],
    ["cb_foreign_held", "Federal debt held by foreign investors"],
    ["auc_ind_10y", "10-year auction: indirect bidders"],
    ["auc_ind_30y", "30-year auction: indirect bidders"],
    ["auc_btc_2y", "2-year auction bid-to-cover"],
    ["auc_btc_5y", "5-year auction bid-to-cover"],
    ["auc_btc_10y", "10-year auction bid-to-cover"],
    ["auc_btc_30y", "30-year auction bid-to-cover"],
    ["res_cn_gold", "China: gold in reserves"],
    ["res_jp_gold", "Japan: gold in reserves"],
    ["res_china", "China FX reserves"],
    ["res_japan", "Japan FX reserves"],
    ["res_uk", "UK FX reserves"],
    ["res_euro", "Euro area total reserves"],
  ];
  for (const [id, title] of PICKS) {
    const s = MACRO.series[id];
    if (!s || !s.points.length) continue;
    const pts = s.points.map(p => [
      new Date(p[0].length === 4 ? p[0] + "-06-30" : p[0].length === 7 ? p[0] + "-15" : p[0]).getTime(),
      p[1],
    ]).slice(-160);
    // Several series share one note (all four bid-to-cover tenors, all reserves).
    const infoKey = id.startsWith("auc_btc_") ? "auc_btc_10y"
      : id.startsWith("auc_ind_") ? "auc_ind_10y"
      : id.endsWith("_gold") ? "res_cn_gold"
      : id.startsWith("res_") ? "res_china" : id;
    const card = makeCard(title, infoKey, s.source_url, s.source);
    card.body.appendChild(h("p", "meta", s.unit + " · " + s.freq + " · " + s.source));
    const last = s.points[s.points.length - 1];
    const read = h("p", "latest");
    read.appendChild(h("strong", null, scaledValue(last[1], s.unit)));
    read.appendChild(document.createTextNode(" (" + last[0] + ")"));
    if (s.points.length > 2) {
      const prev = s.points[s.points.length - 2][1];
      read.appendChild(document.createTextNode("  "));
      read.appendChild(deltaEl(prev ? (last[1] / prev - 1) * 100 : null));
    }
    card.body.appendChild(read);
    card.body.appendChild(lineChart(pts, { title, unit: s.unit }));
    box.appendChild(card);
  }
}

function renderMacro() {
  const box = $("#macro");
  if (!box) return;
  box.textContent = "";
  if (!MACRO) { box.appendChild(h("p", "muted", "Official macro data unavailable.")); return; }
  const PICKS = [
    ["us_cpi_yoy", "US CPI inflation"], ["us_unemployment", "US unemployment"],
    ["us_gdp_growth", "US real GDP growth"], ["us_payrolls_chg", "US payrolls change"],
    ["us_fed_funds", "Fed funds target"], ["ea_hicp_yoy", "Euro area inflation"],
    ["ea_depo_rate", "ECB deposit rate"], ["us_yield_spread", "10y minus 2y spread"],
    ["cr_hy_oas", "US high yield spread"], ["cr_ig_oas", "US investment grade spread"],
    ["de_bund_10y", "German 10-year bund yield"], ["cmd_nickel", "Nickel"],
  ];
  for (const [id, title] of PICKS) {
    const s = MACRO.series[id];
    if (!s) continue;
    const pts = s.points.map(p => [new Date(p[0].length === 7 ? p[0] + "-15" : p[0]).getTime(), p[1]]).slice(-140);
    const card = makeCard(title, id, s.source_url, s.source);
    card.body.appendChild(h("p", "meta", s.unit + " · " + s.source));
    const read = h("p", "latest");
    read.appendChild(h("strong", null, fmtNum(s.points[s.points.length - 1][1], 2)));
    read.appendChild(document.createTextNode(" (" + s.points[s.points.length - 1][0] + ")"));
    card.body.appendChild(read);
    card.body.appendChild(lineChart(pts, { title, unit: s.unit }));
    box.appendChild(card);
  }
}

// ------------------------------------------------------------------- wiring
(function initWindows() {
  const box = $("#rswindows");
  if (!box) return;
  for (const [label] of WINDOWS) {
    const b = h("button", "rangebtn", label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(label === RS_WINDOW));
    b.addEventListener("click", () => {
      RS_WINDOW = label;
      [...box.children].forEach(c => c.setAttribute("aria-pressed", String(c === b)));
      renderRatios();
    });
    box.appendChild(b);
  }
})();

/* Category jumps inside Markets, rebuilt per view so the anchors always point
   at whichever of the two panels is showing. */
function renderGroupJump() {
  const nav = $("#groupjump");
  if (!nav) return;
  nav.textContent = "";
  const charts = $("#tab-charts").getAttribute("aria-selected") === "true";
  const host = charts ? $("#charts") : $("#tables");
  const titles = [...host.querySelectorAll(".tabletitle")];
  titles.forEach((t, i) => {
    const id = (charts ? "c-" : "t-") + i;
    t.id = id;
    const a = h("a", null, t.textContent);
    a.href = "#" + id;
    nav.appendChild(a);
  });
}

/* Scroll-spy for the sticky nav: highlights the section you are actually in,
   so the bar doubles as a position indicator rather than only a jump list. */
function initScrollSpy() {
  const links = [...document.querySelectorAll("#jump a")];
  const mark = () => {
    let current = links[0];
    for (const a of links) {
      const t = document.getElementById(a.getAttribute("href").slice(1));
      if (t && t.getBoundingClientRect().top <= 90) current = a;
    }
    links.forEach(a => a.classList.toggle("here", a === current));
  };
  let ticking = false;
  addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { mark(); ticking = false; });
  }, { passive: true });
  mark();
}

/* Browsers drop a smooth scroll entirely when prefers-reduced-motion is set,
   so asking for "smooth" unconditionally means the shortcut does nothing at all
   for anyone using that setting. Honour the preference instead. */
function scrollToEl(target) {
  if (!target) return;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

// Number keys jump between sections; t and c switch the Markets view.
addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = (e.target && e.target.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || (e.target && e.target.isContentEditable)) return;
  const link = document.querySelector('#jump a[data-key="' + e.key + '"]');
  if (link) {
    e.preventDefault();
    scrollToEl(document.getElementById(link.getAttribute("href").slice(1)));
    return;
  }
  if (e.key === "t" || e.key === "c") {
    e.preventDefault();
    selectTab(e.key === "c" ? "charts" : "table");
    scrollToEl($("#s-markets"));
  }
});

function selectTab(which) {
  if (!$("#tab-table")) return;
  const isCharts = which === "charts";
  $("#tab-table").setAttribute("aria-selected", String(!isCharts));
  $("#tab-charts").setAttribute("aria-selected", String(isCharts));
  $("#tables").hidden = isCharts;
  $("#charts").hidden = !isCharts;
  if (isCharts) buildCharts();
  renderGroupJump();
}
// Floating back-to-top: appears after two screens of scroll, honours reduced motion.
(function initToTop() {
  const b = h("button", null, "↑");
  b.id = "totop"; b.type = "button"; b.title = "Back to top";
  b.setAttribute("aria-label", "Back to top");
  b.addEventListener("click", () => window.scrollTo({ top: 0,
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
  document.body.appendChild(b);
  // A plain class toggle is cheap; rAF throttling here would stall in
  // background tabs (same failure mode as the chart batching, learned once).
  addEventListener("scroll", () => b.classList.toggle("show", window.scrollY > 900), { passive: true });
})();

if ($("#tab-table")) $("#tab-table").addEventListener("click", () => selectTab("table"));
if ($("#tab-charts")) $("#tab-charts").addEventListener("click", () => selectTab("charts"));
if ($("#refresh")) $("#refresh").addEventListener("click", () => load());
load();
