#!/usr/bin/env python3
"""What each moving average is worth, measured, into docs/data/ma-stats.json.

The method page carries a table of how often each average is crossed, how often
those crosses reverse, and how much time price spends hugging the line. Those
numbers were produced once by hand and pasted into the HTML, which is the wrong
way round for a page whose entire purpose is being checkable: the script lived
in a shell, so nobody could re-run it, audit it, or say when it was measured.

They do not go stale quickly. Measured against itself, the 200-day figure moves
0.00 crosses a year over one day, 0.16 over a month and 0.78 over three — these
are structural properties of a five-to-twenty-five-year sample, not prices. But
"changes slowly" is a reason to refresh monthly, not a reason to have no
provenance at all.

Sample: forty instruments spanning equities, bonds, credit, metals, energy,
agriculture and single countries, so no one asset class sets the answer.

Run: python3 scripts/measure_ma.py
"""

import json
import statistics as st
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import quality  # noqa: E402 - needs the path above

DOCS = Path(__file__).resolve().parent.parent / "docs"
OUT = DOCS / "data" / "ma-stats.json"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
SPARK = "https://query1.finance.yahoo.com/v7/finance/spark?symbols="

SAMPLE = ["SPY", "QQQ", "IWM", "EFA", "EEM", "TLT", "HYG", "LQD", "GLD", "SLV",
          "GC=F", "CL=F", "HG=F", "DBA", "XLE", "XLF", "XLK", "XLU", "XLV", "XLP",
          "XLI", "XLY", "XBI", "SMH", "EWJ", "EWG", "EWU", "EWZ", "FXI", "INDA",
          "MCHI", "VNQ", "URA", "XME", "GDX", "COPX", "MOO", "IJH", "IJR", "RSP"]

# (key, range, interval, bars per year, label, unit, months per bar)
TIMEFRAMES = [("d", "5y", "1d", 252, "Daily", "sessions", 1 / 21),
              ("w", "5y", "1wk", 52, "Weekly", "weeks", 1 / 4.33),
              ("m", "25y", "1mo", 12, "Monthly", "months", 1.0)]
PERIODS = {"d": [50, 150, 200], "w": [10, 30, 40], "m": [10, 12, 20]}


def fetch(symbols, rng, interval):
    """Closes per symbol, ten at a time — spark's batch size.

    The daily series is fetched at five years rather than read from
    prices.json. That file holds one year, which is fewer bars than a 200-day
    average needs to produce its first value: the first version of this
    measurement drew from it and the 150- and 200-day rows were computed from
    two instruments out of three hundred, presented beside rows built from
    three hundred and ten. A file sized for the price fallback is not a
    statistics source.
    """
    out = {}
    for i in range(0, len(symbols), 10):
        url = (SPARK + ",".join(urllib.parse.quote(s) for s in symbols[i:i + 10])
               + "&range=" + rng + "&interval=" + interval)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r:
                j = json.loads(r.read())
        except Exception as e:                    # noqa: BLE001 - one bad chunk is not fatal
            print(f"  ! chunk {i // 10}: {type(e).__name__} {e}", file=sys.stderr)
            time.sleep(1.0)
            continue
        for row in (j.get("spark", {}).get("result") or []):
            resp = (row.get("response") or [{}])[0]
            closes = [c for c in ((resp.get("indicators", {}).get("quote") or [{}])[0]
                                  .get("close") or []) if c is not None]
            if closes:
                out[row["symbol"]] = closes
        time.sleep(0.35)
    return out


def sma(v, n):
    out, s = [], 0.0
    for i, x in enumerate(v):
        s += x
        if i >= n:
            s -= v[i - n]
        if i >= n - 1:
            out.append(s / n)
    return out


def analyse(series, period, bars_per_year):
    """Crosses a year, how many reverse quickly, and time spent near the line.

    "Reverse quickly" is proportional — under 15% of the averaging window, so
    thirty sessions on a 200-day and three months on a 10-month. A fixed number
    of bars would flatter the slow lines, which is the comparison the table
    exists to make.
    """
    per_year, rev, tot, short_time, all_time = [], 0, 0, 0, 0
    for v in series.values():
        if len(v) < period + bars_per_year:
            continue
        ma = sma(v, period)
        off = len(v) - len(ma)
        side = [v[i + off] >= ma[i] for i in range(len(ma))]
        runs, last, run = [], side[0], 1
        for s in side[1:]:
            if s == last:
                run += 1
            else:
                runs.append(run)
                last, run = s, 1
        runs.append(run)
        if len(runs) < 3:
            continue
        # The first and last stretches are cut off by the window, not by price.
        inner = runs[1:-1]
        per_year.append((len(runs) - 1) / (len(side) / bars_per_year))
        short = max(3, round(period * 0.15))
        rev += sum(1 for x in inner if x <= short)
        tot += len(inner)
        short_time += sum(x for x in inner if x <= short)
        all_time += sum(inner)
    if not per_year:
        return None
    return {"instruments": len(per_year),
            "crosses_per_year": round(st.median(per_year), 1),
            "reverse_pct": round(100 * rev / max(1, tot)),
            "chop_pct": round(100 * short_time / max(1, all_time)),
            # Lag is arithmetic: the mean age of the data inside an n-period
            # average is (n-1)/2 bars. Not measured, derived.
            "lag_bars": (period - 1) / 2}


def main():
    rows = []
    for key, rng, interval, bpy, tf_label, unit, months in TIMEFRAMES:
        series = fetch(SAMPLE, rng, interval)
        print(f"  {tf_label:8} {len(series)}/{len(SAMPLE)} symbols")
        for period in PERIODS[key]:
            r = analyse(series, period, bpy)
            if not r:
                continue
            # The lag phrase is built once, here, rather than formatted again in
            # the page. Doing it in both places had them disagree: JavaScript
            # rounds 24.5 up to 25 and Python rounds it to 24, so the shipped
            # HTML and the rendered table differed by a session on the same
            # figure. One string, one source.
            lag_m = r["lag_bars"] * months
            r.update(line=f"{tf_label} {period}", timeframe=tf_label.lower(), period=period,
                     lag_unit=unit, lag_months=round(lag_m, 1),
                     lag_text=f"{round(r['lag_bars'])} {unit} "
                              f"(~{lag_m:.1f} month{'' if abs(lag_m - 1) < 0.05 else 's'})")
            rows.append(r)

    if len(rows) < len(PERIODS["d"]) + len(PERIODS["w"]) + len(PERIODS["m"]):
        print(f"  ! only {len(rows)} rows measured", file=sys.stderr)

    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "sample": len(SAMPLE),
           "windows": {"daily": "5 years", "weekly": "5 years", "monthly": "25 years"},
           "rows": rows}

    cov = len(rows) / 9
    old_cov = lambda old: len(old.get("rows") or []) / 9
    if not quality.safe_to_write(OUT, cov, old_cov, "ma-stats.json"):
        sys.exit(1)
    OUT.write_text(json.dumps(out, indent=1))
    print(f"wrote {OUT}: {len(rows)} lines measured on {len(SAMPLE)} instruments")


if __name__ == "__main__":
    main()
