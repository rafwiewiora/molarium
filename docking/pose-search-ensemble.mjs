import { generatePoseByRestraintBiasedSearch } from './restraint-biased-search.mjs';
import { createPosePropagationScoring } from './pose-propagation-scoring.mjs';
import { mulberry32 } from '../stormm/core.mjs';

/** Run one deterministic partition of independent pose-search chains. */
export async function runPoseSearchPartition({ scoring, search, candidates } = {},
  onProgress = null) {
  if (!Array.isArray(candidates) || !candidates.length)
    throw new Error('A pose-search partition requires at least one candidate');
  const scorer = createPosePropagationScoring(scoring);
  const started = performance.now();
  const results = [];
  for (let ordinal = 0; ordinal < candidates.length; ordinal++) {
    const candidate = candidates[ordinal];
    let lastProgressAt = 0;
    const yieldControl = onProgress ? async (progress) => {
      const now = performance.now();
      if (now - lastProgressAt < 200) return;
      lastProgressAt = now;
      await onProgress({ type:'chain-progress', conformerIndex:candidate.conformerIndex,
        completedChains:ordinal, totalChains:candidates.length, ...progress });
    } : null;
    const refinement = await generatePoseByRestraintBiasedSearch({
      molecule:scoring.molecule,
      initialPositions:candidate.positions,
      coreAtomIndices:scoring.coreAtomIndices,
      restraintScorePose:scorer.scoreRestraintCapturePositions,
      physicalScorePose:scorer.scorePositions,
      random:mulberry32(candidate.seed), seed:candidate.seed,
      captureSteps:search.captureSteps,
      capturePolishSweeps:search.capturePolishSweeps,
      refinementSteps:search.refinementSteps,
      temperatureStartKelvin:search.temperatureStartKelvin,
      temperatureEndKelvin:search.temperatureEndKelvin,
      torsionAnglesDegrees:search.torsionAnglesDegrees,
      ringCrankshaftAnglesDegrees:search.ringCrankshaftAnglesDegrees,
      localLineFractions:search.localLineFractions,
      yieldControl,
    });
    results.push({ conformerIndex:candidate.conformerIndex, refinement });
    if (onProgress) await onProgress({ type:'chain-complete',
      conformerIndex:candidate.conformerIndex, completedChains:ordinal + 1,
      totalChains:candidates.length, elapsedMs:performance.now() - started });
  }
  const elapsedMs = performance.now() - started;
  return { results, elapsedMs,
    chainsPerSecond:elapsedMs > 0 ? candidates.length * 1000 / elapsedMs : null };
}
