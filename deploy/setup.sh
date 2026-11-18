#!/usr/bin/env bash
# Installs the Tapline odds tuner on a Debian/Ubuntu VPS (systemd). Idempotent: safe to run again.
#   sudo bash deploy/setup.sh            env: REPO_URL=https://github.com/nachofigx/taptrade.git
# What it does: installs git/python3/node (>= 18), creates an unprivileged `tapline` user, clones the repo to /opt/tapline,
# creates an SSH deploy key for publishing, and enables a systemd timer that retunes the odds every 6 hours.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root:  sudo bash deploy/setup.sh"; exit 1; }
command -v apt-get >/dev/null || { echo "this installer supports Debian/Ubuntu (apt-get)"; exit 1; }
command -v systemctl >/dev/null || { echo "systemd not found"; exit 1; }
REPO=${REPO_URL:-https://github.com/nachofigx/taptrade.git}; APP=/opt/tapline; STATE=/var/lib/tapline; U=tapline
export DEBIAN_FRONTEND=noninteractive

echo "==> packages"
apt-get update -qq
apt-get install -y -qq git python3 curl ca-certificates openssh-client sudo
node_ok=0; if command -v node >/dev/null 2>&1; then [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] && node_ok=1; fi
if [ "$node_ok" = 0 ]; then
  echo "==> installing Node 20 (NodeSource)"; curl -fsSL https://deb.nodesource.com/setup_20.x | bash - ; apt-get install -y -qq nodejs
fi
echo "node $(node -v), python $(python3 -V 2>&1 | cut -d' ' -f2)"

echo "==> user and directories"
id "$U" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$STATE" --shell /usr/sbin/nologin "$U"
mkdir -p "$APP" "$STATE/.ssh" "$STATE/cache" "$STATE/tmp"; chmod 700 "$STATE/.ssh"
chown -R "$U:$U" "$APP" "$STATE"

echo "==> code"
if [ -d "$APP/.git" ]; then sudo -u "$U" git -C "$APP" pull --ff-only -q; else sudo -u "$U" git clone -q "$REPO" "$APP"; fi

echo "==> deploy key"
KEY="$STATE/.ssh/tapline_deploy"
[ -f "$KEY" ] || sudo -u "$U" ssh-keygen -q -t ed25519 -N '' -C "tapline-tuner@$(hostname)" -f "$KEY"

echo "==> systemd"
install -m 644 "$APP/deploy/tapline-tuner.service" /etc/systemd/system/tapline-tuner.service
install -m 644 "$APP/deploy/tapline-tuner.timer" /etc/systemd/system/tapline-tuner.timer
systemctl daemon-reload
systemctl enable --now tapline-tuner.timer

cat <<MSG

Done. Two steps are still yours:

1) Add this PUBLIC key to GitHub as a deploy key WITH write access
   (repo -> Settings -> Deploy keys -> Add deploy key -> tick "Allow write access"):

$(cat "$KEY.pub")

2) Start the first run (the first download takes a while; later runs only fetch what is new):
   sudo systemctl start --no-block tapline-tuner
   journalctl -fu tapline-tuner          # follow it (Ctrl+C to stop following)

Check later:  systemctl list-timers tapline-tuner.timer   |   cat $STATE/status.json
MSG
