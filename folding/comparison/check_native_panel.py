"""Verify portable native evidence and recompute conversion and crystal scores.

Reads named-graph JSON and hashes molecule-cache bytes; never unpickles caches
or runs inference. The original CLI receipt hash is an audit anchor. Its public
copy omits only argv; this checker verifies the published scientific content.
"""
import contextlib
import hashlib
import io
import json
import math
import re
from pathlib import Path
import tempfile
import zipfile
from convert_native import convert
from experimental_reference import score
import numpy as np


def sha(data):
    return hashlib.sha256(data).hexdigest()


def compare_values(actual, expected):
    if isinstance(expected, bool) or expected is None or isinstance(expected, str):
        assert actual == expected, (actual, expected)
    elif isinstance(expected, (int, float)):
        assert math.isclose(actual, expected, rel_tol=1e-8, abs_tol=1e-8), (actual, expected)
    elif isinstance(expected, list):
        assert len(actual) == len(expected)
        for a, e in zip(actual, expected):
            compare_values(a, e)
    else:
        assert actual.keys() == expected.keys()
        for key in expected:
            compare_values(actual[key], expected[key])


def evaluate(panel_path, phase):
    panel_path, phase = Path(panel_path), Path(phase)
    panel = json.loads(panel_path.read_bytes())
    evidence = json.loads((phase / 'evidence.json').read_bytes())
    saved = json.loads((phase / 'scores.json').read_bytes())
    labels = {p['method'] for p in saved['poses']}
    assert len(labels) == 1
    label = labels.pop()
    assert evidence['panelSha256'] == sha(panel_path.read_bytes())
    archive = evidence['archive']
    raw = (phase / archive['file']).read_bytes()
    assert len(raw) == archive['bytes'] and sha(raw) == archive['sha256']
    members = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        assert len(z.namelist()) == len(archive['files'])
        assert set(z.namelist()) == {f['file'] for f in archive['files']}
        for f in archive['files']:
            path = Path(f['file'])
            assert not path.is_absolute() and '..' not in path.parts
            data = z.read(f['file'])
            assert len(data) == f['bytes'] and sha(data) == f['sha256']
            members[f['file']] = data
    assert len(evidence['cases']) == len(panel['cases'])
    descriptors = {c['caseId']: c for c in evidence['cases']}
    libraries, poses = [], 0
    with tempfile.TemporaryDirectory(prefix='native-panel-check-') as temporary:
        temporary = Path(temporary)
        for c in panel['cases']:
            case_id = c['id']
            d = descriptors[case_id]
            receipt = json.loads(members[f'{case_id}/receipt.public.json'])
            assert receipt['status'] == 'complete' and receipt['method'] == evidence['method']
            assert 'argv' not in receipt and receipt['redactedFields'] == ['argv (private absolute paths)']
            assert receipt['originalReceiptSha256'] == d['originalReceiptSha256']
            assert sha(members['consumed-native_run.py']) == receipt['runnerSha256']
            for name, digest in receipt['inputFiles'].items():
                assert sha(members[f'{case_id}/inputs/{name}']) == digest
            spec_bytes = members[f'{case_id}/inputs/comparison.json']
            spec = json.loads(spec_bytes)
            assert sha(spec_bytes) == receipt['inputSha256'] == d['inputSha256']
            assert spec['sequence'] == c['sequence'] and spec['seeds'] == panel['seeds']
            assert spec['compounds'] == [{'id': case_id, 'smiles': c['smiles']}]
            lib_path = phase / d['library']
            lib_bytes = lib_path.read_bytes()
            assert sha(lib_bytes) == d['librarySha256']
            lib = json.loads(lib_bytes)
            assert lib['decisions'] == [] and lib['run']['status'] == 'complete'
            assert sorted(p['seed'] for p in lib['poses']) == panel['seeds']
            assert len(lib['poses']) == d['poses'] == len(receipt['outputs'])
            native_outputs = {r['path']: r for r in receipt['outputs']}
            seen = set()
            topology_name = f'{case_id}/outputs/ligand-topologies.json'
            topology = json.loads(members[topology_name]) if evidence['method'] == 'boltz2' else None
            if topology:
                assert topology['nativeReceiptSha256'] == d['originalReceiptSha256']
            for pose in lib['poses']:
                result = pose['result']
                provenance = result['provenance']
                path = provenance['nativeOutputFile']
                assert path in native_outputs and path not in seen
                seen.add(path)
                if evidence['method'] == 'openbind0':
                    seed = int(re.search(r'_seed_(\d+)', path).group(1))
                    confidence_path = str(Path(path).with_name(Path(path).name.rsplit('_model.', 1)[0] + '_confidences_aggregated.json'))
                else:
                    seed = int(next(p[5:] for p in Path(path).parts if re.fullmatch(r'seed-\d+', p)))
                    confidence_path = str(Path(path).with_name('confidence_' + Path(path).stem + '.json'))
                assert seed == pose['seed'] == provenance['request']['seed']
                assert result['sequence'] == provenance['request']['sequence'] == c['sequence']
                assert provenance['settings'] == receipt['settings']
                assert provenance['environment'] == receipt['environment']
                assert provenance['nativeCheckpointSha256'] == receipt['checkpointSha256']
                raw_output = members[f'{case_id}/outputs/{path}']
                assert sha(raw_output) == native_outputs[path]['sha256'] == provenance['nativeOutputSha256']
                assert len(raw_output) == native_outputs[path]['bytes']
                assert provenance['nativeReceiptSha256'] == d['originalReceiptSha256']
                native_topology = topology['outputs'][path] if topology else None
                if native_topology:
                    assert native_topology['nativeOutputSha256'] == sha(raw_output)
                    assert sha(members[f'{case_id}/outputs/{native_topology["sourceFile"]}']) == native_topology['sourceSha256']
                native_path = temporary / 'output.cif'
                native_path.write_bytes(raw_output)
                pdb, component, plddt, layout, proof = convert(native_path, c['smiles'], c['sequence'], native_topology)
                assert pdb == result['pdb'] and sha(pdb.encode()) == provenance['outputPdbSha256']
                assert component == result['component'] and plddt == result['plddt']
                assert layout == result['confidenceLayout'] and proof == provenance['atomMapping']
                confidence_bytes = members.get(f'{case_id}/outputs/{confidence_path}')
                confidence = json.loads(confidence_bytes) if confidence_bytes else {}
                assert confidence == provenance['nativeConfidence']
                lower = {k.lower().replace('_', ''): v for k, v in confidence.items()}
                assert result['ptm'] == lower.get('ptm') and result['iptm'] == lower.get('iptm')
                assert math.isclose(result['meanPlddt'], float(np.mean(plddt)), abs_tol=1e-10)
                poses += 1
            assert seen == native_outputs.keys()
            libraries.append((label, lib_path))
        with contextlib.redirect_stdout(io.StringIO()):
            score(panel_path, libraries, temporary / 'scores.json')
        actual = json.loads((temporary / 'scores.json').read_bytes())
    for key in ['panelSha256', 'definitions', 'summary', 'poses', 'caveats']:
        compare_values(actual[key], saved[key])
    return {'method': evidence['method'], 'cases': len(evidence['cases']), 'poses': poses,
            'geometricPasses': sum(p['within2A'] for p in saved['poses']),
            'limitedValidityPasses': sum(p['within2A'] and p['stereochemistry']['stereochemicalIdentityMatches']
                                        and p['predictedGeometry']['severeHeavyAtomPairsUnder1_2A'] == 0
                                        for p in saved['poses'])}
