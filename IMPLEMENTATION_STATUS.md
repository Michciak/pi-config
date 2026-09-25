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

## Current resources

- Extensions: diagnostics, routing, config-test, Amos tools, browser, and tmux subagents.
- Skills: analyze-sessions, pdf-reader, web-debug, youtube-transcript.
- Settings: curated models and capability registry.
- Services: user-unit templates installed but disabled/stopped.

## Known blockers

- GLM fallback is not running on `8080`.
- Google Custom Search credentials are not configured.
- OpenAI, Cursor, LightLLM, and MCP integrations are not yet implemented.
- Full observational-memory compaction/resume test remains pending.

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
- Agent model choice is now orchestrator-owned: profiles have no model field, complex tasks default to local Qwen, and OpenRouter is permitted only with explicit `taskClass: simple`.
- Added `scripts/runtime-state.mjs`; it produces non-secret health/quota snapshots consumed by the router. Current snapshot: Qwen healthy, GLM stopped, OpenRouter quota unknown.

- Qwen inference, Pi startup, and custom-tool orchestration are now passing on port 8081.
- `web-fetch` successfully fetched `https://example.com`; `web-search` correctly reports missing credentials.
- Browser dependency smoke test passed: Chromium navigated to Example Domain, read DOM title, and wrote `/tmp/pi-config-example.png`.
- Failure/recovery fixture at `~/projects/pi-qwen-recovery-fixture` demonstrates FAIL → production-only repair → PASS; final suite is 3/3 and tests were not modified during the repair.
- GLM fallback was started for validation but the kernel OOM killer stopped it while Qwen was also loaded; service templates now declare mutual conflicts and only one large local model should run at a time.
- Google web search remains unavailable until credentials are supplied by the user.
- GLM fallback on 8080 is still stopped; this is expected because only Qwen was requested.
- Live tmux spawn test passed in a disposable `pi-config-subagent-test` session: scout ran on local Qwen, read `README.md`, and returned `# Pi Configuration`; the test session was removed afterward.
- Restored tmux split-pane creation now that Pi is running inside tmux. A disposable surface test confirmed the parent window has two panes and the subagent pane closes cleanly afterward.
- The policy test suite covers scope, health, quota, manual override, and the OpenRouter simple-task boundary.
- Corrected observational-memory model IDs to the exact Qwen `UD-Q4_K_M` identifier; backup created before the runtime edit.
- RPC smoke test accepted `/om on`, `/om:status`, and `/om off`; no `.memory/` was created in the no-session smoke run. Full compaction validation still needs a real test session.
- Interactive subagents, observational memory, user services, extra providers, MCP, and production router adapters remain intentionally gated; their upstream versions and credentials need separate review rather than being silently enabled.

## Next action

Validate imported extensions interactively, and start the GLM fallback only when needed. User-service templates are available but intentionally not enabled or started.
