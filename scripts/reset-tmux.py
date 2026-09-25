#!/usr/bin/env python3
"""Undo this project's tmux customizations without stopping existing sessions."""
from datetime import datetime
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

KEYS = {
    "root": "C-v M-Up M-Down WheelUpPane WheelDownPane".split(),
    "prefix": "P Escape r".split(),
    "copy-mode-vi": "y Enter MouseDragEnd1Pane C-v M-Up M-Down WheelUpPane WheelDownPane Escape q".split(),
    "copy-mode": "Enter MouseDragEnd1Pane M-Up M-Down WheelUpPane WheelDownPane Escape q".split(),
}
OPTIONS = [("g", "mouse"), ("g", "history-limit"), ("gw", "xterm-keys"),
           ("s", "extended-keys"), ("s", "extended-keys-format"),
           ("gw", "mode-keys"), ("s", "set-clipboard"), ("s", "copy-command")]


def run(command, *args, check=True):
    return subprocess.run(command + list(args), capture_output=True, text=True, check=check, timeout=10)


def main():
    source = Path(__file__).resolve().parents[1] / "tmux/tmux.conf"
    target = Path.home() / ".tmux.conf"
    agent = Path.home() / ".pi/agent"
    live = ["tmux"]
    if os.environ.get("TMUX"):
        live += ["-S", os.environ["TMUX"].rsplit(",", 2)[0]]
    probe = run(live, "list-sessions", check=False)
    active = probe.returncode == 0
    if not active and any(word in probe.stderr.lower() for word in ("permission", "permitted")):
        raise RuntimeError("Access to the running tmux server is denied; no files changed.")

    # Obtain version-correct defaults only for settings/keys changed by us.
    # Do not reset unrelated bindings or kill/restart the user's tmux server.
    defaults, previous = [], []
    if active:
        with tempfile.TemporaryDirectory(prefix="pi-tmux-defaults-", dir="/tmp") as folder:
            socket = Path(folder) / "socket"
            clean = ["tmux", "-S", str(socket)]
            try:
                start = run(clean, "-f", "/dev/null", "new-session", "-d", "-s", "defaults", "exec /bin/sleep 60", check=False)
                if start.returncode or not socket.exists():
                    raise RuntimeError("Cannot read isolated tmux defaults; no files changed. " + start.stderr.strip())
                for flags, option in OPTIONS:
                    defaults.append("set-option -" + flags + " " + run(clean, "show-options", "-" + flags, option).stdout.strip())
                    previous.append("set-option -" + flags + " " + run(live, "show-options", "-" + flags, option).stdout.strip())
                for table, keys in KEYS.items():
                    for key in keys:
                        clear = f"unbind-key -q -T {table} {key}"
                        defaults.append(clear)
                        previous.append(clear)
                        original = run(clean, "list-keys", "-T", table, key, check=False)
                        current = run(live, "list-keys", "-T", table, key, check=False)
                        if original.returncode == 0:
                            defaults.append(original.stdout.strip())
                        if current.returncode == 0:
                            previous.append(current.stdout.strip())
            finally:
                run(clean, "kill-server", check=False)

    backup = agent / "backups" / ("tmux-reset-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
    backup.mkdir(parents=True, mode=0o700)
    if target.exists():
        shutil.copy2(target, backup / "tmux.conf")
    if active:
        (backup / "restore-live.conf").write_text("\n".join(previous) + "\n")
        reset_file = backup / "defaults.conf"
        reset_file.write_text("\n".join(defaults) + "\n")
        try:
            run(live, "source-file", str(reset_file))
        except subprocess.CalledProcessError:
            run(live, "source-file", str(backup / "restore-live.conf"), check=False)
            raise
        # Only exit copy-mode; do not dismiss other application menus.
        panes = run(live, "list-panes", "-a", "-F", "#{pane_id} #{pane_mode}").stdout.splitlines()
        for line in panes:
            fields = line.split()
            if len(fields) == 2 and fields[1] == "copy-mode":
                run(live, "send-keys", "-t", fields[0], "-X", "cancel")
        if run(live, "show-options", "-gqv", "mouse").stdout.strip() != "off":
            raise RuntimeError("Mouse default was not restored; backup: " + str(backup))
    shutil.copyfile(source, target)
    target.chmod(0o600)
    helper = agent / "tmux/paste.py"
    if helper.exists():
        shutil.move(str(helper), str(backup / "paste.py"))
    print("Restored standard tmux settings and key bindings; existing Pi sessions retained.")
    print("Backup:", backup)


if __name__ == "__main__":
    main()
