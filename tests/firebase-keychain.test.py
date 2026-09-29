import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('setup', Path(__file__).resolve().parents[1] / 'scripts/configure-firebase-keychain.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class KeychainTests(unittest.TestCase):
    def setUp(self):
        self.credentials = dict(type='service_account', project_id='test', client_email='test@example.test', private_key='fake\\key\n"quoted"')

    def test_secret_only_in_stdin_and_roundtrip_verified(self):
        replies = [subprocess.CompletedProcess([], 0, '', ''), subprocess.CompletedProcess([], 0, json.dumps(self.credentials), '')]
        with patch.object(module.subprocess, 'run', side_effect=replies) as run:
            module.store(self.credentials)
        self.assertEqual(run.call_args_list[0].args[0], ['/usr/bin/security', '-i', '-q'])
        command = run.call_args_list[0].kwargs['input']
        self.assertIn(module.security_quote(json.dumps(self.credentials, separators=(',', ':'))), command)
        self.assertEqual(command.count('\n'), 1)
        self.assertEqual(run.call_count, 2)

    def test_corrupt_readback_is_not_success(self):
        replies = [subprocess.CompletedProcess([], 0, '', ''), subprocess.CompletedProcess([], 0, 'truncated-secret', '')]
        with patch.object(module.subprocess, 'run', side_effect=replies), self.assertRaises(ValueError) as error:
            module.store(self.credentials)
        self.assertNotIn('truncated-secret', str(error.exception))

    def test_oversized_input_not_written(self):
        self.credentials['private_key'] = 'x' * 5000
        with patch.object(module.subprocess, 'run') as run, self.assertRaises(ValueError):
            module.store(self.credentials)
        run.assert_not_called()

    def test_failure_does_not_expose_output(self):
        with patch.object(module.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, '', 'SECRET')), self.assertRaises(ValueError) as error:
            module.store(self.credentials)
        self.assertNotIn('SECRET', str(error.exception))

    def test_wrong_document_rejected(self):
        with self.assertRaises(ValueError):
            module.validate('{"project_info":{}}')

if __name__ == '__main__': unittest.main()
