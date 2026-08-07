#!/usr/bin/env python3
"""Fetch macro indicators from official sources and write docs/data/macro.json.

Sources (all free, no API key):
  - FRED (Federal Reserve Bank of St. Louis) CSV endpoint
  - ECB Data Portal SDMX API
  - World Bank Open Data API

Run: python3 scripts/fetch_data.py
"""

import csv
import io
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

OUT_PATH = Path(__file__).resolve().parent.parent / "docs" / "data" / "macro.json"

UA = {"User-Agent": "macro-compass-dashboard (github.com/joeedessa/macro-compass)"}


def http_get(url, retries=3):
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as e:  # noqa: BLE001 - retry any transport error
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"failed to fetch {url}: {last_err}")


def fetch_fred(series_id):
    """Return [(iso_date, float), ...] for a FRED series. '.' rows are missing."""
    text = http_get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}")
    points = []
    for row in csv.DictReader(io.StringIO(text)):
        date = row.get("observation_date") or row.get("DATE")
        val = row.get(series_id)
        if not date or val in (None, "", "."):
            continue
        points.append((date, float(val)))
    if not points:
        raise RuntimeError(f"FRED {series_id}: no data parsed")
    return points


def fetch_ecb(flow, key, last_n=None):
    """Return [(period, float), ...] from the ECB Data Portal SDMX CSV API."""
    url = f"https://data-api.ecb.europa.eu/service/data/{flow}/{key}?format=csvdata"
    if last_n:
        url += f"&lastNObservations={last_n}"
    text = http_get(url)
    points = []
    for row in csv.DictReader(io.StringIO(text)):
        period = row.get("TIME_PERIOD")
        val = row.get("OBS_VALUE")
        if not period or val in (None, ""):
            continue
        points.append((period, float(val)))
    if not points:
        raise RuntimeError(f"ECB {flow}/{key}: no data parsed")
    points.sort()
    return points


def fetch_worldbank(country, indicator, years=25):
    """Return [(year, float), ...] from the World Bank API."""
    url = (
        f"https://api.worldbank.org/v2/country/{country}/indicator/{indicator}"
        f"?format=json&mrv={years}"
    )
    payload = json.loads(http_get(url))
    if len(payload) < 2 or not payload[1]:
        raise RuntimeError(f"World Bank {country}/{indicator}: no data")
    points = [
        (row["date"], round(row["value"], 2))
        for row in payload[1]
        if row["value"] is not None
    ]
    points.sort()
    return points


def yoy_percent(points):
    """Year-over-year % change for a monthly index series."""
    by_date = dict(points)
    out = []
    for date, val in points:
        year, rest = date.split("-", 1)
        prev = by_date.get(f"{int(year) - 1}-{rest}")
        if prev:
            out.append((date, round((val / prev - 1) * 100, 2)))
    return out


def month_delta(points):
    """First difference of a monthly series (e.g. payrolls change)."""
    return [
        (points[i][0], round(points[i][1] - points[i - 1][1], 1))
        for i in range(1, len(points))
    ]


def trim(points, years):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=365.25 * years)).strftime("%Y-%m-%d")
    return [(d, v) for d, v in points if d >= cutoff[: len(d)]]


FRED_URL = "https://fred.stlouisfed.org/series/"

# id, label, unit, frequency, group, builder
SERIES = [
    # --- United States ---
    ("us_cpi_yoy", "CPI inflation", "% y/y", "monthly", "us",
     lambda: trim(yoy_percent(fetch_fred("CPIAUCSL")), 15),
     "FRED · BLS", FRED_URL + "CPIAUCSL"),
    ("us_unemployment", "Unemployment rate", "%", "monthly", "us",
     lambda: trim(fetch_fred("UNRATE"), 15),
     "FRED · BLS", FRED_URL + "UNRATE"),
    ("us_gdp_growth", "Real GDP growth", "% q/q ann.", "quarterly", "us",
     lambda: trim(fetch_fred("A191RL1Q225SBEA"), 15),
     "FRED · BEA", FRED_URL + "A191RL1Q225SBEA"),
    ("us_payrolls_chg", "Nonfarm payrolls change", "thousands", "monthly", "us",
     lambda: trim(month_delta(fetch_fred("PAYEMS")), 15),
     "FRED · BLS", FRED_URL + "PAYEMS"),
    ("us_fed_funds", "Fed funds target (upper)", "%", "daily", "us",
     lambda: trim(fetch_fred("DFEDTARU"), 15),
     "FRED · Federal Reserve", FRED_URL + "DFEDTARU"),
    ("us_treasury_10y", "10-year Treasury yield", "%", "daily", "us",
     lambda: trim(fetch_fred("DGS10"), 5),
     "FRED · US Treasury", FRED_URL + "DGS10"),
    ("us_treasury_2y", "2-year Treasury yield", "%", "daily", "us",
     lambda: trim(fetch_fred("DGS2"), 5),
     "FRED · US Treasury", FRED_URL + "DGS2"),
    ("us_yield_spread", "10y minus 2y spread", "pp", "daily", "us",
     lambda: trim(fetch_fred("T10Y2Y"), 15),
     "FRED · US Treasury", FRED_URL + "T10Y2Y"),
    # --- Credit spreads (the cleaner credit signal; HYG/IEF is only a proxy) ---
    ("cr_hy_oas", "US high yield OAS", "pp", "daily", "credit",
     lambda: trim(fetch_fred("BAMLH0A0HYM2"), 15),
     "FRED · ICE BofA", FRED_URL + "BAMLH0A0HYM2"),
    ("cr_ig_oas", "US investment grade OAS", "pp", "daily", "credit",
     lambda: trim(fetch_fred("BAMLC0A0CM"), 15),
     "FRED · ICE BofA", FRED_URL + "BAMLC0A0CM"),
    # --- Markets ---
    ("mkt_sp500", "S&P 500", "index", "daily", "markets",
     lambda: trim(fetch_fred("SP500"), 5),
     "FRED · S&P Dow Jones", FRED_URL + "SP500"),
    ("mkt_nasdaq", "Nasdaq Composite", "index", "daily", "markets",
     lambda: trim(fetch_fred("NASDAQCOM"), 5),
     "FRED · Nasdaq", FRED_URL + "NASDAQCOM"),
    ("mkt_dow", "Dow Jones Industrial", "index", "daily", "markets",
     lambda: trim(fetch_fred("DJIA"), 5),
     "FRED · S&P Dow Jones", FRED_URL + "DJIA"),
    ("mkt_vix", "VIX volatility", "index", "daily", "markets",
     lambda: trim(fetch_fred("VIXCLS"), 5),
     "FRED · Cboe", FRED_URL + "VIXCLS"),
    ("mkt_dollar", "US dollar index (broad)", "index", "daily", "markets",
     lambda: trim(fetch_fred("DTWEXBGS"), 5),
     "FRED · Federal Reserve", FRED_URL + "DTWEXBGS"),
    ("mkt_wti", "WTI crude oil", "$/barrel", "daily", "commodities",
     lambda: trim(fetch_fred("DCOILWTICO"), 5),
     "FRED · EIA", FRED_URL + "DCOILWTICO"),
    # --- Commodities (IMF primary commodity prices via FRED) ---
    ("cmd_copper", "Copper", "$/tonne", "monthly", "commodities",
     lambda: trim(fetch_fred("PCOPPUSDM"), 15),
     "FRED · IMF", FRED_URL + "PCOPPUSDM"),
    ("cmd_aluminum", "Aluminum", "$/tonne", "monthly", "commodities",
     lambda: trim(fetch_fred("PALUMUSDM"), 15),
     "FRED · IMF", FRED_URL + "PALUMUSDM"),
    ("cmd_nickel", "Nickel", "$/tonne", "monthly", "commodities",
     lambda: trim(fetch_fred("PNICKUSDM"), 15),
     "FRED · IMF", FRED_URL + "PNICKUSDM"),
    ("cmd_uranium", "Uranium", "$/lb", "monthly", "commodities",
     lambda: trim(fetch_fred("PURANUSDM"), 15),
     "FRED · IMF", FRED_URL + "PURANUSDM"),
    # --- Global ---
    ("ea_hicp_yoy", "Euro area HICP inflation", "% y/y", "monthly", "global",
     lambda: fetch_ecb("HICP", "M.U2.N.000000.4D0.ANR", last_n=180),
     "ECB · Eurostat", "https://data.ecb.europa.eu/data/datasets/HICP"),
    ("ea_depo_rate", "ECB deposit facility rate", "%", "daily", "global",
     lambda: fetch_ecb("FM", "D.U2.EUR.4F.KR.DFR.LEV", last_n=4000),
     "ECB", "https://data.ecb.europa.eu/data/datasets/FM"),
    ("eur_usd", "EUR/USD", "rate", "daily", "global",
     lambda: fetch_ecb("EXR", "D.USD.EUR.SP00.A", last_n=1300),
     "ECB", "https://data.ecb.europa.eu/data/datasets/EXR"),
    ("usd_jpy", "USD/JPY", "yen per dollar", "daily", "global",
     lambda: trim(fetch_fred("DEXJPUS"), 5),
     "FRED · Federal Reserve", FRED_URL + "DEXJPUS"),
    ("de_bund_10y", "German 10-year bund yield", "%", "monthly", "global",
     lambda: trim(fetch_fred("IRLTLT01DEM156N"), 15),
     "FRED · OECD", FRED_URL + "IRLTLT01DEM156N"),
    # --- Global equity benchmarks ---
    ("nikkei_225", "Nikkei 225", "index", "daily", "global",
     lambda: trim(fetch_fred("NIKKEI225"), 5),
     "FRED · Nikkei", FRED_URL + "NIKKEI225"),
    ("eurostoxx_50", "Euro Stoxx 50", "index", "monthly", "global",
     lambda: fetch_ecb("FM", "M.U2.EUR.DS.EI.DJES50I.HSTA", last_n=180),
     "ECB", "https://data.ecb.europa.eu/data/datasets/FM"),
    # OECD share price indices (2015 = 100) — comparable across countries
    ("shr_de", "Germany", "index (2015=100)", "monthly", "global",
     lambda: trim(fetch_fred("SPASTT01DEM661N"), 15),
     "FRED · OECD", FRED_URL + "SPASTT01DEM661N"),
    ("shr_fr", "France", "index (2015=100)", "monthly", "global",
     lambda: trim(fetch_fred("SPASTT01FRM661N"), 15),
     "FRED · OECD", FRED_URL + "SPASTT01FRM661N"),
    ("shr_gb", "United Kingdom", "index (2015=100)", "monthly", "global",
     lambda: trim(fetch_fred("SPASTT01GBM661N"), 15),
     "FRED · OECD", FRED_URL + "SPASTT01GBM661N"),
    ("shr_ca", "Canada", "index (2015=100)", "monthly", "global",
     lambda: trim(fetch_fred("SPASTT01CAM661N"), 15),
     "FRED · OECD", FRED_URL + "SPASTT01CAM661N"),
    ("shr_au", "Australia", "index (2015=100)", "monthly", "global",
     lambda: trim(fetch_fred("SPASTT01AUM661N"), 15),
     "FRED · OECD", FRED_URL + "SPASTT01AUM661N"),
    ("shr_cn", "China", "index (2015=100)", "monthly", "global",
     lambda: trim(fetch_fred("SPASTT01CNM661N"), 15),
     "FRED · OECD", FRED_URL + "SPASTT01CNM661N"),
    ("shr_in", "India", "index (2015=100)", "monthly", "global",
     lambda: trim(fetch_fred("SPASTT01INM661N"), 15),
     "FRED · OECD", FRED_URL + "SPASTT01INM661N"),
    ("cn_cpi", "China CPI inflation", "% y/y (annual)", "annual", "global",
     lambda: fetch_worldbank("chn", "FP.CPI.TOTL.ZG"),
     "World Bank", "https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG?locations=CN"),
    ("cn_gdp", "China GDP growth", "% (annual)", "annual", "global",
     lambda: fetch_worldbank("chn", "NY.GDP.MKTP.KD.ZG"),
     "World Bank", "https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG?locations=CN"),
    ("jp_cpi", "Japan CPI inflation", "% y/y (annual)", "annual", "global",
     lambda: fetch_worldbank("jpn", "FP.CPI.TOTL.ZG"),
     "World Bank", "https://data.worldbank.org/indicator/FP.CPI.TOTL.ZG?locations=JP"),
    ("jp_gdp", "Japan GDP growth", "% (annual)", "annual", "global",
     lambda: fetch_worldbank("jpn", "NY.GDP.MKTP.KD.ZG"),
     "World Bank", "https://data.worldbank.org/indicator/NY.GDP.MKTP.KD.ZG?locations=JP"),
]


def main():
    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "series": {},
    }
    failures = []
    for sid, label, unit, freq, group, build, source, source_url in SERIES:
        try:
            points = build()
            out["series"][sid] = {
                "label": label,
                "unit": unit,
                "freq": freq,
                "group": group,
                "source": source,
                "source_url": source_url,
                "points": points,
            }
            print(f"ok   {sid}: {len(points)} points, latest {points[-1]}")
        except Exception as e:  # noqa: BLE001 - one bad series must not sink the rest
            failures.append(sid)
            print(f"FAIL {sid}: {e}", file=sys.stderr)

    if len(failures) > len(SERIES) // 2:
        sys.exit(f"aborting: {len(failures)} of {len(SERIES)} series failed")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size // 1024} KB)")
    if failures:
        print(f"warning: kept previous run's data missing for: {', '.join(failures)}")


if __name__ == "__main__":
    main()
