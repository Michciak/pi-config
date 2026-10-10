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
compare "$REPO_DIR/extensions/cursor-subagents.ts" "$PI_AGENT_DIR/extensions/cursor-subagents.ts" || rc=1
compare "$REPO_DIR/extensions/model-router.ts" "$PI_AGENT_DIR/extensions/model-router.ts" || rc=1
compare "$REPO_DIR/extensions/remote-metrics.ts" "$PI_AGENT_DIR/extensions/remote-metrics.ts" || rc=1
compare "$REPO_DIR/extensions/web-search/index.ts" "$PI_AGENT_DIR/extensions/web-search/index.ts" || rc=1
compare "$REPO_DIR/extensions/web-search/parsers.ts" "$PI_AGENT_DIR/extensions/web-search/parsers.ts" || rc=1
compare "$REPO_DIR/extensions/file-links.ts" "$PI_AGENT_DIR/extensions/file-links.ts" || rc=1
compare "$REPO_DIR/extensions/ask-user-question.ts" "$PI_AGENT_DIR/extensions/ask-user-question.ts" || rc=1
compare "$REPO_DIR/extensions/shared/ask-user-question-contract.ts" "$PI_AGENT_DIR/extensions/shared/ask-user-question-contract.ts" || rc=1
if [[ -e "$PI_AGENT_DIR/extensions/ask-user-question-contract.ts" ]]; then print "STALE   $PI_AGENT_DIR/extensions/ask-user-question-contract.ts"; rc=1; fi
compare "$REPO_DIR/extensions/bash-guard/index.ts" "$PI_AGENT_DIR/extensions/bash-guard/index.ts" || rc=1
for relative in index.ts session.ts status.ts routing.ts rpc-backend.ts; do
  compare "$REPO_DIR/extensions/interactive-subagents/$relative" "$PI_AGENT_DIR/extensions/interactive-subagents/$relative" || rc=1
done
for source in "$REPO_DIR"/skills/*; do
  target="$PI_AGENT_DIR/skills/$(basename "$source")"
  if [[ ! -d "$target" ]]; then print "MISSING $target"; rc=1
  elif diff -qr "$source" "$target" >/dev/null; then print "OK      $target"
  else print "DIFF    $target"; rc=1
  fi
done
if [[ "$MODE" == "apply" && "$rc" != 0 ]]; then
  stamp="$(date +%Y%m%d-%H%M%S)"; backup="$PI_AGENT_DIR/backups/pi-config-sync-$stamp"; mkdir -p "$backup/agents" "$PI_AGENT_DIR/agents"
  for source in "$REPO_DIR"/agents/*.md; do target="$PI_AGENT_DIR/agents/$(basename "$source")"; [[ -e "$target" ]] && cp "$target" "$backup/agents/"; cp "$source" "$target"; done
  mkdir -p "$PI_AGENT_DIR/extensions"
  [[ -e "$PI_AGENT_DIR/extensions/cursor-subagents.ts" ]] && cp "$PI_AGENT_DIR/extensions/cursor-subagents.ts" "$backup/cursor-subagents.ts"
  cp "$REPO_DIR/extensions/cursor-subagents.ts" "$PI_AGENT_DIR/extensions/cursor-subagents.ts"
  [[ -e "$PI_AGENT_DIR/extensions/model-router.ts" ]] && cp "$PI_AGENT_DIR/extensions/model-router.ts" "$backup/model-router.ts"
  cp "$REPO_DIR/extensions/model-router.ts" "$PI_AGENT_DIR/extensions/model-router.ts"
  [[ -e "$PI_AGENT_DIR/extensions/remote-metrics.ts" ]] && cp "$PI_AGENT_DIR/extensions/remote-metrics.ts" "$backup/remote-metrics.ts"
  cp "$REPO_DIR/extensions/remote-metrics.ts" "$PI_AGENT_DIR/extensions/remote-metrics.ts"
  mkdir -p "$backup/web-search" "$PI_AGENT_DIR/extensions/web-search"
  for relative in index.ts parsers.ts; do
    target="$PI_AGENT_DIR/extensions/web-search/$relative"
    [[ -e "$target" ]] && cp "$target" "$backup/web-search/$relative"
    cp "$REPO_DIR/extensions/web-search/$relative" "$target"
  done
  [[ -e "$PI_AGENT_DIR/extensions/file-links.ts" ]] && cp "$PI_AGENT_DIR/extensions/file-links.ts" "$backup/file-links.ts"
  cp "$REPO_DIR/extensions/file-links.ts" "$PI_AGENT_DIR/extensions/file-links.ts"
  for relative in ask-user-question.ts; do
    target="$PI_AGENT_DIR/extensions/$relative"
    [[ -e "$target" ]] && cp "$target" "$backup/$relative"
    cp "$REPO_DIR/extensions/$relative" "$target"
  done
  mkdir -p "$PI_AGENT_DIR/extensions/shared" "$backup/shared"
  contract="$PI_AGENT_DIR/extensions/shared/ask-user-question-contract.ts"
  [[ -e "$contract" ]] && cp "$contract" "$backup/shared/ask-user-question-contract.ts"
  cp "$REPO_DIR/extensions/shared/ask-user-question-contract.ts" "$contract"
  if [[ -e "$PI_AGENT_DIR/extensions/ask-user-question-contract.ts" ]]; then
    cp "$PI_AGENT_DIR/extensions/ask-user-question-contract.ts" "$backup/ask-user-question-contract.ts"
    rm "$PI_AGENT_DIR/extensions/ask-user-question-contract.ts"
  fi
  mkdir -p "$backup/bash-guard" "$PI_AGENT_DIR/extensions/bash-guard"
  [[ -e "$PI_AGENT_DIR/extensions/bash-guard/index.ts" ]] && cp "$PI_AGENT_DIR/extensions/bash-guard/index.ts" "$backup/bash-guard/index.ts"
  cp "$REPO_DIR/extensions/bash-guard/index.ts" "$PI_AGENT_DIR/extensions/bash-guard/index.ts"
  mkdir -p "$backup/interactive-subagents" "$PI_AGENT_DIR/extensions/interactive-subagents"
  for relative in index.ts session.ts status.ts routing.ts rpc-backend.ts; do
    target="$PI_AGENT_DIR/extensions/interactive-subagents/$relative"
    [[ -e "$target" ]] && cp "$target" "$backup/interactive-subagents/$relative"
    cp "$REPO_DIR/extensions/interactive-subagents/$relative" "$target"
  done
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
