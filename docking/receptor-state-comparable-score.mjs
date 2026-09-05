function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

/**
 * Return a pose score that can be compared across receptor conformations.
 *
 * Pose propagation deliberately subtracts the fixed-core starting interaction
 * when it ranks poses within one receptor state.  That reference changes when
 * the receptor conformation changes, so the reference-subtracted total must
 * never be used to choose between receptor branches.  This score restores the
 * unnormalized receptor-ligand interaction and adds the same weighted,
 * relative ligand-strain term used by pose propagation.
 *
 * This is a pose-ranking quantity, not a binding free energy.  In particular,
 * it does not include receptor conformational free energy or solvent free
 * energy.
 */
export function receptorStateComparablePoseScore(physical = {}) {
  const interactionKcalMol = finite(
    physical.absoluteInteractionKcalMol ?? physical.interactionKcalMol,
    'Unnormalized receptor-ligand interaction');
  const ligandStrainKcalMol = finite(physical.ligandStrainKcalMol,
    'Relative ligand strain');
  const ligandStrainWeight = physical.ligandStrainWeight == null
    ? 1 : finite(physical.ligandStrainWeight, 'Ligand-strain weight');
  const weightedLigandStrainKcalMol = physical.weightedLigandStrainKcalMol == null
    ? ligandStrainKcalMol * ligandStrainWeight
    : finite(physical.weightedLigandStrainKcalMol, 'Weighted relative ligand strain');
  return {
    energyKcalMol:interactionKcalMol + weightedLigandStrainKcalMol,
    interactionKcalMol,
    ligandStrainKcalMol,
    ligandStrainWeight,
    weightedLigandStrainKcalMol,
    scoreIdentity:'unnormalized receptor-ligand interaction + weighted relative ligand strain',
    interpretation:'cross-receptor-state pose-ranking score; excludes receptor and solvent free energies; not a binding free energy',
  };
}

export function compareReceptorStatePoses(first, second) {
  const delta = receptorStateComparablePoseScore(first.physical).energyKcalMol
    - receptorStateComparablePoseScore(second.physical).energyKcalMol;
  if (delta) return delta;
  return String(first.id ?? '').localeCompare(String(second.id ?? ''));
}
