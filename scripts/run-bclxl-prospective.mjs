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
const requestedStep = valueFor('--step');
const relaxMethod = valueFor('--relax') || 'induced-fit-webgpu';
const stepIds = requestedStep ? [requestedStep]
  : ['compound-6', 'compound-7', 'compound-16', 'compound-21'];
const output = resolve(root, valueFor('--output')
  || 'outputs/design-history/bclxl-hit-only-prospective');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir(output, { recursive:true });

const browser = await startMolariumBrowser({ root, appPath:'?prospective=bclxl-hit-only',
  width:1600, height:1000 });
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
    'designCampaign.inspect', 'protein.prepare', 'pose.captureReference', 'pose.refine', 'pose.apply',
    'optimization.run', 'session.inspect']) {
    if (!description.actions[action]) throw new Error(`Public action is missing: ${action}`);
  }

  await execute('designCampaign.load', { campaignId:'bclxl-hit-only' }, 'campaign-load-hit');
  await execute('view.setMode', { mode:'build' }, 'campaign-enter-build');
  console.log('campaign: preparing the registered 3SPF hit complex');
  await execute('protein.prepare', {
    pH:7.4, histidine:'auto', repairMissingHeavy:true,
    ligandPolicy:'ccd', waterPolicy:'exclude', gapPolicy:'cap',
  }, 'campaign-prepare-hit');
  await execute('pose.captureReference', { mode:'propagate' }, 'campaign-capture-hit');
  const boundary = await execute('designCampaign.inspect', {}, 'campaign-inspect-boundary');

  for (const stepId of stepIds) {
    console.log(`${stepId}: staging graph against 3SPF hit`);
    const staged = await execute('designCampaign.applyStep', { stepId }, `${stepId}-stage`);
    console.log(`${stepId}: rigid-hit pose search`);
    const refined = await execute('pose.refine', { searchChains:64 }, `${stepId}-pose-refine`);
    const selectedIndex = Math.max(0,
      Number(refined.result.refinement.selectedRank || 1) - 1);
    await execute('pose.apply', { index:selectedIndex }, `${stepId}-pose-apply`);
    console.log(`${stepId}: hit-pocket ${relaxMethod} relaxation`);
    const relaxed = await execute('optimization.run',
      { method:relaxMethod }, `${stepId}-pocket-relax`);
    const pocket = await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, `${stepId}-freeze-pocket`);
    const checkpoint = {
      schema:'molarium.design-prediction-checkpoint/v1',
      campaignId:'bclxl-hit-only', stepId,
      frozenBeforeHoldoutAccess:true,
      boundary:boundary.result.designCampaign,
      staging:staged.result.designStep,
      refinement:refined.result.refinement,
      relaxation:relaxed.result.optimization,
      pocket:pocket.result,
    };
    const bytes = Buffer.from(`${JSON.stringify(checkpoint, null, 2)}\n`);
    const filename = `${stepId}-prediction.json`;
    await writeFile(join(output, filename), bytes);
    checkpoints.push({ stepId, filename, sha256:digest(bytes), bytes:bytes.length,
      freezeActionSequence:pocket.sequence });
    console.log(`${stepId}: frozen ${digest(bytes).slice(0, 12)}`);
  }

  const audit = await browser.evaluate(`window.MolariumChemistActions.history()`);
  const auditBytes = Buffer.from(`${JSON.stringify({
    schema:description.schema, campaignId:'bclxl-hit-only', records:audit,
  }, null, 2)}\n`);
  await writeFile(join(output, 'chemist-action-audit.json'), auditBytes);
  const campaignPath = join(root,
    'design-history/structures/generated/bclxl-prospective-campaign.json');
  const runnerPath = fileURLToPath(import.meta.url);
  const manifest = {
    schema:'molarium.design-prediction-run/v1',
    campaignId:'bclxl-hit-only',
    status:'predictions-frozen-holdouts-unopened',
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
