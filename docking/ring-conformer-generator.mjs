import { applyCoreTransform, fittedCoreTransform, snapCorePositions } from './constraints.mjs';
import { attachNonCoreRegionsToSnappedCore } from './feature-seeding.mjs';
import { perceiveFlexibleRings } from './restraint-biased-search.mjs';

export const CLOSED_RING_CONFORMER_DEFAULTS = Object.freeze({
  method:'molarium-closed-ring-conformer-generator/v1',
  requestedConformers:32,
  seed:20260822,
  maximumRingSize:24,
  maximumInternalRingBondChangeAngstrom:1e-5,
  maximumBoundaryBondChangeAngstrom:0.35,
  maximumTrigonalOutOfPlaneAngstrom:0.15,
  minimumDistinctRingRmsdAngstrom:0.08,
});

function finitePositions(value, atomCount, label) {
  const positions = value instanceof Float64Array ? new Float64Array(value)
    : Float64Array.from(value || []);
  if (positions.length !== atomCount * 3
    || positions.some((coordinate) => !Number.isFinite(coordinate)))
    throw new Error(`${label} must contain ${atomCount * 3} finite coordinates`);
  return positions;
}

function point(positions, atomIndex) {
  return [positions[atomIndex * 3], positions[atomIndex * 3 + 1], positions[atomIndex * 3 + 2]];
}

function subtract(first, second) { return first.map((value, axis) => value - second[axis]); }
function dot(first, second) { return first.reduce((sum, value, axis) => sum + value * second[axis], 0); }
function cross(first, second) {
  return [first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0]];
}
function norm(vector) { return Math.hypot(...vector); }
function distance(positions, first, second) { return norm(subtract(point(positions, first), point(positions, second))); }

function adjacency(molecule) {
  const entries = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond, bondIndex) => {
    entries[bond.a].push({ atom:bond.b, bondIndex });
    entries[bond.b].push({ atom:bond.a, bondIndex });
  });
  return entries;
}

function configuredStereocenters(molecule, positions) {
  const entries = adjacency(molecule), centers = [];
  molecule.atoms.forEach((atom, center) => {
    const neighbors = entries[center].map((entry) => entry.atom);
    if (atom.element === 'H' || neighbors.length !== 4
      || entries[center].some(({ bondIndex }) => Number(molecule.bonds[bondIndex].order || 1) !== 1)) return;
    const branchLabels = neighbors.map((index) => [molecule.atoms[index].element,
      entries[index].length, Number(molecule.atoms[index].formalCharge ?? molecule.atoms[index].charge ?? 0)].join(':'));
    if (new Set(branchLabels).size !== 4) return;
    const reference = neighbors.map((index) => point(positions, index));
    const fourth = reference[3];
    const volume = dot(subtract(reference[0], fourth),
      cross(subtract(reference[1], fourth), subtract(reference[2], fourth)));
    if (Math.abs(volume) > 1e-4) centers.push({ center, neighbors, referenceVolume:volume });
  });
  return centers;
}

function stereochemistryAudit(positions, centers) {
  const inverted = [];
  centers.forEach((center) => {
    const neighbors = center.neighbors.map((index) => point(positions, index));
    const fourth = neighbors[3];
    const volume = dot(subtract(neighbors[0], fourth),
      cross(subtract(neighbors[1], fourth), subtract(neighbors[2], fourth)));
    if (volume * center.referenceVolume <= 0) inverted.push({ atomIndex:center.center,
      referenceSignedVolume:center.referenceVolume, candidateSignedVolume:volume });
  });
  return { valid:inverted.length === 0, configuredCenters:centers.length, inverted };
}

function carbonylPlanarityAudit(molecule, positions, maximumDeviation) {
  const entries = adjacency(molecule), violations = [];
  molecule.atoms.forEach((atom, center) => {
    if (atom.element !== 'C') return;
    const oxygen = entries[center].find(({ atom:neighbor, bondIndex }) =>
      molecule.atoms[neighbor].element === 'O'
      && Number(molecule.bonds[bondIndex].order || 1) >= 1.75)?.atom;
    const neighbors = entries[center].map((entry) => entry.atom);
    if (!Number.isInteger(oxygen) || neighbors.length !== 3) return;
    const [first, second] = neighbors.filter((neighbor) => neighbor !== oxygen);
    const origin = point(positions, center);
    const normal = cross(subtract(point(positions, first), origin),
      subtract(point(positions, second), origin));
    const normalLength = norm(normal);
    const deviation = normalLength > 1e-8
      ? Math.abs(dot(subtract(point(positions, oxygen), origin), normal)) / normalLength
      : Number.POSITIVE_INFINITY;
    if (!(deviation <= maximumDeviation)) violations.push({ carbonAtomIndex:center,
      oxygenAtomIndex:oxygen, outOfPlaneAngstrom:deviation });
  });
  return { valid:violations.length === 0, checked:molecule.atoms.filter((atom, index) =>
    atom.element === 'C' && entries[index].some(({ atom:neighbor, bondIndex }) =>
      molecule.atoms[neighbor].element === 'O'
      && Number(molecule.bonds[bondIndex].order || 1) >= 1.75)).length, violations };
}

function ringSystems(molecule, maximumRingSize) {
  const rings = perceiveFlexibleRings(molecule, { maximumRingSize });
  const systems = [];
  rings.forEach((ring) => {
    const intersecting = systems.filter((system) => ring.atomIndices.some((atom) => system.has(atom)));
    if (!intersecting.length) { systems.push(new Set(ring.atomIndices)); return; }
    const merged = new Set(ring.atomIndices);
    intersecting.forEach((system) => system.forEach((atom) => merged.add(atom)));
    for (let index = systems.length - 1; index >= 0; index--)
      if (intersecting.includes(systems[index])) systems.splice(index, 1);
    systems.push(merged);
  });
  return { rings, systems:systems.map((system) => [...system].sort((a, b) => a - b)) };
}

function ringGeometryAudit(molecule, embedded, positioned, ringAtomSet,
  maximumInternalChange, maximumBoundaryChange) {
  const internal = [], boundary = [], invalidLengths = [];
  molecule.bonds.forEach((bond, bondIndex) => {
    const firstRing = ringAtomSet.has(bond.a), secondRing = ringAtomSet.has(bond.b);
    if (!firstRing && !secondRing) return;
    const embeddedLength = distance(embedded, bond.a, bond.b);
    const positionedLength = distance(positioned, bond.a, bond.b);
    const change = Math.abs(positionedLength - embeddedLength);
    if (!(positionedLength >= 0.7 && positionedLength <= 2.4))
      invalidLengths.push({ bondIndex, atomIndices:[bond.a,bond.b], positionedLength });
    if (firstRing && secondRing) {
      if (change > maximumInternalChange) internal.push({ bondIndex, change });
    } else if (change > maximumBoundaryChange) boundary.push({ bondIndex, change });
  });
  return { valid:!internal.length && !boundary.length && !invalidLengths.length,
    internalRingBondViolations:internal, boundaryBondViolations:boundary, invalidLengths };
}

function ringRmsd(first, second, atomIndices) {
  const sum = atomIndices.reduce((total, atom) => total + [0,1,2].reduce((inner, axis) =>
    inner + (first[atom * 3 + axis] - second[atom * 3 + axis]) ** 2, 0), 0);
  return Math.sqrt(sum / Math.max(1, atomIndices.length));
}

function normalizeBackendResult(result, atomCount) {
  const raw = Array.isArray(result) ? result : result?.conformers;
  if (ArrayBuffer.isView(raw)) {
    const stride = atomCount * 3;
    if (!raw.length || raw.length % stride) throw new Error('Ring conformer backend returned an invalid coordinate stack');
    return Array.from({ length:raw.length / stride }, (_, index) =>
      finitePositions(raw.slice(index * stride, (index + 1) * stride), atomCount,
        `Embedded conformer ${index + 1}`));
  }
  if (!Array.isArray(raw) || !raw.length) throw new Error('Ring conformer backend returned no conformers');
  return raw.map((positions, index) => finitePositions(positions, atomCount,
    `Embedded conformer ${index + 1}`));
}

function normalizeScore(value) {
  const objectiveKcalMol = Number(typeof value === 'number' ? value : value?.objectiveKcalMol);
  if (!Number.isFinite(objectiveKcalMol)) throw new Error('Ring conformer scoring returned no finite objective');
  return { ...(typeof value === 'object' ? value : {}), objectiveKcalMol,
    feasible:typeof value === 'object' && value.feasible === true };
}

// Backend-neutral orchestration. In the browser `generateConformers` can be the
// bundled RDKit ETKDGv3 worker; another validated local backend can be swapped
// in without changing core placement, geometry gates, ranking, or provenance.
export async function generateClosedRingConformers({ molecule, initialPositions,
  referencePositions, coreAtomPairs, generateConformers, scorePose = () => 0,
  requestedConformers = CLOSED_RING_CONFORMER_DEFAULTS.requestedConformers,
  seed = CLOSED_RING_CONFORMER_DEFAULTS.seed,
  maximumRingSize = CLOSED_RING_CONFORMER_DEFAULTS.maximumRingSize,
  maximumInternalRingBondChangeAngstrom = CLOSED_RING_CONFORMER_DEFAULTS.maximumInternalRingBondChangeAngstrom,
  maximumBoundaryBondChangeAngstrom = CLOSED_RING_CONFORMER_DEFAULTS.maximumBoundaryBondChangeAngstrom,
  maximumTrigonalOutOfPlaneAngstrom = CLOSED_RING_CONFORMER_DEFAULTS.maximumTrigonalOutOfPlaneAngstrom,
  minimumDistinctRingRmsdAngstrom = CLOSED_RING_CONFORMER_DEFAULTS.minimumDistinctRingRmsdAngstrom } = {}) {
  if (!molecule?.atoms?.length || !Array.isArray(molecule.bonds))
    throw new Error('Closed-ring generation requires a complete molecular graph');
  if (typeof generateConformers !== 'function')
    throw new TypeError('Closed-ring generation requires a conformer backend callback');
  if (typeof scorePose !== 'function') throw new TypeError('Closed-ring generation requires a score callback');
  const initial = finitePositions(initialPositions, molecule.atoms.length, 'Initial positions');
  const referenceLength = Number(referencePositions?.length);
  if (!Number.isInteger(referenceLength) || referenceLength < 9 || referenceLength % 3)
    throw new Error('Reference positions must contain complete coordinates for at least three atoms');
  const reference = finitePositions(referencePositions, referenceLength / 3, 'Reference positions');
  if (!Array.isArray(coreAtomPairs) || coreAtomPairs.length < 3)
    throw new Error('Closed-ring generation requires at least three fixed scaffold atom pairs');
  const perceived = ringSystems(molecule, maximumRingSize);
  if (!perceived.rings.length) throw new Error('Closed-ring generation requires at least one perceived ring');
  const core = new Set(coreAtomPairs.map((pair) => pair[1]));
  const sampledRingAtoms = [...new Set(perceived.systems.flatMap((system) =>
    system.some((atom) => !core.has(atom)) ? system : []))].sort((a, b) => a - b);
  if (!sampledRingAtoms.length) throw new Error('Every perceived ring belongs entirely to the fixed scaffold');
  const embedded = normalizeBackendResult(await generateConformers({ molecule,
    requestedConformers:Math.max(1, Math.round(Number(requestedConformers))),
    seed:Number(seed), method:CLOSED_RING_CONFORMER_DEFAULTS.method }), molecule.atoms.length);
  const stereoCenters = configuredStereocenters(molecule, initial);
  const ringAtomSet = new Set(sampledRingAtoms), accepted = [], rejected = [];

  for (let index = 0; index < embedded.length; index++) {
    const source = embedded[index];
    try {
      const globallyAligned = applyCoreTransform(source,
        fittedCoreTransform(reference, source, coreAtomPairs));
      const attached = attachNonCoreRegionsToSnappedCore({ molecule,
        alignedPositions:globallyAligned, referencePositions:reference, coreAtomPairs });
      const positioned = snapCorePositions(reference, attached.positions, coreAtomPairs);
      const ringGeometry = ringGeometryAudit(molecule, source, positioned, ringAtomSet,
        Number(maximumInternalRingBondChangeAngstrom), Number(maximumBoundaryBondChangeAngstrom));
      const stereochemistry = stereochemistryAudit(positioned, stereoCenters);
      const carbonylPlanarity = carbonylPlanarityAudit(molecule, positioned,
        Number(maximumTrigonalOutOfPlaneAngstrom));
      if (!ringGeometry.valid || !stereochemistry.valid || !carbonylPlanarity.valid) {
        rejected.push({ backendIndex:index, reason:'geometry-gate', ringGeometry,
          stereochemistry, carbonylPlanarity });
        continue;
      }
      if (accepted.some((entry) => ringRmsd(entry.positions, positioned, sampledRingAtoms)
        < Number(minimumDistinctRingRmsdAngstrom))) {
        rejected.push({ backendIndex:index, reason:'duplicate-ring-conformer' }); continue;
      }
      const evaluation = normalizeScore(await scorePose(positioned, { backendIndex:index }));
      accepted.push({ backendIndex:index, positions:positioned, evaluation,
        ringGeometry, stereochemistry, carbonylPlanarity, placement:attached.regions });
    } catch (error) {
      rejected.push({ backendIndex:index, reason:'placement-error', error:String(error?.message || error) });
    }
  }
  accepted.sort((first, second) => Number(second.evaluation.feasible) - Number(first.evaluation.feasible)
    || first.evaluation.objectiveKcalMol - second.evaluation.objectiveKcalMol
    || first.backendIndex - second.backendIndex);
  return { method:CLOSED_RING_CONFORMER_DEFAULTS.method, seed:Number(seed),
    requestedConformers:Math.max(1, Math.round(Number(requestedConformers))),
    backendConformerCount:embedded.length, acceptedConformerCount:accepted.length,
    rejectedConformerCount:rejected.length, sampledRingAtomIndices:sampledRingAtoms,
    ringSystemCount:perceived.systems.length, configuredStereocenterCount:stereoCenters.length,
    candidates:accepted, rejected,
    selected:accepted[0] || null,
    gates:{ maximumInternalRingBondChangeAngstrom:Number(maximumInternalRingBondChangeAngstrom),
      maximumBoundaryBondChangeAngstrom:Number(maximumBoundaryBondChangeAngstrom),
      maximumTrigonalOutOfPlaneAngstrom:Number(maximumTrigonalOutOfPlaneAngstrom),
      minimumDistinctRingRmsdAngstrom:Number(minimumDistinctRingRmsdAngstrom) },
  };
}
