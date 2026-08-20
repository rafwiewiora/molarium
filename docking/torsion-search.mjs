const BOLTZMANN_KCAL_MOL_K = 0.00198720425864083;

export const TORSION_SEARCH_DEFAULTS = Object.freeze({
  method:'molarium-fixed-core-torsion-mc/v1',
  steps:96,
  temperatureStartKelvin:900,
  temperatureEndKelvin:150,
  proposalAnglesDegrees:Object.freeze([-180, -120, -90, -60, -30, -15, 15, 30, 60, 90, 120, 180]),
});

function validateMolecule(molecule) {
  if (!molecule?.atoms?.length || !Array.isArray(molecule.bonds))
    throw new TypeError('Torsion search requires a molecular graph');
  const count = molecule.atoms.length;
  molecule.bonds.forEach((bond, index) => {
    if (![bond.a, bond.b].every((atom) => Number.isInteger(atom) && atom >= 0 && atom < count)
      || bond.a === bond.b) throw new RangeError(`Bond ${index + 1} has invalid atom indices`);
  });
}

function adjacencyFor(molecule, excludedBondIndex = -1) {
  const adjacency = Array.from({ length:molecule.atoms.length }, () => []);
  molecule.bonds.forEach((bond, index) => {
    if (index === excludedBondIndex) return;
    adjacency[bond.a].push(bond.b); adjacency[bond.b].push(bond.a);
  });
  return adjacency;
}

function componentFrom(start, adjacency) {
  const visited = new Set([start]), queue = [start];
  while (queue.length) {
    const atom = queue.shift();
    for (const neighbor of adjacency[atom]) if (!visited.has(neighbor)) {
      visited.add(neighbor); queue.push(neighbor);
    }
  }
  return [...visited].sort((a, b) => a - b);
}

function isAmideLikeBond(molecule, first, second) {
  const atoms = molecule.atoms;
  const carbon = atoms[first]?.element === 'C' && atoms[second]?.element === 'N' ? first
    : atoms[second]?.element === 'C' && atoms[first]?.element === 'N' ? second : null;
  const nitrogen = carbon === first ? second : carbon === second ? first : null;
  if (carbon == null) return false;
  return molecule.bonds.some((bond) => {
    if (Number(bond.order || 1) < 1.75) return false;
    const neighbor = bond.a === carbon ? bond.b : bond.b === carbon ? bond.a : null;
    return neighbor != null && neighbor !== nitrogen && ['O', 'S'].includes(atoms[neighbor]?.element);
  });
}

export function identifyFreeRotors(molecule, coreAtomIndices = []) {
  validateMolecule(molecule);
  const core = new Set(Array.from(coreAtomIndices || [], Number));
  if ([...core].some((atom) => !Number.isInteger(atom) || atom < 0 || atom >= molecule.atoms.length))
    throw new RangeError('The fixed core contains an invalid atom index');
  return molecule.bonds.flatMap((bond, bondIndex) => {
    const order = Number(bond.order || 1);
    if (Math.abs(order - 1) > 1e-6 || bond.aromatic
      || molecule.atoms[bond.a]?.element === 'H' || molecule.atoms[bond.b]?.element === 'H'
      || isAmideLikeBond(molecule, bond.a, bond.b)) return [];
    const adjacency = adjacencyFor(molecule, bondIndex);
    const firstComponent = componentFrom(bond.a, adjacency);
    if (firstComponent.includes(bond.b)) return []; // Removing a ring bond does not split the graph.
    const secondComponent = componentFrom(bond.b, adjacency);
    const firstHasCore = firstComponent.some((atom) => core.has(atom));
    const secondHasCore = secondComponent.some((atom) => core.has(atom));
    if (firstHasCore && secondHasCore) return [];
    let fixedAtomIndex, rotatingAtomIndex, movingAtomIndices;
    if (firstHasCore || (!secondHasCore && firstComponent.length > secondComponent.length)) {
      fixedAtomIndex = bond.a; rotatingAtomIndex = bond.b; movingAtomIndices = secondComponent;
    } else {
      fixedAtomIndex = bond.b; rotatingAtomIndex = bond.a; movingAtomIndices = firstComponent;
    }
    if (movingAtomIndices.some((atom) => core.has(atom))
      || movingAtomIndices.every((atom) => atom === rotatingAtomIndex)) return [];
    return [{ bondIndex, fixedAtomIndex, rotatingAtomIndex, movingAtomIndices,
      bondAtomIndices:[bond.a, bond.b] }];
  });
}

function finitePositions(value, atomCount) {
  const positions = value instanceof Float64Array ? new Float64Array(value) : Float64Array.from(value || []);
  if (positions.length !== atomCount * 3 || positions.some((coordinate) => !Number.isFinite(coordinate)))
    throw new Error(`Torsion coordinates must contain ${atomCount * 3} finite values`);
  return positions;
}

export function rotateAroundBond(positions, rotor, angleRadians) {
  const rotated = new Float64Array(positions);
  const originOffset = rotor.fixedAtomIndex * 3, pivotOffset = rotor.rotatingAtomIndex * 3;
  const origin = [positions[originOffset], positions[originOffset + 1], positions[originOffset + 2]];
  const axis = [positions[pivotOffset] - origin[0], positions[pivotOffset + 1] - origin[1],
    positions[pivotOffset + 2] - origin[2]];
  const length = Math.hypot(...axis);
  if (!(length > 1e-8)) throw new Error('Cannot rotate around a zero-length bond');
  for (let index = 0; index < 3; index++) axis[index] /= length;
  const cosine = Math.cos(angleRadians), sine = Math.sin(angleRadians);
  for (const atom of rotor.movingAtomIndices) {
    const offset = atom * 3;
    const vector = [positions[offset] - origin[0], positions[offset + 1] - origin[1],
      positions[offset + 2] - origin[2]];
    const cross = [axis[1] * vector[2] - axis[2] * vector[1],
      axis[2] * vector[0] - axis[0] * vector[2], axis[0] * vector[1] - axis[1] * vector[0]];
    const projection = axis[0] * vector[0] + axis[1] * vector[1] + axis[2] * vector[2];
    for (let dimension = 0; dimension < 3; dimension++) rotated[offset + dimension] = origin[dimension]
      + vector[dimension] * cosine + cross[dimension] * sine
      + axis[dimension] * projection * (1 - cosine);
  }
  return rotated;
}

export function packPositions4(positions) {
  if (!ArrayBuffer.isView(positions) && !Array.isArray(positions))
    throw new TypeError('Three-coordinate positions are required');
  if (!positions.length || positions.length % 3
    || Array.from(positions).some((coordinate) => !Number.isFinite(Number(coordinate))))
    throw new Error('Three-coordinate positions must be complete and finite');
  const packed = new Float64Array(positions.length / 3 * 4);
  for (let atom = 0; atom < positions.length / 3; atom++) {
    packed[atom * 4] = Number(positions[atom * 3]);
    packed[atom * 4 + 1] = Number(positions[atom * 3 + 1]);
    packed[atom * 4 + 2] = Number(positions[atom * 3 + 2]);
  }
  return packed;
}

function normalizeEvaluation(value) {
  const objectiveKcalMol = Number(typeof value === 'number' ? value : value?.objectiveKcalMol);
  if (!Number.isFinite(objectiveKcalMol)) throw new Error('Torsion scoring returned no finite objective');
  return { ...(typeof value === 'object' ? value : {}), objectiveKcalMol,
    feasible:typeof value === 'object' ? value.feasible !== false : true };
}

function preferable(candidate, incumbent) {
  return Number(candidate.feasible) > Number(incumbent.feasible)
    || candidate.feasible === incumbent.feasible
      && candidate.objectiveKcalMol < incumbent.objectiveKcalMol;
}

export async function refinePoseByTorsionMonteCarlo({ molecule, initialPositions, coreAtomIndices,
  scorePose, random, seed = null, steps = TORSION_SEARCH_DEFAULTS.steps,
  temperatureStartKelvin = TORSION_SEARCH_DEFAULTS.temperatureStartKelvin,
  temperatureEndKelvin = TORSION_SEARCH_DEFAULTS.temperatureEndKelvin,
  proposalAnglesDegrees = TORSION_SEARCH_DEFAULTS.proposalAnglesDegrees } = {}) {
  validateMolecule(molecule);
  if (typeof scorePose !== 'function') throw new TypeError('A torsion score callback is required');
  if (typeof random !== 'function') throw new TypeError('A deterministic random-number generator is required');
  const proposalCount = Math.max(0, Math.round(Number(steps)));
  const startTemperature = Number(temperatureStartKelvin), endTemperature = Number(temperatureEndKelvin);
  const angles = Array.from(proposalAnglesDegrees || [], Number);
  if (!(startTemperature > 0) || !(endTemperature > 0))
    throw new RangeError('Torsion-search temperatures must be positive');
  if (!angles.length || angles.some((angle) => !Number.isFinite(angle) || angle === 0))
    throw new RangeError('Torsion-search proposal angles must be finite and nonzero');
  const rotors = identifyFreeRotors(molecule, coreAtomIndices);
  let currentPositions = finitePositions(initialPositions, molecule.atoms.length);
  let currentEvaluation = normalizeEvaluation(await scorePose(currentPositions));
  const startEvaluation = { ...currentEvaluation };
  let bestPositions = new Float64Array(currentPositions), bestEvaluation = { ...currentEvaluation };
  let accepted = 0, improved = 0, uphillAccepted = 0, feasibleDiscoveries = Number(currentEvaluation.feasible);
  for (let step = 0; step < proposalCount && rotors.length; step++) {
    const rotor = rotors[Math.min(rotors.length - 1, Math.floor(random() * rotors.length))];
    const angleDegrees = angles[Math.min(angles.length - 1, Math.floor(random() * angles.length))];
    const proposalPositions = rotateAroundBond(currentPositions, rotor, angleDegrees * Math.PI / 180);
    const proposalEvaluation = normalizeEvaluation(await scorePose(proposalPositions));
    const progress = proposalCount <= 1 ? 1 : step / (proposalCount - 1);
    const temperature = startTemperature * (endTemperature / startTemperature) ** progress;
    const delta = proposalEvaluation.objectiveKcalMol - currentEvaluation.objectiveKcalMol;
    const becomesFeasible = proposalEvaluation.feasible && !currentEvaluation.feasible;
    const losesFeasibility = !proposalEvaluation.feasible && currentEvaluation.feasible;
    const accept = becomesFeasible || !losesFeasibility
      && (delta <= 0 || random() < Math.exp(-delta / (BOLTZMANN_KCAL_MOL_K * temperature)));
    if (accept) {
      accepted++;
      if (delta > 0) uphillAccepted++;
      currentPositions = proposalPositions; currentEvaluation = proposalEvaluation;
    }
    if (proposalEvaluation.feasible) feasibleDiscoveries++;
    if (preferable(proposalEvaluation, bestEvaluation)) {
      improved++;
      bestPositions = proposalPositions; bestEvaluation = { ...proposalEvaluation };
    }
  }
  return {
    positions:bestPositions,
    method:TORSION_SEARCH_DEFAULTS.method,
    seed:seed == null ? null : Number(seed) >>> 0,
    rotatableBondCount:rotors.length,
    rotors:rotors.map((rotor) => ({ bondAtomIndices:[...rotor.bondAtomIndices],
      fixedAtomIndex:rotor.fixedAtomIndex, rotatingAtomIndex:rotor.rotatingAtomIndex,
      movingAtomCount:rotor.movingAtomIndices.length })),
    proposals:rotors.length ? proposalCount : 0,
    accepted,
    uphillAccepted,
    improved,
    feasibleDiscoveries,
    acceptanceRate:rotors.length && proposalCount ? accepted / proposalCount : 0,
    startObjectiveKcalMol:startEvaluation.objectiveKcalMol,
    bestObjectiveKcalMol:bestEvaluation.objectiveKcalMol,
    selectedFeasible:bestEvaluation.feasible,
    settings:{ temperatureStartKelvin:startTemperature, temperatureEndKelvin:endTemperature,
      proposalAnglesDegrees:angles, coreMode:'exact-snap', requiredContactMode:'feasible-state retention' },
  };
}
