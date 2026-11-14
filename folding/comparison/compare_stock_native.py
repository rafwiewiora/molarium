"""Compare saved stock and native ligand poses in the same crystal-protein frame.

No inference or ligand refit. Every native seed is retained; equal integer seeds
are labels rather than a claim of identical random tensors.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import statistics
import zipfile
from rdkit.Chem import rdMolAlign
from pose_metrics import pdb_atoms, fit_proteins, ligand_mol


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def aligned_mol(result, reference, smiles):
    ref_atoms, atoms = pdb_atoms(reference['result']['pdb']), pdb_atoms(result['pdb'])
    observed = {r['sequenceIndex'] for r in reference['observedResidues']}
    filtered = [a for a in atoms if a['record'] != 'ATOM' or int(a['residue']) in observed]
    transform, protein_rmsd = fit_proteins(ref_atoms, filtered)
    return ligand_mol(result, atoms, smiles, transform), protein_rmsd


def compare(review, repository):
    report_raw = (review / 'scores.json').read_bytes()
    report = json.loads(report_raw)
    evidence = json.loads((review / 'evidence.json').read_text())
    if digest(report_raw) != evidence['scoresSha256']:
        raise ValueError('Stock score report changed')
    parts = evidence.get('archiveParts') or [{'file': 'evidence.zip', 'sha256': evidence['archiveSha256']}]
    chunks = []
    for part in parts:
        name = part['file']
        if Path(name).name != name or '\\' in name or name in ['.', '..']:
            raise ValueError('Archive part must be a sibling file')
        data = (review / name).read_bytes()
        if digest(data) != part['sha256']:
            raise ValueError('Stock evidence archive part changed')
        chunks.append(data)
    raw = b''.join(chunks)
    if digest(raw) != evidence['archiveSha256']:
        raise ValueError('Stock evidence archive changed')
    rows, sources, summaries = [], [], []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        plan_raw = archive.read('frozen-plan/plan.json')
        if digest(plan_raw) != report['planSha256']:
            raise ValueError('Frozen selection plan changed')
        plan = json.loads(plan_raw)
        for pair in plan['pairs']:
            native_score_file = repository / pair['nativeScoreFile']
            if digest(native_score_file.read_bytes()) != pair['nativeScoreSha256']:
                raise ValueError('Native score evidence changed')
            original_scores = [r for r in json.loads(native_score_file.read_text())['poses']
                               if r['caseId'] == pair['caseId'] and r['status'] == 'complete']
            expected_libraries = {r['sourceLibrarySha256'] for r in original_scores}
            matched = []
            for path in native_score_file.parent.glob('library-*.json'):
                data = path.read_bytes()
                if digest(data) in expected_libraries:
                    matched.append((path, data))
            if len(matched) != 1 or len(expected_libraries) != 1:
                raise ValueError('Native case does not resolve to exactly one preserved source library')
            source_file, source_raw = matched[0]
            native = json.loads(source_raw)
            reference_file = repository / pair['referenceFile']
            reference_raw = reference_file.read_bytes()
            if digest(reference_raw) != pair['referenceSha256']:
                raise ValueError('Crystal protein-frame reference changed')
            reference = json.loads(reference_raw)
            native_mols = {}
            for pose in native['poses']:
                expected = next(r for r in original_scores if r['seed'] == pose['seed'])
                if digest(pose['result']['pdb'].encode()) != expected['outputPdbSha256']:
                    raise ValueError('Native prediction coordinates changed')
                native_mols[pose['seed']] = aligned_mol(pose['result'], reference, native['run']['compounds'][0]['smiles'])[0]
            if sorted(native_mols) != [0, 1, 2]:
                raise ValueError('Expected the original complete three-seed native cohort')
            sources.append({'caseId': pair['caseId'], 'model': pair['model'],
                            'file': str(source_file.relative_to(repository)), 'sha256': digest(source_raw),
                            'nativeSeeds': sorted(native_mols)})
            stock_rows = [r for r in report['poses'] if (r['caseId'], r['model']) == (pair['caseId'], pair['model']) and r['status'] == 'complete']
            for stock in stock_rows:
                prefix = f'predictions/{stock["index"]:03d}/'
                pdb = archive.read(prefix + 'prediction.pdb')
                if digest(pdb) != stock['outputPdbSha256']:
                    raise ValueError('Stock prediction coordinates changed')
                job = json.loads(archive.read(prefix + 'input.json'))
                smiles = job['sequences'][1]['ligand']['smiles']
                component = json.loads(archive.read('frozen-plan/components/' + stock['caseId'] + '.json'))
                molecule, _ = aligned_mol({'pdb': pdb.decode(), 'component': component}, reference, smiles)
                distances = [{'nativeSeed': seed, 'ligandRmsdA': float(rdMolAlign.CalcRMS(
                    molecule, mol, maxMatches=1000000, symmetrizeConjugatedTerminalGroups=True))}
                    for seed, mol in sorted(native_mols.items())]
                nearest = min(distances, key=lambda r: (r['ligandRmsdA'], r['nativeSeed']))
                same = next((r['ligandRmsdA'] for r in distances if r['nativeSeed'] == stock['seed']), None)
                rows.append({'caseId': pair['caseId'], 'model': pair['model'], 'stockSeed': stock['seed'],
                             'stockPdbSha256': stock['outputPdbSha256'], 'nativeDistances': distances,
                             'nearestNativeSeed': nearest['nativeSeed'], 'nearestNativeRmsdA': nearest['ligandRmsdA'],
                             'sameIntegerSeedRmsdA': same})
            group = [r for r in rows if (r['caseId'], r['model']) == (pair['caseId'], pair['model'])]
            same_seed = [r for r in group if r['sameIntegerSeedRmsdA'] is not None]
            native_spread = [float(rdMolAlign.CalcRMS(native_mols[a], native_mols[b], maxMatches=1000000,
                symmetrizeConjugatedTerminalGroups=True)) for a in native_mols for b in native_mols if a < b]
            summaries.append({'caseId': pair['caseId'], 'model': pair['model'], 'stockPredictions': len(group),
                'nativePredictions': len(native_mols),
                'medianNearestNativeRmsdA': statistics.median(r['nearestNativeRmsdA'] for r in group) if group else None,
                'sameIntegerSeedPairs': len(same_seed),
                'meanSameIntegerSeedFirstThreeRmsdA': statistics.mean(r['sameIntegerSeedRmsdA'] for r in same_seed)
                    if len(same_seed) == 3 else None,
                'meanNativePairwiseSpreadA': statistics.mean(native_spread)})
    return {'schema': 'molarium.stock-native-pose-agreement.v1', 'scope': report['status'],
            'stockScoresSha256': digest(report_raw), 'stockEvidenceSha256': evidence['archiveSha256'],
            'scriptSha256': digest(Path(__file__).read_bytes()), 'nativeLibraries': sources,
            'definitions': {'frame': 'Each prediction is independently protein-aligned to all observed corresponding crystal C-alpha atoms; ligand coordinates are never fitted.',
                'distance': 'Symmetry-aware ligand heavy-atom RMSD between the resulting common-frame coordinates.',
                'sampling': 'All three original native seeds versus every available stock seed. Equal integer seeds do not imply matched random tensors; this is pose agreement, not numerical parity.'},
            'summary': summaries, 'pairs': rows, 'neuralForwards': 0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('review', type=Path)
    parser.add_argument('--repository', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = compare(args.review, args.repository.resolve())
    with args.output.open('x') as stream:
        stream.write(json.dumps(result, indent=2, allow_nan=False) + '\n')
    if args.output.parent.resolve() == args.review.resolve():
        fmt = lambda value: '—' if value is None else f'{value:.2f}'
        lines = ['\n## Direct agreement with native poses\n',
            'Every available stock pose is compared with all three preserved native poses, after aligning each protein '
            'to the same observed crystal Cα frame. Ligands are never independently fitted. '
            'Native intrinsic spread is shown as context; equal integer seeds do not mean equal random tensors.\n',
            '| Case | Model | Median nearest-native Å | Same-seed mean Å (0–2) | Native pairwise spread Å |',
            '| --- | --- | ---: | ---: | ---: |']
        for row in result['summary']:
            lines.append(f'| {row["caseId"]} | {row["model"]} | {fmt(row["medianNearestNativeRmsdA"])} | '
                         f'{fmt(row["meanSameIntegerSeedFirstThreeRmsdA"])} | {fmt(row["meanNativePairwiseSpreadA"])} |')
        lines += ['', 'The same-seed mean is emitted only when all of stock seeds 0, 1 and 2 are available. '
            'These are pose-agreement statistics, not a matched-tensor numerical parity result. '
            '[Every native comparison and source-library hash](native-agreement.json).', '']
        with (args.review / 'README.md').open('a') as stream:
            stream.write('\n'.join(lines))
    print(json.dumps({'stockPredictions': len(result['pairs']),
                     'nativeComparisons': sum(len(r['nativeDistances']) for r in result['pairs']), 'neuralForwards': 0}))
