#!/usr/bin/env python3
"""Report enabled model patterns that do not match Pi's current catalog."""
from __future__ import annotations
import fnmatch, json, os, re, subprocess, sys
from pathlib import Path
settings = Path(os.environ.get("PI_SETTINGS", str(Path.home()/".pi/agent/settings.json")))
data = json.loads(settings.read_text()); patterns = data.get("enabledModels", [])
proc = subprocess.run(["pi", "--list-models"], text=True, capture_output=True, check=False)
models = []
for line in proc.stdout.splitlines():
    m = re.match(r"^(\S+)\s+(\S+)\s+", line)
    if m and m.group(1) not in {"provider", "---"}: models.append(f"{m.group(1)}/{m.group(2)}")
print(f"settings: {settings}"); print(f"patterns: {len(patterns)}"); print(f"catalog entries: {len(models)}")
if not models:
    print("UNAVAILABLE Pi model catalog could not be read; no patterns were classified")
    sys.exit(2)
unknown = []
for pattern in patterns:
    matches = [m for m in models if fnmatch.fnmatchcase(m, pattern)]
    if matches: print(f"OK   {pattern} ({len(matches)} matches)")
    else: unknown.append(pattern); print(f"MISS {pattern}")
if proc.returncode: print(f"NOTE pi --list-models exit={proc.returncode}; catalog may be incomplete", file=sys.stderr)
print(f"unmatched: {len(unknown)}")
sys.exit(1 if unknown else 0)
