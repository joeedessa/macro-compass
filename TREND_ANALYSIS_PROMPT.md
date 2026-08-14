# Trend analysis for individual stocks — portable spec

Paste into another project to reproduce how Macro Compass reads trend on a single name.
Self-contained: it carries the method, the thresholds, the data quirks and the failure
modes, so it does not need this repo. Everything here is free and keyless.

---

You are adding per-stock trend analysis to a dashboard. Implement the method below rather
than inventing one. It was built and debugged against a real book of ~400 positions across
ten currencies, and the thresholds and caveats are the result of specific mistakes.

## 1. The moving-average ladder

Five signals, in the order a name actually moves through them:

| Order | Signal | What it is |
|---|---|---|
| 1 | 5-EMA × 21-EMA | timing trigger, noisy |
| 2 | price × 50-SMA | swing trend break |
| 3 | 21-EMA × 50-SMA | intermediate turn |
| 4 | price × 200-SMA | regime change |
| 5 | 50-SMA × 200-SMA | golden / death cross, late but clean |

Present them left to right in that order, bullish block above bearish. The layout *is* the
message: the left column is always crowded and the right is nearly empty, which is the
point. A name appearing in several columns is climbing the ladder.

**Why this order — measured, not assumed.** Across 78 instruments over 5 years:

- Price crossed the 200 **before** the 50/200 golden cross in **262 of 262 cases**, median
  **18 sessions** earlier. Death crosses: 227 of 232, the 5 exceptions being cases where
  price was already below the 200 on the first session a 200-day average could be computed.
- The 50 is an average of the last 50 closes, so it is arithmetically downstream of price.
  It can only confirm.
- The cost of that lead is reliability: **only 46%** of price-crosses-above-the-200 were
  followed by a golden cross within 60 sessions. More than half are false starts.

State that trade-off wherever the signals appear. Early and noisy versus late and clean is
the whole decision.

**Whipsaw.** Flag a cross whose sign reverses again inside the same lookback window (10
sessions works). Show it, do not hide it — a level that keeps being crossed is telling you
it is contested. Expect the slow tiers almost never to whipsaw and the fast ones often to.

## 2. Distance from the averages, and level tests

For each of **21, 50, 150, 200**, report the distance from price as a percentage. Do it on
**daily, weekly and monthly** bars, with weekly and monthly behind their own toggles and
fetched lazily — a 200-month average needs 200 months of history and nobody wants that on
every page load.

For the **150 and 200 only**, also report what happened the last time price went near the
level. Over the last 15 bars find the closest approach; if it came within **2%**, classify:

| State | Condition |
|---|---|
| **held** | was above the level at the test, still above |
| **rejected** | was below at the test, still below |
| **reclaimed** | was below at the test, now above |
| **lost** | was above at the test, now below |

If nothing came within 2%, report nothing. Silence is a valid answer.

**Say what the calculation is built on.** With close-only data you cannot see intraday
wicks, so a spike through a level that closed back above it reads as *held*. That is the
outcome that matters, but the reader must be told the basis. If you have OHLC, use the low
against the level for support and the high for resistance, and say that instead.

## 3. Ranking moves: against the instrument, not in the abstract

Never rank by raw percentage alone. Rank by the move divided by the name's own
**14-day ATR**, and show both. A 3% day in something that normally moves 0.8% outranks a
6% day in a junior explorer. Same idea with a 60-day return standard deviation for a sigma
figure.

**Sanity-check the ATR.** An ATR larger than half the share price is arithmetically
impossible and means the ATR predates a consolidation or reverse split while the price does
not. Reject it and show nothing. Left in, it divides a real move by a nonsense denominator
and buries the name at 0.0× — the failure *hides* a big day rather than inventing one,
which is the harder kind to notice.

## 4. Is the move the stock, or the tape?

Two relative reads per name, both in percentage points:

- **vs market** — the name's day % minus its *local* index (Nikkei for Tokyo, ASX 200 for
  Sydney, not the S&P for everything).
- **vs sector** — day % minus the median of same-sector peers in your universe, requiring
  at least 3 peers before reporting anything.

Add a breadth gauge: how many names in the universe are down today. Above ~60% down, tell
the reader that individual weakness is the tape, not the stock.

## 5. Position in the range

- Distance from the **52-week high** and **low**, and from the **all-time high**.
- "At" a level means **within 2%** — an exact tick is rare and the question is whether it
  is testing it.
- **RSI(14)**, flagged over 70 and under 30.
- Rank all-time highs above 52-week highs: a 52-week high inside a long downtrend is a
  different animal from a price no buyer has ever paid more for.
- Say how far back "all time" reaches. For a recent listing it is not far, so the honest
  label is "highest ever recorded here".

## 6. Evaluate rules on settled closes only

If the trend feeds a signal (a breakout, a stop), evaluate it on **completed daily closes**,
never intraday. Intraday touches should not count, by design, so signals match end-of-day
discipline.

**The trap that cost me a real signal.** A bar is still forming only if it belongs to the
session running *right now*. Testing "has the current session ended?" is a different
question: with markets shut, the newest bar is usually a completed close from an earlier
session, and it gets discarded as live. That affected 52 of 72 symbols and ran the whole
rule set a session late — a breakout sealed by the last close did not appear until the
following day.

```
settled = NOT (lastBarTimestamp >= currentSessionStart AND now < currentSessionEnd)
```

## 7. Data sources — free, keyless, and their quirks

**TradingView scanner** — `POST https://scanner.tradingview.com/global/scan`, no key, one
request covers hundreds of symbols. Useful columns: `close`, `change`, `change_abs`, `ATR`,
`Volatility.D`, `RSI` (14; `RSI7` is separate), `SMA50`, `SMA200`, `High.All`, `Low.All`,
`price_52_week_high`, `price_52_week_low`, `Perf.W/1M/3M/YTD/Y`, `sector`, `industry`,
`beta_1_year`, `relative_volume_10d_calc`.

- Send `"price_conversion": {"to_symbol": true}` or every fundamental comes back
  **USD-normalised** — a JPY-quoted stock returns a "6.1" price target against a ¥1,128
  price.
- `name` is the ticker; `description` is the company name.
- Exchange prefixes: `NASDAQ/NYSE/AMEX/OTC`, `TSX`, `TSXV`, `ASX`, `LSE`, `HKEX` (strip
  leading zeros), `TSE`, `XETR`, `EURONEXT`, `OSL`, `OMXSTO`, `MIL`, `SZSE`, `SSE`. For US
  names try the three venues and take the first hit; OTC-traded ADRs need `OTC:`.
- Prefer unambiguous fields over composite ones. `recommendation_mark` has no documented
  direction — use the raw `recommendation_buy/over/hold/under/sell` counts instead.

**Yahoo spark** — `query1.finance.yahoo.com/v7/finance/spark?symbols=A,B&range=..&interval=..`,
batches ~10 symbols, no key, but sends no CORS header so a static page needs a proxy
(`corsproxy.io` was the only free one that worked).

- **`range=max` silently ignores the interval** and returns ~168 downsampled bars whether
  you ask for daily, weekly or monthly. Use bounded ranges: `5y/1wk` → 263 weekly bars,
  `25y/1mo` → 301 monthly bars, both enough for a 200-period average.
- Yahoo suffixes: `.TO .V .AX .L .HK` (pad to 4 digits) `.T .DE .PA .OL .ST .MI .SZ .SS`.

**A delisted instrument does not leave the feed.** Yahoo keeps serving the old history and
pads a null bar at today's timestamp, so the last row looks current. Measure staleness from
the last **non-null** close and drop anything older than ~14 days, naming what you dropped.
Two liquidated ETFs read as live for months before this was caught.

**A symbol can resolve and still carry one bar.** Validate history *depth*, not just that
the symbol responds.

## 8. Rules for anything the page says in words

This is where the real damage happens. A wrong number looks wrong; a wrong sentence reads
as authority.

1. **Any label containing "since", "over" or "vs" is a claim — check it.** A column labelled
   "since the report" showing one-month performance was, for a name that reported yesterday,
   29 days of pre-report drift. It had one stock at +9.5% when the true post-result reaction
   was **−8.1%** — the sign inverted.
2. **Do not assert a direction from a move that is noise.** Compare the change against the
   series' own typical move over that window; under about a fifth of the median, say
   "little changed". A curve card once said "steepening — margin expansion being priced"
   from a move of +0.000pp.
3. **Window arithmetic must respect frequency.** Stepping back N array positions is N months
   on a monthly series. Walk calendar dates.
4. **Key lookups explicitly.** When several config rows each enumerate the same case space,
   index by name, not position — a positional map silently mismatched two of four rows and
   printed "crude rising" while oil was −17.5%.
5. **Averaging can cancel the thing you are trying to surface.** Averaging open regions
   together let a rising Europe hide a falling US.

## 9. How to verify

Recompute from the raw series in a separate script and compare against what the page
renders. Every serious bug above survived code review and looked perfect on screen; only
recomputation caught them.

**One caveat that matters.** A reimplementation that shares an assumption with the original
proves nothing. My Python replay reproduced the page's state counts exactly — because I had
reimplemented the same wrong settled-close rule. Check against the raw inputs (session
timestamps, the actual closes around a date), not against a second copy of your own logic.

## Deliverable

Per stock, the dashboard should be able to answer:

- Where is it against 21/50/150/200 on daily, weekly and monthly?
- Has it recently tested the 150 or 200, and did the level hold?
- What has crossed in the last ten sessions, and where on the ladder?
- Is today's move large *for this name*?
- Is it moving with its market and sector, or against them?
- Where is it in its 52-week and all-time range, and is RSI stretched?

State the basis of each figure next to it. If a figure cannot be made trustworthy, remove
it rather than shipping it with a caveat nobody reads.
