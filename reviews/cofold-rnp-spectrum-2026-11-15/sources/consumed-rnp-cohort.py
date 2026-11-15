"""Freeze a Runs N' Poses candidate pool before stock LocalFold inference.

Published Boltz-2 RMSD is a screening signal. It is not a substitute for our
independent all-observed-C-alpha score or proof of chemical validity.
"""
import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import tarfile
from rdkit import Chem


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def candidates(sources, maximum_length=700):
    sources = Path(sources)
    inputs = json.loads((sources / 'inputs.json').read_bytes())
    with tarfile.open(sources / 'predictions.tar.gz') as archive:
        # Both Boltz generations have method='boltz' in the published CSV.
        # The exact named archive member, not that ambiguous column, selects it.
        rows = list(csv.DictReader(io.TextIOWrapper(archive.extractfile('predictions/boltz2.csv'))))
    grouped = {}
    for row in rows:
        if row.get('ligand_is_proper') != 'True':
            continue
        try:
            rmsd = float(row['rmsd'])
        except (ValueError, TypeError):
            continue
        if math.isfinite(rmsd):
            grouped.setdefault((row['target'], row['ligand_instance_chain']), []).append(row)
    records, excluded = [], []
    for annotation in csv.DictReader((sources / 'annotations.csv').open()):
        system = annotation['system_id']
        key = (system, annotation['ligand_instance_chain'])
        declaration = inputs.get(system)
        poses = grouped.get(key, [])
        hits = [row for row in poses if float(row['rmsd']) < 2]
        reason = None
        if not declaration or len(declaration.get('sequences', {})) != 1 or len(declaration.get('smiles', [])) != 1:
            reason = 'Requires exactly one protein sequence and one ligand input'
        elif annotation.get('ligand_is_proper') != 'True':
            reason = 'Not an RnP proper ligand'
        elif annotation.get('release_date', '') <= '2023-06-01':
            reason = 'Query released on or before the declared Boltz-2 training cutoff'
        elif not hits:
            reason = 'No published same-model Boltz-2 RMSD strictly below 2 A'
        if reason:
            excluded.append({'systemId': system, 'ligandInstanceChain': key[1], 'reason': reason})
            continue
        sequence = next(iter(declaration['sequences'].values()))
        smiles = declaration['smiles'][0]
        molecule = Chem.MolFromSmiles(smiles)
        try:
            similarity = float(annotation['sucos_shape_pocket_qcov_2023'])
        except (ValueError, TypeError):
            similarity = float('nan')
        if not 60 <= len(sequence) <= maximum_length or set(sequence) - set('ACDEFGHIKLMNPQRSTVWY'):
            reason = 'Protein length or canonical-sequence gate'
        elif molecule is None or len(Chem.GetMolFrags(molecule)) != 1 or not 15 <= molecule.GetNumHeavyAtoms() <= 60:
            reason = 'Connected 15-60-heavy-atom ligand gate'
        elif any(a.GetSymbol() not in {'B', 'C', 'N', 'O', 'F', 'P', 'S', 'Cl', 'Br', 'I', 'Se'} for a in molecule.GetAtoms()):
            reason = 'Ligand element outside the declared comparison scope'
        elif not math.isfinite(similarity) or not 0 <= similarity <= 100:
            reason = 'Missing or out-of-range model-cutoff similarity'
        else:
            expected = Chem.MolFromSmiles(annotation['ligand_smiles'])
            if expected is None or Chem.MolToSmiles(expected) != Chem.MolToSmiles(molecule):
                reason = 'Annotation and actual inference-input chemical states differ'
        if reason:
            excluded.append({'systemId': system, 'ligandInstanceChain': key[1], 'reason': reason})
            continue
        seen = set()
        for row in poses:
            identity = (row['seed'], row['sample'])
            if identity in seen:
                raise ValueError('Repeated Boltz-2 sample identity for ' + str(key))
            seen.add(identity)
        records.append({
            'systemId': system, 'ligandInstanceChain': key[1],
            'pdbId': annotation['entry_pdb_id'], 'ccdId': annotation['ligand_ccd_code'],
            'caseId': system.lower().replace('.', '-'),
            'sequence': sequence, 'proteinChain': next(iter(declaration['sequences'])),
            'sequenceSha256': hashlib.sha256(sequence.encode()).hexdigest(),
            'smiles': smiles, 'proteinResidues': len(sequence),
            'ligandHeavyAtoms': molecule.GetNumHeavyAtoms(), 'cluster': annotation['cluster'],
            'similarity': similarity, 'similarityBin': min(int(similarity // 25), 3),
            'similarityColumn': 'sucos_shape_pocket_qcov_2023',
            'releaseDate': annotation['release_date'], 'inputDeclaration': declaration,
            'publishedBoltz2PoseCount': len(poses),
            'publishedBestRmsdA': min(float(p['rmsd']) for p in poses),
            'publishedHits': sorted(hits, key=lambda x: (float(x['rmsd']), int(x['seed']), int(x['sample']))),
            'candidateOrderSha256': hashlib.sha256(('molarium-rnp-spectrum-v1:' + system + ':' + key[1]).encode()).hexdigest(),
            'qualification': 'Published geometric screen only; independently rescore the saved native pose before stock inference.',
        })
    records.sort(key=lambda x: (x['similarityBin'], x['candidateOrderSha256']))
    return records, excluded


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--sources', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    records, exclusions = candidates(args.sources)
    value = {
        'schema': 'molarium.rnp-spectrum-candidate-pool.v1', 'status': 'native-requalification-required',
        'dataset': {'zenodoRecord': 18366081, 'repositoryRevision': '197fafc60a5cef3a9e7f8a4b0dac7c965eed3839'},
        'policy': {
            'model': 'boltz2', 'publishedPredictionMember': 'predictions/boltz2.csv',
            'queryReleaseAfter': '2023-06-01', 'proteinResidues': [60, 700],
            'ligandHeavyAtoms': [15, 60], 'proteinInputs': 1, 'ligandInputs': 1,
            'similarity': 'Published SuCOS-shape times pocket coverage, maximum to training systems before 1 June 2023; not sequence identity.',
            'similarityBins': [[0, 25], [25, 50], [50, 75], [75, 100]],
            'binEdges': 'Left-inclusive/right-exclusive, except 100 belongs to the final bin.',
            'targetNewCases': 50, 'targetByBin': [3, 12, 18, 17],
            'selection': 'All independently qualifying low-bin cases; stable SHA-256 order elsewhere. At most two cases per exact protein sequence and three per supplied RnP cluster. Every exclusion/shortfall remains explicit.',
            'stockProtocol': {'sourceRevision': '5ea3d42c911949700401b54003cb28c557fcf2a6', 'steps': 200, 'recycles': 3, 'seeds': list(range(10)), 'msaRowsIncludingQuery': 256},
            'nativeGate': 'Independently recomputed all-observed-C-alpha ligand RMSD strictly below 2 A, using preserved same-model native output. No pocket or ligand refit.',
        },
        'sources': {name: {'sha256': sha(args.sources / name), 'bytes': (args.sources / name).stat().st_size}
                    for name in ['annotations.csv', 'inputs.json', 'predictions.tar.gz']},
        'selectorSha256': sha(__file__), 'candidates': records, 'exclusions': exclusions,
        'caveats': ['This conditions on published native success and is not prospective accuracy validation.',
                    'Published RnP RMSD and our all-observed-C-alpha protocol differ; native requalification is mandatory.',
                    'Similarity is model-cutoff-specific and is not proof that a target was absent from training.',
                    'Low-similarity successes are scarce; related cases and bin denominators must be reported.'],
    }
    with args.output.open('x') as f:
        json.dump(value, f, indent=2, allow_nan=False)
        f.write('\n')
    print(json.dumps({'candidates': len(records), 'byBin': {str(i): sum(x['similarityBin'] == i for x in records) for i in range(4)}, 'output': str(args.output)}))


if __name__ == '__main__':
    main()
