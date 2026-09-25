#!/bin/zsh
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PI_AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
MODE="check"
if [[ "${1:-}" == "--apply" ]]; then MODE="apply"; elif [[ "${1:-}" != "" && "${1:-}" != "--check" ]]; then print -u2 "Usage: $0 [--check|--apply]"; exit 2; fi
compare() {
  local source="$1" target="$2"
  if [[ ! -e "$target" ]]; then print "MISSING $target"; return 1; fi
  if cmp -s "$source" "$target"; then print "OK      $target"; return 0; fi
  print "DIFF    $target"; return 1
}
rc=0
for source in "$REPO_DIR"/agents/*.md; do compare "$source" "$PI_AGENT_DIR/agents/$(basename "$source")" || rc=1; done
compare "$REPO_DIR/tmux/tmux.conf" "$HOME/.tmux.conf" || rc=1
compare "$REPO_DIR/extensions/cursor-subagents.ts" "$PI_AGENT_DIR/extensions/cursor-subagents.ts" || rc=1
compare "$REPO_DIR/extensions/model-router.ts" "$PI_AGENT_DIR/extensions/model-router.ts" || rc=1
for source in "$REPO_DIR"/skills/*; do
  target="$PI_AGENT_DIR/skills/$(basename "$source")"
  if [[ ! -d "$target" ]]; then print "MISSING $target"; rc=1
  elif diff -qr "$source" "$target" >/dev/null; then print "OK      $target"
  else print "DIFF    $target"; rc=1
  fi
done
if [[ "$MODE" == "apply" && "$rc" != 0 ]]; then
  stamp="$(date +%Y%m%d-%H%M%S)"; backup="$PI_AGENT_DIR/backups/pi-config-sync-$stamp"; mkdir -p "$backup/agents"
  for source in "$REPO_DIR"/agents/*.md; do target="$PI_AGENT_DIR/agents/$(basename "$source")"; [[ -e "$target" ]] && cp "$target" "$backup/agents/"; cp "$source" "$target"; done
  [[ -e "$HOME/.tmux.conf" ]] && cp "$HOME/.tmux.conf" "$backup/tmux.conf"
  cp "$REPO_DIR/tmux/tmux.conf" "$HOME/.tmux.conf"; chmod 600 "$HOME/.tmux.conf"
  mkdir -p "$PI_AGENT_DIR/extensions"
  [[ -e "$PI_AGENT_DIR/extensions/cursor-subagents.ts" ]] && cp "$PI_AGENT_DIR/extensions/cursor-subagents.ts" "$backup/cursor-subagents.ts"
  cp "$REPO_DIR/extensions/cursor-subagents.ts" "$PI_AGENT_DIR/extensions/cursor-subagents.ts"
  [[ -e "$PI_AGENT_DIR/extensions/model-router.ts" ]] && cp "$PI_AGENT_DIR/extensions/model-router.ts" "$backup/model-router.ts"
  cp "$REPO_DIR/extensions/model-router.ts" "$PI_AGENT_DIR/extensions/model-router.ts"
  mkdir -p "$backup/skills" "$PI_AGENT_DIR/skills"
  for source in "$REPO_DIR"/skills/*; do
    name=$(basename "$source"); target="$PI_AGENT_DIR/skills/$name"
    [[ -e "$target" ]] && cp -R "$target" "$backup/skills/"
    mkdir -p "$target"; cp -R "$source"/. "$target"/
  done
  print "Applied. Backup: $backup"
  exec "$REPO_DIR/scripts/sync-runtime.sh" --check
elif [[ "$MODE" == "apply" ]]; then print "Already synchronized; no files changed."; fi
exit "$rc"
