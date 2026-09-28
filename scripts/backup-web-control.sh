#!/bin/zsh
set -euo pipefail
runtime="${PI_WEB_RUNTIME_DIR:-$HOME/.pi/agent/web-control}"
destination="${1:-$HOME/.pi/agent/backups/pi-web-control-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$destination"
if [[ -f "$runtime/state.sqlite" ]]; then
  /usr/bin/sqlite3 "$runtime/state.sqlite" ".backup '$destination/state.sqlite'"
fi
[[ -d "$runtime/sessions" ]] && cp -R "$runtime/sessions" "$destination/"
chmod -R go-rwx "$destination"
print "Backup created: $destination"
