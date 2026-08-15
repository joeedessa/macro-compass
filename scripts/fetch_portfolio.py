#!/usr/bin/env python3
"""Enrich the open-position list with everything the portfolio page needs.

The book runs to 405 names across ten currencies. Fetching that client-side
would mean forty-odd proxied round-trips on every page load, so the whole
enrichment happens here instead: one keyless POST to the TradingView scanner
returns price, ATR, volatility, sector and industry, the earnings calendar with
actual against forecast, and the full dividend picture for every name at once.

Two positions trade only on Yahoo (INDA, HODL) and are topped up from there.
Three have no feed at all — a delisted Russia ETF and two contingent value
rights — and are carried through flagged rather than quietly dropped.

News is deliberately narrow: a headline query per name would be 405 requests an
hour for mostly nothing, so only names that actually did something today (a
large move against their own range, a result just reported, an ex-date landing)
get one.

Run: python3 scripts/fetch_portfolio.py
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

DOCS = Path(__file__).resolve().parent.parent / "docs"
POSITIONS = DOCS / "data" / "portfolio.json"
OUT = DOCS / "data" / "portfolio-data.json"

SCAN_URL = "https://scanner.tradingview.com/global/scan"
# Fundamentals are USD-normalised unless asked otherwise, which would put a USD
# price target beside a JPY quote. to_symbol keeps every figure native.
PRICE_CONVERSION = {"to_symbol": True}

COLUMNS = [
    "description", "currency", "exchange", "sector", "industry", "market_cap_basic",
    # price and how unusual today's move is
    "close", "change", "change_abs", "ATR", "Volatility.D", "beta_1_year",
    "relative_volume_10d_calc", "price_52_week_high", "price_52_week_low",
    "SMA50", "SMA200", "RSI",              # RSI is the 14-period; RSI7 is separate
    "High.All", "Low.All",                 # all-time extremes, as far back as the feed goes
    # trailing performance
    "Perf.W", "Perf.1M", "Perf.3M", "Perf.YTD", "Perf.Y",
    # earnings: what was delivered against what was expected, and what is next
    "earnings_release_date", "earnings_release_next_date",
    "earnings_publication_type_fq", "earnings_publication_type_next_fq",
    "earnings_per_share_fq", "earnings_per_share_forecast_fq",
    "earnings_per_share_forecast_next_fq", "earnings_per_share_diluted_yoy_growth_fq",
    "revenue_fq", "revenue_forecast_fq",
    # dividends: the payment, its safety, and its record
    "dividends_yield_current", "dividend_ex_date_upcoming", "dividend_ex_date_recent",
    "dps_common_stock_prim_issue_fy", "dividend_payout_ratio_ttm",
    "continuous_dividend_payout", "continuous_dividend_growth",
]
PUB_SLOT = {1: "before open", 2: "after close", 3: "during session"}

# TradingView industry -> the dashboard's own theme buckets, so a position can
# be traced to the Themes, Commodities and Lookup pages rather than sitting in
# an industry label that means nothing to the rest of the site.
THEME_RULES = [
    ("Gold & precious metals", ["Precious Metals"]),
    ("Copper & base metals", ["Other Metals/Minerals", "Aluminum", "Steel"]),
    ("Uranium & nuclear", ["Nuclear"]),
    ("Energy — producers", ["Oil & Gas Production", "Integrated Oil", "Coal"]),
    ("Energy — services", ["Oilfield Services/Equipment", "Contract Drilling",
                           "Oil Refining/Marketing", "Gas Distributors",
                           "Oil & Gas Pipelines"]),
    ("Shipping & tankers", ["Marine Shipping"]),
    ("AI & semiconductors", ["Semiconductors", "Electronic Components",
                             "Electronic Production Equipment", "Computer Processing Hardware"]),
    ("Software & internet", ["Packaged Software", "Information Technology Services",
                             "Internet Software/Services", "Internet Retail"]),
    ("Grid & electrification", ["Electric Utilities", "Alternative Power Generation",
                                "Electrical Products", "Engineering & Construction"]),
    ("Defence & aerospace", ["Aerospace & Defense"]),
    ("Agriculture & food", ["Agricultural Commodities/Milling", "Chemicals: Agricultural",
                            "Food: Major Diversified", "Food Retail", "Food Distributors"]),
    ("Financials", ["Regional Banks", "Major Banks", "Investment Banks/Brokers",
                    "Investment Managers", "Property/Casualty Insurance",
                    "Life/Health Insurance", "Financial Conglomerates", "Savings Banks"]),
    ("Healthcare & biotech", ["Biotechnology", "Pharmaceuticals: Major",
                              "Pharmaceuticals: Other", "Medical Specialties",
                              "Medical Distributors", "Hospital/Nursing Management"]),
    ("Real estate", ["Real Estate Investment Trusts", "Real Estate Development"]),
    ("Consumer", ["Apparel/Footwear", "Apparel/Footwear Retail", "Specialty Stores",
                  "Restaurants", "Hotels/Resorts/Cruise lines", "Beverages: Alcoholic",
                  "Household/Personal Care", "Tobacco", "Recreational Products"]),
    ("Industrials & transport", ["Industrial Machinery", "Trucks/Construction/Farm Machinery",
                                 "Building Products", "Construction Materials",
                                 "Industrial Conglomerates", "Air Freight/Couriers",
                                 "Airlines", "Railroads", "Industrial Specialties",
                                 "Wholesale Distributors", "Other Transportation",
                                 "Miscellaneous Commercial Services", "Motor Vehicles"]),
    ("Funds & trusts", ["Investment Trusts/Mutual Funds", "ETF"]),
    ("Chemicals & materials", ["Chemicals: Specialty", "Chemicals: Major Diversified",
                               "Containers/Packaging", "Pulp & Paper", "Textiles"]),
    ("Media & telecom", ["Movies/Entertainment", "Broadcasting", "Major Telecommunications",
                         "Specialty Telecommunications", "Telecommunications Equipment",
                         "Cable/Satellite TV", "Publishing: Books/Magazines"]),
    ("Software & internet", ["Data Processing Services", "Financial Publishing/Services",
                             "Computer Peripherals", "Electronic Equipment/Instruments",
                             "Computer Communications"]),
]


def theme_for(industry, sector):
    for name, industries in THEME_RULES:
        if industry in industries:
            return name
    if sector == "Non-Energy Minerals":
        return "Copper & base metals"
    if sector == "Energy Minerals":
        return "Energy — producers"
    return "Other"


def scan(tickers, columns):
    payload = json.dumps({"symbols": {"tickers": tickers}, "columns": columns,
                          "price_conversion": PRICE_CONVERSION})
    r = subprocess.run(
        ["curl", "-s", "--max-time", "90", "-X", "POST", SCAN_URL,
         "-H", "Content-Type: application/json",
         "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
         "-d", payload],
        capture_output=True, text=True, timeout=120)
    return json.loads(r.stdout).get("data", [])


def iso(epoch):
    if not epoch:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d")


def rnd(v, n=2):
    return None if v is None else round(v, n)


def yahoo_spark(symbols):
    """Top-up for the handful TradingView will not serve."""
    url = ("https://query1.finance.yahoo.com/v7/finance/spark?symbols=" +
           ",".join(urllib.parse.quote(s) for s in symbols) + "&range=1y&interval=1d")
    r = subprocess.run(["curl", "-s", "--max-time", "40", "-H", "User-Agent: Mozilla/5.0", url],
                       capture_output=True, text=True, timeout=60)
    out = {}
    try:
        data = json.loads(r.stdout)
    except json.JSONDecodeError:
        return out
    for row in data.get("spark", {}).get("result", []):
        resp = row["response"][0]
        closes = [c for c in resp["indicators"]["quote"][0].get("close", []) if c is not None]
        if len(closes) < 30:
            continue
        # True range needs highs and lows; with closes only, use the mean absolute
        # daily change as an honest stand-in and label it as such downstream.
        moves = [abs(closes[i] - closes[i - 1]) for i in range(1, len(closes))][-14:]
        out[row["symbol"]] = {
            "close": closes[-1],
            "change": (closes[-1] / closes[-2] - 1) * 100 if len(closes) > 1 else None,
            "atr": sum(moves) / len(moves) if moves else None,
            "atr_proxy": True,
            "perf_1m": (closes[-1] / closes[-22] - 1) * 100 if len(closes) > 22 else None,
            "perf_ytd": None,
        }
    return out


def google_news(query, limit=3):
    url = ("https://news.google.com/rss/search?q=" + urllib.parse.quote(query) +
           "&hl=en-US&gl=US&ceid=US:en")
    r = subprocess.run(["curl", "-s", "--max-time", "20", "-H", "User-Agent: Mozilla/5.0", url],
                       capture_output=True, text=True, timeout=30)
    out = []
    try:
        root = ET.fromstring(r.stdout)
    except ET.ParseError:
        return out
    cutoff = (datetime.now(timezone.utc) - timedelta(days=5)).strftime("%Y-%m-%d")
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        src = item.findtext("source") or ""
        try:
            when = datetime.strptime(pub[:16], "%a, %d %b %Y").strftime("%Y-%m-%d")
        except ValueError:
            continue
        if when < cutoff:
            continue
        title = re.sub(r"\s+-\s+[^-]+$", "", title).strip()
        if title:
            out.append({"t": title, "u": link, "d": when, "s": src})
        if len(out) >= limit:
            break
    return out



# TradingView exchange -> Yahoo suffix, so a name can be re-fetched as a daily
# series when a point-in-time calculation is needed. EURONEXT spans four
# venues; the ones held here are Paris, so it maps there and any miss simply
# yields no reaction rather than a wrong one.
YAHOO_SUFFIX = {
    "NASDAQ": "", "NYSE": "", "AMEX": "", "OTC": "", "BATS": "",
    "TSX": ".TO", "TSXV": ".V", "CSE": ".CN", "ASX": ".AX", "LSE": ".L",
    "TSE": ".T", "XETR": ".DE", "EURONEXT": ".PA", "OSL": ".OL",
    "OMXSTO": ".ST", "OMXHEX": ".HE", "MIL": ".MI", "SZSE": ".SZ", "SSE": ".SS",
}


def yahoo_symbol(tv):
    """Best-effort Yahoo symbol for a TradingView ticker."""
    if not tv or ":" not in tv:
        return None
    ex, sym = tv.split(":", 1)
    if ex == "HKEX":
        return sym.zfill(4) + ".HK"          # Yahoo pads Hong Kong codes to four
    if ex == "OMXSTO":
        return sym.replace("_", "-") + ".ST"  # HEXA_B on the scanner is HEXA-B on Yahoo
    if ex not in YAHOO_SUFFIX:
        return None
    if ex in ("NASDAQ", "NYSE", "AMEX", "OTC", "BATS"):
        return sym.replace(".", "-")          # class shares: PBR.A -> PBR-A
    return sym + YAHOO_SUFFIX[ex]


def earnings_reaction(symbols_by_date):
    """Move from the close before a result to the latest close.

    The scanner only offers fixed windows — week, month, quarter — and a
    "1-month" figure covering 29 days before a result cannot be called the
    reaction to it. This walks daily closes and measures from the actual date.
    A result released after the close is traded the next session, but the
    publication slot is not always known, so the reference is the last close
    strictly before the release date either way.
    """
    out = {}
    syms = sorted(symbols_by_date)
    for i in range(0, len(syms), 10):
        chunk = syms[i:i + 10]
        url = ("https://query1.finance.yahoo.com/v7/finance/spark?symbols=" +
               ",".join(urllib.parse.quote(s) for s in chunk) + "&range=3mo&interval=1d")
        r = subprocess.run(["curl", "-s", "--max-time", "40", "-H", "User-Agent: Mozilla/5.0", url],
                           capture_output=True, text=True, timeout=60)
        try:
            data = json.loads(r.stdout)
        except json.JSONDecodeError:
            continue
        for row in data.get("spark", {}).get("result", []):
            resp = row["response"][0]
            stamps = resp.get("timestamp") or []
            closes = resp["indicators"]["quote"][0].get("close", [])
            pts = [(datetime.fromtimestamp(s, tz=timezone.utc).strftime("%Y-%m-%d"), c)
                   for s, c in zip(stamps, closes) if c is not None]
            when = symbols_by_date.get(row["symbol"])
            if not pts or not when:
                continue
            before = [c for d, c in pts if d < when]
            after = [c for d, c in pts if d >= when]
            if not before or not after:
                continue
            out[row["symbol"]] = {"pct": round((pts[-1][1] / before[-1] - 1) * 100, 1),
                                  "from": when, "sessions": len(after)}
        time.sleep(0.2)
    return out


def sma_last(vals, n):
    return sum(vals[-n:]) / n if len(vals) >= n else None


MA_PERIODS = (21, 50, 150, 200)


def ma_structure(closes):
    """Distance from each average, and the last level test, for one bar series.

    Mirrors docs/ma.js so the Portfolio page reads the same as every other
    page, and carries the same four periods the watchlist shows rather than
    only the two the Structure block needed — the page now prints them per
    position, so the shorter averages have somewhere to go.

    Closes only — the feed carries no intraday high or low — so a spike through
    a level that closed back above it counts as held.
    """
    out = {}
    for n in MA_PERIODS:
        if len(closes) < n + 2:
            continue
        ma, s = [], 0.0
        for i, v in enumerate(closes):
            s += v
            if i >= n:
                s -= closes[i - n]
            if i >= n - 1:
                ma.append(s / n)
        off = len(closes) - len(ma)
        last, last_ma = closes[-1], ma[-1]
        dist = (last / last_ma - 1) * 100
        above = dist >= 0
        look = min(15, len(ma) - 1)
        best = None
        for k in range(len(ma) - look, len(ma)):
            d = closes[k + off] / ma[k] - 1
            if best is None or abs(d) < abs(best[0]):
                best = (d, k)
        state = None
        if best and abs(best[0]) <= 0.02:
            was = best[0] >= 0
            state = ("held" if (was and above) else "rejected" if (not was and not above)
                     else "reclaimed" if (not was and above) else "lost")
        ago = None
        for k in range(len(ma) - 2, -1, -1):
            if (closes[k + off] >= ma[k]) != above:
                ago = len(ma) - 1 - k
                break
        # The average's own level travels with the distance so the page can
        # show it on hover — "+8.4%" is the reading, "and the 50 sits at
        # 41.30" is what makes it actionable.
        out[str(n)] = {"dist": round(dist, 1), "above": above,
                       "state": state, "ago": ago,
                       "ma": round(last_ma, 4 if last_ma < 10 else 2)}
    return out


def timeframe_bars(symbols, rng, interval):
    """Weekly or monthly closes for a list of Yahoo symbols.

    Spark honours the interval on a bounded range but ignores it on range=max,
    returning the same ~168 downsampled bars whatever you ask for — hence the
    explicit windows, which give roughly 263 weekly and 301 monthly bars.
    """
    out = {}
    for i in range(0, len(symbols), 10):
        chunk = symbols[i:i + 10]
        url = ("https://query1.finance.yahoo.com/v7/finance/spark?symbols=" +
               ",".join(urllib.parse.quote(s) for s in chunk) +
               f"&range={rng}&interval={interval}")
        r = subprocess.run(["curl", "-s", "--max-time", "40",
                            "-H", "User-Agent: Mozilla/5.0", url],
                           capture_output=True, text=True, timeout=60)
        try:
            data = json.loads(r.stdout)
        except json.JSONDecodeError:
            continue
        for row in data.get("spark", {}).get("result", []):
            closes = [c for c in row["response"][0]["indicators"]["quote"][0].get("close", [])
                      if c is not None]
            if closes:
                out[row["symbol"]] = closes
        time.sleep(0.15)
    return out


def main():
    positions = json.loads(POSITIONS.read_text())
    tv_map = {p["tv"]: p for p in positions if p.get("tv")}
    rows = scan(sorted(tv_map), COLUMNS)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "TradingView scanner, Yahoo Finance, Google News",
           "positions": []}

    seen = set()
    for row in rows:
        d = dict(zip(COLUMNS, row["d"]))
        pos = tv_map.get(row["s"])
        if not pos or row["s"] in seen:
            continue
        seen.add(row["s"])
        atr = d.get("ATR")
        chg_abs = d.get("change_abs")
        # A true range larger than half the share price is arithmetically
        # impossible and means the ATR predates a consolidation or reverse
        # split while the price does not. Left in, it divides a real move by a
        # nonsense denominator and buries the name at 0.0x — the failure hides
        # a big day rather than inventing one, which is worse.
        atr_stale = bool(atr and d.get("close") and atr > 0.5 * d["close"])
        if atr_stale:
            atr = None
        rec = {
            "tk": pos["tk"], "tv": row["s"], "block": pos["block"],
            "name": d.get("description") or pos["name"],
            "ccy": d.get("currency") or pos["ccy"],
            "ex": d.get("exchange") or pos["ex"],
            "sector": d.get("sector"), "industry": d.get("industry"),
            "theme": theme_for(d.get("industry"), d.get("sector")),
            "mcap": d.get("market_cap_basic"),
            "close": rnd(d.get("close"), 4), "chg": rnd(d.get("change")),
            "atr": rnd(atr, 4),
            "atr_stale": atr_stale or None,
            # How big is today's move against this name's own recent range? A 2%
            # day in something that never moves outranks 5% in something wild.
            "atr_mult": rnd(abs(chg_abs) / atr, 2) if (atr and chg_abs is not None) else None,
            "sigma": rnd(d.get("change") / d["Volatility.D"], 2)
                     if d.get("Volatility.D") else None,
            "relvol": rnd(d.get("relative_volume_10d_calc")),
            "beta": rnd(d.get("beta_1_year")),
            "rsi": rnd(d.get("RSI"), 1),
            "w1": rnd(d.get("Perf.W")), "m1": rnd(d.get("Perf.1M")),
            "m3": rnd(d.get("Perf.3M")), "ytd": rnd(d.get("Perf.YTD")),
            "y1": rnd(d.get("Perf.Y")),
            "hi52": rnd(d.get("price_52_week_high"), 4),
            "lo52": rnd(d.get("price_52_week_low"), 4),
            "ath": rnd(d.get("High.All"), 4), "atl": rnd(d.get("Low.All"), 4),
            "sma50": rnd(d.get("SMA50"), 4), "sma200": rnd(d.get("SMA200"), 4),
            # Carried so the page can link straight to a Yahoo chart, which is
            # where the rest of the dashboard sends people.
            "y": yahoo_symbol(row["s"]),
        }
        # Distance from the extremes. Expressed as how far BELOW each high the
        # price sits and how far ABOVE each low, so zero always means "at it"
        # and the sign never has to be interpreted.
        close = d.get("close")
        def gap(ref, above):
            if not close or not ref:
                return None
            return round((close / ref - 1) * 100, 1) if above else round((close / ref - 1) * 100, 1)
        rec["from_hi52"] = gap(d.get("price_52_week_high"), True)
        rec["from_lo52"] = gap(d.get("price_52_week_low"), True)
        rec["from_ath"] = gap(d.get("High.All"), True)
        # "At" a high means within a whisker of it — an exact tick is rare and
        # the useful question is whether it is pressing the level.
        rec["at_hi52"] = bool(rec["from_hi52"] is not None and rec["from_hi52"] >= -2)
        rec["at_lo52"] = bool(rec["from_lo52"] is not None and rec["from_lo52"] <= 2)
        rec["at_ath"] = bool(rec["from_ath"] is not None and rec["from_ath"] >= -2)
        # ---- earnings ----
        slot = lambda c: PUB_SLOT.get(int(c) % 10) if c is not None else None
        eps, est = d.get("earnings_per_share_fq"), d.get("earnings_per_share_forecast_fq")
        earn = {"last": iso(d.get("earnings_release_date")),
                "last_slot": slot(d.get("earnings_publication_type_fq")),
                "next": iso(d.get("earnings_release_next_date")),
                "next_slot": slot(d.get("earnings_publication_type_next_fq")),
                "eps": rnd(eps, 3), "eps_est": rnd(est, 3),
                "eps_next_est": rnd(d.get("earnings_per_share_forecast_next_fq"), 3),
                "eps_yoy": rnd(d.get("earnings_per_share_diluted_yoy_growth_fq"), 1)}
        if eps is not None and est not in (None, 0):
            earn["surprise"] = round((eps - est) / abs(est) * 100, 1)
        rev, rev_est = d.get("revenue_fq"), d.get("revenue_forecast_fq")
        if rev is not None and rev_est not in (None, 0):
            earn["rev_surprise"] = round((rev - rev_est) / abs(rev_est) * 100, 1)
        rec["earn"] = {k: v for k, v in earn.items() if v is not None}
        # ---- dividends ----
        div = {"yield": rnd(d.get("dividends_yield_current")),
               "ex_next": iso(d.get("dividend_ex_date_upcoming")),
               "ex_last": iso(d.get("dividend_ex_date_recent")),
               "dps": rnd(d.get("dps_common_stock_prim_issue_fy"), 4),
               "payout": rnd(d.get("dividend_payout_ratio_ttm"), 1),
               "years_paid": d.get("continuous_dividend_payout"),
               "years_grown": d.get("continuous_dividend_growth")}
        # Payout above earnings is the classic pre-cut signal — but only where
        # earnings are the right denominator. REITs, midstream and shipping
        # partnerships distribute from cash flow, and depreciation on a large
        # asset base pushes EPS well below it, so an EPS payout over 100% is
        # normal there rather than alarming. Flagging Realty Income after 32
        # unbroken years would be a false alarm that costs the page its
        # credibility, so those are noted instead of flagged.
        CASHFLOW_PAYERS = {"Real Estate Investment Trusts", "Oil & Gas Pipelines",
                           "Marine Shipping", "Investment Trusts/Mutual Funds"}
        payout, yoy = div["payout"], rec.get("eps_yoy") or earn.get("eps_yoy")
        cash_based = d.get("industry") in CASHFLOW_PAYERS
        if div["yield"]:
            if cash_based:
                if payout is not None and payout > 100:
                    div["note"] = "pays from cash flow — an EPS payout over 100% is normal here"
                # A long unbroken record still deserves the benefit of the doubt.
                if (yoy or 0) < -40 and (div.get("years_paid") or 0) < 10:
                    div["risk"] = "earnings falling on a short payment record"
            elif payout is not None and payout > 100:
                div["risk"] = "payout above earnings"
            elif payout is not None and payout > 80 and (yoy or 0) < 0:
                div["risk"] = "high payout into falling earnings"
            elif (yoy or 0) < -30 and payout is not None and payout > 60:
                div["risk"] = "earnings down sharply against a heavy payout"
            # Length of record is the strongest single mitigant there is.
            if div.get("risk") and (div.get("years_paid") or 0) >= 25:
                div["mitigant"] = str(div["years_paid"]) + " unbroken years of payments"
        rec["div"] = {k: v for k, v in div.items() if v is not None}
        out["positions"].append(rec)

    # ---- the two Yahoo-only names, and the three with no feed at all ----
    y_syms = [p["yahoo"] for p in positions if p.get("yahoo")]
    ydata = yahoo_spark(y_syms) if y_syms else {}
    for p in positions:
        if p.get("yahoo"):
            y = ydata.get(p["yahoo"], {})
            out["positions"].append({
                "tk": p["tk"], "tv": None, "block": p["block"], "name": p["name"],
                "ccy": p["ccy"], "ex": p["ex"], "sector": "Funds", "industry": "ETF",
                "theme": "Other", "close": rnd(y.get("close"), 4),
                "chg": rnd(y.get("change")), "atr": rnd(y.get("atr"), 4),
                "atr_mult": rnd(abs(y["change"] / 100 * y["close"]) / y["atr"], 2)
                            if y.get("atr") and y.get("change") is not None else None,
                "m1": rnd(y.get("perf_1m")), "atr_proxy": True, "y": p["yahoo"],
                "earn": {}, "div": {}, "partial": "price only — no scanner coverage"})
        elif p.get("nofeed"):
            out["positions"].append({
                "tk": p["tk"], "tv": None, "block": p["block"], "name": p["name"],
                "ccy": p["ccy"], "ex": p["ex"], "sector": None, "industry": None,
                "theme": "Other", "earn": {}, "div": {},
                "nofeed": "no market data — delisted or a contingent value right"})

    # ---- true post-earnings reaction, for anything that reported recently ----
    cutoff = (datetime.now(timezone.utc) - timedelta(days=21)).strftime("%Y-%m-%d")
    want, back = {}, {}
    for r in out["positions"]:
        last = (r.get("earn") or {}).get("last")
        if not last or last < cutoff:
            continue
        ys = yahoo_symbol(r.get("tv"))
        if ys:
            want[ys] = last
            back[ys] = r
    reactions = earnings_reaction(want) if want else {}
    for ys, react in reactions.items():
        back[ys]["earn"]["reaction"] = react["pct"]
        back[ys]["earn"]["reaction_sessions"] = react["sessions"]
    print(f"post-earnings reaction: {len(reactions)}/{len(want)} measured from daily closes")

    # ---- higher-timeframe structure for every position ----
    ys = {r["y"]: r for r in out["positions"] if r.get("y")}
    for key, rng, interval in (("w", "5y", "1wk"), ("m", "25y", "1mo")):
        bars = timeframe_bars(sorted(ys), rng, interval)
        for sym, closes in bars.items():
            st = ma_structure(closes)
            if st:
                ys[sym].setdefault("ma", {})[key] = st
    # daily comes from the same 3-month window used for the earnings reaction,
    # which is too short for a 200-day average, so pull a year for the dailies
    daily = timeframe_bars(sorted(ys), "1y", "1d")
    for sym, closes in daily.items():
        st = ma_structure(closes)
        if st:
            ys[sym].setdefault("ma", {})["d"] = st
    withma = sum(1 for r in out["positions"] if r.get("ma"))
    print(f"moving-average structure: {withma} positions")

    # ---- news, only where something actually happened ----
    def newsworthy(r):
        if r.get("nofeed"):
            return False
        if (r.get("atr_mult") or 0) >= 2:
            return True
        e = r.get("earn") or {}
        if e.get("last") and e["last"] >= (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%d"):
            return True
        if e.get("next") and e["next"] <= (datetime.now(timezone.utc) + timedelta(days=3)).strftime("%Y-%m-%d"):
            return True
        dv = r.get("div") or {}
        return bool(dv.get("risk"))
    hot = [r for r in out["positions"] if newsworthy(r)]
    hot.sort(key=lambda r: -(r.get("atr_mult") or 0))
    hot = hot[:40]                     # a ceiling, so a wild day cannot run away
    got = 0
    for r in hot:
        try:
            items = google_news(f'"{r["name"]}" stock')
        except Exception:              # noqa: BLE001 - news is a bonus, never fatal
            items = []
        if items:
            r["news"] = items
            got += 1
        time.sleep(0.25)
    out["news_checked"] = len(hot)
    out["news_found"] = got

    if not out["positions"]:
        sys.exit("aborting: no positions enriched")
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    withdata = sum(1 for r in out["positions"] if r.get("close") is not None)
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB): "
          f"{len(out['positions'])} positions, {withdata} priced, "
          f"{got}/{len(hot)} carrying news")


if __name__ == "__main__":
    main()
