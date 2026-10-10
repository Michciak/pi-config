# Orchestrator recovery after fixer completion

The BNC-voice3 transcript records two provider failures on 2026-10-08:
09:44:24Z and 10:40:48Z, both `Codex error: upstream stream ended before a
completion event; this turn may be incomplete`. The process remained alive and
idle, with no pending messages. This is not evidence of a subagent killing Pi.

Pi AI 1.0.3's retry classifier omits this exact error, despite recognizing other
premature stream endings. The release-local patch adds only this signature to
native bounded/backoff retry. Account limits, cancelled turns and context
overflow retain native exclusions. Global terminal Pi is not patched. Existing
failed work is not resumed by installation.

The RPC backend additionally had uncaught detached-task paths: initialization,
UI callbacks, result delivery and cleanup could throw, and error delivery could
throw again. Jobs now have lifecycle ownership, shutdown invalidates APIs before
stopping children, and detached failures are caught. Failed/aborted child turns
are reported as failures, not successful completions. Fixture tests use no model
requests and cover normal completion, provider failure, failed delivery, shutdown
and a subsequent session.

ACP was updated to 0.1.188 and its installed bundle no longer had the Remote
adapter. Installation restores task routing/system-result delivery/fleet hooks.
Remote startup now awaits native tool registration before returning; terminal
registration remains detached with the original error handler. Future npm package
updates can replace local patches: rerun the tested deployment after such updates.

Other fixes: async, cached child transcript reads (same path/size security checks,
200-message bound, four concurrent readers); consecutive-only diagnostic
deduplication preserving event order; redundant typebox dependency removed from
pi-goal 0.2.0's manifest after backing it up, retaining its host-provided peer.

Old proxy timeout/duplicate-instance logs concern older Bili builds (0.1.184/185).
The current 0.1.188 implementation already kills abandoned proxy children after
its startup timeout. Do not kill unrelated proxies or claim historical startup
failures are reproduced without fresh evidence. Error phone notifications already
include assistant provider failures and subagent failures; no live paid delegation
or human approval is submitted by these tests.
