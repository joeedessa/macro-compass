# Review prompt — Macro Compass

Paste this into a fresh session to audit and improve the dashboard. It is written to be
used as-is; the sections that matter most are **Known failure modes** and **How to verify**,
because they encode bugs this project has actually shipped.

---

You are reviewing **Macro Compass**, a macro dashboard at `~/Macro Compass`, public at
https://joeedessa.github.io/macro-compass/ (repo `joeedessa/macro-compass`, deploys from
`docs/` via GitHub Pages).

The owner is a macroeconomic investor and swing trader. He reads this page to make real
decisions with real money. A number that is confidently wrong is far worse than a number
that is missing.

## The system

Ten pages, each a standalone HTML file in `docs/` except where noted:

| Page | Owns |
|---|---|
| `index.html` | Overview — regime, notable moves, Economic Modern Family, rotation, sentiment |
| `tape.html` | Today — session clocks, regional blocks (Asia/Europe/Americas), intraday paths, breadth |
| `markets.html` | Cross-asset relationships + US equity internals (uses shared `app.js`) |
| `commodities.html` | The commodity complexes, COT positioning, seasonality, carry, the equity leg |
| `countries.html` | Country equity — vs ACWI and vs US, yearly returns, USD vs local currency |
| `themes.html` | Two bands: secular themes and sectors/industries |
| `macro.html` | Official macro fundamentals and flows (uses `app.js`) |
| `letters.html` | 13F holdings with QoQ share deltas, curated letters |
| `watch.html` | The swing-trade watchlist and its state machine |
| `lookup.html` | Per-subject dossiers (12 subjects) |

Two data layers:

- **Prices** — fetched client-side from Yahoo Finance on every page load through
  `corsproxy.io`, so pages are current whenever opened. Delayed, not real-time.
- **Official macro** — `scripts/fetch_data.py` → `docs/data/macro.json` (82 series from
  FRED, ECB, World Bank, CFTC, TreasuryDirect), refreshed hourly by GitHub Actions.
  Also `fetch_events.py` (TradingView scanner → earnings, ex-div, sectors, guidance
  headlines) and `fetch_letters.py` (SEC EDGAR 13F).

## Non-negotiable constraints — do not break these

1. **Everything free, no API keys, no tokens, ever.** Official sources preferred.
2. **Prices stay in their native listing currency.** Never convert. A JPY-quoted stock
   shows JPY. Where a page deliberately compares in dollars (Countries) it says so
   explicitly and offers the local view alongside.
3. **Units are stated wherever they are not obvious** — `$/oz` beside `¢/lb`.
4. **Every `<script>`/`<link>` to `app.js`, `styles.css`, `info.js` carries a `?v=`
   cache-buster that must be bumped on every change**, or browsers and the Pages CDN
   serve stale JS against fresh HTML and it fails silently.
5. Page boundaries are settled — do not re-mix them. Countries owns geography, Themes
   owns narratives and sectors, Commodities owns the physical and its equity leg,
   Markets owns cross-asset and US internals.

## What to review, in priority order

1. **Correctness of every computed figure and every generated sentence.** This dashboard
   writes prose ("Behaving", "crowded long", "the handover broke"). Prose is more
   dangerous than numbers because it reads as authoritative. Verify the logic that
   produces it, not just that it renders.
2. **Data integrity** — stale symbols, silent gaps, frequency mismatches, misaligned joins.
3. **Statistical honesty** — is the window right, is the baseline right, is the sample big
   enough, does the caveat appear next to the number rather than in the footer.
4. **Readability** — can a figure be misread at a glance; is the unit present; does colour
   mean one consistent thing.
5. **Code health** — duplication across the standalone pages, dead code, listener leaks.

## Known failure modes in this codebase — check each one explicitly

Every item below is a bug that actually shipped here. Assume the class of error recurs.

- **Positional lookup across differently-ordered config.** Four cross-asset rows each
  enumerated their four sign-combinations in their own natural order, and a positional
  index mapped them. Two of four verdicts were flatly false — it printed "crude rising"
  while oil was −17.5%. *Check: any lookup keyed by array position into per-row config.*
- **Array-index windows on mixed-frequency series.** `macroMove` stepped back N array
  positions for an "N-day" change. On a monthly series that is N months. A "3-month"
  uranium change was reading five and a quarter years. *Check: every window computed on
  `macro.json`, whose series run daily, weekly, monthly and annual.*
- **Delisted instruments read as live.** Yahoo keeps serving a dead ETF's history and pads
  a null bar at today's timestamp, so `ts[-1]` looks current. The liquidated Portugal and
  Egypt funds showed 2024 prices labelled YTD. *Check: staleness measured from the last
  NON-NULL close, everywhere.*
- **Symbols that resolve but carry no history.** `^CASE30` returns exactly one bar;
  `^QSI` stops in 2021. An existence-only probe passes them. *Check: validate depth and
  recency, not just that the symbol responds.*
- **Helpers silently removed by an edit.** A replacement block swallowed the two lines
  defining `sortVal`/`sortKey`, so the Themes instrument table rendered empty in
  production. *Check: after any edit, assert the thing you edited still produces rows.*
- **Continuous futures vs a rolling fund.** Yahoo's `CL=F` is a spliced continuous series
  that does not experience roll; `USO` does. That difference is the carry signal, and it
  is only valid because GLD-vs-gold is included as a control that comes out at the fee.
  *Check: any comparison of a fund against a futures series states what the gap contains.*
- **Vendor currency normalisation.** The TradingView scanner returns fundamentals in USD
  by default; `price_conversion: {to_symbol: true}` is required for native currency.
- **Undocumented vendor scales.** `recommendation_mark` has no documented direction, so
  raw analyst counts are used instead. Prefer unambiguous fields over inferred ones.
- **URL-unsafe contract names.** The CFTC contract `COPPER- #1` truncated the whole query
  at the `#`. *Check: percent-encoding on every constructed query.*
- **Averaging that cancels a divergence.** The tape's relay line averaged all open regions
  together, letting a rising Europe cancel a falling US and report "following" when the
  handover had broken. *Check: any summary statistic that could hide the thing it exists
  to surface.*

## How to verify — do not trust the render

- **Recompute independently.** Pull the raw series yourself in Python and check the page's
  number against yours. Several bugs above were invisible until a figure was recomputed
  from source. Do this for at least: one driver verdict per Lookup subject, the
  Commodities seasonality and carry figures, the Countries yearly returns, and the
  Markets cross-asset cards.
- **The Browser pane's viewport frequently degrades to 0×0 here.** Use headless Chrome:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new
  --disable-gpu --window-size=1400,1200 --virtual-time-budget=90000
  --screenshot=out.png URL`, and `--dump-dom` for structure. Note `--dump-dom` includes
  inline `<script>` source, so a string match can hit the code rather than the output —
  match on rendered elements.
- **Check both colour schemes.** Pages are theme-aware; verify light and dark.
- **Verify live after deploy**, and confirm the served file matches what you tested
  (`curl` it and diff against the local file) — a green Actions run is not proof the CDN
  served your build.

## Deliverable

1. A prioritised list of findings. For each: the file and line, what is wrong, **the
   concrete failure case with real numbers**, and the fix. Rank by whether it could cause
   a wrong decision, not by how easy it is to fix.
2. Fix the top findings, verify each against independently computed values, and deploy.
3. Say plainly what you checked and found clean — silence should not be mistaken for
   coverage.
4. If a figure cannot be made trustworthy, remove it or label it honestly rather than
   shipping it with a caveat nobody will read.

## Scope guards

- Do not redesign pages that were not raised as a problem.
- Do not add data sources that need a key, or that are not free.
- Do not "improve" a number by changing its definition without saying so.
- Prefer deleting a misleading feature over patching it.
