#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { argumentValue, requireExplicitRunDirectory, sha256,
  SOS1_ROUTE_ID, SOS1_STEP_IDS, verifyAcceptedSos1Run } from './sos1-accepted-run.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_PROTOCOL =
  'design-history/structures/generated/sos1-holdout-evaluation-protocol.json';
const EVALUATOR = 'design-history/structures/evaluate-sos1-holdouts.py';
const LEGACY_RUN_TOKENS = ['growth-clash', 'chemist-actions-review', 'hit-only-success'];
const HOLDOUT_IDS = new Set(['5OVF','5OVG','5OVH','5OVI']);

function repositoryPath(root, value, label) {
  assert(typeof value === 'string' && value,
    `${label} must be a non-empty path`);
  const path = resolve(root, value);
  const local = relative(root, path);
  assert(local && local !== '..' && !local.startsWith(`..${sep}`),
    `${label} must be inside the repository`);
  return path;
}

function parseOptions(argv, { root = ROOT } = {}) {
  const knownWithValues = new Set(['--run','--holdout-dir','--protocol','--render-dir']);
  const knownFlags = new Set(['--execute','--open-holdouts','--help']);
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index].split('=')[0];
    if (!knownWithValues.has(key) && !knownFlags.has(key))
      throw new Error(`Unknown argument ${argv[index]}`);
    if (knownWithValues.has(key) && !argv[index].includes('=')) index += 1;
  }
  const runDirectory = repositoryPath(root,
    requireExplicitRunDirectory(argv, { root }), 'accepted run');
  const runId = runDirectory.split(sep).at(-1);
  for (const token of LEGACY_RUN_TOKENS)
    assert(!runId.toLowerCase().includes(token), `Refusing retired run ${runId}`);
  assert(!/(?:^|[-_])v7(?:[-_]|$)/i.test(runId),
    'The retired v7 run cannot be promoted');
  const holdout = argumentValue(argv, '--holdout-dir');
  if (!holdout) throw new Error('--holdout-dir is required and is never selected implicitly');
  return Object.freeze({ root:resolve(root), runDirectory,
    holdoutDirectory:resolve(root, holdout),
    protocolPath:repositoryPath(root, argumentValue(argv, '--protocol') || DEFAULT_PROTOCOL,
      'evaluation protocol'),
    renderDirectory:resolve(root, argumentValue(argv, '--render-dir')
      || `${relative(root, runDirectory)}/interface-movie`),
    execute:argv.includes('--execute'), openHoldouts:argv.includes('--open-holdouts') });
}

function completeInspection(inspection, label) {
  assert(inspection && Array.isArray(inspection.atoms) && inspection.atoms.length,
    `${label} is absent`);
  assert.equal(inspection.truncated, false, `${label} is truncated`);
  assert.equal(inspection.totalAtomCount, inspection.atoms.length,
    `${label} does not contain the complete coordinate inspection`);
  for (const atom of inspection.atoms)
    assert(Array.isArray(atom.coordinatesAngstrom) && atom.coordinatesAngstrom.length === 3
      && atom.coordinatesAngstrom.every(Number.isFinite),
    `${label} contains invalid coordinates`);
}

function assertNoEvaluationCoordinates(value, label = 'prediction checkpoint') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoEvaluationCoordinates(entry, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const hasCoordinates = ['coordinatesAngstrom','coordinates','directCoordinates','pdbText','molBlock']
    .some((key) => Object.hasOwn(value, key));
  const ids = [value.pdbId, value.holdoutPdbId].map((entry) => String(entry || '').toUpperCase());
  if (hasCoordinates && (value.role === 'evaluation-only'
    || value.coordinateClass === 'evaluation-only-holdout'
    || ids.some((id) => HOLDOUT_IDS.has(id))))
    throw new Error(`${label} contains evaluation-only coordinates`);
  for (const [key, child] of Object.entries(value))
    assertNoEvaluationCoordinates(child, `${label}.${key}`);
}

/**
 * Verify every pre-open boundary without resolving or reading a holdout file.
 * The holdout directory is intentionally not an argument to this function.
 */
export async function verifyPreHoldoutPromotionInputs({ root = ROOT, runDirectory,
  protocolPath }) {
  const protocolBytes = await readFile(protocolPath);
  const protocol = JSON.parse(protocolBytes);
  assert.equal(protocol.schema, 'molarium.sos1-holdout-evaluation-protocol/v1');
  assert.equal(protocol.routeId, SOS1_ROUTE_ID);
  assert.equal(protocol.registeredBeforeHoldoutAccess, true);
  assert.equal(protocol.holdoutCoordinateHashBinding, 'post-open-evaluation-report-only');
  assert.deepEqual(protocol.predictionInputs?.requiredStepIds, SOS1_STEP_IDS);
  assert.equal(protocol.predictionInputs?.requireCompleteCoordinateInspections, true);
  assert.deepEqual(protocol.holdouts?.map((entry) => entry.pdbId), [...HOLDOUT_IDS]);

  const evaluatorPath = repositoryPath(root, protocol.evaluator?.path, 'protocol evaluator');
  assert.equal(evaluatorPath, resolve(root, EVALUATOR));
  assert.equal(sha256(await readFile(evaluatorPath)), protocol.evaluator.sha256,
    'registered evaluator source changed');
  const routePath = repositoryPath(root, protocol.registeredRoute?.path, 'registered route');
  const routeBytes = await readFile(routePath);
  const route = JSON.parse(routeBytes);
  assert.equal(sha256(routeBytes), protocol.registeredRoute.sha256,
    'registered route changed after protocol registration');
  assert.equal(route.schema, protocol.registeredRoute.schema);
  assert.equal(route.id, SOS1_ROUTE_ID);

  const [manifestBytes, auditBytes] = await Promise.all([
    readFile(resolve(runDirectory, 'prediction-manifest.json')),
    readFile(resolve(runDirectory, 'chemist-action-audit.json')),
  ]);
  const manifest = JSON.parse(manifestBytes), audit = JSON.parse(auditBytes);
  assert.equal(manifest.schema, protocol.predictionInputs.runManifestSchema);
  assert.equal(manifest.routeId, SOS1_ROUTE_ID);
  assert.equal(manifest.status, 'predictions-frozen-holdouts-unopened');
  assert.equal(manifest.protocol?.initialCoordinateInput, 'PDB 5OVE/AXE only');
  assert.equal(manifest.protocol?.sequentialPredictedReferences, true);
  assert.deepEqual(manifest.checkpoints?.map((entry) => entry.stepId), SOS1_STEP_IDS);
  assert.equal(manifest.agentApi?.auditSha256, sha256(auditBytes));
  assert.equal(manifest.agentApi?.auditRecords, audit.records?.length);
  assert.equal(audit.routeId, SOS1_ROUTE_ID);

  const campaignInput = manifest.inputs?.campaign;
  assert(campaignInput?.path && campaignInput?.sha256,
    'prediction manifest does not pin its registered route input');
  const campaignPath = repositoryPath(root, campaignInput.path, 'prediction route');
  const campaignBytes = await readFile(campaignPath);
  assert.equal(sha256(campaignBytes), campaignInput.sha256,
    'prediction route changed after the run');
  assert.equal(campaignInput.sha256, protocol.registeredRoute.sha256,
    'prediction and evaluation protocol use different registered routes');

  const requiredActions = new Set(['designRoute.load','designRoute.applyStep','pose.refine',
    'pose.apply','pose.enumerateSidechainRotamers','pose.applySidechainRotamer',
    'optimization.run','session.inspect']);
  const completedActions = new Set((audit.records || []).filter((entry) =>
    entry.status === 'completed').map((entry) => entry.action));
  for (const action of requiredActions)
    assert(completedActions.has(action), `Chemist Actions audit lacks completed ${action}`);

  const checkpointHashes = [];
  for (const frozen of manifest.checkpoints) {
    assert(Number.isInteger(frozen.freezeActionSequence) && frozen.freezeActionSequence > 0,
      `${frozen.stepId}: invalid freeze action sequence`);
    const freeze = audit.records.find((entry) => entry.sequence === frozen.freezeActionSequence);
    assert(freeze && freeze.status === 'completed' && freeze.action === 'session.inspect'
      && freeze.args?.scope === 'pocket' && freeze.args?.includeCoordinates === true,
    `${frozen.stepId}: checkpoint is not bound to its completed pocket inspection`);
    const path = resolve(runDirectory, frozen.filename);
    const bytes = await readFile(path), checkpoint = JSON.parse(bytes);
    assert.equal(sha256(bytes), frozen.sha256, `${frozen.stepId}: checkpoint changed`);
    assert.equal(checkpoint.schema, protocol.predictionInputs.checkpointSchema);
    assert.equal(checkpoint.routeId || checkpoint.campaignId, SOS1_ROUTE_ID);
    assert.equal(checkpoint.stepId, frozen.stepId);
    assert.equal(checkpoint.predictedStateId, frozen.predictedStateId);
    assert.equal(checkpoint.frozenBeforeHoldoutAccess, true);
    completeInspection(checkpoint.ligand, `${frozen.stepId} ligand inspection`);
    completeInspection(checkpoint.pocket, `${frozen.stepId} pocket inspection`);
    assertNoEvaluationCoordinates(checkpoint, `${frozen.stepId} checkpoint`);
    checkpointHashes.push({ stepId:frozen.stepId, sha256:frozen.sha256 });
  }
  return Object.freeze({ protocolSha256:sha256(protocolBytes),
    predictionManifestSha256:sha256(manifestBytes), sourceAuditSha256:sha256(auditBytes),
    routeSha256:sha256(routeBytes), checkpoints:checkpointHashes });
}

function command(executable, args) {
  return Object.freeze({ executable, args:Object.freeze(args) });
}

export function promotionStages(options) {
  const local = (path) => repositoryPath(options.root, path, 'promotion output');
  return Object.freeze([
    { id:'preflight', description:'Verify registered protocol and frozen prediction evidence',
      internal:true },
    { id:'evaluate', description:'Open registered holdouts and write the independent evaluation',
      opensHoldouts:true, ...command(process.env.PYTHON || 'python3', [EVALUATOR,
        '--run', options.runDirectory, '--holdout-dir', options.holdoutDirectory,
        '--protocol', options.protocolPath]) },
    { id:'acceptance', description:'Reject unless every evaluation and continuity check passed',
      internal:true },
    { id:'source-replay', description:'Build the run-local guarded public-action replay',
      ...command(process.execPath, ['scripts/build-sos1-accepted-replay.mjs',
        '--run', options.runDirectory]) },
    { id:'interface-render', description:'Render Local Lab interface checkpoints and movie',
      ...command('bun', ['scripts/render-designer-moves-interface.mjs',
        '--run', options.runDirectory, '--output', options.renderDirectory]) },
    { id:'accepted-results', description:'Generate manuscript values from accepted evaluation only',
      ...command(process.execPath, ['paper/scripts/build-sos1-results-tex.mjs',
        '--run', options.runDirectory, '--output',
        local('paper/generated/sos1-accepted-results.tex')]) },
    { id:'figure-2', description:'Compose five synchronized interface frames',
      ...command(process.env.PYTHON || 'python3', ['paper/scripts/build-sos1-paper-figure.py',
        '--run', options.runDirectory, '--render-dir', options.renderDirectory,
        '--output', local('paper/figures/fig2_sos1_hit_to_bay293.png')]) },
    { id:'figure-1', description:'Recapture the normal Local Lab 6EPM/BQ5 interface',
      ...command('bun', ['scripts/capture-paper-figure1.mjs', '--install']) },
    { id:'publication', description:'Promote replay, checkpoint review, provenance and declaration',
      ...command(process.execPath, ['scripts/build-sos1-publication.mjs',
        '--run', options.runDirectory]) },
    { id:'verify-publication', description:'Verify every declared hash and registry binding',
      ...command(process.execPath, ['scripts/verify-sos1-publication.mjs']) },
    { id:'manifest', description:'Regenerate the Local Lab reviewed-file manifest',
      ...command('bun', ['scripts/generate-local-lab-manifest.mjs']) },
    { id:'build', description:'Build the reviewed web distribution',
      ...command('bun', ['scripts/build-web.mjs']) },
    { id:'focused-tests', description:'Run lightweight promotion and paper-asset tests',
      ...command('npm', ['run', 'test:sos1-promotion']) },
  ]);
}

function runCommand(stage, { root }) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(stage.executable, stage.args, { cwd:root, stdio:'inherit',
      env:process.env });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => code === 0 ? resolveRun()
      : rejectRun(new Error(`${stage.id} failed (${signal || `exit ${code}`})`)));
  });
}

export async function executePromotion(options) {
  assert(options.execute, 'Promotion execution requires --execute');
  assert(options.openHoldouts,
    'Promotion execution requires explicit --open-holdouts consent');
  const stages = promotionStages(options);
  for (const stage of stages) {
    process.stdout.write(`\n[${stage.id}] ${stage.description}\n`);
    if (stage.id === 'preflight') {
      const evidence = await verifyPreHoldoutPromotionInputs(options);
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    } else if (stage.id === 'acceptance') {
      const accepted = await verifyAcceptedSos1Run(options.runDirectory);
      process.stdout.write(`Accepted run: ${accepted.runId}\n`);
    } else await runCommand(stage, options);
  }
  process.stdout.write('\nPromotion completed locally. GitHub and deployment remain separate.\n');
}

export function promotionPlan(options) {
  return promotionStages(options).map((stage) => ({ id:stage.id,
    description:stage.description, opensHoldouts:Boolean(stage.opensHoldouts),
    command:stage.internal ? null : [stage.executable, ...stage.args] }));
}

export async function main(argv = process.argv.slice(2), { root = ROOT } = {}) {
  if (argv.includes('--help')) {
    process.stdout.write('Usage: promote-sos1-publication --run DIR --holdout-dir DIR '
      + '[--protocol FILE] [--render-dir DIR] [--execute --open-holdouts]\n');
    return;
  }
  const options = parseOptions(argv, { root });
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify({ mode:'dry-run', mutates:false,
      explicitRun:options.runDirectory, holdoutsRemainUnopened:true,
      executionRequires:['--execute','--open-holdouts'], stages:promotionPlan(options),
      excludedStages:['git','github','deploy'] }, null, 2)}\n`);
    return;
  }
  await executePromotion(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
