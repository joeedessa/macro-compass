"""Refuse to publish a data file that is materially worse than the one it
would replace.

Written after a single CI run at 2026-08-21T13:11Z silently wiped the
fundamentals out of two feeds at once. TradingView's scanner returned a
well-formed response for all 403 portfolio positions and all 75 watchlist
names — correct symbols, correct currencies, correct prices — with almost
every fundamental column null. Sector fell from 400 rows to 6, earnings dates
from 361 to 16, dividends from 389 to 4. The scripts wrote it out, CI
committed it, and the Today page's calendar went blank.

Nothing crashed, which is the whole problem. Both scripts already guarded
against an empty response, and the workflow already wrapped them in `|| true`
with a comment promising to "keep last good file on a bad run" — but a
response can be complete in shape and empty in substance, and that shape
passed every check. Eleven consecutive runs before it produced identical full
coverage, so this is a throttle or a partial outage upstream, not a change in
what is available: retrying usually works, and when it does not, yesterday's
fundamentals beat today's blanks.

Two layers, in order:

  retry_until_dense  the scan is repeated while the response looks thin, which
                     fixes the common case at source rather than papering over
                     it downstream.
  safe_to_write      a last check before the file lands. If coverage has
                     collapsed against what is already on disk, the write is
                     refused and the script exits non-zero, which is what the
                     workflow's `|| true` was always meant to catch.

Deliberately not a hard floor. A floor has to be picked, and any number picked
today is wrong the moment the watchlist takes on more instruments that simply
have no analyst coverage. Comparing against the previous file asks the only
question that matters — did this run get worse — and stays correct as the
universe changes.
"""

import json
import time


def coverage(rows, fields):
    """Fraction of rows carrying at least one of `fields`.

    Presence, not correctness: this is a smoke alarm, not an auditor. A run
    that returns the wrong earnings date is a different problem and this will
    not catch it.
    """
    rows = list(rows)
    if not rows:
        return 0.0
    filled = sum(
        1 for r in rows
        if any(r.get(f) not in (None, "", [], {}) for f in fields)
    )
    return filled / len(rows)


def retry_until_dense(fetch, fields, label, tries=3, floor=0.5, pause=20):
    """Call `fetch()` until its rows look populated, then return them.

    `floor` is relative to nothing but itself — half the rows carrying at
    least one of the named fields is a low bar that a healthy response clears
    comfortably (the feeds that prompted this sit at 90-99%) and a throttled
    one misses badly (the bad run sat at 1-4%). It exists to decide whether to
    retry, not to decide whether to publish; that judgement belongs to
    safe_to_write, which compares against real history instead of a guess.

    The last attempt is returned whatever its coverage — the caller still has
    the disk guard behind it, and returning nothing would turn a thin run into
    a crash for no gain.
    """
    rows = []
    for attempt in range(1, tries + 1):
        rows = fetch()
        cov = coverage([dict(r) for r in rows] if rows and isinstance(rows[0], dict)
                       else rows, fields)
        if cov >= floor or attempt == tries:
            if attempt > 1:
                print(f"{label}: coverage {cov:.0%} after {attempt} attempt(s)")
            return rows
        print(f"{label}: coverage {cov:.0%} looks thin, retrying in {pause}s "
              f"(attempt {attempt} of {tries})")
        time.sleep(pause)
    return rows


def safe_to_write(path, new_cov, old_cov_of, label, ratio=0.6):
    """True if `new_cov` is not a collapse against the file already at `path`.

    `old_cov_of` is handed the parsed existing file and returns its coverage
    on the same measure, so each caller keeps its own payload shape.

    A missing or unreadable file is not a reason to withhold data — first runs
    and recoveries from a corrupt file both have to be able to write.
    """
    if not path.exists():
        return True
    try:
        old = json.loads(path.read_text())
    except Exception:                       # noqa: BLE001 - unreadable is not authoritative
        return True
    try:
        old_cov = old_cov_of(old)
    except Exception:                       # noqa: BLE001 - nor is unparseable
        return True
    if old_cov and new_cov < old_cov * ratio:
        print(f"REFUSING to overwrite {label}: this run covers {new_cov:.0%} "
              f"against {old_cov:.0%} already on disk. Keeping the older file — "
              f"stale fundamentals beat blank ones.")
        return False
    if old_cov and new_cov < old_cov * 0.95:
        print(f"{label}: coverage slipped {old_cov:.0%} -> {new_cov:.0%}, "
              f"writing anyway (within tolerance)")
    return True
