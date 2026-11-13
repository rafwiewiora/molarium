"""Publish completed native panel evidence without running inference.

Only CLI argument paths are removed from public receipts. Exact original receipt
hashes stay attached to every pose; raw private transfer receipts remain intact.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile
import native_panel_recovery


def sha(data):
    return hashlib.sha256(data).hexdigest()


def package(source, panel_path, libraries, method, output, recoveries=None, case_sources=None):
    panel = json.loads(panel_path.read_bytes())
    output.mkdir(parents=True)
    members = {}
    cases = []
    runner = (source / 'native_run.py').read_bytes()
    members['consumed-native_run.py'] = runner
    recoveries = recoveries or {}
    case_sources = case_sources or {}
    for i, case in enumerate(panel['cases']):
        case_id = case['id']
        case_source = Path(case_sources.get(case_id, source))
        case_runner = (case_source / 'native_run.py').read_bytes()
        if case_runner != runner:
            members[f'{case_id}/consumed-native_run.py'] = case_runner
        recovery = recoveries.get(case_id)
        native = Path(recovery['cohort']) if recovery else case_source / 'results' / f'{method}-{case_id}'
        receipt_bytes = (native / 'receipt.json').read_bytes()
        receipt = json.loads(receipt_bytes)
        if receipt['status'] != 'complete':
            raise ValueError(f'{case_id} is incomplete; preserve it separately')
        if not recovery and sha(case_runner) != receipt['runnerSha256']:
            raise ValueError('Consumed native runner hash mismatch')
        inputs = case_source / 'inputs' / case_id
        spec_bytes = (inputs / 'comparison.json').read_bytes()
        spec = json.loads(spec_bytes)
        assert sha(spec_bytes) == receipt['inputSha256']
        assert spec['sequence'] == case['sequence'] and spec['seeds'] == panel['seeds']
        assert spec['compounds'] == [{'id': case_id, 'smiles': case['smiles']}]
        if recovery:
            assert method == 'openbind0'
            native_panel_recovery.package(members, case_id, receipt, inputs, recovery['attempts'])
        for path in sorted(inputs.rglob('*')):
            if path.is_file():
                relative = str(path.relative_to(inputs))
                data = path.read_bytes()
                if not recovery:
                    assert sha(data) == receipt['inputFiles'][relative]
                members[f'{case_id}/inputs/{relative}'] = data
        public = {k: v for k, v in receipt.items() if k != 'argv'}
        public['originalReceiptSha256'] = sha(receipt_bytes)
        public['redactedFields'] = [] if recovery else ['argv (private absolute paths)']
        members[f'{case_id}/receipt.public.json'] = (json.dumps(public, indent=2) + '\n').encode()
        paths = set()
        for item in receipt['outputs']:
            path = native / item['path']
            data = path.read_bytes()
            assert len(data) == item['bytes'] and sha(data) == item['sha256']
            paths.add(path)
            if method == 'openbind0':
                confidence = path.with_name(path.name.rsplit('_model.', 1)[0] + '_confidences_aggregated.json')
            else:
                confidence = path.with_name('confidence_' + path.stem + '.json')
            if confidence.exists():
                paths.add(confidence)
        topology_file = native / 'ligand-topologies.json'
        if method == 'boltz2':
            topology = json.loads(topology_file.read_bytes())
            assert topology['nativeReceiptSha256'] == sha(receipt_bytes)
            paths.add(topology_file)
            for item in topology['outputs'].values():
                path = native / item['sourceFile']
                assert sha(path.read_bytes()) == item['sourceSha256']
                paths.add(path)
        timing = native / 'forward-times.jsonl'
        if timing.exists():
            paths.add(timing)
        for path in sorted(paths):
            assert path.resolve().is_relative_to(native.resolve()) and not path.is_symlink()
            members[f'{case_id}/outputs/{path.relative_to(native)}'] = path.read_bytes()
        library_file = libraries / f'library-{i+1}.json'
        library_bytes = library_file.read_bytes()
        library = json.loads(library_bytes)
        assert len(library['poses']) == len(panel['seeds']) and library['decisions'] == []
        for pose in library['poses']:
            assert pose['result']['provenance']['nativeReceiptSha256'] == sha(receipt_bytes)
            assert pose['result']['provenance']['outputPdbSha256'] == sha(pose['result']['pdb'].encode())
        shutil.copyfile(library_file, output / library_file.name)
        cases.append({'caseId': case_id, 'library': library_file.name,
                      'librarySha256': sha(library_bytes), 'originalReceiptSha256': sha(receipt_bytes),
                      'inputSha256': receipt['inputSha256'], 'poses': len(library['poses'])})
    shutil.copyfile(libraries / 'scores.json', output / 'scores.json')
    archive = output / 'native-evidence.zip'
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name, data in sorted(members.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 13, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data, compresslevel=9)
    archive_bytes = archive.read_bytes()
    if len(archive_bytes) >= 25 * 1024 * 1024:
        raise ValueError('Evidence exceeds the static hosting file limit')
    evidence = {'schema': 'molarium.native-panel-evidence.v1', 'method': method,
                'panelSha256': sha(panel_path.read_bytes()), 'cases': cases,
                'scope': 'Complete native controls, not fixed-tensor implementation parity. No inference during publication.',
                'scriptSha256': sha(Path(__file__).read_bytes()),
                'archive': {'file': archive.name, 'bytes': len(archive_bytes), 'sha256': sha(archive_bytes),
                            'files': [{'file': name, 'bytes': len(data), 'sha256': sha(data)}
                                      for name, data in sorted(members.items())]}}
    (output / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    return {'cases': len(cases), 'poses': sum(c['poses'] for c in cases), 'archiveBytes': len(archive_bytes)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--panel', type=Path, required=True)
    parser.add_argument('--libraries', type=Path, required=True)
    parser.add_argument('--method', choices=['openbind0', 'boltz2'], required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--recoveries', type=Path, help='Case-to-cohort/source-attempt JSON; preserves original interrupted CLI statuses')
    parser.add_argument('--case-sources', type=Path, help='Case-to-source-root JSON for distinct completed attempts; each consumed runner is hash checked')
    args = parser.parse_args()
    print(json.dumps(package(args.source, args.panel, args.libraries, args.method, args.output,
                             json.loads(args.recoveries.read_bytes()) if args.recoveries else None,
                             json.loads(args.case_sources.read_bytes()) if args.case_sources else None)))
