#!/usr/bin/env python3
"""Paste macOS text into one tmux pane; clipboard bytes never enter argv/logs."""
import re
import subprocess
import sys
import uuid


def paste(socket, pane, run=subprocess.run):
    if not re.fullmatch(r"%\d+", pane):
        raise ValueError("Expected a tmux pane id")
    buffer = "pi-paste-" + uuid.uuid4().hex

    def tmux(*args, **kwargs):
        return run(["tmux", "-S", socket, *args], check=True, capture_output=True, timeout=5, **kwargs)

    # A failed clipboard read must not paste the previous tmux buffer.
    data = run(["pbpaste"], check=True, capture_output=True, timeout=5).stdout
    if not data:
        return
    in_mode = tmux("display-message", "-p", "-t", pane, "#{pane_in_mode}").stdout.strip()
    if in_mode == b"1":
        tmux("send-keys", "-t", pane, "-X", "cancel")
    tmux("load-buffer", "-b", buffer, "-", input=data)
    try:
        # -p uses bracketed paste when Pi requests it; -r preserves newlines.
        # Do not emit Enter: the user submits the resulting prompt explicitly.
        tmux("paste-buffer", "-d", "-p", "-r", "-b", buffer, "-t", pane)
    finally:
        run(["tmux", "-S", socket, "delete-buffer", "-b", buffer], capture_output=True, timeout=5)


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("Usage: tmux-paste.py SOCKET PANE")
        paste(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, subprocess.SubprocessError):
        print("Paste failed; check macOS clipboard access and the target tmux pane.", file=sys.stderr)
        sys.exit(1)
