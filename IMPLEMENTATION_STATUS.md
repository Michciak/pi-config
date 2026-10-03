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
- Added `scripts/runtime-state.mjs`; it produces non-secret health/quota snapshots consumed by the router. Current snapshot: Qwen healthy, GLM stopped, OpenRouter quota is known as zero.
- Added a stdio MCP server/bridge with `mcp_config_status` and `mcp_provider_quota_status`; both were called successfully from Pi.
- OpenAI Codex `/login` inference smoke test passed with `OPENAI_CODEX_HEALTH_OK`; quota remains explicitly unknown.
- Real observational-memory test created `.memory/`, `INDEX.md`, `JOURNEY.md`, a topic file, observer/consolidator run artifacts, and resumed the same session successfully.

- Qwen inference, Pi startup, and custom-tool orchestration are now passing on port 8081.
- `web-fetch` successfully fetched `https://example.com`; `web-search` correctly reports missing credentials.
- Browser dependency smoke test passed: Chromium navigated to Example Domain, read DOM title, and wrote `/tmp/pi-config-example.png`.
- Failure/recovery fixture at `~/projects/pi-qwen-recovery-fixture` demonstrates FAIL → production-only repair → PASS; final suite is 3/3 and tests were not modified during the repair.
- GLM fallback was started for validation, reached `model loaded`/`listening` on 8080, then the kernel OOM killer stopped it while Qwen was also loaded; service templates now declare mutual conflicts and only one large local model should run at a time.
- Skill checks: analyze-sessions cost report PASS; pdf-reader extracted `/usr/share/doc/speexdsp/manual.pdf`; yt-dlp 2026.08.19 is installed in the isolated youtube-transcript venv and the wrapper resolves it correctly.
- Google web search remains unavailable until credentials are supplied by the user.
- GLM fallback on 8080 is still stopped; this is expected because only Qwen was requested.
- Live tmux spawn test passed in a disposable `pi-config-subagent-test` session: scout ran on local Qwen, read `README.md`, and returned `# Pi Configuration`; the test session was removed afterward.
- Restored tmux split-pane creation now that Pi is running inside tmux. A disposable surface test confirmed the parent window has two panes and the subagent pane closes cleanly afterward.
- The policy test suite covers scope, health, quota, manual override, and the OpenRouter simple-task boundary.
- Corrected observational-memory model IDs to the exact Qwen `UD-Q4_K_M` identifier; backup created before the runtime edit.
- RPC smoke test accepted `/om on`, `/om:status`, and `/om off`; no `.memory/` was created in the no-session smoke run. Full compaction validation still needs a real test session.
- Interactive subagents, observational memory, user services, extra providers, MCP, and production router adapters remain intentionally gated; their upstream versions and credentials need separate review rather than being silently enabled.

## Latest execution — prioritized remaining tasks

Implemented the first routing/availability pass from `REMAINING_TASKS.md`:

- `scripts/route-model.mjs` now runs `collectRuntimeState()` before routing and records non-secret decisions in `~/.local/state/pi-config/router-decisions.jsonl`.
- `scripts/runtime-state.mjs` now reports local health, OpenRouter catalog health, GitHub auth health, provider auth state, and explicit unknown health for Codex/Cursor where no stable generic endpoint exists.
- `scripts/quota-check.mjs` now returns normalized quota records for OpenRouter, GitHub Copilot, OpenAI Codex, Cursor, and local hardware. Unknown quota is never treated as zero.
- `settings/model-capabilities.json` now contains all currently enabled provider/model IDs.
- Router filtering now inherits provider runtime state, rejects missing auth, rejects known exhausted quota, and preserves unknown quota as unknown.
- Added router integration tests for provider-state inheritance, auth filtering, and exhausted-vs-unknown quota (10/10 PASS).
- Added `scripts/provider-smoke.mjs`; all 11 enabled model IDs are present in `pi --list-models`.
- Interactive subagents prefer native Hyprland terminal windows when available; `PI_SUBAGENT_SURFACE=tmux` forces the legacy pane backend.
- `terminal.hyperlinks=true` was enabled in `~/.pi/agent/settings.json` after creating a backup.

Current live result: Qwen is healthy; GLM is stopped; OpenRouter credits are known to be zero; GitHub Copilot auth health returned 401; Codex and Cursor are configured but health/quota remain explicitly unknown. Therefore remote models are now visible to routing, but they are not falsely presented as fully verified.

## Latest execution — scope auto-reload, opencode-go, Qwen autostart

- Router loads `enabledModels` and `model-capabilities.json` lazily on every call (`scripts/router.mjs`, `extensions/routing/policy.ts`); scope changes apply automatically on `pi /reload` with no process restart.
- opencode-go license is now covered end-to-end: normalized quota record, provider runtime state (auth-only, explicitly unknown health/quota), 3 curated models in scope and capabilities (`glm-5.3-flash`, `kimi-k3`, `deepseek-v4-flash`), provider smoke passes 14/14.
- All 29 Pi-catalogued opencode-go models added to `enabledModels` and `model-capabilities.json` (vision/context from `pi --list-models`, lower priorities so curated defaults keep precedence); provider smoke 40/40.
- New `extensions/local-llama` extension: `session_start` ensures Qwen (skips when already healthy; refuses when GLM active or free memory below 16 GiB floor; starts only via `systemctl --user`), `session_shutdown` stops it only if this Pi process started it and no other `pi` process is running. Commands `/qwen-ensure`, `/qwen-stop`, `/qwen-status`; `PI_QWEN_AUTOSTOP=0` keeps the server running after exit, `PI_QWEN_MIN_AVAILABLE_GIB` tunes the safety floor.
- Router tests 10/10 PASS; provider smoke 40/40 FOUND; TS extensions pass esbuild transform check.
- Live quota per provider: Codex headers (`x-codex-primary-used-percent`, plan plus), opencode zen `/v1/usage` (rolling/weekly/monthly), OpenRouter credits; Cursor manual-only; Copilot expired (401, auto-excluded with recovery on renewal). Quota is a filter gate; removed unit-mixing scoring bonus.

## Next action

Complete interactive extension/provider smoke tests, observational-memory compaction validation, and a live Hyprland subagent spawn. Keep GLM disabled while Qwen is loaded because of the documented VRAM/OOM constraint.
