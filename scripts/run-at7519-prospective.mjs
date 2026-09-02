import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
};
const requestedStop = valueFor('--stop-after');
const allSteps = ['scaffold-hop', 'grow-acetamide', 'grow-benzamide',
  'lock-difluoro-torsion', 'finish-at7519'];
const stopIndex = requestedStop ? allSteps.indexOf(requestedStop) : allSteps.length - 1;
if (stopIndex < 0) throw new Error(`Unknown --stop-after step: ${requestedStop}`);
const stepIds = allSteps.slice(0, stopIndex + 1);
const output = resolve(root, valueFor('--output')
  || 'outputs/design-history/at7519-hit-only-prospective');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const coordinateDigest = (inspection) => digest(Buffer.from(JSON.stringify(
  inspection.atoms.map(({ atomId, element, coordinatesAngstrom }) =>
    [atomId, element, coordinatesAngstrom]))));
await mkdir(output, { recursive:true });

const browser = await startMolariumBrowser({ root,
  appPath:'?prospective=cdk2-at7519-hit-only', width:1600, height:1000 });
const execute = (action, actionArgs = {}, requestId = action) => browser.evaluate(
  `window.MolariumChemistActions.execute(${JSON.stringify({
    action, args:actionArgs, requestId,
  })})`);
const checkpoints = [];

try {
  await waitFor(async () => browser.evaluate(
    `window.MolariumChemistActions?.schema==='molarium.chemist-actions/v1'`),
  90000, 'public Chemist Actions API');
  const description = await browser.evaluate(`window.MolariumChemistActions.describe()`);
  for (const action of ['designCampaign.load', 'designCampaign.applyStep',
    'designCampaign.inspect', 'protein.prepare', 'pose.captureReference', 'pose.refine',
    'pose.apply', 'protein.parameterize', 'session.inspect']) {
    if (!description.actions[action]) throw new Error(`Public action is missing: ${action}`);
  }

  await execute('designCampaign.load', { campaignId:'cdk2-at7519-hit-only' },
    'at7519-campaign-load-hit');
  await execute('view.setMode', { mode:'build' }, 'at7519-campaign-enter-build');
  console.log('campaign: preparing registered 2VTA/LZ1 hit complex');
  await execute('protein.prepare', {
    pH:7.4, histidine:'auto', repairMissingHeavy:true,
    ligandPolicy:'ccd', waterPolicy:'retain', gapPolicy:'cap',
  }, 'at7519-campaign-prepare-hit');
  await execute('pose.captureReference', { mode:'propagate' },
    'at7519-campaign-capture-hit');
  const boundary = await execute('designCampaign.inspect', {},
    'at7519-campaign-inspect-boundary');
  const initialReceptorProbe = await execute('session.inspect', {
    scope:'all', includeCoordinates:true, maximumAtoms:500,
  }, 'at7519-freeze-initial-receptor-probe');
  const initialReceptorSha256 = coordinateDigest(initialReceptorProbe.result);

  for (let stepIndex = 0; stepIndex < stepIds.length; stepIndex++) {
    const stepId = stepIds[stepIndex];
    console.log(`${stepId}: staging graph against preceding frozen prediction`);
    const staged = await execute('designCampaign.applyStep', { stepId }, `${stepId}-stage`);
    console.log(`${stepId}: fixed-2VTA pose search`);
    const refined = await execute('pose.refine', { searchChains:64 },
      `${stepId}-pose-refine`);
    const selectedIndex = Math.max(0,
      Number(refined.result.refinement.selectedRank || 1) - 1);
    await execute('pose.apply', { index:selectedIndex }, `${stepId}-pose-apply`);
    const parameterized = await execute('protein.parameterize', {},
      `${stepId}-parameterize-without-motion`);
    const ligand = await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:256,
    }, `${stepId}-freeze-ligand`);
    const pocket = await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, `${stepId}-freeze-pocket`);
    const receptorProbe = await execute('session.inspect', {
      scope:'all', includeCoordinates:true, maximumAtoms:500,
    }, `${stepId}-freeze-receptor-probe`);
    const current = await execute('designCampaign.inspect', {}, `${stepId}-inspect-state`);
    const receptorSha256 = coordinateDigest(receptorProbe.result);
    if (receptorSha256 !== initialReceptorSha256)
      throw new Error(`${stepId}: fixed 2VTA receptor coordinates changed`);
    const checkpoint = {
      schema:'molarium.design-prediction-checkpoint/v1',
      campaignId:'cdk2-at7519-hit-only', stepId,
      referenceStateId:staged.result.designStep.referenceStateId,
      predictedStateId:staged.result.designStep.stateId,
      frozenBeforeHoldoutAccess:true,
      receptorPolicy:{ source:'2VTA only', conformation:'fixed',
        sideChainMotion:'disabled', coordinateProbeAtoms:receptorProbe.result.atoms.length,
        coordinateSha256:receptorSha256 },
      boundary:boundary.result.designCampaign,
      state:current.result.designCampaign,
      staging:staged.result.designStep,
      refinement:refined.result.refinement,
      parameterization:parameterized.result.parameterization,
      ligand:ligand.result,
      pocket:pocket.result,
    };
    const bytes = Buffer.from(`${JSON.stringify(checkpoint, null, 2)}\n`);
    const filename = `${stepId}-prediction.json`;
    await writeFile(join(output, filename), bytes);
    checkpoints.push({ stepId, predictedStateId:checkpoint.predictedStateId,
      filename, sha256:digest(bytes), bytes:bytes.length,
      ligandCoordinateSha256:coordinateDigest(ligand.result),
      receptorCoordinateSha256:receptorSha256,
      freezeActionSequence:pocket.sequence });
    console.log(`${stepId}: frozen ${digest(bytes).slice(0, 12)}`);

    if (stepIndex < stepIds.length - 1) {
      await execute('view.setMode', { mode:'build' }, `${stepId}-advance-build`);
      await execute('pose.captureReference', { mode:'propagate' },
        `${stepId}-capture-predicted-reference`);
    }
  }

  const audit = await browser.evaluate(`window.MolariumChemistActions.history()`);
  const auditBytes = Buffer.from(`${JSON.stringify({
    schema:description.schema, campaignId:'cdk2-at7519-hit-only', records:audit,
  }, null, 2)}\n`);
  await writeFile(join(output, 'chemist-action-audit.json'), auditBytes);
  const campaignPath = join(root,
    'design-history/structures/generated/at7519-prospective-campaign.json');
  const runnerPath = fileURLToPath(import.meta.url);
  const manifest = {
    schema:'molarium.design-prediction-run/v1',
    campaignId:'cdk2-at7519-hit-only',
    status:'predictions-frozen-holdouts-unopened',
    protocol:{ initialCoordinateInput:'PDB 2VTA/LZ1 only',
      sequentialPredictedReferences:true, receptorConformation:'fixed-2VTA',
      sideChainMotion:'disabled', holdoutCoordinateReads:0 },
    checkpoints,
    agentApi:{ schema:description.schema, actions:Object.keys(description.actions),
      auditRecords:audit.length, auditSha256:digest(auditBytes) },
    inputs:{ campaign:{ path:relative(root, campaignPath),
      sha256:digest(await readFile(campaignPath)) },
      runner:{ path:relative(root, runnerPath), sha256:digest(await readFile(runnerPath)) } },
  };
  await writeFile(join(output, 'prediction-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${relative(root, join(output, 'prediction-manifest.json'))}`);
} finally {
  await browser.close();
}
