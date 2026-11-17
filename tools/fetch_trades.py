import json,sys,time,urllib.request
from datetime import datetime
sym=sys.argv[1]; pages=int(sys.argv[2]); out=sys.argv[3]
base=f"https://api.exchange.coinbase.com/products/{sym}/trades?limit=1000"
ticks=[]; after=None
for i in range(pages):
    u=base+(f"&after={after}" if after else "")
    for attempt in range(4):
        try:
            resp=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'calibration'}),timeout=20); break
        except Exception as e:
            time.sleep(1.5)
    else: print('failed page',i); break
    data=json.load(resp); after=resp.headers.get('cb-after')
    for t in data:
        ts=datetime.strptime(t['time'][:26].rstrip('Z'),'%Y-%m-%dT%H:%M:%S.%f').timestamp() if '.' in t['time'] else datetime.strptime(t['time'].rstrip('Z'),'%Y-%m-%dT%H:%M:%S').timestamp()
        ticks.append([ts,float(t['price'])])
    if not after or not data: break
    time.sleep(float(sys.argv[4]) if len(sys.argv) > 4 else 0.15)
ticks.sort(key=lambda x:x[0])
json.dump(ticks,open(out,'w'))
span=(ticks[-1][0]-ticks[0][0])/3600
print(f"{sym}: {len(ticks)} trades, {span:.1f} hours, {datetime.utcfromtimestamp(ticks[0][0])} -> {datetime.utcfromtimestamp(ticks[-1][0])} UTC")
