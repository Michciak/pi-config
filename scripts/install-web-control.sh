#!/bin/zsh
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build
python3 "$repo/scripts/install-web-control.py"

domain="gui/$(id -u)"
plist="$HOME/Library/LaunchAgents/pl.michalkozinski.pi-control.plist"
launchctl bootout "$domain/pl.michalkozinski.pi-control" >/dev/null 2>&1 || true
launchctl bootstrap "$domain" "$plist"
launchctl enable "$domain/pl.michalkozinski.pi-control"
launchctl kickstart -k "$domain/pl.michalkozinski.pi-control"

print "Pi Control Service installed at http://127.0.0.1:3784"
print "Pi Engine remains stopped until you start it from the panel."
