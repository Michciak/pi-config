# Implementation status

Updated: 2026-09-24

## Current phase

Baseline audit complete; staged implementation is in progress.

## Runtime

- Pi: 0.87.1 (`/home/michciak/.local/lib/npm/bin/pi`)
- llama.cpp: 0.4.1-dev, build 10964, commit `b29c606e28`
- Node: v26.10.0
- Repository: `master`, baseline checkpoint `6ef4c4c`
- Package loading: `~/.pi/agent/settings.json` points at this repository

## Configuration

- Default provider: `local-qwen36`
- Default model: `unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M`
- Default thinking: `medium`
- `~/.pi/agent/models.json` resolves to `settings/models.json`
- Current custom providers: `local-glm`, `local-qwen36`
- OpenRouter catalog is held in Pi runtime state (`models-store.json`); credentials remain in `auth.json` and are not copied to Git.

## Health snapshot

- `127.0.0.1:8080`: unavailable during audit (no running llama-server)
- `127.0.0.1:8081`: unavailable during audit (no running llama-server)
- GLM-5.3: retained; not modified or removed
- User backup: `~/.local/state/pi-config-backup/20260924-203702/`

## Existing resources

- `extensions/config-test.ts`
- `settings/models.json`
- no upstream Amos components or skills imported yet

## Differences and blockers

- Repository initially contained the handoff plan as an untracked file.
- No `package.json` existed; package metadata and local dependencies need to be added.
- Local llama-server units are not active; system-wide service changes are out of scope.
- Third-party upstream components require fresh review and pinned provenance before import.

## Completed since baseline

- Curated scope applied to `~/.pi/agent/settings.json`: Qwen, GLM, and `openrouter/auto`.
- Added `settings/model-capabilities.json` and `settings/model-catalog.md`.
- Imported reviewed Amos components at upstream commit `f82da563ab05d66729492d64c7ed4e96db3663f3`.
- Installed isolated npm dependencies for bash guard, browser, and web fetch; installed Chromium and a local PDF-reader venv.
- Added non-secret `/config-health`, `scripts/health-check.sh`, and scope-enforcing `scripts/route-model.mjs`.
- Orchestrator regression: lookup → `17 * 24` → `408 - 13` → verify `395`: PASS.
- Pi offline startup smoke test with the package and curated OpenRouter model: PASS (`OK`).
- Router smoke tests: local orchestrator resolves to Qwen; vision request resolves only within scope.

## Remaining gated work

- Local inference tests are blocked until llama-server is started on ports 8080/8081.
- Google web search remains unavailable until credentials are supplied by the user.
- Interactive subagents, observational memory, user services, extra providers, MCP, and production router adapters remain intentionally gated; their upstream versions and credentials need separate review rather than being silently enabled.

## Next action

Start the local endpoints for inference smoke tests, then validate each imported extension interactively before enabling additional orchestration packages.
