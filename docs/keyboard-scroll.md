# Keyboard-only history in tmux

Apply delivery `--keyboard-scroll` from a shell inside the target tmux session
(Ctrl+b then c). No Warp preferences or mouse/clipboard/protocol options change.
The installer appends a managed block to ~/.tmux.conf and backs up the old file.
The bindings persist across restarts: new tmux servers read ~/.tmux.conf by
default. Do not start tmux with `-f /dev/null`, which deliberately bypasses it.
Already-running other tmux servers require `tmux source-file ~/.tmux.conf`
from a shell inside the desired server. Reinstallation does not duplicate the block.

- Fn+Up (PageUp): enter history and scroll up a quarter of the pane height (at least one line); subsequent presses also move a quarter of the pane height (at least one line).
- Fn+Down (PageDown), while in history: scroll down a quarter of the pane height (at least one line), exit at the bottom.
- Escape or q, while in history: immediately return to the live pane.

Exiting copy-mode discards the history cursor and returns keyboard input to the
underlying application. If Pi was waiting for a prompt, typing continues there.
This does not dismiss Pi dialogs, interrupt running tools, or force editor focus
when Pi itself is showing a modal. No keystroke is injected into Pi on exit.

Ctrl+O in Pi 0.87.1 invokes toggleToolOutputExpansion/setToolsExpanded and loops
over all expandable children. The supported extension UI API likewise exposes
only getToolsExpanded/setToolsExpanded. A tmux history cursor has no mapping to
Pi tool components. Expanding a specific tool under that cursor is not implemented;
it requires application-level navigation and per-component expansion in Pi.
Return with Escape before using Pi's existing global Ctrl+O.

Verified against the installed tmux 3.7c manual (copy-mode -e,
scroll-up and scroll-down-and-cancel with a repeat count). Installer tested with a temporary home and simulated tmux;
live input behavior awaits application on the user's terminal.
