// Structural preparation and numerical parameter validity are separate facts.
export function hasPreparationHistory(molecule) {
  return Boolean(molecule?.parameterization?.system
    || molecule?.preparation?.lastSuccessfulParameterization
    || molecule?.preparation?.audit?.parameterization?.forcefield);
}

export function invalidateNumericalParameters(molecule) {
  const parameters = molecule.parameterization;
  if (parameters?.system) {
    molecule.preparation = { ...molecule.preparation,
      lastSuccessfulParameterization:{ forcefield:parameters.forcefield || null,
        chargeModel:parameters.chargeModel || null, sourceSha256:parameters.sourceSha256 || null } };
  }
  delete molecule.parameterization;
  delete molecule.dynamicsReadiness;
  if (molecule.preparation) molecule.preparation = { ...molecule.preparation, parameterized:false };
}

// Exact coordinates, topology, numerical parameters, engine and potential-energy
// settings. The coordinate-free context is used only with an exact saved MD frame.
// Deliberately exclude temperature, duration and display-only metadata.
export async function dynamicsReadinessKey(molecule, method, options, includeCoordinates = true) {
  const input = JSON.stringify({
    atoms:molecule.atoms.map(a => [a.element,a.formalCharge ?? a.charge ?? 0,
      Boolean(a.aromatic),...(includeCoordinates ? [a.x,a.y,a.z] : [])]),
    bonds:molecule.bonds.map(b => [b.a,b.b,b.order ?? 1,Boolean(b.aromatic)]),
    charge:molecule.charge ?? 0, system:molecule.parameterization,
    method, implicitSolvent:options.implicitSolvent,
    constraintMode:options.constraintMode, nonbondedCutoffNm:options.nonbondedCutoffNm,
  });
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest),b => b.toString(16).padStart(2,'0')).join('');
}

// Only an exact saved frame qualifies. No tolerance that might hide an edit.
export function matchesRecordedDynamicsFrame(molecule, frames) {
  return frames.some(frame => frame.positions?.length === molecule.atoms.length * 3
    && molecule.atoms.every((atom,i) => ['x','y','z'].every((axis,j) =>
      Number.isFinite(atom[axis]) && atom[axis] === frame.positions[i * 3 + j])));
}

export function usableMinimization(result, atomCount, options = {}) {
  return Number(options.maxIterations ?? 750) > 0
    && options.movableAtomIndices == null && options.fixedAtomIndices == null
    && result.converged !== false
    && Number.isFinite(result.initialEnergy) && Number.isFinite(result.finalEnergy)
    && result.finalEnergy <= result.initialEnergy + 1e-6
    && result.positions?.length === atomCount * 3
    && Array.from(result.positions).every(Number.isFinite);
}
