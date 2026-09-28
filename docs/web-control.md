# Pi Local Web Control

## Components

- `apps/control` is a per-user Fastify service on port 3784. It owns SQLite
  metadata, the event stream, device pairing, FCM delivery, interactions and
  the lifecycle of RPC sessions.
- `apps/web` is the responsive React client served by Control Service.
- `apps/android` is the private `pl.michalkozinski.piremote` companion.
- `packages/protocol` contains the shared API and interaction contracts.
- `packages/prompt-snippets` is the parser shared by the TUI extension and the
  web panel.

Control Service starts through LaunchAgent at login. Pi Engine does not. Start
Engine from the panel or API. While Engine is running, Control Service owns a
`caffeinate -i` process. Display sleep remains available; closing the lid is not
supported by this setup.

Each web session owns a separate Pi process through `RpcClient`. Terminal Pi
continues to use its own session file and its existing tmux subagent backend.
Importing a terminal session copies its JSONL before the web process opens it.

## First installation

Run from the repository:

```sh
./scripts/install-web-control.sh
open http://127.0.0.1:3784
```

The installer downloads npm dependencies, builds all workspaces, backs up every
global Pi extension it replaces, installs the RPC-aware extensions, writes a
user LaunchAgent and starts Control Service. It does not change Pi provider
authentication, Cursor configuration, terminal configuration or tmux.

The allowed workspace root defaults to:

```text
~/Library/CloudStorage/Dropbox/NETRIX
```

Override it only during installation with `PI_WEB_WORKSPACE_ROOT`. Both
workspace and file operations use `realpath`; traversal and symlinks leaving
that root are rejected.

## Firebase and Android

1. Add Android app `pl.michalkozinski.piremote` to the existing Firebase
   project and place its `google-services.json` at
   `apps/android/app/google-services.json`. The path is ignored by Git.
2. Store the Firebase Admin service account in Keychain:

   ```sh
   ./scripts/configure-firebase-keychain.py ~/Downloads/firebase-admin.json
   launchctl kickstart -k gui/$(id -u)/pl.michalkozinski.pi-control
   ```

3. Create the APK signing key outside the repository and build/install:

   ```sh
   ./scripts/configure-android-signing.py
   ./scripts/build-install-android.py
   ```

4. In the local web panel choose **Telefon**, then scan the QR code on the S24.
   Allow notifications for Pi Remote on the phone and in Galaxy Wearable.

FCM contains only the event sequence identifier. The phone retrieves the event
from the signed local API. Device decisions use an ECDSA P-256 key generated in
Android Keystore plus a timestamp and one-use nonce. The Firebase service
account and APK passwords are read from macOS Keychain. Provider credentials
are never exposed through the API.

Phone notifications use `NotificationCompat`, so Wear OS bridges them by
default. `ask_user_question` opens the matching web form. Approval notifications
contain approve/reject actions. Add a dedicated Wear module only if Samsung
firmware does not bridge those actions on the target Watch 7.

## Questions, approvals and extension UI

`ask_user_question` uses its original custom TUI when Pi runs in a terminal. In
RPC mode it connects to the Control Service Unix socket and waits without a
timeout. Questions are FIFO per session; sessions may wait concurrently. The
first answer wins, a second answer returns HTTP 409, and abort closes and
cancels the corresponding question. Engine restart invalidates every pending
question and approval.

Pi RPC `select`, `confirm`, `input` and `editor` requests use the same broker.
Status, widget, notification, title and editor-text requests become web events.
`bash-guard` uses `confirm` in RPC mode and keeps its existing terminal UI.

Web subagents use nested `RpcClient` processes. The terminal path still uses
tmux. Agent profile tool allowlists and the current model scope remain in force.
`ask_question` sends a question to the parent orchestrator. The orchestrator may
answer with `subagent_message`, or first ask the human through
`ask_user_question`. Subagents never receive `ask_user_question` in their tool
allowlist.

## Operations

```sh
./scripts/diagnose-web-control.sh
./scripts/acceptance-web-control.py
./scripts/backup-web-control.sh
./scripts/uninstall-web-control.sh
```

The complete automated and device acceptance procedure is in
[`web-control-acceptance.md`](web-control-acceptance.md).

API documentation is available locally at `/api/docs`; the JSON document is at
`/api/v1/openapi.json`. WebSocket clients reconnect to `/api/v1/events?after=N`
using the last persisted sequence.

Control Service accepts loopback and current-host LAN names/addresses. Remote
web sessions and Android requests require a bearer session or device signature.
HTTP does not encrypt prompts or answers, so use only a trusted LAN. Mutating
browser requests from a different Origin and untrusted Host headers are
rejected. Pairing codes expire after five minutes and attempts are rate-limited.

SQLite event rows retain Pi event type and operational metadata, while live
WebSocket listeners receive the complete event. Prompt text, assistant text,
reasoning, tool arguments and tool output are not copied into SQLite; reconnect
reloads them from the Pi JSONL session.

Runtime data lives in `~/.pi/agent/web-control`; it is not versioned. Removing
the LaunchAgent leaves that directory and the backed-up global extensions in
place.
