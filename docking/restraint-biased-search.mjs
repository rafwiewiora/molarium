const BOLTZMANN_KCAL_MOL_K = 0.00198720425864083;

export const RESTRAINT_BIASED_SEARCH_DEFAULTS = Object.freeze({
  method:'molarium-restraint-biased-internal-coordinate-search/v3',
  steps:96,
  temperatureStartKelvin:900,
  temperatureEndKelvin:150,
  torsionAnglesDegrees:Object.freeze([-180, -120, -90, -60, -30, -15, 15, 30, 60, 90, 120, 180]),
  ringCrankshaftAnglesDegrees:Object.freeze([-60, -45, -30, -20, -15, 15, 20, 30, 45, 60]),
  localLineFractions:Object.freeze([0.5, 0.75, 1, 1.25]),
  capturePolishSweeps:3,
});

function validateMolecule(molecule) {
  if (!molecule?.atoms?.length || !Array.isArray(molecule.bonds))
    throw new TypeError('Restraint-biased search requires a molecular graph');
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
    adjacency[bond.a].push({ atom:bond.b, bondIndex:index });
    adjacency[bond.b].push({ atom:bond.a, bondIndex:index });
  });
  adjacency.forEach((entries) => entries.sort((first, second) => first.atom - second.atom));
  return adjacency;
}

function shortestPath(molecule, start, finish, excludedBondIndex, maximumAtoms) {
  const adjacency = adjacencyFor(molecule, excludedBondIndex);
  const queue = [[start]], visited = new Set([start]);
  while (queue.length) {
    const path = queue.shift(), atom = path.at(-1);
    if (atom === finish) return path;
    if (path.length >= maximumAtoms) continue;
    for (const { atom:neighbor } of adjacency[atom]) if (!visited.has(neighbor)) {
      visited.add(neighbor); queue.push([...path, neighbor]);
    }
  }
  return null;
}

function canonicalCycle(cycle) {
  const orientations = [cycle, [...cycle].reverse()];
  const variants = [];
  for (const orientation of orientations) for (let offset = 0; offset < orientation.length; offset++)
    variants.push([...orientation.slice(offset), ...orientation.slice(0, offset)]);
  variants.sort(compareNumberArrays);
  return variants[0];
}

function compareNumberArrays(first, second) {
  for (let index = 0; index < Math.min(first.length, second.length); index++) {
    const difference = first[index] - second[index];
    if (difference) return difference;
  }
  return first.length - second.length;
}

function bondBetween(molecule, first, second) {
  return molecule.bonds.find((bond) => bond.a === first && bond.b === second
    || bond.a === second && bond.b === first);
}

export function perceiveFlexibleRings(molecule, { maximumRingSize = 12 } = {}) {
  validateMolecule(molecule);
  const unique = new Map();
  molecule.bonds.forEach((bond, bondIndex) => {
    const path = shortestPath(molecule, bond.a, bond.b, bondIndex, maximumRingSize);
    if (!path || path.length < 3 || path.length > maximumRingSize) return;
    const cycle = canonicalCycle(path), key = cycle.join(',');
    if (unique.has(key)) return;
    const ringBonds = cycle.map((atom, index) =>
      bondBetween(molecule, atom, cycle[(index + 1) % cycle.length]));
    if (ringBonds.some((entry) => !entry)) return;
    const flexible = ringBonds.every((entry) => !entry.aromatic
      && Math.abs(Number(entry.order || 1) - 1) < 1e-6);
    unique.set(key, { atomIndices:cycle, bondIndices:ringBonds.map((entry) =>
      molecule.bonds.indexOf(entry)), flexible });
  });
  return [...unique.values()].sort((first, second) => first.atomIndices.length - second.atomIndices.length
    || compareNumberArrays(first.atomIndices, second.atomIndices));
}

function cyclePaths(cycle, firstOrdinal, secondOrdinal) {
  const forward = [], reverse = [];
  for (let cursor = firstOrdinal; ; cursor = (cursor + 1) % cycle.length) {
    forward.push(cycle[cursor]); if (cursor === secondOrdinal) break;
  }
  for (let cursor = firstOrdinal; ; cursor = (cursor - 1 + cycle.length) % cycle.length) {
    reverse.push(cycle[cursor]); if (cursor === secondOrdinal) break;
  }
  return [forward, reverse];
}

function expandedMovingSet(molecule, cycle, path, core) {
  const endpoints = new Set([path[0], path.at(-1)]);
  const interior = new Set(path.slice(1, -1));
  if (!interior.size || [...interior].some((atom) => core.has(atom))) return null;
  const blockedCycle = new Set(cycle.filter((atom) => !interior.has(atom)));
  const adjacency = adjacencyFor(molecule);
  const moving = new Set(interior), queue = [...interior];
  while (queue.length) {
    const atom = queue.shift();
    for (const { atom:neighbor } of adjacency[atom]) {
      if (blockedCycle.has(neighbor) || moving.has(neighbor)) continue;
      if (core.has(neighbor)) return null;
      moving.add(neighbor); queue.push(neighbor);
    }
  }
  if ([...moving].some((atom) => core.has(atom))) return null;
  for (const bond of molecule.bonds) {
    const firstMoving = moving.has(bond.a), secondMoving = moving.has(bond.b);
    if (firstMoving === secondMoving) continue;
    const fixed = firstMoving ? bond.b : bond.a;
    if (!endpoints.has(fixed)) return null;
  }
  return [...moving].sort((first, second) => first - second);
}

function branchEnvironmentLabels(molecule, excludedAtom) {
  const adjacency = adjacencyFor(molecule);
  const compress = (keys) => {
    const ordered = [...new Set(keys)].sort(), ids = new Map(ordered.map((key, index) => [key, index]));
    return keys.map((key) => ids.get(key));
  };
  let labels = compress(molecule.atoms.map((atom, index) => index === excludedAtom ? '#' : [
    atom.element || '?', Number(atom.formalCharge || 0), Number(Boolean(atom.aromatic)),
  ].join(':')));
  for (let iteration = 0; iteration < molecule.atoms.length; iteration++) {
    const keys = labels.map((label, index) => {
      if (index === excludedAtom) return '#';
      const neighbors = adjacency[index].flatMap(({ atom, bondIndex }) => atom === excludedAtom
        ? [] : [`${Number(molecule.bonds[bondIndex]?.order || 1)}:${labels[atom]}`]);
      neighbors.sort();
      return `${label}[${neighbors.join('|')}]`;
    });
    const next = compress(keys);
    if (next.every((label, index) => label === labels[index])) break;
    labels = next;
  }
  return labels;
}

function isPotentialConfiguredStereocenter(molecule, atomIndex) {
  const atom = molecule.atoms[atomIndex];
  if (!atom || atom.element === 'H') return false;
  const incident = molecule.bonds.flatMap((bond) => bond.a === atomIndex
    ? [{ atom:bond.b, order:Number(bond.order || 1) }]
    : bond.b === atomIndex ? [{ atom:bond.a, order:Number(bond.order || 1) }] : []);
  if (incident.length !== 4 || incident.some((entry) => Math.abs(entry.order - 1) > 1e-6))
    return false;
  const labels = branchEnvironmentLabels(molecule, atomIndex);
  const signatures = incident.map((entry) => `${entry.order}:${labels[entry.atom]}`);
  return new Set(signatures).size === 4;
}

function protectedRingAtoms(molecule, ring) {
  const ringAtoms = new Set(ring.atomIndices), protectedAtoms = new Set();
  for (const atomIndex of ring.atomIndices) {
    if (isPotentialConfiguredStereocenter(molecule, atomIndex)) protectedAtoms.add(atomIndex);
    const incident = molecule.bonds.filter((bond) => bond.a === atomIndex || bond.b === atomIndex);
    if (incident.some((bond) => bond.aromatic || Number(bond.order || 1) > 1 + 1e-6))
      protectedAtoms.add(atomIndex);
    for (const bond of incident) {
      const neighbor = bond.a === atomIndex ? bond.b : bond.a;
      if (ringAtoms.has(neighbor) && isAmideLikeBond(molecule, atomIndex, neighbor)) {
        protectedAtoms.add(atomIndex); protectedAtoms.add(neighbor);
      }
    }
  }
  return protectedAtoms;
}

export function identifyRingCrankshaftMoves(molecule, coreAtomIndices = [], options = {}) {
  validateMolecule(molecule);
  const core = new Set(Array.from(coreAtomIndices || [], Number));
  if ([...core].some((atom) => !Number.isInteger(atom) || atom < 0 || atom >= molecule.atoms.length))
    throw new RangeError('The fixed core contains an invalid atom index');
  const moves = new Map();
  const perceivedRings = perceiveFlexibleRings(molecule, options);
  const isolatedFlexibleRings = perceivedRings.filter((ring, index) => ring.flexible
    && !perceivedRings.some((other, otherIndex) => otherIndex !== index
      && other.atomIndices.some((atom) => ring.atomIndices.includes(atom))));
  for (const ring of isolatedFlexibleRings) {
    const cycle = ring.atomIndices, protectedAtoms = protectedRingAtoms(molecule, ring);
    for (let first = 0; first < cycle.length; first++) for (let second = first + 1; second < cycle.length; second++) {
      const separation = second - first;
      if (separation < 2 || cycle.length - separation < 2) continue;
      for (const path of cyclePaths(cycle, first, second)) {
        const movingAtomIndices = expandedMovingSet(molecule, cycle, path, core);
        if (!movingAtomIndices?.some((atom) => molecule.atoms[atom]?.element !== 'H')) continue;
        const axisAtomIndices = [path[0], path.at(-1)].sort((a, b) => a - b);
        if ([...axisAtomIndices, ...movingAtomIndices]
          .some((atom) => protectedAtoms.has(atom))) continue;
        const key = `${axisAtomIndices.join('-')}:${movingAtomIndices.join(',')}`;
        moves.set(key, { kind:'ring-crankshaft', ringAtomIndices:[...cycle],
          axisAtomIndices, movingAtomIndices });
      }
    }
  }
  return [...moves.values()].sort((first, second) => first.axisAtomIndices[0] - second.axisAtomIndices[0]
    || first.axisAtomIndices[1] - second.axisAtomIndices[1]
    || compareNumberArrays(first.movingAtomIndices, second.movingAtomIndices));
}

function componentFrom(start, adjacency) {
  const visited = new Set([start]), queue = [start];
  while (queue.length) {
    const atom = queue.shift();
    for (const { atom:neighbor } of adjacency[atom]) if (!visited.has(neighbor)) {
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

export function identifyAcyclicTorsionMoves(molecule, coreAtomIndices = []) {
  validateMolecule(molecule);
  const core = new Set(Array.from(coreAtomIndices || [], Number));
  const moves = molecule.bonds.flatMap((bond, bondIndex) => {
    if (Math.abs(Number(bond.order || 1) - 1) > 1e-6 || bond.aromatic
      || molecule.atoms[bond.a]?.element === 'H' || molecule.atoms[bond.b]?.element === 'H'
      || isAmideLikeBond(molecule, bond.a, bond.b)) return [];
    const adjacency = adjacencyFor(molecule, bondIndex);
    const firstComponent = componentFrom(bond.a, adjacency);
    if (firstComponent.includes(bond.b)) return [];
    const secondComponent = componentFrom(bond.b, adjacency);
    const firstHasCore = firstComponent.some((atom) => core.has(atom));
    const secondHasCore = secondComponent.some((atom) => core.has(atom));
    if (firstHasCore && secondHasCore) return [];
    let fixedAtomIndex, rotatingAtomIndex, movingAtomIndices;
    const firstIsFixed = firstHasCore || !secondHasCore
      && (firstComponent.length > secondComponent.length
        || firstComponent.length === secondComponent.length
          && compareNumberArrays(firstComponent, secondComponent) < 0);
    if (firstIsFixed) {
      fixedAtomIndex = bond.a; rotatingAtomIndex = bond.b; movingAtomIndices = secondComponent;
    } else {
      fixedAtomIndex = bond.b; rotatingAtomIndex = bond.a; movingAtomIndices = firstComponent;
    }
    if (movingAtomIndices.some((atom) => core.has(atom))
      || movingAtomIndices.every((atom) => atom === rotatingAtomIndex)) return [];
    return [{ kind:'acyclic-torsion', bondIndex, axisAtomIndices:[fixedAtomIndex, rotatingAtomIndex],
      movingAtomIndices, bondAtomIndices:[bond.a, bond.b].sort((a, b) => a - b) }];
  });
  return moves.sort((first, second) => compareNumberArrays(first.bondAtomIndices,
    second.bondAtomIndices) || compareNumberArrays(first.axisAtomIndices, second.axisAtomIndices)
    || compareNumberArrays(first.movingAtomIndices, second.movingAtomIndices));
}

function finitePositions(value, atomCount) {
  const positions = value instanceof Float64Array ? new Float64Array(value) : Float64Array.from(value || []);
  if (positions.length !== atomCount * 3 || positions.some((coordinate) => !Number.isFinite(coordinate)))
    throw new Error(`Search coordinates must contain ${atomCount * 3} finite values`);
  return positions;
}

export function applyInternalCoordinateMove(positions, move, angleRadians) {
  if (!Number.isFinite(Number(angleRadians))) throw new TypeError('A finite move angle is required');
  const rotated = new Float64Array(positions);
  const [first, second] = move.axisAtomIndices || [];
  if (![first, second].every(Number.isInteger)) throw new Error('An internal-coordinate move requires two axis atoms');
  const origin = [positions[first * 3], positions[first * 3 + 1], positions[first * 3 + 2]];
  const axis = [positions[second * 3] - origin[0], positions[second * 3 + 1] - origin[1],
    positions[second * 3 + 2] - origin[2]];
  const length = Math.hypot(...axis);
  if (!(length > 1e-8)) throw new Error('Cannot rotate around a zero-length internal-coordinate axis');
  for (let index = 0; index < 3; index++) axis[index] /= length;
  const cosine = Math.cos(angleRadians), sine = Math.sin(angleRadians);
  for (const atom of move.movingAtomIndices) {
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

function normalizeEvaluation(value) {
  const objectiveKcalMol = Number(typeof value === 'number' ? value : value?.objectiveKcalMol);
  if (!Number.isFinite(objectiveKcalMol)) throw new Error('Biased search scoring returned no finite objective');
  return { ...(typeof value === 'object' ? value : {}), objectiveKcalMol,
    feasible:typeof value === 'object' ? value.feasible === true : false };
}

function preferable(candidate, incumbent) {
  return Number(candidate.evaluation.feasible) > Number(incumbent.evaluation.feasible)
    || candidate.evaluation.feasible === incumbent.evaluation.feasible
      && candidate.evaluation.objectiveKcalMol < incumbent.evaluation.objectiveKcalMol;
}

function moveAudit(move) {
  return { kind:move.kind, axisAtomIndices:[...move.axisAtomIndices],
    movingAtomCount:move.movingAtomIndices.length,
    ...(move.ringAtomIndices ? { ringAtomIndices:[...move.ringAtomIndices] } : {}),
    ...(move.bondAtomIndices ? { bondAtomIndices:[...move.bondAtomIndices] } : {}) };
}

function drawUnitInterval(random) {
  const value = Number(random());
  if (!Number.isFinite(value) || value < 0 || value >= 1)
    throw new RangeError('The deterministic random source must return values in [0, 1)');
  return value;
}

function evaluationAudit(evaluation) {
  return {
    objectiveKcalMol:evaluation.objectiveKcalMol,
    feasible:evaluation.feasible,
    ...(Number.isFinite(Number(evaluation.hbondPenaltyKcalMol))
      ? { hbondPenaltyKcalMol:Number(evaluation.hbondPenaltyKcalMol) } : {}),
    ...(Number.isFinite(Number(evaluation.finalObjectiveKcalMol))
      ? { finalObjectiveKcalMol:Number(evaluation.finalObjectiveKcalMol) } : {}),
    ...(evaluation.chemicalValidity && typeof evaluation.chemicalValidity === 'object'
      ? { chemicalValidity:{ ...evaluation.chemicalValidity } } : {}),
    hydrogenBonds:Array.isArray(evaluation.hydrogenBonds)
      ? evaluation.hydrogenBonds.map((entry) => ({
        id:entry.id || null,
        selectedAlternativeId:entry.selectedAlternativeId || null,
        satisfied:entry.satisfied === true,
        donorAcceptorDistanceAngstrom:Number(entry.donorAcceptorDistanceAngstrom),
        hydrogenAcceptorDistanceAngstrom:Number(entry.hydrogenAcceptorDistanceAngstrom),
        dhaAngleDegrees:Number(entry.dhaAngleDegrees),
        penaltyKcalMol:Number(entry.penaltyKcalMol || 0),
      })) : [],
  };
}

export async function refinePoseByRestraintBiasedSearch({ molecule, initialPositions,
  coreAtomIndices = [], scorePose, random, seed = null,
  steps = RESTRAINT_BIASED_SEARCH_DEFAULTS.steps,
  temperatureStartKelvin = RESTRAINT_BIASED_SEARCH_DEFAULTS.temperatureStartKelvin,
  temperatureEndKelvin = RESTRAINT_BIASED_SEARCH_DEFAULTS.temperatureEndKelvin,
  torsionAnglesDegrees = RESTRAINT_BIASED_SEARCH_DEFAULTS.torsionAnglesDegrees,
  ringCrankshaftAnglesDegrees = RESTRAINT_BIASED_SEARCH_DEFAULTS.ringCrankshaftAnglesDegrees,
  localLineFractions = RESTRAINT_BIASED_SEARCH_DEFAULTS.localLineFractions,
  proposalMoves = null, yieldControl = null,
  progressStage = 'internal-coordinate search' } = {}) {
  validateMolecule(molecule);
  if (typeof scorePose !== 'function') throw new TypeError('A biased-search score callback is required');
  if (typeof random !== 'function') throw new TypeError('A deterministic random-number generator is required');
  if (yieldControl != null && typeof yieldControl !== 'function')
    throw new TypeError('yieldControl must be a function when provided');
  const requestedSteps = Number(steps);
  if (!Number.isFinite(requestedSteps) || requestedSteps < 0)
    throw new RangeError('Biased-search steps must be finite and nonnegative');
  const proposalCount = Math.round(requestedSteps);
  const startTemperature = Number(temperatureStartKelvin), endTemperature = Number(temperatureEndKelvin);
  if (!(startTemperature > 0) || !(endTemperature > 0))
    throw new RangeError('Biased-search temperatures must be positive');
  const angleSets = {
    'acyclic-torsion':Array.from(torsionAnglesDegrees || [], Number),
    'ring-crankshaft':Array.from(ringCrankshaftAnglesDegrees || [], Number),
  };
  const fractions = Array.from(localLineFractions || [], Number);
  if (!fractions.length || fractions.some((value) => !Number.isFinite(value) || !(value > 0)))
    throw new RangeError('Local line-minimization fractions must be finite and positive');
  Object.values(angleSets).forEach((angles) => {
    if (!angles.length || angles.some((angle) => !Number.isFinite(angle) || angle === 0))
      throw new RangeError('Internal-coordinate proposal angles must be finite and nonzero');
  });
  const moves = proposalMoves ? Array.from(proposalMoves) : [
    ...identifyAcyclicTorsionMoves(molecule, coreAtomIndices),
    ...identifyRingCrankshaftMoves(molecule, coreAtomIndices),
  ];
  let current = { positions:finitePositions(initialPositions, molecule.atoms.length) };
  current.evaluation = normalizeEvaluation(await scorePose(current.positions));
  const startEvaluation = { ...current.evaluation };
  let best = { positions:new Float64Array(current.positions), evaluation:{ ...current.evaluation } };
  let accepted = 0, improved = 0, uphillAccepted = 0;
  let feasibleDiscoveries = Number(current.evaluation.feasible), lineEvaluations = 0;
  const acceptedByKind = { 'acyclic-torsion':0, 'ring-crankshaft':0 };
  for (let step = 0; step < proposalCount && moves.length; step++) {
    const move = moves[Math.min(moves.length - 1,
      Math.floor(drawUnitInterval(random) * moves.length))];
    const angles = angleSets[move.kind];
    if (!angles) throw new Error(`Unsupported internal-coordinate move: ${move.kind}`);
    const angleDegrees = angles[Math.min(angles.length - 1,
      Math.floor(drawUnitInterval(random) * angles.length))];
    let proposal = null;
    for (const fraction of fractions) {
      const positions = applyInternalCoordinateMove(current.positions, move,
        angleDegrees * fraction * Math.PI / 180);
      const evaluation = normalizeEvaluation(await scorePose(positions));
      lineEvaluations++;
      if (yieldControl) await yieldControl({ stage:progressStage, completed:lineEvaluations,
        total:proposalCount * fractions.length, step:step + 1, steps:proposalCount });
      const candidate = { positions, evaluation, fraction };
      if (!proposal || preferable(candidate, proposal)
        || candidate.evaluation.feasible === proposal.evaluation.feasible
          && candidate.evaluation.objectiveKcalMol === proposal.evaluation.objectiveKcalMol
          && candidate.fraction < proposal.fraction) proposal = candidate;
    }
    const progress = proposalCount <= 1 ? 1 : step / (proposalCount - 1);
    const temperature = startTemperature * (endTemperature / startTemperature) ** progress;
    const delta = proposal.evaluation.objectiveKcalMol - current.evaluation.objectiveKcalMol;
    const becomesFeasible = proposal.evaluation.feasible && !current.evaluation.feasible;
    const losesFeasibility = !proposal.evaluation.feasible && current.evaluation.feasible;
    const accept = becomesFeasible || !losesFeasibility
      && (delta <= 0 || drawUnitInterval(random)
        < Math.exp(-delta / (BOLTZMANN_KCAL_MOL_K * temperature)));
    if (accept) {
      accepted++; acceptedByKind[move.kind]++;
      if (delta > 0) uphillAccepted++;
      current = proposal;
    }
    if (proposal.evaluation.feasible) feasibleDiscoveries++;
    if (preferable(proposal, best)) { improved++; best = proposal; }
  }
  const ringMoves = moves.filter((move) => move.kind === 'ring-crankshaft');
  const torsionMoves = moves.filter((move) => move.kind === 'acyclic-torsion');
  return {
    positions:new Float64Array(best.positions),
    method:RESTRAINT_BIASED_SEARCH_DEFAULTS.method,
    seed:seed == null ? null : Number(seed) >>> 0,
    moveCount:moves.length, ringCrankshaftMoveCount:ringMoves.length,
    rotatableBondCount:torsionMoves.length,
    moves:moves.map(moveAudit), proposals:moves.length ? proposalCount : 0,
    lineEvaluations, accepted, acceptedByKind, uphillAccepted, improved,
    feasibleDiscoveries,
    acceptanceRate:moves.length && proposalCount ? accepted / proposalCount : 0,
    startObjectiveKcalMol:startEvaluation.objectiveKcalMol,
    bestObjectiveKcalMol:best.evaluation.objectiveKcalMol,
    selectedFeasible:best.evaluation.feasible,
    startEvaluation:evaluationAudit(startEvaluation),
    bestEvaluation:evaluationAudit(best.evaluation),
    settings:{ temperatureStartKelvin:startTemperature, temperatureEndKelvin:endTemperature,
      torsionAnglesDegrees:angleSets['acyclic-torsion'],
      ringCrankshaftAnglesDegrees:angleSets['ring-crankshaft'],
      localLineFractions:fractions, coreMode:'exact-fixed-axis',
      requiredContactMode:'continuous-flat-bottom-potential-plus-final-feasibility',
      acceptanceInterpretation:'annealed stochastic line-search heuristic; not equilibrium Metropolis, Hastings, ICM, or BPMC' },
  };
}


export async function polishPoseByInternalCoordinateDescent({ molecule, initialPositions,
  coreAtomIndices = [], scorePose,
  sweeps = RESTRAINT_BIASED_SEARCH_DEFAULTS.capturePolishSweeps,
  torsionAnglesDegrees = RESTRAINT_BIASED_SEARCH_DEFAULTS.torsionAnglesDegrees,
  ringCrankshaftAnglesDegrees = RESTRAINT_BIASED_SEARCH_DEFAULTS.ringCrankshaftAnglesDegrees,
  localLineFractions = RESTRAINT_BIASED_SEARCH_DEFAULTS.localLineFractions,
  proposalMoves = null, yieldControl = null,
  progressStage = 'internal-coordinate polish' } = {}) {
  validateMolecule(molecule);
  if (typeof scorePose !== 'function')
    throw new TypeError('An internal-coordinate polish score callback is required');
  if (yieldControl != null && typeof yieldControl !== 'function')
    throw new TypeError('yieldControl must be a function when provided');
  const requestedSweeps = Number(sweeps);
  if (!Number.isFinite(requestedSweeps) || requestedSweeps < 0)
    throw new RangeError('Internal-coordinate polish sweeps must be finite and nonnegative');
  const maximumSweeps = Math.round(requestedSweeps);
  const fractions = Array.from(localLineFractions || [], Number);
  if (!fractions.length || fractions.some((value) => !Number.isFinite(value) || !(value > 0)))
    throw new RangeError('Local polish fractions must be finite and positive');
  const angleSets = {
    'acyclic-torsion':Array.from(torsionAnglesDegrees || [], Number),
    'ring-crankshaft':Array.from(ringCrankshaftAnglesDegrees || [], Number),
  };
  Object.values(angleSets).forEach((angles) => {
    if (!angles.length || angles.some((angle) => !Number.isFinite(angle) || angle === 0))
      throw new RangeError('Internal-coordinate polish angles must be finite and nonzero');
  });
  const moves = proposalMoves ? Array.from(proposalMoves) : [
    ...identifyAcyclicTorsionMoves(molecule, coreAtomIndices),
    ...identifyRingCrankshaftMoves(molecule, coreAtomIndices),
  ];
  let current = { positions:finitePositions(initialPositions, molecule.atoms.length) };
  current.evaluation = normalizeEvaluation(await scorePose(current.positions));
  const startEvaluation = { ...current.evaluation };
  let completedSweeps = 0, improvements = 0, evaluations = 0;
  for (let sweep = 0; sweep < maximumSweeps && moves.length; sweep++) {
    let best = current;
    for (const move of moves) for (const angleDegrees of angleSets[move.kind] || [])
      for (const fraction of fractions) {
        const positions = applyInternalCoordinateMove(current.positions, move,
          angleDegrees * fraction * Math.PI / 180);
        const trial = { positions, evaluation:normalizeEvaluation(await scorePose(positions)),
          move, angleDegrees, fraction };
        evaluations++;
        if (yieldControl) await yieldControl({ stage:progressStage, completed:evaluations,
          total:maximumSweeps * moves.length * Math.max(...Object.values(angleSets)
            .map((angles) => angles.length)) * fractions.length,
          sweep:sweep + 1, sweeps:maximumSweeps });
        if (preferable(trial, best)) best = trial;
      }
    completedSweeps++;
    if (best === current) break;
    current = best; improvements++;
  }
  return {
    positions:new Float64Array(current.positions),
    method:'molarium-exhaustive-internal-coordinate-polish/v1',
    moveCount:moves.length, requestedSweeps:maximumSweeps, completedSweeps,
    evaluations, improvements, selectedFeasible:current.evaluation.feasible,
    startEvaluation:evaluationAudit(startEvaluation),
    bestEvaluation:evaluationAudit(current.evaluation),
    moves:moves.map(moveAudit),
  };
}


function combineStageCounts(capture, physical, field) {
  return Number(capture?.[field] || 0) + Number(physical?.[field] || 0);
}

/**
 * Generate a reference-guided analogue pose in two explicit stages.
 *
 * Stage 1 is a pharmacophore-capture search whose objective contains only the
 * selected required-contact potentials. Stage 2 starts only from a captured
 * pose and optimizes the full physical objective while feasibility is hard.
 */
export async function generatePoseByRestraintBiasedSearch({ molecule, initialPositions,
  coreAtomIndices = [], restraintScorePose, physicalScorePose, random, seed = null,
  captureSteps = RESTRAINT_BIASED_SEARCH_DEFAULTS.steps,
  capturePolishSweeps = RESTRAINT_BIASED_SEARCH_DEFAULTS.capturePolishSweeps,
  refinementSteps = RESTRAINT_BIASED_SEARCH_DEFAULTS.steps,
  ...searchOptions } = {}) {
  if (typeof restraintScorePose !== 'function')
    throw new TypeError('A pharmacophore-capture score callback is required');
  if (typeof physicalScorePose !== 'function')
    throw new TypeError('A physical-refinement score callback is required');
  const shared = { molecule, coreAtomIndices, random, seed, ...searchOptions };
  const captureMc = await refinePoseByRestraintBiasedSearch({ ...shared, initialPositions,
    scorePose:restraintScorePose, steps:captureSteps, progressStage:'contact capture' });
  const capturePolish = await polishPoseByInternalCoordinateDescent({ ...shared,
    initialPositions:captureMc.positions, scorePose:restraintScorePose,
    sweeps:capturePolishSweeps, progressStage:'contact polish' });
  const capture = {
    ...captureMc, positions:capturePolish.positions,
    bestObjectiveKcalMol:capturePolish.bestEvaluation.objectiveKcalMol,
    selectedFeasible:capturePolish.selectedFeasible,
    lineEvaluations:captureMc.lineEvaluations + capturePolish.evaluations,
    improved:captureMc.improved + capturePolish.improvements,
    bestEvaluation:capturePolish.bestEvaluation,
    polish:capturePolish,
  };
  let physical = null;
  const requestedRefinementSteps = Math.max(0, Math.round(Number(refinementSteps)));
  if (capture.selectedFeasible && requestedRefinementSteps > 0)
    physical = await refinePoseByRestraintBiasedSearch({ ...shared,
    initialPositions:capture.positions, scorePose:physicalScorePose, steps:refinementSteps,
    progressStage:'physical refinement' });
  const selected = physical || capture;
  const proposals = combineStageCounts(capture, physical, 'proposals');
  const accepted = combineStageCounts(capture, physical, 'accepted');
  return {
    ...selected,
    method:RESTRAINT_BIASED_SEARCH_DEFAULTS.method,
    stageOutcome:physical ? 'captured-and-physically-refined'
      : capture.selectedFeasible ? 'captured-no-physical-proposals' : 'capture-infeasible',
    captureFeasible:capture.selectedFeasible,
    physicalRefinementAttempted:Boolean(physical),
    proposals,
    lineEvaluations:combineStageCounts(capture, physical, 'lineEvaluations'),
    accepted,
    uphillAccepted:combineStageCounts(capture, physical, 'uphillAccepted'),
    improved:combineStageCounts(capture, physical, 'improved'),
    feasibleDiscoveries:combineStageCounts(capture, physical, 'feasibleDiscoveries'),
    acceptanceRate:proposals ? accepted / proposals : 0,
    objectiveStage:physical ? 'physical-refinement' : 'pharmacophore-capture',
    startObjectiveKcalMol:selected.startObjectiveKcalMol,
    bestObjectiveKcalMol:selected.bestObjectiveKcalMol,
    selectedFeasible:selected.selectedFeasible,
    capture:{
      method:capture.method, steps:Number(captureSteps), proposals:capture.proposals,
      lineEvaluations:capture.lineEvaluations, accepted:capture.accepted,
      improved:capture.improved, selectedFeasible:capture.selectedFeasible,
      startEvaluation:capture.startEvaluation, bestEvaluation:capture.bestEvaluation,
      polish:{ method:capturePolish.method, requestedSweeps:capturePolish.requestedSweeps,
        completedSweeps:capturePolish.completedSweeps, evaluations:capturePolish.evaluations,
        improvements:capturePolish.improvements,
        selectedFeasible:capturePolish.selectedFeasible },
    },
    physicalRefinement:physical ? {
      method:physical.method, steps:Number(refinementSteps), proposals:physical.proposals,
      lineEvaluations:physical.lineEvaluations, accepted:physical.accepted,
      improved:physical.improved, selectedFeasible:physical.selectedFeasible,
      startEvaluation:physical.startEvaluation, bestEvaluation:physical.bestEvaluation,
    } : null,
    settings:{ ...selected.settings,
      captureObjective:'selected required-contact flat-bottom penalties plus caller-registered chemical-validity gate penalties',
      capturePolish:'exhaustive best-improvement scan of every eligible move, angle, and line fraction',
      physicalRefinementObjective:'full rigid-pocket energy, ligand strain, and restraints',
      acceptanceInterpretation:'annealed stochastic line-search heuristic; not equilibrium Metropolis, Hastings, ICM, or BPMC',
      stageTransition:'physical refinement starts only after all required contacts and caller-registered chemical-validity gates are feasible',
      captureFailure:'return closest audited pharmacophore geometry without physical refinement',
    },
  };
}
