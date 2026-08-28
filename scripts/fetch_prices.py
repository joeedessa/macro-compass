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

Run: python3 scripts/fetch_prices.py
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
OUT = DOCS / "data" / "prices.json"
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
    main()
