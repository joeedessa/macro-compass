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
from zoneinfo import ZoneInfo

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

    # Scanning every page also harvests the page furniture. Period buttons
    # ("1D", "3M", "YTD"), moving-average lengths ("50", "200") and bare
    # numbers all pass a ticker-shaped test, and the ten that sorted first went
    # out as one batch and made Yahoo 404 the entire request — taking four real
    # symbols down with them, because a batch is all-or-nothing. Junk in a
    # symbol list is not merely noise; it costs the symbols it travels with.
    JUNK = re.compile(r"^(\d+|\d+[DWMY]|YTD|MAX)$")

    # universe.js is not the whole universe. It was treated as though it were,
    # and the Today page defines its own lists inline — so every non-US index
    # it draws (Nikkei, FTSE, DAX, Hang Seng, KOSPI, Bovespa and twenty more)
    # was absent from the snapshot entirely. Nobody noticed while the live feed
    # answered, because those symbols were fetched in the browser; the moment
    # the page fell back to the snapshot the whole "Around the world" section
    # and every session clock had nothing to draw. A file listing the symbols
    # to fetch that silently omits a third of them is worse than no list.
    #
    # So every page is scanned, on the same literal-tuple pattern. Reading the
    # pages is what keeps this correct when a page adds a market: the
    # alternative is a hand-kept list that drifts, which is the bug being
    # fixed here.
    sources = [(DOCS / "universe.js").read_text()]
    sources += [f.read_text() for f in sorted(DOCS.glob("*.html"))]

    for js in sources:
        # Flat lists of plain strings are labels, not instruments — REGIONS is
        # ["Americas", "Europe", ...] and its first element looks exactly like
        # a ticker to the pattern below.
        js = re.sub(r"const REGIONS = \[[^\]]*\];", "", js)

        # ["SYM", "Label", ...] — the leading string of each literal tuple, and
        # the second one too, because the session list is written the other way
        # round as ["Tokyo", "^N225"].
        # The second group is left unbounded and length-checked below: capping
        # it in the pattern made the whole match fail whenever the label was
        # long, which quietly dropped ["^BVSP", "Brazil · Bovespa"] and every
        # other tuple with a label over fifteen characters.
        for m in re.finditer(r'\[\s*"([^"]{1,15})"\s*,\s*"([^"]*)"', js):
            for cand in m.groups():
                if len(cand) > 15:
                    continue
                # Case is what separates a ticker from a place. Every symbol on
                # this site is upper case — SPY, ^N225, FTSEMIB.MI, 000300.SS,
                # 7936.T — and the labels sitting in the same position are
                # words: Tokyo, London, Frankfurt. Allowing lower case here
                # meant fetching cities on every run and printing a warning
                # for each, which is how real warnings stop being read.
                if cand and " " not in cand and re.fullmatch(r"[\^A-Z0-9.=\-]+", cand) \
                        and not JUNK.match(cand):
                    syms.add(cand)

    # These three are lists of instruments by definition, so anything in them
    # that fails to quote is a real failure worth hearing about.
    authoritative = set(re.findall(r'\[\s*"([^"]{1,15})"\s*,\s*"',
                                   (DOCS / "universe.js").read_text()))
    for f, key in (("watchlist.json", "sym"), ("portfolio.json", None)):
        p = DOCS / "data" / f
        if not p.exists():
            continue
        rows = json.loads(p.read_text())
        for r in rows:
            s = r.get(key) if key else (r.get("y") or r.get("sym"))
            if s:
                syms.add(s)
                authoritative.add(s)
    authoritative &= syms

    # Everything the page scan proposed that no authoritative list confirms.
    # "KOSPI", "KOSDAQ" and "VIX" are labels sitting where a ticker sits, and
    # nothing about their shape says so — the real symbols are ^KS11 and ^VIX.
    # They cost one lookup each and resolve to nothing, which is fine; what is
    # not fine is reporting them as symbols that failed, because a warning that
    # fires every run for a non-problem is how a real one gets missed.
    return sorted(syms), sorted(syms - authoritative)


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


def session_hours(meta):
    """The exchange's regular session as local wall-clock minutes past midnight.

    Returns (timezone name, open, close), or None when Yahoo does not give
    enough to be sure. Storing the local clock rather than the epochs Yahoo
    sends is what makes this survive being read the next day, and storing the
    timezone name rather than a UTC offset is what makes it survive the clocks
    changing: London is +1 today and +0 in November, and a stored offset would
    silently move the London open by an hour for four months of the year.

    A session that appears to end before it starts has crossed local midnight,
    which no cash equity session here does. Rather than guess, nothing is
    stored and the reader falls back to saying it does not know.
    """
    tz = meta.get("exchangeTimezoneName")
    reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    start, end = reg.get("start"), reg.get("end")
    if not tz or start is None or end is None:
        return None
    try:
        zone = ZoneInfo(tz)
    except Exception:                         # noqa: BLE001 - unknown zone name
        return None
    lo = datetime.fromtimestamp(start, zone)
    hi = datetime.fromtimestamp(end, zone)
    o, c = lo.hour * 60 + lo.minute, hi.hour * 60 + hi.minute
    if c <= o:
        return None
    return [tz, o, c]


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

    The exchange's trading hours are taken here as well, because this is the
    only place they are available. Yahoo gives the session as a pair of epochs
    for the day of the request, which is useless a few hours later, so they are
    converted to the exchange's own local clock — 09:00 to 15:30 in Tokyo — and
    that is what gets stored. Local opening hours are a property of the
    exchange rather than of the day, so the client can rebuild the session
    boundaries for whatever day it is being read on.
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
            hours = session_hours(m)
            if hours:
                rec["z"] = hours
            out[row["symbol"]] = rec
        time.sleep(0.35)
    return out


def main_latest():
    """The quarter-hourly path: current price and true previous close."""
    syms, speculative = universe()
    tip = fetch_quotes(syms)

    # Whatever the quote call missed falls back to daily bars, which are right
    # for everything whose session matches the calendar day — every listed
    # equity and fund — and wrong only for the round-the-clock instruments the
    # quote call almost always covers anyway.
    missing = [s for s in syms if s not in tip]
    if missing:
        spec = set(speculative)
        real = [s for s in missing if s not in spec]
        print(f"  {len(missing)} without a quote "
              f"({len(real)} from the instrument lists); falling back to daily bars")
        if real:
            print(f"    {', '.join(real)}")
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
    # The hours are shared: a few dozen exchanges stand behind a few hundred
    # symbols. Held inline they would add about half again to a file that is
    # committed every fifteen minutes, so they are deduplicated into a table
    # and each symbol keeps an index into it.
    table, index = [], {}
    for rec in tip.values():
        h = rec.pop("z", None)
        if not h:
            continue
        key = "|".join(map(str, h))
        if key not in index:
            index[key] = len(table)
            table.append(h)
        rec["z"] = index[key]

    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "Yahoo Finance, fetched server-side",
           "sessions": table,
           "latest": tip}
    cov = len(tip) / max(1, len(syms))
    old_cov = lambda old: len(old.get("latest") or {}) / max(1, len(syms))
    if not quality.safe_to_write(OUT_LATEST, cov, old_cov, "prices-latest.json"):
        sys.exit(1)
    OUT_LATEST.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT_LATEST} ({OUT_LATEST.stat().st_size // 1024} KB): "
          f"{len(tip)}/{len(syms)} symbols ({cov:.0%})")


def main():
    syms, _speculative = universe()
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
