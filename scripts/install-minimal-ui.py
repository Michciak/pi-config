#!/usr/bin/env python3
"""Install the minimal UI additions on the known-good pi-baseline server."""
import argparse
import os
from datetime import datetime
from pathlib import Path
import shutil
import shlex
import subprocess
import tempfile


def clipboard_rollback(tmux):
    """Read version-correct defaults for only the bindings changed in b0f048b."""
    lines = []
    with tempfile.TemporaryDirectory(prefix="pi-clipboard-defaults-", dir="/tmp") as folder:
        socket = Path(folder) / "socket"
        clean = ["tmux", "-S", str(socket)]
        try:
            subprocess.run(clean + ["-f", "/dev/null", "new-session", "-d", "-s", "defaults", "exec /bin/sleep 60"], check=True)
            if not socket.exists():
                raise SystemExit("Cannot obtain tmux defaults; no runtime files changed.")
            for option in ("extended-keys", "extended-keys-format"):
                value = subprocess.check_output(clean + ["show-options", "-s", option], text=True).strip()
                lines.append("set-option -s " + value)
            for table, keys in (("prefix", ["v"]), ("copy-mode", ["v", "y", "MouseDragEnd1Pane"]), ("copy-mode-vi", ["v", "y", "MouseDragEnd1Pane"])):
                for key in keys:
                    lines.append(f"unbind-key -q -T {table} {key}")
                    result = subprocess.run(clean + ["list-keys", "-T", table, key], capture_output=True, text=True)
                    if result.returncode == 0:
                        lines.append(result.stdout.strip())
        finally:
            subprocess.run(clean + ["kill-server"], capture_output=True)
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--rollback-clipboard", action="store_true")
    parser.add_argument("--warp-clipboard", action="store_true")
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument("--server", default="pi-baseline")
    selection.add_argument("--current", action="store_true", help="Apply to the tmux server of this shell")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    agent = Path.home() / ".pi/agent"
    warp_keys = Path.home() / ".warp/keybindings.yaml"
    warp_source = root / "warp/keybindings.yaml"
    if args.warp_clipboard and warp_keys.exists() and warp_keys.read_bytes() != warp_source.read_bytes():
        raise SystemExit("Existing Warp keybindings preserved. Set Copy/Paste shortcuts in Warp Settings; no runtime files changed.")
    tmux = ["tmux", "-L", args.server]
    selected = args.server
    if args.current:
        context = os.environ.get("TMUX", "").rsplit(",", 2)
        if len(context) != 3 or not context[0] or not all(part.isdigit() for part in context[1:]):
            raise SystemExit("Run --current from a shell inside the working tmux session (Ctrl+b, then c). No runtime files changed.")
        selected = context[0]
        tmux = ["tmux", "-S", selected]
    # Read-only preflight; do not touch the user's other (formerly broken) server.
    probe = subprocess.run(tmux + ["list-sessions"], capture_output=True, text=True)
    if probe.returncode or not probe.stdout.strip():
        raise SystemExit(f"tmux server {selected!r} is not accessible. Use --current inside the working tmux session, or --server NAME. No runtime files changed.\n{probe.stderr.strip()}")
    backup = agent / "backups" / ("minimal-ui-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
    rollback = clipboard_rollback(tmux) if args.rollback_clipboard else None
    if rollback:
        backup.mkdir(parents=True, exist_ok=True, mode=0o700)
        (backup / "previous-bindings.conf").write_text(subprocess.check_output(tmux + ["list-keys"], text=True))
        (backup / "previous-server-options.conf").write_text(subprocess.check_output(tmux + ["show-options", "-s"], text=True))
    files = [(root / "tmux/tmux.conf", Path.home() / ".tmux.conf", "tmux.conf"),
             (root / "extensions/file-links.ts", agent / "extensions/file-links.ts", "file-links.ts"),
             (root / "extensions/interactive-subagents/index.ts", agent / "extensions/interactive-subagents/index.ts", "subagents-index.ts")]
    if args.warp_clipboard:
        files.append((warp_source, warp_keys, "warp-keybindings.yaml"))
    for source, target, name in files:
        if target.exists() and target.read_bytes() == source.read_bytes():
            continue
        backup.mkdir(parents=True, exist_ok=True, mode=0o700)
        if target.exists():
            shutil.copy2(target, backup / name)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        print("Installed", target)
    if rollback:
        restore = backup / "undo-clipboard.conf"
        restore.write_text(rollback)
        subprocess.run(tmux + ["source-file", str(restore)], check=True)
        helper = agent / "bin/tmux-paste.sh"
        if helper.exists():
            shutil.move(str(helper), str(backup / "tmux-paste.sh"))
        print("Undid clipboard bindings and extended-key changes. Restart Pi to renegotiate keyboard input.")
    subprocess.run(tmux + ["source-file", str(Path.home() / ".tmux.conf")], check=True)
    print("Applied to", selected, "without changing keyboard protocol or bindings.")
    if backup.exists():
        print("Backup:", backup)
    print("Mouse disabled in tmux. Scroll: Ctrl+b then [, arrows/PageUp/PageDown, q to return before pasting.")
    if args.warp_clipboard:
        print("Restart Warp to load Cmd+Shift+C / Cmd+Shift+V. Copy Command moves to Cmd+Option+C.")
        print("After restarting Warp, reattach with:", shlex.join(tmux + ["attach-session"]))
    print("In Pi: /reload loads file links and refreshes hyperlink capability detection.")


if __name__ == "__main__":
    main()
