#!/usr/bin/env bun
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
import { verifySos1AwwReceptorOnlyRun, sha256 } from './sos1-aww-receptor-only-publication.mjs';
import { finalDiagnosticGate } from './sos1-final-step-checkpoint.mjs';
import { fixedAtomRelaxationGate } from './recover-sos1-final-from-full-system-checkpoint.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [sourceArg, outputArg] = process.argv.slice(2);
assert(sourceArg && outputArg,
  'Usage: bun scripts/continue-sos1-axh-from-designer-intent.browser.mjs <AWW-run> <new-output>');
const source = await verifySos1AwwReceptorOnlyRun(resolve(root, sourceArg),
  { root, requireAccepted:false });
const output = resolve(root, outputArg);
assert(output.startsWith(`${root}/outputs/`), 'Output must be inside repository outputs');
await mkdir(output); // Immutable attempt: deliberately fail if it already exists.
const save = async (name, value) => {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(join(output, name), bytes, { flag:'wx' });
  return { filename:name, bytes:bytes.length, sha256:sha256(bytes) };
};
const input = source.checkpoints.receptorResponse;
const inputPath = relative(root, join(source.directory, input.record.filename));
const boundary = await save('boundary.json', {
  schema:'molarium.sos1-reference-informed-axh-continuation/v1',
  declaredBeforeCompute:true, designerIntentReferenceInformed:true,
  externalReferenceCoordinatesUsed:false,
  sourceRun:source.runId, sourceCampaignSha256:sha256(input.bytes),
  sourceValidationAccepted:source.validation.accepted,
  sourceFailedChecks:source.validation.failedChecks,
  intent:'registered attachment rewrite; preserve proximal atom lineage and the existing distal spatial feature',
  coordinateSource:'exact native full-system AWW campaign; no reconstruction from inspection records',
  searchChains:8, featureSeedingProtocol:'v5',
  refinement:'native public pose.refine with registered spatial-feature gate',
  relaxation:'native induced-fit-webgpu with fixed-atom and registered-feature gates',
  sourceWaterPolicy:'source waters retained; no water-deletion actions',
});
let browser = null, phase = 'initialization';
const inspections = {}, checkpoints = {};
const inspect = async (name) => {
  const result = {};
  for (const [scope, maximumAtoms] of [['ligand',256], ['pocket',500]]) {
    result[scope] = (await execute('session.inspect',
      { scope, includeCoordinates:true, maximumAtoms }, `${name}-${scope}`)).result;
    assert.equal(result[scope].truncated, false);
  }
  inspections[name] = result;
  await save(`${name}-coordinates.json`, result);
  return result;
};
let actionNumber = 0;
const execute = async (action, args = {}, label = action) => {
  const result = await browser.evaluate(`window.MolariumChemistActions.execute(${JSON.stringify({
    action, args, requestId:`axh-continuation-${++actionNumber}-${label}`,
  })})`);
  assert.equal(result.status, 'completed', `${action} failed`);
  console.log(`AXH ${actionNumber} ${action}`);
  return result;
};
const freeze = async (name, message) => {
  const commit = (await execute('campaign.commitCurrent', { message, label:message,
    tags:['sos1','reference-informed','AXH','finish-bay-293',name] })).result.campaignCommit;
  assert.equal((await execute('campaign.verify')).result.campaignVerification.valid, true);
  const exported = (await execute('campaign.export')).result.campaignExport;
  checkpoints[name] = { ...commit, ...(await save(`${name}-campaign.json`, Buffer.from(exported.serialized))) };
};
try {
  browser = await startMolariumBrowser({ root, appPath:'?blank=1', width:1200, height:800 });
  await waitFor(() => browser.evaluate('Boolean(window.MolariumChemistActionsReady)'), 90000, 'API');
  await browser.evaluate('window.MolariumChemistActionsReady.then(() => true)');
  await execute('campaign.import', { sourcePath:`./${inputPath}`, sourceSha256:sha256(input.bytes) });
  assert.equal((await execute('campaign.verify')).result.campaignVerification.valid, true);
  await execute('designRoute.resume', { routeId:'sos1-hit-only', stateId:'AWW' });
  assert.equal((await execute('protein.parameterize')).result.parameterization.maximumCoordinateDisplacementAngstrom, 0);
  await execute('view.setMode', { mode:'build' });
  await execute('pose.setDesignerLigandPoseFixed', { fixed:false });
  await execute('pose.captureReference', { mode:'propagate' });
  await inspect('source-aww');
  phase = 'graph-edit';
  const staged = (await execute('designRoute.applyStep', { stepId:'finish-bay-293' })).result.designStep;
  assert.equal(staged.referenceStateId, 'AWW');
  assert.equal(staged.stateId, 'AXH');
  const featureIds = staged.poseTransferPlan.featureCorrespondences.filter((entry) => entry.required)
    .map((entry) => entry.id);
  assert(featureIds.length > 0, 'No required distal spatial feature');
  await inspect('graph-only');
  await freeze('graph-only', 'AXH graph edit before native retained-feature refinement');
  phase = 'refinement';
  const refinement = (await execute('pose.refine',
    { searchChains:8, execution:'serial', featureSeedingProtocol:'v5' })).result.refinement;
  await save('refinement.json', refinement);
  const gate = finalDiagnosticGate(refinement, featureIds);
  await save('candidate-gate.json', gate);
  assert.equal(gate.passed, true, 'Native AXH selector failed its retained-feature or feasibility gate');
  await execute('pose.apply', { index:Math.max(0, Number(refinement.selectedRank || 1) - 1) });
  const before = await inspect('selected');
  await freeze('selected', 'AXH selected pose before coupled relaxation');
  assert.equal((await execute('protein.parameterize')).result.parameterization.maximumCoordinateDisplacementAngstrom, 0);
  phase = 'relaxation';
  const optimization = (await execute('optimization.run', { method:'induced-fit-webgpu' })).result.optimization;
  await save('optimization.json', optimization);
  const after = await inspect('relaxed');
  assert.equal(optimization.accepted, true);
  assert.equal(optimization.valenceSafeguard?.accepted, true);
  assert.equal(optimization.valenceSafeguard?.complete, true);
  assert.equal(optimization.registeredPoseRetention?.accepted, true);
  const fixed = fixedAtomRelaxationGate({ before:before.pocket, after:after.pocket,
    fixedAtomIds:optimization.registeredPoseRetention.before.fixedAtomIds });
  await save('fixed-atom-gate.json', fixed);
  assert.equal(fixed.passed, true);
  await freeze('finish-bay-293', 'Freeze AXH continuation from reference-informed AWW designer intent');
  phase = 'completed';
} catch (error) {
  try { if (browser) await inspect('failure'); } catch { /* Keep original error. */ }
  await save('failed-run.json', { phase, boundary, checkpoints,
    error:{ message:String(error.message || error), stack:String(error.stack || '') } });
  throw error;
} finally {
  let records = [];
  try { records = await browser?.evaluate('window.MolariumChemistActions?.history?.() || []') || []; } catch {}
  const audit = await save('chemist-action-audit.json', { status:phase, records });
  await save('continuation-manifest.json', { status:phase, boundary, audit, checkpoints,
    designerIntentReferenceInformed:true, externalReferenceCoordinatesUsed:false,
    runnerSha256:sha256(await readFile(fileURLToPath(import.meta.url))) });
  await browser?.close();
}
