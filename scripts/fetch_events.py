#!/usr/bin/env python3
"""Fetch earnings/dividend calendar and last reported quarter for every symbol
on the watchlist, writing docs/data/watch-events.json.

Backend: TradingView's public scanner endpoint — keyless, one POST for the
whole list. (The previous Yahoo quoteSummary backend needed a cookie+crumb
handshake and rate-limited both CI and local runs into the ground.)

Run: python3 scripts/fetch_events.py
"""

import json
import re
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

# Run as `python3 scripts/x.py` the script's own directory is already on the
# path; spelled out so the import does not depend on how it was invoked.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import quality  # noqa: E402 - needs the path above

DOCS = Path(__file__).resolve().parent.parent / "docs"
OUT = DOCS / "data" / "watch-events.json"

SCAN_URL = "https://scanner.tradingview.com/global/scan"
# The scanner normalises fundamentals to USD unless asked otherwise, which would
# put a USD price target beside a JPY quote. price_conversion to_symbol returns
# every fundamental in the instrument's own listing currency instead.
PRICE_CONVERSION = {"to_symbol": True}
COLUMNS = [
    "name", "description", "currency", "sector",
    # calendar
    "earnings_release_next_date", "earnings_release_date",
    "earnings_publication_type_next_fq", "earnings_publication_type_fq",
    "dividend_ex_date_upcoming",
    # ATR, the price it belongs to, and the size of the next dividend. On this
    # site these are one question, not three. A trailing stop set at a multiple
    # of ATR is a bet that a move that large means something; a stock going
    # ex-dividend drops by roughly the dividend for no reason at all, and if
    # that drop is a real fraction of the ATR it can close a position nothing
    # has actually gone wrong with. Carried together so the page can say how
    # much of the stop the dividend is about to eat.
    #
    # TradingView's ATR is the 14-period Wilder average — checked against an
    # independent calculation on four names, matching to within 0.2%.
    "ATR", "close", "dividend_amount_upcoming",
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

# ---------------------------------------------------------------------------
# Guidance wire. Company-issued guidance is not published as structured data by
# any free source, but the wires say it in words. So we classify the LANGUAGE of
# headlines and never parse a number out of prose — the headline is shown
# verbatim and linked, so the reader always sees the primary text.
#
# The hard problem is making sure a headline describes THIS release and not the
# previous quarter. The release date is the gate: anything published before it
# is discarded outright.
CUES = [
    ("guide_up", "guidance raised",
     ["raises guidance", "raises outlook", "raises forecast", "lifts forecast",
      "lifts outlook", "lifts guidance", "lifts full-year", "boosts forecast",
      "boosts outlook", "hikes forecast", "upbeat forecast", "raises full-year",
      "raises fy", "upgrades outlook", "guides above", "raises annual"]),
    ("guide_down", "guidance cut",
     ["cuts guidance", "lowers outlook", "cuts forecast", "trims forecast",
      "slashes forecast", "profit warning", "cuts full-year", "lowers guidance",
      "cuts outlook", "guides below", "warns on", "lowers forecast", "cuts annual"]),
    ("beat", "beat",
     ["beats", "tops ", "above estimate", "above expectation", "exceeds",
      "surpass", "better than expected", "stronger than expected", "blows past",
      "crushes", "ahead of estimate"]),
    ("miss", "miss",
     ["misses", "falls short", "below estimate", "below expectation",
      "worse than expected", "disappoint", "shortfall", "trails estimate"]),
    ("record", "record quarter",
     ["record revenue", "record profit", "record quarter", "record sales",
      "record eps", "record results", "record high"]),
    ("payout", "dividend/buyback",
     ["dividend", "buyback", "share repurchase", "special dividend"]),
]
EARN_WORDS = ["earnings", "results", "profit", "revenue", "quarter", "q1", "q2",
              "q3", "q4", "guidance", "outlook", "forecast", "beats", "misses",
              "sales", "income"]
WIRE_BACK_DAYS = 45     # look at names that reported inside this window
WIRE_FWD_DAYS = 2       # ...or are about to report

# Yahoo suffix → TradingView exchange prefix (probed and verified 2026-08-09).
SUFFIX_TV = {
    ".TO": "TSX", ".MI": "MIL", ".L": "LSE", ".PA": "EURONEXT", ".MC": "BME",
    ".JO": "JSE", ".IS": "BIST", ".T": "TSE", ".NS": "NSE", ".AX": "ASX",
    ".HK": "HKEX", ".IR": "EURONEXT", ".DE": "XETR", ".HE": "OMXHEX",
    ".OL": "OSL", ".BR": "EURONEXT", ".AS": "EURONEXT", ".V": "TSXV",
    # Tel Aviv. Prices there are quoted in agorot, a hundredth of a shekel, and
    # both feeds agree on that — Yahoo reports the currency as ILA and the
    # scanner returns the same 420.4 — so nothing needs converting. Worth
    # knowing before someone "fixes" a level that looks a hundred times too big.
    ".TA": "TASE",
}
US_PREFIXES = ["NASDAQ", "NYSE", "AMEX"]   # US listing venue unknown per symbol


def tv_tickers_for(sym):
    """Candidate TradingView tickers for one Yahoo symbol."""
    for suf, prefix in SUFFIX_TV.items():
        if sym.endswith(suf):
            base = sym[: -len(suf)]
            if suf == ".HK":
                base = base.lstrip("0") or "0"
            # Share classes: Yahoo separates them with a dash, TradingView with
            # a dot — CGI is GIB-A.TO to one and TSX:GIB.A to the other. Without
            # this the symbol resolves for prices (Yahoo) and silently vanishes
            # from earnings and dividends (TradingView), which is the kind of
            # half-presence nothing downstream reports.
            if "-" in base:
                return [f"{prefix}:{base.replace('-', '.')}", f"{prefix}:{base}"]
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


def google_news(query):
    """Google News RSS — keyless. Returns [(title, link, date, source)]."""
    url = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(query) +
           "&hl=en-US&gl=US&ceid=US:en")
    r = subprocess.run(
        ["curl", "-s", "--max-time", "20", "-H",
         "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", url],
        capture_output=True, text=True, timeout=30)
    out = []
    try:
        root = ET.fromstring(r.stdout)
    except ET.ParseError:
        return out
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        src = item.findtext("source") or ""
        try:                       # RFC-822: "Tue, 14 Jul 2026 11:30:00 GMT"
            when = datetime.strptime(pub[:16], "%a, %d %b %Y").strftime("%Y-%m-%d")
        except ValueError:
            continue
        # Google appends " - Publisher" to titles; drop it, we show source apart.
        title = re.sub(r"\s+-\s+[^-]+$", "", title).strip()
        if title:
            out.append((title, link, when, src))
    return out


def guidance_wire(name, reported):
    """Classify wire language about one company's latest results.

    `reported` gates the search: a headline published before the release cannot
    be describing it. Returns None when nothing on the wire qualifies."""
    heads, cues = [], []
    for title, link, when, src in google_news(f'"{name}" earnings results'):
        if when < reported:
            continue                      # published pre-release: wrong quarter
        low = title.lower()
        if not any(w in low for w in EARN_WORDS):
            continue
        for _key, label, pats in CUES:
            if any(pat in low for pat in pats) and label not in cues:
                cues.append(label)
        heads.append({"t": title, "u": link, "d": when, "s": src})
        if len(heads) >= 4:
            break
    if not heads:
        return None
    return {"cues": cues, "heads": heads, "gate": reported}


def main():
    watchlist = json.loads((DOCS / "data" / "watchlist.json").read_text())
    syms = sorted({p["sym"] for p in watchlist})
    tv_to_yahoo = {}
    tickers = []
    for s in syms:
        for tv in tv_tickers_for(s):
            tv_to_yahoo[tv] = s
            tickers.append(tv)

    # A throttled scanner answers with the right symbols and null fundamentals,
    # so retry on thinness rather than on failure — nothing here ever fails.
    rows = quality.retry_until_dense(
        lambda: [dict(zip(COLUMNS, r["d"]), s=r["s"]) for r in scan(tickers)],
        ["earnings_release_next_date", "earnings_release_date", "price_target_average"],
        "watch events")
    rows = [{"s": r["s"], "d": [r[c] for c in COLUMNS]} for r in rows]
    # Company name for the news query: TradingView's description, falling back
    # to the note the watchlist itself carries.
    names = {p["sym"]: p["note"] for p in watchlist if p.get("note")}
    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "TradingView scanner",
           "symbols": {}}
    for row in rows:
        ysym = tv_to_yahoo.get(row["s"])
        if not ysym or ysym in out["symbols"]:
            continue                      # first hit wins for US multi-prefix
        d = dict(zip(COLUMNS, row["d"]))
        if d.get("description"):
            names[ysym] = d["description"]
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
        if d.get("ATR") is not None:
            rec["atr"] = rnd(d["ATR"], 4)
            if d.get("close"):
                rec["atr_pct"] = rnd(d["ATR"] / d["close"] * 100, 2)
        if d.get("dividend_amount_upcoming") is not None:
            rec["div_amount"] = rnd(d["dividend_amount_upcoming"], 4)
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
    # Guidance wire for names whose results are recent enough to still matter.
    today_d = datetime.now(timezone.utc).date()
    wired = 0
    for ysym, rec in out["symbols"].items():
        last = rec.get("last_eps", {})
        reported = last.get("reported")
        nxt = rec.get("earnings")
        recent = reported and (today_d - datetime.strptime(reported, "%Y-%m-%d").date()).days <= WIRE_BACK_DAYS
        imminent = nxt and 0 <= (datetime.strptime(nxt, "%Y-%m-%d").date() - today_d).days <= WIRE_FWD_DAYS
        if not (recent or imminent):
            continue
        name = names.get(ysym) or ysym
        try:
            wire = guidance_wire(name, reported or today_d.isoformat())
        except Exception:                  # noqa: BLE001 - the wire is a bonus
            wire = None
        if wire:
            rec["wire"] = wire
            wired += 1
        time.sleep(0.25)                   # be polite to the news endpoint
    print(f"guidance wire: {wired} names carry headlines")

    missing = [s for s in syms if s not in out["symbols"]]
    if not out["symbols"]:
        sys.exit("aborting: scanner returned nothing usable")

    # The calendar on the Today page is built entirely from these two fields,
    # so they are the ones worth measuring: a file that keeps its symbols and
    # loses its dates leaves that section blank while looking healthy.
    cov = quality.coverage(out["symbols"].values(), ["earnings", "ex_div"])
    old_cov = lambda old: quality.coverage(
        (old.get("symbols") or {}).values(), ["earnings", "ex_div"])
    if not quality.safe_to_write(OUT, cov, old_cov, "watch-events.json"):
        sys.exit(1)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT}: {len(out['symbols'])}/{len(syms)} symbols"
          + (f" (missing: {', '.join(missing)})" if missing else ""))


if __name__ == "__main__":
    main()
