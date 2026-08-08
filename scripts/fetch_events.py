#!/usr/bin/env python3
"""Fetch earnings/dividend calendar and last reported quarter for every symbol
on the watchlist, writing docs/data/watch-events.json.

Yahoo's quoteSummary endpoint is cookie+crumb gated, which a browser page
cannot do cross-origin — so this runs in CI (hourly, alongside the data
refresh) and the page reads the committed JSON.
"""

import json
import sys
import time
import subprocess
import tempfile
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
OUT = DOCS / "data" / "watch-events.json"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def curl(args, jar):
    base = ["curl", "-s", "--max-time", "30", "-A", UA, "-c", jar, "-b", jar]
    r = subprocess.run(base + args, capture_output=True, text=True, timeout=60)
    return r.stdout


def curl_with_code(url, jar):
    out = curl(["-w", "\n%{http_code}", url], jar)
    body, _, code = out.rpartition("\n")
    return body, code


def opener_with_crumb():
    """urllib gets fingerprint-blocked by Yahoo where curl does not, so the
    HTTP layer shells out to curl with a shared cookie jar."""
    jar = tempfile.NamedTemporaryFile(suffix=".jar", delete=False).name
    crumb = None
    for attempt in range(5):
        curl(["-o", "/dev/null", "https://fc.yahoo.com"], jar)
        crumb = curl(["https://query1.finance.yahoo.com/v1/test/getcrumb"], jar).strip()
        if crumb and "<" not in crumb and "Too Many" not in crumb:
            break
        time.sleep(6 * (attempt + 1))
    if not crumb or "<" in crumb:
        raise RuntimeError("could not obtain crumb")
    return jar, crumb


def fetch_symbol(jar, crumb, sym):
    url = ("https://query1.finance.yahoo.com/v10/finance/quoteSummary/"
           f"{urllib.parse.quote(sym)}?modules=calendarEvents,earningsHistory"
           f"&crumb={urllib.parse.quote(crumb)}")
    d = None
    code = "?"
    for attempt in range(4):
        raw, code = curl_with_code(url, jar)
        try:
            d = json.loads(raw)
        except json.JSONDecodeError:
            time.sleep(10 * (attempt + 1))
            continue
        if d.get("finance", {}).get("error") or d.get("quoteSummary", {}).get("error"):
            err = (d.get("finance", {}).get("error") or d.get("quoteSummary", {}).get("error"))
            if "Too Many" in str(err):
                time.sleep(8 * (attempt + 1))
                continue
            raise RuntimeError(str(err))
        break
    if not d:
        raise RuntimeError(f"no parseable response (last HTTP {code})")
    res = d["quoteSummary"]["result"][0]
    out = {}
    cal = res.get("calendarEvents") or {}
    earn = cal.get("earnings") or {}
    dates = [x.get("fmt") for x in earn.get("earningsDate", []) if x.get("fmt")]
    if dates:
        out["earnings"] = dates[0]
        if len(dates) > 1:
            out["earnings_to"] = dates[-1]      # Yahoo often gives a range
    exdiv = (cal.get("exDividendDate") or {}).get("fmt")
    if exdiv:
        out["ex_div"] = exdiv
    hist = (res.get("earningsHistory") or {}).get("history") or []
    if hist:
        last = hist[-1]
        actual = (last.get("epsActual") or {}).get("raw")
        est = (last.get("epsEstimate") or {}).get("raw")
        if actual is not None:
            out["last_eps"] = {
                "quarter_end": (last.get("quarter") or {}).get("fmt"),
                "actual": actual,
                "estimate": est,
                "surprise_pct": round(((last.get("surprisePercent") or {}).get("raw") or 0) * 100, 1),
            }
    return out


def main():
    watchlist = json.loads((DOCS / "data" / "watchlist.json").read_text())
    syms = sorted({p["sym"] for p in watchlist})
    jar, crumb = opener_with_crumb()
    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "symbols": {}}
    fails = 0
    for s in syms:
        try:
            out["symbols"][s] = fetch_symbol(jar, crumb, s)
            print(f"ok   {s}: {out['symbols'][s]}")
        except Exception as e:  # noqa: BLE001 - one symbol must not sink the file
            fails += 1
            print(f"FAIL {s}: {e}", file=sys.stderr)
        time.sleep(1.2)   # be gentle; Yahoo rate-limits bursts
    if not out["symbols"]:
        sys.exit("aborting: every symbol failed")
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT} ({len(out['symbols'])} symbols, {fails} failures)")


if __name__ == "__main__":
    main()
