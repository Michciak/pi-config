# Providers

- `local-qwen36`: `http://127.0.0.1:8081/v1`, default orchestrator.
- `local-glm`: `http://127.0.0.1:8080/v1`, fallback.
- `openrouter`: Pi-managed auth and catalog; only `openrouter/auto` is scoped.

Both local services were unavailable during the 2026-09-24 audit. Start them
manually or through an approved user service before running inference tests.
