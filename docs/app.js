"use strict";
/* Macro Compass — morning read.
   Live prices come from Yahoo Finance on every page load, via a keyless CORS
   proxy (a static page cannot call Yahoo directly — no CORS header). Official
   macro fundamentals come from data/macro.json, refreshed hourly by CI, which
   also serves as the floor if the live feed is unavailable. */

// ---------------------------------------------------------------- constants
const PROXIES = [
  u => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  u => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
];
const SPARK = "https://query1.finance.yahoo.com/v7/finance/spark?symbols=";
const CHUNK = 10;               // Yahoo 400s on much more than this
const GROUPS = [
  ["us", "US equity"],
  ["global", "Global & regional equity"],
  ["europe", "Europe"],
  ["asia", "Asia-Pacific & EM"],
  ["sector", "Sectors"],
  ["commodities", "Commodities"],
  ["rates", "Rates & credit"],
  ["fx", "FX & volatility"],
];

// symbol, display name, group. Mirrors the instruments in the Aug 1 report.
const UNIVERSE = [
  ["^GSPC", "S&P 500", "us"],
  ["^IXIC", "Nasdaq Composite", "us"],
  ["^RUT", "Russell 2000", "us"],
  ["DIA", "Dow Jones (DIA)", "us"],
  ["SPY", "S&P 500 (SPY)", "us"],
  ["QQQ", "Nasdaq 100 (QQQ)", "us"],
  ["IWM", "Russell 2000 (IWM)", "us"],
  ["ACWI", "MSCI ACWI", "global"],
  ["EEM", "Emerging markets", "global"],
  ["EFA", "Developed ex-US", "global"],
  ["ILF", "Latin America 40", "global"],
  ["^GSPTSE", "Canada TSX", "global"],
  ["^STOXX50E", "Euro Stoxx 50", "europe"],
  ["^GDAXI", "Germany DAX", "europe"],
  ["^FCHI", "France CAC 40", "europe"],
  ["FTSEMIB.MI", "Italy FTSE MIB", "europe"],
  ["^IBEX", "Spain IBEX 35", "europe"],
  ["EWU", "UK (EWU)", "europe"],
  ["EZU", "Eurozone (EZU)", "europe"],
  ["^N225", "Japan Nikkei 225", "asia"],
  ["^AXJO", "Australia ASX 200", "asia"],
  ["000016.SS", "China SSE 50", "asia"],
  ["CQQQ", "China tech (CQQQ)", "asia"],
  ["^BSESN", "India Sensex", "asia"],
  ["^NSEI", "India Nifty 50", "asia"],
  ["XU100.IS", "Turkey BIST 100", "asia"],
  ["TUR", "Turkey (TUR)", "asia"],
  ["IXG", "Global financials", "sector"],
  ["XLF", "US financials", "sector"],
  ["SMH", "Semiconductors", "sector"],
  ["XLY", "Consumer discretionary", "sector"],
  ["XLP", "Consumer staples", "sector"],
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
];

/* Relative strength. Each ratio answers one positioning question, and `up`
   names what a rising line means — the label does the interpreting, so the
   reader never has to remember which direction is bullish. */
const RATIOS = [
  ["QQQ", "SPY", "Growth vs broad market", "Growth leading", "Growth lagging"],
  ["IWM", "SPY", "Small vs large cap", "Small caps leading", "Large caps leading"],
  ["QQQ", "IWM", "Nasdaq vs Russell 2000", "Mega-cap tech leading", "Small caps leading"],
  ["EEM", "SPY", "Emerging vs US", "EM leading", "US leading"],
  ["EFA", "SPY", "Developed ex-US vs US", "Ex-US leading", "US leading"],
  ["XLY", "XLP", "Cyclical vs defensive", "Risk appetite rising", "Defensives bid, risk appetite falling"],
  ["HYG", "IEF", "High yield vs Treasuries", "Credit risk appetite rising", "Credit risk appetite falling"],
  ["HG=F", "GC=F", "Copper vs gold", "Growth expectations over fear", "Fear over growth expectations"],
  ["SMH", "SPY", "Semis vs market", "Semis leading", "Semis lagging"],
  ["SPY", "GLD", "Equities vs gold", "Equities preferred over gold", "Gold preferred over equities"],
];

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
    } catch { return []; }        // one bad chunk must not sink the page
  }));
  const out = {};
  for (const row of results.flat()) {
    const resp = row.response?.[0];
    const closes = resp?.indicators?.quote?.[0]?.close;
    const stamps = resp?.timestamp;
    if (!closes || !stamps) continue;
    const pts = [];
    for (let i = 0; i < stamps.length; i++) {
      if (closes[i] != null) pts.push([stamps[i] * 1000, closes[i]]);
    }
    if (pts.length) out[row.symbol] = pts;
  }
  return out;
}

// ------------------------------------------------------------------ metrics
/* `pts` is the full 2-year series. Returns and the 52-week range are measured
   over the trailing year; the 200-day average uses the longer history so it is
   a true 200-day mean rather than whatever fits the chart. `isYield` switches
   the change unit to basis points, which is how rates are actually read. */
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
    isYield, last, prev: back(1),
    d1: chg(1), w1: chg(5), m1: chg(21), m3: chg(63),
    ytd: firstOfYear ? (isYield ? (last - firstOfYear[1]) * 100 : (last / firstOfYear[1] - 1) * 100) : null,
    ma200, aboveMa: ma200 == null ? null : last >= ma200,
    maGap: ma200 == null ? null : (last / ma200 - 1) * 100,
    hi, lo, rangePos: hi === lo ? 50 : ((last - lo) / (hi - lo)) * 100,
    asOf: pts[pts.length - 1][0],
  };
}

// Align two series on shared timestamps, then divide.
function ratioSeries(a, b) {
  if (!a || !b) return null;
  const mb = new Map(b);
  const out = [];
  for (const [t, va] of a) {
    const vb = mb.get(t);
    if (vb) out.push([t, va / vb]);
  }
  return out.length > 30 ? out : null;
}

// ------------------------------------------------------------------ drawing
function sparkline(pts, w, hgt, colorVar) {
  const svg = el("svg", { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, "aria-hidden": "true" });
  const v = pts.map(p => p[1]);
  const lo = Math.min(...v), hi = Math.max(...v);
  const x = i => 1 + (i / (pts.length - 1)) * (w - 6);
  const y = val => hi === lo ? hgt / 2 : 2 + (1 - (val - lo) / (hi - lo)) * (hgt - 4);
  const d = pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p[1]).toFixed(1)).join("");
  el("path", { d, fill: "none", stroke: css(colorVar || "--baseline"), "stroke-width": 1.5,
    "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  const lastX = x(pts.length - 1), lastY = y(v[v.length - 1]);
  el("circle", { cx: lastX, cy: lastY, r: 2.5, fill: css("--series-1"),
    stroke: css("--surface-1"), "stroke-width": 1.5 }, svg);
  return svg;
}

/* Line chart with a 200-day average, crosshair tooltip and keyboard readout.
   Used for ratio cards and the macro fundamentals. */
function lineChart(fullPts, opts) {
  opts = opts || {};
  // Draw a window of the series, but keep the full history for the average.
  const pts = opts.visible ? fullPts.slice(-opts.visible) : fullPts;
  const W = 520, H = 190, M = { t: 12, r: 12, b: 22, l: 46 };
  const box = h("div", "chart");
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" }, box);
  el("title", {}, svg).textContent = opts.title || "";

  const v = pts.map(p => p[1]);
  let lo = Math.min(...v), hi = Math.max(...v);
  const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
  const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const x = t => M.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - M.l - M.r);
  const y = val => M.t + (1 - (val - lo) / (hi - lo)) * (H - M.t - M.b);
  const digits = (hi - lo) >= 100 ? 0 : (hi - lo) >= 5 ? 1 : 3;

  // ticks
  const span = hi - lo, step0 = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= 4) || 10 * mag;
  for (let tv = Math.ceil(lo / step) * step; tv <= hi; tv += step) {
    el("line", { x1: M.l, x2: W - M.r, y1: y(tv), y2: y(tv), stroke: css("--grid"), "stroke-width": 1 }, svg);
    el("text", { x: M.l - 6, y: y(tv) + 3.5, "text-anchor": "end", "font-size": 10,
      fill: css("--text-muted"), style: "font-variant-numeric:tabular-nums" }, svg)
      .textContent = fmtNum(tv, digits);
  }
  const d0 = new Date(t0), d1 = new Date(t1);
  for (let m = 1; m <= 12; m++) {
    const dt = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + m, 1);
    if (dt > t1) break;
    if (m % 3) continue;
    el("text", { x: x(dt), y: H - 7, "text-anchor": "middle", "font-size": 10, fill: css("--text-muted") }, svg)
      .textContent = new Date(dt).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  }
  el("line", { x1: M.l, x2: W - M.r, y1: H - M.b, y2: H - M.b, stroke: css("--baseline"), "stroke-width": 1 }, svg);

  // 200-day average, drawn under the price line
  if (opts.ma) {
    const ma = [];
    for (let i = 199; i < fullPts.length; i++) {
      let s = 0; for (let k = i - 199; k <= i; k++) s += fullPts[k][1];
      if (fullPts[i][0] >= t0) ma.push([fullPts[i][0], s / 200]);
    }
    if (ma.length > 2) {
      el("path", { d: ma.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join(""),
        fill: "none", stroke: css("--text-muted"), "stroke-width": 1.5, "stroke-linecap": "round" }, svg);
    }
  }

  const line = pts.map((p, i) => (i ? "L" : "M") + x(p[0]).toFixed(1) + " " + y(p[1]).toFixed(1)).join("");
  el("path", { d: line + `L${x(t1).toFixed(1)} ${H - M.b}L${x(t0).toFixed(1)} ${H - M.b}Z`,
    fill: css("--series-1"), opacity: 0.09, stroke: "none" }, svg);
  el("path", { d: line, fill: "none", stroke: css("--series-1"), "stroke-width": 2,
    "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
  el("circle", { cx: x(t1), cy: y(v[v.length - 1]), r: 4, fill: css("--series-1"),
    stroke: css("--surface-1"), "stroke-width": 2 }, svg);

  // hover layer
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
    row.appendChild(h("span", "tval", fmtNum(p[1], digits)));
    row.appendChild(h("span", "tname", opts.unit || ""));
    tip.appendChild(row);
    tip.style.display = "block";
    const bw = box.clientWidth;
    tip.style.left = Math.min(Math.max(0, (x(p[0]) / W) * bw + 10), bw - tip.offsetWidth) + "px";
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
const bp = v => v == null ? "–" : (v > 0 ? "+" : "") + fmtNum(v, 0) + "bp";

function deltaEl(value, isYield) {
  const s = h("span", "delta", isYield ? bp(value) : pct(value));
  const flat = value == null || Math.abs(value) < (isYield ? 0.5 : 0.05);
  s.className = "delta " + (flat ? "flat" : value > 0 ? "up" : "down");
  return s;
}

/* Regime scorecard: seven binary risk conditions. Stated as a count, not a
   single index, so a reader can see which components disagree. */
function regime(series, M) {
  const checks = [];
  const add = (label, ok, detail) => checks.push({ label, ok, detail });
  const m = s => M[s];
  if (m("ACWI")) add("Global equity above 200-day average", m("ACWI").aboveMa, pct(m("ACWI").maGap) + " vs 200d");
  if (m("SPY")) add("US equity above 200-day average", m("SPY").aboveMa, pct(m("SPY").maGap) + " vs 200d");
  if (m("^VIX")) add("Volatility subdued (VIX under 20)", m("^VIX").last < 20, "VIX " + fmtNum(m("^VIX").last, 1));
  const cr = ratioSeries(series.HYG, series.IEF);
  if (cr) { const c = metrics(cr); add("Credit appetite improving (HYG/IEF)", c.m3 > 0, pct(c.m3) + " 3m"); }
  const cy = ratioSeries(series.XLY, series.XLP);
  if (cy) { const c = metrics(cy); add("Cyclicals leading defensives", c.m3 > 0, pct(c.m3) + " 3m"); }
  const cg = ratioSeries(series["HG=F"], series["GC=F"]);
  if (cg) { const c = metrics(cg); add("Copper outperforming gold", c.m3 > 0, pct(c.m3) + " 3m"); }
  if (m("^TNX") && m("^TYX")) add("Long end not inverted", m("^TYX").last >= m("^TNX").last,
    fmtNum(m("^TYX").last - m("^TNX").last, 2) + "pp 30y-10y");
  return checks;
}

// -------------------------------------------------------------------- boot
let SERIES = {}, METRICS = {}, MACRO = null;

async function load() {
  const status = $("#status");
  status.textContent = "Fetching live prices…";
  status.hidden = false;

  // Macro paints as soon as it lands rather than waiting on the price feed —
  // the official data is one small file and the quotes take several seconds.
  const macroP = fetch("data/macro.json?t=" + Date.now(), { cache: "no-store" })
    .then(r => r.ok ? r.json() : null).catch(() => null);
  macroP.then(m => { if (m) { MACRO = m; renderMacro(); } });

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
  render(live);
}

function render(live) {
  renderStamp(live);
  if (live) { renderRegime(); renderMovers(); renderRatios(); renderTables(); }
  renderMacro();
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

function renderRegime() {
  const checks = regime(SERIES, METRICS);
  const on = checks.filter(c => c.ok).length;
  const box = $("#regime");
  box.textContent = "";
  const label = on >= 5 ? "Risk-on" : on >= 3 ? "Mixed" : "Risk-off";
  const cls = on >= 5 ? "on" : on >= 3 ? "mixed" : "off";

  const head = h("div", "regime-head " + cls);
  head.appendChild(h("div", "regime-label", label));
  head.appendChild(h("div", "regime-score", on + " of " + checks.length + " risk conditions met"));

  // Breadth: participation across the equity universe, not just the megacaps.
  const eq = UNIVERSE.filter(u => ["us", "global", "europe", "asia", "sector"].includes(u[2]) && METRICS[u[0]]);
  const above = eq.filter(u => METRICS[u[0]].aboveMa).length;
  if (eq.length) {
    const b = h("div", "breadth");
    const bar = h("div", "breadth-bar");
    const fill = h("div", "breadth-fill");
    fill.style.width = Math.round((above / eq.length) * 100) + "%";
    bar.appendChild(fill);
    b.appendChild(bar);
    b.appendChild(h("span", "breadth-text",
      above + " of " + eq.length + " equity markets above their 200-day average"));
    head.appendChild(b);
  }
  box.appendChild(head);

  const list = h("div", "regime-list");
  for (const c of checks) {
    const row = h("div", "regime-item " + (c.ok ? "yes" : "no"));
    row.appendChild(h("span", "mark", c.ok ? "✓" : "✕"));
    const txt = h("span", "rtext");
    txt.appendChild(h("span", "rlabel", c.label));
    txt.appendChild(h("span", "rdetail", c.detail));
    row.appendChild(txt);
    list.appendChild(row);
  }
  box.appendChild(list);
}

/* Ranked by how unusual the move is, not its raw size: a 1% day in the dollar
   index matters more than a 1% day in silver. Scored as the move divided by
   the instrument's own recent daily volatility. */
function renderMovers() {
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
  for (const r of rows.slice(0, 7)) {
    const t = h("div", "mover");
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

function renderRatios() {
  const box = $("#ratios");
  box.textContent = "";
  for (const [a, b, question, upMeans, downMeans] of RATIOS) {
    const pts = ratioSeries(SERIES[a], SERIES[b]);
    if (!pts) continue;
    const m = metrics(pts);
    const card = h("div", "card");
    card.appendChild(h("h3", null, a + " / " + b));
    card.appendChild(h("p", "meta", question));
    const read = h("p", "latest");
    read.appendChild(h("strong", null, fmtNum(m.last, 3)));
    read.appendChild(document.createTextNode("  "));
    read.appendChild(deltaEl(m.m3));
    read.appendChild(document.createTextNode(" over 3 months"));
    card.appendChild(read);
    const rising = m.m3 > 0;
    card.appendChild(h("p", "verdict " + (rising ? "up" : "down"),
      (rising ? "▲ " : "▼ ") + (rising ? upMeans : downMeans)));
    card.appendChild(lineChart(pts, { title: a + "/" + b, ma: true, unit: "ratio", visible: 252 }));
    box.appendChild(card);
  }
}

function renderTables() {
  const box = $("#tables");
  box.textContent = "";
  for (const [key, title] of GROUPS) {
    const rows = UNIVERSE.filter(u => u[2] === key && METRICS[u[0]]);
    if (!rows.length) continue;
    box.appendChild(h("h3", "tabletitle", title));
    const wrap = h("div", "tablewrap");
    const table = h("table", "mkt");
    const thead = h("thead"), hr = h("tr");
    ["Instrument", "Last", "1d", "1w", "1m", "3m", "YTD", "vs 200d", "52w range", "1y"].forEach((c, i) => {
      const th = h("th", i === 0 ? "left" : null, c);
      hr.appendChild(th);
    });
    thead.appendChild(hr); table.appendChild(thead);
    const tb = h("tbody");
    for (const [sym, name] of rows) {
      const m = METRICS[sym];
      const tr = h("tr");
      const nameCell = h("td", "left");
      nameCell.appendChild(h("span", "iname", name));
      nameCell.appendChild(h("span", "isym", sym));
      tr.appendChild(nameCell);
      tr.appendChild(h("td", "num", price(m.last)));
      [m.d1, m.w1, m.m1, m.m3, m.ytd].forEach(v => {
        const td = h("td", "num");
        td.appendChild(deltaEl(v, m.isYield));
        tr.appendChild(td);
      });
      const ma = h("td", "num");
      if (m.aboveMa == null) ma.textContent = "–";
      else {
        const tag = h("span", "trend " + (m.aboveMa ? "up" : "down"), (m.aboveMa ? "above " : "below ") + pct(m.maGap).replace("+", ""));
        ma.appendChild(tag);
      }
      tr.appendChild(ma);
      const rng = h("td", "num");
      rng.appendChild(rangeBar(m));
      tr.appendChild(rng);
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

function rangeBar(m) {
  const w = 74, hgt = 16;
  const svg = el("svg", { viewBox: `0 0 ${w} ${hgt}`, width: w, height: hgt, role: "img" });
  el("title", {}, svg).textContent = `52-week range ${price(m.lo)} to ${price(m.hi)}; now ${Math.round(m.rangePos)}% of the way up`;
  el("line", { x1: 3, x2: w - 3, y1: hgt / 2, y2: hgt / 2, stroke: css("--grid"), "stroke-width": 4, "stroke-linecap": "round" }, svg);
  const cx = 3 + (m.rangePos / 100) * (w - 6);
  el("circle", { cx, cy: hgt / 2, r: 4, fill: css(m.rangePos >= 50 ? "--series-1" : "--series-2"),
    stroke: css("--surface-1"), "stroke-width": 2 }, svg);
  return svg;
}

// Official macro fundamentals — slower-moving context below the market read.
function renderMacro() {
  const box = $("#macro");
  box.textContent = "";
  if (!MACRO) { box.appendChild(h("p", "muted", "Official macro data unavailable.")); return; }
  const PICKS = [
    ["us_cpi_yoy", "US CPI inflation"], ["us_unemployment", "US unemployment"],
    ["us_gdp_growth", "US real GDP growth"], ["us_payrolls_chg", "US payrolls change"],
    ["us_fed_funds", "Fed funds target"], ["ea_hicp_yoy", "Euro area inflation"],
    ["ea_depo_rate", "ECB deposit rate"], ["us_yield_spread", "10y minus 2y spread"],
    // Instruments the report tracks that have no usable live feed — kept here
    // on official monthly data rather than dropped.
    ["de_bund_10y", "German 10-year bund yield"], ["cmd_nickel", "Nickel"],
  ];
  for (const [id, title] of PICKS) {
    const s = MACRO.series[id];
    if (!s) continue;
    const pts = s.points.map(p => [new Date(p[0].length === 7 ? p[0] + "-15" : p[0]).getTime(), p[1]]).slice(-140);
    const card = h("div", "card");
    card.appendChild(h("h3", null, title));
    const meta = h("p", "meta");
    meta.appendChild(document.createTextNode(s.unit + " · "));
    const a = h("a", null, s.source); a.href = s.source_url; a.rel = "noopener";
    meta.appendChild(a);
    card.appendChild(meta);
    const read = h("p", "latest");
    read.appendChild(h("strong", null, fmtNum(s.points[s.points.length - 1][1], 2)));
    read.appendChild(document.createTextNode(" (" + s.points[s.points.length - 1][0] + ")"));
    card.appendChild(read);
    card.appendChild(lineChart(pts, { title, unit: s.unit }));
    box.appendChild(card);
  }
}

$("#refresh").addEventListener("click", () => load());
load();
