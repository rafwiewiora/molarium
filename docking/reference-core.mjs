function atomIdentityBase(atom, ordinal, namespace) {
  if (atom?.record && atom?.atomName) {
    return [namespace, atom.record, atom.chain || '', atom.residueName || '',
      atom.residueIndex ?? '', atom.insertionCode || '', atom.atomName, atom.serial ?? ''].join(':');
  }
  return `${namespace}:design:${ordinal + 1}`;
}

function maximumTriangleDoubleArea(referencePositions, referenceAtomIndices) {
  let maximum = 0;
  for (let first = 0; first < referenceAtomIndices.length; first++)
    for (let second = first + 1; second < referenceAtomIndices.length; second++)
      for (let third = second + 1; third < referenceAtomIndices.length; third++) {
        const offsets = [first, second, third].map((position) => referenceAtomIndices[position] * 3);
        const ab = [0, 1, 2].map((axis) =>
          referencePositions[offsets[1] + axis] - referencePositions[offsets[0] + axis]);
        const ac = [0, 1, 2].map((axis) =>
          referencePositions[offsets[2] + axis] - referencePositions[offsets[0] + axis]);
        maximum = Math.max(maximum, Math.hypot(
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ));
      }
  return maximum;
}

export function ensureStableAtomIds(molecule, namespace = 'molarium', reservedIds = []) {
  if (!molecule?.atoms?.length) throw new Error('A molecule with atoms is required');
  const used = new Set([
    ...Array.from(molecule.source?.designAtomIdLedger || []).filter(Boolean),
    ...Array.from(reservedIds || []).filter(Boolean),
    ...molecule.atoms.map((atom) => atom.designAtomId).filter(Boolean),
  ]);
  molecule.atoms.forEach((atom, ordinal) => {
    if (atom.designAtomId) return;
    const base = atomIdentityBase(atom, ordinal, namespace);
    let id = base, suffix = 1;
    while (used.has(id)) id = `${base}:${++suffix}`;
    atom.designAtomId = id;
    used.add(id);
  });
  molecule.source = { ...(molecule.source || {}), designAtomIdLedger:[...used].sort() };
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
  const coreSet = new Set(core);
  const connectedCore = new Set([core[0]]);
  const queue = [core[0]];
  while (queue.length) {
    const atomIndex = queue.shift();
    molecule.bonds.forEach((bond) => {
      const neighbor = bond.a === atomIndex ? bond.b : bond.b === atomIndex ? bond.a : null;
      if (neighbor != null && coreSet.has(neighbor) && !connectedCore.has(neighbor)) {
        connectedCore.add(neighbor); queue.push(neighbor);
      }
    });
  }
  if (connectedCore.size !== core.length)
    throw new Error('The reference core must be one connected set of ligand heavy atoms');
  const ligandPositions = Float64Array.from(indices.flatMap((index) => {
    const atom = molecule.atoms[index];
    return [atom.x, atom.y, atom.z];
  }));
  const ligandIndex = new Map(indices.map((globalIndex, localIndex) => [globalIndex, localIndex]));
  const coreReferenceIndices = core.map((globalIndex) => ligandIndex.get(globalIndex));
  const maximumTriangleDoubleAreaValue = maximumTriangleDoubleArea(ligandPositions,
    coreReferenceIndices);
  if (maximumTriangleDoubleAreaValue < 1e-3)
    throw new Error('The reference core is collinear; select three or more atoms that define a plane');
  return {
    schema:'molarium.docking.reference/v1',
    label:molecule.name || 'reference ligand',
    atomIds:indices.map((index) => molecule.atoms[index].designAtomId),
    elements:indices.map((index) => molecule.atoms[index].element),
    positions:ligandPositions,
    coreAtomIds:core.map((index) => molecule.atoms[index].designAtomId),
    coreMaximumTriangleDoubleAreaAngstrom2:maximumTriangleDoubleAreaValue,
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

// A recorded edit preserves designAtomId values.  That gives a stronger,
// auditable correspondence than an inferred MCS: all surviving heavy atoms can
// inherit their exact reference coordinates, while the new graph remains free.
export function mapSurvivingReferenceAtoms(reference, candidateAtoms, { heavyOnly = true } = {}) {
  if (!reference?.atomIds?.length || !reference?.positions?.length)
    throw new Error('A captured reference ligand is required');
  if (!Array.isArray(candidateAtoms) || !candidateAtoms.length)
    throw new Error('Candidate ligand atoms are required');
  const candidateById = new Map(candidateAtoms.map((atom, index) => [atom.designAtomId, index]));
  const referenceIds = new Set(reference.atomIds);
  const atomPairs = [], mappedAtomIds = [], removedAtomIds = [], changedElementAtomIds = [];
  reference.atomIds.forEach((id, referenceIndex) => {
    if (heavyOnly && reference.elements[referenceIndex] === 'H') return;
    const candidateIndex = candidateById.get(id);
    if (!Number.isInteger(candidateIndex)) { removedAtomIds.push(id); return; }
    if (reference.elements[referenceIndex] !== candidateAtoms[candidateIndex].element) {
      changedElementAtomIds.push(id); return;
    }
    atomPairs.push([referenceIndex, candidateIndex]);
    mappedAtomIds.push(id);
  });
  const addedAtomIds = candidateAtoms
    .filter((atom) => atom.element !== 'H' && !referenceIds.has(atom.designAtomId))
    .map((atom) => atom.designAtomId);
  const maximumTriangleDoubleAreaAngstrom2 = atomPairs.length >= 3
    ? maximumTriangleDoubleArea(reference.positions, atomPairs.map(([referenceIndex]) => referenceIndex)) : 0;
  const usable = atomPairs.length >= 3 && maximumTriangleDoubleAreaAngstrom2 >= 1e-3;
  const reason = atomPairs.length < 3
    ? 'Pose propagation requires at least three surviving heavy atoms'
    : maximumTriangleDoubleAreaAngstrom2 < 1e-3
      ? 'The surviving reference atoms are collinear and cannot define a 3D pose'
      : null;
  return {
    atomPairs, mappedAtomIds, removedAtomIds, changedElementAtomIds, addedAtomIds,
    maximumTriangleDoubleAreaAngstrom2, usable, reason,
  };
}
