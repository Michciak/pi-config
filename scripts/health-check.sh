#!/bin/zsh
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PI_AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
fail=0
ok() { print "OK   $1"; }
bad() { print "FAIL $1"; fail=1; }
if command -v pi >/dev/null 2>&1; then ok "pi available ($(pi --version 2>/dev/null | head -1))"; else bad "pi executable"; fi
if command -v tmux >/dev/null 2>&1; then ok "tmux available ($(tmux -V))"; else bad "tmux executable"; fi
python3 - "$PI_AGENT_DIR" "$REPO_DIR" <<'PY'
import json, stat, sys
from pathlib import Path
agent=Path(sys.argv[1]); repo=Path(sys.argv[2]); failed=False
def ok(s): print('OK   '+s)
def bad(s):
 global failed; failed=True; print('FAIL '+s)
settings=agent/'settings.json'
if not settings.is_file(): bad('settings.json'); raise SystemExit(1)
try: data=json.loads(settings.read_text())
except Exception: bad('settings.json readable'); raise SystemExit(1)
for key in ('defaultProvider','defaultModel','enabledModels'):
 if key not in data: bad(f'settings.{key}')
if all(k in data for k in ('defaultProvider','defaultModel','enabledModels')):
 ok(f"orchestrator {data['defaultProvider']}/{data['defaultModel']}")
 ok(f"model scope {len(data['enabledModels'])} entries")
auth=agent/'auth.json'
if auth.is_file():
 mode=stat.S_IMODE(auth.stat().st_mode)
 ok(f'auth.json present (mode {mode:04o}; contents not read)') if mode & 0o077 == 0 else bad(f'auth.json permissions {mode:04o}')
else: bad('auth.json present')
for name in ('scout','researcher','worker','coder','detective','fixer','inventor','planner','reviewer'):
 p=agent/'agents'/f'{name}.md'
 ok(f'agent {name}') if p.is_file() else bad(f'agent {name}')
for p in (repo/'package.json', repo/'docs/component-manifest.json', repo/'scripts/sync-runtime.sh'):
 ok(f'repo {p.relative_to(repo)}') if p.is_file() else bad(f'repo {p.relative_to(repo)}')
print('LOCAL_LLM=deferred')
raise SystemExit(1 if failed else 0)
PY

if ! python3 "$REPO_DIR/scripts/validate-capability-registry.py"; then
  fail=1
fi
exit "$fail"
