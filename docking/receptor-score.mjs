const COULOMB_KCAL_ANGSTROM_PER_MOL_E2 = 332.063713299;
const KJ_TO_KCAL = 1 / 4.184;

function finiteTerm(term, label) {
  const normalized = {
    charge_e:Number(term?.charge_e),
    sigma_nm:Number(term?.sigma_nm),
    epsilon_kj:Number(term?.epsilon_kj),
  };
  if (!Object.values(normalized).every(Number.isFinite) || normalized.sigma_nm <= 0
    || normalized.epsilon_kj < 0) throw new Error(`${label} has invalid nonbonded parameters`);
  return normalized;
}

function squaredDistance(first, second) {
  return (first.x - second.x) ** 2 + (first.y - second.y) ** 2 + (first.z - second.z) ** 2;
}

export function pairInteractionKcalMol(first, second, distanceAngstrom,
  { relativeDielectric = 4, maximumRepulsionKcalMol = 1e6 } = {}) {
  const a = finiteTerm(first, 'First atom');
  const b = finiteTerm(second, 'Second atom');
  const r = Number(distanceAngstrom);
  if (!Number.isFinite(r) || r <= 0) return {
    lennardJonesKcalMol:maximumRepulsionKcalMol, coulombKcalMol:0,
    totalKcalMol:maximumRepulsionKcalMol, stericClash:true,
  };
  const sigmaAngstrom = (a.sigma_nm + b.sigma_nm) * 5;
  const epsilonKcalMol = Math.sqrt(a.epsilon_kj * b.epsilon_kj) * KJ_TO_KCAL;
  const ratio6 = (sigmaAngstrom / r) ** 6;
  const rawLennardJones = 4 * epsilonKcalMol * (ratio6 ** 2 - ratio6);
  const lennardJonesKcalMol = Math.min(maximumRepulsionKcalMol, rawLennardJones);
  const dielectric = Number(relativeDielectric);
  if (!Number.isFinite(dielectric) || dielectric <= 0)
    throw new Error('The relative dielectric must be positive');
  const coulombKcalMol = COULOMB_KCAL_ANGSTROM_PER_MOL_E2
    * a.charge_e * b.charge_e / (dielectric * r);
  return {
    lennardJonesKcalMol,
    coulombKcalMol,
    totalKcalMol:lennardJonesKcalMol + coulombKcalMol,
    stericClash:r < sigmaAngstrom * 0.72,
    sigmaAngstrom,
    epsilonKcalMol,
  };
}

export function buildReceptorSite(molecule, ligandAtomIndices, system,
  { radiusAngstrom = 8 } = {}) {
  if (!molecule?.atoms?.length || !Array.isArray(system?.nonbonded)
    || system.nonbonded.length !== molecule.atoms.length)
    throw new Error('A complete parameterized molecular System is required');
  const ligand = new Set(Array.from(ligandAtomIndices || [], Number));
  if (!ligand.size) throw new Error('A ligand selection is required');
  const ligandHeavy = [...ligand].filter((index) => molecule.atoms[index]?.element !== 'H');
  if (!ligandHeavy.length) throw new Error('The ligand selection has no heavy atoms');
  const radius = Number(radiusAngstrom);
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('The receptor-site radius must be positive');
  const limit2 = radius ** 2;
  const receptorAtomIndices = molecule.atoms.flatMap((atom, index) => {
    if (ligand.has(index) || atom.record !== 'ATOM') return [];
    return ligandHeavy.some((ligandIndex) => squaredDistance(atom, molecule.atoms[ligandIndex]) <= limit2)
      ? [index] : [];
  });
  if (!receptorAtomIndices.length) throw new Error('No parameterized protein atoms lie within the receptor-site radius');
  const termsByIndex = new Map(system.nonbonded.map((term, index) =>
    [Number.isInteger(term.index) ? term.index : index, finiteTerm(term, `System atom ${index}`)]));
  const atoms = receptorAtomIndices.map((index) => {
    const nonbonded = termsByIndex.get(index);
    if (!nonbonded) throw new Error(`The molecular System has no nonbonded term for atom ${index}`);
    return {
      globalAtomIndex:index,
      designAtomId:molecule.atoms[index].designAtomId || null,
      element:molecule.atoms[index].element,
      position:{ x:molecule.atoms[index].x, y:molecule.atoms[index].y, z:molecule.atoms[index].z },
      nonbonded,
    };
  });
  return {
    schema:'molarium.docking.receptor-site/v1',
    radiusAngstrom:radius,
    sourceForcefield:molecule.parameterization?.forcefield || null,
    sourceChargeModel:molecule.parameterization?.chargeModel || null,
    atoms,
  };
}

export function receptorSiteIntegrity(site, molecule, toleranceAngstrom = 1e-6) {
  if (!site?.atoms?.length || !molecule?.atoms?.length)
    return { valid:false, missingAtoms:site?.atoms?.length || 0, changedAtoms:0, maximumDisplacementAngstrom:null };
  const byId = new Map(molecule.atoms.map((atom, index) => [atom.designAtomId, { atom, index }]));
  let missingAtoms = 0, changedAtoms = 0, maximumDisplacementAngstrom = 0;
  for (const captured of site.atoms) {
    const current = captured.designAtomId ? byId.get(captured.designAtomId)
      : { atom:molecule.atoms[captured.globalAtomIndex], index:captured.globalAtomIndex };
    if (!current?.atom || current.atom.element !== captured.element) { missingAtoms++; continue; }
    const displacement = Math.sqrt(squaredDistance(current.atom, captured.position));
    maximumDisplacementAngstrom = Math.max(maximumDisplacementAngstrom, displacement);
    if (displacement > toleranceAngstrom) changedAtoms++;
  }
  return { valid:missingAtoms === 0 && changedAtoms === 0, missingAtoms, changedAtoms,
    maximumDisplacementAngstrom, toleranceAngstrom:Number(toleranceAngstrom) };
}

export function scoreReceptorLigand(site, ligandPositions, ligandNonbonded,
  { relativeDielectric = 4, cutoffAngstrom = 8, ligandStrainKcalMol = 0,
    ligandStrainWeight = 1 } = {}) {
  if (ligandPositions.length !== ligandNonbonded.length * 3)
    throw new Error('Ligand coordinates and nonbonded parameters have different atom counts');
  let lennardJonesKcalMol = 0, coulombKcalMol = 0, pairCount = 0, stericClashes = 0;
  const cutoff = Number(cutoffAngstrom);
  if (!Number.isFinite(cutoff) || cutoff <= 0) throw new Error('The interaction cutoff must be positive');
  const cutoff2 = cutoff ** 2;
  for (let ligandAtom = 0; ligandAtom < ligandNonbonded.length; ligandAtom++) {
    const position = { x:ligandPositions[ligandAtom * 3], y:ligandPositions[ligandAtom * 3 + 1],
      z:ligandPositions[ligandAtom * 3 + 2] };
    if (![position.x, position.y, position.z].every(Number.isFinite))
      throw new Error(`Ligand atom ${ligandAtom} has non-finite coordinates`);
    for (const receptor of site.atoms) {
      const distance2 = squaredDistance(position, receptor.position);
      if (distance2 > cutoff2) continue;
      const pair = pairInteractionKcalMol(ligandNonbonded[ligandAtom], receptor.nonbonded,
        Math.sqrt(distance2), { relativeDielectric });
      lennardJonesKcalMol += pair.lennardJonesKcalMol;
      coulombKcalMol += pair.coulombKcalMol;
      stericClashes += Number(pair.stericClash);
      pairCount += 1;
    }
  }
  const strainKcalMol = Number(ligandStrainKcalMol) * Number(ligandStrainWeight);
  const interactionKcalMol = lennardJonesKcalMol + coulombKcalMol;
  return {
    energyKcalMol:interactionKcalMol + strainKcalMol,
    interactionKcalMol,
    lennardJonesKcalMol,
    coulombKcalMol,
    ligandStrainKcalMol:Number(ligandStrainKcalMol),
    ligandStrainWeight:Number(ligandStrainWeight),
    weightedLigandStrainKcalMol:strainKcalMol,
    pairCount,
    stericClashes,
    relativeDielectric:Number(relativeDielectric),
    cutoffAngstrom:cutoff,
    scoreIdentity:`${site.sourceForcefield || 'parameterized receptor'} numeric cross LJ + Coulomb / explicit dielectric + relative RDKit ligand strain`,
    interpretation:'pose-ranking score; not a binding free energy',
  };
}
