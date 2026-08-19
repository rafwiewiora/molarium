function atomIdentityBase(atom, ordinal, namespace) {
  if (atom?.record && atom?.atomName) {
    return [namespace, atom.record, atom.chain || '', atom.residueName || '',
      atom.residueIndex ?? '', atom.insertionCode || '', atom.atomName, atom.serial ?? ''].join(':');
  }
  return `${namespace}:design:${ordinal + 1}`;
}

export function ensureStableAtomIds(molecule, namespace = 'molarium') {
  if (!molecule?.atoms?.length) throw new Error('A molecule with atoms is required');
  const used = new Set(molecule.atoms.map((atom) => atom.designAtomId).filter(Boolean));
  molecule.atoms.forEach((atom, ordinal) => {
    if (atom.designAtomId) return;
    const base = atomIdentityBase(atom, ordinal, namespace);
    let id = base, suffix = 1;
    while (used.has(id)) id = `${base}:${++suffix}`;
    atom.designAtomId = id;
    used.add(id);
  });
  return molecule.atoms.map((atom) => atom.designAtomId);
}

export function captureReferenceLigand(molecule, ligandAtomIndices, coreAtomIndices = null,
  namespace = 'molarium') {
  ensureStableAtomIds(molecule, namespace);
  const indices = [...new Set(Array.from(ligandAtomIndices || [], Number))]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < molecule.atoms.length);
  if (!indices.length) throw new Error('Select a ligand before capturing a docking reference');
  const selected = new Set(indices);
  const core = [...new Set(Array.from(coreAtomIndices || indices, Number))]
    .filter((index) => selected.has(index) && molecule.atoms[index].element !== 'H');
  if (core.length < 3) throw new Error('The reference core needs at least three ligand heavy atoms');
  return {
    schema:'molarium.docking.reference/v1',
    label:molecule.name || 'reference ligand',
    atomIds:indices.map((index) => molecule.atoms[index].designAtomId),
    elements:indices.map((index) => molecule.atoms[index].element),
    positions:Float64Array.from(indices.flatMap((index) => {
      const atom = molecule.atoms[index];
      return [atom.x, atom.y, atom.z];
    })),
    coreAtomIds:core.map((index) => molecule.atoms[index].designAtomId),
    sourceGlobalAtomIndices:indices,
  };
}

export function mapReferenceCore(reference, candidateAtoms) {
  const candidateById = new Map(candidateAtoms.map((atom, index) => [atom.designAtomId, index]));
  const referenceById = new Map(reference.atomIds.map((id, index) => [id, index]));
  const missing = [];
  const atomPairs = reference.coreAtomIds.flatMap((id) => {
    const referenceIndex = referenceById.get(id);
    const candidateIndex = candidateById.get(id);
    if (!Number.isInteger(referenceIndex) || !Number.isInteger(candidateIndex)) {
      missing.push(id); return [];
    }
    if (reference.elements[referenceIndex] !== candidateAtoms[candidateIndex].element) {
      missing.push(id); return [];
    }
    return [[referenceIndex, candidateIndex]];
  });
  return { atomPairs, missingAtomIds:missing, complete:missing.length === 0 && atomPairs.length >= 3 };
}
