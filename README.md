# Macro Compass — morning read

A macro dashboard built to be scanned before the open: what regime are we in, what
moved unusually, where money is rotating, and which of my own levels have been hit.
Static pages, no build step, no server, no API keys, no paid data.

**Live:** https://joeedessa.github.io/macro-compass/ — served from `docs/` on GitHub Pages.

## Pages

| Page | What it answers |
|---|---|
| `index.html` | Overview — the regime read |
| `tape.html` | Today — two reads (the session that closed, and what has happened since), futures, world markets, movers, breadth, sessions, Bloomberg headlines |
| `watch.html` | Watchlist — my setups: trigger, target, negation, replayed state |
| `watch.html?set=benchmarks` | Benchmarks — the same engine against the weekly global-markets levels |
| `portfolio.html` | Positions, enriched with fundamentals |
| `markets.html` `trend.html` `ai.html` `commodities.html` `countries.html` `themes.html` `macro.html` `letters.html` `lookup.html` | Cross-sections of the same universe |
| `method.html` | **The reference.** How the moving averages are defined, what each is worth (measured), the data rules, where prices and headlines come from |

Shared JavaScript lives beside them: `ma.js` (moving averages, slope, the shared MA
columns), `pricefloor.js` (the price layer and the page stamp), `universe.js`,
`links.js`, `quotes.js`, `info.js`, `mobile.js`, `app.js`.

## Things that will bite you

**Bump the cache-buster on every change.** Every `<script>` and `<link>` carries
`?v=YYYYMMDDx`. Change a shared file without bumping it everywhere and browsers serve
stale JS against fresh HTML, which fails silently and looks like a data bug.

**Don't duplicate shared logic.** The MA slope reached five pages and skipped the
watchlist, because the watchlist built its own columns. The price stamp was written
eight times and said the same untrue thing eight times. The Benchmarks board is
`watch.html?set=benchmarks` for exactly this reason — one engine, two data files.

**Verify in the browser console, not by grepping the DOM.** Grepping rendered HTML
for `Uncaught` finds nothing, because errors never land in the DOM. That check
reported success over a page that was throwing on every load.

**Prices and the reference must come from the same source.** Yahoo cuts futures daily
bars at midnight New York while contracts settle at 17:00, so a close measured
against the previous daily bar flips the sign on gold, bitcoin and copper while every
equity stays correct. Index futures are measured against the cash close they track,
not their own settlement.

**Yahoo pads weekly and monthly series with a phantom bar.** It repeats the period in
progress and biases every average. It is dropped by comparing periods, not values —
a value test missed it on every monthly series for weeks.

**Gate scheduled work on the age of the data, not the hour of the clock.** GitHub's
scheduler fires a handful of times a day at arbitrary hours; a step gated on
`hour = 23` ran twice in forty runs and left the price history five days stale.

## Data

Written by `scripts/` into `docs/data/`, committed, and read by the pages from their
own origin — so a page works even when every proxy is down.

| File | Written by | Cadence |
|---|---|---|
| `prices.json` | `fetch_prices.py` | daily, age-gated — 1y daily, 5y weekly, 25y monthly |
| `prices-latest.json` | `fetch_prices.py --latest` | every 15 min |
| `news.json` | `fetch_news.py` | every 15 min — Bloomberg markets RSS, headlines and links only |
| `macro.json` | `fetch_data.py` | hourly — FRED, ECB, World Bank |
| `watch-events.json` | `fetch_events.py` | hourly — earnings, ex-dividends, ATR |
| `portfolio-data.json` | `fetch_portfolio.py` | hourly |
| `ai.json` `letters.json` | `fetch_ai.py` `fetch_letters.py` | hourly / quarterly |
| `ma-stats.json` | `measure_ma.py` | monthly, age-gated |
| `watchlist.json` `benchmarks.json` `portfolio.json` `tradelog.json` | by hand | when levels change |

`quality.py` guards every write: a run that comes back thin refuses to overwrite a
full file, on a relative threshold rather than a fixed floor.

## The price layer

Yahoo sends no `access-control-allow-origin`, so a static page cannot call it. In order:

1. **Cloudflare Worker** (`cloudflare/`) on our own account — fetches only Yahoo, answers only this site's origins.
2. **Three keyless public proxies**, behind it. All of them have failed at some point; on 2026-08-23 they failed together and the site went dark.
3. **The snapshot** — `prices.json` plus `prices-latest.json`, served from our own origin. This is why the proxies are an enhancement rather than a foundation.

A probe timeout marks a proxy slow, not dead. Only a refusal counts.

## Watchlist conventions

- `lfd` holds the last full day level from the breakout sheet (its LFDR column) and wins over the derived one; `lfd: 0` means the sheet gives none (breakouts before June 2026). No mechanical rule reproduces the sheet's choice every time (best fit 12–15 of 20), so the sheet is the source and the derivation only covers breakouts it has not reached yet.
- `reached: "YYYY-MM-DD"` records a target the source counts as met where our closes fell just short; shown "per source".
- `removed: "YYYY-MM-DD"` marks a setup the weekly report has dropped from its watchlist. It moves to Removed on every browser, with the date shown; Restore still works per browser.
- A row is `sym` + `dir`; the same symbol can carry a long and a short, so never key by symbol alone.
- `breakthrough` is the **confirming close**, not the pattern boundary.
- A negation is only tested **after** a setup triggers, against the day's low for a long and its high for a short.
- `boundary` is the pattern level the report states ("neckline acting as resistance at 105.9"); `breakthrough` is the confirming close ("a daily close above 109"), usually the boundary plus the 3% Edwards & Magee filter.
- The **LFD stop** is the tight stop: the low (long) or high (short) of the full daily bar *before the first close past the boundary* — the desk's rule. That close records the stop but confirms nothing; the row stays in the watchlist until the trigger closes. Tech Charts' own wording anchors to the confirming close instead; where the two differ the tooltip shows both. No boundary on file → the trigger is the anchor and the cell says so. A level typed in from the report (`lfd`) wins. Taking it out is not a failure — only the negation fails a pattern — so it marks the row and alerts, and never moves it.
- A setup that already broke out needs `confirmed` set to the date it did. The replay starts at `confirmed || created` and ignores every bar before it — date it today and a live breakout sits in the watch list.

## Workflows

`update-data.yml` (hourly-ish), `update-prices.yml` (a 15-minute loop inside one
long-running job, because the scheduler is not dependable), `deploy-pages.yml`.

## Run locally

```bash
python3 -m http.server 8899 --directory docs
```

## Licensing

Watchlist and benchmark levels come from a paid subscription (Tech Charts). This
repository is public and its history is permanent. The levels are published here by
the owner's decision; the full supplied list is not, and the import file
(`~/Downloads/TechCharts_watch_import_*.json`) never enters the repo.

Not investment advice.
