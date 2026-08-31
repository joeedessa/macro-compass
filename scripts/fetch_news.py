#!/usr/bin/env python3
"""Market headlines from Bloomberg's public RSS feeds, written to docs/data/news.json.

Asked whether Bloomberg could be pulled in for context. It can: the feeds under
feeds.bloomberg.com are published openly, need no key and no account, and are
current to the minute. What they are not is a licence to the articles, so this
stores exactly what RSS is for — the headline, the time and the link — and
nothing else. No summaries, no extracts, no body text. Every headline is a link
back to Bloomberg and the reader goes there to read it.

Fetched here rather than in the browser for the usual two reasons. Bloomberg
sends no access-control-allow-origin, so a static page cannot call it directly
and would need a proxy in the path for something that changes every few
minutes; and a feed that fails should leave yesterday's headlines on the page
rather than an error, which is what committing the result gives for free.

The feeds are the ones that actually answer. Bloomberg publishes several and
they are not equally alive: markets and economics return twenty and twelve
items, wealth returns an empty channel, and the podcast and /markets/rss paths
answer 404 with a 300KB HTML page. Only the two that work are listed, and a
feed that stops working drops out rather than emptying the file.

Run: python3 scripts/fetch_news.py
"""

import json
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import quality  # noqa: E402 - needs the path above

DOCS = Path(__file__).resolve().parent.parent / "docs"
OUT = DOCS / "data" / "news.json"

# A browser user-agent. Bloomberg's edge answers the default urllib agent with
# its bot page; it serves the feed to anything that looks like a browser.
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}

# The markets desk only. The economics feed was in here too and it dragged the
# section away from what this page is for — trade-deal politics, labour supply,
# a flash flood — alongside the market copy. Bloomberg publishes several more
# that answer (technology, politics, industries all return twenty items) and
# none of them belong either. This is the feed behind Bloomberg's Markets page,
# which is what was asked for.
FEEDS = [
    ("Markets", "https://feeds.bloomberg.com/markets/news.rss"),
]

# One feed returns about twenty. Forty was sized for two feeds and left every
# run reporting coverage of roughly half, which is a warning that means "this is
# working" — exactly the kind that teaches you to ignore warnings.
MAX_ITEMS = 20


# Bloomberg's economics feed carries Bloomberg Linea alongside the English
# desk, so the same story arrives twice — "Productores del Mercosur temen
# competencia de Europa" immediately above "South American Producers Fret Over
# New Rivals From EU Trade Deal", same authors, same minute, different guid, so
# deduplicating by URL does not catch it. There is no per-item language tag to
# read: the channel declares one language and the items do not override it.
#
# Two function words is the test. One is not enough — "Banco de Espana" and
# "Bank of Mexico's de la Torre" are English headlines containing "de" — and
# the words below are common enough in Spanish and Portuguese that a real
# headline in either reaches two almost immediately. It is a heuristic and it
# is allowed to be, because the cost of both errors is small and symmetric: a
# missed translation shows a duplicate, and a false positive drops a headline
# whose English twin is in the same feed.
NON_EN = {"del", "de", "los", "las", "para", "por", "con", "una", "que",
          "sobre", "mas", "mais", "nao", "apos", "com", "dos", "das", "el",
          "un", "se", "su", "ao", "na", "no", "pela", "pelo"}


def looks_translated(title):
    words = re.findall(r"[a-zA-Zaaeiooun]+", title.lower())
    return sum(1 for w in words if w in NON_EN) >= 2


def clean(text):
    """RSS titles arrive with entities and the odd stray tag."""
    text = re.sub(r"<[^>]+>", "", text or "")
    return re.sub(r"\s+", " ", text).strip()


def when(item):
    """pubDate to an ISO instant, or None. Feeds are inconsistent about zones,
    so anything naive is treated as UTC rather than as local time — the machine
    that runs this is not in the same place as the reader."""
    raw = (item.findtext("pubDate") or "").strip()
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch(section, url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
            root = ET.fromstring(r.read())
    except (urllib.error.URLError, ET.ParseError, OSError) as e:
        print(f"  ! {section}: {type(e).__name__} {e}", file=sys.stderr)
        return []
    out = []
    for it in root.findall(".//item"):
        title, link = clean(it.findtext("title")), (it.findtext("link") or "").strip()
        if not title or not link or looks_translated(title):
            continue
        out.append({"t": title, "u": link, "at": when(it), "s": section})
    print(f"  {section}: {len(out)}")
    return out


def main():
    items = []
    for section, url in FEEDS:
        items.extend(fetch(section, url))

    # Same story can sit in more than one feed.
    seen, unique = set(), []
    for it in items:
        if it["u"] in seen:
            continue
        seen.add(it["u"])
        unique.append(it)

    # Newest first; undated last rather than sorted to the top by an empty
    # string, which would put an item of unknown age above a known-recent one.
    unique.sort(key=lambda x: x["at"] or "", reverse=True)
    unique = unique[:MAX_ITEMS]

    if not unique:
        sys.exit("aborting: no headlines fetched")

    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "Bloomberg public RSS feeds",
           "items": unique}

    # Coverage against what a healthy run returns, on the same rule the price
    # feeds use: a run that comes back nearly empty must not replace a full one.
    cov = len(unique) / MAX_ITEMS
    old_cov = lambda old: len(old.get("items") or []) / MAX_ITEMS
    if not quality.safe_to_write(OUT, cov, old_cov, "news.json"):
        sys.exit(1)

    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT}: {len(unique)} headlines")


if __name__ == "__main__":
    main()
