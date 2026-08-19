export const CONFORMER_ARENA_METHODS = Object.freeze([
  Object.freeze({ id: 'etkdg-mmff', label: 'ETKDG + MMFF94', shortLabel: 'MMFF seeds', color: '#3155cf' }),
  Object.freeze({ id: 'stormm-webgpu', label: 'STORMM WebGPU · Sage/OBC2', shortLabel: 'STORMM GPU', color: '#2d9d72' }),
  Object.freeze({ id: 'ani2x', label: 'ANI-2x MLIP', shortLabel: 'ANI-2x', color: '#a05ac7' }),
]);

function requireCoordinateStack(stack, expectedLength, label) {
  if (!ArrayBuffer.isView(stack) || stack.length !== expectedLength)
    throw new Error(`${label} returned an invalid coordinate stack`);
}

function resultCoordinate(result, frame, replica, atomStride) {
  const frameStride = result.replicaCount * atomStride;
  const offset = frame * frameStride + replica * atomStride;
  return result.ensembleTrajectory.subarray(offset, offset + atomStride);
}

export function buildConformerArenaEnsemble({ molecule, seeds, lanes }) {
  const atomStride = molecule.atoms.length * 3;
  const seedCount = seeds.length / atomStride;
  if (!Number.isInteger(seedCount) || seedCount < 1)
    throw new Error('Conformer Arena received an invalid seed stack');
  if (!Array.isArray(lanes) || !lanes.length)
    throw new Error('Conformer Arena requires at least one refinement lane');
  const frameCount = Number(lanes[0].result?.frameCount);
  if (frameCount < 1) throw new Error('Conformer Arena received no refinement frames');
  requireCoordinateStack(seeds, seedCount * atomStride, 'ETKDG/MMFF');
  const seenMethods = new Set(['etkdg-mmff']);
  lanes.forEach(({ methodId, result }) => {
    const method = arenaMethod(methodId);
    if (!method || methodId === 'etkdg-mmff')
      throw new Error(`Conformer Arena received an unknown refinement method: ${methodId}`);
    if (seenMethods.has(methodId))
      throw new Error(`Conformer Arena received duplicate ${method.label} results`);
    seenMethods.add(methodId);
    if (Number(result?.frameCount) !== frameCount || Number(result?.replicaCount) !== seedCount)
      throw new Error(`${method.label} does not share the Arena ensemble shape`);
    requireCoordinateStack(result.ensembleTrajectory,
      frameCount * seedCount * atomStride, method.label);
  });

  const activeMethods = [arenaMethod('etkdg-mmff'),
    ...lanes.map(({ methodId }) => arenaMethod(methodId))];
  const methodCount = activeMethods.length;
  const replicaCount = seedCount * methodCount;
  const ensembleTrajectory = new Float32Array(frameCount * replicaCount * atomStride);
  const methodIds = new Array(replicaCount);
  const seedIndices = new Int32Array(replicaCount);
  for (let frame = 0; frame < frameCount; frame++) {
    for (let seed = 0; seed < seedCount; seed++) {
      const seedCoordinates = seeds.subarray(seed * atomStride, (seed + 1) * atomStride);
      const coordinates = [seedCoordinates,
        ...lanes.map(({ result }) => resultCoordinate(result, frame, seed, atomStride))];
      for (let method = 0; method < methodCount; method++) {
        const replica = method * seedCount + seed;
        const offset = (frame * replicaCount + replica) * atomStride;
        ensembleTrajectory.set(coordinates[method], offset);
        methodIds[replica] = activeMethods[method].id;
        seedIndices[replica] = seed;
      }
    }
  }
  return { atomStride, seedCount, replicaCount, frameCount,
    ensembleTrajectory, methodIds, seedIndices, activeMethods };
}

export function analyzeConformerArena({ analysis, methodIds, timings }) {
  const activeMethodIds = [...new Set(methodIds)];
  const methods = activeMethodIds.map((methodId) => {
    const method = arenaMethod(methodId);
    if (!method) throw new Error(`Conformer Arena cannot analyze unknown method ${methodId}`);
    return { ...method };
  });
  const representativeClusters = analysis.representativeIndices
    .filter((index) => analysis.energyOffsets[index] <= 3)
    .map((index) => analysis.clusterIds[index]);
  const lowEnergyClusters = new Set(representativeClusters);
  const globalBest = analysis.energies[analysis.bestIndex];
  methods.forEach((method) => {
    const indices = methodIds.map((id, index) => id === method.id ? index : -1)
      .filter((index) => index >= 0 && Number.isFinite(analysis.energies[index]));
    const order = indices.slice().sort((a, b) => analysis.energies[a] - analysis.energies[b] || a - b);
    const clusters = new Set(indices.map((index) => analysis.clusterIds[index]));
    const recalled = [...lowEnergyClusters].filter((cluster) => clusters.has(cluster)).length;
    method.candidateCount = indices.length;
    method.bestIndex = order[0] ?? null;
    method.bestEnergy = order.length ? analysis.energies[order[0]] : Infinity;
    method.regret = method.bestEnergy - globalBest;
    method.clusterCount = clusters.size;
    method.clusterCoverage = analysis.clusterCount ? clusters.size / analysis.clusterCount : 0;
    method.lowEnergyClusterCount = recalled;
    method.lowEnergyRecall = lowEnergyClusters.size ? recalled / lowEnergyClusters.size : 1;
    method.searchMs = Number(timings[method.id]?.searchMs || 0);
    method.endToEndMs = Number(timings[method.id]?.endToEndMs || method.searchMs);
  });
  return {
    judge: 'OpenFF Sage 2.1 + OBC2/ACE · batched STORMM WebGPU rescore',
    globalBest,
    clusterCount: analysis.clusterCount,
    lowEnergyWindowKcalMol: 3,
    lowEnergyClusterCount: lowEnergyClusters.size,
    methods,
  };
}

export function arenaMethod(methodId) {
  return CONFORMER_ARENA_METHODS.find((method) => method.id === methodId) || null;
}
