"""The wrapper must initialize the official CLI before instrumenting its class."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class NativeEntrypointTests(unittest.TestCase):
    def test_cli_first_initialization_survives_a_real_python_import_cycle(self):
        source = Path(__file__).with_name('native_run.py')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for part in ['boltz', 'boltz/model', 'boltz/model/models']:
                (root / part).mkdir(exist_ok=True)
                (root / part / '__init__.py').write_text('')
            (root / 'boltz/main.py').write_text(
                'CLI_READY = True\nfrom boltz.model.models.boltz2 import Boltz2\n'
                'def cli(): return Boltz2\n')
            (root / 'boltz/model/models/boltz2.py').write_text(
                'from boltz.main import CLI_READY\nclass Boltz2: pass\n')
            # This reproduces Python's partially initialized-module failure,
            # without importing a scientific runtime or claiming GPU execution.
            old = subprocess.run([sys.executable, '-c',
                                  'from boltz.model.models.boltz2 import Boltz2'],
                                 cwd=root, capture_output=True, text=True)
            self.assertNotEqual(old.returncode, 0)
            self.assertIn('partially initialized', old.stderr)
            code = f'''import importlib.util
spec=importlib.util.spec_from_file_location('native_under_test',{str(source)!r})
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
cli, model=module.boltz_entrypoints()
assert cli() is model
assert model.__module__=='boltz.model.models.boltz2'
'''
            fixed = subprocess.run([sys.executable, '-c', code], cwd=root,
                                   capture_output=True, text=True)
            self.assertEqual(fixed.returncode, 0, fixed.stderr)


if __name__ == '__main__':
    unittest.main()
