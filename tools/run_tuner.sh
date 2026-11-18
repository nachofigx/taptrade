#!/usr/bin/env bash
# Retunes the odds from the latest real trades and writes odds.json. Run it on a schedule (see deploy/).
#   tools/run_tuner.sh [hours=48] [out=odds.json]
#   env: ASSETS="sol eth btc"  EDGE=0.04  TURBO=1 (also learn tables for 2-second turbo columns; 0 to skip)  CACHE_DIR=/path (keeps downloaded trades between runs, so each run only fetches what is new)
# The new file is only written if the guard passes (see `tuner.mjs fit --holdout`); otherwise the previous odds.json stays (exit 2).
set -euo pipefail
cd "$(dirname "$0")/.."
HOURS=${1:-48}; OUT=${2:-odds.json}; ASSETS=${ASSETS:-"sol eth btc"}; EDGE=${EDGE:-0.04}
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
CACHE=${CACHE_DIR:-$TMP}; mkdir -p "$CACHE"
args=()
for a in $ASSETS; do
  python3 tools/fetch_trades.py "${a^^}-USD" 6000 "$CACHE/$a.json" 0.25 "$HOURS" | tail -1
  SYMBOL=$a CAL=0 MINP=0.002 STEP=8 SAMPLES="$TMP/s_$a.json" node tools/replay.mjs "$CACHE/$a.json" | tail -1
  args+=("$a=$TMP/s_$a.json")
  if [ "${TURBO:-1}" = 1 ]; then      # separate tables for the 2-second turbo columns (same trades, different column length)
    SLOT_S=2 LOCK_S=2 SYMBOL=$a CAL=0 MINP=0.002 STEP=8 SAMPLES="$TMP/s_${a}_t2.json" node tools/replay.mjs "$CACHE/$a.json" | tail -1
    args+=("$a@2=$TMP/s_${a}_t2.json")
  fi
done
PREV=${PREV_ODDS:-$OUT}; prev_arg=(); [ -f "$PREV" ] && prev_arg=(--prev "$PREV")   # assets refused by the guard keep their entry from the previous file
node tools/tuner.mjs fit --edge "$EDGE" --last "$HOURS" --holdout 0.25 "${prev_arg[@]}" --out "$TMP/odds.json" "${args[@]}"
mv "$TMP/odds.json" "$OUT"; echo "wrote $OUT"
