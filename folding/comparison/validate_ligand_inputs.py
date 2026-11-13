"""Compare actual browser input feature chemistry with independent RDKit.

Sanitized molecular identity and raw model bond/aromatic features are separate
checks. Equivalent Kekule spellings can pass identity while failing feature parity.
No experimental coordinates are read by this diagnostic.
"""
import argparse
import hashlib
import json
from pathlib import Path
from rdkit import Chem, rdBase
from experimental_reference import stereo_diagnostic
from pose_metrics import component_mol


def check_component(component, declared_smiles):
    template = Chem.MolFromSmiles(declared_smiles)
    if template is None:
        raise ValueError('Invalid declared SMILES')
    molecule = component_mol(component, template)
    match = template.GetSubstructMatch(molecule, useChirality=False)
    if len(match) != molecule.GetNumAtoms():
        raise ValueError('No exact sanitized chemical correspondence')
    # The graph itself has no chirality tags or conformer. Measure the actual
    # supplied coordinates on the declared stereochemical template, in the
    # same exact atom correspondence used by the independent pose scorer.
    measured=Chem.Mol(template)
    conformer=Chem.Conformer(template.GetNumAtoms())
    for component_index,template_index in enumerate(match):
        atom=component['atoms'][component_index]
        conformer.SetAtomPosition(template_index,tuple(float(atom[k])for k in ['x','y','z']))
    measured.RemoveAllConformers();measured.AddConformer(conformer)
    differences = []
    for b in component['bonds']:
        expected = template.GetBondBetweenAtoms(match[b['from']], match[b['to']])
        order = 4 if expected.GetIsAromatic() else int(expected.GetBondTypeAsDouble())
        actual = 4 if b['order'] in [1.5, 4] else b['order']
        if actual != order:
            differences.append({'componentAtomIndices':[b['from'],b['to']],
                'actualFeatureBondOrder':actual,'expectedFeatureBondOrder':order})
    return {'sanitizedChemicalIdentityMatches':True,
        'heavyAtoms':molecule.GetNumAtoms(),'rawBondFeatureDifferences':differences,
        'stereochemistry':stereo_diagnostic(measured)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--strict', action='store_true')
    args = parser.parse_args()
    data = args.report.read_bytes()
    records = json.loads(data)['records']
    results = [{'caseId':r['caseId'],**check_component(r['component'],r['inputSmiles'])}
        for r in records]
    valid = all(not r['rawBondFeatureDifferences']
        and r['stereochemistry']['stereochemicalIdentityMatches']
        and not r['stereochemistry']['mismatchedCenters']
        and not r['stereochemistry']['unassignedCenters'] for r in results)
    args.output.write_text(json.dumps({'schema':'molarium.ligand-input-check.v1',
        'sourceSha256':hashlib.sha256(data).hexdigest(),'rdkitVersion':rdBase.rdkitVersion,
        'allChecksPass':valid,'records':results},indent=2)+'\n')
    if args.strict and not valid:
        raise ValueError('Browser input bond features or specified stereochemistry differ')
    print(json.dumps({'cases':len(results),'allChecksPass':valid}))


if __name__ == '__main__':
    main()
