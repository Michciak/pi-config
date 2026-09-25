# Pi in Warp + tmux (macOS)

## Setup and start

In Warp, enable **Settings → Features → Terminal → Enable Mouse Reporting**
and **Scroll Reporting**. These are two separate settings. See the
[Warp documentation](https://docs.warp.dev/terminal/more-features/full-screen-apps).

The repository supplies `tmux/tmux.conf` and `scripts/tmux-paste.py`.
`scripts/sync-runtime.sh --apply` backs up and installs them into `~/.tmux.conf`
and `~/.pi/agent/tmux/paste.py`. Reload the existing server with
`tmux source-file ~/.tmux.conf` (or Ctrl+b, then r). No Pi restart is needed
for this tmux fix. This also removes the old Ctrl+V override from a live server.

For only these tmux files, `python3 scripts/apply-tmux.py` installs with backup
and reloads the accessible server automatically. The supplied delivery command
`deploy.py --tmux-only` runs the isolated regression checks first and calls this
installer. It does not synchronize other Pi configuration. If a regression check
fails, the repository may already be fast-forwarded but runtime files stay intact.

For a new session, run in the project directory:

```sh
tmux new -A -s pi
pi --tui-mode regular
```

If attaching to an existing session already running Pi, keep using that process.
`regular` is the Pi 0.87.1 default and retains terminal scrollback. Fullscreen mode
uses a different screen model and is outside this scrollback setup.

## Daily use

Here `prefix` means press Ctrl+b, release, then press the next key.

| Action | Input | Result |
| --- | --- | --- |
| Read earlier output | Wheel/trackpad up | First event enters copy-mode and scrolls the pane under the pointer |
| Return toward latest output | Wheel/trackpad down | At the bottom, copy-mode exits |
| Return to Pi immediately | Esc or q while in copy-mode | Removes the top-right counter and restores the live prompt |
| Copy through tmux | Drag text, release mouse | Copies to macOS clipboard and leaves copy-mode |
| Copy through Warp | Hold Shift while selecting, then Cmd+C | Uses Warp's native selection, bypassing mouse reporting |
| Paste normally | Esc if in copy-mode, then Cmd+V | Warp pastes into the live Pi prompt |
| Paste text from either mode | Prefix, Shift+p (uppercase P) | Exits copy-mode, reads macOS text, uses bracketed paste into that pane |
| Paste an image | Esc if in copy-mode, then Ctrl+V | Pi handles its own image/text paste binding |
| Keyboard scroll | Option+Up/Down | Moves five lines if Warp sends those keys; use prefix [ then arrows otherwise |
| Keyboard copy | Prefix [, Space, arrows, y | Selects and copies through macOS clipboard |
| Next subagent pane | Prefix o, or click its pane | Switches focus |
| Zoom/unzoom a pane | Prefix z | Gives one pane the window |
| Detach, leaving Pi running | Prefix d | Returns to Warp shell; `tmux attach -t pi` reconnects |
| Recover the live display | Prefix Esc | Exits copy-mode and redraws, without interrupting Pi |

The top-right `[position/total]` counter means **tmux copy-mode**. It intentionally
holds a view of older output while Pi continues working underneath. Exit with Esc
before answering a Pi approval prompt. Do not restart or kill the tmux server.
Cmd+C operates on a Warp selection; a tmux mouse selection is copied on release.
The uppercase-P shortcut pastes text only; Ctrl+V remains Pi's image-paste shortcut.

## Regression and validation

The previous bindings used `send-keys -X scroll-up -N 5`. tmux stops parsing flags
at `scroll-up`; the remaining arguments make the copy-mode command a silent no-op.
The correction is `send-keys -X -N 5 scroll-up`. First wheel-up now both enters and
moves, downward scrolling exits at the end, and all mouse operations target the
pane under the pointer. See the installed `man tmux`, `send-keys` and `copy-mode`.

The old `$(pbpaste)` binding lost trailing newlines and bypassed bracketed paste.
The replacement keeps clipboard text off command arguments/logs, uses a unique
temporary tmux buffer and explicitly addresses the originating socket and pane.

Run:

```sh
python3 -m unittest discover -s tests/tmux -p 'test_*.py'
python3 tests/tmux/integration.py
```

The integration test uses its own temporary tmux server and synthetic data. It
must test actual viewport movement, not only command exit status. It must not
read or modify the user's clipboard or sessions. A sandbox socket denial is a
blocked test, not a passing test. Real Warp mouse settings and Cmd shortcuts still
require a short interactive check: scroll, Esc, drag/copy, multiline paste, then
repeat in a subagent pane. Do not infer success from configuration loading alone.
