"""Independently requalify published RnP Boltz-2 hits in the full protein frame.

RnP omits native cached ligand topology. Reconstruct names from exact input
SMILES using the published Boltz parser's AddHs/CanonicalRankAtoms rule; this is
explicitly reconstructed input topology, not a recovered native cache. Never
choose a mapping using predicted distances or the experimental RMSD.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import numpy as np
from rdkit import Chem
from rdkit.Chem import rdMolAlign
from biotite.structure.io import pdbx
from biotite.sequence import ProteinSequence
from experimental_reference import stereo_diagnostic
from pose_metrics import pdb_atoms, fit_proteins, ligand_mol


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as f:
        json.dump(value, f, indent=2, allow_nan=False)
        f.write('\n')


def named_input(smiles):
    molecule = Chem.AddHs(Chem.MolFromSmiles(smiles))
    ranks = list(Chem.CanonicalRankAtoms(molecule))
    Chem.AssignStereochemistry(molecule, force=True, cleanIt=True)
    for atom, rank in zip(molecule.GetAtoms(), ranks):
        atom.SetProp('native_name', atom.GetSymbol().upper() + str(rank + 1))
    molecule = Chem.RemoveHs(molecule, sanitize=False)
    Chem.SanitizeMol(molecule)
    return molecule


def rows(path):
    block = pdbx.CIFFile.read(path).block
    category = block['atom_site']
    columns = {k: category[k].as_array(str) for k in category}
    records = []
    for i in range(len(columns['id'])):
        if columns.get('pdbx_PDB_model_num', ['1'] * len(columns['id']))[i] != '1':
            continue
        element = columns['type_symbol'][i].upper()
        if element in ['H', 'D']:
            continue
        records.append({'chain': columns['label_asym_id'][i], 'name': columns['label_atom_id'][i],
                        'resName': columns['label_comp_id'][i], 'residue': columns['label_seq_id'][i],
                        'xyz': np.array([float(columns[k][i]) for k in ['Cartn_x', 'Cartn_y', 'Cartn_z']]),
                        'element': element, 'occupancy': float(columns['occupancy'][i]),
                        'alt': columns['label_alt_id'][i]})
    return block, records


def protein(records, chain, sequence, complete):
    chosen = {}
    for atom in records:
        if atom['chain'] != chain:
            continue
        n = int(atom['residue'])
        if not 1 <= n <= len(sequence) or ProteinSequence.convert_letter_3to1(atom['resName']) != sequence[n - 1]:
            raise ValueError('Protein residue correspondence differs from declared sequence')
        key = (n, atom['name'])
        rank = (-atom['occupancy'], atom['alt'])
        if key not in chosen or rank < chosen[key][0]:
            chosen[key] = (rank, {**atom, 'record': 'ATOM', 'residue': n})
    atoms = [chosen[k][1] for k in sorted(chosen)]
    observed = [a['residue'] for a in atoms if a['name'] == 'CA']
    if len(observed) < 3 or complete and observed != list(range(1, len(sequence) + 1)):
        raise ValueError('Missing or duplicate declared protein C-alpha atoms')
    return atoms, observed


def positioned_native(smiles, records):
    molecule = named_input(smiles)
    declared = {a.GetProp('native_name'): a for a in molecule.GetAtoms()}
    selected = [a for a in records if a['chain'] == 'B']
    actual = {a['name']: a for a in selected}
    if len(actual) != len(selected) or set(actual) != set(declared):
        raise ValueError('Native names disagree with the pinned SMILES parser reconstruction')
    conformer = Chem.Conformer(molecule.GetNumAtoms())
    for atom in molecule.GetAtoms():
        native = actual[atom.GetProp('native_name')]
        if native['element'] != atom.GetSymbol().upper():
            raise ValueError('Native element differs at its reconstructed atom name')
        conformer.SetAtomPosition(atom.GetIdx(), tuple(float(v) for v in native['xyz']))
    molecule.RemoveAllConformers()
    molecule.AddConformer(conformer)
    return molecule


def result(protein_atoms, molecule, native=False):
    positions = molecule.GetConformer().GetPositions()
    component = {'code': 'LIG', 'atoms': [], 'bonds': [], 'smiles': Chem.MolToSmiles(molecule),
                 'chemistrySource': 'Exact declared SMILES and published deterministic Boltz atom naming; reconstructed, not recovered input cache.' if native else
                 'Explicit RnP reference SDF topology and coordinates, exact isomeric input-graph agreement; reference atom labels identify SDF/template indices.'}
    atoms = [{**a, 'chain': 'A'} for a in protein_atoms]
    for atom in molecule.GetAtoms():
        i = atom.GetIdx()
        name = atom.GetProp('native_name') if native else 'R' + str(i + 1)
        if len(name) > 4:
            raise ValueError('Atom name exceeds portable PDB width')
        component['atoms'].append({'name': name, 'element': atom.GetAtomicNum(), 'charge': atom.GetFormalCharge(),
                                  'explicitHs': atom.GetNumExplicitHs(), **dict(zip(['x', 'y', 'z'], map(float, positions[i])))})
        atoms.append({'record': 'HETATM', 'name': name, 'resName': 'LIG', 'chain': 'B', 'residue': 1,
                      'xyz': positions[i], 'element': atom.GetSymbol().upper()})
    for bond in molecule.GetBonds():
        component['bonds'].append({'from': bond.GetBeginAtomIdx(), 'to': bond.GetEndAtomIdx(),
                                  'order': 4 if bond.GetIsAromatic() else int(bond.GetBondTypeAsDouble())})
    lines = []
    for a in atoms:
        lines.append(f'{"ATOM  " if a["record"] == "ATOM" else "HETATM"}{len(lines)+1:5d} {a["name"]:>4s} {a["resName"]:3s} {a["chain"]}{a["residue"]:4d}    ' +
                     ''.join(f'{v:8.3f}' for v in a['xyz']) + f'  1.00  0.00          {a["element"]:>2s}')
    return {'pdb': '\n'.join(lines) + '\nEND\n', 'component': component}


def reference(case, folder):
    block, records = rows(folder / 'system.cif')
    asym = block['struct_asym']
    entity = dict(zip(asym['id'].as_array(str), asym['entity_id'].as_array(str)))[case['proteinChain']]
    poly = block['entity_poly']
    deposited = dict(zip(poly['entity_id'].as_array(str), poly['pdbx_seq_one_letter_code_can'].as_array(str)))[entity]
    if ''.join(deposited.split()) != case['sequence']:
        raise ValueError('Deposited reference sequence differs from the actual inference input')
    atoms, observed = protein(records, case['proteinChain'], case['sequence'], complete=False)
    path = folder / 'ligand_files' / (case['ligandInstanceChain'] + '.sdf')
    supplier = Chem.SDMolSupplier(str(path), removeHs=False)
    if len(supplier) != 1 or supplier[0] is None:
        raise ValueError('Expected exactly one explicit reference SDF molecule')
    molecule = Chem.RemoveHs(supplier[0])
    if Chem.MolToSmiles(molecule) != Chem.MolToSmiles(Chem.MolFromSmiles(case['smiles'])):
        raise ValueError('Reference SDF and actual input isomeric chemical states differ')
    ligand = [a for a in records if a['chain'] == case['ligandInstanceChain']]
    if len(ligand) != molecule.GetNumAtoms():
        raise ValueError('Reference ligand coordinate counts disagree')
    xyz = molecule.GetConformer().GetPositions()
    distances = np.linalg.norm(xyz[:, None, :] - np.array([a['xyz'] for a in ligand])[None, :, :], axis=2)
    nearest = distances.argmin(axis=1)
    if len(set(nearest)) != len(ligand) or float(distances.min(axis=1).max()) > .005:
        raise ValueError('SDF coordinates are not in the deposited protein coordinate frame')
    if any(molecule.GetAtomWithIdx(i).GetSymbol().upper() != ligand[j]['element'] for i, j in enumerate(nearest)):
        raise ValueError('Reference SDF/CIF coordinate identity has a different element')
    r = result(atoms, molecule)
    r['sequence'] = case['sequence']
    return {'sequence': case['sequence'], 'smiles': case['smiles'], 'result': r,
            'observedResidues': [{'sequenceIndex': n} for n in observed],
            'source': {'systemCifSha256': sha((folder/'system.cif').read_bytes()), 'sdfSha256': sha(path.read_bytes()),
                       'sdfCoordinatesInSystemFrame': True, 'maximumSdfCifDifferenceA': float(distances.min(axis=1).max())}}


def geometry(atoms, ligand):
    xyz = np.array([a['xyz'] for a in atoms if a['record'] == 'ATOM'])
    d = np.linalg.norm(xyz[:, None, :] - ligand.GetConformer().GetPositions()[None, :, :], axis=2)
    return {'severeHeavyAtomPairsUnder1_2A': int((d < 1.2).sum()), 'minimumProteinLigandDistanceA': float(d.min())}


def qualify(case, evidence, output):
    folder = evidence / 'reference/files' / case['systemId']
    ref = reference(case, folder)
    save(output / case['caseId'] / 'reference.json', ref)
    ref_atoms = pdb_atoms(ref['result']['pdb'])
    crystal = ligand_mol(ref['result'], ref_atoms, case['smiles'])
    observed = {r['sequenceIndex'] for r in ref['observedResidues']}
    poses = []
    for published in case['publishedHits']:
        path = evidence / 'native/files' / case['systemId'] / f'seed-{published["seed"]}_sample-{published["sample"]}.cif'
        record = {'caseId': case['caseId'], 'method': 'native-boltz2-published-rnp', 'seed': int(published['seed']),
                  'sample': int(published['sample']), 'publishedRmsdA': float(published['rmsd']),
                  'nativeFile': str(path.relative_to(evidence)), 'nativeOutputSha256': sha(path.read_bytes())}
        try:
            _, records = rows(path)
            if {a['chain'] for a in records} != {'A', 'B'}:
                raise ValueError('Expected original single-protein A and single-ligand B output')
            atoms, _ = protein(records, 'A', case['sequence'], complete=True)
            native = positioned_native(case['smiles'], records)
            r = result(atoms, native, native=True)
            predicted_atoms = pdb_atoms(r['pdb'])
            filtered = [a for a in predicted_atoms if a['record'] != 'ATOM' or int(a['residue']) in observed]
            transform, ca_rmsd = fit_proteins(ref_atoms, filtered)
            ligand = ligand_mol(r, predicted_atoms, case['smiles'], transform)
            rmsd = float(rdMolAlign.CalcRMS(ligand, crystal, maxMatches=1000000, symmetrizeConjugatedTerminalGroups=True))
            stereo = stereo_diagnostic(ligand)
            g = geometry(filtered, ligand_mol(r, predicted_atoms, case['smiles']))
            record.update(status='complete', ligandRmsdA=rmsd, proteinCaRmsdA=ca_rmsd, alignedCa=len(observed),
                          stereochemistry=stereo, predictedGeometry=g, within2A=rmsd < 2,
                          limitedValidityPass=stereo['stereochemicalIdentityMatches'] and g['severeHeavyAtomPairsUnder1_2A'] == 0)
        except Exception as e:
            record.update(status='excluded', error=str(e))
        poses.append(record)
    return poses


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--pool', type=Path, required=True)
    p.add_argument('--evidence', type=Path, required=True)
    p.add_argument('--parser-source', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    a.output.mkdir(exist_ok=False)
    pool = json.loads(a.pool.read_bytes())
    # Verify every selected member, not only those that happen to qualify.
    for kind in ['native', 'reference']:
        root = a.evidence / kind
        receipt = json.loads((root / 'receipt.json').read_bytes())
        ledger = (root / 'members.jsonl').read_bytes()
        if receipt['status'] != 'complete' or not receipt['officialArchiveChecksumVerified'] or receipt['poolSha256'] != sha(a.pool.read_bytes()) or sha(ledger) != receipt['inventorySha256']:
            raise ValueError('Source receipt/pool/inventory identity mismatch')
        for line in ledger.splitlines():
            entry = json.loads(line)
            relative = Path(entry['file'])
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Unsafe evidence path')
            data = (root / 'files' / relative).read_bytes()
            if len(data) != entry['bytes'] or sha(data) != entry['sha256']:
                raise ValueError('Source member integrity mismatch')
    poses, summaries = [], []
    for case in pool['candidates']:
        try:
            scores = qualify(case, a.evidence, a.output)
            poses.extend(scores)
            hits = [s for s in scores if s.get('within2A')]
            summary = {'caseId': case['caseId'], 'systemId': case['systemId'], 'similarityBin': case['similarityBin'],
                       'nativeHits': len(hits), 'nativeBestA': min((s['ligandRmsdA'] for s in hits), default=None),
                       'nativeHasStereoClashPassingHit': any(s['limitedValidityPass'] for s in hits), 'status': 'qualified' if hits else 'excluded'}
        except Exception as e:
            summary = {'caseId': case['caseId'], 'systemId': case['systemId'], 'similarityBin': case['similarityBin'], 'status': 'excluded', 'error': str(e)}
        summaries.append(summary)
        print(json.dumps(summary), flush=True)
    report = {'schema': 'molarium.rnp-native-qualification.v1', 'createdAt': datetime.now(timezone.utc).isoformat(),
              'poolSha256': sha(a.pool.read_bytes()), 'poses': poses, 'summary': summaries,
              'analysisScripts': {n: sha(Path(__file__).with_name(n).read_bytes()) for n in ['rnp_qualify.py','pose_metrics.py','experimental_reference.py']},
              'nativeNamingSource': {'tag': 'v2.2.1', 'sha256': sha(a.parser_source.read_bytes()),
                                    'rule': 'MolFromSmiles; AddHs; CanonicalRankAtoms; symbol.upper()+str(rank+1); RemoveHs. No coordinates enter this mapping.',
                                    'limitation': 'Reconstructed input graph. The original processed RDKit cache and exact historical RDKit version were not published; a matching native cache is not asserted.'},
              'environment': {'python': platform.python_version(), 'numpy': np.__version__, 'rdkit': Chem.rdBase.rdkitVersion},
              'alignment': 'Every observed corresponding protein C-alpha; no trimming, pocket fit or ligand fit.',
              'threshold': 'strictly <2 A', 'neuralForwards': 0}
    save(a.output / 'scores.json', report)
    print(json.dumps({'qualified': sum(s['status']=='qualified' for s in summaries),
                      'byBin': [sum(s['status']=='qualified' and s['similarityBin']==b for s in summaries) for b in range(4)]}))


if __name__ == '__main__':
    main()
