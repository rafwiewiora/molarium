import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parsePdb } from '../design-history/structures/pipeline.mjs';
import { validatePrecomputedCheckpointReview } from
  '../design-history/structure-viewer/checkpoint-review.mjs';
import { expandStructureTimeline } from '../design-history/structure-viewer/timeline.mjs';
import { buildSos1PublicationRecords, pdbFromFrozenInspection, rewritePublicationIntegration,
  SOS1_PUBLIC_ASSET_MANIFEST, SOS1_PUBLIC_PROVENANCE,
  SOS1_PUBLIC_REPLAY, SOS1_PUBLIC_REVIEW,
  SOS1_PUBLIC_REVIEW_ID } from './build-sos1-publication.mjs';
import { verifyPreHoldoutPromotionInputs } from './promote-sos1-publication.mjs';
import { verifyInterfaceRenderForInstallation } from './install-sos1-interface-render.mjs';

const root = resolve(import.meta.dirname, '..');
const atoms = [
  { atomName:'CG', element:'C', residueName:'PHE', chain:'A', residueIndex:890,
    coordinatesAngstrom:[1.25, -2.5, 3.75] },
  { atomName:'HD1', element:'H', residueName:'PHE', chain:'A', residueIndex:890,
    coordinatesAngstrom:[1.5, -2.7, 3.9] },
];
const pdb = pdbFromFrozenInspection(atoms, { title:'test Phe890' });
const parsed = parsePdb(pdb).atoms;
assert.equal(parsed.length, 1);
assert.equal(parsed[0].atomName, 'CG');
assert.deepEqual([parsed[0].x, parsed[0].y, parsed[0].z], [1.25, -2.5, 3.75]);
assert.throws(() => pdbFromFrozenInspection([{ ...atoms[0], coordinatesAngstrom:[1,2] }],
  { title:'bad' }), /invalid frozen coordinates/);

const stepIds = ['scaffold-rewrite','fragment-merge','open-phe890-pocket','finish-bay-293'];
const stateIds = ['AWT','AWZ','AWW','AXH'];
const auditRecords = [];
const fixedHash = (value) => createHash('sha256').update(value).digest('hex');
const push = (requestId, action, args = {}, result = undefined) => {
  const record = { sequence:auditRecords.length + 1, schema:'molarium.chemist-actions/v1',
    requestId, action, args, status:'completed', ...(result ? { result } : {}) };
  auditRecords.push(record);
  return record;
};
const guarded = (requestId, role) => fixedHash(`${requestId}:${role}`);
push('route-load-hit', 'designRoute.load', { routeId:'sos1-hit-only' });
const checkpoints = new Map(), manifestCheckpoints = [];
for (const [index, stepId] of stepIds.entries()) {
  push(`${stepId}-stage`, 'designRoute.applyStep', { stepId });
  if (stepId === 'open-phe890-pocket') {
    push(`${stepId}-enumerate-phe890-final`, 'pose.enumerateSidechainRotamers',
      { receptorAtomId:'receptor:PHE:890:CG', maximumCandidates:32 });
    push(`${stepId}-apply-selected-phe890-branch`, 'pose.applySidechainRotamer',
      { coordinateSha256:fixedHash('rotamer') });
  }
  const refineId = `${stepId}-pose-refine`;
  push(refineId, 'pose.refine', { searchChains:8, featureSeedingProtocol:'v5' }, {
    refinement:{ stateHashSchema:'molarium.molecular-state-hash/v1',
      inputStateSha256:guarded(refineId, 'input'),
      selectedStateSha256:guarded(refineId, 'selected') },
  });
  const applyId = `${stepId}-pose-apply`;
  push(applyId, 'pose.apply', { index:0 }, { appliedPose:{
    stateHashSchema:'molarium.molecular-state-hash/v1',
    inputStateSha256:guarded(applyId, 'input'),
    selectedStateSha256:guarded(applyId, 'selected'),
    outputStateSha256:guarded(applyId, 'output') } });
  const relaxId = `${stepId}-complex-relax`;
  push(relaxId, 'optimization.run', { method:'induced-fit-webgpu' }, { optimization:{
    stateHashSchema:'molarium.molecular-state-hash/v1',
    inputStateSha256:guarded(relaxId, 'input'),
    outputStateSha256:guarded(relaxId, 'output') } });
  const freeze = push(`${stepId}-freeze-pocket`, 'session.inspect',
    { scope:'pocket', includeCoordinates:true, maximumAtoms:500 });
  const stateId = stateIds[index];
  const checkpoint = { schema:'molarium.design-prediction-checkpoint/v1',
    routeId:'sos1-hit-only', stepId, predictedStateId:stateId,
    frozenBeforeHoldoutAccess:true,
    ligand:{ truncated:false, totalAtomCount:1, atoms:[{ atomId:`${stateId}:C1`,
      atomName:'C1', element:'C', coordinatesAngstrom:[index, 0, 0] }] },
    pocket:{ truncated:false, totalAtomCount:2, atoms:[
      { atomId:'receptor:PHE:890:CG', atomName:'CG', element:'C', residueName:'PHE',
        chain:'A', residueIndex:890, coordinatesAngstrom:[0, index + 1, 0] },
      { atomId:'receptor:ASN:879:CA', atomName:'CA', element:'C', residueName:'ASN',
        chain:'A', residueIndex:879, coordinatesAngstrom:[2, index + 1, 0] },
    ] } };
  const checkpointBytes = Buffer.from(`${JSON.stringify(checkpoint)}\n`);
  const entry = { stepId, predictedStateId:stateId, filename:`${stepId}.json`,
    sha256:fixedHash(checkpointBytes), freezeActionSequence:freeze.sequence };
  checkpoints.set(stepId, { entry, checkpoint, bytes:checkpointBytes });
  manifestCheckpoints.push(entry);
}
const audit = { schema:'molarium.chemist-actions/v1', routeId:'sos1-hit-only',
  records:auditRecords };
const auditBytes = Buffer.from(`${JSON.stringify(audit)}\n`);
const manifest = { schema:'molarium.design-prediction-run/v1', routeId:'sos1-hit-only',
  status:'predictions-frozen-holdouts-unopened', checkpoints:manifestCheckpoints,
  protocol:{ initialCoordinateInput:'PDB 5OVE/AXE only', sequentialPredictedReferences:true },
  agentApi:{ auditSha256:fixedHash(auditBytes), auditRecords:auditRecords.length } };
const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
const evaluation = { accepted:true, continuity:{ accepted:true },
  results:stepIds.map((stepId) => ({ stepId, accepted:true, failedChecks:[] })) };
const evaluationBytes = Buffer.from(`${JSON.stringify(evaluation)}\n`);
const syntheticAccepted = { runId:'guarded-v10-test',
  directory:join(root, 'outputs/design-history/guarded-v10-test'), manifest, manifestBytes,
  evaluation, evaluationBytes, audit, auditBytes, checkpoints };
const records = await buildSos1PublicationRecords(syntheticAccepted);
assert.equal(records.review.review.calculationPolicy, 'never-run');
assert.equal(records.review.cues.length, 4);
assert.equal(expandStructureTimeline(records.review).length, 4,
  'arrowable review must expose exactly one immutable frame per checkpoint');
assert.equal(records.checkpointAssets.size, 12);
for (const cue of records.review.cues) {
  const frozen = checkpoints.get(cue.checkpoint.stepId).entry;
  assert.equal(cue.checkpoint.sourceActionSequence, frozen.freezeActionSequence);
  assert.equal(cue.checkpoint.sourceAction, 'session.inspect');
  assert.equal(cue.checkpoint.predictionSha256, frozen.sha256);
}
assert.equal(records.assetManifest.boundary.coordinatePolicy,
  'frozen-prediction-checkpoints-only');
validatePrecomputedCheckpointReview(records.review, {
  actionScript:records.replay.script, provenance:records.provenance,
  assetManifest:records.assetManifest,
});
assert(!/5OV[F-I]/.test(records.reviewBytes.toString()),
  'precomputed review must not identify or embed evaluation structures');

const [appSource, viewerSource, buildSource, manifestSource, serverSource] = await Promise.all([
  readFile(join(root, 'app.js'), 'utf8'),
  readFile(join(root, 'design-history/structure-viewer/viewer.mjs'), 'utf8'),
  readFile(join(root, 'scripts/build-web.mjs'), 'utf8'),
  readFile(join(root, 'scripts/generate-local-lab-manifest.mjs'), 'utf8'),
  readFile(join(root, 'server.js'), 'utf8'),
]);
const checkpointAssets = new Map([
  ['design-history/structures/generated/sos1-accepted-scaffold-rewrite-ligand.pdb',
    Buffer.from('test')],
]);
const rewritten = rewritePublicationIntegration({ appSource, viewerSource, buildSource,
  manifestSource, serverSource }, { replayBytes:Buffer.from('replay'),
  reviewBytes:Buffer.from('review'), checkpointAssets });
const retired = ['sos1-growth-clash-v7','sos1-v7-','sos1-chemist-actions-review',
  'sos1-hit-only-success'];
for (const source of Object.values(rewritten))
  for (const token of retired) assert(!source.includes(token));
assert(rewritten.appSource.includes(`script:'./${SOS1_PUBLIC_REPLAY}'`));
assert(rewritten.viewerSource.includes(`'${SOS1_PUBLIC_REVIEW_ID}'`));
for (const path of [SOS1_PUBLIC_REPLAY, SOS1_PUBLIC_PROVENANCE,
  SOS1_PUBLIC_ASSET_MANIFEST, SOS1_PUBLIC_REVIEW, ...checkpointAssets.keys()]) {
  assert(rewritten.buildSource.includes(`'${path}'`), `build missing ${path}`);
  assert(rewritten.manifestSource.includes(`'${path}'`), `manifest missing ${path}`);
}
assert(rewritten.serverSource.includes(`story=${SOS1_PUBLIC_REVIEW_ID}`));

const scratch = await mkdtemp(join(root, '.molarium-sos1-promotion-test-'));
try {
  const run = join(scratch, 'guarded-v10'), holdouts = join(scratch, 'holdouts');
  await mkdir(run);
  const protocolPath = join(root,
    'design-history/structures/generated/sos1-holdout-evaluation-protocol.json');
  const protocol = JSON.parse(await readFile(protocolPath, 'utf8'));
  const preflightManifest = { ...manifest, inputs:{ campaign:{
    path:protocol.registeredRoute.path, sha256:protocol.registeredRoute.sha256 } } };
  await writeFile(join(run, 'prediction-manifest.json'),
    `${JSON.stringify(preflightManifest)}\n`);
  await writeFile(join(run, 'chemist-action-audit.json'), auditBytes);
  for (const { entry, bytes } of checkpoints.values())
    await writeFile(join(run, entry.filename), bytes);
  const preflight = await verifyPreHoldoutPromotionInputs({ root, runDirectory:run,
    protocolPath });
  assert.equal(preflight.routeSha256, protocol.registeredRoute.sha256);
  assert.equal(preflight.checkpoints.length, 4);
  const render = join(scratch, 'interface-render');
  await mkdir(render);
  const videoBytes = Buffer.from('accepted interface movie fixture');
  await writeFile(join(render, 'source.action-script.json'), records.replayBytes);
  await writeFile(join(render, 'sos1-designer-moves-molarium-interface.mp4'), videoBytes);
  const localLab = { responsePolicy:'local-only-v1',
    contentSecurityPolicy:"default-src 'self'; connect-src 'self'; object-src 'none'",
    runtimeMode:'local-lab', runtimeLocalOnly:true, runtimePolicy:'local-only-v1',
    allowedNetworkOrigins:['http://127.0.0.1:50001'], documentMode:'local-lab',
    badgeMode:'local-lab', badgeLocalLab:true, badgeText:'Local Lab · network locked',
    foldDisabled:true, msaEndpointDisabled:true, ccdRetrievalDisabled:true, verified:true };
  const renderManifest = {
    schema:'molarium.designer-moves-interface-render/v1', complete:true,
    replay:{ status:'completed' }, acceptedRun:{ accepted:true, id:syntheticAccepted.runId,
      predictionManifestSha256:fixedHash(manifestBytes),
      evaluationSummarySha256:fixedHash(evaluationBytes) }, networkPolicy:localLab,
    sourceScript:{ path:'source.action-script.json', fileSha256:fixedHash(records.replayBytes),
      actionScriptSha256:records.replay.actionScriptSha256,
      sourceAuditSha256:fixedHash(auditBytes) },
    video:{ filename:'sos1-designer-moves-molarium-interface.mp4',
      sha256:fixedHash(videoBytes), bytes:videoBytes.length, width:1600, height:1000,
      frames:1, durationSeconds:1 },
  };
  await writeFile(join(render, 'render-manifest.json'),
    `${JSON.stringify(renderManifest)}\n`);
  const verifiedRender = await verifyInterfaceRenderForInstallation(syntheticAccepted, render);
  assert.equal(verifiedRender.videoBytes.toString(), videoBytes.toString());
  await writeFile(join(render, 'render-manifest.json'), `${JSON.stringify({ ...renderManifest,
    networkPolicy:{ ...localLab, runtimeLocalOnly:false } })}\n`);
  await assert.rejects(() => verifyInterfaceRenderForInstallation(syntheticAccepted, render),
    /permits connected features/);
  // This deliberately nonexistent holdout directory proves preflight did not
  // resolve or read evaluation coordinates.
  const result = spawnSync(process.execPath, ['scripts/promote-sos1-publication.mjs',
    '--run', run, '--holdout-dir', holdouts], { cwd:root, encoding:'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, 'dry-run');
  assert.equal(plan.mutates, false);
  assert.equal(plan.holdoutsRemainUnopened, true);
  assert.deepEqual(plan.excludedStages, ['git','github','deploy']);
  assert(plan.stages.find((stage) => stage.id === 'evaluate').opensHoldouts);
  assert(plan.stages.some((stage) => stage.id === 'install-interface-render'),
    'accepted interface render must replace the installed publication movie');
  assert.equal(spawnSync(process.execPath, ['scripts/promote-sos1-publication.mjs',
    '--run', run], { cwd:root }).status, 1,
  'implicit holdout directory must be rejected');
  assert.equal(spawnSync(process.execPath, ['scripts/promote-sos1-publication.mjs',
    '--run', run, '--holdout-dir', holdouts, '--execute'], { cwd:root }).status, 1,
  'execution without --open-holdouts consent must be rejected');
} finally {
  await rm(scratch, { recursive:true, force:true });
}

const builder = await readFile(join(root, 'scripts/build-sos1-publication.mjs'), 'utf8');
const orchestrator = await readFile(join(root, 'scripts/promote-sos1-publication.mjs'), 'utf8');
const movieInstaller = await readFile(
  join(root, 'scripts/install-sos1-interface-render.mjs'), 'utf8');
const retiredBuilder = await readFile(
  join(root, 'scripts/build-sos1-prospective-movie-assets.mjs'), 'utf8');
const testResume = await readFile(join(root, 'scripts/resume-sos1-final-step.mjs'), 'utf8');
assert(!builder.includes('window.molariumTest'));
assert(!orchestrator.includes('window.molariumTest'));
assert(!movieInstaller.includes('window.molariumTest'));
assert.match(orchestrator, /explicit --open-holdouts consent/);
assert.match(builder, /coordinatePolicy:'frozen-prediction-checkpoints-only'/);
assert.match(builder, /sourceAction:'session.inspect'/);
assert.match(builder, /The declaration is the commit point and is deliberately written last/);
assert.match(movieInstaller, /verifyLocalLabCaptureState/);
assert.match(movieInstaller, /buildAcceptedSos1ReplayScript/);
assert.match(movieInstaller, /Movie first, pinned manifest last/);
assert.match(retiredBuilder, /Retired archival asset builder/);
assert.match(testResume, /--test-only-unsafe-resume/);

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert(!Object.hasOwn(packageJson.scripts, 'build:sos1-movie-assets'));
assert(!Object.hasOwn(packageJson.scripts, 'run:sos1-final-resume'));
assert.equal(packageJson.scripts['promote:sos1-publication'],
  'node scripts/promote-sos1-publication.mjs');

console.log('SOS1 fail-closed publication promotion checks passed');
