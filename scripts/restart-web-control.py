#!/usr/bin/env python3
"""Restart Pi Control without leaving it offline when launchctl returns EIO."""

from __future__ import annotations

import argparse
import json
import os
import plistlib
import signal
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

HOME = Path.home()
LABEL = "pl.michalkozinski.pi-control"
DOMAIN = f"gui/{os.getuid()}"
TARGET = f"{DOMAIN}/{LABEL}"
PLIST = HOME / f"Library/LaunchAgents/{LABEL}.plist"
STATUS_URL = "http://127.0.0.1:3784/api/v1/status"


def read_status() -> dict | None:
    try:
        with urllib.request.urlopen(STATUS_URL, timeout=2) as response:
            return json.load(response)
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return None


def post(path: str) -> dict:
    request = urllib.request.Request(
        f"http://127.0.0.1:3784/api/v1{path}", data=b"{}",
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def wait_for_service(timeout: float = 60) -> dict:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    next_notice = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(STATUS_URL, timeout=2) as response:
                return json.load(response)
        except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
            last_error = error
            if time.monotonic() >= next_notice:
                print("Waiting for Control Service to become ready…", flush=True)
                next_notice = time.monotonic() + 10
            time.sleep(0.25)
    raise RuntimeError(
        f"Control Service did not become ready within {timeout:g}s: {last_error}. "
        f"Check {HOME / '.pi/agent/web-control/control.stderr.log'} and control.stdout.log. "
        "The service may still be starting; this does not stop it."
    )


def loaded() -> bool:
    return subprocess.run(
        ["launchctl", "print", TARGET], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode == 0


def stop_detached(runtime: Path) -> None:
    pid_file = runtime / "detached.pid"
    if not pid_file.exists():
        return
    try:
        pid = int(pid_file.read_text().strip())
        os.kill(pid, signal.SIGTERM)
        for _ in range(20):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.1)
    except (OSError, ValueError):
        pass
    pid_file.unlink(missing_ok=True)


def start_detached() -> int:
    with PLIST.open("rb") as handle:
        config = plistlib.load(handle)
    arguments = [str(value) for value in config["ProgramArguments"]]
    environment = os.environ.copy()
    environment.update({str(key): str(value) for key, value in config.get("EnvironmentVariables", {}).items()})
    runtime = Path(environment["PI_WEB_RUNTIME_DIR"])
    runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
    stop_detached(runtime)
    stdout = open(config["StandardOutPath"], "ab", buffering=0)
    stderr = open(config["StandardErrorPath"], "ab", buffering=0)
    process = subprocess.Popen(
        arguments,
        cwd=config.get("WorkingDirectory") or None,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=stdout,
        stderr=stderr,
        start_new_session=True,
        close_fds=True,
    )
    (runtime / "detached.pid").write_text(f"{process.pid}\n")
    return process.pid


def restart_service() -> str:
    if loaded():
        # kickstart retains launchd's cached ProgramArguments after a release switch.
        subprocess.check_call(["launchctl", "bootout", TARGET])

    with PLIST.open("rb") as handle:
        config = plistlib.load(handle)
    runtime = Path(config["EnvironmentVariables"]["PI_WEB_RUNTIME_DIR"])
    stop_detached(runtime)

    subprocess.run(["launchctl", "enable", TARGET], check=False)
    for attempt in range(3):
        result = subprocess.run(
            ["launchctl", "bootstrap", DOMAIN, str(PLIST)],
            text=True, capture_output=True,
        )
        if result.returncode == 0:
            # Verify the registration, not merely launchctl's exit status. Some
            # execution environments acknowledge bootstrap without retaining it.
            for _ in range(10):
                if loaded():break
                time.sleep(0.2)
        if loaded():
            # RunAtLoad already starts the new registration. An immediate -k can
            # interrupt its initialization and race the interaction socket binding.
            return "launchd"
        if attempt < 2:
            time.sleep(0.75 * (attempt + 1))

    pid = start_detached()
    print(f"LaunchAgent registration could not be verified; started detached fallback process {pid}.")
    print("The LaunchAgent remains installed and macOS will retry it at the next login.")
    return "detached"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-engine", action="store_true", help="start Pi Engine after Control Service is healthy")
    args = parser.parse_args()
    if not PLIST.is_file():
        raise SystemExit(f"LaunchAgent not found: {PLIST}")

    previous = read_status()
    should_start_engine = args.start_engine or (previous is not None and previous.get("engine") == "running")
    mode = restart_service()
    try:
        status = wait_for_service()
    except RuntimeError as error:
        raise SystemExit(str(error)) from None
    if should_start_engine and status.get("engine") != "running":
        post("/engine/start")
        status = wait_for_service()
    print(f"Control Service: {status.get('control')} ({mode})")
    print(f"Pi Engine: {status.get('engine')}")


if __name__ == "__main__":
    main()
