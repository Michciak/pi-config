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
python3 "$repo/scripts/restart-web-control.py"

print "Pi Control Service installed at http://127.0.0.1:3784"
print "Pi Engine remains stopped until you start it from the panel."
