#!/usr/bin/env python3
"""Create the private APK signing key outside the repository and save passwords in Keychain."""

import getpass
import os
import secrets
import string
import subprocess
from pathlib import Path

runtime = Path(os.environ.get("PI_WEB_RUNTIME_DIR", Path.home() / ".pi/agent/web-control"))
keystore = Path(os.environ.get("PI_REMOTE_KEYSTORE", runtime / "android/pi-remote.keystore")).expanduser()
keystore.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
alphabet = string.ascii_letters + string.digits + "-_"
generated = "".join(secrets.choice(alphabet) for _ in range(32))
password = getpass.getpass("New keystore password (empty generates one): ") or generated
alias = "pi-remote"
if not keystore.exists():
    subprocess.run([
        "keytool", "-genkeypair", "-keystore", str(keystore), "-storepass", password,
        "-keypass", password, "-alias", alias, "-keyalg", "EC", "-groupname", "secp256r1",
        "-validity", "3650", "-dname", "CN=Pi Remote,O=Private,C=PL",
    ], check=True)
    keystore.chmod(0o600)
for service in ("pi-remote.store-password", "pi-remote.key-password"):
    subprocess.run(["/usr/bin/security", "add-generic-password", "-U", "-a", alias, "-s", service, "-w", password],
                   check=True, stdout=subprocess.DEVNULL)
print(f"Signing key: {keystore}")
print("Passwords were stored in macOS Keychain and were not written to the repository.")
