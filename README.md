# Macro Compass

A zero-dependency macro dashboard: key economic indicators and market indices,
refreshed daily from official sources and served as a static page via GitHub Pages.

## Data sources

Every series comes from a free, authoritative endpoint — no API keys, no scraping,
no third-party aggregators. Each chart on the dashboard links to its underlying series.

| Coverage | Source |
|---|---|
| US inflation, unemployment, GDP, payrolls, Fed funds, Treasury yields | [FRED](https://fred.stlouisfed.org/) (St. Louis Fed) — original data from BLS, BEA, the Federal Reserve, and the US Treasury |
| S&P 500, Nasdaq, Dow, VIX, broad dollar index | FRED — licensed from S&P Dow Jones, Nasdaq, and Cboe |
| WTI crude; copper, aluminum, nickel, uranium | FRED — EIA (crude) and IMF primary commodity prices (metals) |
| Nikkei 225, USD/JPY, German 10-year bund yield, national share-price indices | FRED — Nikkei Inc., the Federal Reserve, and the OECD |
| Euro area HICP inflation, ECB deposit rate, EUR/USD, Euro Stoxx 50 | [ECB Data Portal](https://data.ecb.europa.eu/) |
| China and Japan GDP growth and CPI inflation (annual) | [World Bank Open Data](https://data.worldbank.org/) |

Note on the share-price charts: these are OECD *total share price indices* (2015 = 100), a
cross-country-comparable equity measure — not the DAX, CAC 40, TSX, or Sensex index levels
themselves, which have no free authoritative feed. They are labelled as such on the dashboard.

## How it works

- `scripts/fetch_data.py` (Python stdlib only) pulls every series and writes
  `docs/data/macro.json` with per-series source attribution.
- `docs/index.html` is a self-contained dashboard (vanilla JS + SVG, no libraries)
  that renders stat tiles and charts from that JSON, with time-range filters,
  hover tooltips, per-chart data tables, and light/dark themes.
- `.github/workflows/update-data.yml` re-runs the fetch daily and commits the
  result, so GitHub Pages always serves fresh data.

## Run locally

```bash
python3 scripts/fetch_data.py
python3 -m http.server 8321 --directory docs
```

Then open <http://localhost:8321>.

Not investment advice; data is presented as published by its sources.
