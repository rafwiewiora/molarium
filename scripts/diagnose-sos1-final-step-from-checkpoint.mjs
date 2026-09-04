import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
import {
  SOS1_FINAL_DIAGNOSTIC_SCHEMA,
  campaignFromFrozenOpenPocketCheckpoint,
  finalDiagnosticGate,
  readFrozenOpenPocketCheckpoint,
  sha256,
} from './sos1-final-step-checkpoint.mjs';
import { validateRegisteredDesignRoute } from
  '../design-history/structures/design-route.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const route = JSON.parse(await readFile(join(root,
  'design-history/structures/generated/sos1-prospective-campaign.json'), 'utf8'));
const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
};
const checkpointArg = valueFor('--checkpoint');
const outputArg = valueFor('--output');
if (!checkpointArg || !outputArg) throw new Error(
  'Usage: bun scripts/diagnose-sos1-final-step-from-checkpoint.mjs --checkpoint <open-phe890-pocket-prediction.json> --output <new-directory> [--search-chains 8|16|32|64]');
const checkpointPath = resolve(process.cwd(), checkpointArg);
const output = resolve(process.cwd(), outputArg);
const searchChains = Number(valueFor('--search-chains') || 8);
if (![8,16,32,64].includes(searchChains))
  throw new Error('--search-chains must be 8, 16, 32, or 64');
try {
  await access(output);
  throw new Error(`Refusing to overwrite immutable attempt directory: ${output}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(output, { recursive:false });
validateRegisteredDesignRoute(route);

const frozen = await readFrozenOpenPocketCheckpoint(checkpointPath, route);
const restored = await campaignFromFrozenOpenPocketCheckpoint(
  frozen.checkpoint, route, frozen);
await writeFile(join(output, 'resume-campaign.json'), restored.serialized);
await writeFile(join(output, 'diagnostic-boundary.json'), `${JSON.stringify({
  schema:SOS1_FINAL_DIAGNOSTIC_SCHEMA,
  status:'declared-before-compute', diagnosticOnly:true, promotable:false,
  holdoutCoordinatesUsed:false,
  sourceCheckpoint:{ path:relative(root, checkpointPath),
    sha256:frozen.checkpointSha256, stepId:'open-phe890-pocket', stateId:'AWW',
    frozenBeforeHoldoutAccess:true },
  restoredLocalPocket:restored.molecule.diagnosticBoundary,
  limitation:'The final selector is tested against the exact frozen local pocket, but the fixed outer receptor omitted by session.inspect is not reconstructed.',
  authorization:'Only public Molarium Chemist Actions may mutate browser state.',
}, null, 2)}\n`);

const browser = await startMolariumBrowser({ root,
  appPath:'?prospective=sos1-hit-only', width:1200, height:800 });
const execute = (action, actionArgs = {}, requestId = action) => browser.evaluate(
  `window.MolariumChemistActions.execute(${JSON.stringify({
    action, args:actionArgs, requestId,
  })})`);
const saveJson = (name, value) => writeFile(join(output, name),
  `${JSON.stringify(value, null, 2)}\n`);
let refinement = null, gate = null, phase = 'browser-start';

async function publicHistory() {
  try { return await browser.evaluate('window.MolariumChemistActions?.history?.() || []'); }
  catch { return []; }
}

try {
  await waitFor(async () => browser.evaluate(
    'Boolean(window.MolariumChemistActions)'), 90000, 'Molarium Chemist Actions API');

  phase = 'campaign-import';
  await execute('campaign.import', { serialized:restored.serialized },
    'diagnostic-import-frozen-aww-pocket');
  const verification = await execute('campaign.verify', {},
    'diagnostic-verify-frozen-aww-pocket');
  assert.equal(verification.result.campaignVerification.valid, true);
  await execute('designRoute.resume', { routeId:route.id, stateId:'AWW' },
    'diagnostic-resume-aww-route');
  await execute('view.setMode', { mode:'build' }, 'diagnostic-enter-design');

  phase = 'reference-parameterization';
  const parameterization = await execute('protein.parameterize', {},
    'diagnostic-parameterize-local-aww-pocket');
  await execute('pose.captureReference', { mode:'propagate' },
    'diagnostic-capture-aww-reference');
  const beforeLigand = await execute('session.inspect', {
    scope:'ligand', includeCoordinates:true, maximumAtoms:256,
  }, 'diagnostic-inspect-aww-ligand');
  const beforePocket = await execute('session.inspect', {
    scope:'pocket', includeCoordinates:true, maximumAtoms:500,
  }, 'diagnostic-inspect-aww-pocket');

  phase = 'final-graph-staging';
  const staged = await execute('designRoute.applyStep', {
    stepId:'finish-bay-293',
  }, 'diagnostic-stage-final-axh');
  const requiredFeatures = (staged.result.designStep.poseTransferPlan
    ?.featureCorrespondences || []).filter((feature) => feature.required === true);
  assert(requiredFeatures.length > 0,
    'the registered final step has no required spatial feature');
  const stagedLigand = await execute('session.inspect', {
    scope:'ligand', includeCoordinates:true, maximumAtoms:256,
  }, 'diagnostic-inspect-staged-axh');
  await saveJson('staging.json', { designStep:staged.result.designStep,
    ligandBefore:beforeLigand.result, ligandAfter:stagedLigand.result });

  phase = 'final-pose-refinement';
  const refined = await execute('pose.refine', {
    searchChains, execution:'serial', featureSeedingProtocol:'v5',
  }, 'diagnostic-refine-final-axh');
  refinement = refined.result.refinement;
  gate = finalDiagnosticGate(refinement, requiredFeatures.map((entry) => entry.id));
  // Save every candidate before any scientific acceptance assertion.
  await saveJson('refinement.json', refinement);
  await saveJson('candidate-gate.json', gate);
  if (!gate.passed) throw new Error(
    `Final diagnostic selector failed closed: feasible=${gate.selectedFeasible}, missing=${gate.missingRequiredFeatureIds.join(',') || 'none'}, unsatisfied=${gate.unsatisfiedRequiredFeatureIds.join(',') || 'none'}`);

  phase = 'selected-pose-apply';
  const selectedIndex = Math.max(0, Number(refinement.selectedRank || 1) - 1);
  await execute('pose.apply', { index:selectedIndex },
    'diagnostic-apply-selected-final-axh');
  const afterLigand = await execute('session.inspect', {
    scope:'ligand', includeCoordinates:true, maximumAtoms:256,
  }, 'diagnostic-inspect-selected-axh-ligand');
  const afterPocket = await execute('session.inspect', {
    scope:'pocket', includeCoordinates:true, maximumAtoms:500,
  }, 'diagnostic-inspect-selected-axh-pocket');
  const designRoute = await execute('designRoute.inspect', {},
    'diagnostic-inspect-final-route');
  const history = await publicHistory();
  await saveJson('chemist-action-audit.json', {
    schema:'molarium.chemist-actions/v1', routeId:route.id,
    status:'diagnostic-passed', records:history,
  });
  await saveJson('diagnostic-result.json', {
    schema:SOS1_FINAL_DIAGNOSTIC_SCHEMA,
    status:'passed', diagnosticOnly:true, promotable:false,
    holdoutCoordinatesUsed:false, searchChains,
    sourceCheckpointSha256:frozen.checkpointSha256,
    campaignSha256:sha256(Buffer.from(restored.serialized)),
    parameterization:parameterization.result.parameterization,
    gate, designRoute:designRoute.result.designRoute,
    ligand:afterLigand.result, pocket:afterPocket.result,
    referencePocket:beforePocket.result,
  });
  console.log(`Final-step local-pocket diagnostic passed; artifacts: ${relative(root, output)}`);
} catch (error) {
  const history = await publicHistory();
  await saveJson('chemist-action-audit.json', {
    schema:'molarium.chemist-actions/v1', routeId:route.id,
    status:'diagnostic-failed', records:history,
  });
  await saveJson('failed-run.json', {
    schema:SOS1_FINAL_DIAGNOSTIC_SCHEMA,
    status:'failed', diagnosticOnly:true, promotable:false,
    holdoutCoordinatesUsed:false, phase, searchChains,
    sourceCheckpointSha256:frozen.checkpointSha256,
    error:{ name:String(error?.name || 'Error'),
      message:String(error?.message || error), stack:String(error?.stack || '') },
    refinement, candidateGate:gate,
    auditRecordCount:history.length,
    lastAuditRecord:history.at(-1) || null,
  });
  console.error(`Final-step diagnostic failed closed in ${phase}; failure evidence preserved`);
  throw error;
} finally {
  await browser.close();
}
