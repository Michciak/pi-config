#!/bin/zsh
set -u
runtime="${PI_WEB_RUNTIME_DIR:-$HOME/.pi/agent/web-control}"
workspace="${PI_WEB_WORKSPACE_ROOT:-$HOME/Library/CloudStorage/Dropbox/NETRIX}"
check() { if "$@" >/dev/null 2>&1; then print "OK      $*"; else print "MISSING $*"; fi }
check command -v node
check command -v npm
check command -v java
check command -v adb
check test -d "$workspace"
check test -f "$HOME/Library/LaunchAgents/pl.michalkozinski.pi-control.plist"
check launchctl print "gui/$(id -u)/pl.michalkozinski.pi-control"
check /usr/bin/security find-generic-password -s pi-web.firebase-admin
check test -f "$runtime/state.sqlite"
if /usr/sbin/lsof -nP -iTCP:3784 -sTCP:LISTEN >/dev/null 2>&1; then print "OK      Control Service listens on 3784"; else print "MISSING Control Service on 3784"; fi
if [[ -f "$runtime/control.stderr.log" ]]; then
  print "\nLast Control Service errors:"
  tail -n 20 "$runtime/control.stderr.log"
fi
