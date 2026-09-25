import importlib.util
from pathlib import Path
import subprocess
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("tmux_paste", Path(__file__).resolve().parents[2] / "scripts/tmux-paste.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ClipboardTests(unittest.TestCase):
    def mock_runner(self, data=b"hello\n", mode=b"1", failure=None):
        calls = []

        def run(argv, **kwargs):
            calls.append((argv, kwargs))
            if failure and failure in argv:
                raise subprocess.CalledProcessError(1, argv)
            result = data if argv[0] == "pbpaste" else mode if "display-message" in argv else b""
            return SimpleNamespace(stdout=result, returncode=0)

        return run, calls

    def test_exact_bytes_and_no_clipboard_in_argv(self):
        data = 'zażółć 🙂\n"quote" `backtick` $(literal)\n\n'.encode()
        run, calls = self.mock_runner(data)
        module.paste("/tmp/socket with spaces", "%7", run)
        load = next(call for call in calls if "load-buffer" in call[0])
        self.assertEqual(load[1]["input"], data)
        for argv, _ in calls:
            self.assertNotIn(data.decode(), " ".join(argv))
        cmds = [argv[3] for argv, _ in calls if argv[0] == "tmux"]
        self.assertLess(cmds.index("send-keys"), cmds.index("paste-buffer"))
        paste = next(argv for argv, _ in calls if "paste-buffer" in argv)
        for flag in ("-p", "-r", "-d"):
            self.assertIn(flag, paste)
        self.assertEqual(paste[-2:], ["-t", "%7"])
        for argv, _ in calls:
            if argv[0] == "tmux":
                self.assertEqual(argv[1:3], ["-S", "/tmp/socket with spaces"])

    def test_clipboard_failure_cannot_paste_old_buffer(self):
        run, calls = self.mock_runner(failure="pbpaste")
        with self.assertRaises(subprocess.CalledProcessError):
            module.paste("/tmp/socket", "%1", run)
        self.assertEqual(len(calls), 1)

    def test_load_failure_never_pastes(self):
        run, calls = self.mock_runner(failure="load-buffer")
        with self.assertRaises(subprocess.CalledProcessError):
            module.paste("/tmp/socket", "%1", run)
        self.assertFalse(any("paste-buffer" in argv for argv, _ in calls))

    def test_empty_clipboard_has_no_terminal_side_effect(self):
        run, calls = self.mock_runner(data=b"")
        module.paste("/tmp/socket", "%1", run)
        self.assertEqual(len(calls), 1)

    def test_live_pane_does_not_receive_cancel(self):
        run, calls = self.mock_runner(mode=b"0")
        module.paste("/tmp/socket", "%1", run)
        self.assertFalse(any("send-keys" in argv for argv, _ in calls))

    def test_paste_failure_cleans_temporary_buffer(self):
        run, calls = self.mock_runner(failure="paste-buffer")
        with self.assertRaises(subprocess.CalledProcessError):
            module.paste("/tmp/socket", "%1", run)
        self.assertIn("delete-buffer", calls[-1][0])

    def test_invalid_target_cannot_read_clipboard(self):
        run, calls = self.mock_runner()
        with self.assertRaises(ValueError):
            module.paste("/tmp/socket", "other-pane", run)
        self.assertFalse(calls)


if __name__ == "__main__":
    unittest.main()
