#!/usr/bin/env bash
# Post-install health check for the Tapline tuner. Prints OK / FAIL / WARN per item and a short fix hint. Safe to run any time (read-only).
#   sudo bash /opt/tapline/deploy/check.sh
APP=${APP_DIR:-/opt/tapline}; STATE=${STATE_DIR:-/var/lib/tapline}; REPO_RAW=${ODDS_URL:-https://raw.githubusercontent.com/nachofigx/taptrade/odds-data/odds.json}
ok() { printf '  OK    %s\n' "$1"; }; bad() { printf '  FAIL  %s\n        -> %s\n' "$1" "$2"; FAILS=$((FAILS+1)); }; warn() { printf '  WARN  %s\n' "$1"; }
FAILS=0
echo "System"
. /etc/os-release 2>/dev/null; echo "  $PRETTY_NAME, $(nproc) CPU, $(free -m | awk '/Mem:/{print $2}') MB RAM, $(df -m --output=avail "$STATE" 2>/dev/null | tail -1 | tr -d ' ') MB free in $STATE"
node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$node_major" -ge 18 ] && ok "Node $(node -v)" || bad "Node >= 18 not found" "re-run deploy/setup.sh"
command -v python3 >/dev/null && ok "$(python3 -V)" || bad "python3 missing" "apt-get install python3"
command -v git >/dev/null && ok "git $(git --version | cut -d' ' -f3)" || bad "git missing" "apt-get install git"
echo "Installation"
id tapline >/dev/null 2>&1 && ok "user tapline" || bad "user tapline missing" "re-run deploy/setup.sh"
[ -d "$APP/.git" ] && ok "code at $APP ($(git -C "$APP" log --oneline -1 2>/dev/null | cut -c1-60))" || bad "code not found in $APP" "re-run deploy/setup.sh"
[ -f "$STATE/.ssh/tapline_deploy" ] && ok "deploy key exists" || bad "deploy key missing" "re-run deploy/setup.sh"
if command -v systemctl >/dev/null; then
  systemctl is-enabled tapline-tuner.timer >/dev/null 2>&1 && ok "timer enabled ($(systemctl list-timers tapline-tuner.timer --no-legend 2>/dev/null | awk '{print "next: "$1" "$2" "$3}'))" || bad "timer not enabled" "systemctl enable --now tapline-tuner.timer"
  case "$(systemctl is-active tapline-tuner.service 2>/dev/null)" in activating) ok "a tuning run is in progress right now (journalctl -fu tapline-tuner)";; esac
fi
echo "Network"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "https://api.exchange.coinbase.com/products/ETH-USD/ticker"); [ "$code" = 200 ] && ok "Coinbase API reachable" || bad "Coinbase API returned HTTP $code" "check outbound firewall / DNS (ufw status)"
if [ -f "$STATE/.ssh/tapline_deploy" ]; then
  out=$(sudo -u tapline ssh -i "$STATE/.ssh/tapline_deploy" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o BatchMode=yes -o ConnectTimeout=15 -T git@github.com 2>&1 | head -2)
  case "$out" in *"successfully authenticated"*) ok "GitHub accepts the deploy key (read). Write access is only proven by the first publish.";; *) bad "GitHub did not accept the deploy key: $(echo "$out" | head -1)" "add the public key in repo Settings -> Deploy keys (Allow write access): cat $STATE/.ssh/tapline_deploy.pub";; esac
fi
echo "Last run"
if [ -f "$STATE/status.json" ]; then
  s=$(cat "$STATE/status.json"); echo "  $s"
  case "$s" in *'"published"'*) ok "last run published odds";; *'"refused"'*) warn "last run was refused by the guard (previous odds stay; normal now and then)";; *) bad "last run failed" "journalctl -u tapline-tuner -n 60 --no-pager";; esac
else warn "no run yet: sudo systemctl start --no-block tapline-tuner"; fi
echo "Published odds (what the game reads)"
j=$(curl -s -m 15 "$REPO_RAW?c=$(date +%s)")
if [ -n "$j" ]; then
  echo "$j" | python3 -c '
import sys, json, datetime
try:
    o = json.load(sys.stdin)
    t = datetime.datetime.fromisoformat(o["data_until"].replace("Z", "+00:00"))
    age = (datetime.datetime.now(datetime.timezone.utc) - t).total_seconds() / 3600
    print("  tables: " + ", ".join(o["assets"]))
    print("  data until %s (%.1f h ago)" % (o["data_until"], age))
    sys.exit(0 if age <= 36 else 3)
except Exception as e:
    print("  could not read the file:", e)
    sys.exit(4)'
  rc=$?
  if [ "$rc" = 0 ]; then ok "odds are fresh (< 36 h)"
  elif [ "$rc" = 3 ]; then warn "odds are older than 36 h: the game shows a warning"
  else bad "published odds.json unreadable" "wait ~5 min after the first publish (GitHub cache) or check the odds-data branch"; fi
else warn "odds-data/odds.json not reachable yet (first run pending?)"; fi
echo; [ "$FAILS" = 0 ] && echo "Result: no blocking problems." || { echo "Result: $FAILS problem(s) above."; exit 1; }
