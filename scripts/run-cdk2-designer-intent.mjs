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
const output = resolve(root, valueFor('--output')
  || 'outputs/design-history/cdk2-designer-intent-success');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const stepIds = ['add-meta-chloro', 'replace-chloro-with-sulfonamide'];
await mkdir(output, { recursive:true });

const browser = await startMolariumBrowser({ root,
  appPath:'?prospective=cdk2-designer-intent', width:1600, height:1000 });
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
  for (const action of ['designRoute.load', 'designRoute.applyStep',
    'designRoute.inspect', 'protein.prepare', 'pose.captureReference', 'pose.refine',
    'pose.apply', 'protein.parameterize', 'session.inspect']) {
    if (!description.actions[action]) throw new Error(`Public action is missing: ${action}`);
  }

  await execute('designRoute.load', { routeId:'cdk2-designer-intent' },
    'designer-route-load-hit');
  await execute('view.setMode', { mode:'build' }, 'designer-route-enter-build');
  await execute('protein.prepare', {
    pH:7.4, histidine:'auto', repairMissingHeavy:true,
    ligandPolicy:'ccd', waterPolicy:'retain', gapPolicy:'cap',
  }, 'designer-route-prepare-hit');
  await execute('pose.captureReference', { mode:'propagate' },
    'designer-route-capture-hit');
  const boundary = await execute('designRoute.inspect', {},
    'designer-route-inspect-boundary');

  for (let stepIndex = 0; stepIndex < stepIds.length; stepIndex++) {
    const stepId = stepIds[stepIndex];
    const currentLigand = await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:256,
    }, `${stepId}-inspect-designer-exit-vector`);
    const attachment = currentLigand.result.atoms.find((atom) =>
      atom.element !== 'H' && atom.atomName === 'C19');
    if (!attachment) throw new Error(`${stepId}: designer exit-vector atom C19 is unavailable`);
    console.log(`${stepId}: growing from selected ${attachment.atomName}`);
    const staged = await execute('designRoute.applyStep', {
      stepId, attachmentAtomId:attachment.atomId,
    }, `${stepId}-designer-stage`);
    if (staged.result.designStep.spatialIntent?.attachmentAtomId !== attachment.atomId)
      throw new Error(`${stepId}: staged result did not preserve designer intent`);
    const refined = await execute('pose.refine', { searchChains:64 },
      `${stepId}-designer-pose-refine`);
    const selectedIndex = Math.max(0,
      Number(refined.result.refinement.selectedRank || 1) - 1);
    await execute('pose.apply', { index:selectedIndex }, `${stepId}-designer-pose-apply`);
    const parameterized = await execute('protein.parameterize', {},
      `${stepId}-designer-parameterize-without-motion`);
    const ligand = await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:256,
    }, `${stepId}-designer-freeze-ligand`);
    const pocket = await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, `${stepId}-designer-freeze-pocket`);
    const current = await execute('designRoute.inspect', {},
      `${stepId}-designer-inspect-state`);
    const checkpoint = {
      schema:'molarium.design-prediction-checkpoint/v1',
      routeId:'cdk2-designer-intent', stepId,
      referenceStateId:staged.result.designStep.referenceStateId,
      predictedStateId:staged.result.designStep.stateId,
      designerIntentDeclaredBeforePoseSearch:true,
      boundary:boundary.result.designRoute,
      state:current.result.designRoute,
      staging:staged.result.designStep,
      refinement:refined.result.refinement,
      parameterization:parameterized.result.parameterization,
      ligand:ligand.result, pocket:pocket.result,
    };
    const bytes = Buffer.from(`${JSON.stringify(checkpoint, null, 2)}\n`);
    const filename = `${stepId}-prediction.json`;
    await writeFile(join(output, filename), bytes);
    checkpoints.push({ stepId, predictedStateId:checkpoint.predictedStateId,
      filename, sha256:digest(bytes), bytes:bytes.length,
      attachmentAtomId:attachment.atomId, attachmentAtomName:attachment.atomName,
      freezeActionSequence:pocket.sequence });
    console.log(`${stepId}: frozen ${digest(bytes).slice(0, 12)}`);

    if (stepIndex < stepIds.length - 1) {
      await execute('view.setMode', { mode:'build' }, `${stepId}-designer-advance-build`);
      await execute('pose.captureReference', { mode:'propagate' },
        `${stepId}-designer-capture-predicted-reference`);
    }
  }

  const audit = await browser.evaluate(`window.MolariumChemistActions.history()`);
  const auditBytes = Buffer.from(`${JSON.stringify({
    schema:description.schema, routeId:'cdk2-designer-intent', records:audit,
  }, null, 2)}\n`);
  await writeFile(join(output, 'chemist-action-audit.json'), auditBytes);
  const campaignPath = join(root,
    'design-history/structures/generated/cdk2-designer-route.json');
  const runnerPath = fileURLToPath(import.meta.url);
  const manifest = {
    schema:'molarium.design-prediction-run/v1', routeId:'cdk2-designer-intent',
    status:'designer-directed-predictions-frozen',
    protocol:{ initialCoordinateInput:'PDB 1H1Q/2A6',
      designerAttachmentAtomName:'C19', sequentialPredictedReferences:true },
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
