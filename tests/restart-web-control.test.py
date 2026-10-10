import importlib.util
import io
import plistlib
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('restart', Path(__file__).resolve().parents[1] / 'scripts/restart-web-control.py')
restart = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restart)

class ReadinessTests(unittest.TestCase):
    def simulate(self, ready_after, timeout=None):
        elapsed = [0.0]
        def sleep(seconds):
            elapsed[0] += seconds
        def request(*args, **kwargs):
            if elapsed[0] < ready_after:
                raise OSError('Connection refused')
            return io.StringIO('{"control":"running","engine":"stopped"}')
        with patch.object(restart.time, 'monotonic', side_effect=lambda: elapsed[0]), patch.object(restart.time, 'sleep', side_effect=sleep), patch.object(restart.urllib.request, 'urlopen', side_effect=request), patch('builtins.print'):
            return restart.wait_for_service(**({} if timeout is None else {'timeout': timeout}))

    def test_slow_launch_observed_on_mac(self):
        self.assertEqual(self.simulate(34)['control'], 'running')

    def test_immediate_readiness(self):
        self.assertEqual(self.simulate(0)['engine'], 'stopped')

    def test_timeout_provides_log_location(self):
        with self.assertRaisesRegex(RuntimeError, 'within 2s.*control.stderr.log'):
            self.simulate(100, 2)

    def restart_fixture(self, registrations):
        config = plistlib.dumps({'EnvironmentVariables': {'PI_WEB_RUNTIME_DIR': '/tmp/pi-restart-fixture'}})
        with patch.object(restart, 'PLIST') as plist, patch.object(restart, 'loaded', **registrations), patch.object(restart, 'stop_detached'), patch.object(restart, 'start_detached', return_value=12345) as fallback, patch.object(restart.time, 'sleep'), patch.object(restart.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run, patch('builtins.print'):
            plist.open.return_value.__enter__.return_value = io.BytesIO(config)
            mode = restart.restart_service()
            return mode, fallback.call_count, [call.args[0] for call in run.call_args_list]

    def test_success_exit_without_registration_uses_verified_fallback(self):
        mode, fallbacks, commands = self.restart_fixture({'return_value': False})
        self.assertEqual(mode, 'detached')
        self.assertEqual(fallbacks, 1)
        self.assertEqual(sum(command[1] == 'bootstrap' for command in commands), 3)

    def test_verified_bootstrap_does_not_kill_fresh_registration(self):
        mode, fallbacks, commands = self.restart_fixture({'side_effect': [False, True, True]})
        self.assertEqual(mode, 'launchd')
        self.assertEqual(fallbacks, 0)
        self.assertFalse(any('kickstart' in command for command in commands))

if __name__ == '__main__':
    unittest.main()
