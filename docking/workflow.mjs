import { applyCoreTransform, evaluateCoreConstraint, evaluateHydrogenBondConstraint,
  fittedCoreTransform, rankConstrainedPoses, scoreConstrainedPose, snapCorePositions } from './constraints.mjs';
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
  return definitions.map((definition, index) => ({
    id:definition.id || `hbond-${index + 1}`,
    required:definition.required !== false,
    receptorRole:definition.receptorRole || null,
    ...evaluateHydrogenBondConstraint({
      donor:restraintPoint(definition.donor, positions),
      hydrogen:restraintPoint(definition.hydrogen, positions),
      acceptor:restraintPoint(definition.acceptor, positions),
    }, { ...settings, ...(definition.settings || {}) }),
  }));
}

export async function runConstrainedDocking({ referencePositions, candidateConformers, coreAtomPairs,
  hydrogenBondConstraints = [], protocol, physicalScore, refinePose = null, labbook = null,
  afterRefinement = null, startedAt = new Date().toISOString(), completedAt = null }) {
  if (typeof physicalScore !== 'function') throw new TypeError('A physicalScore callback is required');
  if (!Array.isArray(candidateConformers) || !candidateConformers.length)
    throw new Error('At least one candidate conformer is required');
  if (!referencePositions?.length || referencePositions.length % 3
    || Array.from(referencePositions).some((coordinate) => !Number.isFinite(coordinate)))
    throw new Error('Reference coordinates must contain complete finite atom positions');
  const expectedLength = candidateConformers[0]?.length || 0;
  const conformers = candidateConformers.map((positions) => conformerArray(positions, expectedLength));
  if (labbook) await appendLabbookEvent(labbook, { at:startedAt, stage:'pose-generation', status:'received',
    details:{ conformers:conformers.length, coreAtomPairs:coreAtomPairs.length,
      requiredHydrogenBonds:hydrogenBondConstraints.filter((entry) => entry.required !== false).length } });

  const candidates = [];
  for (let index = 0; index < conformers.length; index++) {
    const transform = fittedCoreTransform(referencePositions, conformers[index], coreAtomPairs);
    let positions = snapCorePositions(referencePositions,
      applyCoreTransform(conformers[index], transform), coreAtomPairs);
    let refinement = null;
    if (refinePose) {
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
    const score = scoreConstrainedPose({ physicalEnergyKcalMol, core, hydrogenBonds });
    candidates.push({ conformerIndex:index, fittedCoreRmsdAngstrom:transform.fittedRmsdAngstrom,
      positions, core, hydrogenBonds, refinement, physicalDetails:typeof physical === 'object' ? physical : null,
      ...score });
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
