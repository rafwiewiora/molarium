#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { argumentValue, requireExplicitRunDirectory, sha256,
  SOS1_STEP_IDS, verifyAcceptedSos1Run } from '../../scripts/sos1-accepted-run.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STATE = Object.freeze({
  'scaffold-rewrite':['Awt', 'AWT', '5OVF'],
  'fragment-merge':['Awz', 'AWZ', '5OVG'],
  'open-phe890-pocket':['Aww', 'AWW', '5OVH'],
  'finish-bay-293':['Axh', 'BAY-293', '5OVI'],
});

function finite(value, label) {
  assert.equal(Number.isFinite(value), true, `${label} must be finite`);
  return Number(value);
}

function signed(value) {
  const normalized = Math.abs(value) < 0.05 ? 0 : value;
  return `${normalized >= 0 ? '+' : ''}${normalized.toFixed(1)}`;
}

function chiPair(predicted, observed, index, label) {
  assert(Array.isArray(predicted) && predicted.length >= 2, `${label} predicted chi is incomplete`);
  assert(Array.isArray(observed) && observed.length >= 2, `${label} holdout chi is incomplete`);
  return `\\ensuremath{${signed(finite(predicted[index], `${label} predicted chi${index + 1}`))}`
    + `\\,/\\,${signed(finite(observed[index], `${label} holdout chi${index + 1}`))}}`;
}

function literal(value) {
  assert.equal(typeof value, 'string');
  assert(!/[{}]/.test(value), 'LaTeX detokenize value may not contain braces');
  return `\\texttt{\\detokenize{${value}}}`;
}

/** Generate manuscript macros only from an already verified accepted run. */
export function acceptedResultsTex(verified) {
  const evaluation = verified?.evaluation;
  assert.equal(evaluation?.accepted, true, 'SOS1 manuscript results require accepted=true');
  assert.equal(evaluation?.continuity?.accepted, true,
    'SOS1 manuscript results require accepted AWW-to-AXH continuity');
  assert.deepEqual(evaluation.results?.map((entry) => entry.stepId), SOS1_STEP_IDS,
    'SOS1 manuscript results require the complete registered route');
  assert(evaluation.results.every((entry) => entry.accepted === true
    && Array.isArray(entry.failedChecks) && entry.failedChecks.length === 0),
  'SOS1 manuscript results require every holdout check to pass');

  const lines = [
    '% Generated from an independently accepted SOS1 run. Do not edit by hand.',
    `% prediction-manifest-sha256: ${sha256(verified.manifestBytes)}`,
    `% evaluation-summary-sha256: ${sha256(verified.evaluationBytes)}`,
    `\\newcommand{\\SosAcceptedRunId}{${literal(verified.runId)}}`,
    `\\newcommand{\\SosEvaluationHashShort}{${sha256(verified.evaluationBytes).slice(0, 12)}}`,
  ];
  for (const result of evaluation.results) {
    const [macro, state, holdout] = STATE[result.stepId] || [];
    assert(macro, `Unexpected SOS1 state ${result.stepId}`);
    assert.equal(result.holdoutPdbId, holdout, `${state} has the wrong holdout`);
    lines.push(
      `\\newcommand{\\Sos${macro}LigandRmsd}{${finite(result.ligandRmsdAngstrom,
        `${state} ligand RMSD`).toFixed(3)}}`,
      `\\newcommand{\\Sos${macro}PheChiOne}{${chiPair(result.predictedPhe890ChiDegrees,
        result.holdoutPhe890ChiDegrees, 0, state)}}`,
      `\\newcommand{\\Sos${macro}PheChiTwo}{${chiPair(result.predictedPhe890ChiDegrees,
        result.holdoutPhe890ChiDegrees, 1, state)}}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const runDirectory = requireExplicitRunDirectory(argv, { root:ROOT });
  const verified = await verifyAcceptedSos1Run(runDirectory);
  const output = resolve(ROOT, argumentValue(argv, '--output')
    || 'paper/generated/sos1-accepted-results.tex');
  await mkdir(dirname(output), { recursive:true });
  await writeFile(output, acceptedResultsTex(verified));
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
