#!/usr/bin/env python3
"""Download recent trades from Coinbase Exchange (public API, no key).

usage: fetch_trades.py PRODUCT MAX_PAGES OUT.json [SLEEP_SECONDS=0.15] [HOURS]
  ~1000 trades per page, newest first. Stops at MAX_PAGES or once HOURS of history are covered, whichever comes first.
  Output: {"t": [epoch seconds ascending], "p": [prices]}  (flat arrays keep memory low; see tools/load_trades.mjs)
  Incremental: if OUT.json already exists, only the trades newer than its last one are downloaded and appended,
  and anything older than HOURS is dropped. So a scheduled run downloads hours-since-last-run, not the whole window.
"""
import json, sys, time, urllib.request, urllib.error
from array import array
from datetime import datetime, timezone

product, max_pages, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
pause = float(sys.argv[4]) if len(sys.argv) > 4 else 0.15
hours = float(sys.argv[5]) if len(sys.argv) > 5 else None
base = f"https://api.exchange.coinbase.com/products/{product}/trades?limit=1000"


def epoch(iso):  # always UTC, independent of the machine's time zone
    iso = iso.rstrip("Z")
    fmt = "%Y-%m-%dT%H:%M:%S.%f" if "." in iso else "%Y-%m-%dT%H:%M:%S"
    return datetime.strptime(iso[:26], fmt).replace(tzinfo=timezone.utc).timestamp()


import os
ts, ps, after, newest = array("d"), array("d"), None, None
old_t, old_p = array("d"), array("d")
if os.path.exists(out) and hours:                      # incremental update of a previous download
    try:
        prev = json.load(open(out)); old_t.extend(prev["t"]); old_p.extend(prev["p"]); del prev
    except Exception:
        old_t, old_p = array("d"), array("d")
last_known = old_t[-1] if len(old_t) else None
for page in range(max_pages):
    url = base + (f"&after={after}" if after else "")
    for attempt in range(6):
        try:
            resp = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "tapline-tuner"}), timeout=20)
            break
        except urllib.error.HTTPError as e:
            time.sleep(3 * (attempt + 1) if e.code == 429 else 1.5)   # rate limited: back off
        except Exception:
            time.sleep(1.5)
    else:
        print("failed at page", page, file=sys.stderr)
        break
    data = json.load(resp)
    after = resp.headers.get("cb-after")
    for t in data:
        ts.append(epoch(t["time"]))
        ps.append(float(t["price"]))
    if newest is None and len(ts):
        newest = ts[0]
    if not data or not after or (hours and newest and ts[-1] < newest - hours * 3600) or (last_known is not None and ts[-1] <= last_known):
        break
    time.sleep(pause)

if not len(ts) and not len(old_t):
    sys.exit("no trades downloaded")
# the API returns newest first: reverse in place (no sort, no extra copies), keep only what is newer than the cache, then merge
ts.reverse(); ps.reverse()
if last_known is not None:
    keep = next((i for i, x in enumerate(ts) if x > last_known), len(ts))
    ts, ps = ts[keep:], ps[keep:]
    old_t.extend(ts); old_p.extend(ps); ts, ps = old_t, old_p
if hours and len(ts):
    cut = next((i for i, x in enumerate(ts) if x >= ts[-1] - hours * 3600), 0)
    ts, ps = ts[cut:], ps[cut:]
tmp = out + ".tmp"
with open(tmp, "w") as fh:                               # written in chunks so memory stays flat
    fh.write('{"t":[')
    for i in range(0, len(ts), 100000):
        fh.write(("," if i else "") + ",".join(repr(x) for x in ts[i:i + 100000]))
    fh.write('],"p":[')
    for i in range(0, len(ps), 100000):
        fh.write(("," if i else "") + ",".join(repr(x) for x in ps[i:i + 100000]))
    fh.write("]}")
os.replace(tmp, out)
span = (ts[-1] - ts[0]) / 3600
print(f"{product}: {len(ts)} trades, {span:.1f} h, {datetime.fromtimestamp(ts[0], timezone.utc):%Y-%m-%d %H:%M} -> {datetime.fromtimestamp(ts[-1], timezone.utc):%Y-%m-%d %H:%M} UTC")
