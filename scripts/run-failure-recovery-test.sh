#!/bin/zsh
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$REPO_DIR/tests/failure-recovery-fixture"
MODEL="${PI_TEST_MODEL:-openai-codex/gpt-5.5}"
cd "$FIXTURE"
printf '%s\n' '== baseline test (expected to fail) =='
if npm test; then
  print -u2 'Fixture unexpectedly passes before the agent run.'
  exit 1
else
  print 'Baseline failure confirmed.'
fi
printf '%s\n' '== Pi repair prompt =='
printf '%s\n' "Run from Warp:"
printf '%s\n' "pi --model '$MODEL' --workspace '$FIXTURE' -p --mode text -- \"Find and fix the production bugs in src/math.js. Do not modify tests. Run npm test after each change and finish only when every test passes.\""
