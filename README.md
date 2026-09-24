# Pi Configuration

Curated local Pi configuration for multi-provider orchestration.

## Current architecture

- **Default:** `local-qwen36/unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M`
- **Fallback:** `local-glm/ggml-org/GLM-4.7-Flash-GGUF:Q4_K` (when port 8080 is running)
- **Remote:** `openrouter/auto`, restricted to explicitly classified simple tasks
- **Scope:** `~/.pi/agent/settings.json` → `enabledModels`
- **Routing:** `scripts/router.mjs` and `extensions/routing/`
- **Subagents:** tmux windows via `extensions/interactive-subagents/`
- **Memory:** observational-memory integrated but OFF by default

## Useful checks

```bash
./scripts/health-check.sh
./scripts/health-check.sh --deep
node scripts/runtime-state.mjs
node --test scripts/router.test.mjs
pi --list-models
```

Start Pi from inside tmux to use interactive subagents:

```bash
tmux new -A -s pi 'pi'
```

Subagents open separate tmux windows, not split panes. Use `Ctrl-b n` / `Ctrl-b p`
to switch between them.

## Security

Credentials remain outside Git in `~/.pi/agent/auth.json` and server secret files.
The router never selects a model outside `enabledModels`. Third-party extensions run
with the Pi process permissions and are treated as trusted code.

See [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md),
[`docs/architecture.md`](docs/architecture.md), and
[`docs/upstream-components.md`](docs/upstream-components.md).
