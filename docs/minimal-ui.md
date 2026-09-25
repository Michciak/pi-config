# Pi in tmux: native clipboard, keyboard scrolling

Mouse handling is disabled in tmux (`set -g mouse off`). Select text normally
by dragging in Warp. Keyboard scroll: Ctrl+b, release, then [; use arrows or
PageUp/PageDown (Fn+Up/Fn+Down on compact Mac keyboards). Press q to return to Pi
before pasting. Up/Down at the live prompt remain Pi prompt-history controls.

Install with delivery `--minimal-ui --current --warp-clipboard` from a shell
inside the current tmux session (Ctrl+b then c). The installer backs up changed
files and applies mouse off without changing keyboard protocol. It also creates
~/.warp/keybindings.yaml if absent, or accepts it if already identical; it stops
before runtime edits if an unrelated keybindings file exists.

Restart Warp to load its shortcuts. The tmux server is not restarted; reattach
to the same server/session afterward. Copy is Cmd+Shift+C, Paste is Cmd+Shift+V.
Copy Command moves to Cmd+Option+C to avoid conflict. No clipboard content is
read by the installer. Mouse scrolling through tmux history is intentionally off.

The previous clipboard helper/CSI-u patch was reverted in Git. If its live
settings still need undoing, add --rollback-clipboard and restart Pi afterward.
The extended-key warning may return; it is unrelated to native Warp copy/paste.

Sources: [Warp keysets](https://github.com/warpdotdev/keysets),
[Warp shortcuts](https://docs.warp.dev/getting-started/keyboard-shortcuts).
Live Warp clipboard behavior still requires verification after applying.

## File links

`extensions/file-links.ts` uses Pi 0.87.1's supported Markdown transformer.
It converts existing file references in assistant prose and inline code into
absolute `file://` hyperlinks. It resolves relative paths against Pi's working
directory, handles spaces/Unicode, and normalizes existing Markdown file links.
The model also receives a formatting instruction to use unambiguous file links.
Warp opens file URLs in the chosen editor (Rider).

Saved messages and code examples are not rewritten. Missing or ambiguous files
are not guessed; fenced/indented code blocks remain copyable code. A displayed
line suffix is preserved as text, but this version opens the file, not a promised
line/column. This is a file-reference feature, not a transformation of raw tool
stdout or shell logs. Web links keep their existing targets.

The extension clears Pi's cached hyperlink capabilities on load. If `/reload`
still shows a visible file URL instead of a short clickable label, the active
tmux client may need reconnecting to detect its terminal features. The visible
file URL is still usable in Warp. Do not change the keyboard protocol.

Validation: `node --test tests/file-links.test.mjs` checks conversion and actual
OSC 8 rendering through the installed Pi library. Live Warp clicking/scrolling
cannot be tested from the restricted Codex session; macOS editor selection must
be confirmed in Warp. This document does not claim that UI acceptance passed.

Sources: [Warp files and links](https://docs.warp.dev/terminal/more-features/files-and-links),
[Warp mouse reporting](https://docs.warp.dev/terminal/more-features/full-screen-apps).
