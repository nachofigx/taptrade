#!/usr/bin/env bash
# One tuner cycle on the VPS: retune, then publish odds.json (and a small status.json) to the `odds-data` branch of the GitHub repo.
# The game reads https://raw.githubusercontent.com/<owner>/<repo>/odds-data/odds.json (see config.js).
# Runs as the `tapline` user from the systemd timer; safe to run by hand: sudo -u tapline /opt/tapline/deploy/publish.sh
set -uo pipefail
APP=${APP_DIR:-/opt/tapline}; STATE=${STATE_DIR:-/var/lib/tapline}; HOURS=${HOURS:-48}; ASSETS=${ASSETS:-"sol eth btc"}
REMOTE=${ODDS_REMOTE:-git@github.com:nachofigx/taptrade.git}; BRANCH=${ODDS_BRANCH:-odds-data}
KEY=${DEPLOY_KEY:-$STATE/.ssh/tapline_deploy}
export TMPDIR="$STATE/tmp"; mkdir -p "$TMPDIR" "$STATE/cache"
[ -f "$KEY" ] && export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
status() { printf '{"time":"%s","result":"%s","message":"%s","hours":%s}\n' "$(now)" "$1" "$2" "$HOURS" > "$STATE/status.json"; }

# keep the tuner code current (fast-forward only: never rewrites local history)
[ "${UPDATE_CODE:-1}" = 1 ] && git -C "$APP" pull --ff-only -q 2>&1 | tail -2

cd "$APP"
CACHE_DIR="$STATE/cache" ASSETS="$ASSETS" tools/run_tuner.sh "$HOURS" "$STATE/odds.new.json" > "$STATE/last_run.log" 2>&1
rc=$?
if [ "$rc" != 0 ]; then
  tail -5 "$STATE/last_run.log"
  if [ "$rc" = 2 ]; then status refused "guard refused the new odds; previous odds stay published"; echo "REFUSED by the guard (exit 2); keeping previous odds"; exit 0; fi
  status failed "tuner failed (exit $rc), see journalctl -u tapline-tuner"; echo "FAILED (exit $rc)"; exit 1
fi
tail -6 "$STATE/last_run.log"
status published "odds updated"

R="$STATE/odds-repo"
[ -d "$R/.git" ] || { git init -q "$R" && git -C "$R" remote add origin "$REMOTE"; }
cd "$R"
git remote set-url origin "$REMOTE"
if git fetch -q origin "$BRANCH" 2>/dev/null; then git checkout -q -B "$BRANCH" FETCH_HEAD; else git checkout -q --orphan "$BRANCH" 2>/dev/null || git checkout -q "$BRANCH"; fi
cp "$STATE/odds.new.json" odds.json; cp "$STATE/status.json" status.json
git add odds.json status.json
if git diff --cached --quiet; then echo "nothing changed"; exit 0; fi
git -c user.name=tapline-tuner -c user.email=tuner@localhost commit -q -m "retune odds $(now)"
if out=$(git push -q origin "$BRANCH" 2>&1); then echo "published to $REMOTE ($BRANCH)"; else echo "$out" | tail -3; status failed "push to GitHub failed (deploy key?)"; echo "PUSH FAILED"; exit 1; fi
