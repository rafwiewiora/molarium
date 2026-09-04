import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAcceptedSos1ReplayScript, requireExplicitRunDirectory, sha256,
  verifyAcceptedSos1Run } from './sos1-accepted-run.mjs';

assert.throws(() => requireExplicitRunDirectory([]), /--run is required/);

const scratch = await mkdtemp(join(tmpdir(), 'molarium-accepted-sos1-'));
const steps = ['scaffold-rewrite', 'fragment-merge', 'open-phe890-pocket', 'finish-bay-293'];
try {
  const records = [];
  const push = (requestId, action, args = {}) => {
    const record = { sequence:records.length + 1, schema:'molarium.chemist-actions/v1', requestId,
      action, args, status:'completed' };
    records.push(record);
    return record;
  };
  push('route-load-hit', 'designRoute.load', { routeId:'sos1-hit-only' });
  push('route-enter-build', 'view.setMode', { mode:'build' });
  push('route-prepare-hit', 'protein.prepare', { pH:7.4, histidine:'auto',
    repairMissingHeavy:true, ligandPolicy:'ccd', waterPolicy:'retain', gapPolicy:'cap' });
  push('route-capture-hit', 'pose.captureReference', { mode:'propagate' });
  const freezeSequences = new Map();
  for (const stepId of steps) {
    push(`${stepId}-stage`, 'designRoute.applyStep', { stepId });
    if (stepId === 'open-phe890-pocket') {
      push(`${stepId}-enumerate-phe890-initial`, 'pose.enumerateSidechainRotamers',
        { receptorAtomId:'receptor:PHE:890:CG', maximumCandidates:32 });
      push(`${stepId}-apply-phe890-branch-1`, 'pose.applySidechainRotamer',
        { coordinateSha256:'discarded' });
      push(`${stepId}-undo-branch-1-rotamer`, 'history.undo', {});
      push(`${stepId}-enumerate-phe890-final`, 'pose.enumerateSidechainRotamers',
        { receptorAtomId:'receptor:PHE:890:CG', maximumCandidates:32 });
      push(`${stepId}-apply-selected-phe890-branch`, 'pose.applySidechainRotamer',
        { coordinateSha256:'selected' });
      push(`${stepId}-accept-selected-receptor-branch`, 'pose.updateReceptorReference', {});
      push(`${stepId}-pose-selected-phe890-branch`, 'pose.refine',
        { searchChains:8, execution:'serial', featureSeedingProtocol:'v5' });
      push(`${stepId}-apply-selected-phe890-pose`, 'pose.apply', { index:0 });
    } else {
      push(`${stepId}-pose-refine`, 'pose.refine',
        { searchChains:8, execution:'serial', featureSeedingProtocol:'v5' });
      push(`${stepId}-pose-apply`, 'pose.apply', { index:0 });
    }
    push(`${stepId}-parameterize-without-motion`, 'protein.parameterize', {});
    push(`${stepId}-complex-relax`, 'optimization.run', { method:'induced-fit-webgpu' });
    push(`${stepId}-freeze-ligand`, 'session.inspect',
      { scope:'ligand', includeCoordinates:true, maximumAtoms:256 });
    freezeSequences.set(stepId, push(`${stepId}-freeze-pocket`, 'session.inspect',
      { scope:'pocket', includeCoordinates:true, maximumAtoms:500 }).sequence);
  }
  const audit = { schema:'molarium.chemist-actions/v1', routeId:'sos1-hit-only', records };
  const auditBytes = Buffer.from(`${JSON.stringify(audit)}\n`);
  await writeFile(join(scratch, 'chemist-action-audit.json'), auditBytes);
  const checkpoints = [];
  for (const [index, stepId] of steps.entries()) {
    const body = { schema:'molarium.design-prediction-checkpoint/v1',
      routeId:'sos1-hit-only', stepId, frozenBeforeHoldoutAccess:true,
      ligand:{ atoms:[{ atomName:'C1', coordinatesAngstrom:[index, 0, 0] }] },
      pocket:{ atoms:[] } };
    const bytes = Buffer.from(`${JSON.stringify(body)}\n`);
    const filename = `${stepId}-prediction.json`;
    await writeFile(join(scratch, filename), bytes);
    checkpoints.push({ stepId, predictedStateId:['AWT','AWZ','AWW','AXH'][index],
      filename, sha256:sha256(bytes), freezeActionSequence:freezeSequences.get(stepId) });
  }
  const manifest = { schema:'molarium.design-prediction-run/v1', routeId:'sos1-hit-only',
    status:'predictions-frozen-holdouts-unopened', protocol:{
      initialCoordinateInput:'PDB 5OVE/AXE only', sequentialPredictedReferences:true },
    checkpoints, agentApi:{ auditSha256:sha256(auditBytes), auditRecords:records.length } };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  await writeFile(join(scratch, 'prediction-manifest.json'), manifestBytes);
  const evaluation = { schema:'molarium.design-prediction-holdout-evaluation-summary/v2',
    routeId:'sos1-hit-only', predictionManifestSha256:sha256(manifestBytes),
    holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified:true,
    accepted:true, continuity:{ accepted:true }, results:steps.map((stepId) => ({
      stepId, accepted:true, failedChecks:[],
    })) };
  await writeFile(join(scratch, 'holdout-evaluation-summary.json'),
    `${JSON.stringify(evaluation)}\n`);

  const verified = await verifyAcceptedSos1Run(scratch);
  const replay = await buildAcceptedSos1ReplayScript(verified);
  assert.deepEqual(replay.script.actions.filter((step) =>
    step.action === 'designRoute.applyStep').map((step) => step.args.stepId), steps);
  assert.equal(replay.script.actions.filter((step) =>
    step.action === 'pose.applySidechainRotamer').length, 1);
  assert.equal(replay.script.actions.filter((step) => step.action === 'session.inspect'
    && step.args.scope === 'pocket' && step.args.includeCoordinates === true).length, steps.length);
  assert(!JSON.stringify(replay.script).includes('discarded'));
  assert.equal(replay.script.sourceAudit.accepted, true);

  const rejected = { ...evaluation, accepted:false };
  await writeFile(join(scratch, 'holdout-evaluation-summary.json'), `${JSON.stringify(rejected)}\n`);
  await assert.rejects(() => verifyAcceptedSos1Run(scratch), /was not accepted/);

  await writeFile(join(scratch, 'holdout-evaluation-summary.json'), `${JSON.stringify(evaluation)}\n`);
  const finalPath = join(scratch, 'finish-bay-293-prediction.json');
  const contaminated = JSON.parse(await readFile(finalPath, 'utf8'));
  contaminated.evaluation = { role:'evaluation-only', pdbId:'5OVI',
    coordinatesAngstrom:[1,2,3] };
  const contaminatedBytes = Buffer.from(`${JSON.stringify(contaminated)}\n`);
  await writeFile(finalPath, contaminatedBytes);
  const dirtyManifest = { ...manifest, checkpoints:manifest.checkpoints.map((entry) =>
    entry.stepId === 'finish-bay-293' ? { ...entry, sha256:sha256(contaminatedBytes) } : entry) };
  const dirtyManifestBytes = Buffer.from(`${JSON.stringify(dirtyManifest)}\n`);
  await writeFile(join(scratch, 'prediction-manifest.json'), dirtyManifestBytes);
  await writeFile(join(scratch, 'holdout-evaluation-summary.json'), `${JSON.stringify({
    ...evaluation, predictionManifestSha256:sha256(dirtyManifestBytes),
  })}\n`);
  await assert.rejects(() => verifyAcceptedSos1Run(scratch), /holdout coordinates/);
  console.log('Accepted SOS1 publication-run gate: PASS');
} finally {
  await rm(scratch, { recursive:true, force:true });
}
