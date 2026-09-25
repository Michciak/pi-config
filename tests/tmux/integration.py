#!/usr/bin/env python3
"""Exercise real tmux input/scroll behavior on a private, disposable socket.

No user sessions, Pi credentials, or system clipboard are accessed.  A raw-mode
numbered-line fixture replaces Pi.  Exit 2 means the environment blocked the
test; it is deliberately not reported as a passing test.
"""

import argparse
import errno
import fcntl
import os
from pathlib import Path
import pty
import select
import shlex
import shutil
import struct
import subprocess
import sys
import tempfile
import termios
import time


class TestFailure(Exception):
    pass


class Blocked(Exception):
    pass


FIXTURE = r"""
import os, sys, tty
tty.setraw(0)
with open(sys.argv[1], 'wb', buffering=0) as recorded:
    os.write(1, b'\x1b[?2004h')
    for number in range(240):
        os.write(1, ('FIXTURE-LINE-%03d\r\n' % number).encode())
    os.write(1, b'FIXTURE-READY')
    while True:
        chunk = os.read(0, 4096)
        if not chunk:
            break
        recorded.write(chunk)
"""


class Harness:
    def __init__(self, binary, config, directory):
        self.binary = binary
        self.config = config
        self.directory = Path(directory)
        self.socket = str(self.directory / "socket")
        self.env = dict(os.environ, TERM="xterm-256color")
        self.env.pop("TMUX", None)
        self.env.pop("TMUX_PANE", None)
        self.client = None
        self.master = None
        self.passed = 0
        self.paste_data = ("Zażółć gęślą jaźń\nliteral: $(whoami) `date` $HOME \"quotes\"\n\n").encode()
        self.paste_file = self.directory / "synthetic-paste"
        self.copy_file = self.directory / "synthetic-copy"
        self.paste_file.write_bytes(self.paste_data)
        fake_bin = self.directory / "bin"
        fake_bin.mkdir()
        for name, code in {
            "pbpaste": "import os, pathlib, sys\nsys.stdout.buffer.write(pathlib.Path(os.environ['PI_TEST_PASTE']).read_bytes())\n",
            "pbcopy": "import os, pathlib, sys\npathlib.Path(os.environ['PI_TEST_COPY']).write_bytes(sys.stdin.buffer.read())\n",
        }.items():
            executable = fake_bin / name
            executable.write_text("#!" + sys.executable + "\n" + code)
            executable.chmod(0o700)
        # The helper invokes tmux by name; retain the exact binary under test.
        (fake_bin / "tmux").symlink_to(Path(binary).resolve())
        self.fake_copy = fake_bin / "pbcopy"
        self.env.update(
            PATH=str(fake_bin) + os.pathsep + self.env.get("PATH", ""),
            PI_TEST_PASTE=str(self.paste_file), PI_TEST_COPY=str(self.copy_file),
        )

    def tmux(self, *args, check=True):
        result = subprocess.run(
            [self.binary, "-S", self.socket, *args],
            env=self.env, capture_output=True, text=True, timeout=5,
        )
        if check and result.returncode:
            raise TestFailure("tmux %s: %s" % (
                " ".join(args), (result.stderr or result.stdout).strip()))
        return result.stdout.strip() if check else result

    def drain(self):
        if self.master is None:
            return
        while select.select([self.master], [], [], 0)[0]:
            try:
                if not os.read(self.master, 65536):
                    break
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise

    def wait(self, predicate, description, timeout=4):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.drain()
            if predicate():
                return
            if self.client is not None and self.client.poll() is not None:
                raise TestFailure("PTY tmux client exited while waiting for " + description)
            time.sleep(0.025)
        raise TestFailure("Timed out waiting for " + description)

    def pause(self, seconds=0.15):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.drain()
            time.sleep(0.01)

    def assert_that(self, condition, message):
        if not condition:
            raise TestFailure(message)

    def passed_test(self, message):
        self.passed += 1
        print("PASS " + message, flush=True)

    def fixture_command(self, name):
        return "exec " + shlex.join([
            sys.executable, "-u", "-c", FIXTURE,
            str(self.directory / (name + ".input")),
        ])

    def state(self, pane, variable):
        return self.tmux("display-message", "-p", "-t", pane, "#{%s}" % variable)

    def mode(self, pane):
        return self.state(pane, "pane_in_mode") == "1"

    def offset(self, pane):
        return int(self.state(pane, "scroll_position") or "0")

    def view(self, pane):
        return self.tmux("capture-pane", "-p", "-M", "-t", pane)

    def recorded(self, name):
        return (self.directory / (name + ".input")).read_bytes()

    def fixture_ready(self, pane):
        if self.state(pane, "pane_dead") == "1":
            raise TestFailure("Synthetic fixture exited: " +
                              self.tmux("capture-pane", "-p", "-t", pane))
        return int(self.state(pane, "history_size")) > 100

    def wheel(self, up, x=10, y=10):
        os.write(self.master, ("\x1b[<%d;%d;%dM" % (64 if up else 65, x, y)).encode())

    def start(self):
        first = self.tmux(
            "-f", "/dev/null", "new-session", "-d", "-s", "regression",
            "-x", "100", "-y", "30", "-P", "-F", "#{pane_id}",
            "exec /bin/sleep 60", check=False,
        )
        if first.returncode:
            detail = (first.stderr or first.stdout).strip()
            if any(part in detail.lower() for part in (
                "operation not permitted", "permission denied", "can't create socket",
                "failed to create server", "server exited unexpectedly",
            )):
                raise Blocked("Cannot start private tmux server: " + detail)
            raise TestFailure("Cannot start private tmux server: " + detail)
        pane = first.stdout.strip()
        if not pane.startswith("%") or not Path(self.socket).exists():
            detail = "stdout=%r; stderr=%r; socket_exists=%s" % (
                first.stdout, first.stderr, Path(self.socket).exists())
            if any(part in first.stderr.lower() for part in (
                "operation not permitted", "permission denied",
            )):
                raise Blocked("Private tmux startup denied: " + detail)
            raise TestFailure("Private tmux startup returned without a live socket: " + detail)
        self.tmux("set-option", "-g", "remain-on-exit", "on")
        self.tmux("respawn-pane", "-k", "-t", pane, self.fixture_command("first"))

        # Reproduce the stale binding from the old configuration, then verify
        # that applying the actual new config twice removes it cleanly.
        self.tmux("bind-key", "-n", "C-v", "display-message", "obsolete paste override")
        self.tmux("source-file", str(self.config))
        self.tmux("source-file", str(self.config))
        root_bindings = self.tmux("list-keys", "-T", "root")
        self.assert_that(not any(" C-v " in line for line in root_bindings.splitlines()),
                         "Root Ctrl+V override remains after reloading config")
        self.passed_test("configuration reload is repeatable; stale root Ctrl+V removed")

        try:
            master, slave = pty.openpty()
        except OSError as error:
            raise Blocked("Cannot create test PTY: " + str(error)) from error
        self.master = master
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))

        def controlling_terminal():
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)

        try:
            self.client = subprocess.Popen(
                [self.binary, "-S", self.socket, "attach-session", "-t", "regression"],
                stdin=slave, stdout=slave, stderr=slave, env=self.env,
                preexec_fn=controlling_terminal, close_fds=True,
            )
        finally:
            os.close(slave)
        self.wait(lambda: bool(self.tmux("list-clients")), "attached synthetic terminal")
        self.wait(lambda: self.fixture_ready(pane), "numbered fixture history")
        self.pause()
        return pane

    def run(self):
        pane = self.start()
        live = self.tmux("capture-pane", "-p", "-t", pane)
        self.wheel(True)
        self.wait(lambda: self.mode(pane) and self.offset(pane) == 3,
                  "first wheel event to move three lines")
        first_view = self.view(pane)
        self.assert_that(first_view != live, "First wheel event did not change viewport")
        self.wheel(True)
        self.wait(lambda: self.offset(pane) == 6, "second wheel event to move three more lines")
        self.assert_that(self.view(pane) != first_view, "Second wheel event did not change viewport")
        self.passed_test("first and subsequent real SGR wheel events move the viewport")

        self.wheel(False)
        self.wait(lambda: self.offset(pane) == 3, "downward wheel movement")
        for _ in range(3):
            self.wheel(False)
        self.wait(lambda: not self.mode(pane), "scrolling to bottom to restore live view")
        before = self.recorded("first")
        self.wheel(False)
        self.pause()
        self.assert_that(self.recorded("first") == before,
                         "Wheel-down at live prompt leaked input to application")
        self.passed_test("downward scrolling returns live; wheel at bottom never sends prompt-history keys")

        self.wheel(True)
        self.wait(lambda: self.mode(pane), "copy mode before Escape")
        os.write(self.master, b"\x1b")
        self.wait(lambda: not self.mode(pane), "Escape to cancel copy mode")
        self.assert_that(self.recorded("first") == before,
                         "Escape intended for copy mode leaked to application")
        os.write(self.master, b"\x16")
        self.wait(lambda: self.recorded("first") == before + b"\x16",
                  "Ctrl+V to reach the application")
        self.passed_test("Escape returns live without interrupting app; Ctrl+V reaches app")

        # This is a real tmux paste, with only the macOS clipboard executable
        # substituted.  Its payload includes Unicode, shell syntax and final
        # newlines, and must arrive byte-for-byte within bracketed-paste marks.
        self.wheel(True)
        self.wait(lambda: self.mode(pane), "copy mode before synthetic paste")
        before_paste = self.recorded("first")
        helper = Path(__file__).resolve().parents[2] / "scripts" / "tmux-paste.py"
        pasted = subprocess.run(
            [sys.executable, str(helper), self.socket, pane], env=self.env,
            capture_output=True, text=True, timeout=10,
        )
        self.assert_that(pasted.returncode == 0, "Paste helper failed: " + pasted.stderr.strip())
        expected = before_paste + b"\x1b[200~" + self.paste_data + b"\x1b[201~"
        self.wait(lambda: self.recorded("first") == expected,
                  "exact Unicode/multiline bracketed paste bytes")
        self.assert_that(not self.mode(pane), "Paste helper left pane in copy mode")
        self.passed_test("paste leaves copy mode and preserves Unicode, shell syntax and final newlines")

        # Invoke the configured Enter copy binding on a known synthetic line.
        # Use an absolute fake copy-command so no real pasteboard is contacted.
        self.tmux("set-option", "-s", "copy-command", shlex.quote(str(self.fake_copy)))
        self.tmux("copy-mode", "-t", pane)
        for command in ("cursor-up", "start-of-line", "begin-selection", "end-of-line"):
            self.tmux("send-keys", "-t", pane, "-X", command)
        self.tmux("send-keys", "-t", pane, "Enter")
        self.wait(lambda: self.copy_file.exists() and
                  self.copy_file.read_bytes().rstrip(b"\n") == b"FIXTURE-LINE-239",
                  "selected numbered line to reach the fake clipboard")
        self.assert_that(not self.mode(pane), "Copy binding did not return to live view")
        self.passed_test("configured Enter copies selected text and returns live, using fake clipboard")

        second = self.tmux("split-window", "-h", "-t", pane, "-P", "-F", "#{pane_id}",
                           self.fixture_command("second"))
        self.wait(lambda: self.fixture_ready(second), "second pane history")
        self.tmux("select-pane", "-t", pane)
        x = int(self.state(second, "pane_left")) + 3
        y = int(self.state(second, "pane_top")) + 3
        self.pause()
        self.wheel(True, x, y)
        self.wait(lambda: self.mode(second) and self.offset(second) == 3,
                  "wheel over inactive second pane")
        self.assert_that(not self.mode(pane), "Scrolling second pane changed first pane")
        self.assert_that(self.state(second, "pane_active") == "1",
                         "Hovered second pane was not selected")
        self.passed_test("mouse coordinates target the hovered subagent pane")

    def close(self):
        # The explicit private socket is mandatory: never kill the user's server.
        try:
            self.tmux("kill-server", check=False)
        except (OSError, subprocess.TimeoutExpired):
            pass
        if self.client is not None:
            try:
                self.client.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.client.terminate()
                self.client.wait(timeout=2)
        if self.master is not None:
            os.close(self.master)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path,
                        default=Path(__file__).resolve().parents[2] / "tmux" / "tmux.conf")
    parser.add_argument("--tmux", default=shutil.which("tmux"))
    args = parser.parse_args()
    if not args.tmux:
        print("BLOCKED tmux is not installed", file=sys.stderr)
        return 2
    if not args.config.is_file():
        print("FAIL configuration not found: " + str(args.config), file=sys.stderr)
        return 1
    # Short path avoids macOS's UNIX-domain socket pathname limit.
    with tempfile.TemporaryDirectory(prefix="pi-tmux-test-", dir="/tmp") as directory:
        harness = Harness(args.tmux, args.config.resolve(), directory)
        try:
            harness.run()
        except Blocked as error:
            print("BLOCKED " + str(error), file=sys.stderr)
            return 2
        except (TestFailure, OSError, subprocess.SubprocessError) as error:
            print("FAIL " + str(error), file=sys.stderr)
            return 1
        finally:
            harness.close()
        print("%d real tmux checks passed (synthetic PTY and clipboard; no Warp UI test)." % harness.passed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
