# Quota and license status

`scripts/quota-check.mjs` normalizes provider/license state without exposing keys.

- OpenRouter: reads the authenticated credits endpoint and reports total, usage,
  and remaining credits.
- OpenAI Codex: Pi `/login` OAuth is detected, but license quota is explicitly
  `quotaKnown: false` because Pi does not expose a supported public quota endpoint.
- Local models: capacity is hardware-bound, not provider quota.

The same data is exposed through MCP tool `mcp_provider_quota_status` and consumed
by `scripts/runtime-state.mjs`. Unknown quota is never treated as unlimited for a
remote provider.
