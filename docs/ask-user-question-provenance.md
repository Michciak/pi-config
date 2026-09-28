# `ask_user_question` provenance and contract

The starting implementation was copied on 2026-09-28 from the active local
extension:

```text
~/.pi/agent/extensions/ask-user-question.ts
```

The versioned implementation is `extensions/ask-user-question.ts`. Its pure
normalization and model-facing result logic is now isolated in
`extensions/ask-user-question-contract.ts`. The original TUI custom views and
editor remain active when `ctx.mode === "tui"`; RPC mode uses the local Unix
socket supplied in `PI_ASK_USER_SOCKET`.

The public tool name and result contract remain unchanged:

- one `question`, optional `details`, optional `options`, and `multiSelect`;
- text, single-select and multi-select modes;
- an automatic custom Other choice, disambiguated as `Other (custom)` if an
  actual option is named Other;
- `answered`, `cancelled` and `unavailable` result states;
- unchanged `answers` objects and unchanged text returned to the model.

The contract test covers empty text, cancellation, unavailability, explicit
option values, descriptions, Other collisions and ordered multi-select output.
No authentication material or local session data was copied with the source.
