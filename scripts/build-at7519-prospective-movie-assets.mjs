import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generated = join(root, 'design-history/structures/generated');
const runDirectory = join(root, 'outputs/design-history/at7519-hit-only-prospective');
const reviewPath = join(root,
  'outputs/design-history/at7519-preapproval/review/data.json');
const campaignPath = join(generated, 'at7519-prospective-campaign.json');
const evaluationPath = join(generated, 'at7519-holdout-evaluation.json');
const outputPath = join(generated, 'at7519-prospective-movie-assets.json');
const pocketPath = join(generated, 'at7519-2vta-pocket.pdb');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const input = async (path) => {
  const bytes = await readFile(path);
  return { path:relative(root, path), sha256:sha256(bytes), bytes:bytes.length };
};
const emit = async (path, text, role) => {
  const bytes = Buffer.from(text.endsWith('\n') ? text : `${text}\n`);
  await writeFile(path, bytes);
  return { path:relative(root, path), role, sha256:sha256(bytes), bytes:bytes.length };
};

await mkdir(generated, { recursive:true });
const campaign = JSON.parse(await readFile(campaignPath, 'utf8'));
const evaluation = JSON.parse(await readFile(evaluationPath, 'utf8'));
const manifest = JSON.parse(await readFile(join(runDirectory, 'prediction-manifest.json'), 'utf8'));
const review = JSON.parse(await readFile(reviewPath, 'utf8'));
if (campaign.id !== 'cdk2-at7519-hit-only'
  || evaluation.status !== 'post-freeze-evaluated'
  || manifest.status !== 'predictions-frozen-holdouts-unopened')
  throw new Error('AT7519 campaign must be frozen and post-freeze evaluated before movie assets');
if (evaluation.results.length !== 5 || manifest.checkpoints.length !== 5)
  throw new Error('AT7519 movie requires all five decisions');

const assets = [];
assets.push(await emit(pocketPath, review.receptor.pocketPdb,
  'fixed-2VTA-pocket'));
for (const path of ['at7519-2vta-protein.pdb', 'at7519-2vta-ligand.pdb']) {
  const absolute = join(generated, path);
  assets.push({ ...(await input(absolute)),
    role:path.endsWith('protein.pdb') ? 'fixed-2VTA-protein' : 'starting-hit-ligand' });
}
for (const asset of evaluation.emittedAssets) {
  const absolute = join(root, asset.path);
  const checked = await input(absolute);
  if (checked.sha256 !== asset.sha256 || checked.bytes !== asset.bytes)
    throw new Error(`Evaluated asset changed: ${asset.path}`);
  assets.push({ ...checked, role:`${asset.role}-ligand` });
}

const states = [{
  sequenceIndex:0, stateId:'compound-6', compound:'6', pdbId:'2VTA',
  coordinateClass:'allowed-input', ligandAsset:'at7519-2vta-ligand.pdb',
  biochemicalPotency:'CDK2 IC50 185 uM',
}];
for (const result of evaluation.results) states.push({
  sequenceIndex:result.sequenceIndex,
  stepId:result.stepId, stateId:result.stateId,
  predictionAsset:result.assets.prediction.replace('design-history/structures/generated/', ''),
  holdoutAsset:result.assets.holdout.replace('design-history/structures/generated/', ''),
  holdoutPdbId:result.holdout.pdbId,
  receptorCaRmsdAngstrom:result.holdout.alignedProteinCaRmsdAngstrom,
  poseMetrics:result.metrics,
});

const payload = {
  schema:'molarium.at7519-prospective-movie-assets/v1',
  campaignId:'cdk2-at7519-hit-only',
  scientificStatus:'protocol-isolated prospective replay with post-freeze crystal evaluation',
  boundary:{ coordinateInput:'2VTA only before prediction freeze',
    predictionsSequential:true, displayedReceptor:'fixed 2VTA',
    laterReceptorsDisplayed:false, sideChainMotion:false,
    ligandGrammar:'exactly one ligand model per scene' },
  states,
  inputs:await Promise.all([
    input(campaignPath), input(evaluationPath), input(reviewPath),
    input(join(runDirectory, 'prediction-manifest.json')),
    input(join(runDirectory, 'chemist-action-audit.json')),
  ]),
  assets,
  limitations:evaluation.limitations,
};
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${relative(root, outputPath)} with ${assets.length} pinned scene assets`);
