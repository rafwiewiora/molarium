#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySos1AwwReceptorOnlyRun, sha256 } from '../../scripts/sos1-aww-receptor-only-publication.mjs';
import { verifyAxhContinuation } from '../../scripts/sos1-axh-continuation.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert(process.argv[2], 'An explicit frozen AWW run is required');
const run = await verifySos1AwwReceptorOnlyRun(resolve(root, process.argv[2]),
  { root, requireAccepted:false });
const validation = run.validation;
const phe = validation.checks.phe890;
const geometry = validation.checks.designerInteraction.predictedGeometry;
const values = {
  SosIntentLigandRmsd:validation.contextMeasurements.ligandWholeHeavyAtomRmsdAngstrom,
  SosIntentPheRmsd:phe.sidechainRmsdAngstrom,
  SosIntentPheRmsdCutoff:phe.thresholds.sidechainRmsdAngstrom,
  SosIntentChiOneDifference:phe.chi1DifferenceDegrees,
  SosIntentChiTwoDifference:phe.chi2DifferenceDegrees,
  SosIntentContactDistance:geometry.donorAcceptorDistanceAngstrom,
  SosIntentContactAngle:geometry.donorHydrogenAcceptorAngleDegrees,
  SosIntentPrimaryDifference:validation.checks.designerInteraction.torsion.absoluteCircularDifferenceDegrees,
  SosIntentEnergy:run.manifest.phe890Selection.selectedFullSystemEnergy,
};
const axh = process.argv[3] ? await verifyAxhContinuation(resolve(root, process.argv[3]), run) : null;
if (axh) Object.assign(values, {
  SosIntentAxhLigandRmsd:axh.comparison.measurement.ligand.wholeHeavyAtomRmsdAngstrom,
  SosIntentAxhPheRmsd:axh.comparison.measurement.predictedReceptorVersusHoldout.sidechainRmsdAngstrom,
  SosIntentAxhDistalRmsd:axh.comparison.retainedSpatialFeatures[0].rmsdAngstrom,
  SosIntentAxhDistalCentroid:axh.comparison.retainedSpatialFeatures[0].centroidDisplacementAngstrom,
});
const lines = ['% Generated measurement-only values. This file does not claim complete acceptance.',
  `% run: ${run.runId}`, `% manifest-sha256: ${sha256(run.manifestBytes)}`,
  `% validation-sha256: ${sha256(run.validationBytes)}`,
  `\\newcommand{\\SosIntentRunHash}{${sha256(run.manifestBytes).slice(0,12)}}`,
  `\\newcommand{\\SosIntentValidationStatus}{${validation.accepted ? 'passed' : 'failed'}}`,
  `\\newcommand{\\SosIntentCandidateCount}{${run.manifest.phe890Selection.evaluatedCandidateCount}}`,
];
if (axh) lines.push(`% AXH continuation-manifest-sha256: ${sha256(axh.manifestBytes)}`,
  `% AXH comparison-sha256: ${sha256(axh.comparisonBytes)}`);
for (const [name, value] of Object.entries(values)) {
  assert(Number.isFinite(value), `${name} is not finite`);
  lines.push(`\\newcommand{\\${name}}{${value.toFixed(3)}}`);
}
const output = resolve(root, 'paper/generated/sos1-designer-intent-results.tex');
await mkdir(dirname(output), { recursive:true });
await writeFile(output, `${lines.join('\n')}\n`);
console.log(output);
