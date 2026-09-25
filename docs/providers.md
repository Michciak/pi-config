# Providers

- `local-qwen36`: `http://127.0.0.1:8081/v1`, default orchestrator.
- `local-glm`: `http://127.0.0.1:8080/v1`, fallback.
- `openrouter`: Pi-managed auth and catalog; only `openrouter/auto` is scoped. `mcp_provider_quota_status` currently reports zero remaining credits.
- `openai-codex`: authenticated through Pi `/login`; exact license quota is reported as unknown because no supported public quota endpoint is configured.
- `cursor`/`lightllm`: no credentials or endpoint configured; not added to scope.

Both local services were unavailable during the 2026-09-24 audit. Start them
manually or through an approved user service before running inference tests.
