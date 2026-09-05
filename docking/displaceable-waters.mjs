const WATER_NAMES = new Set(['HOH', 'WAT', 'H2O', 'TIP3', 'TIP3P']);

function squaredDistance(first, second) {
  return (Number(first.x) - Number(second.x)) ** 2
    + (Number(first.y) - Number(second.y)) ** 2
    + (Number(first.z) - Number(second.z)) ** 2;
}

// A crystallographic water is an observed solvent site, not a covalent part of
// the receptor. When ligand growth occupies that volume, the complete water
// molecule must be allowed to leave during induced-fit relaxation instead of
// acting as an immovable steric veto.
export function displaceableWaterPlan({ molecule, ligandAtomIndices,
  maximumOxygenDistanceAngstrom = 2.8 } = {}) {
  if (!molecule?.atoms?.length) throw new Error('Displaceable-water analysis requires a molecule');
  const threshold = Number(maximumOxygenDistanceAngstrom);
  if (!Number.isFinite(threshold) || threshold <= 0)
    throw new Error('Displaceable-water distance must be positive');
  const ligand = [...new Set(Array.from(ligandAtomIndices || [], Number))]
    .filter((index) => molecule.atoms[index]?.element !== 'H');
  if (!ligand.length) return { schema:'molarium.displaceable-water-plan/v1',
    criterion:`water oxygen within ${threshold} Å of a ligand heavy atom`,
    maximumOxygenDistanceAngstrom:threshold, waters:[], atomIndices:[] };
  const groups = new Map();
  molecule.atoms.forEach((atom, index) => {
    if (!WATER_NAMES.has(String(atom.residueName || '').toUpperCase())) return;
    const key = `${atom.chain || 'A'}:${atom.residueIndex ?? ''}:${atom.insertionCode || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(index);
  });
  const waters = [...groups].flatMap(([key, atomIndices]) => {
    const oxygenIndex = atomIndices.find((index) => molecule.atoms[index]?.element === 'O');
    if (!Number.isInteger(oxygenIndex)) return [];
    const minimumSquared = Math.min(...ligand.map((index) =>
      squaredDistance(molecule.atoms[oxygenIndex], molecule.atoms[index])));
    if (minimumSquared > threshold ** 2) return [];
    const oxygen = molecule.atoms[oxygenIndex];
    return [{ key, residueName:oxygen.residueName, chain:oxygen.chain || 'A',
      residueIndex:oxygen.residueIndex, insertionCode:oxygen.insertionCode || '',
      oxygenAtomId:oxygen.designAtomId || null,
      minimumLigandDistanceAngstrom:Math.sqrt(minimumSquared),
      atomIndices:[...atomIndices].sort((a, b) => a - b) }];
  }).sort((first, second) => first.key.localeCompare(second.key));
  return { schema:'molarium.displaceable-water-plan/v1',
    criterion:`water oxygen within ${threshold} Å of a ligand heavy atom`,
    maximumOxygenDistanceAngstrom:threshold, waters,
    atomIndices:[...new Set(waters.flatMap((water) => water.atomIndices))]
      .sort((a, b) => a - b) };
}
