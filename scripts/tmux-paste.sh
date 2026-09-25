#!/bin/zsh
# Read clipboard only when explicitly invoked; never expand it as shell code.
set -euo pipefail
socket="$1"
pane="$2"
buffer="pi-clipboard-$$"
trap 'tmux -S "$socket" delete-buffer -b "$buffer" 2>/dev/null || true' EXIT
/usr/bin/pbpaste | tmux -S "$socket" load-buffer -b "$buffer" -
tmux -S "$socket" if-shell -F -t "$pane" '#{pane_in_mode}' "send-keys -t $pane -X cancel"
tmux -S "$socket" paste-buffer -d -p -r -b "$buffer" -t "$pane"
