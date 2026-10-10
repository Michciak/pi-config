# Current Pi model scope

Generated from the active `~/.pi/agent/settings.json` without changing it.

- Default provider: `openai-codex`
- Default model: `gpt-5.5`
- Entries: `20`

## Enabled patterns

- `openai-codex/gpt-5.3-codex-spark`
- `openai-codex/gpt-5.5`
- `openai-codex/gpt-5.6-luna`
- `openai-codex/gpt-5.6-sol`
- `openai-codex/gpt-5.6-terra`
- `openai-codex/gpt-6-astra`
- `openai-codex/gpt-6-luna`
- `openai-codex/gpt-6-sol`
- `openrouter/openrouter/auto`
- `openrouter/openrouter/free`
- `openrouter/openrouter/fusion`
- `github-copilot/claude-haiku-4.5`
- `github-copilot/kimi-k3`
- `github-copilot/gpt-5-mini`
- `cursor/composer-2.5`
- `cursor/composer-latest`
- `cursor/auto`
- `cursor/grok-4.6`
- `cursor/grok-4.7@256k:slow`
- `cursor/grok-4.7@500k:slow`

## Policy

This list is authoritative for the current setup. The router and subagents must remain within it.
The non-destructive audit script should be run from Warp because a sandboxed run cannot always read Pi runtime locks and the model catalog.
No local LLM endpoint is included in this scope.
