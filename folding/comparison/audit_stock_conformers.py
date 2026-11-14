"""Check the frozen stock input conformers independently of folding outputs."""
import argparse
import hashlib
import json
from pathlib import Path
from rdkit import Chem
from pose_metrics import component_mol
from experimental_reference import stereo_diagnostic


def audit(root):
    manifest_file = root / 'component-provenance.json'
    manifest = json.loads(manifest_file.read_text())
    records = []
    for name, meta in sorted(manifest['components'].items()):
        raw = (root / name).read_bytes()
        if hashlib.sha256(raw).hexdigest() != meta['sha256']:
            raise ValueError('Frozen stock component changed')
        component = json.loads(raw)
        template = Chem.MolFromSmiles(meta['smiles'])
        graph = component_mol(component, template)
        mapping = graph.GetSubstructMatch(template, useChirality=False)
        if len(mapping) != template.GetNumAtoms():
            raise ValueError('Stock named graph differs from declared chemistry')
        molecule = Chem.Mol(template)
        molecule.RemoveAllConformers()
        conformer = Chem.Conformer(molecule.GetNumAtoms())
        for i, j in enumerate(mapping):
            conformer.SetAtomPosition(i, tuple(component['atoms'][j][key] for key in ['x', 'y', 'z']))
        molecule.AddConformer(conformer)
        records.append({'caseId': Path(name).stem, 'componentSha256': meta['sha256'],
                        'conformerErrorReportedByStock': component['conformerError'],
                        'stereochemistry': stereo_diagnostic(molecule)})
    return {'schema': 'molarium.stock-input-conformer-audit.v1',
        'scope': 'Independent existing stereochemical-graph diagnostic on frozen stock ligand input coordinates; no neural inference or crystal coordinates. Not full physical validation.',
        'componentManifestSha256': hashlib.sha256(manifest_file.read_bytes()).hexdigest(),
        'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'rdkitVersion': Chem.rdBase.rdkitVersion, 'records': records}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    result = audit(args.root)
    with args.output.open('x') as stream:
        stream.write(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'components': len(result['records']),
                     'stereochemicalGraphMatches': sum(r['stereochemistry']['stereochemicalIdentityMatches'] for r in result['records']),
                     'neuralForwards': 0}))
