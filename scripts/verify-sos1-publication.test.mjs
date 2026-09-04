import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { actionScriptSha256 } from '../design-history/replay.mjs';
import { MOLECULAR_STATE_HASH_SCHEMA } from '../molecular-state-hash.mjs';
import { buildAcceptedSos1ReplayScript, sha256,
  verifyAcceptedSos1Run } from './sos1-accepted-run.mjs';
import { SOS1_PUBLICATION_DECLARATION,
  verifySos1Publication } from './verify-sos1-publication.mjs';

const steps = ['scaffold-rewrite', 'fragment-merge', 'open-phe890-pocket', 'finish-bay-293'];
const stateIds = ['AWT', 'AWZ', 'AWW', 'AXH'];
const scratch = await mkdtemp(join(tmpdir(), 'molarium-sos1-publication-'));
const runId = 'sos1-hit-only-coupled-postrelax-v9-test';
const runRelative = `design-history/publications/sos1/${runId}`;
const runDirectory = join(scratch, runRelative);
const replayRelative = 'design-history/examples/sos1-current.action-script.json';
const provenanceRelative = 'design-history/examples/sos1-current.provenance.json';
const storyRelative = 'design-history/structure-viewer/sos1-current.json';
const assetManifestRelative = 'design-history/structures/generated/sos1-current-assets.json';
const movieRelative = 'assets/media/sos1-designer-moves-molarium-interface.mp4';
const renderRelative =
  'assets/media/sos1-designer-moves-molarium-interface.render-manifest.json';
const descriptorPath = join(scratch, SOS1_PUBLICATION_DECLARATION);

async function writeJson(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await mkdir(dirname(path), { recursive:true });
  await writeFile(path, bytes);
  return bytes;
}

function pdb(title, atoms, { ligand = false } = {}) {
  const lines = [`HEADER    ${title}`];
  atoms.forEach((atom, index) => {
    const [x,y,z] = atom.coordinatesAngstrom;
    const record = ligand ? 'HETATM' : 'ATOM  ';
    const name = String(atom.atomName).padStart(4);
    const residue = String(ligand ? 'LIG' : atom.residueName).padStart(3);
    const chain = ligand ? 'L' : atom.chain;
    const residueIndex = ligand ? 1 : atom.residueIndex;
    lines.push(`${record}${String(index + 1).padStart(5)} ${name} ${residue} ${chain}`
      + `${String(residueIndex).padStart(4)}    ${x.toFixed(3).padStart(8)}`
      + `${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}`
      + `  1.00 20.00          ${String(atom.element).padStart(2)}`);
  });
  return `${lines.join('\n')}\nEND\n`;
}

try {
  const records = [];
  const guardedResult = (requestId, action) => {
    const digest = (role) => sha256(Buffer.from(`${requestId}:${role}`));
    const common = { stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
      inputStateSha256:digest('input') };
    if (action === 'pose.refine') return { refinement:{ ...common,
      selectedStateSha256:digest('selected') } };
    if (action === 'pose.apply') return { appliedPose:{ ...common,
      selectedStateSha256:digest('selected'), outputStateSha256:digest('output') } };
    if (action === 'optimization.run') return { optimization:{ ...common,
      outputStateSha256:digest('output') } };
    return undefined;
  };
  const push = (requestId, action, args = {}) => {
    const record = { sequence:records.length + 1, schema:'molarium.chemist-actions/v1',
      requestId, action, args, status:'completed' };
    const result = guardedResult(requestId, action);
    if (result) record.result = result;
    records.push(record);
    return record;
  };
  push('route-load-hit', 'designRoute.load', { routeId:'sos1-hit-only' });
  const checkpointInputs = [];
  for (const [index, stepId] of steps.entries()) {
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
    const ligandAtoms = [{ atomId:`ligand:${stepId}:C1`, atomName:'C1', element:'C',
      coordinatesAngstrom:[index, 0, 0] }];
    const pocketAtoms = [
      { atomId:'receptor:PHE:890:CG', atomName:'CG', element:'C', residueName:'PHE',
        chain:'A', residueIndex:890, coordinatesAngstrom:[0, index + 1, 0] },
      { atomId:'receptor:PHE:890:CD1', atomName:'CD1', element:'C', residueName:'PHE',
        chain:'A', residueIndex:890, coordinatesAngstrom:[1, index + 1, 0] },
    ];
    push(`${stepId}-freeze-ligand`, 'session.inspect',
      { scope:'ligand', includeCoordinates:true, maximumAtoms:256 });
    const freeze = push(`${stepId}-freeze-pocket`, 'session.inspect',
      { scope:'pocket', includeCoordinates:true, maximumAtoms:500 });
    checkpointInputs.push({ stepId, stateId:stateIds[index], ligandAtoms, pocketAtoms,
      freezeActionSequence:freeze.sequence });
  }
  const audit = { schema:'molarium.chemist-actions/v1', routeId:'sos1-hit-only', records };
  const auditBytes = await writeJson(join(runDirectory, 'chemist-action-audit.json'), audit);

  const checkpointRecords = [];
  for (const input of checkpointInputs) {
    const checkpoint = { schema:'molarium.design-prediction-checkpoint/v1',
      routeId:'sos1-hit-only', stepId:input.stepId, predictedStateId:input.stateId,
      frozenBeforeHoldoutAccess:true,
      ligand:{ atoms:input.ligandAtoms }, pocket:{ atoms:input.pocketAtoms } };
    const filename = `${input.stepId}-prediction.json`;
    const bytes = await writeJson(join(runDirectory, filename), checkpoint);
    checkpointRecords.push({ stepId:input.stepId, predictedStateId:input.stateId,
      filename, sha256:sha256(bytes), freezeActionSequence:input.freezeActionSequence });
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
  const movieBytes = Buffer.from('accepted Local Lab interface movie');
  await mkdir(dirname(join(scratch, movieRelative)), { recursive:true });
  await writeFile(join(scratch, movieRelative), movieBytes);
  const renderManifest = {
    schema:'molarium.designer-moves-interface-render/v1', complete:true,
    replay:{ status:'completed' },
    acceptedRun:{ accepted:true, id:runId,
      predictionManifestSha256:sha256(manifestBytes),
      evaluationSummarySha256:sha256(evaluationBytes) },
    sourceScript:{ fileSha256:sha256(replayBytes),
      actionScriptSha256:replay.actionScriptSha256,
      sourceAuditSha256:sha256(auditBytes) },
    networkPolicy:{ responsePolicy:'local-only-v1',
      contentSecurityPolicy:"default-src 'self'; connect-src 'self'; object-src 'none'",
      runtimeMode:'local-lab', runtimeLocalOnly:true, runtimePolicy:'local-only-v1',
      allowedNetworkOrigins:['http://127.0.0.1:50001'], documentMode:'local-lab',
      badgeMode:'local-lab', badgeLocalLab:true,
      badgeText:'Local Lab · network locked', foldDisabled:true,
      msaEndpointDisabled:true, ccdRetrievalDisabled:true, verified:true },
    video:{ filename:'sos1-designer-moves-molarium-interface.mp4',
      sha256:sha256(movieBytes), bytes:movieBytes.length,
      width:1600, height:1000, frames:1, durationSeconds:1 },
  };
  const renderBytes = await writeJson(join(scratch, renderRelative), renderManifest);
  const checkpointLinks = checkpointRecords.map(({ stepId, sha256:checkpointSha256 }) =>
    ({ stepId, sha256:checkpointSha256 }));
  const acceptedLink = {
    schema:'molarium.sos1-accepted-run-link/v1', routeId:'sos1-hit-only', runId,
    accepted:true, predictionManifestSha256:sha256(manifestBytes),
    evaluationSummarySha256:sha256(evaluationBytes), sourceAuditSha256:sha256(auditBytes),
    checkpoints:checkpointLinks,
  };

  const assets = [];
  const scenes = {};
  for (const input of checkpointInputs) {
    const prefix = `sos1-current-${input.stepId}`;
    const ligandPath = `design-history/structures/generated/${prefix}-ligand.pdb`;
    const phePath = `design-history/structures/generated/${prefix}-phe890.pdb`;
    const ligandBytes = Buffer.from(pdb(`${input.stepId} ligand`, input.ligandAtoms,
      { ligand:true }));
    const pheBytes = Buffer.from(pdb(`${input.stepId} Phe890`, input.pocketAtoms));
    await mkdir(dirname(join(scratch, ligandPath)), { recursive:true });
    await writeFile(join(scratch, ligandPath), ligandBytes);
    await writeFile(join(scratch, phePath), pheBytes);
    const stateId = `${input.stateId.toLowerCase()}-prediction`;
    const checkpointSha256 = checkpointRecords.find((entry) =>
      entry.stepId === input.stepId).sha256;
    assets.push({ path:ligandPath, role:'prospective-prediction-ligand',
      stepId:input.stepId, stateId, checkpointSha256,
      sha256:sha256(ligandBytes), bytes:ligandBytes.length });
    assets.push({ path:phePath, role:'prospective-prediction-phe890',
      stepId:input.stepId, stateId, checkpointSha256,
      sha256:sha256(pheBytes), bytes:pheBytes.length });
    scenes[input.stepId] = { models:[
      { ref:`${input.stepId}-ligand`, path:ligandPath.split('/').at(-1),
        sha256:sha256(ligandBytes) },
      { ref:`${input.stepId}-phe890`, path:phePath.split('/').at(-1),
        sha256:sha256(pheBytes) },
    ] };
  }
  let assetManifest = { schema:'molarium.sos1-prospective-movie-assets/v1',
    boundary:{ predictionManifestSha256:sha256(manifestBytes),
      agentApiAuditSha256:sha256(auditBytes) }, checkpoints:checkpointRecords, assets };
  let assetManifestBytes = await writeJson(join(scratch, assetManifestRelative), assetManifest);
  const provenance = { schema:'molarium.designer-moves-example-provenance/v1',
    sourceRun:{ audit:{ sha256:sha256(auditBytes) },
      predictionManifest:{ sha256:sha256(manifestBytes) } },
    scripts:{ acceptedRoute:{ path:replayRelative, fileSha256:sha256(replayBytes),
      actionScriptSha256:replay.actionScriptSha256 } } };
  const provenanceBytes = await writeJson(join(scratch, provenanceRelative), provenance);

  let story = { schema:'molarium.structure-story/v1', id:'sos1-hit-to-bay293-review',
    publication:acceptedLink,
    review:{ schema:'molarium.precomputed-checkpoint-review/v1', calculationPolicy:'never-run',
      sourceAuditSha256:sha256(auditBytes),
      actionScript:{ path:'../examples/sos1-current.action-script.json',
        sha256:sha256(replayBytes) },
      provenance:{ path:'../examples/sos1-current.provenance.json',
        sha256:sha256(provenanceBytes) },
      assetManifest:{ path:'../structures/generated/sos1-current-assets.json',
        sha256:sha256(assetManifestBytes) } },
    scenes,
    cues:checkpointRecords.map((entry) => ({ id:`${entry.stepId}-checkpoint`,
      scene:entry.stepId, checkpoint:{ stepId:entry.stepId, stateId:entry.predictedStateId,
        predictionSha256:entry.sha256, sourceActionSequence:entry.freezeActionSequence,
        sourceAction:'session.inspect' } })),
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
    interfaceMovie:{ path:movieRelative, sha256:sha256(movieBytes), bytes:movieBytes.length,
      renderManifest:{ path:renderRelative, sha256:sha256(renderBytes),
        bytes:renderBytes.length } },
    checkpointReview:{ path:storyRelative, sha256:sha256(storyBytes) },
    integration:{ applicationSource:'app.js',
      structureViewerSource:'design-history/structure-viewer/viewer.mjs',
      buildSource:'scripts/build-web.mjs',
      manifestSource:'scripts/generate-local-lab-manifest.mjs', serverSource:'server.js' },
  };
  await writeJson(descriptorPath, declaration);

  const appSource = `const DESIGNER_STORY_LINKS = Object.freeze({\n`
    + `  'sos1-hit-to-bay293':Object.freeze({ script:'./${replayRelative}', `
    + `sourcePath:'${replayRelative}', sourceSha256:'${sha256(replayBytes)}' })\n});\n`;
  const viewerSource = `const STORY_REGISTRY = Object.freeze({\n`
    + `  '${story.id}':Object.freeze({ path:'./sos1-current.json', `
    + `sha256:'${sha256(storyBytes)}' })\n});\n`;
  const required = [SOS1_PUBLICATION_DECLARATION, replayRelative, storyRelative,
    movieRelative, renderRelative];
  const buildSource = `const files = [\n${required.map((path) => `  '${path}',`).join('\n')}\n];\n`
    + `const redirects = '/sos1-hit-to-bay293/replay /design-history/structure-viewer/?story=${story.id} 302';\n`;
  const manifestSource = `const reviewedFiles = [\n${required.map((path) =>
    `  '${path}',`).join('\n')}\n];\n`;
  const serverSource = `const redirect = '/design-history/structure-viewer/?story=${story.id}';\n`;
  await writeFile(join(scratch, 'app.js'), appSource);
  await writeFile(join(scratch, 'design-history/structure-viewer/viewer.mjs'), viewerSource);
  await mkdir(join(scratch, 'scripts'), { recursive:true });
  await writeFile(join(scratch, 'scripts/build-web.mjs'), buildSource);
  await writeFile(join(scratch, 'scripts/generate-local-lab-manifest.mjs'), manifestSource);
  await writeFile(join(scratch, 'server.js'), serverSource);

  const rewriteStoryAndDeclaration = async () => {
    storyBytes = await writeJson(join(scratch, storyRelative), story);
    declaration.checkpointReview.sha256 = sha256(storyBytes);
    await writeJson(descriptorPath, declaration);
  };
  const rewriteAssetManifestStoryAndDeclaration = async () => {
    assetManifestBytes = await writeJson(join(scratch, assetManifestRelative), assetManifest);
    story.review.assetManifest.sha256 = sha256(assetManifestBytes);
    await rewriteStoryAndDeclaration();
  };

  const verified = await verifySos1Publication({ root:scratch });
  assert.equal(verified.acceptedRunId, runId);
  assert.deepEqual(verified.checkpoints, checkpointLinks);
  assert.equal(replay.script.sourceAudit.stateHashGuards.mode, 'required');

  const missingGuardReplay = structuredClone(replay.script);
  delete missingGuardReplay.actions.find((step) => step.action === 'pose.refine')
    .args.expectedSelectedStateSha256;
  replayBytes = await writeJson(replayPath, missingGuardReplay);
  declaration.publicReplay.sha256 = sha256(replayBytes);
  declaration.publicReplay.actionScriptSha256 = await actionScriptSha256(missingGuardReplay);
  await writeJson(descriptorPath, declaration);
  await assert.rejects(() => verifySos1Publication({ root:scratch }),
    /expectedSelectedStateSha256 must be a lowercase SHA-256 digest/);

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

  story.publication.runId = 'some-other-run';
  await rewriteStoryAndDeclaration();
  await assert.rejects(() => verifySos1Publication({ root:scratch }),
    /references a different accepted run/);
  story.publication.runId = runId;

  story.cues[0].checkpoint.predictionSha256 = 'b'.repeat(64);
  await rewriteStoryAndDeclaration();
  await assert.rejects(() => verifySos1Publication({ root:scratch }),
    /scaffold-rewrite: checkpoint review hash changed/);
  story.cues[0].checkpoint.predictionSha256 = checkpointRecords[0].sha256;

  const firstAsset = assetManifest.assets[0];
  const originalAssetBytes = await readFile(join(scratch, firstAsset.path));
  const staleAssetBytes = Buffer.from(originalAssetBytes.toString('utf8')
    .replace('   0.000   0.000   0.000', '   4.000   0.000   0.000'));
  assert.notEqual(sha256(staleAssetBytes), sha256(originalAssetBytes));
  await writeFile(join(scratch, firstAsset.path), staleAssetBytes);
  firstAsset.sha256 = sha256(staleAssetBytes);
  story.scenes[steps[0]].models[0].sha256 = firstAsset.sha256;
  await rewriteAssetManifestStoryAndDeclaration();
  await assert.rejects(() => verifySos1Publication({ root:scratch }),
    /differs from its frozen checkpoint/);
  await writeFile(join(scratch, firstAsset.path), originalAssetBytes);
  firstAsset.sha256 = sha256(originalAssetBytes);
  story.scenes[steps[0]].models[0].sha256 = firstAsset.sha256;

  story.cues[0].checkpoint.sourceActionSequence += 1;
  await rewriteAssetManifestStoryAndDeclaration();
  await assert.rejects(() => verifySos1Publication({ root:scratch }),
    /does not identify one source Chemist Action|does not match its source Chemist Action/);
  story.cues[0].checkpoint.sourceActionSequence -= 1;
  await rewriteStoryAndDeclaration();

  declaration.integration.applicationSource = 'decoy.js';
  await writeFile(join(scratch, 'decoy.js'), appSource);
  await writeJson(descriptorPath, declaration);
  await assert.rejects(() => verifySos1Publication({ root:scratch }),
    /hard-coded production integration files/);
  declaration.integration.applicationSource = 'app.js';
  await writeJson(descriptorPath, declaration);

  await writeFile(join(scratch, 'scripts/build-web.mjs'),
    `${buildSource}\n// sos1-growth-clash-v7 must never return\n`);
  await assert.rejects(() => verifySos1Publication({ root:scratch }),
    /legacy SOS1 asset sos1-growth-clash-v7/);
  await writeFile(join(scratch, 'scripts/build-web.mjs'), buildSource);

  console.log('SOS1 publication preflight: PASS');
} finally {
  await rm(scratch, { recursive:true, force:true });
}
