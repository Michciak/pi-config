#!/usr/bin/env python3
"""Install versioned Pi web extensions and generate the per-user LaunchAgent."""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
import os
import plistlib
import shutil
import subprocess
import sys
import urllib.request
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
    release_source = REPO / ".releases/latest"
    if not release_source.is_dir():
        raise SystemExit("Versioned release missing; run npm run build:release first.")
    required = [
        release_source / "apps/control/dist/index.js",
        release_source / "apps/web/dist/index.html",
        REPO / "packages/prompt-snippets/dist/index.js",
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise SystemExit("Build artifacts are missing:\n- " + "\n- ".join(missing))

    node = shutil.which("node")
    if not node:raise SystemExit("node is not available on PATH")
    workspace = Path(os.environ.get("PI_WEB_WORKSPACE_ROOT", HOME / "Library/CloudStorage/Dropbox/NETRIX")).resolve()
    if not workspace.is_dir():raise SystemExit(f"Workspace root does not exist: {workspace}")
    try:
        with urllib.request.urlopen("http://127.0.0.1:3784/api/v1/status",timeout=3) as response:status=json.load(response)
    except OSError:status=None
    if status and any(item.get("status") in ["running","waiting"] for item in status.get("sessions",[])):
        raise SystemExit("Pause or finish active agent sessions before deployment.")
    if status and status.get("engine")=="running":
        request=urllib.request.Request("http://127.0.0.1:3784/api/v1/engine/stop",data=b"{}",headers={"Content-Type":"application/json"},method="POST")
        urllib.request.urlopen(request,timeout=30).close()

    stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_root = PI_AGENT / f"backups/pi-web-control-{stamp}"
    backup_root.mkdir(parents=True, exist_ok=True,mode=0o700)
    for relative in ["settings.json", "models.json", "auth.json", "pi-goal.json", "pi-goal-state.json", "extensions"]:
        source = PI_AGENT / relative
        if source.is_dir():
            shutil.copytree(source, backup_root / relative, symlinks=True)
        elif source.exists():
            shutil.copy2(source, backup_root / relative)
    if (RUNTIME / "state.sqlite").exists():
        with sqlite3.connect(RUNTIME / "state.sqlite") as source, sqlite3.connect(backup_root / "state.sqlite") as destination:
            source.backup(destination)
    # Capture global extension preferences, preserving absent files.
    workflow_settings = HOME / ".pi/workflows/settings.json"
    if workflow_settings.exists():
        shutil.copy2(workflow_settings, backup_root / "workflow-settings.json")
    todo_settings=Path(os.environ.get("XDG_CONFIG_HOME",HOME/".config"))/"rpiv-todo/config.json"
    if todo_settings.exists():shutil.copy2(todo_settings,backup_root/"todo-config.json")
    installed = PI_AGENT / "npm"
    if installed.exists():
        shutil.copytree(installed, backup_root / "npm", symlinks=True)
    # Pi 1.0 provides typebox through its extension loader. The goal package
    # mistakenly declares it twice; retain its existing peer, remove only the
    # redundant declaration (the full npm tree above is recoverable).
    goal_manifest = installed / "node_modules/@schovest/pi-goal/package.json"
    if goal_manifest.exists():
        manifest = json.loads(goal_manifest.read_text())
        if manifest.get("version") != "0.2.0":
            raise SystemExit("Unsupported pi-goal version; review typebox compatibility before deployment.")
        if manifest.get("peerDependencies", {}).get("typebox") != "*":
            raise SystemExit("pi-goal typebox peer missing; refusing unsafe manifest patch.")
        manifest.get("dependencies", {}).pop("typebox", None)
        goal_manifest.write_text(json.dumps(manifest, indent=2) + "\n")
    # Expose the existing ACP fleet only in Pi Remote; terminal Pi is unchanged.
    acp_entry = installed / "node_modules/billion-context/dist/agent/pi-native.js"
    if acp_entry.exists():
        subprocess.check_call(["node", str(REPO / "scripts/acp-remote-patch.mjs"), str(acp_entry)])
    todo_entry = installed / "node_modules/@juicesharp/rpiv-todo"
    if todo_entry.exists():
        subprocess.check_call(["node", str(REPO / "scripts/todo-remote-patch.mjs"), str(todo_entry)])
    subprocess.check_call([sys.executable, str(REPO / "scripts/patch-cursor-thinking.py"), str(PI_AGENT), str(backup_root)])
    assets = [
        (REPO / "extensions/remote-integrations.ts", PI_AGENT / "extensions/remote-integrations.ts"),
        (REPO / "extensions/shared/acp-runs.ts", PI_AGENT / "extensions/shared/acp-runs.ts"),
        (REPO / "extensions/shared/work-state.ts", PI_AGENT / "extensions/shared/work-state.ts"),
        (REPO / "extensions/remote-metrics.ts", PI_AGENT / "extensions/remote-metrics.ts"),
        (REPO / "extensions/ask-user-question.ts", PI_AGENT / "extensions/ask-user-question.ts"),
        (REPO / "extensions/shared/ask-user-question-contract.ts", PI_AGENT / "extensions/shared/ask-user-question-contract.ts"),
        (REPO / "extensions/bash-guard/index.ts", PI_AGENT / "extensions/bash-guard/index.ts"),
        (REPO / "extensions/interactive-subagents/index.ts", PI_AGENT / "extensions/interactive-subagents/index.ts"),
        (REPO / "extensions/interactive-subagents/rpc-backend.ts", PI_AGENT / "extensions/interactive-subagents/rpc-backend.ts"),
        (REPO / "extensions/interactive-subagents/routing.ts", PI_AGENT / "extensions/interactive-subagents/routing.ts"),
        (REPO / "extensions/interactive-subagents/settlement.ts", PI_AGENT / "extensions/interactive-subagents/settlement.ts"),
        (REPO / "extensions/prompt-snippets", PI_AGENT / "extensions/prompt-snippets"),
        (REPO / "packages/prompt-snippets", PI_AGENT / "node_modules/@pi-local/prompt-snippets"),
    ]
    for source, target in assets:
        # The complete extensions backup above already contains these paths.
        backup_and_copy(source, target, backup_root / "replaced")
    stale_contract = PI_AGENT / "extensions/ask-user-question-contract.ts"
    if stale_contract.exists():
        shutil.copy2(stale_contract, backup_root / "ask-user-question-contract.ts")
        stale_contract.unlink()

    RUNTIME.mkdir(parents=True, exist_ok=True, mode=0o700)
    (RUNTIME / "sessions").mkdir(parents=True, exist_ok=True, mode=0o700)
    LAUNCH_AGENT.parent.mkdir(parents=True, exist_ok=True)
    if LAUNCH_AGENT.exists():
        shutil.copy2(LAUNCH_AGENT, backup_root / "pl.michalkozinski.pi-control.plist")
    goal_path = PI_AGENT / "pi-goal.json"
    goal = json.loads(goal_path.read_text()) if goal_path.exists() else {}
    goal["rpc"] = {**goal.get("rpc", {}), "enabled": True}
    goal["continuationLimits"] = {**goal.get("continuationLimits", {}), "automaticTurns": 25, "noProgressTurns": 3}
    temporary_goal = goal_path.with_suffix(".json.next")
    temporary_goal.write_text(json.dumps(goal, indent=2) + "\n")
    temporary_goal.chmod(0o600)
    temporary_goal.replace(goal_path)

    release_version = json.loads((release_source / "release.json").read_text())["version"]
    release_target = RUNTIME / "releases" / release_version
    release_target.parent.mkdir(parents=True, exist_ok=True)
    if not release_target.exists():
        shutil.copytree(release_source.resolve(), release_target, symlinks=True)
    current = RUNTIME / "current"
    if current.is_symlink():
        (backup_root / "previous-release.txt").write_text(str(current.resolve()) + "\n")
    temporary_link = RUNTIME / "current.next"
    temporary_link.unlink(missing_ok=True)
    temporary_link.symlink_to(release_target, target_is_directory=True)
    temporary_link.replace(current)

    node = shutil.which("node")
    if not node:
        raise SystemExit("node is not available on PATH")
    workspace = Path(os.environ.get("PI_WEB_WORKSPACE_ROOT", HOME / "Library/CloudStorage/Dropbox/NETRIX")).resolve()
    if not workspace.is_dir():
        raise SystemExit(f"Workspace root does not exist: {workspace}")
    path = ":".join(dict.fromkeys([str(Path(node).parent), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]))
    plist = {
        "Label": "pl.michalkozinski.pi-control",
        "ProgramArguments": [node, str(current / "apps/control/dist/index.js")],
        "WorkingDirectory": str(current),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 5,
        "ProcessType": "Background",
        "Umask": 0o077,
        "EnvironmentVariables": {
            "PATH": path,
            "PI_WEB_RUNTIME_DIR": str(RUNTIME),
            "PI_WEB_WORKSPACE_ROOT": str(workspace),
            "PI_WEB_ASSETS": str(current / "apps/web/dist"),
            "PI_WEB_BUILD_VERSION": release_version,
            "PI_WEB_FIREBASE_KEYCHAIN_SERVICE": "pi-web.firebase-admin",
        },
        "StandardOutPath": str(RUNTIME / "control.stdout.log"),
        "StandardErrorPath": str(RUNTIME / "control.stderr.log"),
    }
    temporary_plist = LAUNCH_AGENT.with_suffix(".plist.next")
    with temporary_plist.open("wb") as handle:
        plistlib.dump(plist, handle, sort_keys=False)
    temporary_plist.replace(LAUNCH_AGENT)
    LAUNCH_AGENT.chmod(0o600)
    print(f"Installed runtime assets. Backup: {backup_root}")
    print(f"LaunchAgent: {LAUNCH_AGENT}")


if __name__ == "__main__":
    main()
