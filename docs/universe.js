/* The instrument universes, defined once.
 *
 * Countries, Themes and Commodities each owned their own copy of the list they
 * render. That was fine while they were the only readers — Lookup now needs
 * every one of them too, and a fourth copy would guarantee the day comes when
 * a country is added in one place and missing in another.
 *
 * Nothing here is derived or computed. These are the same literals the three
 * pages have always carried, moved rather than rewritten, so the pages render
 * exactly what they rendered before.
 *
 * Exposes window.UNIVERSE:
 *   COUNTRIES   [etf, name, region, local index or null]
 *   BENCH       [etf, name, "Benchmark"] — the cross-region aggregates
 *   BANDS       [band name, band blurb, [[etf, name], ...]]
 *   COMPLEXES   [complex name, [[symbol, name, quoted unit, COT key or null], ...]]
 */
(function () {
  "use strict";

  const COUNTRIES = [
    ["SPY", "United States", "Americas", "^GSPC"],
    ["EWC", "Canada", "Americas", "^GSPTSE"],
    ["EWW", "Mexico", "Americas", "^MXX"],
    ["EWZ", "Brazil", "Americas", "^BVSP"],
    ["ECH", "Chile", "Americas", null],
    ["ARGT", "Argentina", "Americas", "^MERV"],
    ["GXG", "Colombia", "Americas", null],
    ["EPU", "Peru", "Americas", null],
    ["EWU", "United Kingdom", "Europe", "^FTSE"],
    ["EWG", "Germany", "Europe", "^GDAXI"],
    ["EWQ", "France", "Europe", "^FCHI"],
    ["EWI", "Italy", "Europe", "FTSEMIB.MI"],
    ["EWP", "Spain", "Europe", "^IBEX"],
    ["EWN", "Netherlands", "Europe", "^AEX"],
    ["EWL", "Switzerland", "Europe", "^SSMI"],
    ["EWD", "Sweden", "Europe", "^OMX"],
    ["EWK", "Belgium", "Europe", "^BFX"],
    ["EWO", "Austria", "Europe", "^ATX"],
    ["EIRL", "Ireland", "Europe", "^ISEQ"],
    ["ENOR", "Norway", "Europe", "OBX.OL"],
    ["EDEN", "Denmark", "Europe", "^OMXC25"],
    ["EFNL", "Finland", "Europe", "^OMXH25"],
    ["PGAL", "Portugal", "Europe", "PSI20.LS"],
    ["GREK", "Greece", "Europe", "GD.AT"],
    ["EPOL", "Poland", "Europe", null],
    ["EWJ", "Japan", "Asia-Pacific", "^N225"],
    ["MCHI", "China", "Asia-Pacific", "000300.SS"],
    ["EWH", "Hong Kong", "Asia-Pacific", "^HSI"],
    ["EWT", "Taiwan", "Asia-Pacific", "^TWII"],
    ["EWY", "South Korea", "Asia-Pacific", "^KS11"],
    ["INDA", "India", "Asia-Pacific", "^NSEI"],
    ["EIDO", "Indonesia", "Asia-Pacific", "^JKSE"],
    ["EWM", "Malaysia", "Asia-Pacific", "^KLSE"],
    ["THD", "Thailand", "Asia-Pacific", "^SET.BK"],
    ["EPHE", "Philippines", "Asia-Pacific", "PSEI.PS"],
    ["EWS", "Singapore", "Asia-Pacific", "^STI"],
    ["VNM", "Vietnam", "Asia-Pacific", null],
    ["EWA", "Australia", "Asia-Pacific", "^AXJO"],
    ["ENZL", "New Zealand", "Asia-Pacific", "^NZ50"],
    ["EZA", "South Africa", "Middle East & Africa", "^J203.JO"],
    ["TUR", "Turkey", "Middle East & Africa", "XU100.IS"],
    ["KSA", "Saudi Arabia", "Middle East & Africa", "^TASI.SR"],
    ["QAT", "Qatar", "Middle East & Africa", null],
    ["EIS", "Israel", "Middle East & Africa", "^TA125.TA"],
    ["EGPT", "Egypt", "Middle East & Africa", null],
    ["UAE", "United Arab Emirates", "Middle East & Africa", null],
  ];

  const BENCH = [["ACWI", "All-country world", "Benchmark"],
                 ["EFA", "Developed ex-US (EAFE)", "Benchmark"],
                 ["EEM", "Emerging markets", "Benchmark"]];
  const REGIONS = ["Americas", "Europe", "Asia-Pacific", "Middle East & Africa", "Benchmark"];
  const BASE = "ACWI";

  const fmt = (v, d = 1) => v == null || !isFinite(v) ? "–"
    : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = v => v == null ? "–" : (v > 0 ? "+" : "") + fmt(v) + "%";
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const YQ = s => "https://finance.yahoo.com/quote/" + encodeURIComponent(s);

  async function proxied(url) {
    let err;
    for (const w of PROXIES) {
      try {
        const r = await fetch(w(url), { cache: "no-store" });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (e) { err = e; }
    }
    throw err;
  }
  /* Five years of daily closes: the yearly view needs the last close of 2021 to
     anchor the 2022 calendar year. */
  async function fetchSeries(symbols) {
    const chunks = [];
    for (let i = 0; i < symbols.length; i += 10) chunks.push(symbols.slice(i, i + 10));
    const res = await Promise.all(chunks.map(async c => {
      try {
        return (await proxied("https://query1.finance.yahoo.com/v7/finance/spark?symbols=" +
          c.map(encodeURIComponent).join(",") + "&range=5y&interval=1d")).spark?.result || [];
      } catch { return []; }
    }));
    const out = {};
    for (const row of res.flat()) {
      const resp = row.response?.[0];
      const closes = resp?.indicators?.quote?.[0]?.close, stamps = resp?.timestamp;
      if (!closes || !stamps) continue;
      const pts = [];
      for (let i = 0; i < stamps.length; i++) {
        if (closes[i] != null)
          pts.push([new Date(stamps[i] * 1000).toISOString().slice(0, 10), closes[i]]);
      }
      if (pts.length) out[row.symbol] = pts;
    }
    return out;
  }

  const sma = (pts, n) => {
    if (pts.length < n) return [];
    const out = []; let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      sum += pts[i][1];
      if (i >= n) sum -= pts[i - n][1];
      if (i >= n - 1) out.push([pts[i][0], sum / n]);
    }
    return out;
  };
  const ema = (pts, n) => {
    if (pts.length < n) return [];
    const k = 2 / (n + 1), out = [];
    let prev = pts[0][1];
    for (let i = 0; i < pts.length; i++) { prev = pts[i][1] * k + prev * (1 - k); out.push([pts[i][0], prev]); }
    return out.slice(n);
  };
  const CROSS_DEFS = [
    ["price crossed the 200-day SMA", (P, S) => [P, S.s200]],
    ["50-day crossed the 200-day (golden/death)", (P, S) => [S.s50, S.s200]],
    ["price crossed the 50-day SMA", (P, S) => [P, S.s50]],
    ["21-day EMA crossed the 50-day SMA", (P, S) => [S.e21, S.s50]],
    ["5-day EMA crossed the 21-day EMA", (P, S) => [S.e5, S.e21]],
  ];

  const BANDS = [
    ["Secular themes", "A story that cuts across industries — owned for years, not quarters", [
      ["BOTZ", "Robotics & automation"],
      ["AIQ", "Artificial intelligence"],
      ["ARKX", "Space"],
      ["CIBR", "Cybersecurity"],
      ["ITA", "Defense & aerospace"],
      ["NLR", "Nuclear"],
      ["TAN", "Solar"],
      ["ICLN", "Clean energy"],
      ["GRID", "Grid & electrification"],
      ["PAVE", "Infrastructure"],
      ["LIT", "Lithium & battery"],
      ["PHO", "Water"],
      ["IHI", "Medical devices"],
      ["BOAT", "Shipping"],
    ]],
    ["Sectors & industries", "A slice of the index that rotates with the cycle", [
      ["SMH", "Semiconductors"],
      ["XLK", "Technology"],
      ["XBI", "Biotech"],
      ["XLV", "Healthcare"],
      ["XLI", "Industrials"],
      ["XLE", "Energy"],
      ["OIH", "Oil services"],
      ["XLB", "Materials"],
      ["KBE", "Banks"],
      ["ITB", "Homebuilders"],
      ["XRT", "Retail"],
      ["JETS", "Airlines"],
    ]],
  ];

  const COMPLEXES = [
    ["Energy", [
      ["CL=F", "WTI crude", "$/bbl", "wti"],
      ["BZ=F", "Brent crude", "$/bbl", null],
      ["NG=F", "Natural gas", "$/MMBtu", "natgas"],
      ["RB=F", "RBOB gasoline", "$/gal", null],
      ["HO=F", "Heating oil", "$/gal", null],
    ]],
    ["Precious metals", [
      ["GC=F", "Gold", "$/oz", "gold"],
      ["SI=F", "Silver", "$/oz", "silver"],
      ["PL=F", "Platinum", "$/oz", "platinum"],
      ["PA=F", "Palladium", "$/oz", null],
    ]],
    ["Industrial metals", [
      ["HG=F", "Copper", "$/lb", "copper"],
      ["ALI=F", "Aluminium", "$/tonne", null],
    ]],
    ["Grains and oilseeds", [
      ["ZC=F", "Corn", "¢/bu", "corn"],
      ["ZW=F", "Wheat", "¢/bu", "wheat"],
      ["ZS=F", "Soybeans", "¢/bu", "soybeans"],
      ["ZL=F", "Soybean oil", "¢/lb", null],
      ["ZM=F", "Soybean meal", "$/ton", null],
    ]],
    ["Softs", [
      ["SB=F", "Sugar", "¢/lb", "sugar"],
      ["KC=F", "Coffee", "¢/lb", "coffee"],
      ["CC=F", "Cocoa", "$/tonne", "cocoa"],
      ["CT=F", "Cotton", "¢/lb", "cotton"],
      ["OJ=F", "Orange juice", "¢/lb", null],
    ]],
    ["Livestock", [
      ["LE=F", "Live cattle", "¢/lb", null],
      ["HE=F", "Lean hogs", "¢/lb", null],
    ]],
    ["Broad baskets", [
      ["BCI", "Broad commodities (BCI)", "index", null],
      ["DBC", "DB commodity index (DBC)", "index", null],
      ["GSG", "GSCI (GSG)", "index", null],
      ["DBA", "Agriculture (DBA)", "index", null],
    ]],
  ];

  window.UNIVERSE = { COUNTRIES, BENCH, BANDS, COMPLEXES };
})();
