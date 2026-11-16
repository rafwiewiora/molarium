"""Export preserved stock poses for local Foldarium inspection without inference.

The prediction-only and experimental-reference views are separate files. No
crystal RMSD, diagnostic category or preferred pose is put into either library.
Original PDB strings and explicit ligand graphs remain unchanged.
"""
import argparse
import copy
import hashlib
import io
import json
from pathlib import Path
import re
import zipfile

from analyze_rnp_sampling import analyze
from check_stock_benchmark import check


def digest(data):
    return hashlib.sha256(data).hexdigest()


def bundle(pair, job, rows, results, reference, sources, samples, with_reference):
    poses = []
    if with_reference:
        result = {**copy.deepcopy(reference['result']), 'kind': 'experimental',
                  'model': 'Experimental reference', 'provider': 'Experimental PDB-derived scoring reference',
                  'plddt': None, 'meanPlddt': None, 'ptm': None, 'iptm': None, 'elapsedMs': None,
                  'provenance': {'sourceReferenceSha256': pair['referenceSha256'],
                                 'outputPdbSha256': digest(reference['result']['pdb'].encode()),
                                 'purpose': 'Display/scoring reference, never supplied to inference.'}}
        poses.append({'id': pair['caseId'] + '::experimental', 'compoundId': pair['caseId'],
                      'sample': 0, 'seed': 0, 'status': 'complete', 'role': 'experimental-reference', 'result': result})
    for row in rows:
        pose = {'id': pair['caseId'] + '::stock-seed-' + str(row['seed']), 'compoundId': pair['caseId'],
                'sample': row['seed'] + int(with_reference), 'seed': row['seed'], 'status': row['status'], 'role': 'prediction'}
        if row['status'] == 'complete':
            pose['result'] = copy.deepcopy(results[row['index']])
        else:
            pose['error'] = row.get('error') or 'Preserved failed execution; no replacement prediction generated.'
        poses.append(pose)
    identity = digest(json.dumps([sources['sourceScoresSha256'], pair['caseId'], samples, with_reference]).encode())
    return {'schema': 'foldarium.cofolding-library.v1',
            'run': {'id': 'stock-review-' + identity[:24],
                    'name': pair['name'] + (' · reference and stock poses' if with_reference else ' · stock poses only'),
                    'createdAt': sources['createdAt'], 'status': 'complete',
                    'request': {'sequence': job['sequences'][0]['protein']['sequence'], 'model': 'comparison-review-only'},
                    'compounds': [{'id': pair['caseId'], 'smiles': job['sequences'][1]['ligand']['smiles']}],
                    'samples': samples + int(with_reference), 'total': len(poses),
                    'completed': sum(p['status'] == 'complete' for p in poses),
                    'failed': sum(p['status'] == 'failed' for p in poses),
                    'provenance': {**sources, 'purpose': 'Human inspection of preserved output; no copied decisions or correctness labels.',
                                   'referenceIncluded': with_reference, 'sourceCaseId': pair['caseId'],
                                   'seedPrefix': list(range(samples)),
                                   'coordinatePolicy': 'Every exported PDB string is byte-identical to its preserved prediction or experimental reference. Viewer alignment is display-only.',
                                   'timingPolicy': 'elapsedMs is unavailable because recorded launcher wall time is not isolated inference time.'}},
            'poses': poses, 'decisions': []}


def export(review, output, case_ids, samples, max_expanded_mib=256, max_members=4000, attribution_file=None):
    if not case_ids or len(set(case_ids)) != len(case_ids) or any(not re.fullmatch(r'[-a-z0-9_]+', c) for c in case_ids):
        raise ValueError('Specify distinct frozen case IDs')
    source_names = [Path(__file__).name, 'analyze_rnp_sampling.py', 'summarize_rnp_stock.py',
                    'check_stock_benchmark.py', 'score_stock_localfold.py', 'pose_metrics.py', 'experimental_reference.py']
    source_hashes = {name: digest(Path(__file__).with_name(name).read_bytes()) for name in source_names}
    report_raw = (review / 'scores.json').read_bytes()
    evidence_raw = (review / 'evidence.json').read_bytes()
    evidence = json.loads(evidence_raw)
    verified = check(review, max_expanded_mib * 1024**2, max_members)
    if report_raw != (review / 'scores.json').read_bytes() or evidence_raw != (review / 'evidence.json').read_bytes():
        raise ValueError('Source package changed during independent verification')
    report = json.loads(report_raw)
    attribution_raw = attribution_file.read_bytes() if attribution_file else None
    attribution = json.loads(attribution_raw) if attribution_raw else None
    if attribution is not None and (not isinstance(attribution, dict) or any(key not in attribution for key in ['title', 'source', 'license', 'creators', 'modifications'])):
        raise ValueError('Dataset attribution needs title, source, license, creators and modifications')
    if digest(report_raw) != evidence['scoresSha256']:
        raise ValueError('Score report differs from preserved archive identity')
    chunks = []
    for part in evidence.get('archiveParts') or [{'file': 'evidence.zip', 'sha256': evidence['archiveSha256']}]:
        name = part['file']
        if Path(name).name != name or '\\' in name or name in ['.', '..']:
            raise ValueError('Archive part must stay beside the report')
        raw = (review / name).read_bytes()
        if digest(raw) != part['sha256']:
            raise ValueError('Evidence part changed')
        chunks.append(raw)
    raw = b''.join(chunks)
    if digest(raw) != evidence['archiveSha256']:
        raise ValueError('Original evidence archive changed')
    files = {}
    libraries = []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        inventory = json.loads(archive.read('archive-manifest.json'))
        def read(name):
            data = archive.read(name)
            if digest(data) != inventory[name]['sha256'] or len(data) != inventory[name]['bytes']:
                raise ValueError('Archived source changed: ' + name)
            return data
        plan_raw = read('frozen-plan/plan.json')
        if digest(plan_raw) != report['planSha256']:
            raise ValueError('Frozen plan changed')
        plan = json.loads(plan_raw)
        selection = analyze(plan, report)
        if not 1 <= samples <= len(selection['allSelected']) or not selection['allSelected'][samples - 1]['fullyProcessed']:
            raise ValueError('Every case in the requested seed prefix must be terminal')
        sources = {'sourceScoresSha256': digest(report_raw), 'sourceEvidenceSha256': evidence['archiveSha256'],
                   'sourcePlanSha256': digest(plan_raw), 'sourceRevision': plan['sourceRevision'],
                   'createdAt': report['createdAt']}
        if attribution:
            sources.update({'datasetAttribution': attribution, 'datasetAttributionSha256': digest(attribution_raw)})
        for case_id in case_ids:
            pairs = [p for p in plan['pairs'] if p['caseId'] == case_id]
            if len(pairs) != 1:
                raise ValueError('Case does not resolve to one frozen model: ' + case_id)
            pair = pairs[0]
            rows = [r for r in report['poses'] if r['caseId'] == case_id and r['seed'] < samples]
            rows.sort(key=lambda r: r['seed'])
            if [r['seed'] for r in rows] != list(range(samples)):
                raise ValueError('Missing or repeated source seed')
            first_job = plan['jobs'][rows[0]['index']]
            job_raw = read('frozen-plan/' + first_job['input'])
            if digest(job_raw) != first_job['inputSha256']:
                raise ValueError('Frozen sequence/SMILES declaration changed')
            job = json.loads(job_raw)
            component_raw = read('frozen-plan/components/' + case_id + '.json')
            component = json.loads(component_raw)
            reference_raw = read('reference-evidence/' + pair['referenceFile'])
            if digest(reference_raw) != pair['referenceSha256']:
                raise ValueError('Experimental reference changed')
            reference = json.loads(reference_raw)
            results = {}
            for row in rows:
                declared_job = plan['jobs'][row['index']]
                declared_raw = read('frozen-plan/' + declared_job['input'])
                if digest(declared_raw) != declared_job['inputSha256']:
                    raise ValueError('Seed-specific input identity changed')
                declared = json.loads(declared_raw)
                if declared['sequences'] != job['sequences']:
                    raise ValueError('One case contains different sequence or ligand declarations across seeds')
                if row['status'] != 'complete':
                    continue
                pdb = read(f'predictions/{row["index"]:03d}/prediction.pdb')
                receipt_raw = read(f'predictions/{row["index"]:03d}/receipt.json')
                receipt = json.loads(receipt_raw)
                if digest(pdb) != row['outputPdbSha256'] or digest(receipt_raw) != row['receiptSha256']:
                    raise ValueError('Prediction coordinates or receipt changed')
                results[row['index']] = {
                    'kind': 'prediction', 'pdb': pdb.decode(), 'component': component,
                    'sequence': job['sequences'][0]['protein']['sequence'],
                    'model': {'boltz2': 'Boltz-2', 'openbind0': 'OpenBind-0'}.get(row['model'], row['model']) + ' · original LocalFold',
                    'provider': 'Stock LocalFold · physical ' + row['actualFoldingDevice']['profile']['vendor'] + ' WebGPU',
                    'plddt': None, 'meanPlddt': row['confidence'].get('mean_plddt'),
                    'ptm': row['confidence'].get('ptm'), 'iptm': row['confidence'].get('iptm'), 'elapsedMs': None,
                    'provenance': {'outputPdbSha256': digest(pdb), 'sourceReceiptSha256': digest(receipt_raw),
                                   'sourceComponentSha256': digest(component_raw), 'sourceIndex': row['index'],
                                   'sourceSeed': row['seed'], 'sourceModel': row['model'],
                                   'recordedLauncherElapsedSeconds': receipt['elapsedSeconds'],
                                   'confidencePrecision': 'Values reported by the original archive; summary ipTM is rounded to two decimals.'},
                }
            for with_reference in [False, True]:
                value = bundle(pair, job, rows, results, reference, sources, samples, with_reference)
                name = case_id + ('.with-reference' if with_reference else '.predictions') + '.library.json'
                data = (json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n').encode()
                files[name] = data
                libraries.append({'caseId': case_id, 'file': name, 'sha256': digest(data), 'bytes': len(data),
                                  'referenceIncluded': with_reference, 'predictions': len(rows), 'copiedDecisions': 0})
    if any(digest(Path(__file__).with_name(name).read_bytes()) != value for name, value in source_hashes.items()):
        raise ValueError('Executing export/analysis source changed during verification')
    if attribution_file and attribution_file.read_bytes() != attribution_raw:
        raise ValueError('Source attribution changed during verification')
    output.mkdir(parents=True, exist_ok=False)
    for name, data in files.items():
        (output / name).write_bytes(data)
    manifest = {'schema': 'molarium.stock-foldarium-review-export.v1', 'samplesPerCase': samples,
                'caseIds': case_ids, 'sourceScoresSha256': digest(report_raw),
                'sourceEvidenceSha256': evidence['archiveSha256'], 'independentVerification': verified,
                'scriptSha256': source_hashes[Path(__file__).name], 'analysisSources': source_hashes, 'libraries': libraries,
                'newNeuralForwards': 0, 'copiedDecisions': 0}
    if attribution:
        manifest.update({'datasetAttribution': attribution, 'datasetAttributionSha256': digest(attribution_raw)})
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    lines = ['# Inspect preserved stock predictions in Foldarium', '',
             'Download a library JSON below, open the [Molarium Foldarium reviewer](https://molarium.org/vendor/foldarium/library-review.html), '
             'and choose **Import library JSON**. Preferences, rejections and notes remain in your browser; use **Export library + decisions** to save them.', '',
             'Each case has a prediction-only file and a separate file including a clearly labelled experimental reference. '
             'The examples were selected after examining benchmark results; this is not a blinded or representative accuracy study. '
             'No RMSD, diagnostic category or preferred pose is embedded in the libraries. '
             'Every original prediction PDB and its explicit ligand graph is preserved; viewer alignment affects display only.', '',
             '| Case | Predictions only | Include experimental reference |', '| --- | --- | --- |']
    for case_id in case_ids:
        lines.append(f'| {case_id} | [JSON]({case_id}.predictions.library.json) | [JSON]({case_id}.with-reference.library.json) |')
    lines += ['', 'These files contain original stock predictions and the existing experimental scoring reference, not native-prediction coordinates. '
              'The missing isolated inference time remains unavailable in the viewer; recorded launcher wall time is retained separately in provenance. '
              'References are display controls, and any human preference is an unscored decision rather than validation of a prediction.', '',
              '[Manifest, source hashes and independent verification](manifest.json). No model was run to create these exports.', '']
    if attribution:
        lines += ['Source dataset: ' + ', '.join(attribution['creators']) + ', *' + attribution['title'] + '*. '
                  '[' + attribution['license'] + '](' + attribution['source'] + '). ' + attribution['modifications'], '']
    (output / 'README.md').write_text('\n'.join(lines))
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--case', action='append', required=True, dest='case_ids')
    parser.add_argument('--samples', type=int, required=True)
    parser.add_argument('--max-expanded-mib', type=int, default=256)
    parser.add_argument('--max-members', type=int, default=4000)
    parser.add_argument('--attribution', type=Path, help='Explicit source-credit JSON retained in each portable library')
    args = parser.parse_args()
    result = export(args.review, args.output, args.case_ids, args.samples, args.max_expanded_mib, args.max_members, args.attribution)
    print(json.dumps({'output': str(args.output), 'cases': len(result['caseIds']), 'libraries': len(result['libraries']), 'newNeuralForwards': 0}))
