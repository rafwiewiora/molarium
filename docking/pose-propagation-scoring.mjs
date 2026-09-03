import { evaluateCoreConstraint, evaluateSpatialFeatureConstraints,
  scoreConstrainedPose } from './constraints.mjs';
import { scoreReceptorLigand } from './receptor-score.mjs';
import { packPositions4 } from './torsion-search.mjs';
import { evaluatePoseHydrogenBonds } from './workflow.mjs';
import { buildParameterizedSystem, cpuEnergies } from '../stormm/core.mjs';

function indexedNonbonded(system, atomCount) {
  const byIndex = new Map((system?.nonbonded || []).map((term, ordinal) =>
    [Number.isInteger(term.index) ? term.index : ordinal, term]));
  return Array.from({ length:atomCount }, (_, index) => {
    const term = byIndex.get(index);
    if (!term) throw new Error(`Ligand parameterization omitted atom ${index + 1}.`);
    return term;
  });
}

function finiteReference(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

/**
 * Build the identical deterministic scoring callbacks used on the browser main
 * thread and in each pose-search worker.  Keeping this in one module prevents
 * worker scheduling from changing the scientific objective.
 */
export function createPosePropagationScoring({ molecule, ligandParameters, receptorSite,
  referenceLigandPositions, coreAtomPairs, hydrogenBondConstraints, protocol,
  spatialFeatureConstraints = [],
  minimumSageStartEnergy, interactionReferenceKcalMol,
  minimumFixedCoreStartStericClashes, minimumFixedCoreStartLennardJonesKcalMol,
  captureMaximumRelativeLigandStrainKcalMol = 100,
  captureMaximumAdditionalStericClashes = 2,
  captureMaximumAdditionalLennardJonesKcalMol = 100 } = {}) {
  if (!molecule?.atoms?.length || !ligandParameters?.system || !receptorSite?.atoms?.length)
    throw new Error('Pose-propagation scoring requires a parameterized ligand and receptor site');
  const ligandNonbonded = indexedNonbonded(ligandParameters.system, molecule.atoms.length);
  const ligandTopology = buildParameterizedSystem(molecule, ligandParameters);
  const minimumStartEnergy = finiteReference(minimumSageStartEnergy,
    'Minimum fixed-core Sage energy');
  const interactionReference = finiteReference(interactionReferenceKcalMol,
    'Interaction reference');
  const minimumStartClashes = finiteReference(minimumFixedCoreStartStericClashes,
    'Minimum fixed-core steric clashes');
  const minimumStartLennardJones = finiteReference(
    minimumFixedCoreStartLennardJonesKcalMol, 'Minimum fixed-core Lennard-Jones energy');
  const ligandInternalEnergy = (positions) => cpuEnergies(ligandTopology,
    packPositions4(positions)).total;
  const rawReceptorScoreFor = (positions, sageInternalEnergyKcalMol) =>
    scoreReceptorLigand(receptorSite, positions, ligandNonbonded, {
      relativeDielectric:Number(protocol.scoring.relativeDielectric ?? 4),
      cutoffAngstrom:Number(protocol.scoring.pairCutoffAngstrom ?? 8),
      ligandStrainKcalMol:sageInternalEnergyKcalMol - minimumStartEnergy,
      ligandStrainIdentity:'relative vacuum OpenFF Sage 2.1 intramolecular energy',
    });
  const receptorScoreFor = (positions, sageInternalEnergyKcalMol) => {
    const raw = rawReceptorScoreFor(positions, sageInternalEnergyKcalMol);
    const relativeInteractionKcalMol = raw.interactionKcalMol - interactionReference;
    return { ...raw,
      absoluteEnergyKcalMol:raw.energyKcalMol,
      absoluteInteractionKcalMol:raw.interactionKcalMol,
      interactionReferenceKcalMol:interactionReference,
      relativeInteractionKcalMol,
      energyKcalMol:relativeInteractionKcalMol + raw.weightedLigandStrainKcalMol,
      scoreIdentity:`reference-subtracted ${raw.scoreIdentity}`,
      interpretation:'reference-subtracted pose-ranking score; not a binding free energy',
    };
  };
  const chemicalValidityFor = (sageInternalEnergyKcalMol, physical) => {
    const relativeLigandStrainKcalMol = sageInternalEnergyKcalMol - minimumStartEnergy;
    const strainExcessKcalMol = Math.max(0,
      relativeLigandStrainKcalMol - Number(captureMaximumRelativeLigandStrainKcalMol));
    const additionalStericClashes = Math.max(0,
      Number(physical.stericClashes) - minimumStartClashes);
    const clashExcess = Math.max(0,
      additionalStericClashes - Number(captureMaximumAdditionalStericClashes));
    const additionalLennardJonesKcalMol = Number(physical.lennardJonesKcalMol)
      - minimumStartLennardJones;
    const lennardJonesExcessKcalMol = Math.max(0,
      additionalLennardJonesKcalMol - Number(captureMaximumAdditionalLennardJonesKcalMol));
    return { valid:Number.isFinite(relativeLigandStrainKcalMol)
        && strainExcessKcalMol === 0 && clashExcess === 0
        && lennardJonesExcessKcalMol === 0,
      relativeLigandStrainKcalMol,
      maximumRelativeLigandStrainKcalMol:Number(captureMaximumRelativeLigandStrainKcalMol),
      stericClashes:Number(physical.stericClashes),
      minimumFixedCoreStartStericClashes:minimumStartClashes,
      additionalStericClashes,
      maximumAdditionalStericClashes:Number(captureMaximumAdditionalStericClashes),
      minimumFixedCoreStartLennardJonesKcalMol:minimumStartLennardJones,
      additionalLennardJonesKcalMol,
      maximumAdditionalLennardJonesKcalMol:Number(captureMaximumAdditionalLennardJonesKcalMol),
      strainExcessKcalMol, clashExcess, lennardJonesExcessKcalMol,
    };
  };
  const scorePositions = (positions) => {
    const sageInternalEnergyKcalMol = ligandInternalEnergy(positions);
    const physical = receptorScoreFor(positions, sageInternalEnergyKcalMol);
    const chemicalValidity = chemicalValidityFor(sageInternalEnergyKcalMol, physical);
    const core = evaluateCoreConstraint(referenceLigandPositions, positions,
      coreAtomPairs, protocol.coreConstraint);
    const hydrogenBonds = evaluatePoseHydrogenBonds(hydrogenBondConstraints, positions,
      protocol.hydrogenBondConstraint);
    const spatialFeatures = evaluateSpatialFeatureConstraints(
      referenceLigandPositions, positions, spatialFeatureConstraints);
    const combined = scoreConstrainedPose({
      physicalEnergyKcalMol:physical.energyKcalMol, core, hydrogenBonds,
      spatialFeatures,
    });
    return { objectiveKcalMol:combined.totalScoreKcalMol,
      feasible:combined.feasible && chemicalValidity.valid,
      physical, core, hydrogenBonds, spatialFeatures,
      sageInternalEnergyKcalMol, chemicalValidity };
  };
  const scoreRestraintCapturePositions = (positions) => {
    const sageInternalEnergyKcalMol = ligandInternalEnergy(positions);
    const physical = receptorScoreFor(positions, sageInternalEnergyKcalMol);
    const chemicalValidity = chemicalValidityFor(sageInternalEnergyKcalMol, physical);
    const hydrogenBonds = evaluatePoseHydrogenBonds(hydrogenBondConstraints, positions,
      protocol.hydrogenBondConstraint);
    const spatialFeatures = evaluateSpatialFeatureConstraints(
      referenceLigandPositions, positions, spatialFeatureConstraints);
    const hbondPenaltyKcalMol = hydrogenBonds.reduce((sum, entry) =>
      sum + Number(entry.penaltyKcalMol || 0), 0);
    const spatialFeaturePenaltyKcalMol = spatialFeatures.reduce((sum, entry) =>
      sum + Number(entry.penaltyKcalMol || 0), 0);
    const chemicalPenaltyKcalMol = chemicalValidity.strainExcessKcalMol ** 2
      + chemicalValidity.clashExcess ** 2 * 1000
      + chemicalValidity.lennardJonesExcessKcalMol ** 2;
    return { objectiveKcalMol:hbondPenaltyKcalMol + spatialFeaturePenaltyKcalMol
        + chemicalPenaltyKcalMol,
      hbondPenaltyKcalMol, spatialFeaturePenaltyKcalMol, chemicalPenaltyKcalMol,
      feasible:chemicalValidity.valid
        && hydrogenBonds.every((entry) => !entry.required || entry.satisfied)
        && spatialFeatures.every((entry) => !entry.required || entry.satisfied),
      hydrogenBonds, spatialFeatures, sageInternalEnergyKcalMol, chemicalValidity };
  };
  return { ligandInternalEnergy, rawReceptorScoreFor, receptorScoreFor,
    chemicalValidityFor, scorePositions, scoreRestraintCapturePositions };
}
