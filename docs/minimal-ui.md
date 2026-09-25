# Minimal Pi + tmux + Warp additions

Start from the confirmed working `pi-baseline` server. The tmux configuration
contains only three options: mouse support, `pbcopy` as copy-command, and OSC 8
hyperlink support for Warp's xterm-compatible terminal. All keyboard bindings and
extended-key settings remain at the working defaults.

`python3 scripts/install-minimal-ui.py` backs up and installs the tmux config,
the Pi display extension, and the three-line subagent loader addition. It reloads
only the named `pi-baseline` server. Use `--server NAME` if you named it differently.
It never selects the old default server automatically. Run `/reload` in Pi to
load the extension; newly started subagents receive it too. Existing child Pi
processes must also reload/restart to load a new extension.

In Warp Settings:

1. Features → Terminal: enable Mouse Reporting and Scroll Reporting.
2. Code → Editor and Code Review → Choose an editor to open file links: Rider.

These are supported Warp settings; the installer does not overwrite Warp's
preferences file or change system-wide file associations.

| Action | Input |
| --- | --- |
| Scroll output | Two-finger touchpad scroll, using standard tmux mouse handling |
| Keyboard scroll | Ctrl+b, then [; PageUp/PageDown (Fn+Up/Down on compact Mac keyboards), or arrows |
| Return to live Pi | q while in copy-mode (counter visible in upper right) |
| Copy through tmux | Drag to select, release to copy to macOS clipboard |
| Copy through Warp | Hold Shift while selecting, then Cmd+C |
| Paste | q if in copy-mode, then Cmd+V |
| Paste image | Ctrl+V handled by Pi, unchanged |
| Prompt history | Up/Down at the live Pi prompt, unchanged |
| Open file | Cmd+click its hyperlink; hold Shift as well if tmux captures the click |

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
