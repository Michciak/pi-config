#!/usr/bin/env python3
"""Install versioned Pi web extensions and generate the per-user LaunchAgent."""

from __future__ import annotations

import datetime as dt
import os
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HOME = Path.home()
PI_AGENT = Path(os.environ.get("PI_AGENT_DIR", HOME / ".pi/agent"))
RUNTIME = Path(os.environ.get("PI_WEB_RUNTIME_DIR", PI_AGENT / "web-control"))
LAUNCH_AGENT = HOME / "Library/LaunchAgents/pl.michalkozinski.pi-control.plist"


def backup_and_copy(source: Path, target: Path, backup_root: Path) -> None:
    relative = target.relative_to(PI_AGENT)
    backup = backup_root / relative
    if target.exists() or target.is_symlink():
        backup.parent.mkdir(parents=True, exist_ok=True)
        if target.is_dir():
            shutil.copytree(target, backup, dirs_exist_ok=True)
        else:
            shutil.copy2(target, backup)
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(source, target, dirs_exist_ok=True)
    else:
        shutil.copy2(source, target)


def main() -> None:
    required = [
        REPO / "apps/control/dist/index.js",
        REPO / "apps/web/dist/index.html",
        REPO / "packages/prompt-snippets/dist/index.js",
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise SystemExit("Build artifacts are missing:\n- " + "\n- ".join(missing))

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_root = PI_AGENT / f"backups/pi-web-control-{stamp}"
    backup_root.mkdir(parents=True, exist_ok=True)
    subprocess.check_call([sys.executable, str(REPO / "scripts/patch-cursor-thinking.py"), str(PI_AGENT), str(backup_root)])
    assets = [
        (REPO / "extensions/remote-metrics.ts", PI_AGENT / "extensions/remote-metrics.ts"),
        (REPO / "extensions/ask-user-question.ts", PI_AGENT / "extensions/ask-user-question.ts"),
        (REPO / "extensions/ask-user-question-contract.ts", PI_AGENT / "extensions/ask-user-question-contract.ts"),
        (REPO / "extensions/bash-guard/index.ts", PI_AGENT / "extensions/bash-guard/index.ts"),
        (REPO / "extensions/interactive-subagents/index.ts", PI_AGENT / "extensions/interactive-subagents/index.ts"),
        (REPO / "extensions/interactive-subagents/rpc-backend.ts", PI_AGENT / "extensions/interactive-subagents/rpc-backend.ts"),
        (REPO / "extensions/prompt-snippets", PI_AGENT / "extensions/prompt-snippets"),
        (REPO / "packages/prompt-snippets", PI_AGENT / "node_modules/@pi-local/prompt-snippets"),
    ]
    for source, target in assets:
        backup_and_copy(source, target, backup_root)

    RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
    (RUNTIME / "sessions").mkdir(parents=True, exist_ok=True, mode=0o700)
    LAUNCH_AGENT.parent.mkdir(parents=True, exist_ok=True)
    if LAUNCH_AGENT.exists():
        shutil.copy2(LAUNCH_AGENT, backup_root / "pl.michalkozinski.pi-control.plist")

    node = shutil.which("node")
    if not node:
        raise SystemExit("node is not available on PATH")
    workspace = Path(os.environ.get("PI_WEB_WORKSPACE_ROOT", HOME / "Library/CloudStorage/Dropbox/NETRIX")).resolve()
    if not workspace.is_dir():
        raise SystemExit(f"Workspace root does not exist: {workspace}")
    path = ":".join(dict.fromkeys([str(Path(node).parent), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]))
    plist = {
        "Label": "pl.michalkozinski.pi-control",
        "ProgramArguments": [node, str(REPO / "apps/control/dist/index.js")],
        "WorkingDirectory": str(REPO),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 5,
        "ProcessType": "Background",
        "Umask": 0o077,
        "EnvironmentVariables": {
            "PATH": path,
            "PI_WEB_RUNTIME_DIR": str(RUNTIME),
            "PI_WEB_WORKSPACE_ROOT": str(workspace),
            "PI_WEB_ASSETS": str(REPO / "apps/web/dist"),
            "PI_WEB_FIREBASE_KEYCHAIN_SERVICE": "pi-web.firebase-admin",
        },
        "StandardOutPath": str(RUNTIME / "control.stdout.log"),
        "StandardErrorPath": str(RUNTIME / "control.stderr.log"),
    }
    with LAUNCH_AGENT.open("wb") as handle:
        plistlib.dump(plist, handle, sort_keys=False)
    LAUNCH_AGENT.chmod(0o600)
    print(f"Installed runtime assets. Backup: {backup_root}")
    print(f"LaunchAgent: {LAUNCH_AGENT}")


if __name__ == "__main__":
    main()
