# Local Pi configuration

Versioned local configuration for Pi on macOS with OpenAI/Codex,
OpenRouter, Cursor CLI, and the existing Pi model scope.

It now also contains an opt-in local web control plane, a manual Pi RPC Engine,
and a signed Android companion. Web sessions and web subagents do not use tmux;
the existing terminal workflow is preserved.

## Current policy

- The currently selected Pi model remains the orchestrator.
- The existing `enabledModels` scope remains authoritative.
- Local LLM servers are deferred.
- Secrets stay in Pi's runtime auth storage and are never committed here.
- Cursor configuration remains untouched; Cursor roles are mirrored and merged
  into Pi agent profiles.

## Run

```sh
pi
```

In an existing Pi session, use `/reload` after changing extensions.

Warp and tmux customization has been removed. Run Pi directly in your chosen
terminal. Interactive subagents may still use tmux; the binary remains installed
with standard settings. Runtime sync no longer installs terminal configuration.

## Agents

The merged profiles are `scout`, `researcher`, `worker`, `coder`, `detective`,
`fixer`, `inventor`, `planner`, and `reviewer`. The Cursor CLI bridge exposes
`cursor_coder`, `cursor_detective`, `cursor_fixer`, `cursor_inventor`,
`cursor_planner`, and `cursor_reviewer` as read-only delegates.

## Operations

```sh
./scripts/health-check.sh
./scripts/sync-runtime.sh --check
python3 ./scripts/audit-model-scope.py
```

Install the local web interface after reviewing
[docs/web-control.md](docs/web-control.md):

```sh
./scripts/install-web-control.sh
open http://127.0.0.1:3784
```

Firebase and APK signing secrets remain outside the repository in macOS
Keychain. `google-services.json`, SQLite state, Pi sessions, tokens, keystores
and built APK files are ignored.

Use `./scripts/sync-runtime.sh --apply` only after reviewing its output. It
backs up the files it replaces and does not modify auth, settings, model cache,
or session state.

See [docs/operations.md](docs/operations.md) and
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for the current handoff.
Web/mobile setup is documented in [docs/web-control.md](docs/web-control.md).
