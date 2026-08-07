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
3. **Economic Modern Family** — the framework published by Mish Schneider of
   [MarketGauge](https://marketgauge.com/modern-family/): six sector ETFs standing for six
   parts of the real economy (small caps, retail, regional banks, transportation, biotech,
   semiconductors) plus Bitcoin. Summarised as how many members are "in gear" — trending
   above their 200-day average — because the framework's question is whether they move
   together or split. Independent implementation, not affiliated with or endorsed by MarketGauge.
4. **Relative strength** — twelve rotation ratios, each stating in words what a rising
   line means, over a switchable window from 1 week to 2 years. Includes two
   concentration measures: MAGS/SPY and cap-weight versus equal-weight (SPY/RSP).
5. **Markets** — a **Table** view (multi-horizon returns, trend state vs the 200-day
   average, position in the 52-week range) and a **Charts** view (1-year daily with
   SMA 200/150/50 and EMA 21).
6. **Official flows** — who is financing the US deficit and what the big reserve managers
   hold: foreign official Treasuries in custody at the Fed (weekly), the Fed's own holdings
   (QT pace), Treasury auction bid-to-cover and indirect-bidder share for 2/5/10/30-year
   straight from [TreasuryDirect](https://www.treasurydirect.gov/auctions/auction-query/),
   and FX reserves for China, Japan, the UK and the euro area.
7. **Macro fundamentals** — the slow official data underneath it all.

Note on reserve composition: no country publishes the currency breakdown of its own
reserves, and the IMF's COFER data gives currency shares only in global aggregate. The
auction indirect-bidder share and the Fed custody series are the closest public reads on
official demand, and both are proxies with documented limitations — see their info cards.

Every card carries two controls: **i** turns the card over to explain how that signal
is conventionally interpreted in macro research, and **↗** opens the underlying source
— Yahoo Finance for prices, FRED or the ECB for macro series.

The interpretation notes in `docs/info.js` are summaries of standard readings, not
quotations, and each names the failure mode of the signal it describes.

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
