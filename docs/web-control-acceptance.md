# Pi Local Web Control acceptance

Run this checklist after installing on the target Mac. It separates automated
repository checks from steps that need the real Pi runtime, Firebase, S24 or
Galaxy Watch 7.

## Repository and RPC checks

```sh
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
./scripts/diagnose-web-control.sh
./scripts/acceptance-web-control.py
```

The smoke script starts Engine only if needed, creates a disposable RPC session,
reads state, model scope, extension commands and statistics, then restores the
previous Engine state. It does not send a prompt to a provider.

From the panel, verify one live session with the current Pi model:

1. Send a prompt, then exercise steer, follow-up, abort and retry.
2. Add an image and run one direct bash command; interrupt a second command.
3. Change thinking level and model within the existing scope.
4. Compact, fork, clone, rename, export and resume the session.
5. Run a dynamic extension command and a prompt snippet.
6. Start each subagent role, send a steer message, resume it, and verify its
   result and status arrive in the parent without tmux.
7. Import a terminal JSONL and confirm that the source file remains unchanged.
8. Click a valid local path, open it in Rider, then verify traversal and a
   symlink outside the NETRIX root are rejected.

For interactions, exercise empty and non-empty text, cancel, single-select,
multi-select, option descriptions, a literal option named `Other`, and custom
`Other`. Refresh or reconnect before answering one question, answer another
twice to observe `409`, abort a waiting tool call, and restart Engine with
pending work to verify invalidation.

## Android, FCM and Watch 7

```sh
./scripts/build-install-android.py
adb shell am force-stop pl.michalkozinski.piremote
```

Pair from the web QR code and verify:

1. foreground and background FCM delivery;
2. FCM token renewal after clearing app data and pairing again;
3. an `ask_user_question` notification has no answer actions and opens the
   exact web form;
4. command approval offers Approve/Reject from S24 and from Watch 7;
5. repeating a stale notification action does not retry indefinitely;
6. loss and restoration of LAN produces a retry and later recovery;
7. Engine status changes arrive without prompt contents in the FCM payload.

Galaxy Wearable must allow Pi Remote notifications. If the Samsung firmware
does not bridge approval actions, implement the documented minimal Wear module
only after confirming this failure on the target Watch 7.

## Energy and regression

Start a long-running, harmless task, let the display sleep with the lid open,
and verify the response continues. `pmset -g assertions` should show the Engine
`caffeinate -i` assertion while at least one RPC session is active and no such
assertion after Engine stops.

Finally run terminal Pi and Cursor as before. Confirm the terminal
`ask_user_question`, bash guard, tmux subagents, provider authentication and
existing global model scope remain unchanged.
