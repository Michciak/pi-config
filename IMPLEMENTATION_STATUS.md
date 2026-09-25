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
| 6. Namespace compatibility | Complete for current setup | Pi starts without extension-load errors in available checks; user confirmed the integrated runtime works in Warp. |
| 7. Failure/recovery workflow | Complete | Isolated fixture repaired by the current orchestrator; tests pass and only `src/math.js` changed. |
| 8. llama-server services | Deferred | Local LLMs are out of current scope. |
| 9. Interactive subagents | Complete for initial set | tmux extension installed; `scout`, `researcher`, `worker` and merged Cursor profiles available. |
| 10. Observational memory | Not started | Deliberately postponed until the core workflow is stable. |
| 11. Providers | Existing configuration preserved | OpenAI/Codex, OpenRouter, Cursor, OpenCode and Copilot entries remain in current Pi scope. |
| 12. MCP | Not started | No MCP server has been added. |
| 13. Capability registry | Scaffold complete | Registry covers all active scope entries with conservative unverified fields and validation. |
| 14. Quota/cost adapters | Not started | No provider quota API was introduced. |
| 15. Model router | Implemented in delivery clone | `/route` retains the coordinator and requests delegation; subagent execution enforces scope and selects its model. Live acceptance pending. |
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

## Next stage

Deploy the workspace delivery commits and validate a real `/route` task inside
Warp/tmux. Then implement provider failure classification and quota adapters.
Memory and MCP remain unimplemented; no local LLM work is planned.

## Failure/recovery fixture

`tests/failure-recovery-fixture` contains two intentional production defects
and correct tests. The baseline failed two tests; the current orchestrator repaired
only `src/math.js`, and the final test run passes both tests.

## Router availability filter

`openai-codex/gpt-5.3-codex-spark` remains in the user's configured scope but is
excluded from automatic routing because Codex reports it unsupported for a
ChatGPT account. The scope itself was not rewritten.


## Verified delivery — 2026-09-25

Delivery clone only: changes are committed here, not deployed to the global runtime.
The current coordinator is preserved. `/route` dispatches a coordinator prompt to
use the existing subagent tool; executor selection occurs in that tool before
pane creation. Explicit overrides must be eligible members of the active scope.
Agent roles influence ranking. Reasoning capability and nonzero catalog price
estimates supplement the provider preference policy; they do not prove quality,
provider entitlement, or remaining quota. No inference-time automatic retry is
performed, because it could repeat side effects.

Children receive the parent's model scope through `--models`; resume revalidates
the saved model against the current parent scope. Existing agent identities,
tool allowlists and asynchronous result delivery are retained.

Validation: 17 behavioral/runtime tests passed with Pi 0.87.1. The actual Pi loader
registers both extensions and all three subagent tools without errors. Global
provider requests and live tmux result delivery were not tested. Synchronization
was tested on an isolated configuration: backup, apply, check, idempotent apply.

Commits also preserve the user's tmux configuration changes. Runtime synchronization
now copies the router and its four changed interactive-subagents dependencies.
No credentials, Cursor settings, global scope, or provider configuration changed.
Remaining: deployment/live acceptance, inference failure classification and recovery,
quota integration, observational memory, and a selected MCP integration.
