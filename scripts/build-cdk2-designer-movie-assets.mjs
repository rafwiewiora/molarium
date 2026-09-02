import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyFrozenDesignRouteInput } from
  '../design-history/structures/design-route-provenance.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runDir = join(root, 'outputs/design-history/cdk2-designer-intent-success');
const generated = join(root, 'design-history/structures/generated');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = await readFile(join(runDir, 'prediction-manifest.json'));
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.campaignId, 'cdk2-designer-intent');
assert.equal(manifest.status, 'designer-directed-predictions-frozen');
assert.equal(manifest.protocol.designerAttachmentAtomName, 'C19');
const campaignPath = join(root, manifest.inputs.campaign.path);
const campaignBytes = await readFile(campaignPath);
const campaignInput = verifyFrozenDesignRouteInput(
  campaignBytes, manifest.inputs.campaign.sha256);
const campaign = JSON.parse(campaignBytes);
const auditBytes = await readFile(join(runDir, 'chemist-action-audit.json'));
assert.equal(digest(auditBytes), manifest.agentApi.auditSha256);
const audit = JSON.parse(auditBytes).records;
assert.equal(audit.length, manifest.agentApi.auditRecords);

const evaluationSummaryPath = join(runDir, 'holdout-evaluation-summary.json');
const evaluationSummaryBytes = await readFile(evaluationSummaryPath);
const evaluationSummary = JSON.parse(evaluationSummaryBytes);
assert.equal(evaluationSummary.campaignId, manifest.campaignId);
assert.equal(evaluationSummary.predictionManifestSha256, digest(manifestBytes));

const specs = [
  { stepId:'add-meta-chloro', residueName:'6CP',
    output:'cdk2-designer-6cp-prediction.pdb',
    holdout:'cdk2-1h1r-6cp-aligned-holdout.pdb' },
  { stepId:'replace-chloro-with-sulfonamide', residueName:'N76',
    output:'cdk2-designer-n76-prediction.pdb',
    holdout:'cdk2-1oiu-n76-aligned-holdout.pdb' },
];

function atomNameField(name, element) {
  const clean = String(name).slice(0, 4);
  if (clean.length === 4) return clean;
  return String(element).length === 1 ? ` ${clean.padEnd(3)}` : clean.padEnd(4);
}
function pdbAtom({ serial, atomName, residueName, point, element }) {
  const [x, y, z] = point;
  return `HETATM${String(serial).padStart(5)} ${atomNameField(atomName, element)} ${residueName.padStart(3).slice(-3)} A1298    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 20.00          ${String(element).padStart(2).slice(-2)}`;
}
const centroid = (points) => [0, 1, 2].map((axis) =>
  points.reduce((sum, point) => sum + point[axis], 0) / points.length);

const assets = [];
const editTargets = {};
for (const spec of specs) {
  const frozen = manifest.checkpoints.find((entry) => entry.stepId === spec.stepId);
  const step = campaign.steps.find((entry) => entry.id === spec.stepId);
  assert(frozen && step);
  const checkpointPath = join(runDir, frozen.filename);
  const checkpointBytes = await readFile(checkpointPath);
  assert.equal(digest(checkpointBytes), frozen.sha256);
  const checkpoint = JSON.parse(checkpointBytes);
  assert.equal(checkpoint.staging.spatialIntent.attachmentReferenceAtomName, 'C19');
  const evaluationPath = join(runDir, `${spec.stepId}-holdout-evaluation.json`);
  const evaluationBytes = await readFile(evaluationPath);
  const evaluation = JSON.parse(evaluationBytes);
  assert.equal(evaluation.boundary.frozenPredictionSha256, frozen.sha256);
  const offset = evaluation.ligand.predictionCenteringOffsetAngstrom;
  const heavyByName = new Map(checkpoint.ligand.atoms.filter((atom) => atom.element !== 'H')
    .map((atom) => [atom.atomName, atom]));
  const ordered = step.productAtomNames.map((name) => {
    const atom = heavyByName.get(name);
    assert(atom, `${spec.stepId}: atom ${name} missing`);
    return { ...atom, point:atom.coordinatesAngstrom.map((value, axis) => value - offset[axis]) };
  });
  const indexById = new Map(ordered.map((atom, index) => [atom.atomId, index + 1]));
  const lines = ordered.map((atom, index) => pdbAtom({ serial:index + 1,
    atomName:atom.atomName, residueName:spec.residueName, point:atom.point,
    element:atom.element }));
  for (const bond of checkpoint.ligand.bonds) {
    const first = indexById.get(bond.atomIds[0]), second = indexById.get(bond.atomIds[1]);
    if (first && second) lines.push(`CONECT${String(first).padStart(5)}${String(second).padStart(5)}`);
  }
  lines.push('END');
  const outputPath = join(generated, spec.output);
  await writeFile(outputPath, `${lines.join('\n')}\n`);
  const outputBytes = await readFile(outputPath);
  const editedIndices = step.posePropagationMap.addedProductAtoms
    .map((entry) => entry.productAtomIndex);
  editTargets[spec.stepId] = centroid(editedIndices.map((index) => ordered[index].point));
  assets.push({ path:relative(root, outputPath), role:'designer-directed-prediction',
    stepId:spec.stepId, sha256:digest(outputBytes), bytes:outputBytes.length });
  const holdoutPath = join(generated, spec.holdout);
  const holdoutBytes = await readFile(holdoutPath);
  assets.push({ path:relative(root, holdoutPath), role:'aligned-crystal-validation',
    stepId:spec.stepId, sha256:digest(holdoutBytes), bytes:holdoutBytes.length });
  assets.push({ path:relative(root, evaluationPath), role:'pose-evaluation',
    stepId:spec.stepId, sha256:digest(evaluationBytes), bytes:evaluationBytes.length });
}

for (const name of ['cdk2-1h1q-protein.pdb','cdk2-1h1q-pocket.pdb','cdk2-1h1q-ligand.pdb']) {
  const path = join(generated, name), bytes = await readFile(path);
  assets.push({ path:relative(root, path), role:'hit-derived',
    sha256:digest(bytes), bytes:bytes.length });
}

const movieManifest = {
  schema:'molarium.cdk2-designer-movie-assets/v1',
  campaignId:manifest.campaignId,
  scientificStatus:'designer-directed-hit-to-lead-success',
  claim:'A designer-selected C19 exit vector carries the 1H1Q hit pose through two Agent API design steps.',
  agentApi:{ auditSha256:digest(auditBytes), records:audit.length,
    attachmentAtomName:'C19', checkpoints:manifest.checkpoints },
  evaluation:evaluationSummary.results,
  editTargets,
  inputs:[
    { path:relative(root, campaignPath), sha256:digest(campaignBytes),
      ...(campaignInput.schemaMigration
        ? { schemaMigration:campaignInput.schemaMigration } : {}) },
    { path:relative(root, join(runDir, 'prediction-manifest.json')), sha256:digest(manifestBytes) },
    { path:relative(root, join(runDir, 'chemist-action-audit.json')), sha256:digest(auditBytes) },
    { path:relative(root, evaluationSummaryPath), sha256:digest(evaluationSummaryBytes) },
  ],
  assets,
};
const outputPath = join(generated, 'cdk2-designer-movie-assets.json');
await writeFile(outputPath, `${JSON.stringify(movieManifest, null, 2)}\n`);
console.log(JSON.stringify({ output:relative(root, outputPath), editTargets,
  evaluation:evaluationSummary.results }, null, 2));
