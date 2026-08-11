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


def fetch_auctions(term, field="bidToCoverRatio", years=6):
    """Treasury auction results direct from TreasuryDirect (official, no key).

    `term` is a securityTerm string such as "10-Year". Returns
    [(auction_date, value), ...]. `field` picks the metric: bid-to-cover, or
    "indirect" for the share of the auction taken by indirect bidders — the
    closest public proxy for foreign official demand.
    """
    sec_type = "Bond" if term in ("20-Year", "30-Year") else "Note"
    url = (
        "https://www.treasurydirect.gov/TA_WS/securities/auctioned"
        f"?format=json&type={sec_type}&pagesize=600"
    )
    rows = json.loads(http_get(url))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=365 * years)).strftime("%Y-%m-%d")
    out = {}
    for r in rows:
        # Reopenings carry a fractional securityTerm ("9-Year 11-Month"), so
        # match originalSecurityTerm or the whole reopening cycle is dropped.
        if (r.get("originalSecurityTerm") or r.get("securityTerm")) != term:
            continue
        date = (r.get("auctionDate") or "")[:10]
        if not date or date < cutoff:
            continue
        try:
            if field == "indirect":
                accepted = float(r.get("totalAccepted") or 0)
                indirect = float(r.get("indirectBidderAccepted") or 0)
                if accepted <= 0:
                    continue
                val = round(indirect / accepted * 100, 1)
            else:
                raw = r.get(field)
                if raw in (None, ""):
                    continue
                val = round(float(raw), 2)
        except (TypeError, ValueError):
            continue
        out[date] = val          # dedupe reopenings on the same date
    points = sorted(out.items())
    if not points:
        raise RuntimeError(f"TreasuryDirect {term}/{field}: no data parsed")
    return points


# CFTC contract names, verified against the live Socrata catalogue. The
# ampersand in the S&P name must stay percent-encoded or the filter silently
# matches nothing.
COT_CONTRACTS = {
    "spx": "E-MINI S%26P 500 - CHICAGO MERCANTILE EXCHANGE",
    "gold": "GOLD - COMMODITY EXCHANGE INC.",
    "silver": "SILVER - COMMODITY EXCHANGE INC.",
    "copper": "COPPER- #1 - COMMODITY EXCHANGE INC.",
    "platinum": "PLATINUM - NEW YORK MERCANTILE EXCHANGE",
    "wti": "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE",
    "natgas": "NAT GAS NYME - NEW YORK MERCANTILE EXCHANGE",
    "corn": "CORN - CHICAGO BOARD OF TRADE",
    "wheat": "WHEAT-SRW - CHICAGO BOARD OF TRADE",
    "soybeans": "SOYBEANS - CHICAGO BOARD OF TRADE",
    "sugar": "SUGAR NO. 11 - ICE FUTURES U.S.",
    "coffee": "COFFEE C - ICE FUTURES U.S.",
    "cocoa": "COCOA - ICE FUTURES U.S.",
    "cotton": "COTTON NO. 2 - ICE FUTURES U.S.",
}


def fetch_cot(measure, contract="spx", years=5):
    """CFTC Commitments of Traders, weekly (official Socrata API, no key).

    `measure` selects which cohort's net position is returned, as a percentage
    of open interest:
      commercial_net  — commercial hedgers (producers and merchants). In the
                        metals these run structurally short because miners
                        hedge output, so read the level against its own history
                        rather than against zero.
      large_net       — non-commercial (managed money and other large specs)
      small_net       — non-reportable, the conventional "dumb money" read
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=365 * years)).strftime("%Y-%m-%d")
    name = COT_CONTRACTS[contract]
    url = (
        "https://publicreporting.cftc.gov/resource/6dca-aqww.json"
        "?$select=report_date_as_yyyy_mm_dd,comm_positions_long_all,"
        "comm_positions_short_all,nonrept_positions_long_all,"
        "nonrept_positions_short_all,noncomm_positions_long_all,"
        "noncomm_positions_short_all,open_interest_all"
        f"&$where=market_and_exchange_names='{name}'"
        f" AND report_date_as_yyyy_mm_dd>'{cutoff}'"
        "&$order=report_date_as_yyyy_mm_dd&$limit=400"
    # "COPPER- #1" contains a hash, which a URL reads as a fragment delimiter
    # and silently truncates the whole filter — encode it.
    ).replace(" ", "%20").replace("'", "%27").replace("#", "%23")
    rows = json.loads(http_get(url))
    LEGS = {
        "commercial_net": ("comm_positions_long_all", "comm_positions_short_all"),
        "large_net": ("noncomm_positions_long_all", "noncomm_positions_short_all"),
        "small_net": ("nonrept_positions_long_all", "nonrept_positions_short_all"),
    }
    lng, sht = LEGS[measure]
    points = []
    for r in rows:
        try:
            oi = float(r["open_interest_all"])
            if oi <= 0:
                continue
            net = float(r[lng]) - float(r[sht])
            points.append((r["report_date_as_yyyy_mm_dd"][:10], round(net / oi * 100, 2)))
        except (KeyError, TypeError, ValueError):
            continue
    if not points:
        raise RuntimeError(f"CFTC COT {contract}/{measure}: no data parsed")
    return points


def wb_gold_component(country):
    """Value of gold in a country's reserves: total reserves minus reserves
    excluding gold, both from the World Bank. Returned in $bn. This is a value
    measure — it moves with both the gold price and the quantity held."""
    total = dict(fetch_worldbank(country, "FI.RES.TOTL.CD"))
    exgold = dict(fetch_worldbank(country, "FI.RES.XGLD.CD"))
    points = [
        (year, round((total[year] - exgold[year]) / 1e9, 1))
        for year in sorted(total)
        if year in exgold and total[year] and exgold[year]
    ]
    if not points:
        raise RuntimeError(f"gold component {country}: no overlapping years")
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
    # --- Sentiment / positioning (CFTC COT, weekly) ---
    ("cot_commercial", "Smart money: commercial hedgers net (S&P e-mini)", "% of OI", "weekly", "sentiment",
     lambda: fetch_cot("commercial_net"),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_small", "Dumb money: small speculators net (S&P e-mini)", "% of OI", "weekly", "sentiment",
     lambda: fetch_cot("small_net"),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    # Metals positioning. Commercials in the metals are miners hedging output,
    # so their net is structurally short — the signal is the move, not the sign.
    ("cot_gold_comm", "Gold: commercial hedgers net", "% of OI", "weekly", "sentiment",
     lambda: fetch_cot("commercial_net", "gold"),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_gold_large", "Gold: large speculators net", "% of OI", "weekly", "sentiment",
     lambda: fetch_cot("large_net", "gold"),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_silver_comm", "Silver: commercial hedgers net", "% of OI", "weekly", "sentiment",
     lambda: fetch_cot("commercial_net", "silver"),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_copper_comm", "Copper: commercial hedgers net", "% of OI", "weekly", "sentiment",
     lambda: fetch_cot("commercial_net", "copper"),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_copper_large", "Copper: large speculators net", "% of OI", "weekly", "sentiment",
     lambda: fetch_cot("large_net", "copper"),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_wti_comm", "WTI crude: commercial hedgers net", "% of OI", "weekly", "sentiment",
     lambda k="wti", m="commercial_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_wti_large", "WTI crude: large speculators net", "% of OI", "weekly", "sentiment",
     lambda k="wti", m="large_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_natgas_comm", "Natural gas: commercial hedgers net", "% of OI", "weekly", "sentiment",
     lambda k="natgas", m="commercial_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_natgas_large", "Natural gas: large speculators net", "% of OI", "weekly", "sentiment",
     lambda k="natgas", m="large_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_platinum_comm", "Platinum: commercial hedgers net", "% of OI", "weekly", "sentiment",
     lambda k="platinum", m="commercial_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_platinum_large", "Platinum: large speculators net", "% of OI", "weekly", "sentiment",
     lambda k="platinum", m="large_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_corn_comm", "Corn: commercial hedgers net", "% of OI", "weekly", "sentiment",
     lambda k="corn", m="commercial_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_corn_large", "Corn: large speculators net", "% of OI", "weekly", "sentiment",
     lambda k="corn", m="large_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_wheat_comm", "Wheat: commercial hedgers net", "% of OI", "weekly", "sentiment",
     lambda k="wheat", m="commercial_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_wheat_large", "Wheat: large speculators net", "% of OI", "weekly", "sentiment",
     lambda k="wheat", m="large_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_soybeans_comm", "Soybeans: commercial hedgers net", "% of OI", "weekly", "sentiment",
     lambda k="soybeans", m="commercial_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_soybeans_large", "Soybeans: large speculators net", "% of OI", "weekly", "sentiment",
     lambda k="soybeans", m="large_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_sugar_comm", "Sugar: commercial hedgers net", "% of OI", "weekly", "sentiment",
     lambda k="sugar", m="commercial_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_sugar_large", "Sugar: large speculators net", "% of OI", "weekly", "sentiment",
     lambda k="sugar", m="large_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_coffee_comm", "Coffee: commercial hedgers net", "% of OI", "weekly", "sentiment",
     lambda k="coffee", m="commercial_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_coffee_large", "Coffee: large speculators net", "% of OI", "weekly", "sentiment",
     lambda k="coffee", m="large_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_cocoa_comm", "Cocoa: commercial hedgers net", "% of OI", "weekly", "sentiment",
     lambda k="cocoa", m="commercial_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_cocoa_large", "Cocoa: large speculators net", "% of OI", "weekly", "sentiment",
     lambda k="cocoa", m="large_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_cotton_comm", "Cotton: commercial hedgers net", "% of OI", "weekly", "sentiment",
     lambda k="cotton", m="commercial_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    ("cot_cotton_large", "Cotton: large speculators net", "% of OI", "weekly", "sentiment",
     lambda k="cotton", m="large_net": fetch_cot(m, k),
     "CFTC", "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm"),
    # --- Official demand for Treasuries ---
    ("cb_foreign_custody", "Foreign official Treasuries at the Fed", "$m", "weekly", "official",
     lambda: trim(fetch_fred("WMTSECL1"), 15),
     "FRED · Federal Reserve", FRED_URL + "WMTSECL1"),
    ("cb_fed_treasuries", "Fed Treasury holdings", "$m", "weekly", "official",
     lambda: trim(fetch_fred("TREAST"), 15),
     "FRED · Federal Reserve", FRED_URL + "TREAST"),
    ("cb_foreign_held", "Federal debt held by foreign investors", "$bn", "quarterly", "official",
     lambda: trim(fetch_fred("FDHBFIN"), 15),
     "FRED · US Treasury", FRED_URL + "FDHBFIN"),
    # --- Treasury auction demand (TreasuryDirect) ---
    ("auc_btc_2y", "2-year auction bid-to-cover", "ratio", "per auction", "official",
     lambda: fetch_auctions("2-Year"),
     "TreasuryDirect", "https://www.treasurydirect.gov/auctions/auction-query/"),
    ("auc_btc_5y", "5-year auction bid-to-cover", "ratio", "per auction", "official",
     lambda: fetch_auctions("5-Year"),
     "TreasuryDirect", "https://www.treasurydirect.gov/auctions/auction-query/"),
    ("auc_btc_10y", "10-year auction bid-to-cover", "ratio", "per auction", "official",
     lambda: fetch_auctions("10-Year"),
     "TreasuryDirect", "https://www.treasurydirect.gov/auctions/auction-query/"),
    ("auc_btc_30y", "30-year auction bid-to-cover", "ratio", "per auction", "official",
     lambda: fetch_auctions("30-Year"),
     "TreasuryDirect", "https://www.treasurydirect.gov/auctions/auction-query/"),
    ("auc_ind_10y", "10-year auction indirect bidders", "% of accepted", "per auction", "official",
     lambda: fetch_auctions("10-Year", "indirect"),
     "TreasuryDirect", "https://www.treasurydirect.gov/auctions/auction-query/"),
    ("auc_ind_30y", "30-year auction indirect bidders", "% of accepted", "per auction", "official",
     lambda: fetch_auctions("30-Year", "indirect"),
     "TreasuryDirect", "https://www.treasurydirect.gov/auctions/auction-query/"),
    # --- Official reserves ---
    ("res_china", "China FX reserves (ex gold)", "$m", "monthly", "official",
     lambda: trim(fetch_fred("TRESEGCNM052N"), 15),
     "FRED · IMF", FRED_URL + "TRESEGCNM052N"),
    ("res_japan", "Japan FX reserves (ex gold)", "$m", "monthly", "official",
     lambda: trim(fetch_fred("TRESEGJPM052N"), 15),
     "FRED · IMF", FRED_URL + "TRESEGJPM052N"),
    ("res_uk", "UK FX reserves (ex gold)", "$m", "monthly", "official",
     lambda: trim(fetch_fred("TRESEGGBM052N"), 15),
     "FRED · IMF", FRED_URL + "TRESEGGBM052N"),
    ("res_euro", "Euro area total reserves", "$ (annual)", "annual", "official",
     lambda: fetch_worldbank("EMU", "FI.RES.TOTL.CD"),
     "World Bank", "https://data.worldbank.org/indicator/FI.RES.TOTL.CD?locations=XC"),
    ("res_cn_gold", "China: gold in reserves", "$bn (annual)", "annual", "official",
     lambda: wb_gold_component("chn"),
     "World Bank", "https://data.worldbank.org/indicator/FI.RES.TOTL.CD?locations=CN"),
    ("res_jp_gold", "Japan: gold in reserves", "$bn (annual)", "annual", "official",
     lambda: wb_gold_component("jpn"),
     "World Bank", "https://data.worldbank.org/indicator/FI.RES.TOTL.CD?locations=JP"),
    # --- Credit spreads (the cleaner credit signal; HYG/IEF is only a proxy) ---
    # Real yield and breakeven: the two legs the 10-year nominal splits into.
    # Gold trades off the real leg and commodities off the inflation leg, so
    # the cross-asset reads need them separated, not just the nominal yield.
    ("us_real_10y", "10-year real yield (TIPS)", "%", "daily", "us",
     lambda: trim(fetch_fred("DFII10"), 15),
     "FRED · Treasury", FRED_URL + "DFII10"),
    ("us_breakeven_10y", "10-year breakeven inflation", "%", "daily", "us",
     lambda: trim(fetch_fred("T10YIE"), 15),
     "FRED · Treasury", FRED_URL + "T10YIE"),
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
