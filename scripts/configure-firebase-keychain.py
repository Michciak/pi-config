#!/usr/bin/env python3
"""Store Firebase Admin credentials without putting secrets in argv or logs."""
import json
import subprocess
import sys
from pathlib import Path

SERVICE = "pi-web.firebase-admin"
ACCOUNT = "pi-web-control"


def security_quote(value):
    # security -i has its own parser: backslashes are escapes even in quotes.
    if any(ch in value for ch in ('\n', '\r', '\0')):
        raise ValueError("Invalid command argument")
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def validate(payload):
    try:
        parsed = json.loads(payload)
    except (ValueError, TypeError):
        raise ValueError("Stored credentials are not valid JSON; import the service-account file again") from None
    if not isinstance(parsed, dict) or parsed.get('type') != 'service_account' or not all(
        isinstance(parsed.get(key), str) and parsed[key].strip()
        for key in ('project_id', 'client_email', 'private_key')
    ):
        raise ValueError("Expected a Firebase Admin service-account JSON file, not google-services.json")
    return parsed


def read_stored():
    result = subprocess.run([
        '/usr/bin/security', 'find-generic-password', '-s', SERVICE, '-a', ACCOUNT, '-w',
    ], capture_output=True, text=True)
    if result.returncode:
        raise ValueError("Cannot read Firebase Admin from Keychain. Run from Warp and allow the macOS Keychain prompt")
    return validate(result.stdout)


def store(parsed):
    payload = json.dumps(parsed, separators=(',', ':'), ensure_ascii=True)
    args = ['add-generic-password', '-U', '-a', ACCOUNT, '-s', SERVICE,
            '-T', '/usr/bin/security', '-w', payload]
    command = ' '.join(security_quote(arg) for arg in args) + '\n'
    # Apple's security interactive reader has a 4096-byte line buffer.
    if len(command.encode()) >= 4095:
        raise ValueError("Credential document exceeds the safe Keychain input size; nothing was written")
    result = subprocess.run(['/usr/bin/security', '-i', '-q'], input=command,
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise ValueError("Keychain update failed. Run from Warp and approve the macOS Keychain prompt")
    if read_stored() != parsed:
        raise ValueError("Keychain verification failed: stored credentials differ from the source")


def main():
    if sys.argv[1:] == ['--check']:
        read_stored()
        print('OK: Firebase Admin JSON is readable and has all required fields.')
        return
    if len(sys.argv) > 2:
        raise ValueError('Usage: configure-firebase-keychain.py [service-account.json | --check]')
    source = sys.argv[1] if len(sys.argv) == 2 else input('Path to Firebase Admin service-account JSON: ').strip().strip("\"'")
    try:
        payload = Path(source).expanduser().read_text(encoding='utf-8')
    except OSError:
        raise ValueError('Cannot read the selected file') from None
    store(validate(payload))
    print('OK: Firebase Admin saved in Keychain and verified by reading it back.')
    print('After finishing active Pi work, restart Control Service and use Send test to phone.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, EOFError, KeyboardInterrupt) as error:
        print(str(error) or 'Cancelled', file=sys.stderr)
        sys.exit(1)
