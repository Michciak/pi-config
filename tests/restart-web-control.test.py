import importlib.util
import io
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

if __name__ == '__main__':
    unittest.main()
