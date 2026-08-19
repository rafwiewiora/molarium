// Shared dynamics configuration for the OpenMM oracle and direct WebGPU path.
// Numeric force-field Systems remain immutable: requested runtime constraints
// are materialized in a shallow copy so cached Sage/Rosemary parameters can be
// reused across flexible and constrained calculations.

const pairKey = (first, second) => first < second ? `${first}:${second}` : `${second}:${first}`;

function finitePositive(value, label) {
  const number = Number(value);
  if (!(number > 0) || !Number.isFinite(number)) throw new Error(`${label} must be a positive number`);
  return number;
}

export function requestedConstraintMode(options = {}) {
  const value = String(options.constraintMode ?? options.constraints ?? 'none').trim().toLowerCase();
  if (value === 'none' || value === 'flexible') return 'none';
  if (value === 'hbonds' || value === 'h-bonds' || value === 'xh' || value === 'x-h') return 'hbonds';
  throw new Error(`Unsupported constraint mode: ${value}`);
}

export function requestedCutoffNanometers(options = {}) {
  const raw = options.nonbondedCutoffNm ?? options.cutoffNm ?? 0;
  if (raw === '' || raw == null || raw === false || String(raw).toLowerCase() === 'none') return 0;
  const cutoff = Number(raw);
  if (cutoff === 0) return 0;
  if (!Number.isFinite(cutoff) || cutoff < 0.3 || cutoff > 5)
    throw new Error('The nonbonded cutoff must be between 0.3 and 5 nm');
  return cutoff;
}

export function configureSimulationSystem(molecule, system, options = {}) {
  if (!Array.isArray(molecule?.atoms) || !Array.isArray(system?.particles))
    throw new Error('A molecule and numeric force-field System are required');
  const atomCount = molecule.atoms.length;
  if (system.particles.length !== atomCount)
    throw new Error(`The System has ${system.particles.length} particles for ${atomCount} atoms`);

  const constraintMode = requestedConstraintMode(options);
  const constraints = [];
  const constrainedPairs = new Set();
  let hydrogenConstraintCount = 0;
  for (const term of system.constraints || []) {
    const i = Number(term.i), j = Number(term.j);
    if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= atomCount || j >= atomCount || i === j)
      throw new Error('The force-field System contains an invalid constraint');
    const distance_nm = finitePositive(term.distance_nm, 'Constraint distance');
    const key = pairKey(i, j);
    if (constrainedPairs.has(key)) throw new Error(`The force-field System constrains atoms ${i + 1} and ${j + 1} twice`);
    constrainedPairs.add(key);
    constraints.push({ i, j, distance_nm });
    if ((molecule.atoms[i]?.element === 'H') !== (molecule.atoms[j]?.element === 'H'))
      hydrogenConstraintCount += 1;
  }

  let derivedConstraintCount = 0;
  if (constraintMode === 'hbonds') {
    for (const term of system.bonds || []) {
      const i = Number(term.i), j = Number(term.j);
      const firstHydrogen = molecule.atoms[i]?.element === 'H';
      const secondHydrogen = molecule.atoms[j]?.element === 'H';
      if (firstHydrogen === secondHydrogen) continue;
      const key = pairKey(i, j);
      if (constrainedPairs.has(key)) continue;
      constraints.push({ i, j, distance_nm: finitePositive(term.r0_nm, 'X–H equilibrium distance') });
      constrainedPairs.add(key);
      derivedConstraintCount += 1;
      hydrogenConstraintCount += 1;
    }
    if (hydrogenConstraintCount === 0)
      throw new Error('X–H constraints were requested, but this parameterized System has no X–H bonds');
  }

  const timestepPs = finitePositive(
    options.dt ?? options.timestepPs ?? (constraintMode === 'hbonds' ? 0.002 : 0.001),
    'Dynamics timestep',
  );
  if (timestepPs > 0.004) throw new Error('The browser dynamics timestep cannot exceed 4 fs');
  const cutoffNm = requestedCutoffNanometers(options);

  return {
    system: constraints === system.constraints ? system : { ...system, constraints },
    constraints,
    constraintMode,
    derivedConstraintCount,
    timestepPs,
    cutoffNm,
  };
}
