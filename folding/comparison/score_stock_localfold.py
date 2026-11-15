"""Score a saved stock-page run using the existing crystal-reference protocol."""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import zipfile
import numpy as np
from rdkit import Chem
from rdkit.Chem import rdMolAlign
from experimental_reference import stereo_diagnostic
from pose_metrics import pdb_atoms, fit_proteins, ligand_mol, contacts


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def score(plan_file, repository, index, attempt):
    plan = json.loads(plan_file.read_text())
    job = plan['jobs'][index]
    assert job['index'] == index
    pair = next(p for p in plan['pairs'] if (p['caseId'], p['model']) == (job['caseId'], job['model']))
    native = repository / pair['nativeScoreFile']
    if sha(native) != pair['nativeScoreSha256']:
        raise ValueError('Native selection evidence changed')
    hits = [p for p in json.loads(native.read_text())['poses']
            if p['caseId'] == pair['caseId'] and p.get('status') == 'complete' and p['ligandRmsdA'] < 2]
    if not hits or min(p['ligandRmsdA'] for p in hits) != pair['nativeBestA']:
        raise ValueError('Case does not satisfy the frozen native <2 A selection')
    if not all('native-' + pair['model'] in p['method'] for p in hits):
        raise ValueError('Native hit is from a different model')
    receipt = json.loads((attempt / 'receipt.json').read_text())
    if receipt['status'] != 'complete' or receipt['inputSha256'] != job['inputSha256']:
        raise ValueError('Incomplete run or changed inference input')
    if receipt['upstream']['revision'] != plan['sourceRevision']:
        raise ValueError('Upstream revision differs from the frozen plan')
    requested = {'model': job['model'], 'steps': plan['steps'], 'recycles': plan['recycles']}
    if receipt['requested'] != requested:
        raise ValueError('Inference budget differs from the frozen plan')
    for name, record in receipt['outputs'].items():
        if sha(attempt / name) != record['sha256']:
            raise ValueError(f'Output hash mismatch: {name}')
    if sha(attempt / 'input.json') != job['inputSha256']:
        raise ValueError('Saved input bytes changed')
    input_job = json.loads((attempt / 'input.json').read_text())
    if input_job['modelSeeds'] != [job['seed']]:
        raise ValueError('Seed differs from the frozen plan')
    sequence = input_job['sequences'][0]['protein']['sequence']
    smiles = input_job['sequences'][1]['ligand']['smiles']
    components = json.loads((plan_file.parent / 'component-provenance.json').read_text())
    component_file = f'components/{job["caseId"]}.json'
    declared = components['components'][component_file]
    if declared['smiles'] != smiles or sha(plan_file.parent / component_file) != declared['sha256']:
        raise ValueError('Stock named input graph changed')
    component = json.loads((plan_file.parent / component_file).read_text())
    reference_file = repository / pair['referenceFile']
    if sha(reference_file) != pair['referenceSha256']:
        raise ValueError('Frozen crystal reference changed')
    ref = json.loads(reference_file.read_text())
    text = (attempt / 'prediction.pdb').read_text()
    with zipfile.ZipFile(attempt / 'job.zip') as archive:
        pdbs = [name for name in archive.namelist() if name.endswith('.pdb')]
        if len(pdbs) != 1 or archive.read(pdbs[0]).decode() != text:
            raise ValueError('The original page archive and PDB button disagree')
        msa_files = [name for name in archive.namelist() if name.endswith('.a3m')]
        provided_msa = input_job['sequences'][0]['protein'].get('unpairedMsa', '')
        if provided_msa.count('>') > 1:
            if len(msa_files) != 1 or archive.read(msa_files[0]).decode() != provided_msa:
                raise ValueError('Saved provided MSA differs from the submitted bytes')
        summaries = [name for name in archive.namelist() if name.endswith('summary_confidences_0.json')]
        confidence = json.loads(archive.read(summaries[0])) if len(summaries) == 1 else {}
    predicted = {'pdb': text, 'component': component, 'sequence': sequence}
    ref_atoms, pred_atoms = pdb_atoms(ref['result']['pdb']), pdb_atoms(text)
    observed = {r['sequenceIndex'] for r in ref['observedResidues']}
    all_ca = [a for a in pred_atoms if a['record'] == 'ATOM' and a['name'] == 'CA']
    if len(all_ca) != len(sequence):
        raise ValueError('Prediction is missing declared protein residues')
    filtered = [a for a in pred_atoms if a['record'] != 'ATOM' or int(a['residue']) in observed]
    transform, ca_rmsd = fit_proteins(ref_atoms, filtered)
    crystal = ligand_mol(ref['result'], ref_atoms, smiles)
    ligand = ligand_mol(predicted, pred_atoms, smiles, transform)
    rmsd = float(rdMolAlign.CalcRMS(ligand, crystal, maxMatches=1000000,
                                   symmetrizeConjugatedTerminalGroups=True))
    _, geometry = contacts(filtered)
    stereo = stereo_diagnostic(ligand)
    return {'schema': 'molarium.stock-localfold-pose-score.v1', 'index': index,
            'caseId': job['caseId'], 'model': job['model'], 'seed': job['seed'],
            'status': 'complete', 'ligandRmsdA': rmsd, 'within2A': rmsd < 2,
            'proteinCaRmsdA': ca_rmsd, 'alignedCa': len(observed),
            'stereochemistry': stereo, 'predictedGeometry': geometry,
            'limitedValidityPass': stereo['stereochemicalIdentityMatches'] and geometry['severeHeavyAtomPairsUnder1_2A'] == 0,
            'nativeBestA': pair['nativeBestA'], 'nativeHasStereoClashPassingHit': pair['nativeHasStereoClashPassingHit'],
            'confidence': confidence, 'actualFoldingDevice': receipt['actualFoldingDevice'],
            'planSha256': sha(plan_file), 'receiptSha256': sha(attempt / 'receipt.json'),
            'outputPdbSha256': sha(attempt / 'prediction.pdb'), 'referenceSha256': pair['referenceSha256'],
            'providedMsaRows': provided_msa.count('>'),
            'providedMsaArchiveExact': True if provided_msa.count('>') > 1 else None,
            'analysisEnvironment': {'python': platform.python_version(), 'numpy': np.__version__,
                                    'rdkit': Chem.rdBase.rdkitVersion},
            'analysisScripts': {p.name: sha(p) for p in [Path(__file__),
                Path(__file__).with_name('pose_metrics.py'), Path(__file__).with_name('experimental_reference.py')]},
            'alignment': 'All observed corresponding protein C-alpha atoms; no trimming, pocket refit or independent ligand fit.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--repository', required=True, type=Path)
    parser.add_argument('--index', required=True, type=int)
    parser.add_argument('--attempt', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = score(args.plan, args.repository, args.index, args.attempt)
    with args.output.open('x') as stream:
        stream.write(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({k: result[k] for k in ['caseId', 'model', 'seed', 'ligandRmsdA', 'limitedValidityPass']}))
