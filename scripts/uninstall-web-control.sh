#!/bin/zsh
set -euo pipefail
label="pl.michalkozinski.pi-control"
plist="$HOME/Library/LaunchAgents/$label.plist"
launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
rm -f "$plist"
print "Removed the Pi Control LaunchAgent. Runtime data and versioned Pi extensions were kept."
