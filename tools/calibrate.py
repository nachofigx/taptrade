#!/usr/bin/env python3
"""Fit the probability recalibration from replay samples and report held-out return by payout bucket.
usage: calibrate.py EDGE name=train.json:test.json [name=...]   (samples come from tools/replay.mjs with SAMPLES=...)
Prints, per asset, the knots to paste into calibration.js and the realised return on the held-out samples."""
import json, math, sys
EDGE = float(sys.argv[1]); specs = [a.split('=') for a in sys.argv[2:]]
def logit(p): p = min(max(p, 1e-6), 1 - 1e-6); return math.log(p / (1 - p))
def sig(z): return 1 / (1 + math.exp(-z))
EDGES = [0.0101, 0.015, 0.02, 0.03, 0.045, 0.065, 0.09, 0.13, 0.18, 0.25, 0.35, 0.45, 0.55, 0.65, 0.8, 1.0001]
def fit(rows):
    ks = []
    for lo, hi in zip(EDGES, EDGES[1:]):
        g = [r for r in rows if lo <= r[0] < hi]
        if len(g) < 150: continue
        ks.append([sum(r[0] for r in g) / len(g), sum(r[1] for r in g) / len(g), len(g)])
    i = 0
    while i < len(ks) - 1:                                   # pool adjacent violators: realised p must not fall as model p rises
        if ks[i][1] > ks[i + 1][1]:
            a, b = ks[i], ks[i + 1]; n = a[2] + b[2]
            ks[i:i + 2] = [[(a[0] * a[2] + b[0] * b[2]) / n, (a[1] * a[2] + b[1] * b[2]) / n, n]]; i = max(i - 1, 0)
        else: i += 1
    return [(round(k[0], 4), round(k[1], 4)) for k in ks]
def cal(K, p):
    if p <= K[0][0]: return min(0.999, p * K[0][1] / K[0][0])
    if p >= K[-1][0]: return min(0.999, K[-1][1] + (p - K[-1][0]) * (1 - K[-1][1]) / (1 - K[-1][0] + 1e-9))
    for (p0, q0), (p1, q1) in zip(K, K[1:]):
        if p0 <= p <= p1:
            t = (logit(p) - logit(p0)) / (logit(p1) - logit(p0)); return sig(logit(q0) + t * (logit(q1) - logit(q0)))
def report(rows, f, edge):
    tot = 0; bk = {}
    for p, h, m, t, ah in rows:
        q = f(p); mm = min(100, math.floor((1 - edge) / q * 100) / 100); pay = mm if h else 0; tot += pay
        k = '<2x' if mm < 2 else '2-3.5x' if mm < 3.5 else '3.5-8x' if mm < 8 else '8-20x' if mm < 20 else '20x+'
        x = bk.setdefault(k, [0, 0]); x[0] += pay; x[1] += 1
    return tot / len(rows), {k: round(bk[k][0] / bk[k][1] * 100, 1) for k in ['<2x', '2-3.5x', '3.5-8x', '8-20x', '20x+'] if k in bk}
out = {}
for name, files in specs:
    tr, te = [json.load(open(f)) for f in files.split(':')]
    K = fit(tr); out[name] = K
    r0, b0 = report(te, lambda p: p, EDGE); r1, b1 = report(te, lambda p: cal(K, p), EDGE)
    print(f'{name}: held-out n={len(te)}  target {(1-EDGE)*100:.0f}%   uncalibrated {r0*100:.1f}% {b0}   calibrated {r1*100:.1f}% {b1}')
print('KNOTS =', json.dumps(out))
