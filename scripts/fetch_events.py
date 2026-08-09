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
# The scanner normalises fundamentals to USD unless asked otherwise, which would
# put a USD price target beside a JPY quote. price_conversion to_symbol returns
# every fundamental in the instrument's own listing currency instead.
PRICE_CONVERSION = {"to_symbol": True}
COLUMNS = [
    "name", "currency", "sector",
    # calendar
    "earnings_release_next_date", "earnings_release_date",
    "earnings_publication_type_next_fq", "earnings_publication_type_fq",
    "dividend_ex_date_upcoming",
    # last reported quarter, actual vs consensus
    "earnings_per_share_fq", "earnings_per_share_forecast_fq",
    "revenue_fq", "revenue_forecast_fq",
    "earnings_per_share_diluted_yoy_growth_fq",
    # what the street expects next
    "earnings_per_share_forecast_next_fq", "revenue_forecast_next_fq",
    "price_target_average",
    "recommendation_buy", "recommendation_over", "recommendation_hold",
    "recommendation_under", "recommendation_sell", "recommendation_total",
]
# earnings_publication_type_* encodes the slot in its last digit; verified
# against known reporters (JPM/Fastenal premarket, NVDA after the close).
PUB_SLOT = {1: "before open", 2: "after close", 3: "during session"}

# Yahoo suffix → TradingView exchange prefix (probed and verified 2026-08-09).
SUFFIX_TV = {
    ".TO": "TSX", ".MI": "MIL", ".L": "LSE", ".PA": "EURONEXT", ".MC": "BME",
    ".JO": "JSE", ".IS": "BIST", ".T": "TSE", ".NS": "NSE", ".AX": "ASX",
    ".HK": "HKEX", ".IR": "EURONEXT", ".DE": "XETR", ".HE": "OMXHEX",
    ".OL": "OSL", ".BR": "EURONEXT", ".AS": "EURONEXT", ".V": "TSXV",
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
    payload = json.dumps({"symbols": {"tickers": tickers}, "columns": COLUMNS,
                          "price_conversion": PRICE_CONVERSION})
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


def rnd(v, n=3):
    return None if v is None else round(v, n)


def surprise_pct(actual, est):
    """Percentage beat/miss. Currency-free: both sides are the same units, so
    this stays valid whatever the listing currency."""
    if actual is None or est in (None, 0):
        return None
    return round((actual - est) / abs(est) * 100, 1)


def slot(code):
    return PUB_SLOT.get(int(code) % 10) if code is not None else None


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
        d = dict(zip(COLUMNS, row["d"]))
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        rec = {}
        if d.get("sector"):
            rec["sector"] = d["sector"]
        if d.get("currency"):
            rec["ccy"] = d["currency"]
        if d.get("earnings_release_next_date"):
            rec["earnings"] = iso(d["earnings_release_next_date"])
            when = slot(d.get("earnings_publication_type_next_fq"))
            if when:
                rec["earnings_when"] = when
        if d.get("dividend_ex_date_upcoming"):
            ex = iso(d["dividend_ex_date_upcoming"])
            if ex and ex >= today:
                rec["ex_div"] = ex
        eps, eps_est = d.get("earnings_per_share_fq"), d.get("earnings_per_share_forecast_fq")
        rev, rev_est = d.get("revenue_fq"), d.get("revenue_forecast_fq")
        if eps is not None or rev is not None:
            last = {"reported": iso(d.get("earnings_release_date")),
                    "when": slot(d.get("earnings_publication_type_fq")),
                    "actual": rnd(eps), "estimate": rnd(eps_est),
                    "surprise_pct": surprise_pct(eps, eps_est),
                    "eps_yoy": rnd(d.get("earnings_per_share_diluted_yoy_growth_fq"), 1)}
            if rev is not None:
                last["revenue"] = round(rev)
                last["revenue_est"] = round(rev_est) if rev_est is not None else None
                last["revenue_surprise_pct"] = surprise_pct(rev, rev_est)
            rec["last_eps"] = {k: v for k, v in last.items() if v is not None}
        nxt = {"eps": rnd(d.get("earnings_per_share_forecast_next_fq")),
               "revenue": round(d["revenue_forecast_next_fq"])
                          if d.get("revenue_forecast_next_fq") is not None else None}
        nxt = {k: v for k, v in nxt.items() if v is not None}
        if nxt:
            rec["next_est"] = nxt
        if d.get("price_target_average"):
            rec["target_avg"] = rnd(d["price_target_average"], 2)
        # Raw analyst counts rather than TradingView's composite mark, whose
        # scale is undocumented; buy/overweight/hold/underweight/sell are literal.
        ratings = {k: d.get("recommendation_" + k) or 0
                   for k in ("buy", "over", "hold", "under", "sell")}
        if d.get("recommendation_total"):
            ratings["total"] = d["recommendation_total"]
            rec["ratings"] = ratings
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
