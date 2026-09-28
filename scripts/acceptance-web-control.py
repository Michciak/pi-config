#!/usr/bin/env python3
"""Run a non-generating smoke test against the installed Pi Control service."""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path


def request(base: str, path: str, method: str = "GET", body: dict | None = None) -> dict | list:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{base}{path}", data=data, method=method,
        headers={"content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path}: HTTP {error.code}: {detail}") from error


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3784")
    parser.add_argument("--workspace", default=str(Path.home() / "Library/CloudStorage/Dropbox/NETRIX"))
    args = parser.parse_args()

    status = request(args.base_url, "/api/v1/status")
    assert isinstance(status, dict) and status.get("control") == "online", "Control Service is not online"
    engine_was_running = status.get("engine") == "running"
    session_id: str | None = None
    try:
        if not engine_was_running:
            request(args.base_url, "/api/v1/engine/start", "POST")
        created = request(args.base_url, "/api/v1/sessions", "POST", {
            "workspace": str(Path(args.workspace).expanduser().resolve()),
            "name": "Acceptance smoke test",
        })
        assert isinstance(created, dict) and isinstance(created.get("id"), str)
        session_id = created["id"]
        results: dict[str, object] = {}
        for command in ("get_state", "get_available_models", "get_commands", "get_session_stats"):
            response = request(args.base_url, f"/api/v1/sessions/{session_id}/commands", "POST", {
                "command": command, "payload": {},
            })
            assert isinstance(response, dict) and "result" in response
            results[command] = response["result"]
        assert isinstance(results["get_available_models"], list), "Pi returned no model list"
        assert isinstance(results["get_commands"], list), "Pi returned no command list"
        print(f"OK Control Service: {status['serverId']}")
        print(f"OK Pi RPC session: {session_id}")
        print(f"OK models: {len(results['get_available_models'])}")
        print(f"OK dynamic commands: {len(results['get_commands'])}")
        print("No model prompt was sent and no provider request was made.")
    finally:
        if session_id:
            try:
                request(args.base_url, f"/api/v1/sessions/{session_id}/stop", "POST")
            except Exception as error:  # cleanup must not hide the primary result
                print(f"WARN failed to stop smoke-test session: {error}")
        if not engine_was_running:
            try:
                request(args.base_url, "/api/v1/engine/stop", "POST")
            except Exception as error:
                print(f"WARN failed to restore stopped Engine state: {error}")


if __name__ == "__main__":
    main()
