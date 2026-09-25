import contextlib
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("apply_tmux", root / "scripts/apply-tmux.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InstallTests(unittest.TestCase):
    def test_backups_exact_originals_and_idempotent_install(self):
        with tempfile.TemporaryDirectory(prefix="pi-tmux-install-") as folder:
            base = Path(folder)
            config = base / "tmux.conf"
            agent = base / "agent"
            helper = agent / "tmux/paste.py"
            helper.parent.mkdir(parents=True)
            config.write_bytes(b"# previous user config\n")
            helper.write_bytes(b"# previous helper\n")
            untouched = agent / "unrelated.txt"
            untouched.write_bytes(b"unchanged")
            with patch.dict(os.environ, {"PI_AGENT_DIR": str(agent), "TMUX_CONFIG_FILE": str(config)}):
                with contextlib.redirect_stdout(io.StringIO()):
                    module.apply(reload_server=False)
                    module.apply(reload_server=False)
            backups = list((agent / "backups").iterdir())
            self.assertEqual(len(backups), 1)
            self.assertEqual((backups[0] / "tmux.conf").read_bytes(), b"# previous user config\n")
            self.assertEqual((backups[0] / "paste.py").read_bytes(), b"# previous helper\n")
            self.assertEqual(config.read_bytes(), (root / "tmux/tmux.conf").read_bytes())
            self.assertEqual(helper.read_bytes(), (root / "scripts/tmux-paste.py").read_bytes())
            self.assertEqual(untouched.read_bytes(), b"unchanged")


if __name__ == "__main__":
    unittest.main()
