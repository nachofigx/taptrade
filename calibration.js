// Probability calibration. The Monte Carlo model assumes a smooth random walk; real trades are stickier near the price and wilder far
// from it, so its raw probabilities were too high for the cells most players tap (measured: ~15-25% too high between 6% and 70%)
// and too low for far cells. These tables map the model probability to the frequency observed in real trades, per asset.
// Regenerate with tools/ (fetch_trades.py -> replay.mjs -> calibrate.py). See ODDS.md.

// [model probability, observed probability] knots, increasing in both.
export const KNOTS = {
  sol: [[0.00267,0.00955],[0.00476,0.01668],[0.0079,0.01828],[0.01136,0.02169],[0.01382,0.02344],[0.01717,0.02751],[0.02452,0.02999],[0.03699,0.04245],[0.05446,0.05633],[0.07742,0.06921],[0.10909,0.09235],[0.15428,0.12671],[0.21474,0.1784],[0.30006,0.25005],[0.3916,0.32753],[0.49266,0.42892],[0.59233,0.53689],[0.7102,0.65089],[0.85039,0.79939]],
  eth: [[0.00268,0.01213],[0.00477,0.01739],[0.00788,0.0188],[0.01135,0.02056],[0.0138,0.02411],[0.01719,0.03039],[0.02455,0.03672],[0.03703,0.04351],[0.05435,0.05861],[0.07734,0.07336],[0.10913,0.09064],[0.15456,0.1294],[0.21398,0.17895],[0.3004,0.2508],[0.39248,0.33081],[0.49114,0.43091],[0.59299,0.52884],[0.70914,0.62808],[0.84429,0.82192]],
  btc: [[0.00345,0.0209],[0.00789,0.02544],[0.01141,0.03271],[0.01577,0.03901],[0.02455,0.04682],[0.03707,0.04785],[0.05442,0.06676],[0.07746,0.08158],[0.10897,0.09917],[0.15466,0.12981],[0.21414,0.16553],[0.30174,0.21403],[0.39119,0.2765],[0.49276,0.35149],[0.59356,0.43258],[0.70577,0.57941]],
};

const logit = (p) => { const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6); return Math.log(q / (1 - q)); };
const sig = (z) => 1 / (1 + Math.exp(-z));

// Interpolates linearly in logit space between knots; below the first knot keeps the ratio, above the last blends toward 1.
export function calibrate(p, knots) {
  if (!knots || !knots.length) return p;
  const first = knots[0], last = knots[knots.length - 1];
  if (p <= first[0]) return Math.min(0.999, (p * first[1]) / first[0]);
  if (p >= last[0]) return Math.min(0.999, last[1] + ((p - last[0]) * (1 - last[1])) / (1 - last[0] + 1e-9));
  for (let i = 1; i < knots.length; i++) {
    const [p0, q0] = knots[i - 1], [p1, q1] = knots[i];
    if (p <= p1) { const t = (logit(p) - logit(p0)) / (logit(p1) - logit(p0)); return sig(logit(q0) + t * (logit(q1) - logit(q0))); }
  }
  return p;
}
export const knotsFor = (symbol) => KNOTS[String(symbol || '').split('-')[0].toLowerCase()] || null;
