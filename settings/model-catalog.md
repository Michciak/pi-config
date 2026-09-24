# Curated model catalog

The runtime allowlist is stored in `~/.pi/agent/settings.json` under `enabledModels`.
The source-of-truth capability metadata is `settings/model-capabilities.json`.

| Model | Roles | Health endpoint | Status |
|---|---|---|---|
| `local-qwen36/unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M` | orchestrator, coding, general | `127.0.0.1:8081` | verified, default |
| `local-glm/ggml-org/GLM-4.7-Flash-GGUF:Q4_K` | fallback, general | `127.0.0.1:8080` | verified, retained |
| `openrouter/auto` | general, fallback | OpenRouter | requires configured auth |

Do not add a model here without adding it to the runtime allowlist and verifying its provider.
GLM-5.3 is intentionally retained on disk but is not enabled because llama.cpp reports
`unknown model architecture: glm5next`.
