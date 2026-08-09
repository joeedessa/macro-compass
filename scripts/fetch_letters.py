#!/usr/bin/env python3
"""Fetch latest 13F top holdings for a set of well-known managers from SEC
EDGAR (official, free) and write docs/data/letters.json.

13F-HR filings are quarterly, due 45 days after quarter end, so this only
changes four times a year per manager. Run: python3 scripts/fetch_letters.py
"""

import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

OUT_PATH = Path(__file__).resolve().parent.parent / "docs" / "data" / "letters.json"

# SEC requires a descriptive User-Agent with contact information.
UA = {"User-Agent": "macro-compass dashboard joe.edessa@gmail.com"}

# cik, display name, expected-name fragment (sanity check against EDGAR),
# so a wrong CIK fails loudly instead of attributing holdings to the wrong firm.
MANAGERS = [
    (1067983, "Berkshire Hathaway (Buffett)", "BERKSHIRE"),
    (1350694, "Bridgewater Associates (Dalio)", "BRIDGEWATER"),
    (1336528, "Pershing Square (Ackman)", "PERSHING"),
    (1040273, "Third Point (Loeb)", "THIRD POINT"),
    (1656456, "Appaloosa (Tepper)", "APPALOOSA"),
    (1536411, "Duquesne Family Office (Druckenmiller)", "DUQUESNE"),
    (1029160, "Soros Fund Management", "SOROS"),
    (1079114, "Greenlight Capital (Einhorn)", "GREENLIGHT"),
    (1167483, "Tiger Global (Coleman)", "TIGER GLOBAL"),
    (1649339, "Scion Asset Management (Burry)", "SCION"),
]


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def latest_13fs(cik, n=2):
    """Latest n 13F filings (newest first). Amendments replace originals for
    the same period, so keep only the first filing seen per reportDate."""
    data = json.loads(get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json"))
    name = data.get("name", "")
    r = data["filings"]["recent"]
    out, seen = [], set()
    for form, date, acc, period in zip(
        r["form"], r["filingDate"], r["accessionNumber"], r["reportDate"]
    ):
        if form in ("13F-HR", "13F-HR/A") and period not in seen:
            seen.add(period)
            out.append((date, acc, period))
            if len(out) >= n:
                break
    if not out:
        raise RuntimeError("no 13F-HR found")
    return name, out


def holdings_from_filing(cik, accession):
    accn = accession.replace("-", "")
    base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accn}"
    idx = json.loads(get(f"{base}/index.json"))
    xml_files = [
        f["name"] for f in idx["directory"]["item"]
        if f["name"].lower().endswith(".xml") and "primary_doc" not in f["name"].lower()
    ]
    if not xml_files:
        raise RuntimeError("no information table xml in filing")
    raw = get(f"{base}/{xml_files[0]}").decode("utf-8", errors="replace")
    root = ET.fromstring(raw)

    # Filings vary: some use a default namespace, some a prefix (ns1:infoTable).
    # Match on local names so both parse.
    local = lambda el: el.tag.rsplit("}", 1)[-1]
    def childtext(el, want):
        for c in el.iter():
            if local(c) == want:
                return (c.text or "").strip()
        return ""

    by_issuer = {}          # name -> [value, shares]
    for it in root.iter():
        if local(it) != "infoTable":
            continue
        name = childtext(it, "nameOfIssuer")
        try:
            value = float(childtext(it, "value") or 0)
        except ValueError:
            continue
        try:
            shares = float(childtext(it, "sshPrnamt") or 0)
        except ValueError:
            shares = 0
        cur = by_issuer.setdefault(name, [0, 0])
        cur[0] += value
        cur[1] += shares
    if not by_issuer:
        raise RuntimeError("info table parsed empty")
    total = sum(v for v, _ in by_issuer.values())
    # Values are whole dollars since the 2023 rule change, but some filers
    # still report in thousands. A sub-$100m total for managers of this size
    # is the tell; scale value only (share counts are already real).
    if total < 1e8:
        by_issuer = {k: [v * 1000, s] for k, (v, s) in by_issuer.items()}
        total *= 1000
    return {"total_value": total, "by_issuer": by_issuer}


def main():
    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "managers": [],
    }
    failures = 0
    for cik, label, expect in MANAGERS:
        try:
            name, filings = latest_13fs(cik, 2)
            if expect not in name.upper():
                raise RuntimeError(f"CIK {cik} resolves to '{name}', expected '{expect}'")
            time.sleep(0.3)          # be polite to SEC
            cur = holdings_from_filing(cik, filings[0][1])
            prev = None
            if len(filings) > 1:
                time.sleep(0.3)
                try:
                    prev = holdings_from_filing(cik, filings[1][1])
                except Exception:  # noqa: BLE001 - QoQ is best-effort
                    prev = None
            total = cur["total_value"]
            top = sorted(cur["by_issuer"].items(), key=lambda kv: -kv[1][0])[:10]
            prev_map = prev["by_issuer"] if prev else {}
            top_out = []
            for n, (v, s) in top:
                rec = {"name": n.title(), "value": v,
                       "pct": round(v / total * 100, 1), "shares": s}
                if prev:
                    ps = prev_map.get(n, [0, 0])[1]
                    rec["shares_prev"] = ps
                    rec["shares_delta"] = s - ps
                    rec["new"] = ps == 0
                top_out.append(rec)
            # Positions that were top-10 by value last quarter and are gone now.
            exited = []
            if prev:
                prev_top = sorted(prev["by_issuer"].items(), key=lambda kv: -kv[1][0])[:10]
                exited = [n.title() for n, _ in prev_top if n not in cur["by_issuer"]]
            out["managers"].append({
                "label": label,
                "edgar_name": name,
                "cik": cik,
                "filed": filings[0][0],
                "period": filings[0][2],
                "prev_period": filings[1][2] if len(filings) > 1 else None,
                "url": f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik:010d}&type=13F-HR&dateb=&owner=include&count=10",
                "total_value": total,
                "positions": len(cur["by_issuer"]),
                "top": top_out,
                "exited": exited,
            })
            print(f"ok   {label}: {len(cur['by_issuer'])} positions, QoQ vs {filings[1][2] if len(filings)>1 else 'n/a'}")
        except Exception as e:  # noqa: BLE001 - one manager must not sink the file
            failures += 1
            print(f"FAIL {label}: {e}", file=sys.stderr)
        time.sleep(0.3)
    if not out["managers"]:
        sys.exit("aborting: every manager failed")
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size // 1024} KB), {failures} failures")


if __name__ == "__main__":
    main()
