#!/usr/bin/env python3
"""Fetch earnings/dividend calendar and last reported quarter for every symbol
on the watchlist, writing docs/data/watch-events.json.

Backend: TradingView's public scanner endpoint — keyless, one POST for the
whole list. (The previous Yahoo quoteSummary backend needed a cookie+crumb
handshake and rate-limited both CI and local runs into the ground.)

Run: python3 scripts/fetch_events.py
"""

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
OUT = DOCS / "data" / "watch-events.json"

SCAN_URL = "https://scanner.tradingview.com/global/scan"
COLUMNS = ["name", "earnings_release_next_date", "earnings_release_date",
           "dividend_ex_date_upcoming", "earnings_per_share_fq",
           "earnings_per_share_forecast_fq"]

# Yahoo suffix → TradingView exchange prefix (probed and verified 2026-08-09).
SUFFIX_TV = {
    ".TO": "TSX", ".MI": "MIL", ".L": "LSE", ".PA": "EURONEXT", ".MC": "BME",
    ".JO": "JSE", ".IS": "BIST", ".T": "TSE", ".NS": "NSE", ".AX": "ASX",
    ".HK": "HKEX", ".IR": "EURONEXT", ".DE": "XETR", ".HE": "OMXHEX",
    ".OL": "OSL", ".BR": "EURONEXT", ".AS": "EURONEXT",
}
US_PREFIXES = ["NASDAQ", "NYSE", "AMEX"]   # US listing venue unknown per symbol


def tv_tickers_for(sym):
    """Candidate TradingView tickers for one Yahoo symbol."""
    for suf, prefix in SUFFIX_TV.items():
        if sym.endswith(suf):
            base = sym[: -len(suf)]
            if suf == ".HK":
                base = base.lstrip("0") or "0"
            return [f"{prefix}:{base}"]
    return [f"{p}:{sym}" for p in US_PREFIXES]


def scan(tickers):
    payload = json.dumps({"symbols": {"tickers": tickers}, "columns": COLUMNS})
    r = subprocess.run(
        ["curl", "-s", "--max-time", "40", "-X", "POST", SCAN_URL,
         "-H", "Content-Type: application/json",
         "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
         "-d", payload],
        capture_output=True, text=True, timeout=60)
    return json.loads(r.stdout)["data"]


def iso(epoch):
    if not epoch:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d")


def main():
    watchlist = json.loads((DOCS / "data" / "watchlist.json").read_text())
    syms = sorted({p["sym"] for p in watchlist})
    tv_to_yahoo = {}
    tickers = []
    for s in syms:
        for tv in tv_tickers_for(s):
            tv_to_yahoo[tv] = s
            tickers.append(tv)

    rows = scan(tickers)
    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "TradingView scanner",
           "symbols": {}}
    for row in rows:
        ysym = tv_to_yahoo.get(row["s"])
        if not ysym or ysym in out["symbols"]:
            continue                      # first hit wins for US multi-prefix
        name, next_earn, last_earn, ex_div, eps, eps_est = row["d"]
        rec = {}
        if next_earn:
            rec["earnings"] = iso(next_earn)
        if ex_div:
            d = iso(ex_div)
            if d and d >= datetime.now(timezone.utc).strftime("%Y-%m-%d"):
                rec["ex_div"] = d
        if eps is not None:
            surprise = None
            if eps_est not in (None, 0):
                surprise = round((eps - eps_est) / abs(eps_est) * 100, 1)
            rec["last_eps"] = {
                "reported": iso(last_earn),
                "actual": round(eps, 3),
                "estimate": round(eps_est, 3) if eps_est is not None else None,
                "surprise_pct": surprise,
            }
        if rec:
            out["symbols"][ysym] = rec
    missing = [s for s in syms if s not in out["symbols"]]
    if not out["symbols"]:
        sys.exit("aborting: scanner returned nothing usable")
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT}: {len(out['symbols'])}/{len(syms)} symbols"
          + (f" (missing: {', '.join(missing)})" if missing else ""))


if __name__ == "__main__":
    main()
