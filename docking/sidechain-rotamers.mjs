export const SIDECHAIN_ROTAMER_SCHEMA = 'molarium.sidechain-rotamers/v1';
export const SIDECHAIN_ROTAMER_ENUMERATOR_METHOD = 'canonical-chi-grid-steric-prerank-v1';
export const SIDECHAIN_ROTAMER_CHI_TOLERANCE_DEGREES = 0.001;

// Standard heavy-atom chi definitions. Proline is deliberately absent because
// moving its side chain independently would break the backbone-closing ring.
const CHI_ATOMS = Object.freeze({
  ARG:[['N','CA','CB','CG'],['CA','CB','CG','CD'],['CB','CG','CD','NE'],['CG','CD','NE','CZ']],
  ASN:[['N','CA','CB','CG'],['CA','CB','CG','OD1']],
  ASP:[['N','CA','CB','CG'],['CA','CB','CG','OD1']],
  CYS:[['N','CA','CB','SG']],
  GLN:[['N','CA','CB','CG'],['CA','CB','CG','CD'],['CB','CG','CD','OE1']],
  GLU:[['N','CA','CB','CG'],['CA','CB','CG','CD'],['CB','CG','CD','OE1']],
  HIS:[['N','CA','CB','CG'],['CA','CB','CG','ND1']],
  ILE:[['N','CA','CB','CG1'],['CA','CB','CG1','CD1']],
  LEU:[['N','CA','CB','CG'],['CA','CB','CG','CD1']],
  LYS:[['N','CA','CB','CG'],['CA','CB','CG','CD'],['CB','CG','CD','CE'],['CG','CD','CE','NZ']],
  MET:[['N','CA','CB','CG'],['CA','CB','CG','SD'],['CB','CG','SD','CE']],
  PHE:[['N','CA','CB','CG'],['CA','CB','CG','CD1']],
  SER:[['N','CA','CB','OG']],
  THR:[['N','CA','CB','OG1']],
  TPO:[['N','CA','CB','OG1']],
  TRP:[['N','CA','CB','CG'],['CA','CB','CG','CD1']],
  TYR:[['N','CA','CB','CG'],['CA','CB','CG','CD1']],
  VAL:[['N','CA','CB','CG1']],
});

const PLANAR_TERMINAL = new Set(['ASN:2','ASP:2','GLN:3','GLU:3','HIS:2','PHE:2','TRP:2','TYR:2']);
const SP3_TARGETS = Object.freeze([-60, 60, 180]);
const PLANAR_TARGETS = Object.freeze([-90, 0, 90, 180]);
const VDW_RADII = Object.freeze({
  H:1.20, B:1.92, C:1.70, N:1.55, O:1.52, F:1.47, Si:2.10, P:1.80,
  S:1.80, Cl:1.75, Br:1.85, I:1.98,
});

export const SIDECHAIN_ROTAMER_RESIDUES = Object.freeze(Object.keys(CHI_ATOMS));

function pairKey(first, second) {
  return first < second ? `${first}:${second}` : `${second}:${first}`;
}

function vector(first, second) {
  return { x:second.x - first.x, y:second.y - first.y, z:second.z - first.z };
}

function dot(first, second) {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function cross(first, second) {
  return { x:first.y * second.z - first.z * second.y,
    y:first.z * second.x - first.x * second.z,
    z:first.x * second.y - first.y * second.x };
}

function unit(value) {
  const length = Math.hypot(value.x, value.y, value.z);
  if (length < 1e-8) throw new Error('A side-chain torsion axis has zero length');
  return { x:value.x / length, y:value.y / length, z:value.z / length };
}

function normalizeDegrees(value) {
  let result = Number(value) % 360;
  if (result <= -180) result += 360;
  if (result > 180) result -= 360;
  return result;
}

function circularDegreeDistance(first, second) {
  return Math.abs(normalizeDegrees(Number(first) - Number(second)));
}

/**
 * Retain every distinct complete chi-vector in ranked order. A coupled search must not collapse
 * candidates solely because they share chi1: terminal chi angles can move the same side chain into
 * materially different ligand environments. The optional maximum is an explicit cost cap, not a
 * diversity heuristic.
 */
export function uniqueSidechainRotamerCandidates(candidates, { maximum = 64 } = {}) {
  if (!Array.isArray(candidates)) throw new Error('Side-chain candidates must be an array');
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 64)
    throw new Error('maximum must be an integer from 1 to 64');
  const unique = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate?.chiDegrees) || !candidate.chiDegrees.length
      || candidate.chiDegrees.some((value) => !Number.isFinite(value)))
      throw new Error('Every side-chain candidate must contain finite chiDegrees');
    if (unique.some((retained) => retained.chiDegrees.length === candidate.chiDegrees.length
      && retained.chiDegrees.every((value, index) => circularDegreeDistance(
        value, candidate.chiDegrees[index]) <= SIDECHAIN_ROTAMER_CHI_TOLERANCE_DEGREES))) continue;
    unique.push(candidate);
    if (unique.length >= maximum) break;
  }
  return unique;
}

/**
 * Resolve a rotamer by an explicit, fail-closed public selector. Result indices are retained for
 * the visible select control, while chi angles and coordinate hashes remain stable when ranking
 * changes. Chi matching treats -180 and +180 as the same angle and requires one unique match.
 */
export function selectSidechainRotamerCandidate(ensemble, selector = {}) {
  if (ensemble?.schema !== SIDECHAIN_ROTAMER_SCHEMA || !Array.isArray(ensemble.candidates))
    throw new Error('No compatible side-chain rotamer ensemble is available');
  if (!selector || typeof selector !== 'object' || Array.isArray(selector))
    throw new Error('A side-chain rotamer selector must be an object');
  const selectorKeys = ['index','chiDegrees','coordinateSha256','source']
    .filter((key) => Object.hasOwn(selector, key));
  if (selectorKeys.length !== 1)
    throw new Error('Specify exactly one side-chain rotamer selector: index, chiDegrees, coordinateSha256, or source');
  const selectorKey = selectorKeys[0];
  if (selectorKey === 'source') {
    if (selector.source !== 'input') throw new Error('source selector must be input');
    const matches = ensemble.candidates.filter((candidate) => candidate.source === 'input');
    if (matches.length !== 1)
      throw new Error(`source input must resolve to exactly one candidate; found ${matches.length}`);
    return matches[0];
  }
  if (selectorKey === 'index') {
    if (!Number.isInteger(selector.index) || selector.index < 0)
      throw new Error('index must be a non-negative integer');
    const candidate = ensemble.candidates.find((entry) => entry.index === selector.index);
    if (!candidate) throw new Error(`Side-chain rotamer ${selector.index} does not exist`);
    return candidate;
  }
  if (selectorKey === 'coordinateSha256') {
    if (typeof selector.coordinateSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(selector.coordinateSha256))
      throw new Error('coordinateSha256 must be a lowercase SHA-256 hex digest');
    const matches = ensemble.candidates.filter((candidate) =>
      candidate.coordinateSha256 === selector.coordinateSha256);
    if (!matches.length) throw new Error('No side-chain rotamer matches coordinateSha256');
    if (matches.length > 1) throw new Error('coordinateSha256 matches multiple side-chain rotamers');
    return matches[0];
  }
  if (!Array.isArray(selector.chiDegrees) || !selector.chiDegrees.length
    || selector.chiDegrees.some((value) => !Number.isFinite(value)))
    throw new Error('chiDegrees must be a non-empty array of finite angles');
  const chiCount = ensemble.axes?.length || ensemble.candidates[0]?.chiDegrees?.length || 0;
  if (selector.chiDegrees.length !== chiCount)
    throw new Error(`chiDegrees must contain exactly ${chiCount} angle${chiCount === 1 ? '' : 's'}`);
  const normalized = selector.chiDegrees.map(normalizeDegrees);
  const matches = ensemble.candidates.filter((candidate) =>
    Array.isArray(candidate.chiDegrees) && candidate.chiDegrees.length === normalized.length
    && candidate.chiDegrees.every((value, index) => circularDegreeDistance(
      value, normalized[index]) <= SIDECHAIN_ROTAMER_CHI_TOLERANCE_DEGREES));
  if (!matches.length) throw new Error('No side-chain rotamer matches chiDegrees');
  if (matches.length > 1) throw new Error('chiDegrees ambiguously match multiple side-chain rotamers');
  return matches[0];
}

export function assertSidechainRotamerCoordinateGuards({ ensemble, candidate,
  currentCoordinateSha256, expectedInputCoordinateSha256 = null,
  expectedSelectedCoordinateSha256 = null } = {}) {
  if (ensemble?.schema !== SIDECHAIN_ROTAMER_SCHEMA || !candidate)
    throw new Error('No compatible selected side-chain rotamer is available');
  if (expectedInputCoordinateSha256 != null
    && expectedInputCoordinateSha256 !== ensemble.inputCoordinateSha256)
    throw new Error('expectedInputCoordinateSha256 does not match the enumerated coordinate input');
  if (currentCoordinateSha256 !== ensemble.inputCoordinateSha256)
    throw new Error('The molecular coordinates changed after side-chain enumeration; enumerate again.');
  if (expectedSelectedCoordinateSha256 != null
    && expectedSelectedCoordinateSha256 !== candidate.coordinateSha256)
    throw new Error('expectedSelectedCoordinateSha256 does not match the selected rotamer');
  return true;
}

function torsionDegrees(first, second, third, fourth) {
  const b0 = vector(second, first), b1 = vector(second, third), b2 = vector(third, fourth);
  const axis = unit(b1);
  const v = { x:b0.x - dot(b0, axis) * axis.x,
    y:b0.y - dot(b0, axis) * axis.y, z:b0.z - dot(b0, axis) * axis.z };
  const w = { x:b2.x - dot(b2, axis) * axis.x,
    y:b2.y - dot(b2, axis) * axis.y, z:b2.z - dot(b2, axis) * axis.z };
  return normalizeDegrees(Math.atan2(dot(cross(axis, v), w), dot(v, w)) * 180 / Math.PI);
}

/**
 * Measure the standard heavy-atom chi angles of one explicitly located residue from a
 * coordinate-bearing `session.inspect` atom list. This is intentionally separate from rotamer
 * enumeration: an induced-fit calculation can move the selected side chain after its seed
 * rotamer was applied, so scientific records must distinguish the seed angles from the relaxed
 * angles actually present in the inspected coordinates.
 */
export function measureInspectedSidechainChiAngles({ atoms, residue } = {}) {
  if (!Array.isArray(atoms) || !atoms.length)
    throw new Error('Side-chain chi measurement requires inspected atoms');
  if (!residue || typeof residue !== 'object' || Array.isArray(residue))
    throw new Error('Side-chain chi measurement requires an explicit residue locator');
  const residueName = String(residue.residueName || '').toUpperCase();
  const definitions = CHI_ATOMS[residueName];
  if (!definitions)
    throw new Error(`${residueName || 'This residue'} does not have measurable side-chain chi angles`);
  if (typeof residue.chain !== 'string' || !Number.isInteger(residue.residueIndex)
    || residue.insertionCode != null && typeof residue.insertionCode !== 'string')
    throw new Error('The residue locator requires chain, integer residueIndex, and optional insertionCode');
  const insertionCode = String(residue.insertionCode || '');
  const located = atoms.filter((atom) => String(atom?.residueName || '').toUpperCase() === residueName
    && String(atom?.chain || '') === residue.chain
    && atom?.residueIndex === residue.residueIndex
    && String(atom?.insertionCode || '') === insertionCode);
  const requiredNames = [...new Set(definitions.flat())];
  const byName = new Map();
  for (const name of requiredNames) {
    const matches = located.filter((atom) => atom?.atomName === name);
    if (matches.length !== 1) {
      const label = `${residueName} ${residue.chain}${residue.residueIndex}${insertionCode}`;
      if (!matches.length) throw new Error(`${label} is missing ${name} for chi measurement`);
      throw new Error(`${label} contains multiple ${name} atoms for chi measurement`);
    }
    byName.set(name, matches[0]);
  }
  return definitions.map((names) => Number(torsionDegrees(
    ...names.map((name) => {
      const [x,y,z] = inspectedPoint(byName.get(name));
      return { x,y,z };
    })).toFixed(3)));
}

export function assertSidechainChiAnglesReproduced(expected, observed,
  { toleranceDegrees = SIDECHAIN_ROTAMER_CHI_TOLERANCE_DEGREES } = {}) {
  if (!Array.isArray(expected) || !expected.length || expected.some((value) => !Number.isFinite(value))
    || !Array.isArray(observed) || observed.some((value) => !Number.isFinite(value))
    || expected.length !== observed.length)
    throw new Error('Comparable side-chain chi vectors must contain the same number of finite angles');
  if (!Number.isFinite(toleranceDegrees) || toleranceDegrees < 0)
    throw new Error('toleranceDegrees must be a non-negative finite number');
  const mismatch = expected.findIndex((value, index) =>
    circularDegreeDistance(value, observed[index]) > toleranceDegrees);
  if (mismatch >= 0)
    throw new Error(`Relaxed side-chain chi${mismatch + 1} changed during deterministic replay`);
  return true;
}

function rotatePoint(point, origin, axis, radians) {
  const relative = { x:point.x - origin.x, y:point.y - origin.y, z:point.z - origin.z };
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const projection = dot(relative, axis), perpendicular = cross(axis, relative);
  return {
    x:origin.x + relative.x * cosine + perpendicular.x * sine + axis.x * projection * (1 - cosine),
    y:origin.y + relative.y * cosine + perpendicular.y * sine + axis.y * projection * (1 - cosine),
    z:origin.z + relative.z * cosine + perpendicular.z * sine + axis.z * projection * (1 - cosine),
  };
}

function adjacencyFor(molecule) {
  const adjacency = molecule.atoms.map(() => []);
  for (const bond of molecule.bonds || []) {
    if (!Number.isInteger(bond.a) || !Number.isInteger(bond.b)
      || !adjacency[bond.a] || !adjacency[bond.b]) continue;
    adjacency[bond.a].push(bond.b); adjacency[bond.b].push(bond.a);
  }
  return adjacency;
}

function distalAtoms(adjacency, proximal, distal) {
  const result = [], seen = new Set([proximal, distal]), queue = [distal];
  while (queue.length) {
    const index = queue.shift(); result.push(index);
    for (const neighbor of adjacency[index] || []) if (!seen.has(neighbor)) {
      seen.add(neighbor); queue.push(neighbor);
    }
  }
  return result;
}

function localExclusions(adjacency, maximumBondDistance = 3) {
  const excluded = new Set();
  adjacency.forEach((_, root) => {
    const visited = new Map([[root, 0]]), queue = [root];
    while (queue.length) {
      const current = queue.shift(), distance = visited.get(current);
      if (distance >= maximumBondDistance) continue;
      for (const neighbor of adjacency[current] || []) if (!visited.has(neighbor)) {
        visited.set(neighbor, distance + 1); queue.push(neighbor);
        excluded.add(pairKey(root, neighbor));
      }
    }
  });
  return excluded;
}

// Only atoms off a declared chi axis can respond. In particular, CB is on
// CA–CB and must never acquire clash permission merely by belonging to Phe.
export function sidechainResponseAtomIndices({ molecule, residue } = {}) {
  const definitions = CHI_ATOMS[residue?.residueName];
  if (!definitions) throw new Error('Response residue has no supported side-chain chi rotations');
  const indices = molecule.atoms.flatMap((atom, index) =>
    atom.residueName === residue.residueName && (atom.chain || '') === residue.chain
      && atom.residueIndex === residue.residueIndex
      && (atom.insertionCode || '') === (residue.insertionCode || '')
      && (!atom.record || atom.record === 'ATOM') ? [index] : []);
  const named = (name) => {
    const matches = indices.filter((index) => molecule.atoms[index].atomName === name);
    if (matches.length !== 1) throw new Error(`Response residue must contain exactly one ${name}`);
    return matches[0];
  };
  const adjacency = adjacencyFor(molecule), movable = new Set();
  for (const names of definitions) {
    const [, proximal, distal] = names.map(named);
    if (!adjacency[proximal].includes(distal)) throw new Error('Response chi axis is not bonded');
    const seen = new Set([distal]), queue = [distal];
    while (queue.length) {
      const index = queue.shift();
      for (const neighbor of adjacency[index]) {
        if (index === distal && neighbor === proximal) continue;
        if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
      }
    }
    if (seen.has(proximal) || [...seen].some((index) => !indices.includes(index)))
      throw new Error('Response chi branch is cyclic or linked outside the residue');
    const origin = molecule.atoms[proximal];
    const axis = unit(vector(origin, molecule.atoms[distal]));
    for (const index of seen) {
      const offset = vector(origin, molecule.atoms[index]);
      const perpendicular = cross(axis, offset);
      if (Math.hypot(perpendicular.x, perpendicular.y, perpendicular.z) > 1e-8)
        movable.add(index);
    }
  }
  return [...movable].sort((a, b) => a - b);
}

function coordinateRmsd(first, second, atomIndices) {
  const sum = atomIndices.reduce((total, index) => total
    + (first[index].x - second[index].x) ** 2
    + (first[index].y - second[index].y) ** 2
    + (first[index].z - second[index].z) ** 2, 0);
  return Math.sqrt(sum / Math.max(1, atomIndices.length));
}

function scoreCoordinates(molecule, coordinates, movable, ligandAtomIndices, exclusions) {
  const movableSet = new Set(movable), ligand = new Set(ligandAtomIndices || []);
  let stericPenalty = 0, ligandStericPenalty = 0, severeClashes = 0;
  let minimumNonbondedDistance = Number.POSITIVE_INFINITY, maximumOverlap = 0;
  for (const index of movable) {
    const atom = molecule.atoms[index];
    if (!atom || atom.element === 'H') continue;
    const point = coordinates[index];
    for (let otherIndex = 0; otherIndex < molecule.atoms.length; otherIndex++) {
      const other = molecule.atoms[otherIndex];
      if (!other || other.element === 'H' || movableSet.has(otherIndex)
        || exclusions.has(pairKey(index, otherIndex))) continue;
      const distance = Math.hypot(point.x - other.x, point.y - other.y, point.z - other.z);
      minimumNonbondedDistance = Math.min(minimumNonbondedDistance, distance);
      const radius = (VDW_RADII[atom.element] || 1.75) + (VDW_RADII[other.element] || 1.75);
      const overlap = Math.max(0, radius * 0.78 - distance);
      if (!overlap) continue;
      const penalty = overlap * overlap;
      stericPenalty += penalty;
      maximumOverlap = Math.max(maximumOverlap, overlap);
      if (ligand.has(otherIndex)) ligandStericPenalty += penalty;
      if (distance < radius * 0.62) severeClashes += 1;
    }
  }
  const score = severeClashes * 100 + stericPenalty * 10 + ligandStericPenalty * 5;
  return { score, stericPenalty, ligandStericPenalty, severeClashes,
    minimumNonbondedDistance:Number.isFinite(minimumNonbondedDistance)
      ? minimumNonbondedDistance : null, maximumOverlap };
}

function combinations(values) {
  return values.reduce((result, choices) => result.flatMap((prefix) =>
    choices.map((choice) => [...prefix, choice])), [[]]);
}

export function enumerateSidechainRotamers({ molecule, residueAtomIndex,
  ligandAtomIndices = [], maximumCandidates = 32 } = {}) {
  if (!molecule?.atoms?.length || !Array.isArray(molecule.bonds))
    throw new Error('Side-chain enumeration requires a molecular graph');
  if (!Number.isInteger(residueAtomIndex) || !molecule.atoms[residueAtomIndex])
    throw new Error('residueAtomIndex must identify an atom in the molecule');
  if (!Number.isInteger(maximumCandidates) || maximumCandidates < 1 || maximumCandidates > 64)
    throw new Error('maximumCandidates must be an integer from 1 to 64');
  const selected = molecule.atoms[residueAtomIndex];
  if (selected.record && selected.record !== 'ATOM')
    throw new Error('The selected atom is not in a protein residue');
  const residueName = String(selected.residueName || '').toUpperCase();
  const definitions = CHI_ATOMS[residueName];
  if (!definitions)
    throw new Error(`${residueName || 'This residue'} does not have an enumerable side-chain rotamer`);
  const residueIndices = molecule.atoms.flatMap((atom, index) =>
    (!atom.record || atom.record === 'ATOM')
      && (atom.chain || 'A') === (selected.chain || 'A')
      && atom.residueIndex === selected.residueIndex
      && (atom.insertionCode || '') === (selected.insertionCode || '') ? [index] : []);
  const byName = new Map(residueIndices.map((index) => [molecule.atoms[index].atomName, index]));
  const missing = [...new Set(definitions.flat())].filter((name) => !byName.has(name));
  if (missing.length) throw new Error(`${residueName} ${(selected.chain || 'A')}${selected.residueIndex} is missing ${missing.join(', ')}`);

  const adjacency = adjacencyFor(molecule);
  const axes = definitions.map((names, ordinal) => {
    const indices = names.map((name) => byName.get(name));
    const [first, proximal, distal, fourth] = indices;
    const movable = distalAtoms(adjacency, proximal, distal);
    if (movable.includes(proximal))
      throw new Error(`${residueName} chi${ordinal + 1} is cyclic and cannot be sampled safely`);
    if (movable.some((index) => !residueIndices.includes(index)))
      throw new Error(`${residueName} chi${ordinal + 1} is covalently linked outside the residue and cannot be sampled independently`);
    return { ordinal:ordinal + 1, atomNames:names, atomIndices:indices,
      proximal, distal, movable };
  });
  const sidechainIndices = [...new Set(axes.flatMap((axis) => axis.movable))]
    .filter((index) => residueIndices.includes(index));
  const heavySidechainIndices = sidechainIndices.filter((index) => molecule.atoms[index].element !== 'H');
  const input = molecule.atoms.map((atom) => ({ x:Number(atom.x), y:Number(atom.y), z:Number(atom.z) }));
  const inputChiDegrees = axes.map((axis) => torsionDegrees(...axis.atomIndices.map((index) => input[index])));
  const targets = axes.map((axis) => PLANAR_TERMINAL.has(`${residueName}:${axis.ordinal}`)
    ? PLANAR_TARGETS : SP3_TARGETS);
  const specifications = [{ source:'input', targets:inputChiDegrees },
    ...combinations(targets).map((entry) => ({ source:'canonical-library', targets:entry }))];
  const exclusions = localExclusions(adjacency);
  const candidates = [];
  for (const specification of specifications) {
    const coordinates = input.map((point) => ({ ...point }));
    axes.forEach((axis, axisIndex) => {
      const [first, proximal, distal, fourth] = axis.atomIndices;
      const current = torsionDegrees(coordinates[first], coordinates[proximal],
        coordinates[distal], coordinates[fourth]);
      const delta = normalizeDegrees(specification.targets[axisIndex] - current);
      const origin = coordinates[proximal];
      const direction = unit(vector(coordinates[proximal], coordinates[distal]));
      axis.movable.forEach((index) => { coordinates[index] = rotatePoint(
        coordinates[index], origin, direction, delta * Math.PI / 180); });
    });
    if (candidates.some((entry) => coordinateRmsd(entry.coordinates, coordinates,
      heavySidechainIndices) < 0.04)) continue;
    const chiDegrees = axes.map((axis) => Number(torsionDegrees(
      ...axis.atomIndices.map((index) => coordinates[index])).toFixed(3)));
    candidates.push({ source:specification.source, chiDegrees, coordinates,
      ...scoreCoordinates(molecule, coordinates, sidechainIndices, ligandAtomIndices, exclusions) });
  }
  candidates.sort((first, second) => first.score - second.score
    || first.severeClashes - second.severeClashes
    || first.stericPenalty - second.stericPenalty
    || (first.source === 'input' ? -1 : 1));
  const retained = candidates.slice(0, maximumCandidates).map((candidate, index) => ({
    index, rank:index + 1, source:candidate.source,
    chiDegrees:candidate.chiDegrees,
    score:Number(candidate.score.toFixed(6)),
    stericPenalty:Number(candidate.stericPenalty.toFixed(6)),
    ligandStericPenalty:Number(candidate.ligandStericPenalty.toFixed(6)),
    severeClashes:candidate.severeClashes,
    minimumNonbondedDistanceAngstrom:candidate.minimumNonbondedDistance == null ? null
      : Number(candidate.minimumNonbondedDistance.toFixed(4)),
    maximumOverlapAngstrom:Number(candidate.maximumOverlap.toFixed(4)),
    positions:sidechainIndices.map((atomIndex) => ({ atomIndex,
      x:candidate.coordinates[atomIndex].x,
      y:candidate.coordinates[atomIndex].y,
      z:candidate.coordinates[atomIndex].z })),
  }));
  return {
    schema:SIDECHAIN_ROTAMER_SCHEMA,
    method:SIDECHAIN_ROTAMER_ENUMERATOR_METHOD,
    residue:{ residueName, chain:selected.chain || 'A', residueIndex:selected.residueIndex,
      insertionCode:selected.insertionCode || '', atomIndices:residueIndices,
      sidechainAtomIndices:sidechainIndices },
    axes:axes.map((axis) => ({ chi:`chi${axis.ordinal}`, atomNames:axis.atomNames })),
    inputChiDegrees:inputChiDegrees.map((value) => Number(value.toFixed(3))),
    generatedCandidateCount:candidates.length,
    candidates:retained,
  };
}

export function applySidechainRotamer(molecule, ensemble, index) {
  if (ensemble?.schema !== SIDECHAIN_ROTAMER_SCHEMA)
    throw new Error('No compatible side-chain rotamer ensemble is available');
  if (!Number.isInteger(index) || index < 0 || !ensemble.candidates[index])
    throw new Error(`Side-chain rotamer ${index} does not exist`);
  const candidate = ensemble.candidates[index];
  for (const position of candidate.positions) {
    const atom = molecule.atoms[position.atomIndex];
    if (!atom) throw new Error('The molecule changed after side-chain enumeration');
    atom.x = position.x; atom.y = position.y; atom.z = position.z;
  }
  for (const bond of molecule.bonds || []) {
    const first = molecule.atoms[bond.a], second = molecule.atoms[bond.b];
    bond.distance = Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
  }
  return candidate;
}

export const COUPLED_SIDECHAIN_POSE_SELECTION_CRITERION =
  'registered hard-anchor retention is required; maximize changed-region post-relaxation van der Waals engagement, then minimize absolute receptor overlap, hard-anchor displacement, relaxed energy, pre-relax pose score, and candidate rank';

export const CHANGED_REGION_VDW_ENGAGEMENT_MAXIMUM_RATIO = 1.25;
export const CHANGED_REGION_VDW_ENGAGEMENT_MINIMUM_RATIO = 0.78;

function normalizedElement(element) {
  const text = String(element || '').trim();
  if (!text) return '';
  return text.length === 1 ? text.toUpperCase()
    : `${text[0].toUpperCase()}${text.slice(1).toLowerCase()}`;
}

function inspectedPoint(atom) {
  const coordinates = atom?.coordinatesAngstrom;
  if (!Array.isArray(coordinates) || coordinates.length !== 3
    || coordinates.some((value) => !Number.isFinite(Number(value))))
    throw new Error('Post-relaxation atom evidence must contain finite coordinatesAngstrom');
  return coordinates.map(Number);
}

/**
 * Score the current relaxed ligand against the current receptor pocket without subtracting the
 * starting branch. This deliberately small absolute audit catches the failure mode where a branch
 * with a clashing starting receptor appears acceptable only because its pre-relax score is
 * baseline-relative. Coordinate-bearing inputs are expected to come from session.inspect.
 */
export function evaluatePostRelaxedLigandPocket({ ligandAtoms, pocketAtoms } = {}) {
  if (!Array.isArray(ligandAtoms) || !ligandAtoms.length)
    throw new Error('Post-relaxation scoring requires ligandAtoms');
  if (!Array.isArray(pocketAtoms) || !pocketAtoms.length)
    throw new Error('Post-relaxation scoring requires pocketAtoms');
  const ligandIds = new Set(ligandAtoms.map((atom) => atom?.atomId).filter(Boolean));
  const ligand = ligandAtoms.filter((atom) => normalizedElement(atom?.element) !== 'H')
    .map((atom) => ({ atom, point:inspectedPoint(atom) }));
  const receptor = pocketAtoms.filter((atom) => !ligandIds.has(atom?.atomId)
    && normalizedElement(atom?.element) !== 'H')
    .map((atom) => ({ atom, point:inspectedPoint(atom) }));
  if (!ligand.length || !receptor.length)
    throw new Error('Post-relaxation scoring requires heavy ligand and receptor atoms');
  let stericPenalty = 0, severeClashes = 0;
  let minimumDistance = Number.POSITIVE_INFINITY, maximumOverlap = 0;
  const severePairs = [];
  for (const ligandEntry of ligand) for (const receptorEntry of receptor) {
    const [lx,ly,lz] = ligandEntry.point, [rx,ry,rz] = receptorEntry.point;
    const distance = Math.hypot(lx - rx, ly - ry, lz - rz);
    minimumDistance = Math.min(minimumDistance, distance);
    const ligandRadius = VDW_RADII[normalizedElement(ligandEntry.atom.element)] || 1.75;
    const receptorRadius = VDW_RADII[normalizedElement(receptorEntry.atom.element)] || 1.75;
    const radius = ligandRadius + receptorRadius;
    const overlap = Math.max(0, radius * 0.78 - distance);
    if (!overlap) continue;
    stericPenalty += overlap * overlap;
    maximumOverlap = Math.max(maximumOverlap, overlap);
    if (distance < radius * 0.62) {
      severeClashes += 1;
      if (severePairs.length < 32) severePairs.push({
        ligandAtomId:ligandEntry.atom.atomId || null,
        receptorAtomId:receptorEntry.atom.atomId || null,
        distanceAngstrom:Number(distance.toFixed(4)),
        overlapAngstrom:Number(overlap.toFixed(4)),
      });
    }
  }
  const score = severeClashes * 100 + stericPenalty * 10;
  return {
    method:'absolute-heavy-atom-overlap-v1',
    interpretation:'absolute post-relaxation ligand-versus-current-receptor steric audit',
    feasible:severeClashes === 0,
    score:Number(score.toFixed(6)),
    severeClashes,
    stericPenalty:Number(stericPenalty.toFixed(6)),
    minimumNonbondedDistanceAngstrom:Number(minimumDistance.toFixed(4)),
    maximumOverlapAngstrom:Number(maximumOverlap.toFixed(4)),
    ligandHeavyAtomCount:ligand.length,
    receptorHeavyAtomCount:receptor.length,
    severePairs,
  };
}

function completeInspection(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Array.isArray(value.atoms) || !value.atoms.length)
    throw new Error(`${label} must be a coordinate-bearing session.inspect result`);
  if (value.truncated !== false)
    throw new Error(`${label} must explicitly report truncated:false`);
  if (!Number.isInteger(value.totalAtomCount)
    || value.totalAtomCount !== value.atoms.length)
    throw new Error(`${label} must report complete totalAtomCount coverage`);
  return value.atoms;
}

function inspectedHeavyAtoms(value, label) {
  return completeInspection(value, label)
    .filter((atom) => normalizedElement(atom?.element) !== 'H')
    .map((atom) => ({ ...atom, point:inspectedPoint(atom) }));
}

function uniqueAtomByName(atoms, atomName, label) {
  const matches = atoms.filter((atom) => atom?.atomName === atomName);
  if (matches.length !== 1)
    throw new Error(`${label} must contain exactly one heavy atom named ${atomName}`);
  return matches[0];
}

/**
 * Audit a relaxed coupled ligand/receptor branch against intent that existed before the branch.
 * The hard anchor comes only from the registered predecessor-product graph map.  Its coordinates
 * are compared without superposition because the receptor frame is fixed.  Pocket engagement is
 * evaluated only for route-declared changed ligand atoms, so a large inherited core cannot hide a
 * newly designed region that escaped the pocket.  No target or later structure is accepted here.
 */
export function evaluatePostRelaxedBranchObjective({ referenceLigand, ligand, pocket,
  hardAtomNames, changedLigandAtomIds, coreToleranceAngstrom = 0.5 } = {}) {
  const referenceAtoms = inspectedHeavyAtoms(referenceLigand, 'Reference ligand inspection');
  const ligandAtoms = inspectedHeavyAtoms(ligand, 'Relaxed ligand inspection');
  const pocketAtoms = inspectedHeavyAtoms(pocket, 'Relaxed pocket inspection');
  const ligandAtomIds = ligandAtoms.map((atom) => atom.atomId);
  if (ligandAtomIds.some((id) => typeof id !== 'string' || !id)
    || new Set(ligandAtomIds).size !== ligandAtomIds.length)
    throw new Error('Relaxed ligand inspection must contain unique persistent atom IDs');
  const names = Array.from(hardAtomNames || []);
  if (names.length < 3 || new Set(names).size !== names.length
    || names.some((name) => typeof name !== 'string' || !name))
    throw new Error('Registered hardAtomNames must contain at least three unique names');
  const tolerance = Number(coreToleranceAngstrom);
  if (!Number.isFinite(tolerance) || tolerance < 0)
    throw new Error('coreToleranceAngstrom must be finite and nonnegative');
  let hardSquared = 0, hardMaximum = 0;
  const referenceCentroid = [0,0,0], relaxedCentroid = [0,0,0];
  for (const name of names) {
    const before = uniqueAtomByName(referenceAtoms, name, 'Reference ligand inspection');
    const after = uniqueAtomByName(ligandAtoms, name, 'Relaxed ligand inspection');
    if (typeof before.atomId !== 'string' || !before.atomId
      || before.atomId !== after.atomId)
      throw new Error(`Registered hard atom ${name} changed persistent identity`);
    if (normalizedElement(before.element) !== normalizedElement(after.element))
      throw new Error(`Registered hard atom ${name} changed element`);
    const squared = before.point.reduce((sum, coordinate, axis) =>
      sum + (coordinate - after.point[axis]) ** 2, 0);
    hardSquared += squared; hardMaximum = Math.max(hardMaximum, Math.sqrt(squared));
    for (let axis = 0; axis < 3; axis++) {
      referenceCentroid[axis] += before.point[axis] / names.length;
      relaxedCentroid[axis] += after.point[axis] / names.length;
    }
  }
  const hardAnchorRmsdAngstrom = Math.sqrt(hardSquared / names.length);
  const hardAnchorCentroidDisplacementAngstrom = Math.hypot(
    ...referenceCentroid.map((coordinate, axis) => coordinate - relaxedCentroid[axis]));
  const ligandIds = new Set(ligandAtomIds);
  const receptorAtoms = pocketAtoms.filter((atom) => !ligandIds.has(atom.atomId));
  if (!receptorAtoms.length)
    throw new Error('Relaxed pocket inspection must contain receptor heavy atoms');
  const changedIds = Array.from(changedLigandAtomIds || []);
  if (!changedIds.length || new Set(changedIds).size !== changedIds.length
    || changedIds.some((id) => typeof id !== 'string' || !id))
    throw new Error('changedLigandAtomIds must contain unique persistent atom IDs');
  const ligandById = new Map(ligandAtoms.map((atom) => [atom.atomId, atom]));
  const changedAtoms = changedIds.map((id) => {
    const atom = ligandById.get(id);
    if (!atom) throw new Error(`Changed ligand atom ${id} is absent from relaxed inspection`);
    return atom;
  });
  let contactPairCount = 0;
  const perAtomEngagement = changedAtoms.map((changed) => {
    let closest = Number.POSITIVE_INFINITY, strongest = 0;
    for (const receptor of receptorAtoms) {
      const distance = Math.hypot(...changed.point.map((coordinate, axis) =>
        coordinate - receptor.point[axis]));
      const radii = (VDW_RADII[normalizedElement(changed.element)] || 1.75)
        + (VDW_RADII[normalizedElement(receptor.element)] || 1.75);
      const ratio = distance / radii;
      closest = Math.min(closest, ratio);
      if (ratio >= CHANGED_REGION_VDW_ENGAGEMENT_MINIMUM_RATIO
        && ratio <= CHANGED_REGION_VDW_ENGAGEMENT_MAXIMUM_RATIO) {
        contactPairCount += 1;
        strongest = Math.max(strongest,
          (CHANGED_REGION_VDW_ENGAGEMENT_MAXIMUM_RATIO - ratio)
            / (CHANGED_REGION_VDW_ENGAGEMENT_MAXIMUM_RATIO
              - CHANGED_REGION_VDW_ENGAGEMENT_MINIMUM_RATIO));
      }
    }
    return { closest, strength:Math.min(1, strongest) };
  });
  const engagedHeavyAtomCount = perAtomEngagement.filter((entry) => entry.strength > 0).length;
  const engagementScore = perAtomEngagement.reduce((sum, entry) =>
    sum + entry.strength, 0) / changedAtoms.length;
  const closestVdwRatios = perAtomEngagement.map((entry) => entry.closest);
  const receptorAware = evaluatePostRelaxedLigandPocket({
    ligandAtoms:ligand.atoms, pocketAtoms:pocket.atoms,
  });
  const poseIntent = {
    method:'raw-same-receptor-frame-registered-hard-anchor-v1',
    atomCount:names.length,
    toleranceAngstrom:tolerance,
    hardAnchorRmsdAngstrom:Number(hardAnchorRmsdAngstrom.toFixed(6)),
    hardAnchorMaximumDisplacementAngstrom:Number(hardMaximum.toFixed(6)),
    hardAnchorCentroidDisplacementAngstrom:
      Number(hardAnchorCentroidDisplacementAngstrom.toFixed(6)),
    satisfied:hardAnchorRmsdAngstrom <= tolerance,
    superpositionApplied:false,
  };
  const changedRegionEngagement = {
    method:'changed-region-nearest-receptor-vdw-ratio-v1',
    changedHeavyAtomCount:changedAtoms.length,
    engagedHeavyAtomCount,
    engagedHeavyAtomFraction:Number((engagedHeavyAtomCount / changedAtoms.length).toFixed(6)),
    engagementScore:Number(engagementScore.toFixed(6)),
    contactPairCount,
    minimumContactVdwRatio:CHANGED_REGION_VDW_ENGAGEMENT_MINIMUM_RATIO,
    maximumContactVdwRatio:CHANGED_REGION_VDW_ENGAGEMENT_MAXIMUM_RATIO,
    meanClosestVdwRatio:Number((closestVdwRatios.reduce((sum, value) => sum + value, 0)
      / closestVdwRatios.length).toFixed(6)),
    maximumClosestVdwRatio:Number(Math.max(...closestVdwRatios).toFixed(6)),
  };
  return {
    method:'registered-pose-retention-plus-changed-region-vdw-engagement-v1',
    prospectiveInputsOnly:true,
    feasible:poseIntent.satisfied && receptorAware.feasible,
    poseIntent, changedRegionEngagement, receptorAware,
  };
}

export function selectCoupledSidechainPoseBranch(branches) {
  if (!Array.isArray(branches)) throw new Error('Coupled side-chain branches must be an array');
  const digest = /^[a-f0-9]{64}$/;
  const viable = branches.filter((branch) => {
    const postRelaxation = branch?.postRelaxation;
    const evidence = postRelaxation?.topPoseEvidence;
    const objective = postRelaxation?.branchObjective;
    return branch.refinement?.selectedFeasible === true
    && objective?.feasible === true
    && objective?.poseIntent?.satisfied === true
    && Number.isFinite(objective.poseIntent.hardAnchorRmsdAngstrom)
    && Number.isFinite(objective.changedRegionEngagement?.engagedHeavyAtomFraction)
    && Number.isFinite(objective.changedRegionEngagement?.engagementScore)
    && Number.isFinite(objective.changedRegionEngagement?.contactPairCount)
    && postRelaxation?.receptorAware?.feasible === true
    && Number.isFinite(postRelaxation.receptorAware.score)
    && evidence?.schema === 'molarium.coordinate-evidence/v1'
    && evidence.ligand?.truncated === false
    && evidence.pocket?.truncated === false
    && Array.isArray(evidence.ligand?.atoms) && evidence.ligand.atoms.length > 0
    && Array.isArray(evidence.pocket?.atoms) && evidence.pocket.atoms.length > 0
    && digest.test(evidence.ligandCoordinateSha256 || '')
    && digest.test(evidence.pocketCoordinateSha256 || '')
    && branch.optimization?.accepted === true
    && Number.isFinite(branch.optimization?.finalEnergy);
  });
  if (!viable.length)
    throw new Error('No side-chain branch preserved registered pose intent with complete, feasible post-relaxation evidence');
  return [...viable].sort((first, second) =>
    second.postRelaxation.branchObjective.changedRegionEngagement.engagementScore
      - first.postRelaxation.branchObjective.changedRegionEngagement.engagementScore
    || second.postRelaxation.branchObjective.changedRegionEngagement.engagedHeavyAtomFraction
      - first.postRelaxation.branchObjective.changedRegionEngagement.engagedHeavyAtomFraction
    || first.postRelaxation.receptorAware.score - second.postRelaxation.receptorAware.score
    || first.postRelaxation.branchObjective.poseIntent.hardAnchorRmsdAngstrom
      - second.postRelaxation.branchObjective.poseIntent.hardAnchorRmsdAngstrom
    || first.optimization.finalEnergy - second.optimization.finalEnergy
    || Number(first.refinement?.selectedScoreKcalMol ?? Number.POSITIVE_INFINITY)
      - Number(second.refinement?.selectedScoreKcalMol ?? Number.POSITIVE_INFINITY)
    || Number(first.candidateRank ?? Number.MAX_SAFE_INTEGER)
      - Number(second.candidateRank ?? Number.MAX_SAFE_INTEGER))[0];
}
