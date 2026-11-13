"""Compare exposed stock-native and production-JS inputs, without a model run.

Chemical correspondence uses declared graphs/stereo, never coordinate fitting.
Only a single unmodified protein plus one atomized SMILES ligand is supported.
Uncompared fields are explicitly retained in the report rather than called equal.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from rdkit import Chem
from feature_snapshot import load_snapshot

NATIVE_TO_BROWSER = np.array(list(range(21)) + [22, 23, 24, 25, 30, 26, 27, 28, 29, 30, 21])


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def stats(left, right):
    left, right = np.asarray(left), np.asarray(right)
    if left.shape != right.shape:
        raise ValueError(f'Comparison shape mismatch: {left.shape} != {right.shape}')
    finite = np.isfinite(left) & np.isfinite(right)
    delta = left.astype(np.float64) - right.astype(np.float64)
    return {'shape': list(left.shape), 'values': int(left.size),
            'differentValues': int(np.count_nonzero(left != right)),
            'nonFiniteValues': int(np.count_nonzero(~finite)),
            'maxAbsoluteDifference': float(np.max(np.abs(delta[finite]), initial=0)),
            'rmsDifference': float(np.sqrt(np.mean(delta[finite] ** 2))) if finite.any() else None,
            'exact': bool(finite.all() and np.array_equal(left, right))}


def adjacency(mol):
    return np.asarray(Chem.GetAdjacencyMatrix(mol))


def alphabet_profile(native):
    """Merge only the two native nucleic unknown categories into JS's shared one."""
    if native.shape[-1] != 32:
        raise ValueError('Expected the documented 32-category native alphabet')
    out = np.zeros(native.shape[:-1] + (31,), dtype=native.dtype)
    for i, j in enumerate(NATIVE_TO_BROWSER):
        out[..., j] += native[..., i]
    return out


def atom_name_codes(one_hot):
    if not np.all((one_hot == 0) | (one_hot == 1)) or not np.all(one_hot.sum(-1) == 1):
        raise ValueError('Native atom names must be explicit one-hot character features')
    return one_hot.argmax(-1)


def names(codes):
    return [''.join(chr(int(c) + 32) for c in row).strip() for row in codes]


def graph_maps(native_smiles, browser_smiles):
    native, browser = Chem.MolFromSmiles(native_smiles), Chem.MolFromSmiles(browser_smiles)
    if native is None or browser is None:
        raise ValueError('Invalid declared SMILES')
    if Chem.MolToSmiles(native, isomericSmiles=True) != Chem.MolToSmiles(browser, isomericSmiles=True):
        raise ValueError('Declared chemical state or specified stereochemistry differs')
    mappings = native.GetSubstructMatches(browser, uniquify=False, useChirality=True, maxMatches=100001)
    if not mappings or len(mappings) >= 100001:
        raise ValueError('No complete, exhaustively enumerated chemical correspondence')
    if native.GetNumAtoms() != browser.GetNumAtoms() or native.GetNumBonds() != browser.GetNumBonds():
        raise ValueError('Chemical correspondence would drop atoms/bonds')
    # Same spelling certifies the same parser order, including symmetric atoms.
    chosen = tuple(range(browser.GetNumAtoms())) if native_smiles == browser_smiles else min(mappings)
    if chosen not in mappings:
        raise ValueError('Identity parser order is not a stereo-compatible graph map')
    return native, browser, sorted(mappings), chosen


def compare(native_dir, browser_dir, library_path, inputs_dir):
    native_dir, browser_dir, library_path, inputs_dir = map(Path, [native_dir, browser_dir, library_path, inputs_dir])
    nr = json.loads((native_dir / 'receipt.json').read_bytes())
    br = json.loads((browser_dir / 'receipt.json').read_bytes())
    if nr['status'] != 'complete' or nr['forwardCalls'] != 0 or nr['capturedBatches'] != 1:
        raise ValueError('Requires a completed, zero-forward native feature capture')
    for f in nr['outputs']:
        if sha(native_dir / f['path']) != f['sha256']:
            raise ValueError('Native captured output changed')
    actual = {str(f.relative_to(inputs_dir)): sha(f) for f in inputs_dir.rglob('*') if f.is_file()}
    if actual != nr['inputFiles'] or sha(inputs_dir / 'comparison.json') != nr['inputSha256']:
        raise ValueError('Consumed native input files changed')
    if sha(library_path) != br['librarySha256']:
        raise ValueError('Saved browser library changed')
    for name, digest in br['outputs'].items():
        if sha(browser_dir / name) != digest:
            raise ValueError('Browser reconstructed output changed')
    spec = json.loads((inputs_dir / 'comparison.json').read_bytes())
    library = json.loads(library_path.read_bytes())
    pose = next(p for p in library['poses'] if p['seed'] == br['seed'] and p['status'] == 'complete')
    component = pose['result']['component']
    if br['sequence'] != spec['sequence'] or br['smiles'] != component['smiles']:
        raise ValueError('Capture and input sequence/SMILES differ')
    # JS JSON.stringify insertion order and Unicode spelling are retained in this artifact.
    compact = json.dumps(component, ensure_ascii=False, separators=(',', ':'))
    if hashlib.sha256(compact.encode()).hexdigest() != br['inputComponentSha256']:
        raise ValueError('Saved browser input component changed')
    native_smiles = spec['compounds'][0]['smiles']
    control = nr.get('processedSmilesControl')
    if control:
        if control['sourceLibrarySha256'] != sha(library_path) or control['originalSmiles'] != native_smiles:
            raise ValueError('Processed-SMILES control source changed')
        native_smiles = control['processedSmiles']
    n, nm = load_snapshot(native_dir / 'features')
    b, bm = load_snapshot(browser_dir)
    nt = lambda key: np.asarray(n[key])[0]
    tokens, dense = b['tokens'], b['dense']
    if tokens != len(nt('token_index')) or b['sequence'] != spec['sequence'] or len(b['chains']) != 1:
        raise ValueError('Unsupported sequence/token correspondence')
    if len(b['ligandSpans']) != 1 or b['modifiedSpans']:
        raise ValueError('Only one ligand and no modified residues are supported')
    span = b['ligandSpans'][0]; protein = span['from']; count = span['count']
    if protein != len(spec['sequence']) or protein + count != tokens:
        raise ValueError('Expected a protein prefix and one ligand-token suffix')
    if not np.array_equal(nt('is_ligand'), b['isLigand']):
        raise ValueError('Ligand token membership differs')
    active = np.flatnonzero(b['predDenseAtomMask'])
    bt = active // dense
    if len(active) != len(nt('atom_mask')) or not np.all(nt('atom_mask') == 1):
        raise ValueError('Incomplete/unexpected atom coverage')
    native_codes = atom_name_codes(nt('ref_atom_name_chars'))
    browser_codes = b['refAtomNameChars'].reshape(-1, 4)[active]
    nn, bn = names(native_codes), names(browser_codes)
    native_atoms_per_token = nt('num_atoms_per_token')
    nat = nt('atom_to_token_index')
    if not np.array_equal(np.bincount(nat, minlength=tokens), native_atoms_per_token):
        raise ValueError('Native atom/token layout inconsistent')
    ligand_atoms = np.flatnonzero(nat >= protein)
    if len(ligand_atoms) != count or not np.array_equal(nat[ligand_atoms], np.arange(protein, tokens)):
        raise ValueError('Expected one native atom per ligand token in parser order')
    n_mol, b_mol, mappings, chosen = graph_maps(native_smiles, component['smiles'])
    if n_mol.GetNumAtoms() != count or len(component['atoms']) != count:
        raise ValueError('Ligand graph atom coverage differs')
    n_element = nt('ref_element').argmax(-1) + 1
    if not np.all(nt('ref_element').sum(-1) == 1):
        raise ValueError('Expected one-hot native element encoding')
    b_element = b['refElement'][active]
    b_charge = b['refCharge'][active]
    n_graph_element = [a.GetAtomicNum() for a in n_mol.GetAtoms()]
    b_graph_element = [a.GetAtomicNum() for a in b_mol.GetAtoms()]
    if not np.array_equal(n_element[ligand_atoms], n_graph_element) or not np.array_equal(b_element[bt >= protein], b_graph_element):
        raise ValueError('Feature ligand order does not match its declared SMILES parser order')
    if not np.array_equal(nt('ref_charge')[ligand_atoms], [a.GetFormalCharge() for a in n_mol.GetAtoms()]):
        raise ValueError('Native feature formal charges differ from declared graph')
    if not np.array_equal(b_charge[bt >= protein], [a.GetFormalCharge() for a in b_mol.GetAtoms()]):
        raise ValueError('Browser feature formal charges differ from declared graph')
    if [a['element'] for a in component['atoms']] != b_graph_element:
        raise ValueError('Saved component does not retain its SMILES parser order')
    component_edges = {(min(e['from'], e['to']), max(e['from'], e['to'])): float(e['order']) for e in component['bonds']}
    parsed_edges = {(min(e.GetBeginAtomIdx(), e.GetEndAtomIdx()), max(e.GetBeginAtomIdx(), e.GetEndAtomIdx())):
                    4.0 if e.GetIsAromatic() else e.GetBondTypeAsDouble() for e in b_mol.GetBonds()}
    if component_edges != parsed_edges:
        raise ValueError('Saved component indexed bond orders differ from declared graph')
    native_bonds, browser_bonds = nt('token_bonds'), b['bondMatrix'].reshape(tokens, tokens)
    if not np.array_equal(native_bonds[protein:, protein:], adjacency(n_mol)) or not np.array_equal(browser_bonds[protein:, protein:], adjacency(b_mol)):
        raise ValueError('Feature ligand adjacency does not certify the declared parser order')
    nlookup = {(int(t), name): i for i, (t, name) in enumerate(zip(nat, nn)) if t < protein}
    if len(nlookup) != np.count_nonzero(nat < protein):
        raise ValueError('Duplicate native protein atom names')
    atom_map = [nlookup[(int(t), name)] if t < protein else int(ligand_atoms[chosen[int(t) - protein]]) for t, name in zip(bt, bn)]
    if len(set(atom_map)) != len(active):
        raise ValueError('Atom map is incomplete or non-bijective')
    token_map = np.array(list(range(protein)) + [protein + i for i in chosen])
    inv_token = np.argsort(token_map)
    atom_map = np.array(atom_map)
    fields = {}
    def add(name, x, y):
        fields[name] = stats(x, y)
    for nk, bk in [('token_mask','seqMask'),('residue_index','residueIndex'),('token_index','tokenIndex'),('asym_id','asymId'),('entity_id','entityId'),('sym_id','symId'),('is_ligand','isLigand'),('is_rna','isRna'),('is_dna','isDna')]:
        add(nk, nt(nk)[token_map], b[bk])
    for nk, bk in [('ref_mask','refMask'),('ref_charge','refCharge'),('ref_space_uid','refSpaceUid'),('atom_mask','predDenseAtomMask')]:
        add(nk, nt(nk)[atom_map], b[bk][active])
    add('ref_element', n_element[atom_map], b_element)
    add('ref_atom_name_chars', native_codes[atom_map], browser_codes)
    add('atom_to_token_index', inv_token[nat[atom_map]], bt)
    add('token_bonds', native_bonds[np.ix_(token_map, token_map)], browser_bonds)
    add('restype', NATIVE_TO_BROWSER[nt('restype').argmax(-1)[token_map]], b['aatype'])
    add('msa', NATIVE_TO_BROWSER[nt('msa')[:, token_map]], b['msa'].reshape(b['sequences'], tokens))
    add('msa_mask', nt('msa_mask')[:, token_map], b['msaMask'].reshape(b['sequences'], tokens))
    add('profile', alphabet_profile(nt('profile'))[token_map], b['profile'].reshape(tokens, 31))
    add('deletion_mean', nt('deletion_mean')[token_map], b['deletionMean'])
    deletion = b['deletionMatrix'].reshape(b['sequences'], tokens)
    add('has_deletion', nt('has_deletion')[:, token_map], deletion > 0)
    add('deletion_value', nt('deletion_value')[:, token_map], (np.arctan(deletion.astype(np.float32) / 3) * np.float32(2 / np.pi)).astype(np.float32))
    add('ref_pos_raw', nt('ref_pos')[atom_map], b['refPos'].reshape(-1, 3)[active])
    labels = nt('ref_space_uid')[atom_map]; blabels = b['refSpaceUid'][active]
    partitions_match = np.array_equal(labels[:, None] == labels[None, :], blabels[:, None] == blabels[None, :])
    distance_delta = []
    separated_distances = {'protein': [], 'ligand': []}
    if partitions_match:
        xyz = nt('ref_pos')[atom_map]; bxyz = b['refPos'].reshape(-1,3)[active]
        for group in np.unique(labels):
            indices = np.flatnonzero(labels == group)
            if len(indices) < 2:
                continue
            # Invariant diagnostic only; no rotation/translation fit or atom remapping by distance.
            x,y = xyz[indices].astype(float), bxyz[indices].astype(float)
            rows,cols = np.triu_indices(len(indices), 1)
            differences = (np.linalg.norm(x[:,None]-x[None,:],axis=-1)-np.linalg.norm(y[:,None]-y[None,:],axis=-1))[rows,cols].tolist()
            distance_delta.extend(differences)
            group_kind = 'protein' if np.all(bt[indices] < protein) else 'ligand'
            separated_distances[group_kind].extend(differences)
    mismatch_counts = [int(np.count_nonzero(native_codes[ligand_atoms[np.array(mapping)]] != browser_codes[bt >= protein])) for mapping in mappings]
    name_counts = [int(np.count_nonzero(np.any(native_codes[ligand_atoms[np.array(mapping)]] != browser_codes[bt >= protein], axis=1))) for mapping in mappings]
    return {'schema':'molarium.cofold-semantic-feature-comparison.v1',
            'scope':'Exposed tensor-feature audit only; no trained-model/kernel/trajectory numerical parity claim.',
            'sources':{'nativeReceiptSha256':sha(native_dir/'receipt.json'),'browserReceiptSha256':sha(browser_dir/'receipt.json'),'librarySha256':sha(library_path),'nativeSnapshotSha256':sha(native_dir/'features/features.json'),'browserSnapshotSha256':sha(browser_dir/'features.json')},
            'coverage':{'tokens':tokens,'proteinTokens':protein,'ligandTokens':count,'activeAtoms':len(active),'nativeArrays':len(nm['arrays']),'browserArrays':len(bm['arrays']),'atomsDropped':0},
            'chemicalCorrespondence':{'basis':'Declared isomeric SMILES, indexed element/formal-charge/adjacency certificates; no coordinates. Native tensor bond orders and stereo are not independently encoded in this certificate.',
                 'sameSmilesSpelling':native_smiles==component['smiles'],'stereoCompatibleGraphMaps':len(mappings),'selection':'identity parser order' if native_smiles==component['smiles'] else 'lexicographically first stereo-compatible graph map',
                 'nativeLigandAtomForBrowserLigandAtom':list(chosen),'ligandNameMismatchesAcrossAllMaps':{'min':min(name_counts),'max':max(name_counts)},'ligandCharacterMismatchesAcrossAllMaps':{'min':min(mismatch_counts),'max':max(mismatch_counts)}},
            'fields':fields,'referenceCoordinateDiagnostics':{'refSpacePartitionsEqual':bool(partitions_match),'intraSpacePairDistanceDifference':stats(np.array(distance_delta),np.zeros(len(distance_delta))),
                 'byMolecularKind':{k:stats(np.array(v),np.zeros(len(v)))for k,v in separated_distances.items()},
                 'interpretation':'Raw coordinates include independent conformer generation and random augmentation; pair distances remove rigid motion only. Neither diagnostic establishes identical coordinate inputs.'},
            'ungraded':{'nativeFields':sorted(set(n)-{'token_index','restype','is_rna','is_dna','is_ligand','token_mask','num_atoms_per_token','atom_mask','residue_index','asym_id','entity_id','sym_id','token_bonds','atom_to_token_index','ref_pos','ref_mask','ref_element','ref_charge','ref_atom_name_chars','ref_space_uid','msa','has_deletion','deletion_value','deletion_mean','profile','msa_mask'}),
                'notes':['Native metadata AtomArray retained by type only.','Browser query/key gather padding, pseudo-beta gathers and dynamically built empty templates are not compared to native model internals.','Pairwise relative-position feature encoding and all trained-model computations remain untested here.']}}


def main():
    parser=argparse.ArgumentParser()
    for key in ['native','browser','library','inputs','output']:
        parser.add_argument('--'+key,type=Path,required=True)
    a=parser.parse_args();report=compare(a.native,a.browser,a.library,a.inputs)
    with a.output.open('x')as f:
        f.write(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print(json.dumps({'output':str(a.output),'nonexactFields':[k for k,v in report['fields'].items()if not v['exact']]}))


if __name__=='__main__':main()
