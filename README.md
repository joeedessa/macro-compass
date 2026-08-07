# Macro Compass — morning read

A macro dashboard built to be scanned in under a minute before the open: what
regime are we in, what moved unusually, and where is money rotating. Static page,
no build step, no server, no API keys.

**Live:** https://joeedessa.github.io/macro-compass/

## How it reads

1. **Regime** — seven binary risk conditions (trend, volatility, credit, cyclicals,
   copper/gold, curve) plus equity breadth. Deliberately shown as a count with each
   component visible, so disagreement between components is readable rather than
   averaged away into a single index.
2. **Notable moves** — ranked by how unusual each move is against that instrument's
   own 60-day volatility, not by raw size. A 1σ day in the dollar matters more than
   a 3% day in silver.
3. **Relative strength** — ratio charts for the rotations that drive positioning,
   each stating in words what a rising line means, with a true 200-day average.
4. **Markets** — every instrument with multi-horizon returns, trend state vs the
   200-day average, and position in the 52-week range.
5. **Macro fundamentals** — the slow official data underneath it all.

## Data sources

| Layer | Source | Freshness |
|---|---|---|
| Prices — equities, ETFs, futures, FX, rates | Yahoo Finance, fetched **in the browser on every page load** | Delayed quotes, not real-time |
| Macro fundamentals — CPI, unemployment, GDP, payrolls, policy rates | [FRED](https://fred.stlouisfed.org/), [ECB](https://data.ecb.europa.eu/), [World Bank](https://data.worldbank.org/) | Refreshed hourly by CI |

Yahoo sends no CORS header, so a static page cannot call it directly; requests go
through a keyless public CORS proxy, with fallbacks. If the price feed is
unavailable the page degrades to the official macro data rather than breaking.

Instruments with no usable live feed (German bund yield, LME nickel) stay on
official monthly data in the fundamentals section rather than being dropped.

## Layout

- `docs/index.html` — structure and styling
- `docs/app.js` — data fetching, metrics, charts (vanilla JS + SVG, no libraries)
- `scripts/fetch_data.py` — official macro pull (Python stdlib only)
- `.github/workflows/` — hourly data refresh, Pages deploy

## Run locally

```bash
python3 -m http.server 8321 --directory docs
```

Not investment advice.
