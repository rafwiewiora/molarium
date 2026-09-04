import { applyCoreTransform, evaluateCoreConstraint, evaluateHydrogenBondConstraint,
  evaluateSpatialFeatureConstraints,
  fittedCoreTransform, restoreCapturedLigandDonorHydrogens, rankConstrainedPoses,
  scoreConstrainedPose, snapCorePositions } from './constraints.mjs';
import { appendLabbookEvent } from './labbook.mjs';

function conformerArray(value, expectedLength) {
  const positions = value instanceof Float64Array ? value : Float64Array.from(value || []);
  if (positions.length !== expectedLength || positions.length % 3
    || positions.some((coordinate) => !Number.isFinite(coordinate)))
    throw new Error(`A docking conformer must contain ${expectedLength} finite coordinates`);
  return positions;
}

function ligandPoint(positions, atomIndex) {
  if (!Number.isInteger(atomIndex) || atomIndex < 0 || atomIndex * 3 + 2 >= positions.length)
    throw new RangeError(`Ligand atom ${atomIndex} is outside the docking conformer`);
  return { x:positions[atomIndex * 3], y:positions[atomIndex * 3 + 1], z:positions[atomIndex * 3 + 2] };
}

function restraintPoint(descriptor, positions) {
  if (descriptor?.scope === 'ligand') return ligandPoint(positions, descriptor.atomIndex);
  if (descriptor?.scope === 'receptor' && descriptor.point) return descriptor.point;
  throw new Error('Each H-bond participant must identify a ligand atom or fixed receptor point');
}

export function evaluatePoseHydrogenBonds(definitions, positions, settings) {
  const evaluateOne = (definition, index) => ({
    id:definition.id || `hbond-${index + 1}`,
    matchKind:definition.matchKind || null,
    ...evaluateHydrogenBondConstraint({
      donor:restraintPoint(definition.donor, positions),
      hydrogen:restraintPoint(definition.hydrogen, positions),
      acceptor:restraintPoint(definition.acceptor, positions),
    }, { ...settings, ...(definition.settings || {}) }),
  });
  return definitions.map((definition, index) => {
    if (!definition.alternatives?.length) return {
      id:definition.id || `hbond-${index + 1}`,
      required:definition.required !== false,
      receptorRole:definition.receptorRole || null,
      ...evaluateOne(definition, index),
    };
    const alternatives = definition.alternatives.map((entry, alternativeIndex) =>
      evaluateOne(entry, alternativeIndex)).sort((first, second) =>
        first.penaltyKcalMol - second.penaltyKcalMol || first.id.localeCompare(second.id));
    const selected = alternatives[0];
    return { ...selected,
      id:definition.id || `hbond-${index + 1}`,
      required:definition.required !== false,
      receptorRole:definition.receptorRole || null,
      selectedAlternativeId:selected.id,
      alternativeCount:alternatives.length,
      alternatives,
    };
  });
}

export async function runConstrainedDocking({ referencePositions, candidateConformers, coreAtomPairs,
  hydrogenBondConstraints = [], spatialFeatureConstraints = [], protocol, physicalScore,
  refinePose = null, labbook = null,
  refineBatch = null, afterRefinement = null, capturedLigandHydrogenRestoration = false,
  yieldControl = null, startedAt = new Date().toISOString(), completedAt = null }) {
  if (typeof physicalScore !== 'function') throw new TypeError('A physicalScore callback is required');
  if (yieldControl != null && typeof yieldControl !== 'function')
    throw new TypeError('yieldControl must be a function when provided');
  if (!Array.isArray(candidateConformers) || !candidateConformers.length)
    throw new Error('At least one candidate conformer is required');
  if (!referencePositions?.length || referencePositions.length % 3
    || Array.from(referencePositions).some((coordinate) => !Number.isFinite(coordinate)))
    throw new Error('Reference coordinates must contain complete finite atom positions');
  const expectedLength = candidateConformers[0]?.length || 0;
  const conformers = candidateConformers.map((positions) => conformerArray(positions, expectedLength));
  if (labbook) await appendLabbookEvent(labbook, { at:startedAt, stage:'pose-generation', status:'received',
    details:{ conformers:conformers.length, coreAtomPairs:coreAtomPairs.length,
      requiredHydrogenBonds:hydrogenBondConstraints.filter((entry) => entry.required !== false).length,
      requiredSpatialFeatures:spatialFeatureConstraints.filter((entry) =>
        entry?.restraint?.required === true).length } });

  const prepared = conformers.map((positions) => {
    const transform = fittedCoreTransform(referencePositions, positions, coreAtomPairs);
    const snapped = snapCorePositions(referencePositions,
      applyCoreTransform(positions, transform), coreAtomPairs);
    const hydrogenRestoration = capturedLigandHydrogenRestoration
      ? restoreCapturedLigandDonorHydrogens(snapped, hydrogenBondConstraints)
      : { positions:new Float64Array(snapped), restored:[], skipped:[], enabled:false };
    return { transform, positions:hydrogenRestoration.positions, hydrogenRestoration };
  });
  if (labbook && capturedLigandHydrogenRestoration) await appendLabbookEvent(labbook, { at:new Date().toISOString(),
    stage:'captured-ligand-hydrogen-restoration', status:'completed', details:{
      candidates:prepared.length,
      restoredPerCandidate:prepared[0]?.hydrogenRestoration.restored.length || 0,
      restored:prepared[0]?.hydrogenRestoration.restored || [],
      skipped:prepared[0]?.hydrogenRestoration.skipped || [],
      invariant:'only surviving ligand donor hydrogens are restored to captured coordinates; no heavy atom moves',
    } });
  let batchRefinements = null;
  if (refineBatch) {
    batchRefinements = await refineBatch({
      positions:prepared.map((entry) => new Float64Array(entry.positions)), protocol,
    });
    if (!Array.isArray(batchRefinements) || batchRefinements.length !== prepared.length)
      throw new Error('Batch refinement must return one result per candidate conformer');
  }
  const candidates = [];
  for (let index = 0; index < conformers.length; index++) {
    const transform = prepared[index].transform;
    let positions = prepared[index].positions;
    let refinement = null;
    if (batchRefinements) {
      refinement = batchRefinements[index];
      positions = conformerArray(refinement?.positions || positions, expectedLength);
    } else if (refinePose) {
      refinement = await refinePose({ positions, conformerIndex:index, protocol });
      positions = conformerArray(refinement?.positions || positions, expectedLength);
    }
    const physical = await physicalScore({ positions, conformerIndex:index, protocol, refinement });
    const physicalEnergyKcalMol = Number(typeof physical === 'number' ? physical : physical?.energyKcalMol);
    if (!Number.isFinite(physicalEnergyKcalMol))
      throw new Error(`Physical scoring returned no finite energy for conformer ${index + 1}`);
    const core = evaluateCoreConstraint(referencePositions, positions, coreAtomPairs, protocol.coreConstraint);
    const hydrogenBonds = evaluatePoseHydrogenBonds(hydrogenBondConstraints, positions,
      protocol.hydrogenBondConstraint);
    const spatialFeatures = evaluateSpatialFeatureConstraints(
      referencePositions, positions, spatialFeatureConstraints);
    const score = scoreConstrainedPose({ physicalEnergyKcalMol, core, hydrogenBonds,
      spatialFeatures });
    const physicalFeasible = typeof physical !== 'object' || physical?.feasible !== false;
    if (!physicalFeasible) score.feasible = false;
    candidates.push({ conformerIndex:index, fittedCoreRmsdAngstrom:transform.fittedRmsdAngstrom,
      positions, core, hydrogenBonds, spatialFeatures, refinement,
      hydrogenRestoration:prepared[index].hydrogenRestoration,
      physicalDetails:typeof physical === 'object' ? physical : null,
      physicalFeasible,
      ...score });
    if (yieldControl) await yieldControl({ stage:'candidate ranking', completed:index + 1,
      total:conformers.length });
  }
  if (afterRefinement) await afterRefinement(candidates);
  const ranked = rankConstrainedPoses(candidates);
  const feasibleCount = ranked.filter((pose) => pose.feasible).length;
  if (labbook) await appendLabbookEvent(labbook, {
    at:completedAt || new Date().toISOString(), stage:'constraint-audit-and-ranking', status:'completed',
    details:{ candidates:ranked.length, feasible:feasibleCount,
      selectedConformerIndex:ranked[0].conformerIndex,
      selectedScoreKcalMol:ranked[0].totalScoreKcalMol,
      selectedCoreRmsdAngstrom:ranked[0].core.rmsdAngstrom },
  });
  return { protocolId:protocol.id, protocolVersion:protocol.version, candidates:ranked,
    feasibleCount, selected:ranked[0] };
}
