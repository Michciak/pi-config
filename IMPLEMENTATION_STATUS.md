# Pi local implementation status

Updated: 2026-09-25
Repository: `/Users/michalkozinski/projects/pi-config`

## User decisions

- Local LLM servers are deferred.
- The currently selected Pi model remains the orchestrator.
- The existing Pi model scope remains authoritative.
- Global Pi configuration may be modified after preserving a backup.
- Cursor agent names are merged with Pi's `scout`/`researcher`/`worker` roles.
- Changes are made in small commits.

## Baseline

- Host: macOS, zsh, Warp, tmux 3.7c
- Pi: 0.87.1
- Node: 26.9.0
- Current orchestrator: `openai-codex/gpt-5.5`
- Active scope: 25 entries
- Local endpoints 8080/8081: inactive and intentionally deferred
- Secrets: remain in `~/.pi/agent/auth.json`; no secrets are tracked

## Plan progress

| Plan stage | Status | Result |
|---|---|---|
| 0. Audit/baseline | Partial | Runtime audited; repo created; non-secret baseline captured. A separate auth backup was intentionally not copied. |
| 1. Local Qwen default | Deferred | Superseded by the decision to defer local LLMs. |
| 2. Curated model scope | Adapted | Existing 25-entry scope preserved and documented; no automatic pruning. |
| 3. Upstream integration/provenance | Complete for imported components | Manifest, hashes, package structure, and source references recorded. |
| 4. Pi tools | Integrated, runtime pre-existing | Selected extensions are versioned and present globally; package migration remains separate. |
| 5. Skills | Integrated, runtime pre-existing | Four existing skills are versioned and included in the package manifest. |
| 6. Namespace compatibility | Smoke-checked | Pi starts without extension-load errors in available checks; full Warp smoke test remains the authoritative test. |
| 7. Failure/recovery workflow | Not started | Requires a dedicated fixture and real model run. |
| 8. llama-server services | Deferred | Local LLMs are out of current scope. |
| 9. Interactive subagents | Complete for initial set | tmux extension installed; `scout`, `researcher`, `worker` and merged Cursor profiles available. |
| 10. Observational memory | Not started | Deliberately postponed until the core workflow is stable. |
| 11. Providers | Existing configuration preserved | OpenAI/Codex, OpenRouter, Cursor, OpenCode and Copilot entries remain in current Pi scope. |
| 12. MCP | Not started | No MCP server has been added. |
| 13. Capability registry | Scaffold complete | Registry covers all active scope entries with conservative unverified fields and validation. |
| 14. Quota/cost adapters | Not started | No provider quota API was introduced. |
| 15. Model router | Intentionally not started | Current selected model remains orchestrator; scope is not overridden. |
| 16. Repository structure | Mostly complete | Package, agents, extensions, skills, scripts, docs, and settings are versioned. |
| 17. Health check | Complete | Read-only health check covers runtime, agents, skills, scope, registry, and auth permissions. |
| 18. GLM-5.3 compatibility | Deferred | Local model work is out of current scope. |

## Available operations

```sh
./scripts/health-check.sh
./scripts/sync-runtime.sh --check
python3 ./scripts/audit-model-scope.py
python3 ./scripts/validate-capability-registry.py
```

`sync-runtime.sh --apply` backs up and synchronizes only versioned agents,
skills, Cursor bridge, and tmux configuration. It does not modify auth,
settings, model cache, scope, or sessions.

## Next recommended stage

Run the full smoke test from Warp, where Pi can acquire its normal runtime
locks and model catalog. Then decide whether to build the failure/recovery
fixture (plan stage 7) or add one MCP integration. No router or local-model
work is needed for the current direction.

## Failure/recovery fixture

`tests/failure-recovery-fixture` contains two intentional production defects
and correct tests. The baseline is verified to fail two tests. Use
`scripts/run-failure-recovery-test.sh` from Warp to run the current Pi model
against the isolated fixture; tests must remain unchanged.
