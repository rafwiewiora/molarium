import { perceiveFlexibleRings } from './restraint-biased-search.mjs';

function atomId(atom, index, label) {
  const id = atom?.designAtomId;
  if (!id) throw new Error(`${label} atom ${index + 1} has no stable designAtomId`);
  return String(id);
}

function atomIndexById(molecule, label) {
  if (!molecule?.atoms?.length || !Array.isArray(molecule.bonds))
    throw new Error(`${label} must be a complete molecular graph`);
  const entries = new Map();
  molecule.atoms.forEach((atom, index) => {
    const id = atomId(atom, index, label);
    if (entries.has(id)) throw new Error(`${label} repeats stable atom identity ${id}`);
    entries.set(id, index);
  });
  return entries;
}

function canonicalBondKey(firstId, secondId) {
  return firstId < secondId ? `${firstId}\u0000${secondId}` : `${secondId}\u0000${firstId}`;
}

function bondMap(molecule, ids, label) {
  const mapped = new Map();
  molecule.bonds.forEach((bond, index) => {
    const first = molecule.atoms[bond.a], second = molecule.atoms[bond.b];
    if (!first || !second) throw new Error(`${label} bond ${index + 1} has invalid atom indices`);
    const firstId = atomId(first, bond.a, label), secondId = atomId(second, bond.b, label);
    const key = canonicalBondKey(firstId, secondId);
    if (mapped.has(key)) throw new Error(`${label} repeats bond ${firstId}–${secondId}`);
    mapped.set(key, { firstId, secondId, order:Number(bond.order || 1),
      aromatic:Boolean(bond.aromatic), index });
  });
  return mapped;
}

function adjacency(molecule) {
  const entries = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond, bondIndex) => {
    entries[bond.a].push({ atom:bond.b, bondIndex });
    entries[bond.b].push({ atom:bond.a, bondIndex });
  });
  entries.forEach((neighbors) => neighbors.sort((first, second) => first.atom - second.atom));
  return entries;
}

function heavy(atom) { return atom?.element !== 'H'; }

// Compare two committed chemical graphs by stable atom identity. Only edits to
// an existing ring atom or an existing ring bond release that ring. Attaching a
// new methyl to a reference ring therefore does not accidentally release the
// trusted ring pose, while C=C->C-C and N->C transformations do.
export function transformedRingRegion(beforeMolecule, afterMolecule,
  { maximumRingSize = 24 } = {}) {
  const beforeById = atomIndexById(beforeMolecule, 'Before graph');
  const afterById = atomIndexById(afterMolecule, 'After graph');
  const beforeBonds = bondMap(beforeMolecule, beforeById, 'Before graph');
  const afterBonds = bondMap(afterMolecule, afterById, 'After graph');
  const changedAtomIds = new Set(), changedBondKeys = new Set();

  for (const [id, beforeIndex] of beforeById) {
    const afterIndex = afterById.get(id);
    if (!Number.isInteger(afterIndex)) continue;
    const before = beforeMolecule.atoms[beforeIndex], after = afterMolecule.atoms[afterIndex];
    if (before.element !== after.element || Number(before.formalCharge ?? before.charge ?? 0)
      !== Number(after.formalCharge ?? after.charge ?? 0)) changedAtomIds.add(id);
  }
  for (const [key, before] of beforeBonds) {
    const after = afterBonds.get(key);
    if (!after) continue;
    if (Math.abs(before.order - after.order) > 1e-6 || before.aromatic !== after.aromatic) {
      changedBondKeys.add(key); changedAtomIds.add(before.firstId); changedAtomIds.add(before.secondId);
    }
  }

  const changedIndices = new Set([...changedAtomIds].flatMap((id) => {
    const index = afterById.get(id);
    return Number.isInteger(index) && heavy(afterMolecule.atoms[index]) ? [index] : [];
  }));
  const rings = perceiveFlexibleRings(afterMolecule, { maximumRingSize });
  const selectedRings = new Set(rings.flatMap((ring, index) =>
    ring.atomIndices.some((atom) => changedIndices.has(atom)) ? [index] : []));
  // A touched fused system must move as one system. This does not claim that
  // the standalone generator can already sample fused rings; it prevents a
  // partial hard freeze from distorting them during ordinary relaxation.
  let expanded = true;
  while (expanded) {
    expanded = false;
    const selectedAtoms = new Set([...selectedRings].flatMap((index) => rings[index].atomIndices));
    rings.forEach((ring, index) => {
      if (selectedRings.has(index) || !ring.atomIndices.some((atom) => selectedAtoms.has(atom))) return;
      selectedRings.add(index); expanded = true;
    });
  }

  const releasedHeavy = new Set(changedIndices);
  [...selectedRings].forEach((index) => rings[index].atomIndices.forEach((atom) => releasedHeavy.add(atom)));
  const entries = adjacency(afterMolecule);
  // Include directly conjugated/exocyclic multiple-bond atoms such as the
  // cyclohexanone oxygen, but do not absorb a single-bond scaffold attachment.
  for (const atom of [...releasedHeavy]) for (const { atom:neighbor, bondIndex } of entries[atom]) {
    const bond = afterMolecule.bonds[bondIndex];
    if (heavy(afterMolecule.atoms[neighbor])
      && (Number(bond.order || 1) > 1 + 1e-6 || bond.aromatic)) releasedHeavy.add(neighbor);
  }
  const released = new Set(releasedHeavy);
  for (const atom of releasedHeavy) for (const { atom:neighbor } of entries[atom])
    if (!heavy(afterMolecule.atoms[neighbor])) released.add(neighbor);

  const boundary = new Set();
  for (const atom of releasedHeavy) for (const { atom:neighbor } of entries[atom])
    if (!releasedHeavy.has(neighbor) && heavy(afterMolecule.atoms[neighbor])) boundary.add(neighbor);

  const ids = (indices) => [...indices].map((index) => afterMolecule.atoms[index].designAtomId).sort();
  return {
    schema:'molarium.docking.transformed-ring-region/v1',
    changedAtomIds:[...changedAtomIds].sort(), changedBondKeys:[...changedBondKeys].sort(),
    touchedRingCount:selectedRings.size,
    touchedRingAtomIds:ids(new Set([...selectedRings].flatMap((index) => rings[index].atomIndices))),
    releasedAtomIds:ids(released), releasedHeavyAtomIds:ids(releasedHeavy),
    boundaryAtomIds:ids(boundary),
    reason:selectedRings.size ? 'existing-ring-chemistry-changed'
      : changedAtomIds.size ? 'existing-acyclic-chemistry-changed' : 'no-existing-chemistry-change',
  };
}

export function cumulativeReleasedAtomIds(molecule) {
  return [...new Set(Array.from(molecule?.source?.posePropagationEditRegions || [])
    .flatMap((entry) => entry.releasedHeavyAtomIds || []))].sort();
}

export function recordTransformedRingRegion(molecule, region,
  { editId = null, committedAt = new Date().toISOString() } = {}) {
  if (!region?.releasedHeavyAtomIds?.length) return null;
  const entry = { ...structuredClone(region), editId, committedAt:String(committedAt) };
  const history = Array.from(molecule.source?.posePropagationEditRegions || []);
  molecule.source = { ...(molecule.source || {}),
    posePropagationEditRegions:[...history, entry].slice(-64) };
  return entry;
}
