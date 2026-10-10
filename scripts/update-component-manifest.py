#!/usr/bin/env python3
"""Refresh hashes for tracked source components without adding secrets or build output."""

import datetime as dt
import hashlib
import json
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
path = repo / "docs/component-manifest.json"
manifest = json.loads(path.read_text(encoding="utf-8"))
manifest["generated"] = dt.date.today().isoformat()
manifest.setdefault("sources", {})["ask-user-question-local"] = "~/.pi/agent/extensions/ask-user-question.ts (copied 2026-09-28)"
existing = {item["path"]: item for item in manifest["components"]}
for relative in (
    "extensions/ask-user-question.ts",
    "extensions/shared/ask-user-question-contract.ts",
    "extensions/interactive-subagents/rpc-backend.ts",
):
    existing.setdefault(relative, {"path": relative})
stale = "extensions/ask-user-question-contract.ts"
if stale in existing and not (repo / stale).is_file():
    del existing[stale]
for relative, item in existing.items():
    source = repo / relative
    if not source.is_file():
        continue
    content = source.read_bytes()
    item["sha256"] = hashlib.sha256(content).hexdigest()
    item["bytes"] = len(content)
manifest["components"] = sorted(existing.values(), key=lambda item: item["path"])
path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
