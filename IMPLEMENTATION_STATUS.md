# Pi local implementation status

## Baseline

- Host: macOS, zsh, Warp, tmux 3.7c
- Pi: 0.87.1
- Node: 26.9.0
- Default orchestrator: `openai-codex/gpt-5.5`
- Local LLM endpoints: intentionally deferred; 8080 and 8081 are not active
- Secrets: remain in `~/.pi/agent/auth.json`; no secrets are tracked here

## Decisions

- Use the currently selected Pi model as orchestrator.
- Keep the existing model scope; do not introduce a router outside that scope.
- Preserve Cursor configuration and merge Cursor agent names with Pi subagent roles.
- Make small, tested commits per implementation stage.

## Current stage

Stage 0 baseline captured. Next: reconcile agent definitions and package provenance, then test the merged subagent surface.

## Verification

- Global agent profiles are synchronized from this repository's `agents/`
  directory; the previous versions are preserved in `backups/`.
- Pi `--help`, `--list-models`, and `pi list` start without the previous
  interactive-subagents config error.
- The active model catalog warns about unavailable configured patterns; those
  warnings are pre-existing and are not changed in this stage.
