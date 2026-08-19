import { ensureStableAtomIds } from './reference-core.mjs';

function uniqueValidIndices(indices, atomCount, label) {
  const result = [...new Set(Array.from(indices || [], Number))];
  if (!result.length || result.some((index) => !Number.isInteger(index)
      || index < 0 || index >= atomCount))
    throw new Error(`${label} must contain unique valid atom indices`);
  return result;
}

function copiedPoint(atom) {
  return { x:Number(atom.x), y:Number(atom.y), z:Number(atom.z) };
}

function atomLabel(atom, index) {
  const residue = atom?.residueName
    ? `${atom.residueName} ${atom.chain || ''}${atom.residueIndex ?? ''}`.trim() : 'ligand';
  return `${residue} ${atom?.atomName || atom?.element || `atom ${index + 1}`}`;
}

export function createLigandPlan(molecule, ligandAtomIndices, namespace = 'molarium') {
  if (!molecule?.atoms?.length) throw new Error('A molecule is required');
  ensureStableAtomIds(molecule, namespace);
  const globalAtomIndices = uniqueValidIndices(ligandAtomIndices, molecule.atoms.length,
    'The ligand selection');
  const selected = new Set(globalAtomIndices);
  const globalToLocal = new Map(globalAtomIndices.map((index, local) => [index, local]));
  const atoms = globalAtomIndices.map((index) => ({ ...molecule.atoms[index] }));
  const bonds = molecule.bonds.flatMap((bond) => selected.has(bond.a) && selected.has(bond.b)
    ? [{ ...bond, a:globalToLocal.get(bond.a), b:globalToLocal.get(bond.b) }] : []);
  return {
    molecule:{
      atoms, bonds,
      name:`${molecule.name || 'structure'} ligand`,
      smiles:molecule.smiles || 'Ligand component',
      charge:atoms.reduce((sum, atom) => sum + Number(atom.formalCharge ?? atom.charge ?? 0), 0),
      multiplicity:1,
      source:{ format:'molarium-docking-ligand', parent:molecule.name || null },
    },
    globalAtomIndices,
    globalToLocal,
  };
}

export function captureCrossHydrogenBonds(molecule, ligandAtomIndices, hydrogenBonds) {
  ensureStableAtomIds(molecule);
  const ligand = new Set(uniqueValidIndices(ligandAtomIndices, molecule.atoms.length,
    'The ligand selection'));
  return Array.from(hydrogenBonds || []).flatMap((bond, ordinal) => {
    const donorIsLigand = ligand.has(bond.donor);
    const hydrogenIsLigand = ligand.has(bond.hydrogen);
    const acceptorIsLigand = ligand.has(bond.acceptor);
    if (donorIsLigand !== hydrogenIsLigand || donorIsLigand === acceptorIsLigand) return [];
    const donor = molecule.atoms[bond.donor];
    const hydrogen = molecule.atoms[bond.hydrogen];
    const acceptor = molecule.atoms[bond.acceptor];
    const ligandDescriptor = (index) => ({ scope:'ligand', designAtomId:molecule.atoms[index].designAtomId });
    const receptorDescriptor = (index) => ({ scope:'receptor', point:copiedPoint(molecule.atoms[index]),
      sourceGlobalAtomIndex:index });
    return [{
      id:`reference-hbond-${ordinal + 1}`,
      label:`${atomLabel(donor, bond.donor)} → ${atomLabel(acceptor, bond.acceptor)}`,
      required:true,
      receptorRole:donorIsLigand ? 'acceptor' : 'donor',
      donor:donorIsLigand ? ligandDescriptor(bond.donor) : receptorDescriptor(bond.donor),
      hydrogen:hydrogenIsLigand ? ligandDescriptor(bond.hydrogen) : receptorDescriptor(bond.hydrogen),
      acceptor:acceptorIsLigand ? ligandDescriptor(bond.acceptor) : receptorDescriptor(bond.acceptor),
      referenceGeometry:{ hydrogenAcceptorDistanceAngstrom:Number(bond.distance), cosine:Number(bond.cosine) },
    }];
  });
}

export function mapCapturedHydrogenBonds(definitions, candidateAtoms, selectedIds = null) {
  const candidateById = new Map(candidateAtoms.map((atom, index) => [atom.designAtomId, index]));
  const selected = selectedIds ? new Set(selectedIds) : null;
  const missing = [];
  const mapped = Array.from(definitions || []).flatMap((definition) => {
    if (selected && !selected.has(definition.id)) return [];
    const participant = (descriptor) => {
      if (descriptor.scope === 'receptor') return { scope:'receptor', point:{ ...descriptor.point } };
      const atomIndex = candidateById.get(descriptor.designAtomId);
      if (!Number.isInteger(atomIndex)) {
        missing.push({ constraintId:definition.id, designAtomId:descriptor.designAtomId });
        return null;
      }
      return { scope:'ligand', atomIndex };
    };
    const donor = participant(definition.donor);
    const hydrogen = participant(definition.hydrogen);
    const acceptor = participant(definition.acceptor);
    if (!donor || !hydrogen || !acceptor) return [];
    return [{ id:definition.id, label:definition.label, required:definition.required !== false,
      receptorRole:definition.receptorRole, donor, hydrogen, acceptor }];
  });
  return { constraints:mapped, missing, complete:missing.length === 0 };
}

export function unpackConformerStack(stack, atomCount) {
  if (!ArrayBuffer.isView(stack) || !Number.isInteger(atomCount) || atomCount < 1)
    throw new Error('A typed conformer stack and atom count are required');
  const stride = atomCount * 3;
  if (!stack.length || stack.length % stride) throw new Error('The conformer stack has an invalid shape');
  return Array.from({ length:stack.length / stride }, (_, index) =>
    Float64Array.from(stack.subarray(index * stride, (index + 1) * stride)));
}

export function applyLigandPositions(molecule, globalAtomIndices, positions) {
  const indices = uniqueValidIndices(globalAtomIndices, molecule.atoms.length, 'The ligand mapping');
  if (!ArrayBuffer.isView(positions) || positions.length !== indices.length * 3)
    throw new Error('Docked ligand coordinates do not match the ligand mapping');
  indices.forEach((globalIndex, localIndex) => {
    const atom = molecule.atoms[globalIndex];
    atom.x = Number(positions[localIndex * 3]);
    atom.y = Number(positions[localIndex * 3 + 1]);
    atom.z = Number(positions[localIndex * 3 + 2]);
  });
  return molecule;
}

export function dockingInputText(molecule, atomIndices) {
  const indices = uniqueValidIndices(atomIndices, molecule.atoms.length, 'The provenance selection');
  const selected = new Set(indices);
  const globalToLocal = new Map(indices.map((index, local) => [index, local]));
  return JSON.stringify({
    atoms:indices.map((index) => {
      const atom = molecule.atoms[index];
      return { designAtomId:atom.designAtomId, element:atom.element, record:atom.record || null,
        atomName:atom.atomName || null, residueName:atom.residueName || null,
        chain:atom.chain || null, residueIndex:atom.residueIndex ?? null,
        x:Number(atom.x), y:Number(atom.y), z:Number(atom.z) };
    }),
    bonds:molecule.bonds.flatMap((bond) => selected.has(bond.a) && selected.has(bond.b)
      ? [{ a:globalToLocal.get(bond.a), b:globalToLocal.get(bond.b), order:Number(bond.order || 1) }] : []),
  });
}

export function dockingTopologyText(molecule, atomIndices) {
  const indices = uniqueValidIndices(atomIndices, molecule.atoms.length, 'The topology selection');
  const selected = new Set(indices);
  const globalToLocal = new Map(indices.map((index, local) => [index, local]));
  return JSON.stringify({
    atoms:indices.map((index) => {
      const atom = molecule.atoms[index];
      return { designAtomId:atom.designAtomId, element:atom.element,
        formalCharge:Number(atom.formalCharge ?? atom.charge ?? 0), aromatic:Boolean(atom.aromatic) };
    }),
    bonds:molecule.bonds.flatMap((bond) => selected.has(bond.a) && selected.has(bond.b)
      ? [{ a:globalToLocal.get(bond.a), b:globalToLocal.get(bond.b), order:Number(bond.order || 1) }] : []),
  });
}
