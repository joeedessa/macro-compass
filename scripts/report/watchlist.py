"""Parse the weekly Tech Charts report (Part II) and compare it with
docs/data/watchlist.json. Reads the text pdftext.swift produces; prints
the differences, changes nothing.

    swift scripts/report/pdftext.swift "GLOBAL EQUITY MARKETS - ... Part II.pdf" > /tmp/r.txt
    python3 scripts/report/watchlist.py /tmp/r.txt [/tmp/last-week.txt]

The report itself is licensed and never enters the repo; only this parser does.
"""
import json, re, sys
from pathlib import Path

N = r"([\d,]+(?:\.\d+)?)"
num = lambda x: float(x.replace(",", "").rstrip("."))
HDR = re.compile(r"^([A-Z0-9][^a-z]*?)\s*\(([A-Z0-9][A-Z0-9._\-]*)\)\s*(–\s*new addition to watchlist)?\s*$")
REGIONS = {"AMERICAS", "EUROPE", "ASIA", "MIDDLE EAST & AFRICA"}


def entries(text, start, stop=None):
    """Each 'NAME (TICKER)' block between the two markers, with its levels."""
    body = text[text.index(start):]
    if stop and stop in body:
        body = body[:body.index(stop)]
    body = re.sub(r"=====PAGE \d+\n", "", body)
    out, cur, region = [], None, None
    for line in body.split("\n"):
        s = line.strip()
        if s in REGIONS:
            region = s
            continue
        m = HDR.match(s)
        if m:
            cur = {"name": m.group(1).strip(), "ticker": m.group(2), "new": bool(m.group(3)),
                   "region": region, "text": ""}
            out.append(cur)
        elif cur:
            cur["text"] += " " + s
    for e in out:
        t = re.sub(r"\s+", " ", e["text"])
        e["text"] = t
        m = re.search(r"(\d+)\s*month-?\s?long ([^.]*?)(?: with| chart pattern|\.)", t)
        e["dur"] = int(m.group(1)) if m else None
        e["pattern"] = m.group(2).strip() if m else None
        rb = re.search(r"resistance at " + N, t)
        sb = re.search(r"support at " + N, t)
        lc = re.search(r"daily close above " + N + r"[^.]*?target of " + N, t)
        sc = re.search(r"daily close below " + N + r"[^.]*?target of " + N, t)
        e["long"] = {"boundary": num(rb.group(1)) if rb else None,
                     "trigger": num(lc.group(1)), "target": num(lc.group(2))} if lc else None
        e["short"] = {"boundary": num(sb.group(1)) if sb else None,
                      "trigger": num(sc.group(1)), "target": num(sc.group(2))} if sc else None
    return out


def key(sym):
    """Our Yahoo symbol without its exchange suffix: GIB-A.TO -> GIBA."""
    base = sym.rsplit(".", 1)[0] if re.search(r"\.[A-Z]{1,3}$", sym) else sym
    return _norm(base)


def tkey(ticker):
    """The report's ticker: GIB.A -> GIBA, ROKO_B -> ROKOB, 135 -> 135 (Yahoo: 0135.HK)."""
    return _norm(ticker)


def _norm(s):
    s = re.sub(r"[^A-Z0-9]", "", s.upper())
    return s.lstrip("0") or s if s.isdigit() else s


def main(path, prev_path=None):
    text = Path(path).read_text()
    alerts = entries(text, "TECH CHARTS ALERT", "TECH CHARTS WATCHLIST") if "TECH CHARTS ALERT" in text else []
    wl = entries(text, "TECH CHARTS WATCHLIST")
    rows = json.loads(Path(__file__).resolve().parents[2].joinpath("docs/data/watchlist.json").read_text())
    live = [r for r in rows if not r.get("removed")]
    print(f"{len(alerts)} breakout signal(s), {len(wl)} watchlist entries, "
          f"{sum(e['new'] for e in wl)} marked new\n")
    for e in alerts:
        side = "long" if e["long"] else "short"
        print(f"BREAKOUT {e['ticker']:12} {side:5} {e[side]}  |  {e['name']}")
    seen = set()
    for e in wl:
        for side in ("long", "short"):
            L = e[side]
            if not L:
                continue
            r = next((r for r in live if r["dir"] == side and key(r["sym"]) == tkey(e["ticker"])), None)
            if not r:
                print(f"ADD      {e['ticker']:12} {side:5} {L} | {e['pattern']} {e['dur']}m | "
                      f"{e['region']} | {e['name']}")
                continue
            seen.add((r["sym"], side))
            d = [f"{k} {r.get(ok)}→{L[k]}" for k, ok in
                 (("trigger", "breakthrough"), ("target", "target"), ("boundary", "boundary"))
                 if L[k] is not None and r.get(ok) != L[k]]
            if r.get("duration_m") != e["dur"]:
                d.append(f"dur {r.get('duration_m')}→{e['dur']}")
            if d:
                print(f"CHANGE   {r['sym']:12} {side:5} " + "; ".join(d))
    # Gone: on last week's watchlist, not on this one, and not this week's breakout.
    if prev_path:
        now = {(tkey(e["ticker"]), s) for e in wl + alerts for s in ("long", "short") if e[s]}
        for e in entries(Path(prev_path).read_text(), "TECH CHARTS WATCHLIST"):
            for side in ("long", "short"):
                done = any(r.get("removed") and r["dir"] == side and key(r["sym"]) == tkey(e["ticker"])
                           for r in rows)
                if e[side] and (tkey(e["ticker"]), side) not in now and not done:
                    print(f"GONE     {e['ticker']:12} {side:5} trigger {e[side]['trigger']} | {e['name']}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
