# Implementation status

Updated: 2026-09-24 (continued after Qwen startup)

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

- `127.0.0.1:8080`: unavailable; GLM server is not running
- `127.0.0.1:8081`: authenticated `/v1/models` returns Qwen3.6 successfully
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

- Browser tools remain opt-in (`/browser on`); Playwright executable selection now supports `PI_BROWSER_EXECUTABLE_PATH`.
- User units installed and daemon-reloaded under `~/.config/systemd/user/`; both remain disabled and stopped.
- `tmux` 3.7c installed; interactive-subagents pinned and loaded. `subagents_list` exposes scout, researcher, and worker with scoped models.
- Observational-memory pinned and loaded with Qwen observer/consolidator, concurrency 1, and default OFF gate; a pre-change settings backup was created.

- Qwen inference, Pi startup, and custom-tool orchestration are now passing on port 8081.
- `web-fetch` successfully fetched `https://example.com`; `web-search` correctly reports missing credentials.
- Browser dependency smoke test passed: Chromium navigated to Example Domain, read DOM title, and wrote `/tmp/pi-config-example.png`.
- Failure/recovery fixture at `~/projects/pi-qwen-recovery-fixture` demonstrates FAIL → production-only repair → PASS; final suite is 3/3 and tests were not modified during the repair.
- GLM fallback remains unavailable until the GLM server is started on port 8080.
- Google web search remains unavailable until credentials are supplied by the user.
- GLM fallback on 8080 is still stopped; this is expected because only Qwen was requested.
- A live tmux spawn test still requires running the main Pi session inside tmux; no detached production session was created automatically.
- RPC smoke test accepted `/om on`, `/om:status`, and `/om off`; no `.memory/` was created in the no-session smoke run. Full compaction validation still needs a real test session.
- Interactive subagents, observational memory, user services, extra providers, MCP, and production router adapters remain intentionally gated; their upstream versions and credentials need separate review rather than being silently enabled.

## Next action

Validate imported extensions interactively, and start the GLM fallback only when needed. User-service templates are available but intentionally not enabled or started.
