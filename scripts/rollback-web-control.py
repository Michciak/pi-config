#!/usr/bin/env python3
"""Restore a named installation backup, preserving all new session history."""
from __future__ import annotations
import argparse
import json
import os
import shutil
import subprocess
import urllib.request
from pathlib import Path

def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument("backup",type=Path)
    args=parser.parse_args()
    agent=Path.home()/".pi/agent"
    backup=args.backup.resolve()
    root=(agent/"backups").resolve()
    if backup.parent!=root or not backup.name.startswith("pi-web-control-") or not (backup/"pl.michalkozinski.pi-control.plist").is_file():
        raise SystemExit("Choose an existing pi-web-control installation backup.")
    runtime=agent/"web-control"
    previous=backup/"previous-release.txt"
    release=None
    if previous.exists():
        release=Path(previous.read_text().strip()).resolve()
        if release.parent!=(runtime/"releases").resolve() or not release.is_dir():raise SystemExit("Previous release is unavailable; no files changed")
    request=urllib.request.Request("http://127.0.0.1:3784/api/v1/engine/stop",data=b"{}",headers={"Content-Type":"application/json"},method="POST")
    try: urllib.request.urlopen(request,timeout=30).close()
    except OSError: pass
    # Keep the replaced installation recoverable too; never discard session files.
    displaced=backup/"rollback-displaced"
    displaced.mkdir(exist_ok=False)
    for name in ["extensions","npm","settings.json","pi-goal.json"]:
        target=agent/name
        if target.exists(): shutil.move(str(target),displaced/name)
        saved=backup/name
        if saved.is_dir():shutil.copytree(saved,target,symlinks=True)
        elif saved.exists():shutil.copy2(saved,target)
    if release:
        temporary=runtime/"current.rollback"
        temporary.symlink_to(release,target_is_directory=True)
        temporary.replace(runtime/"current")
    plist=Path.home()/"Library/LaunchAgents/pl.michalkozinski.pi-control.plist"
    temporary=plist.with_suffix(".plist.rollback")
    shutil.copy2(backup/plist.name,temporary);temporary.replace(plist)
    subprocess.run(["launchctl","bootout",f"gui/{os.getuid()}/pl.michalkozinski.pi-control"],check=False)
    subprocess.check_call(["python3",str(Path(__file__).with_name("restart-web-control.py")),"--start-engine"])
    print("Previous runtime and extension configuration restored; SQLite and sessions retained.")
    print(f"Replaced files are recoverable at {displaced}")

if __name__=="__main__":main()
