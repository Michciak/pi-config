#!/usr/bin/env python3
"""Install the minimal UI additions on the known-good pi-baseline server."""
import argparse
from datetime import datetime
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", default="pi-baseline")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    agent = Path.home() / ".pi/agent"
    tmux = ["tmux", "-L", args.server]
    # Read-only preflight; do not touch the user's other (formerly broken) server.
    probe = subprocess.run(tmux + ["list-sessions"], capture_output=True, text=True)
    if probe.returncode or not probe.stdout.strip():
        raise SystemExit("The clean tmux server is not accessible. Keep the working pi-baseline session open. No files changed.")
    backup = agent / "backups" / ("minimal-ui-" + datetime.now().strftime("%Y%m%d-%H%M%S-%f"))
    files = [(root / "tmux/tmux.conf", Path.home() / ".tmux.conf", "tmux.conf"),
             (root / "extensions/file-links.ts", agent / "extensions/file-links.ts", "file-links.ts"),
             (root / "extensions/interactive-subagents/index.ts", agent / "extensions/interactive-subagents/index.ts", "subagents-index.ts")]
    for source, target, name in files:
        if target.exists() and target.read_bytes() == source.read_bytes():
            continue
        backup.mkdir(parents=True, exist_ok=True, mode=0o700)
        if target.exists():
            shutil.copy2(target, backup / name)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        print("Installed", target)
    subprocess.run(tmux + ["source-file", str(Path.home() / ".tmux.conf")], check=True)
    print("Applied to", args.server, "without changing keyboard protocol or bindings.")
    if backup.exists():
        print("Backup:", backup)
    print("In Warp: choose Rider as the file-link editor; enable mouse + scroll reporting.")
    print("In Pi: /reload loads file links and refreshes hyperlink capability detection.")


if __name__ == "__main__":
    main()
