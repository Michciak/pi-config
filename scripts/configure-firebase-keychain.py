#!/usr/bin/env python3
"""Validate a Firebase Admin service account and store it in macOS Keychain."""

import json
import subprocess
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit(f"Usage: {Path(sys.argv[0]).name} /path/to/firebase-service-account.json")
source = Path(sys.argv[1]).expanduser().resolve()
payload = source.read_text(encoding="utf-8")
parsed = json.loads(payload)
if parsed.get("type") != "service_account" or not parsed.get("project_id") or not parsed.get("private_key"):
    raise SystemExit("The file is not a Firebase service-account JSON document")
subprocess.run([
    "/usr/bin/security", "add-generic-password", "-U", "-a", "pi-web-control",
    "-s", "pi-web.firebase-admin", "-w", payload,
], check=True, stdout=subprocess.DEVNULL)
print(f"Stored Firebase Admin credentials for project {parsed['project_id']} in macOS Keychain.")
print("The source file was not copied. Restart Pi Control to enable FCM.")
