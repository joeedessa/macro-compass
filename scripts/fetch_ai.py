#!/usr/bin/env python3
"""Assemble the evidence for the AI page and write docs/data/ai.json.

The page asks one question — how much of the AI trade is being financed rather
than earned — and that question is answered from filings and credit data, not
from price. Prices are fetched client-side like everywhere else on the site;
what lives here is the slow-moving material that a browser has no business
pulling on every load.

Four sources, all free and keyless:

  FRED       ICE BofA option-adjusted spreads, the whole rating ladder. The
             ladder matters more than any single line: an index at its tights
             while CCC gaps wider is a different world from both moving
             together, and only the ladder shows it.
  FINRA      Customer margin debt, monthly. The cleanest public read on how
             much of the bid is borrowed.
  TradingView Fundamentals for the AI complex. The two columns that carry this
             page are capital_expenditures_estimate_ntm — what the sell side
             thinks each name will spend over the next twelve months — and
             effective_interest_rate_on_debt_ttm, the blended cost of debt
             implied by interest expense in the filings.
  Yahoo      Exchange rates only. Prices are fetched client-side like the rest
             of the site; the rates are here because balance-sheet figures need
             converting once, server-side, rather than on every page load.

On currency, because this bit has already gone wrong once. price_conversion
to_symbol keeps every TradingView figure in the company's own reporting
currency, which is what the site wants for prices — Samsung quotes in won and
stays in won. But a market value or a debt load is a comparison across the
whole complex, and Samsung's 1.69 quadrillion won next to Nvidia's 5.45
trillion dollars ranks Samsung first by a factor of about fourteen hundred.
So money-denominated balance-sheet fields get a USD twin here, named _usd,
and the page shows the twin and says so. Prices are never converted anywhere.

On the cost of debt, stated plainly because the page repeats it: the effective
rate is backward-looking. It is interest expense over average debt, so it
reflects the coupon stack a company has accumulated, not what it would pay to
issue this morning. Amazon's 2.2% is a memory of 2020, not a quote. What the
number does support is the comparison across issuers at a point in time, and
the direction of travel as cheap legacy paper matures into an expensive market.
It is not a new-issue spread and the page must never call it one.

Run: python3 scripts/fetch_ai.py
"""

import csv
import io
import json
import subprocess
import sys
import time
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

# Run as `python3 scripts/x.py` the script's own directory is already on the
# path; spelled out so the import does not depend on how it was invoked.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import quality  # noqa: E402 - needs the path above

DOCS = Path(__file__).resolve().parent.parent / "docs"
OUT = DOCS / "data" / "ai.json"

UA = {"User-Agent": "macro-compass-dashboard (github.com/joeedessa/macro-compass)"}
SCAN = "https://scanner.tradingview.com/global/scan"
SCAN_US = "https://scanner.tradingview.com/america/scan"
SCAN_KR = "https://scanner.tradingview.com/korea/scan"

# ---------------------------------------------------------------------------
# The complex
#
# Layered by what a name actually is, because the layers behave differently and
# the differences are the signal. Chips sell the picks; hyperscalers earn the
# cash that pays for them; the neoclouds borrow to buy them and have no other
# business; power and cooling are the physical constraint; memory is the part
# of the chain that has been supply-limited before and will be again; the tail
# is the profitless end that leads on the way up and dies first.
# ---------------------------------------------------------------------------
COMPLEX = [
    # (TradingView ticker, Yahoo symbol, display name, layer)
    ("NASDAQ:NVDA", "NVDA", "Nvidia", "chips"),
    ("NASDAQ:AMD", "AMD", "AMD", "chips"),
    ("NASDAQ:AVGO", "AVGO", "Broadcom", "chips"),
    ("NYSE:TSM", "TSM", "TSMC (ADR)", "chips"),
    ("NASDAQ:ASML", "ASML", "ASML (ADR)", "chips"),
    ("NASDAQ:AMAT", "AMAT", "Applied Materials", "chips"),
    ("NASDAQ:LRCX", "LRCX", "Lam Research", "chips"),
    ("NASDAQ:KLAC", "KLAC", "KLA", "chips"),
    ("NASDAQ:MRVL", "MRVL", "Marvell", "chips"),
    ("NASDAQ:ARM", "ARM", "Arm", "chips"),
    ("NASDAQ:INTC", "INTC", "Intel", "chips"),
    ("NASDAQ:TER", "TER", "Teradyne", "chips"),
    ("NASDAQ:CDNS", "CDNS", "Cadence", "chips"),
    ("NASDAQ:SNPS", "SNPS", "Synopsys", "chips"),

    ("NASDAQ:MSFT", "MSFT", "Microsoft", "hyperscaler"),
    ("NASDAQ:GOOGL", "GOOGL", "Alphabet", "hyperscaler"),
    ("NASDAQ:AMZN", "AMZN", "Amazon", "hyperscaler"),
    ("NASDAQ:META", "META", "Meta", "hyperscaler"),
    ("NYSE:ORCL", "ORCL", "Oracle", "hyperscaler"),
    ("NASDAQ:AAPL", "AAPL", "Apple", "hyperscaler"),
    ("NYSE:IBM", "IBM", "IBM", "hyperscaler"),

    ("NASDAQ:CRWV", "CRWV", "CoreWeave", "neocloud"),
    ("NASDAQ:NBIS", "NBIS", "Nebius", "neocloud"),
    ("NASDAQ:APLD", "APLD", "Applied Digital", "neocloud"),
    ("NASDAQ:IREN", "IREN", "IREN", "neocloud"),
    ("NASDAQ:CIFR", "CIFR", "Cipher Mining", "neocloud"),
    ("NASDAQ:WULF", "WULF", "TeraWulf", "neocloud"),
    ("NASDAQ:CORZ", "CORZ", "Core Scientific", "neocloud"),
    ("NASDAQ:GLXY", "GLXY", "Galaxy Digital", "neocloud"),
    ("NASDAQ:HUT", "HUT", "Hut 8", "neocloud"),

    ("NYSE:ANET", "ANET", "Arista", "network"),
    ("NYSE:CIEN", "CIEN", "Ciena", "network"),
    ("NYSE:COHR", "COHR", "Coherent", "network"),
    ("NASDAQ:LITE", "LITE", "Lumentum", "network"),
    ("NYSE:FN", "FN", "Fabrinet", "network"),
    ("NASDAQ:ALAB", "ALAB", "Astera Labs", "network"),
    ("NASDAQ:CRDO", "CRDO", "Credo", "network"),

    ("NYSE:VRT", "VRT", "Vertiv", "power"),
    ("NYSE:GEV", "GEV", "GE Vernova", "power"),
    ("NYSE:ETN", "ETN", "Eaton", "power"),
    ("NYSE:PWR", "PWR", "Quanta Services", "power"),
    ("NASDAQ:CEG", "CEG", "Constellation Energy", "power"),
    ("NYSE:VST", "VST", "Vistra", "power"),
    ("NASDAQ:TLN", "TLN", "Talen Energy", "power"),
    ("NYSE:NRG", "NRG", "NRG Energy", "power"),
    ("NYSE:SMR", "SMR", "NuScale Power", "power"),
    ("NYSE:OKLO", "OKLO", "Oklo", "power"),
    ("NYSE:BWXT", "BWXT", "BWX Technologies", "power"),
    ("NYSE:HUBB", "HUBB", "Hubbell", "power"),
    ("NYSE:MOD", "MOD", "Modine", "power"),
    ("NYSE:SPXC", "SPXC", "SPX Technologies", "power"),

    ("NASDAQ:MU", "MU", "Micron", "memory"),
    ("NASDAQ:SNDK", "SNDK", "SanDisk", "memory"),
    ("KRX:005930", "005930.KS", "Samsung Electronics", "memory"),
    ("KRX:000660", "000660.KS", "SK Hynix", "memory"),
    ("TWSE:2330", "2330.TW", "TSMC (Taipei)", "memory"),
    ("TSE:6857", "6857.T", "Advantest", "memory"),
    ("TSE:6146", "6146.T", "Disco", "memory"),
    ("TSE:8035", "8035.T", "Tokyo Electron", "memory"),

    ("NASDAQ:PLTR", "PLTR", "Palantir", "software"),
    ("NYSE:NOW", "NOW", "ServiceNow", "software"),
    ("NYSE:CRM", "CRM", "Salesforce", "software"),
    ("NYSE:SNOW", "SNOW", "Snowflake", "software"),
    ("NASDAQ:MDB", "MDB", "MongoDB", "software"),
    ("NASDAQ:DDOG", "DDOG", "Datadog", "software"),
    ("NASDAQ:APP", "APP", "AppLovin", "software"),
    ("NASDAQ:ADBE", "ADBE", "Adobe", "software"),

    ("NYSE:BBAI", "BBAI", "BigBear.ai", "tail"),
    ("NASDAQ:SOUN", "SOUN", "SoundHound AI", "tail"),
    ("NYSE:AI", "AI", "C3.ai", "tail"),
    ("NYSE:IONQ", "IONQ", "IonQ", "tail"),
    ("NASDAQ:RGTI", "RGTI", "Rigetti", "tail"),
    ("NASDAQ:QBTS", "QBTS", "D-Wave Quantum", "tail"),
    ("NASDAQ:QUBT", "QUBT", "Quantum Computing", "tail"),
]

LAYER_LABEL = {
    "chips": "Compute and chips",
    "hyperscaler": "Hyperscalers",
    "neocloud": "Neoclouds and AI-native infrastructure",
    "network": "Networking and optics",
    "power": "Power, grid and cooling",
    "memory": "Memory and Asian supply chain",
    "software": "Software and applications",
    "tail": "The speculative tail",
}

# The names that actually carry the capex. Used for the funding-gap aggregate,
# kept separate from the full complex so the aggregate cannot be quietly
# diluted by adding more names to the table.
CAPEX_NAMES = ["NASDAQ:MSFT", "NASDAQ:GOOGL", "NASDAQ:AMZN", "NASDAQ:META", "NYSE:ORCL"]
NEOCLOUD_CAPEX = ["NASDAQ:CRWV", "NASDAQ:NBIS", "NASDAQ:APLD", "NASDAQ:IREN",
                  "NASDAQ:CIFR", "NASDAQ:WULF", "NASDAQ:CORZ"]

COLUMNS = [
    "description", "currency", "close", "market_cap_basic",
    "total_revenue_ttm", "ebitda_ttm", "free_cash_flow_ttm",
    "capital_expenditures_ttm", "capital_expenditures_estimate_ntm",
    "cash_f_operating_activities_ttm",
    "total_debt", "net_debt", "net_debt_to_ebitda_fy",
    "effective_interest_rate_on_debt_ttm", "ebitda_less_capex_interst_cover_fy",
    "price_earnings_ttm", "price_sales_current", "enterprise_value_ebitda_current",
    "enterprise_value_current", "gross_margin_ttm", "Perf.YTD", "Perf.Y",
]

# ICE BofA option-adjusted spreads. The ladder, not a single line.
OAS = [
    ("aaa", "BAMLC0A1CAAA", "AAA"),
    ("aa", "BAMLC0A2CAA", "AA"),
    ("a", "BAMLC0A3CA", "A"),
    ("bbb", "BAMLC0A4CBBB", "BBB"),
    ("ig", "BAMLC0A0CM", "Investment grade"),
    ("bb", "BAMLH0A1HYBB", "BB"),
    ("b", "BAMLH0A2HYB", "B"),
    ("ccc", "BAMLH0A3HYC", "CCC and below"),
    ("hy", "BAMLH0A0HYM2", "High yield"),
]
OTHER_FRED = [("ust10", "DGS10"), ("ust2", "DGS2"), ("gdp", "GDP"),
              ("nfci", "NFCI"), ("hh_gas", "DHHNGSP")]

# Long-history credit, and the reason it is here.
#
# ICE BofA is licensed data on FRED and the public CSV serves a rolling three
# years however you ask — cosd is ignored, the window does not move. Three years
# is enough to rank today against the current cycle and nothing more; a
# percentile drawn from it must never be called a ten-year percentile, which is
# exactly the mistake this comment exists to prevent.
#
# Moody's is not licence-restricted, so Baa-minus-10-year gives a daily credit
# spread back to 1986 with no strings. It is a yield spread rather than an
# option-adjusted one and it is investment grade rather than high yield, so it
# is a different measure — but it is the one that can actually answer "compared
# with the last forty years", which on a bubble page is the question.
LONG_CREDIT = [
    ("baa10y", "BAA10Y", "Moody's Baa less 10-year Treasury"),
    ("aaa10y", "AAA10Y", "Moody's Aaa less 10-year Treasury"),
]

# The price of protection, across markets rather than within one.
#
# Credit spreads and equity volatility are both what somebody charges to carry
# a risk, so reading them together is the point — but only if the comparison
# survives its own units. A high yield spread over VIX would be percentage
# points divided by annualised volatility points, which anchors to nothing, and
# a ratio can only carry as much history as its shorter leg: VIX has 9,251
# daily observations back to 1990 and the licensed high yield series has 787.
# Dividing one by the other throws away thirty-three years to inherit three.
#
# So each gauge is ranked against its own longest history and set side by side,
# and the only spread taken is VXN less VIX — same units, same start date,
# which makes it the one construct here that is genuinely comparable.
PROTECTION = [
    ("vix", "VIXCLS", "S&P 500 implied volatility", "VIX"),
    ("vxn", "VXNCLS", "Nasdaq 100 implied volatility", "VXN"),
]

# Investment grade spreads cut by maturity. Every bucket carries the same
# three-year licence limit, but the shape across buckets is a cross-section and
# needs no history at all — and the shape is what matters here, because the
# hyperscalers have been issuing at the long end. Meta's October deal ran to
# forty years, so the 15-year-plus bucket is nearer to what they actually pay
# than the index is.
IG_CURVE = [
    ("m13", "BAMLC1A0C13Y", "1 to 3 years"),
    ("m35", "BAMLC2A0C35Y", "3 to 5 years"),
    ("m57", "BAMLC3A0C57Y", "5 to 7 years"),
    ("m710", "BAMLC4A0C710Y", "7 to 10 years"),
    ("m1015", "BAMLC7A0C1015Y", "10 to 15 years"),
    ("m15p", "BAMLC8A0C15PY", "15 years and over"),
]


def http_get(url, retries=3, binary=False):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read()
                return raw if binary else raw.decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001 - retry any transport error
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"failed to fetch {url}: {last}")


def fred(series_id):
    """[(iso_date, float), ...]. FRED writes missing observations as '.'."""
    text = http_get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}")
    pts = []
    for row in csv.DictReader(io.StringIO(text)):
        date = row.get("observation_date") or row.get("DATE")
        val = row.get(series_id)
        if not date or val in (None, "", "."):
            continue
        pts.append((date, float(val)))
    if not pts:
        raise RuntimeError(f"FRED {series_id}: nothing parsed")
    return pts


def pctile(pts, years):
    """Where the latest value sits in its own distribution over `years`.

    Calendar-walked rather than sliced by index: these series are business-daily
    with holidays, so "the last 2,520 rows" is not ten years and the error
    compounds the further back you look.
    """
    if not pts:
        return None
    last_date = datetime.strptime(pts[-1][0], "%Y-%m-%d")
    cutoff = last_date.replace(year=last_date.year - years).strftime("%Y-%m-%d")
    window = [v for d, v in pts if d >= cutoff]
    if len(window) < 60:
        return None
    cur = pts[-1][1]
    below = sum(1 for v in window if v < cur)
    ties = sum(1 for v in window if v == cur)
    return round((below + ties / 2) / len(window) * 100, 1)


def span_years(pts):
    """Years of history a series actually carries, to one decimal.

    Asked of every series before any window is claimed, because two of the
    sources here serve far less history than they appear to. Rounded rather
    than floored so three years of daily data does not advertise itself as two.
    """
    if len(pts) < 2:
        return 0.0
    a = datetime.strptime(pts[0][0], "%Y-%m-%d")
    b = datetime.strptime(pts[-1][0], "%Y-%m-%d")
    return round((b - a).days / 365.25, 1)


def pctile_all(pts):
    """Percentile of the latest value against the entire series."""
    if len(pts) < 60:
        return None
    cur = pts[-1][1]
    vals = [v for _, v in pts]
    below = sum(1 for v in vals if v < cur)
    ties = sum(1 for v in vals if v == cur)
    return round((below + ties / 2) / len(vals) * 100, 1)


def ago(pts, days):
    """Value roughly `days` calendar days back, by date not by row count."""
    if not pts:
        return None
    last_date = datetime.strptime(pts[-1][0], "%Y-%m-%d")
    target = (last_date.timestamp() - days * 86400)
    best = None
    for d, v in pts:
        t = datetime.strptime(d, "%Y-%m-%d").timestamp()
        if t <= target:
            best = v
        else:
            break
    return best


def scan(url, payload):
    r = subprocess.run(
        ["curl", "-s", "--max-time", "90", "-X", "POST", url,
         "-H", "Content-Type: application/json",
         "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
         "-d", json.dumps(payload)],
        capture_output=True, text=True, timeout=120)
    return json.loads(r.stdout)


def fetch_fx(currencies):
    """USD value of one unit of each currency, from Yahoo's FX pairs.

    Yahoo quotes "KRW=X" as won per dollar, so the multiplier the page needs is
    the reciprocal. A currency that fails to resolve is left out rather than
    defaulted to 1.0 — silently treating won as dollars is the exact failure
    this function exists to prevent.
    """
    want = sorted({c for c in currencies if c and c != "USD"})
    fx = {"USD": 1.0}
    if not want:
        return fx
    url = ("https://query1.finance.yahoo.com/v7/finance/spark?symbols=" +
           ",".join(f"{c}=X" for c in want) + "&range=5d&interval=1d")
    try:
        payload = json.loads(http_get(url))
    except Exception as e:  # noqa: BLE001
        print(f"  ! FX: {e}", file=sys.stderr)
        return fx
    for row in payload.get("spark", {}).get("result", []):
        code = row["symbol"].replace("=X", "")
        closes = [c for c in
                  (row.get("response", [{}])[0].get("indicators", {})
                   .get("quote", [{}])[0].get("close") or []) if c]
        if closes and closes[-1] > 0:
            fx[code] = 1.0 / closes[-1]
    for c in want:
        if c not in fx:
            print(f"  ! FX: no rate for {c}; its balance-sheet figures stay null",
                  file=sys.stderr)
    return fx


def fetch_margin():
    """FINRA customer margin debt, monthly, in $ millions.

    FINRA serves the workbook from the path it was first uploaded to and
    updates it in place, so the 2021-03 directory in the URL is not a mistake
    and is not stale — the file behind it carries the current month.
    """
    raw = http_get("https://www.finra.org/sites/default/files/2021-03/margin-statistics.xlsx",
                   binary=True)
    z = zipfile.ZipFile(io.BytesIO(raw))
    sheet = [n for n in z.namelist() if n.startswith("xl/worksheets/")][0]
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    rows = []
    for row in ET.fromstring(z.read(sheet)).iter(ns + "row"):
        vals = []
        for c in row.iter(ns + "c"):
            inline = c.find(ns + "is")
            if inline is not None:
                t = inline.find(ns + "t")
                vals.append(t.text if t is not None else "")
            else:
                v = c.find(ns + "v")
                vals.append(v.text if v is not None else "")
        rows.append(vals)
    out = []
    for r in rows[1:]:
        if len(r) < 2 or not r[0] or "-" not in str(r[0]):
            continue
        try:
            out.append((str(r[0]), float(r[1])))
        except (TypeError, ValueError):
            continue
    out.sort()
    if not out:
        raise RuntimeError("FINRA margin: nothing parsed")
    return out


def yoy_series(pts):
    """[(period, yoy_percent)] for a monthly YYYY-MM series."""
    by = dict(pts)
    out = []
    for period, val in pts:
        y, m = period.split("-")
        prior = by.get(f"{int(y) - 1}-{m}")
        if prior:
            out.append((period, round((val / prior - 1) * 100, 1)))
    return out


def rank_of(value, series):
    """Percentile of `value` within a plain list of numbers."""
    if value is None or not series:
        return None
    below = sum(1 for v in series if v < value)
    ties = sum(1 for v in series if v == value)
    return round((below + ties / 2) / len(series) * 100, 1)


def main():
    now = datetime.now(timezone.utc)
    out = {"generated_at": now.isoformat(timespec="seconds")}

    # ---- credit ----------------------------------------------------------
    credit = {}
    series_cache = {}
    for key, sid, label in OAS:
        try:
            pts = fred(sid)
        except Exception as e:  # noqa: BLE001 - one bad series must not sink the run
            print(f"  ! {sid}: {e}", file=sys.stderr)
            continue
        series_cache[key] = pts
        # However much history the licence actually served, reported as such.
        # Never a fixed window the data may not cover.
        span = span_years(pts)
        credit[key] = {
            "label": label, "series": sid,
            "last": pts[-1][1], "date": pts[-1][0],
            "chg_1m": round(pts[-1][1] - ago(pts, 30), 2) if ago(pts, 30) else None,
            "chg_3m": round(pts[-1][1] - ago(pts, 91), 2) if ago(pts, 91) else None,
            "chg_1y": round(pts[-1][1] - ago(pts, 365), 2) if ago(pts, 365) else None,
            "span_years": span, "n": len(pts), "from": pts[0][0],
            "pct_span": pctile_all(pts),
            "min_span": min(v for _, v in pts),
            "max_span": max(v for _, v in pts),
        }
        print(f"  credit {label}: {pts[-1][1]} ({pts[-1][0]}) "
              f"pct over {span}y = {credit[key]['pct_span']}")
    out["credit"] = credit

    # ---- long-history credit --------------------------------------------
    longc = {}
    for key, sid, label in LONG_CREDIT:
        try:
            pts = fred(sid)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {sid}: {e}", file=sys.stderr)
            continue
        span = span_years(pts)
        longc[key] = {
            "label": label, "series": sid,
            "last": pts[-1][1], "date": pts[-1][0], "from": pts[0][0],
            "span_years": span, "n": len(pts),
            "pct_10y": pctile(pts, 10), "pct_20y": pctile(pts, 20),
            "pct_span": pctile_all(pts),
            "min_span": min(v for _, v in pts), "max_span": max(v for _, v in pts),
            "chg_3m": round(pts[-1][1] - ago(pts, 91), 2) if ago(pts, 91) else None,
            "chg_1y": round(pts[-1][1] - ago(pts, 365), 2) if ago(pts, 365) else None,
        }
        print(f"  long credit {label}: {pts[-1][1]} = {longc[key]['pct_span']}th pct "
              f"of {span}y ({len(pts)} obs)")
    out["long_credit"] = longc

    # Dispersion inside high yield. An index at its tights with CCC gapping is
    # the shape that has preceded credit turns; both tight together is not.
    if "ccc" in series_cache and "bb" in series_cache:
        ccc, bb = dict(series_cache["ccc"]), dict(series_cache["bb"])
        shared = sorted(set(ccc) & set(bb))
        disp = [(d, round(ccc[d] - bb[d], 2)) for d in shared]
        dspan = span_years(disp)
        out["dispersion"] = {
            "last": disp[-1][1], "date": disp[-1][0],
            "span_years": dspan, "pct_span": pctile_all(disp),
            "min_span": min(v for _, v in disp), "max_span": max(v for _, v in disp),
            "chg_3m": round(disp[-1][1] - ago(disp, 91), 2) if ago(disp, 91) else None,
        }
        print(f"  dispersion CCC-BB: {disp[-1][1]} = "
              f"{out['dispersion']['pct_span']}th pct of {dspan}y")

    # ---- the price of protection -----------------------------------------
    prot, prot_series = {}, {}
    for key, sid, label, short in PROTECTION:
        try:
            pts = fred(sid)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {sid}: {e}", file=sys.stderr)
            continue
        prot_series[key] = pts
        prot[key] = {
            "label": label, "short": short, "series": sid,
            "last": pts[-1][1], "date": pts[-1][0], "from": pts[0][0],
            "span_years": span_years(pts), "n": len(pts),
            "pct_span": pctile_all(pts),
            "min_span": min(v for _, v in pts), "max_span": max(v for _, v in pts),
            "chg_3m": round(pts[-1][1] - ago(pts, 91), 2) if ago(pts, 91) else None,
        }
        print(f"  protection {short}: {pts[-1][1]} = {prot[key]['pct_span']}th pct "
              f"of {prot[key]['span_years']}y ({len(pts)} obs)")

    # The one spread worth taking: both legs in volatility points, both
    # starting the same day, so the difference means something and can be
    # ranked over the whole common history rather than the shorter of two.
    if "vxn" in prot_series and "vix" in prot_series:
        vxn, vix = dict(prot_series["vxn"]), dict(prot_series["vix"])
        shared = sorted(set(vxn) & set(vix))
        sp = [(d, round(vxn[d] - vix[d], 2)) for d in shared]
        prot["vxn_less_vix"] = {
            "label": "Nasdaq volatility premium", "short": "VXN less VIX",
            "series": "VXNCLS - VIXCLS",
            "last": sp[-1][1], "date": sp[-1][0], "from": sp[0][0],
            "span_years": span_years(sp), "n": len(sp),
            "pct_span": pctile_all(sp),
            "min_span": min(v for _, v in sp), "max_span": max(v for _, v in sp),
            "chg_3m": round(sp[-1][1] - ago(sp, 91), 2) if ago(sp, 91) else None,
        }
        print(f"  protection VXN-VIX: {sp[-1][1]} = "
              f"{prot['vxn_less_vix']['pct_span']}th pct of "
              f"{prot['vxn_less_vix']['span_years']}y")
    out["protection"] = prot

    # ---- investment grade by maturity ------------------------------------
    curve = []
    for key, sid, label in IG_CURVE:
        try:
            pts = fred(sid)
        except Exception as e:  # noqa: BLE001
            print(f"  ! {sid}: {e}", file=sys.stderr)
            continue
        curve.append({
            "key": key, "label": label, "series": sid,
            "last": pts[-1][1], "date": pts[-1][0],
            "chg_3m": round(pts[-1][1] - ago(pts, 91), 2) if ago(pts, 91) else None,
            "chg_1y": round(pts[-1][1] - ago(pts, 365), 2) if ago(pts, 365) else None,
            "span_years": span_years(pts),
        })
    out["ig_curve"] = curve
    if len(curve) >= 2:
        print(f"  IG curve: {curve[0]['last']}pp at {curve[0]['label']} -> "
              f"{curve[-1]['last']}pp at {curve[-1]['label']}")

    for key, sid in OTHER_FRED:
        try:
            pts = fred(sid)
            out[key] = {"last": pts[-1][1], "date": pts[-1][0],
                        "chg_1y": round(pts[-1][1] - ago(pts, 365), 2) if ago(pts, 365) else None}
        except Exception as e:  # noqa: BLE001
            print(f"  ! {sid}: {e}", file=sys.stderr)

    # ---- margin debt -----------------------------------------------------
    try:
        margin = fetch_margin()
        yoy = yoy_series(margin)
        cur = yoy[-1][1] if yoy else None
        # Which months in the whole record grew faster than this one, collapsed
        # to the episodes they belong to. A percentile says how unusual the
        # reading is; the episodes say what company it keeps, which on this
        # page is the more useful of the two.
        faster = [p for p, v in yoy[:-1] if cur is not None and v > cur]
        episodes = []
        for p in faster:
            y, m = int(p[:4]), int(p[5:])
            if episodes and (y * 12 + m) - (episodes[-1]["_end"]) <= 3:
                episodes[-1]["to"] = p
                episodes[-1]["_end"] = y * 12 + m
            else:
                episodes.append({"from": p, "to": p, "_end": y * 12 + m})
        for e in episodes:
            e.pop("_end", None)
            e["peak"] = max(v for p, v in yoy if e["from"] <= p <= e["to"])
        # Months a little faster than this one but only weeks ago are the same
        # run, not a precedent for it. Comparing the present with itself would
        # put "2026" in a list whose whole purpose is to name earlier cycles.
        cur_period = yoy[-1][0]
        cur_idx = int(cur_period[:4]) * 12 + int(cur_period[5:])

        def months_back(p):
            return cur_idx - (int(p[:4]) * 12 + int(p[5:]))

        current_run = [e for e in episodes if months_back(e["to"]) <= 12]
        episodes = [e for e in episodes if months_back(e["to"]) > 12]
        out["margin"] = {
            "last": margin[-1][1], "period": margin[-1][0],
            "yoy": cur,
            "yoy_pct_rank": rank_of(cur, [v for _, v in yoy]) if yoy else None,
            "from": margin[0][0], "n_months": len(margin), "n_yoy": len(yoy),
            "record_high": max(v for _, v in yoy) if yoy else None,
            "faster_episodes": episodes,
            "current_run_peak": max((e["peak"] for e in current_run), default=None),
            "history": [{"p": p, "v": v} for p, v in margin[-72:]],
            "yoy_history": [{"p": p, "v": v} for p, v in yoy[-72:]],
        }
        print(f"  margin debt: ${margin[-1][1] / 1e6:.3f}tn ({margin[-1][0]}) "
              f"yoy={cur}% rank={out['margin']['yoy_pct_rank']} "
              f"since {margin[0][0]}; faster in {len(episodes)} episodes: "
              f"{', '.join(e['from'][:4] for e in episodes)}")
    except Exception as e:  # noqa: BLE001
        print(f"  ! FINRA margin: {e}", file=sys.stderr)

    # ---- the complex -----------------------------------------------------
    tickers = [c[0] for c in COMPLEX]
    # The scanner can answer with every ticker present and every fundamental
    # null; that response wiped this table to zeros once already. Retry on
    # thinness rather than on failure, because nothing fails.
    data = quality.retry_until_dense(
        lambda: [dict(zip(COLUMNS, r["d"]), s=r["s"])
                 for r in scan(SCAN, {"symbols": {"tickers": tickers}, "columns": COLUMNS,
                                      "price_conversion": {"to_symbol": True}}).get("data", [])],
        ["market_cap_basic", "total_revenue_ttm", "ebitda_ttm"],
        "AI complex")
    got = {r["s"]: {c: r[c] for c in COLUMNS} for r in data}
    missing = [t for t in tickers if t not in got]
    if missing:
        print(f"  ! no scanner row for: {', '.join(missing)}", file=sys.stderr)

    names = []
    for tv, ysym, label, layer in COMPLEX:
        d = got.get(tv)
        if not d:
            continue
        capex_ttm = d.get("capital_expenditures_ttm")
        capex_ntm = d.get("capital_expenditures_estimate_ntm")
        cfo = d.get("cash_f_operating_activities_ttm")
        # Capex is reported negative in the cash-flow statement and estimated
        # positive by the consensus feed. Normalise to positive spend or the
        # comparison between the two is nonsense.
        capex_ttm = abs(capex_ttm) if capex_ttm else None
        capex_ntm = abs(capex_ntm) if capex_ntm else None
        rec = {
            "tv": tv, "sym": ysym, "name": label, "layer": layer,
            "currency": d.get("currency"),
            "cap": d.get("market_cap_basic"),
            "rev": d.get("total_revenue_ttm"),
            "ebitda": d.get("ebitda_ttm"),
            "fcf": d.get("free_cash_flow_ttm"),
            "capex_ttm": capex_ttm, "capex_ntm": capex_ntm, "cfo": cfo,
            "capex_cfo": round(capex_ttm / cfo * 100, 1) if capex_ttm and cfo and cfo > 0 else None,
            "capex_cfo_fwd": round(capex_ntm / cfo * 100, 1) if capex_ntm and cfo and cfo > 0 else None,
            "capex_growth": round((capex_ntm / capex_ttm - 1) * 100, 1)
                            if capex_ttm and capex_ntm and capex_ttm > 0 else None,
            "debt": d.get("total_debt"), "net_debt": d.get("net_debt"),
            "nd_ebitda": rnd(d.get("net_debt_to_ebitda_fy")),
            "cost_debt": rnd(d.get("effective_interest_rate_on_debt_ttm")),
            "capex_cover": rnd(d.get("ebitda_less_capex_interst_cover_fy")),
            "pe": rnd(d.get("price_earnings_ttm")),
            "ps": rnd(d.get("price_sales_current")),
            "ev_ebitda": rnd(d.get("enterprise_value_ebitda_current")),
            "gm": rnd(d.get("gross_margin_ttm")),
            "ytd": rnd(d.get("Perf.YTD")), "y1": rnd(d.get("Perf.Y")),
        }
        names.append(rec)

    # Money-denominated fields get a USD twin so the complex can be ranked.
    # Ratios (EV/sales, net debt/EBITDA) and rates (cost of debt) are already
    # currency-neutral and are deliberately left alone.
    fx = fetch_fx([n.get("currency") for n in names])
    out["fx"] = {k: round(v, 8) for k, v in fx.items()}
    for n in names:
        rate = fx.get(n.get("currency"))
        for field in ("cap", "rev", "ebitda", "fcf", "debt", "net_debt"):
            n[field + "_usd"] = (round(n[field] * rate)
                                 if rate and n.get(field) is not None else None)
    non_usd = sorted({n["currency"] for n in names
                      if n.get("currency") and n["currency"] != "USD"})
    print(f"  fx: converted {', '.join(non_usd) or 'nothing'} "
          f"({', '.join(f'{c} {fx[c]:.6f}' for c in non_usd if c in fx)})")

    out["names"] = names
    out["layers"] = LAYER_LABEL
    print(f"  complex: {len(names)} of {len(COMPLEX)} names resolved")

    # ---- the funding gap -------------------------------------------------
    by_tv = {n["tv"]: n for n in names}

    def totals(keys):
        t = {"capex_ttm": 0, "capex_ntm": 0, "cfo": 0, "net_debt": 0, "cap": 0, "n": 0}
        for k in keys:
            n = by_tv.get(k)
            if not n:
                continue
            t["n"] += 1
            for f in ("capex_ttm", "capex_ntm", "cfo", "net_debt", "cap"):
                if n.get(f):
                    t[f] += n[f]
        return t

    hyper = totals(CAPEX_NAMES)
    neo = totals(NEOCLOUD_CAPEX)
    out["funding"] = {
        "hyperscaler": hyper, "neocloud": neo,
        # Named so the page can mark which rows the headline aggregate covers.
        # A table showing seven hyperscalers beside a tile that says five, with
        # nothing saying which five, is a question the reader should not have.
        "hyper_members": [by_tv[k]["sym"] for k in CAPEX_NAMES if k in by_tv],
        "neo_members": [by_tv[k]["sym"] for k in NEOCLOUD_CAPEX if k in by_tv],
        # Cash flow does not stand still while capex grows, so comparing next
        # year's capex to this year's cash flow overstates the gap. The page
        # says so and shows both the raw ratio and the ratio against cash flow
        # grown at its own trailing rate.
        "hyper_gap_now": round(hyper["capex_ttm"] - hyper["cfo"], 0),
        "hyper_gap_fwd": round(hyper["capex_ntm"] - hyper["cfo"], 0),
        "hyper_ratio_now": round(hyper["capex_ttm"] / hyper["cfo"] * 100, 1) if hyper["cfo"] else None,
        "hyper_ratio_fwd": round(hyper["capex_ntm"] / hyper["cfo"] * 100, 1) if hyper["cfo"] else None,
    }
    print(f"  hyperscaler capex TTM ${hyper['capex_ttm'] / 1e9:.0f}bn -> "
          f"NTM ${hyper['capex_ntm'] / 1e9:.0f}bn vs CFO ${hyper['cfo'] / 1e9:.0f}bn")

    # ---- concentration ---------------------------------------------------
    # The 500 largest US listings, summed. Not the S&P 500 — membership is a
    # committee decision and there is no free constituent list — but the same
    # order of magnitude, and the page names it for what it is.
    try:
        uni = scan(SCAN_US, {
            "filter": [{"left": "type", "operation": "equal", "right": "stock"},
                       {"left": "is_primary", "operation": "equal", "right": True},
                       {"left": "market_cap_basic", "operation": "greater", "right": 2e9}],
            "options": {"lang": "en"}, "markets": ["america"],
            "columns": ["name", "market_cap_basic"],
            "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
            "range": [0, 500]}).get("data", [])
        caps = [(r["d"][0], r["d"][1]) for r in uni if r["d"][1]]
        total = sum(c for _, c in caps)
        mag7 = {"NVDA", "MSFT", "AAPL", "GOOGL", "GOOG", "AMZN", "META", "AVGO"}
        ai_us = {n["sym"] for n in names if "." not in n["sym"]}
        out["concentration"] = {
            "universe_n": len(caps), "universe_cap": total,
            "top10_cap": sum(c for _, c in caps[:10]),
            "mag7_cap": sum(c for s, c in caps if s in mag7),
            "ai_cap": sum(c for s, c in caps if s in ai_us),
            "top10_pct": round(sum(c for _, c in caps[:10]) / total * 100, 1),
            "mag7_pct": round(sum(c for s, c in caps if s in mag7) / total * 100, 1),
            "ai_pct": round(sum(c for s, c in caps if s in ai_us) / total * 100, 1),
            "largest": [{"s": s, "cap": c} for s, c in caps[:10]],
        }
        print(f"  concentration: top10 {out['concentration']['top10_pct']}% of "
              f"{len(caps)} names, AI complex {out['concentration']['ai_pct']}%")
    except Exception as e:  # noqa: BLE001
        print(f"  ! concentration: {e}", file=sys.stderr)

    # Nvidia against the whole US economy. Cisco reached roughly 5% of GDP in
    # March 2000 and that is the comparison everyone reaches for, so the figure
    # is computed rather than asserted.
    nv = by_tv.get("NASDAQ:NVDA")
    if nv and nv.get("cap") and out.get("gdp"):
        out["nvda_gdp"] = round(nv["cap"] / (out["gdp"]["last"] * 1e9) * 100, 1)
        print(f"  Nvidia = {out['nvda_gdp']}% of US GDP")

    # ---- Korea -----------------------------------------------------------
    # Samsung and Hynix against their own market. When two memory names are a
    # third of a national index, that index has stopped being a country bet.
    try:
        kr = scan(SCAN_KR, {
            "filter": [{"left": "type", "operation": "equal", "right": "stock"},
                       {"left": "is_primary", "operation": "equal", "right": True}],
            "options": {"lang": "en"}, "markets": ["korea"],
            "columns": ["name", "market_cap_basic"],
            "sort": {"sortBy": "market_cap_basic", "sortOrder": "desc"},
            "range": [0, 500]}).get("data", [])
        kcaps = [(r["d"][0], r["d"][1]) for r in kr if r["d"][1]]
        ktot = sum(c for _, c in kcaps)
        mem = sum(c for s, c in kcaps if s in ("005930", "000660"))
        if ktot:
            out["korea"] = {"universe_n": len(kcaps), "universe_cap": ktot,
                            "memory_cap": mem, "memory_pct": round(mem / ktot * 100, 1)}
            print(f"  Korea: Samsung+Hynix = {out['korea']['memory_pct']}% of "
                  f"top {len(kcaps)} listings")
    except Exception as e:  # noqa: BLE001
        print(f"  ! korea: {e}", file=sys.stderr)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Market cap and revenue are the spine of the complex table and of the
    # concentration block built from it; when the scanner thins out, they go
    # first and everything downstream quietly becomes zero.
    cov = quality.coverage(out.get("names") or [], ["cap", "rev", "ebitda"])
    old_cov = lambda old: quality.coverage(old.get("names") or [], ["cap", "rev", "ebitda"])
    if not quality.safe_to_write(OUT, cov, old_cov, "ai.json"):
        sys.exit(1)
    OUT.write_text(json.dumps(out, indent=1, sort_keys=False) + "\n")
    print(f"Wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")


def rnd(v, n=2):
    return None if v is None else round(v, n)


if __name__ == "__main__":
    main()
