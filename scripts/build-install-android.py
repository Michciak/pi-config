#!/usr/bin/env python3
"""Build a signed Pi Remote release APK and install it through adb."""

import os
import subprocess
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
android = repo / "apps/android"
google = android / "app/google-services.json"
if not google.exists():
    raise SystemExit(f"Missing {google}; download it for pl.michalkozinski.piremote from Firebase.")
runtime = Path(os.environ.get("PI_WEB_RUNTIME_DIR", Path.home() / ".pi/agent/web-control"))
keystore = Path(os.environ.get("PI_REMOTE_KEYSTORE", runtime / "android/pi-remote.keystore")).expanduser()
if not keystore.exists():
    raise SystemExit("Signing key is missing. Run scripts/configure-android-signing.py first.")

def secret(service: str) -> str:
    return subprocess.check_output(["/usr/bin/security", "find-generic-password", "-s", service, "-w"], text=True).strip()

env = os.environ.copy()
env.update({
    "PI_REMOTE_KEYSTORE": str(keystore),
    "PI_REMOTE_STORE_PASSWORD": secret("pi-remote.store-password"),
    "PI_REMOTE_KEY_PASSWORD": secret("pi-remote.key-password"),
    "PI_REMOTE_KEY_ALIAS": "pi-remote",
})
subprocess.run([str(android / "gradlew"), "--no-daemon", "assembleRelease"], cwd=android, env=env, check=True)
apk = android / "app/build/outputs/apk/release/app-release.apk"
if not apk.exists():
    raise SystemExit(f"Gradle completed but APK is missing: {apk}")
subprocess.run(["adb", "install", "-r", str(apk)], check=True)
print(f"Installed signed APK: {apk}")
