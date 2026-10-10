# RPC read pressure

Control logged repeated 30-second RPC timeouts for get_commands, get_messages,
get_state and model metadata on 2026-10-08. A live stack sample of Pi was entirely
inside JSON.stringify. This points to serialization pressure; it does not prove
that the proxy caused the timeouts.

The Remote-only SDK adds get_messages_page with a 400-message hard cap (UI uses
160), positional cursors and a display projection. Opaque thinking/text signatures
are omitted, very long text/diffs are clipped with a visible notice, oversized
images are represented by a notice. The persisted transcript and model context
are unchanged. Older pages remain reachable and already loaded older messages
survive a new tail snapshot where cursors overlap. Search operates on loaded pages.

Plugin attach snapshots also use pages and expose historyPage {start,end,total};
they must not be mistaken for complete model context. Legacy get_messages and
SDK/model semantics are left intact. Simultaneous identical read requests share
one RPC operation per runtime; only commands/model catalogs have a one-second
resolved cache. State and history are not cached after resolution. Mutating
operations are never coalesced or retried.

Read timeouts return HTTP 504 / PI_RPC_TIMEOUT with a safe Polish message.
Mutation timeouts have PI_RPC_MUTATION_TIMEOUT and warn that the operation may
already have happened. Unrelated internal exceptions retain generic public errors.
No stderr, paths or tokens are exposed in these responses.
