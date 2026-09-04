import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { actionScriptSha256 } from '../design-history/replay.mjs';
import { buildAcceptedSos1ReplayScript, sha256,
  verifyAcceptedSos1Run } from './sos1-accepted-run.mjs';
import { SOS1_PUBLICATION_DECLARATION,
  verifySos1Publication } from './verify-sos1-publication.mjs';

const steps = ['scaffold-rewrite', 'fragment-merge', 'open-phe890-pocket', 'finish-bay-293'];
const scratch = await mkdtemp(join(tmpdir(), 'molarium-sos1-publication-'));
const runId = 'sos1-hit-only-coupled-postrelax-v9-test';
const runRelative = `design-history/publications/sos1/${runId}`;
const runDirectory = join(scratch, runRelative);
const replayRelative = 'design-history/examples/sos1-current.action-script.json';
const storyRelative = 'design-history/structure-viewer/sos1-current.json';
const descriptorPath = join(scratch, SOS1_PUBLICATION_DECLARATION);

async function writeJson(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await mkdir(dirname(path), { recursive:true });
  await writeFile(path, bytes);
  return bytes;
}

try {
  const records = [];
  const push = (requestId, action, args = {}) => records.push({
    sequence:records.length + 1, schema:'molarium.chemist-actions/v1', requestId,
    action, args, status:'completed',
  });
  push('route-load-hit', 'designRoute.load', { routeId:'sos1-hit-only' });
  for (const stepId of steps) {
    push(`${stepId}-stage`, 'designRoute.applyStep', { stepId });
    if (stepId === 'open-phe890-pocket') {
      push(`${stepId}-enumerate-phe890-final`, 'pose.enumerateSidechainRotamers',
        { receptorAtomId:'receptor:PHE:890:CG', maximumCandidates:32 });
      push(`${stepId}-apply-selected-phe890-branch`, 'pose.applySidechainRotamer',
        { coordinateSha256:'a'.repeat(64) });
    }
    push(`${stepId}-pose-refine`, 'pose.refine',
      { searchChains:8, execution:'serial', featureSeedingProtocol:'v5' });
    push(`${stepId}-pose-apply`, 'pose.apply', { index:0 });
  }
  const audit = { schema:'molarium.chemist-actions/v1', routeId:'sos1-hit-only', records };
  const auditBytes = await writeJson(join(runDirectory, 'chemist-action-audit.json'), audit);

  const checkpointRecords = [];
  for (const [index, stepId] of steps.entries()) {
    const checkpoint = { schema:'molarium.design-prediction-checkpoint/v1',
      routeId:'sos1-hit-only', stepId, frozenBeforeHoldoutAccess:true,
      ligand:{ atoms:[{ atomName:'C1', element:'C', coordinatesAngstrom:[index, 0, 0] }] },
      pocket:{ atoms:[] } };
    const filename = `${stepId}-prediction.json`;
    const bytes = await writeJson(join(runDirectory, filename), checkpoint);
    checkpointRecords.push({ stepId, filename, sha256:sha256(bytes) });
  }
  const manifest = { schema:'molarium.design-prediction-run/v1', routeId:'sos1-hit-only',
    status:'predictions-frozen-holdouts-unopened', protocol:{
      initialCoordinateInput:'PDB 5OVE/AXE only', sequentialPredictedReferences:true },
    checkpoints:checkpointRecords,
    agentApi:{ auditSha256:sha256(auditBytes), auditRecords:records.length } };
  const manifestBytes = await writeJson(join(runDirectory, 'prediction-manifest.json'), manifest);
  const evaluation = {
    schema:'molarium.design-prediction-holdout-evaluation-summary/v2',
    routeId:'sos1-hit-only', predictionManifestSha256:sha256(manifestBytes),
    holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified:true,
    accepted:true, continuity:{ accepted:true },
    results:steps.map((stepId) => ({ stepId, accepted:true, failedChecks:[] })),
  };
  const evaluationBytes = await writeJson(join(runDirectory,
    'holdout-evaluation-summary.json'), evaluation);

  const accepted = await verifyAcceptedSos1Run(runDirectory);
  const replay = await buildAcceptedSos1ReplayScript(accepted);
  const replayPath = join(scratch, replayRelative);
  let replayBytes = await writeJson(replayPath, replay.script);
  const checkpointLinks = checkpointRecords.map(({ stepId, sha256:checkpointSha256 }) =>
    ({ stepId, sha256:checkpointSha256 }));
  const acceptedLink = {
    schema:'molarium.sos1-accepted-run-link/v1', routeId:'sos1-hit-only', runId,
    accepted:true, predictionManifestSha256:sha256(manifestBytes),
    evaluationSummarySha256:sha256(evaluationBytes), sourceAuditSha256:sha256(auditBytes),
    checkpoints:checkpointLinks,
  };
  let story = { schema:'molarium.structure-story/v1', id:'sos1-hit-to-bay293-review',
    publication:acceptedLink,
    review:{ schema:'molarium.precomputed-checkpoint-review/v1', calculationPolicy:'never-run',
      sourceAuditSha256:sha256(auditBytes),
      actionScript:{ path:'../examples/sos1-current.action-script.json',
        sha256:sha256(replayBytes) } },
    cues:checkpointLinks.map(({ stepId, sha256:predictionSha256 }) => ({
      id:`${stepId}-checkpoint`, scene:stepId,
      checkpoint:{ stepId, predictionSha256 },
    })),
  };
  let storyBytes = await writeJson(join(scratch, storyRelative), story);
  let declaration = { schema:'molarium.sos1-publication/v1', routeId:'sos1-hit-only',
    storyId:story.id,
    acceptedRun:{ id:runId, directory:runRelative,
      predictionManifestSha256:sha256(manifestBytes),
      evaluationSummarySha256:sha256(evaluationBytes), sourceAuditSha256:sha256(auditBytes),
      checkpoints:checkpointLinks },
    publicReplay:{ path:replayRelative, sha256:sha256(replayBytes),
      actionScriptSha256:await actionScriptSha256(replay.script) },
    checkpointReview:{ path:storyRelative, sha256:sha256(storyBytes) },
    integration:{ applicationSource:'app.js', buildSource:'scripts/build-web.mjs',
      manifestSource:'scripts/generate-local-lab-manifest.mjs' },
  };
  await writeJson(descriptorPath, declaration);
  const references = [SOS1_PUBLICATION_DECLARATION, replayRelative, storyRelative].join('\n');
  await writeJson(join(scratch, 'app.js'), { story:story.id, script:replayRelative });
  await mkdir(join(scratch, 'scripts'), { recursive:true });
  await writeFile(join(scratch, 'scripts/build-web.mjs'), references);
  await writeFile(join(scratch, 'scripts/generate-local-lab-manifest.mjs'), references);

  const verified = await verifySos1Publication({ root:scratch });
  assert.equal(verified.acceptedRunId, runId);
  assert.deepEqual(verified.checkpoints, checkpointLinks);

  const v3Replay = structuredClone(replay.script);
  v3Replay.actions.find((step) => step.action === 'pose.refine')
    .args.featureSeedingProtocol = 'v3';
  replayBytes = await writeJson(replayPath, v3Replay);
  declaration.publicReplay.sha256 = sha256(replayBytes);
  declaration.publicReplay.actionScriptSha256 = await actionScriptSha256(v3Replay);
  await writeJson(descriptorPath, declaration);
  await assert.rejects(() => verifySos1Publication({ root:scratch }),
    /forbidden featureSeedingProtocol v3/);

  replayBytes = await writeJson(replayPath, replay.script);
  declaration.publicReplay.sha256 = sha256(replayBytes);
  declaration.publicReplay.actionScriptSha256 = replay.actionScriptSha256;
  await writeJson(descriptorPath, declaration);
  await writeFile(join(runDirectory, 'chemist-action-audit.json'),
    Buffer.concat([auditBytes, Buffer.from('\n')]));
  await assert.rejects(() => verifySos1Publication({ root:scratch }),
    /audit changed after prediction freeze/);
  await writeFile(join(runDirectory, 'chemist-action-audit.json'), auditBytes);

  story = structuredClone(story);
  story.publication.runId = 'some-other-run';
  storyBytes = await writeJson(join(scratch, storyRelative), story);
  declaration.checkpointReview.sha256 = sha256(storyBytes);
  await writeJson(descriptorPath, declaration);
  await assert.rejects(() => verifySos1Publication({ root:scratch }),
    /references a different accepted run/);

  story.publication.runId = runId;
  story.cues[0].checkpoint.predictionSha256 = 'b'.repeat(64);
  storyBytes = await writeJson(join(scratch, storyRelative), story);
  declaration.checkpointReview.sha256 = sha256(storyBytes);
  await writeJson(descriptorPath, declaration);
  await assert.rejects(() => verifySos1Publication({ root:scratch }),
    /scaffold-rewrite: checkpoint review hash changed/);

  console.log('SOS1 publication preflight: PASS');
} finally {
  await rm(scratch, { recursive:true, force:true });
}
