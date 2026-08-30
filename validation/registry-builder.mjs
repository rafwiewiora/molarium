import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManualContactPanelManifest } from '../docking/benchmark/7kpa-manual-contact-panel.mjs';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const sourcePaths = Object.freeze({
  dockingManifest:'docking/benchmark/manifest.v0.1.json',
  dockingResults:'docking/benchmark/benchmark-results.v0.1.scored.json',
  dockingReport:'docking/benchmark/RESULTS.v0.1.md',
  analoguePanel:'docking/benchmark/7kpa-two-terminus-panel.v0.1.json',
  manualContactPanel:'docking/benchmark/7kpa-manual-contact-panel.mjs',
  manualContactProtocol:'docking/benchmark/7kpa-manual-contact-panel.README.md',
  manualContactSmoke:'docking/benchmark/7kpa-manual-contact-smoke.v0.1.json',
  browserVacuum:'docking/validation/cloud-panel/browser-sage-openmm-validation-2026-08-23.json',
  browserObc2:'docking/validation/cloud-panel/browser-sage-openmm-obc2-diagnostic-2026-08-23.json',
  openmmNative:'docking/validation/cloud-panel/openmm-wasm-native-validation-2026-08-23.json',
  nativeReport:'docking/validation/cloud-panel/RESULTS-2026-08-23.md',
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function median(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length) return null;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function maximum(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
}

function outcomeCounts(cases) {
  return Object.fromEntries([...Map.groupBy(cases, entry => entry.terminalOutcome).entries()]
    .map(([outcome, entries]) => [outcome, entries.length])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function tierCounts(cases) {
  return Object.fromEntries([...Map.groupBy(cases, entry => entry.tier).entries()]
    .map(([tier, entries]) => [tier, entries.length]));
}

function artifact(path, bytes) {
  return { path, href:`./${path}`, bytes:bytes.byteLength, sha256:sha256(bytes) };
}

export async function buildValidationRegistry(root = repositoryRoot) {
  const bytes = {};
  for (const [name, path] of Object.entries(sourcePaths)) bytes[name] = await readFile(resolve(root, path));
  const dockingManifest = JSON.parse(bytes.dockingManifest);
  const dockingResults = JSON.parse(bytes.dockingResults);
  const analoguePanel = JSON.parse(bytes.analoguePanel);
  const manualContactPanel = await buildManualContactPanelManifest();
  const manualContactSmoke = JSON.parse(bytes.manualContactSmoke);
  const browserVacuum = JSON.parse(bytes.browserVacuum);
  const browserObc2 = JSON.parse(bytes.browserObc2);
  const openmmNative = JSON.parse(bytes.openmmNative);

  if (dockingManifest.datasetId !== dockingResults.datasetId)
    throw new Error('Docking manifest and scored result dataset IDs differ');
  if (dockingManifest.cases.length !== dockingResults.cases.length)
    throw new Error('Docking manifest and scored result case counts differ');
  const scoredById = new Map(dockingResults.cases.map(entry => [entry.caseId, entry]));
  const cases = dockingManifest.cases.map(entry => {
    const scored = scoredById.get(entry.id);
    if (!scored) throw new Error(`Missing scored result for ${entry.id}`);
    const paired = scored.pairedCrystal?.repeats?.length ? {
      analoguePdbId:entry.groundTruth?.analoguePdbId ?? entry.groundTruth?.pdbId ?? null,
      repeatCount:scored.pairedCrystal.repeats.length,
      top1MedianHeavyAtomRmsdAngstrom:scored.pairedCrystal.top1MedianHeavyAtomRmsdAngstrom,
      top5MedianMinimumHeavyAtomRmsdAngstrom:scored.pairedCrystal.top5MedianMinimumHeavyAtomRmsdAngstrom,
      top5BestObservedHeavyAtomRmsdAngstrom:scored.pairedCrystal.top5BestObservedHeavyAtomRmsdAngstrom,
    } : null;
    return {
      caseId:entry.id,
      tier:entry.tier,
      proteinTarget:entry.proteinTarget,
      referenceSystem:`${entry.reference.pdbId}/${entry.reference.ligandComponentId}`,
      referencePdbId:entry.reference.pdbId,
      referenceLigandId:entry.reference.ligandComponentId,
      productId:entry.product?.componentId ?? null,
      transformation:entry.transformation.name,
      terminalOutcome:scored.terminalOutcome,
      reachedPoseSearch:['success-feasible', 'success-infeasible-negative-control', 'no-feasible-pose']
        .includes(scored.terminalOutcome),
      pairedCrystal:paired,
    };
  });
  const proteinTargets = [...new Set(cases.map(entry => entry.proteinTarget))].sort();
  const referenceSystems = [...new Set(cases.map(entry => entry.referenceSystem))].sort();
  const crystalScored = cases.filter(entry => entry.pairedCrystal);
  const vacuumMaxEnergy = maximum(browserVacuum.poses.map(entry => entry.absoluteEnergyDeltaKcalMol));
  const vacuumMaxForce = maximum(browserVacuum.poses.map(entry => entry.forceRelativeRms));
  const obc2MaxEnergy = maximum(browserObc2.poses.map(entry => entry.absoluteEnergyDeltaKcalMol));
  const obc2MaxForce = maximum(browserObc2.poses.map(entry => entry.forceRelativeRms));
  const nativeMaxEnergy = maximum(openmmNative.poses.map(entry => entry.comparison.absoluteEnergyDeltaKcalMol));
  const nativeMaxForce = maximum(openmmNative.poses.map(entry => entry.comparison.forceRelativeRms));
  const analogueChemistries = [...new Set(browserVacuum.poses.map(entry => entry.id.split(':')[0]))].sort();

  const artifacts = Object.fromEntries(Object.entries(sourcePaths)
    .map(([name, path]) => [name, artifact(path, bytes[name])]));
  return {
    schema:'molarium.validation-registry/v1',
    registryId:'molarium-validation-registry',
    version:'0.1.0',
    frozenAt:'2026-08-24',
    scope:'Docking workflow and high-disruption cross-runtime evidence migrated as of registry v0.1. Other historical engine tests are not counted until they receive case-level registry records.',
    countingRules:{
      proteinTarget:'One named biological target. Multiple crystal structures of the same target count once.',
      referenceSystem:'One unique PDB ID plus bound-ligand component ID used as a starting complex.',
      registeredCase:'One preregistered reference-to-product transformation, including preserved failures and negative controls.',
      poseInstance:'One exact atom graph and coordinate set. Multiple poses from one target are not independent systems.',
      softwareCheck:'One automated assertion. Check counts are never reported as molecular-system counts.',
    },
    headline:{
      registeredDockingCases:cases.length,
      distinctReferenceSystems:referenceSystems.length,
      uniqueProteinTargets:proteinTargets.length,
      casesReachingPoseSearch:cases.filter(entry => entry.reachedPoseSearch).length,
      pairedCrystalScored:crystalScored.length,
      nativeGpuPoseInstances:openmmNative.poses.length,
    },
    studies:[
      {
        studyId:'bioisostere-pose-propagation-v0.1',
        title:'Registered bioisostere pose propagation',
        status:'complete',
        evidenceLevel:'registered workflow run with preserved failures; withheld-crystal scoring where available',
        executedAt:dockingResults.generatedAt,
        counts:{
          registeredCases:cases.length,
          distinctReferenceSystems:referenceSystems.length,
          proteinTargets:proteinTargets.length,
          reachedPoseSearch:cases.filter(entry => entry.reachedPoseSearch).length,
          tiers:tierCounts(cases),
          outcomes:outcomeCounts(cases),
          pairedCrystalScored:crystalScored.length,
        },
        metrics:{
          pairedCrystalTop1MedianAngstrom:median(crystalScored.map(entry => entry.pairedCrystal.top1MedianHeavyAtomRmsdAngstrom)),
          pairedCrystalBestOfFiveMedianAngstrom:median(crystalScored.map(entry => entry.pairedCrystal.top5MedianMinimumHeavyAtomRmsdAngstrom)),
          pairedCrystalAtOrBelow2Angstrom:crystalScored.filter(entry =>
            entry.pairedCrystal.top5MedianMinimumHeavyAtomRmsdAngstrom <= 2).length,
        },
        claims:[
          'Workflow outcomes are available for every registered case.',
          'Five paired systems have blinded, label-mapped heavy-atom pose RMSD.',
          'Prospective feasibility is not binding-affinity validation or a general docking-accuracy claim.',
        ],
        artifactIds:['dockingManifest', 'dockingResults', 'dockingReport'],
      },
      {
        studyId:'high-disruption-cross-runtime-2026-08-23',
        title:'High-disruption cross-runtime parity',
        status:'complete',
        evidenceLevel:'identical graphs and coordinates across browser WebGPU/WASM and pinned native CPU/GPU implementations',
        executedAt:'2026-08-23',
        counts:{
          proteinTargets:1,
          referenceSystems:1,
          analogueChemistries:analogueChemistries.length,
          fullPanelPoses:24,
          hashSelectedPoseInstances:openmmNative.poses.length,
        },
        metrics:{
          browserSageVsOpenmmWasmVacuumMaxEnergyDeltaKcalMol:vacuumMaxEnergy,
          browserSageVsOpenmmWasmVacuumMaxForceRelativeRms:vacuumMaxForce,
          browserSageVsOpenmmWasmObc2MaxEnergyDeltaKcalMol:obc2MaxEnergy,
          browserSageVsOpenmmWasmObc2MaxForceRelativeRms:obc2MaxForce,
          openmmWasmVsNativeReferenceMaxEnergyDeltaKcalMol:nativeMaxEnergy,
          openmmWasmVsNativeReferenceMaxForceRelativeRms:nativeMaxForce,
          browserAni2xVsNativeEnergyDeltaRangeKcalMol:[0.00277, 0.06312],
          nativeOpenmmReferenceVsCudaEnergyDeltaRangeKjMol:[0.0000429, 0.000111],
        },
        claims:[
          'All fixed energy and force parity gates passed for five exact 7KPA-derived poses.',
          'The five poses represent three analogue chemistries from one protein target, not five independent systems.',
          'The earlier disagreement was a vacuum-versus-OBC2 protocol mismatch; both solvent modes now reproduce their matched references.',
        ],
        artifactIds:['browserVacuum', 'browserObc2', 'openmmNative', 'nativeReport'],
      },
      {
        studyId:'7kpa-two-terminus-chemistry-panel-v0.1',
        title:'7KPA chemistry stress panel',
        status:'registered-partial',
        evidenceLevel:'frozen chemist-action scripts and validated harness; no committed complete 20-case result artifact yet',
        executedAt:null,
        counts:{
          registeredChemistryCases:analoguePanel.cases.length,
          proteinTargets:1,
          referenceSystems:1,
          loci:Object.fromEntries([...Map.groupBy(analoguePanel.cases, entry => entry.locus).entries()]
            .map(([locus, entries]) => [locus, entries.length])),
        },
        metrics:null,
        claims:[
          'Twenty chemistry edit scripts are preregistered and graph-hash checked.',
          'They are variants of one 7KPA/D84 complex and do not add twenty independent protein systems.',
          'Until a complete result artifact is committed, this panel is not counted as a completed 20-case validation run.',
        ],
        artifactIds:['analoguePanel'],
      },
      {
        studyId:'7kpa-manual-contact-recapture-v0.1',
        title:'7KPA manual H-bond recapture panel',
        status:'development-smoke',
        evidenceLevel:'ten preregistered chemist-action scripts; one hash-checked end-to-end development replay',
        executedAt:manualContactSmoke.executedAt,
        counts:{
          registeredChemistryCases:manualContactPanel.cases.length,
          executedDevelopmentCases:1,
          proteinTargets:1,
          referenceSystems:1,
          searchCandidates:manualContactSmoke.outcome.candidateCount,
          feasibleCandidates:manualContactSmoke.outcome.feasibleCount,
        },
        metrics:{
          productGraphMatchesExpected:manualContactSmoke.chemistry.productGraphMatchesExpected,
          allRequiredHydrogenBondsSatisfied:manualContactSmoke.outcome.allRequiredHydrogenBondsSatisfied,
          manualDonorAcceptorDistanceAngstrom:manualContactSmoke.outcome.manualHydrogenBond.donorAcceptorDistanceAngstrom,
          manualHydrogenAcceptorDistanceAngstrom:manualContactSmoke.outcome.manualHydrogenBond.hydrogenAcceptorDistanceAngstrom,
          manualDhaAngleDegrees:manualContactSmoke.outcome.manualHydrogenBond.dhaAngleDegrees,
          labbookValid:manualContactSmoke.audit.labbookValid,
        },
        claims:[
          'Ten explicit delete, forget, rebuild, reassert, and refine scripts are preregistered through the public Chemist Actions API.',
          'The executed pyridone-carbonyl case reproduced its frozen product graph and all eight generated poses satisfied all four required H-bonds.',
          'This is one development replay from one reference complex; the complete ten-case panel has not yet been executed or claimed.',
        ],
        artifactIds:['manualContactPanel', 'manualContactProtocol', 'manualContactSmoke'],
      },
    ],
    proteinTargets,
    referenceSystems,
    cases,
    artifacts,
  };
}

export function stableRegistryJson(registry) {
  return `${JSON.stringify(registry, null, 2)}\n`;
}
