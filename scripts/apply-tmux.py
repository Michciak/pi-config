#!/usr/bin/env python3
"""Install only the tmux configuration/helper, back up changes, reload live server."""
import argparse
from datetime import datetime
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def apply(reload_server=True):
    root = Path(__file__).resolve().parents[1]
    agent = Path(os.environ.get("PI_AGENT_DIR", str(Path.home() / ".pi/agent")))
    config = Path(os.environ.get("TMUX_CONFIG_FILE", str(Path.home() / ".tmux.conf")))
    changes = [(root / "tmux/tmux.conf", config, "tmux.conf"),
               (root / "scripts/tmux-paste.py", agent / "tmux/paste.py", "paste.py")]
    backup = None
    for source, target, name in changes:
        if target.exists() and source.read_bytes() == target.read_bytes():
            continue
        if backup is None:
            backup = agent / "backups" / ("pi-tmux-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
            backup.mkdir(parents=True, mode=0o700)
        if target.exists():
            shutil.copy2(target, backup / name)
        target.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".pi-tmux-", delete=False) as pending:
            pending.write(source.read_bytes())
            pending_path = Path(pending.name)
        pending_path.replace(target)
        print(f"Installed {target}")
    if backup:
        print(f"Backup: {backup}")
    else:
        print("Tmux files already synchronized.")
    if not reload_server:
        return

    command = ["tmux"]
    # Running inside tmux must address the same server, even with a custom socket.
    if os.environ.get("TMUX"):
        command += ["-S", os.environ["TMUX"].rsplit(",", 2)[0]]
    server = subprocess.run(command + ["list-sessions"], capture_output=True)
    if server.returncode:
        print("No accessible tmux server; the new configuration will load at next start.")
        return
    subprocess.run(command + ["source-file", str(config)], check=True)
    mouse = subprocess.check_output(command + ["show-options", "-gqv", "mouse"]).decode().strip()
    if mouse != "on":
        raise RuntimeError("Tmux mouse option did not load")
    print("Live tmux configuration reloaded. Press Esc once in any old copy-mode pane.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-reload", action="store_true")
    args = parser.parse_args()
    apply(not args.no_reload)
