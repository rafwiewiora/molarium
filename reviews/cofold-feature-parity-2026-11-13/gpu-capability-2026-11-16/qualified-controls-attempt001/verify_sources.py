"""Bind read-only old controls and completed native fixture; no conversion/NN."""
from pathlib import Path
import hashlib
import json

sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
base = Path('/workspacenfs/rafal_wiewiora')
parent = base / 'molarium-gpu-driver-binding-20261116-attempt002'
assert sha(parent / 'source-manifest.json') == '19ddefa9fa09f0d1ee0c9a624907b83677c041e2487fc0f48faba3a50200cdff'
result = json.loads((parent / 'binding-result.json').read_bytes())
assert result['success'] is True
passing = [r for r in result['records'] if r['exitCode'] == 0 and r['result']['status'] == 'complete']
assert passing and passing[0]['result']['webgpu']['integerProbe'] == 7
assert 'nvidia' in json.dumps(passing[0]['result']['webgpu']['adapter']).lower()
records = []
for name, expected in [
    ('molarium-nvidia-layer-20261115-attempt001', 'f6dbb0999ef5f1e47cea66c84800d25c4c28c14ec6378597538c882f49ec1452'),
    ('molarium-trained-trunk-browser-20261115-attempt001', 'd7f15752ef64f611a8ce265014a52ba952353fc527bdcc3bfa19f9dc027fa1be')]:
    root = base / name
    assert sha(root / 'source-manifest.json') == expected
    manifest = json.loads((root / 'source-manifest.json').read_bytes())
    for filename, digest in manifest.items():
        path = root / filename
        assert path.resolve().is_relative_to(root.resolve()) if hasattr(path, 'is_relative_to') else str(path.resolve()).startswith(str(root.resolve()) + '/')
        assert sha(path) == digest, filename
    records.append({'root': str(root), 'sourceManifestSha256': expected, 'files': len(manifest)})
fixture = base / 'molarium-trained-trunk-browser-20261115-attempt001/results/fixture'
receipt = json.loads((fixture / 'receipt.json').read_bytes())
assert receipt['cycles'] == 4 and len(receipt['expectedSeams']) == 32
assert receipt['gatesDeclaredBeforeRun'] == {'relativeRms': 1e-4, 'maxAbsoluteDifference': 1e-3, 'requireFinite': True}
Path('control-source-verification.json').write_text(json.dumps({
    'scope': 'Source/fixture checks only. Completed native captures and conversion are not repeated.',
    'parentBindingResultSha256': sha(parent / 'binding-result.json'),
    'preservedControls': records, 'trunkFixtureReceiptSha256': sha(fixture / 'receipt.json'),
    'cycles': 4, 'expectedSeams': 32}, indent=2) + '\n')
