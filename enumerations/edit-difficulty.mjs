/**
 * Transparent graph-lineage disruption metric for a chemist-visible edit.
 *
 * This is deliberately not an affinity, synthesis, MCS, or pose-quality score.
 * Persistent atom identities tell us what survived an edit; the score reports
 * how much of the molecular graph changed around those identities.
 */

function atomId(atom) {
  return atom?.atomId || atom?.designAtomId || null;
}

function heavyAtoms(graph) {
  return (graph?.atoms || []).filter((atom) => atom.element !== 'H' && atomId(atom));
}

function heavyBonds(graph, allowedIds) {
  return (graph?.bonds || []).flatMap((bond) => {
    const ids = bond.atomIds || [
      graph.atoms?.[bond.a] && atomId(graph.atoms[bond.a]),
      graph.atoms?.[bond.b] && atomId(graph.atoms[bond.b]),
    ];
    if (!Array.isArray(ids) || ids.length !== 2 || ids.some((id) => !allowedIds.has(id))) return [];
    const sorted = [...ids].sort();
    return [{ key:`${sorted[0]}|${sorted[1]}`, atomIds:sorted,
      order:Number(bond.order || 1), aromatic:Boolean(bond.aromatic || Number(bond.order) === 1.5) }];
  });
}

function componentCount(atomIds, bonds) {
  const adjacency = new Map([...atomIds].map((id) => [id, []]));
  bonds.forEach((bond) => {
    adjacency.get(bond.atomIds[0])?.push(bond.atomIds[1]);
    adjacency.get(bond.atomIds[1])?.push(bond.atomIds[0]);
  });
  let count = 0;
  const visited = new Set();
  for (const start of atomIds) {
    if (visited.has(start)) continue;
    count += 1;
    const queue = [start]; visited.add(start);
    while (queue.length) {
      for (const neighbor of adjacency.get(queue.shift()) || []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      }
    }
  }
  return count;
}

function cycleRank(atoms, bonds) {
  if (!atoms.length) return 0;
  const ids = new Set(atoms.map(atomId));
  return Math.max(0, bonds.length - atoms.length + componentCount(ids, bonds));
}

export function editDifficulty(reference, product, { contactRemapCount = 0 } = {}) {
  if (!Number.isInteger(contactRemapCount) || contactRemapCount < 0)
    throw new Error('contactRemapCount must be a non-negative integer');
  const referenceAtoms = heavyAtoms(reference), productAtoms = heavyAtoms(product);
  const referenceById = new Map(referenceAtoms.map((atom) => [atomId(atom), atom]));
  const productById = new Map(productAtoms.map((atom) => [atomId(atom), atom]));
  const referenceIds = new Set(referenceById.keys()), productIds = new Set(productById.keys());
  const referenceBonds = heavyBonds(reference, referenceIds);
  const productBonds = heavyBonds(product, productIds);
  const referenceBondMap = new Map(referenceBonds.map((bond) => [bond.key, bond]));
  const productBondMap = new Map(productBonds.map((bond) => [bond.key, bond]));
  const retainedIds = [...referenceIds].filter((id) => productIds.has(id));
  const elementSubstitutions = retainedIds.filter((id) =>
    referenceById.get(id).element !== productById.get(id).element).length;
  const addedHeavyAtoms = [...productIds].filter((id) => !referenceIds.has(id)).length;
  const deletedHeavyAtoms = [...referenceIds].filter((id) => !productIds.has(id)).length;
  const sharedBondKeys = [...referenceBondMap.keys()].filter((key) => productBondMap.has(key));
  const bondOrderChangeKeys = sharedBondKeys.filter((key) => {
    const before = referenceBondMap.get(key), after = productBondMap.get(key);
    return before.order !== after.order || before.aromatic !== after.aromatic;
  });
  const addedHeavyBondKeys = [...productBondMap.keys()].filter((key) => !referenceBondMap.has(key));
  const deletedHeavyBondKeys = [...referenceBondMap.keys()].filter((key) => !productBondMap.has(key));
  const bondOrderChanges = bondOrderChangeKeys.length;
  const addedHeavyBonds = addedHeavyBondKeys.length;
  const deletedHeavyBonds = deletedHeavyBondKeys.length;
  const referenceCycleRank = cycleRank(referenceAtoms, referenceBonds);
  const productCycleRank = cycleRank(productAtoms, productBonds);
  const cycleRankChange = Math.abs(productCycleRank - referenceCycleRank);

  const weightedChanges = 2 * (addedHeavyAtoms + deletedHeavyAtoms)
    + 1.5 * elementSubstitutions
    + addedHeavyBonds + deletedHeavyBonds
    + 0.75 * bondOrderChanges
    + 2 * cycleRankChange
    + 1.5 * contactRemapCount;
  const globalNormalizer = Math.max(1,
    2 * Math.max(referenceAtoms.length, productAtoms.length)
      + Math.max(referenceBonds.length, productBonds.length)
      + 2 * Math.max(1, referenceCycleRank));
  const affectedAtomIds = new Set([
    ...[...referenceIds].filter((id) => !productIds.has(id)),
    ...[...productIds].filter((id) => !referenceIds.has(id)),
    ...retainedIds.filter((id) => referenceById.get(id).element !== productById.get(id).element),
  ]);
  for (const key of [...addedHeavyBondKeys, ...deletedHeavyBondKeys, ...bondOrderChangeKeys])
    key.split('|').forEach((id) => affectedAtomIds.add(id));
  const changedHeavyBonds = addedHeavyBonds + deletedHeavyBonds + bondOrderChanges;
  const localNormalizer = Math.max(1,
    2 * affectedAtomIds.size + changedHeavyBonds + 2 * Math.max(1, cycleRankChange));
  const globalScore = Math.min(100, 100 * weightedChanges / globalNormalizer);
  const localScore = Math.min(100, 100 * weightedChanges / localNormalizer);
  const score = Math.max(globalScore, localScore);
  const level = score < 10 ? 'light' : score < 25 ? 'moderate'
    : score < 50 ? 'high' : 'extreme';
  return {
    schema:'molarium.edit-difficulty/v1', score:Number(score.toFixed(2)), level,
    interpretation:'graph-lineage disruption only; lower preserves more of the reference graph',
    formula:{
      weightedChanges:'2*(atoms added+deleted) + 1.5*element substitutions + bonds added+deleted + 0.75*bond-order changes + 2*|cycle-rank change| + 1.5*contact remaps',
      globalNormalizer:'2*max(reference heavy atoms, product heavy atoms) + max(reference heavy bonds, product heavy bonds) + 2*max(1, reference cycle rank)',
      localNormalizer:'2*affected heavy atoms + changed heavy bonds + 2*max(1, |cycle-rank change|)',
      score:'max(global weighted-change percentage, affected-region weighted-change percentage)',
    },
    components:{ referenceHeavyAtoms:referenceAtoms.length, productHeavyAtoms:productAtoms.length,
      retainedHeavyAtoms:retainedIds.length, addedHeavyAtoms, deletedHeavyAtoms,
      elementSubstitutions, referenceHeavyBonds:referenceBonds.length,
      productHeavyBonds:productBonds.length, addedHeavyBonds, deletedHeavyBonds,
      bondOrderChanges, referenceCycleRank, productCycleRank, cycleRankChange,
      contactRemapCount, weightedChanges:Number(weightedChanges.toFixed(3)),
      affectedHeavyAtoms:affectedAtomIds.size, changedHeavyBonds,
      globalNormalizer, localNormalizer, globalScore:Number(globalScore.toFixed(2)),
      localScore:Number(localScore.toFixed(2)) },
  };
}
