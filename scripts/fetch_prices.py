#!/usr/bin/env python3
"""Hourly price snapshot for every symbol the site draws, written to
docs/data/prices.json.

Why this exists. A static page cannot call Yahoo directly — Yahoo sends no
access-control-allow-origin — so every price on this site reached the browser
through a free public CORS proxy. On 2026-08-23 all of them failed within the
same hour: corsproxy.io began answering 401 to everyone without a paid key,
allorigins went to 522, codetabs to 522, and cors.lol rate-limits under the
forty-odd requests a single watchlist load makes. The site went completely
dark. Not one page rendered a price.

The dependency was the bug. This job runs inside GitHub Actions where there is
no browser and therefore no CORS at all, fetches Yahoo directly, and commits
the result to the repo — which the pages then read from their own origin, with
no proxy, no third party and no rate limit in the path.

That makes the proxies an enhancement rather than a foundation: a page opens
instantly on this file, then tries for live prices and quietly upgrades itself
if a proxy answers. When none do, the reader sees an hour-old close with an
honest timestamp instead of an empty table.

A year of daily closes per symbol, not just the last one. Two points would be
smaller, but every page derives things from the series — a 21-day change, a
52-week range, a 200-day average — and handing those a two-point array does not
make them blank, it makes them wrong: a "52-week range" computed from two
consecutive closes still renders, still looks like a number, and is a lie. A
floor that produces confident nonsense is worse than the empty page it
replaces. So the snapshot carries enough history for the same code paths to run
unchanged and reach the same answers.

Closes only, and rounded — no OHLC. The watchlist's intraday negation check
needs real highs and lows and is left to fail honestly when the proxies are
down, because there is no way to approximate a low from a close.

Two files, because of what changes and what does not.

prices.json carries a year of daily bars plus five years of weekly and
twenty-five of monthly, and almost none of it moves between runs — only the
last point does. Committing all three megabytes every fifteen minutes would add
about 600KB of compressed git objects each time: 59MB a day, 1.7GB a month, on
a repository currently under a hundred. The history would have destroyed the
repo inside a month to keep one number current.

So the tip is separated. prices-latest.json holds the last close, the one
before it and the currency — a few tens of kilobytes — and is the only file the
quarter-hourly job writes. The history is refreshed hourly alongside the other
data. pricefloor.js reads both and splices the tip onto the daily series.

Only the daily series gets the tip. A stale final bar matters not at all to a
thirty-week or ten-month average, and splicing into those risks colliding with
the phantom-bar rule that ma.js applies to them.

Run: python3 scripts/fetch_prices.py            # full history
     python3 scripts/fetch_prices.py --latest   # just the tip
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import quality  # noqa: E402 - needs the path above

DOCS = Path(__file__).resolve().parent.parent / "docs"
OUT = DOCS / "data" / "prices.json"          # full history, hourly
OUT_LATEST = DOCS / "data" / "prices-latest.json"   # just the tip, every 15 min
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
SPARK = "https://query1.finance.yahoo.com/v7/finance/spark?symbols="


def universe():
    """Every symbol the site quotes, gathered from the files that define them.

    universe.js is JavaScript, not data, so the symbols are read out of it with
    a regex rather than parsed — it is a list of literal string tuples whose
    first element is always the symbol, and it has been that shape since it was
    extracted. A parser here would be more fragile than the pattern, not less,
    because it would have to understand JS to fail on the same input.
    """
    syms = set()

    js = (DOCS / "universe.js").read_text()
    # ["SYM", "Label", ...] — first string of each literal tuple
    for m in re.finditer(r'\[\s*"([^"]{1,15})"\s*,\s*"', js):
        s = m.group(1)
        # Labels also sit first in some nested tuples; a symbol never contains
        # a space and always carries a ticker's alphabet.
        if " " not in s and re.fullmatch(r"[\^A-Za-z0-9.=\-]+", s):
            syms.add(s)

    for f, key in (("watchlist.json", "sym"), ("portfolio.json", None)):
        p = DOCS / "data" / f
        if not p.exists():
            continue
        rows = json.loads(p.read_text())
        for r in rows:
            s = r.get(key) if key else (r.get("y") or r.get("sym"))
            if s:
                syms.add(s)

    return sorted(syms)


# The three timeframes the site reads, with the windows each one needs. Spark
# honours the interval on a bounded range but ignores it on range=max, which is
# why these are explicit — the same trap the live code documents.
TIMEFRAMES = (("d", "1y", "1d"), ("w", "5y", "1wk"), ("m", "25y", "1mo"))


def fetch(symbols, rng, interval):
    """Closes per symbol for one timeframe, ten at a time — spark's batch size.

    The series is passed through exactly as Yahoo sends it, phantom trailing bar
    and all. ma.js already drops that bar by its own rule, and stripping it here
    as well would remove a real one.
    """
    out = {}
    for i in range(0, len(symbols), 10):
        chunk = symbols[i:i + 10]
        url = (SPARK + ",".join(urllib.parse.quote(s) for s in chunk)
               + "&range=" + rng + "&interval=" + interval)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                j = json.loads(r.read())
        except Exception as e:                    # noqa: BLE001 - one bad chunk is not fatal
            print(f"  ! chunk {i//10}: {type(e).__name__} {e}", file=sys.stderr)
            time.sleep(1.0)
            continue
        for row in (j.get("spark", {}).get("result") or []):
            resp = (row.get("response") or [{}])[0]
            closes = [c for c in ((resp.get("indicators", {}).get("quote") or [{}])[0]
                                  .get("close") or []) if c is not None]
            if not closes:
                continue
            meta = resp.get("meta") or {}
            ts = [t for t, c in zip(resp.get("timestamp") or [], (resp.get("indicators", {})
                  .get("quote") or [{}])[0].get("close") or []) if c is not None]
            # Six significant figures is more than any instrument here needs and
            # roughly halves the file against raw floats.
            out[row["symbol"]] = {
                "ccy": meta.get("currency"),
                "t": ts,                                   # epoch seconds, aligned to c
                "c": [round(x, 6) for x in closes],
            }
        time.sleep(0.35)                                  # Yahoo is generous, not infinite
    return out


def fetch_quotes(symbols):
    """Live price and the true previous close, ten symbols at a time.

    Uses the intraday endpoint purely for its metadata. It is the only batched
    call carrying `previousClose`, and that number is the reference the exchange
    itself uses — which, for anything trading around the clock, is not the close
    of the previous daily bar.

    Gold exposed it. Yahoo cuts GC=F daily bars at midnight New York, but the
    contract's session runs to 17:00 New York, so the bar labelled Thursday
    closed at 4609.7 while Thursday actually settled at 4664.0. Measuring
    Friday's 4628 against the bar made gold read 0.5% UP on a day it was 0.8%
    DOWN — a sign error on the instrument this dashboard is most often opened to
    check, which also fed the written session summary ("gold and the dollar
    rising together points at haven demand"). Bitcoin was inverted the same way
    and copper was out by a factor of sixteen. Equities were untouched, because
    for them the daily bar and the session are the same thing, which is why it
    went unnoticed.

    regularMarketPrice comes back here too and is fresher than the last daily
    bar, so it becomes the tip's current price.
    """
    out = {}
    for i in range(0, len(symbols), 10):
        chunk = symbols[i:i + 10]
        url = (SPARK + ",".join(urllib.parse.quote(s) for s in chunk)
               + "&range=1d&interval=5m")
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                j = json.loads(r.read())
        except Exception as e:                    # noqa: BLE001 - one bad chunk is not fatal
            print(f"  ! quotes chunk {i//10}: {type(e).__name__} {e}", file=sys.stderr)
            time.sleep(1.0)
            continue
        for row in (j.get("spark", {}).get("result") or []):
            m = (row.get("response") or [{}])[0].get("meta") or {}
            px, prev = m.get("regularMarketPrice"), m.get("previousClose")
            if px is None:
                continue
            rec = {"c": round(px, 6), "ccy": m.get("currency")}
            if prev is not None:
                rec["p"] = round(prev, 6)
            if m.get("regularMarketTime"):
                rec["t"] = m["regularMarketTime"]
            out[row["symbol"]] = rec
        time.sleep(0.35)
    return out


def main_latest():
    """The quarter-hourly path: current price and true previous close."""
    syms = universe()
    tip = fetch_quotes(syms)

    # Whatever the quote call missed falls back to daily bars, which are right
    # for everything whose session matches the calendar day — every listed
    # equity and fund — and wrong only for the round-the-clock instruments the
    # quote call almost always covers anyway.
    missing = [s for s in syms if s not in tip]
    if missing:
        print(f"  {len(missing)} without a quote; falling back to daily bars")
        for sym, rec in fetch(missing, "5d", "1d").items():
            c, t = rec["c"], rec["t"]
            if not c:
                continue
            tip[sym] = {"c": c[-1], "ccy": rec["ccy"]}
            if len(c) > 1:
                tip[sym]["p"] = c[-2]
            if t:
                tip[sym]["t"] = t[-1]

    if not tip:
        sys.exit("aborting: no prices fetched")
    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "Yahoo Finance, fetched server-side",
           "latest": tip}
    cov = len(tip) / max(1, len(syms))
    old_cov = lambda old: len(old.get("latest") or {}) / max(1, len(syms))
    if not quality.safe_to_write(OUT_LATEST, cov, old_cov, "prices-latest.json"):
        sys.exit(1)
    OUT_LATEST.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT_LATEST} ({OUT_LATEST.stat().st_size // 1024} KB): "
          f"{len(tip)}/{len(syms)} symbols ({cov:.0%})")


def main():
    syms = universe()
    print(f"universe: {len(syms)} symbols")

    prices = fetch(syms, "1y", "1d")
    print(f"  daily:   {len(prices)}")
    # Weekly and monthly matter as much as daily: the trend map is built
    # entirely from them, and eight other pages toggle them on. Without them
    # the floor leaves that page blank, which is honest but useless.
    for key, rng, interval in TIMEFRAMES[1:]:
        got = fetch(syms, rng, interval)
        print(f"  {interval:5}:  {len(got)}")
        for sym, rec in got.items():
            if sym in prices:
                prices[sym][key] = {"t": rec["t"], "c": rec["c"]}

    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "Yahoo Finance, fetched server-side",
           "prices": prices}

    if not prices:
        sys.exit("aborting: no prices fetched")

    # Same discipline as the other feeds: a run that comes back mostly empty
    # must not replace a full one. Here coverage is simply how much of the
    # universe got a close.
    cov = len(prices) / max(1, len(syms))
    old_cov = lambda old: len(old.get("prices") or {}) / max(1, len(syms))
    if not quality.safe_to_write(OUT, cov, old_cov, "prices.json"):
        sys.exit(1)

    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB): "
          f"{len(prices)}/{len(syms)} symbols ({cov:.0%})")


if __name__ == "__main__":
    if "--latest" in sys.argv:
        main_latest()
    else:
        main()
