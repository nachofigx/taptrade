#!/usr/bin/env bash
# Retunes the odds from the latest real trades and writes odds.json. Run it on a schedule (cron, CI job, a small server).
#   tools/run_tuner.sh [hours=24] [out=odds.json]        env: ASSETS="sol eth btc" EDGE=0.04
# The new file is only published if the guard passes (see `tuner.mjs fit --holdout`); otherwise the previous odds.json stays.
set -euo pipefail
cd "$(dirname "$0")/.."
HOURS=${1:-24}; OUT=${2:-odds.json}; ASSETS=${ASSETS:-"sol eth btc"}; EDGE=${EDGE:-0.04}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
args=()
for a in $ASSETS; do
  case $a in sol) per_h=9;; eth) per_h=11;; btc) per_h=80;; *) per_h=40;; esac          # ~1000 trades per page
  pages=$(( HOURS * per_h + 4 ))
  python3 tools/fetch_trades.py "${a^^}-USD" "$pages" "$TMP/$a.json" 0.25 | tail -1
  SYMBOL=$a CAL=0 MINP=0.002 STEP=8 SAMPLES="$TMP/s_$a.json" node tools/replay.mjs "$TMP/$a.json" | tail -1
  args+=("$a=$TMP/s_$a.json")
done
node tools/tuner.mjs fit --edge "$EDGE" --last "$HOURS" --holdout 0.25 --out "$TMP/odds.json" "${args[@]}"
mv "$TMP/odds.json" "$OUT"; echo "published $OUT"
