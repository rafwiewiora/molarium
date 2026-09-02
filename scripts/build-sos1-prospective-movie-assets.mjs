#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  alignModels,
  atomsForResidue,
  parsePdb,
  pocketResidues,
  rigidFit,
  subsetPdb,
} from '../design-history/structures/pipeline.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
};
const runDirectory = resolve(root, valueFor('--run')
  || 'outputs/design-history/sos1-hit-only-growth-clash-v7');
const reviewPath = resolve(root, valueFor('--review')
  || 'outputs/design-history/sos1-hit-only-growth-clash-v7/review/data.json');
const sourceDirectory = resolve(root, valueFor('--source-dir')
  || 'outputs/design-history/sos1-preapproval/source');
const generated = resolve(root, valueFor('--output') || 'design-history/structures/generated');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

const STEPS = Object.freeze([
  { id:'scaffold-rewrite', state:'awt', holdout:'5OVF' },
  { id:'fragment-merge', state:'awz', holdout:'5OVG' },
  { id:'open-phe890-pocket', state:'aww', holdout:'5OVH' },
  { id:'finish-bay-293', state:'axh', holdout:'5OVI' },
]);

function point(atom) { return [atom.x, atom.y, atom.z]; }
function vector(first, second) {
  return [second[0] - first[0], second[1] - first[1], second[2] - first[2]];
}
function dot(first, second) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}
function cross(first, second) {
  return [first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0]];
}
function unit(value) {
  const length = Math.hypot(...value);
  assert(length > 1e-8, 'Phe890 interpolation axis has zero length');
  return value.map((entry) => entry / length);
}
function normalizeDegrees(value) {
  let result = Number(value) % 360;
  if (result <= -180) result += 360;
  if (result > 180) result -= 360;
  return result;
}
function torsionDegrees(first, second, third, fourth) {
  const b0 = vector(second, first), b1 = vector(second, third), b2 = vector(third, fourth);
  const axis = unit(b1);
  const v = b0.map((value, index) => value - dot(b0, axis) * axis[index]);
  const w = b2.map((value, index) => value - dot(b2, axis) * axis[index]);
  return normalizeDegrees(Math.atan2(dot(cross(axis, v), w), dot(v, w)) * 180 / Math.PI);
}
function rotatePoint(value, origin, axis, radians) {
  const relative = value.map((entry, index) => entry - origin[index]);
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const perpendicular = cross(axis, relative), projection = dot(relative, axis);
  return origin.map((entry, index) => entry + relative[index] * cosine
    + perpendicular[index] * sine + axis[index] * projection * (1 - cosine));
}
function replaceCoordinates(model, coordinates, title) {
  const byLine = new Map(model.atoms.map((atom) => [atom.lineIndex, atom]));
  const lines = model.lines.map((line, lineIndex) => {
    const atom = byLine.get(lineIndex);
    if (!atom) return lineIndex === 0 && line.startsWith('HEADER')
      ? `HEADER    ${String(title).slice(0, 40).padEnd(40)}` : line;
    const value = coordinates.get(atom.atomName);
    assert(value, `Side-chain interpolation is missing ${atom.atomName}`);
    return `${line.slice(0, 30)}${value[0].toFixed(3).padStart(8)}`
      + `${value[1].toFixed(3).padStart(8)}${value[2].toFixed(3).padStart(8)}${line.slice(54)}`;
  });
  return `${lines.join('\n').replace(/\n+$/,'')}\n`;
}
function markerPdb(points, title) {
  const lines=[`HEADER    ${String(title).slice(0,40).padEnd(40)}`];
  for(const [index,[x,y,z]] of points.entries())lines.push(
    `HETATM${String(index+1).padStart(5)}  C${String(index+1).padEnd(2)} CLH M   1    `
      +`${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}`
      +'  1.00 20.00           C');
  lines.push('END');return `${lines.join('\n')}\n`;
}
function combinePdb(title, ...pdbTexts) {
  const atomLines = pdbTexts.flatMap((pdbText) => String(pdbText).split(/\r?\n/)
    .filter((line) => line.startsWith('ATOM') || line.startsWith('HETATM')));
  const lines = [`HEADER    ${String(title).slice(0, 40).padEnd(40)}`];
  for (const [index, line] of atomLines.entries()) {
    lines.push(`${line.slice(0, 6)}${String(index + 1).padStart(5)}${line.slice(11)}`);
  }
  lines.push('END');
  return `${lines.join('\n')}\n`;
}
function withLigandConnectivity(pdbText, ligandGraph) {
  const model = parsePdb(pdbText);
  const serialByAtomName = new Map(model.atoms.map((atom) => [atom.atomName, atom.serial]));
  const atomNameById = new Map(ligandGraph.atoms.map((atom) => [atom.atomId, atom.atomName]));
  const elementById = new Map(ligandGraph.atoms.map((atom) => [atom.atomId, atom.element]));
  const neighbors = new Map();
  for (const bond of ligandGraph.bonds) {
    const [firstId, secondId] = bond.atomIds;
    const first = serialByAtomName.get(atomNameById.get(firstId));
    const second = serialByAtomName.get(atomNameById.get(secondId));
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      assert(elementById.get(firstId) === 'H' || elementById.get(secondId) === 'H',
        `Ligand CONECT mapping failed for ${firstId} / ${secondId}`);
      continue;
    }
    if (!neighbors.has(first)) neighbors.set(first, new Set());
    if (!neighbors.has(second)) neighbors.set(second, new Set());
    neighbors.get(first).add(second);
    neighbors.get(second).add(first);
  }
  const lines = model.lines.filter((line) => line && line !== 'END' && !line.startsWith('CONECT'));
  for (const [serial, bonded] of [...neighbors].sort((a, b) => a[0] - b[0])) {
    const ordered = [...bonded].sort((a, b) => a - b);
    for (let offset = 0; offset < ordered.length; offset += 4) {
      lines.push(`CONECT${String(serial).padStart(5)}`
        + ordered.slice(offset, offset + 4).map((value) => String(value).padStart(5)).join(''));
    }
  }
  lines.push('END');
  return `${lines.join('\n')}\n`;
}
function aromaticSidechainIntermediate(startText, targetText, progress, ordinal,
  label, terminalAtomNames = []) {
  if (progress <= 0) return startText;
  if (progress >= 1) return targetText;
  const start = parsePdb(startText), target = parsePdb(targetText);
  const startByName = new Map(start.atoms.map((atom) => [atom.atomName, atom]));
  const targetByName = new Map(target.atoms.map((atom) => [atom.atomName, atom]));
  const backboneNames = ['N','CA','C','O','CB'];
  const blendedBackbone = backboneNames.map((name) => point(startByName.get(name))
    .map((value, axis) => value + (point(targetByName.get(name))[axis] - value) * progress));
  const fit = rigidFit(blendedBackbone,
    backboneNames.map((name) => point(startByName.get(name))));
  const coordinates = new Map(start.atoms.map((atom) => [atom.atomName, fit.transform(point(atom))]));
  const ring = ['CG','CD1','CD2','CE1','CE2','CZ',...terminalAtomNames];
  const distalRing = ['CD1','CD2','CE1','CE2','CZ',...terminalAtomNames];
  const startChi1 = torsionDegrees(...['N','CA','CB','CG'].map((name) => coordinates.get(name)));
  const targetChi1 = torsionDegrees(...['N','CA','CB','CG'].map((name) => point(targetByName.get(name))));
  const wantedChi1 = startChi1 + normalizeDegrees(targetChi1 - startChi1) * progress;
  const chi1Delta = normalizeDegrees(wantedChi1 - startChi1) * Math.PI / 180;
  const chi1Origin = coordinates.get('CA');
  const chi1Axis = unit(vector(chi1Origin, coordinates.get('CB')));
  for (const name of ring) coordinates.set(name,
    rotatePoint(coordinates.get(name), chi1Origin, chi1Axis, chi1Delta));
  const currentChi2 = torsionDegrees(...['CA','CB','CG','CD1'].map((name) => coordinates.get(name)));
  const targetChi2 = torsionDegrees(...['CA','CB','CG','CD1'].map((name) => point(targetByName.get(name))));
  const wantedChi2 = currentChi2 + normalizeDegrees(targetChi2 - currentChi2) * progress;
  const chi2Delta = normalizeDegrees(wantedChi2 - currentChi2) * Math.PI / 180;
  const chi2Origin = coordinates.get('CB');
  const chi2Axis = unit(vector(chi2Origin, coordinates.get('CG')));
  for (const name of distalRing) coordinates.set(name,
    rotatePoint(coordinates.get(name), chi2Origin, chi2Axis, chi2Delta));
  return replaceCoordinates(start, coordinates,
    `${label} ${String(ordinal).padStart(2, '0')}`);
}
function pheIntermediate(startText, targetText, progress, ordinal) {
  return aromaticSidechainIntermediate(startText, targetText, progress, ordinal,
    'Phe890 prospective flip');
}

async function verifyPredictionRun() {
  const manifestBytes = await readFile(join(runDirectory, 'prediction-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.campaignId, 'sos1-hit-only');
  assert.equal(manifest.status, 'predictions-frozen-holdouts-unopened');
  assert.equal(manifest.protocol.initialCoordinateInput, 'PDB 5OVE/AXE only');
  assert.equal(manifest.protocol.sequentialPredictedReferences, true);
  const checkpoints = new Map();
  for (const frozen of manifest.checkpoints) {
    const bytes = await readFile(join(runDirectory, frozen.filename));
    assert.equal(digest(bytes), frozen.sha256, `${frozen.stepId}: prediction hash changed`);
    const checkpoint = JSON.parse(bytes);
    assert.equal(checkpoint.frozenBeforeHoldoutAccess, true);
    checkpoints.set(frozen.stepId, { frozen, checkpoint, bytes });
  }
  const auditBytes = await readFile(join(runDirectory, 'chemist-action-audit.json'));
  assert.equal(digest(auditBytes), manifest.agentApi.auditSha256, 'Agent API audit hash changed');
  assert.equal(JSON.parse(auditBytes).records.length, manifest.agentApi.auditRecords);
  const campaignBytes = await readFile(join(root, manifest.inputs.campaign.path));
  assert.equal(digest(campaignBytes), manifest.inputs.campaign.sha256, 'campaign hash changed');
  const runnerBytes = await readFile(join(root, manifest.inputs.runner.path));
  assert.equal(digest(runnerBytes), manifest.inputs.runner.sha256, 'runner hash changed');
  const evaluationSummaryBytes = await readFile(join(runDirectory, 'holdout-evaluation-summary.json'));
  const evaluationSummary = JSON.parse(evaluationSummaryBytes);
  assert.equal(evaluationSummary.predictionManifestSha256, digest(manifestBytes));
  assert.equal(evaluationSummary.holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified, true);
  const evaluations = new Map();
  for (const spec of STEPS) {
    const bytes = await readFile(join(runDirectory, `${spec.id}-holdout-evaluation.json`));
    const evaluation = JSON.parse(bytes);
    assert.equal(evaluation.boundary.predictionManifestSha256, digest(manifestBytes));
    assert.equal(evaluation.boundary.holdoutOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified,
      true);
    const holdoutBytes = await readFile(join(sourceDirectory, `${spec.holdout}.pdb`));
    assert.equal(digest(holdoutBytes), evaluation.holdout.coordinateSha256,
      `${spec.holdout}: holdout hash changed`);
    evaluations.set(spec.id, { evaluation, bytes, holdoutBytes });
  }
  return { manifest, manifestBytes, checkpoints, auditBytes, campaignBytes, runnerBytes,
    evaluationSummary, evaluationSummaryBytes, evaluations };
}

const verified = await verifyPredictionRun();
const reviewBytes = await readFile(reviewPath);
const review = JSON.parse(reviewBytes);
assert.equal(review.schema, 'molarium.structure-overlay-review/v1');
assert.equal(review.id, 'sos1-v7-prediction-review');
assert.equal(review.sources.predictionManifestSha256, digest(verified.manifestBytes));
assert.equal(review.sources.evaluationSummarySha256, digest(verified.evaluationSummaryBytes));
const byId = new Map(review.ligands.map((entry) => [entry.id, entry]));
assert.equal(byId.get('hit').source.sha256,
  digest(await readFile(join(sourceDirectory, '5OVE.pdb'))));
for (const spec of STEPS) {
  const prediction = byId.get(`${spec.state}-prediction`);
  const crystal = byId.get(`${spec.state}-crystal`);
  assert(prediction && crystal, `${spec.state}: review pair unavailable`);
  assert.equal(prediction.source.sha256, verified.checkpoints.get(spec.id).frozen.sha256);
  assert.equal(crystal.source.sha256,
    verified.evaluations.get(spec.id).evaluation.holdout.coordinateSha256);
}

await mkdir(generated, { recursive:true });
const assets = [];
async function emit(filename, bytes, role, extra = {}) {
  const output = join(generated, filename);
  await writeFile(output, bytes);
  const written = await readFile(output);
  assets.push({ path:relative(root, output), role, ...extra,
    sha256:digest(written), bytes:written.length });
}
await emit('sos1-v7-5ove-protein.pdb', review.receptor.proteinPdb,
  'allowed-hit-protein');
await emit('sos1-v7-5ove-pocket.pdb', review.receptor.pocketPdb,
  'hit-derived-pocket');

const f1SourceBytes = await readFile(join(sourceDirectory, '6EPM.pdb'));
const prospectiveReference = parsePdb(review.receptor.proteinPdb);
const f1Fit = alignModels(prospectiveReference, parsePdb(f1SourceBytes), 'A', 'S');
assert(f1Fit.pairs >= 400, '6EPM F1 alignment has too few shared SOS1 residues');
assert(f1Fit.rmsd < 3, '6EPM F1 alignment is outside the expected SOS1 domain basin');
const f1Model = f1Fit.model;
const f1LigandAtoms = atomsForResidue(f1Model,
  { resName:'BQ5', chain:'S', resSeq:1101 });
assert.equal(f1LigandAtoms.length, 16, '6EPM fragment F1/BQ5 is incomplete');
const f1PocketKeys = pocketResidues(f1Model, f1LigandAtoms, 5);
const switchResidues = new Set([884, 887, 890]);
const f1Pocket = subsetPdb(f1Model, (atom) => atom.record === 'ATOM'
  && atom.chain === 'S'
  && !switchResidues.has(atom.resSeq)
  && f1PocketKeys.has(`${atom.chain}:${atom.resSeq}:${atom.iCode}:${atom.resName}`),
'6EPM F1 SOS1 pocket aligned to prospective frame');
const f1Ligand = subsetPdb(f1Model, (atom) => atom.record === 'HETATM'
  && atom.resName === 'BQ5' && atom.chain === 'S' && atom.resSeq === 1101,
'6EPM fragment F1 aligned to prospective frame');
const f1Tyr884 = subsetPdb(f1Model, (atom) => atom.record === 'ATOM'
  && atom.chain === 'S' && atom.resSeq === 884,
'6EPM KRAS-compatible Tyr884');
const inhibitorTyr884 = subsetPdb(prospectiveReference, (atom) => atom.record === 'ATOM'
  && atom.chain === 'A' && atom.resSeq === 884,
'5OVE inhibitor-shifted Tyr884');
await emit('sos1-full-f1-sos1-protein.pdb', subsetPdb(f1Model,
  (atom) => atom.record === 'ATOM' && atom.chain === 'S',
  '6EPM F1-bound SOS1 aligned to prospective frame'), 'historical-f1-sos1');
await emit('sos1-full-f1-kras-protein.pdb', subsetPdb(f1Model,
  (atom) => atom.record === 'ATOM' && atom.chain === 'R',
  '6EPM F1-bound KRAS aligned to prospective frame'), 'historical-f1-kras');
await emit('sos1-full-f1-pocket.pdb', f1Pocket, 'historical-f1-pocket');
await emit('sos1-full-5ove-pocket-without-switch.pdb', subsetPdb(
  parsePdb(review.receptor.pocketPdb),
  (atom) => atom.record === 'ATOM' && !switchResidues.has(atom.resSeq),
  '5OVE pocket without Tyr884 Asp887 or Phe890'), 'historical-comparison-pocket');
await emit('sos1-full-f1-ligand.pdb', f1Ligand, 'historical-f1-ligand');
await emit('sos1-full-f1-tyr884.pdb', f1Tyr884, 'historical-f1-tyr884');
await emit('sos1-full-f1-asp887.pdb', subsetPdb(f1Model, (atom) => atom.record === 'ATOM'
  && atom.chain === 'S' && atom.resSeq === 887, '6EPM F1-bound Asp887'),
'historical-f1-asp887');
await emit('sos1-full-f1-phe890.pdb', subsetPdb(f1Model, (atom) => atom.record === 'ATOM'
  && atom.chain === 'S' && atom.resSeq === 890, '6EPM F1-induced Phe890-out'),
'historical-f1-phe890');
const f1ContextBackboneNames = new Set(['N','CA','C','O','CB']);
await emit('sos1-full-f1-phe890-peptide-context.pdb', subsetPdb(f1Model,
  (atom) => atom.record === 'ATOM' && atom.chain === 'S'
    && atom.resSeq >= 889 && atom.resSeq <= 891
    && (atom.resSeq !== 890 || f1ContextBackboneNames.has(atom.atomName)),
  '6EPM peptide context around Phe890'), 'historical-f1-phe890-peptide-context');
await emit('sos1-full-f1-arg73.pdb', subsetPdb(f1Model, (atom) => atom.record === 'ATOM'
  && atom.chain === 'R' && atom.resSeq === 73, '6EPM KRAS Arg73 interface reference'),
'historical-kras-arg73');
await emit('sos1-full-f1-arg73-peptide-context.pdb', subsetPdb(f1Model,
  (atom) => atom.record === 'ATOM' && atom.chain === 'R'
    && atom.resSeq >= 72 && atom.resSeq <= 74
    && (atom.resSeq !== 73 || f1ContextBackboneNames.has(atom.atomName)),
  '6EPM KRAS peptide context around Arg73'), 'historical-kras-arg73-peptide-context');
await emit('sos1-full-5ove-tyr884.pdb', inhibitorTyr884, 'historical-hts-hit-tyr884');
const tyrBackboneNames = new Set(['N','CA','C','O','CB']);
await emit('sos1-full-tyr884-peptide-context.pdb', subsetPdb(prospectiveReference,
  (atom) => atom.record === 'ATOM' && atom.chain === 'A'
    && atom.resSeq >= 883 && atom.resSeq <= 885
    && (atom.resSeq !== 884 || tyrBackboneNames.has(atom.atomName)),
  '5OVE peptide context around Tyr884'), 'historical-hts-hit-peptide-context');

const tyrStartByName = new Map(parsePdb(f1Tyr884).atoms
  .map((atom) => [atom.atomName, point(atom)]));
const tyrTargetByName = new Map(parsePdb(inhibitorTyr884).atoms
  .map((atom) => [atom.atomName, point(atom)]));
const tyr884Trajectory = [];
const tyr884Scenes = [];
for (let ordinal = 0; ordinal < 9; ordinal++) {
  const progress = ordinal / 8;
  const filename = `sos1-full-tyr884-shift-${String(ordinal).padStart(2, '0')}.pdb`;
  const intermediate = aromaticSidechainIntermediate(f1Tyr884, inhibitorTyr884,
    progress, ordinal, 'Tyr884 interface shift', ['OH']);
  const atoms = new Map(parsePdb(intermediate).atoms
    .map((atom) => [atom.atomName, point(atom)]));
  tyr884Trajectory.push({ ordinal, progress,
    chiDegrees:[torsionDegrees(...['N','CA','CB','CG'].map((name) => atoms.get(name))),
      torsionDegrees(...['CA','CB','CG','CD1'].map((name) => atoms.get(name)))]
      .map((value) => Number(value.toFixed(3))) });
  await emit(filename, intermediate, 'historical-tyr884-interface-shift',
    { ordinal, progress });
  tyr884Scenes.push(`tyrShift${ordinal}`);
}
const tyr884OhDisplacementAngstrom = Math.hypot(...vector(
  tyrStartByName.get('OH'), tyrTargetByName.get('OH')));
const phe890PeptideContext = subsetPdb(parsePdb(review.receptor.proteinPdb),
  (atom) => atom.record === 'ATOM' && atom.chain === 'A'
    && atom.resSeq >= 889 && atom.resSeq <= 891 && atom.resSeq !== 890,
  '5OVE hit-derived peptide context flanking Phe890');
for (const entry of review.ligands) {
  const predictionSpec = STEPS.find((spec) => `${spec.state}-prediction` === entry.id);
  const renderedLigandPdb = predictionSpec ? withLigandConnectivity(entry.ligandPdb,
    verified.checkpoints.get(predictionSpec.id).checkpoint.ligand) : entry.ligandPdb;
  await emit(`sos1-v7-${entry.id}-ligand.pdb`, renderedLigandPdb,
    `${entry.coordinateClass}-ligand`, { stateId:entry.id });
  await emit(`sos1-v7-${entry.id}-phe890.pdb`, entry.focusPdb,
    `${entry.coordinateClass}-phe890`, { stateId:entry.id });
  await emit(`sos1-v7-${entry.id}-phe890-peptide.pdb`, combinePdb(
    `${entry.id} Phe890 with local peptide`, phe890PeptideContext, entry.focusPdb),
  `${entry.coordinateClass}-phe890-local-peptide`, { stateId:entry.id });
}

// A full-ligand color swap makes a chemical edit look like an unrelated molecule
// appearing in the pocket.  Split every frozen prediction by immutable atom
// provenance so the movie can keep inherited atoms neutral and color only the
// atoms introduced by the Agent API step.
const provenanceSplits = [];
for (const spec of STEPS) {
  const prediction = byId.get(`${spec.state}-prediction`);
  const ligandModel = parsePdb(prediction.ligandPdb);
  const checkpoint = verified.checkpoints.get(spec.id).checkpoint;
  const heavyAtoms = checkpoint.ligand.atoms.filter((atom) => atom.element !== 'H');
  const pdbAtomNames = new Set(ligandModel.atoms.map((atom) => atom.atomName));
  const currentPrefix = `benchmark-product-sos1-hit-only:${spec.id}:`;
  const addedAtomNames = new Set(heavyAtoms
    .filter((atom) => atom.atomId.startsWith(currentPrefix))
    .map((atom) => atom.atomName));
  const inheritedAtomNames = new Set(heavyAtoms
    .filter((atom) => !atom.atomId.startsWith(currentPrefix))
    .map((atom) => atom.atomName));
  assert.equal(heavyAtoms.length, ligandModel.atoms.length,
    `${spec.id}: checkpoint/PDB heavy-atom count changed`);
  assert([...addedAtomNames].every((name) => pdbAtomNames.has(name)),
    `${spec.id}: an added atom is absent from the rendered PDB`);
  assert([...inheritedAtomNames].every((name) => pdbAtomNames.has(name)),
    `${spec.id}: an inherited atom is absent from the rendered PDB`);
  assert(addedAtomNames.size > 0 && inheritedAtomNames.size > 0,
    `${spec.id}: the causal color split must contain both inherited and edited atoms`);
  await emit(`sos1-v7-${spec.state}-prediction-inherited.pdb`, subsetPdb(ligandModel,
    (atom) => inheritedAtomNames.has(atom.atomName),
    `${spec.state.toUpperCase()} prediction · inherited atoms`),
  'frozen-prediction-inherited-atoms', { stateId:`${spec.state}-prediction`, stepId:spec.id });
  await emit(`sos1-v7-${spec.state}-prediction-added.pdb`, subsetPdb(ligandModel,
    (atom) => addedAtomNames.has(atom.atomName),
    `${spec.state.toUpperCase()} prediction · atoms added by ${spec.id}`),
  'frozen-prediction-added-atoms', { stateId:`${spec.state}-prediction`, stepId:spec.id });
  provenanceSplits.push({ stepId:spec.id, stateId:`${spec.state}-prediction`,
    inheritedAtomNames:[...inheritedAtomNames], addedAtomNames:[...addedAtomNames] });
}
const awwPrediction=byId.get('aww-prediction');
const awwLigandModel=parsePdb(awwPrediction.ligandPdb);
const growthAtomNames=new Set(['CX11','CX12','CX13','CX14','CX15','CX16','OX3']);
const growthWithJunction=new Set(['CX5',...growthAtomNames]);
await emit('sos1-v7-aww-prediction-core.pdb',subsetPdb(awwLigandModel,
  (atom)=>!growthAtomNames.has(atom.atomName),'AWW prediction · conserved core'),
'frozen-prediction-ligand-core',{stateId:'aww-prediction'});
await emit('sos1-v7-aww-prediction-growth.pdb',subsetPdb(awwLigandModel,
  (atom)=>growthWithJunction.has(atom.atomName),'AWW prediction · new benzyl-alcohol arm'),
'frozen-prediction-ligand-growth',{stateId:'aww-prediction'});
await emit('sos1-v7-phe890-peptide-context.pdb', phe890PeptideContext,
  'allowed-hit-peptide-context');
const ligandByName=new Map(awwLigandModel.atoms.map((atom)=>[atom.atomName,point(atom)]));
const pheInByName=new Map(parsePdb(byId.get('awz-prediction').focusPdb).atoms
  .map((atom)=>[atom.atomName,point(atom)]));
const collisionPairs=[['OX3','CE2'],['CX16','CZ'],['CX14','CB']];
const collisionEvidence=collisionPairs.map(([ligandAtom,pheAtom])=>{
  const first=ligandByName.get(ligandAtom),second=pheInByName.get(pheAtom);
  assert(first&&second,`Missing collision pair ${ligandAtom}/${pheAtom}`);
  return {ligandAtom,pheAtom,distanceAngstrom:Number(Math.hypot(...vector(first,second)).toFixed(3)),
    midpoint:first.map((value,axis)=>(value+second[axis])/2)};
});
assert(collisionEvidence.every((entry)=>entry.distanceAngstrom<2.5),
  'Phe-in causal markers must identify direct atomic overlap');
await emit('sos1-v7-aww-phe-in-clash-markers.pdb',markerPdb(
  collisionEvidence.map((entry)=>entry.midpoint),'AWW growth / Phe890-in atomic overlap'),
'prospective-phe890-clash-markers',{stateId:'aww-prediction'});
const flipScenes = [];
const flipTrajectory = [];
const flipStart = byId.get('awz-prediction').focusPdb;
const flipTarget = byId.get('aww-prediction').focusPdb;
const ringBonds = [['CG','CD1'],['CD1','CE1'],['CE1','CZ'],
  ['CZ','CE2'],['CE2','CD2'],['CD2','CG']];
const startPhe = new Map(parsePdb(flipStart).atoms.map((atom) => [atom.atomName, point(atom)]));
const startRingLengths = ringBonds.map(([first, second]) =>
  Math.hypot(...vector(startPhe.get(first), startPhe.get(second))));
for (let ordinal = 0; ordinal < 9; ordinal++) {
  const progress = ordinal / 8;
  const filename = `sos1-v7-phe890-flip-${String(ordinal).padStart(2, '0')}.pdb`;
  const intermediate = pheIntermediate(flipStart, flipTarget, progress, ordinal);
  const atoms = new Map(parsePdb(intermediate).atoms.map((atom) => [atom.atomName, point(atom)]));
  const chiDegrees = [torsionDegrees(...['N','CA','CB','CG'].map((name) => atoms.get(name))),
    torsionDegrees(...['CA','CB','CG','CD1'].map((name) => atoms.get(name)))];
  const maximumRingBondDeltaAngstrom = Math.max(...ringBonds.map(([first, second], index) =>
    Math.abs(Math.hypot(...vector(atoms.get(first), atoms.get(second))) - startRingLengths[index])));
  assert(maximumRingBondDeltaAngstrom < 0.08,
    `Phe890 flip frame ${ordinal} distorts the phenyl ring`);
  flipTrajectory.push({ ordinal, progress, chiDegrees:chiDegrees.map((value) =>
    Number(value.toFixed(3))), maximumRingBondDeltaAngstrom:
      Number(maximumRingBondDeltaAngstrom.toFixed(4)) });
  await emit(filename, intermediate,
    'prospective-phe890-flip-intermediate', { ordinal, progress });
  await emit(`sos1-v7-phe890-flip-peptide-${String(ordinal).padStart(2, '0')}.pdb`,
    combinePdb(`Phe890 flip ${String(ordinal).padStart(2, '0')} with local peptide`,
      phe890PeptideContext, intermediate),
    'prospective-phe890-flip-local-peptide', { ordinal, progress });
  flipScenes.push(`pheFlip${ordinal}`);
}

const branchDecision = verified.checkpoints.get('open-phe890-pocket').checkpoint.rotamerDecision;
assert.deepEqual(branchDecision.selected.chiDegrees, [-180, 90]);
assert.equal(branchDecision.selected.refinement.selectedChemicalValidity.additionalStericClashes, 0);
const manifest = {
  schema:'molarium.sos1-prospective-movie-assets/v1', campaignId:'sos1-hit-only',
  scientificStatus:'historical-two-stream-origin-plus-prospective-hit-to-lead-success',
  claim:'The historical F1 fragment reveals the Phe890-out pocket; the independent 5OVE inhibitor hit seeds an Agent API trajectory that recovers the pocket switch and BAY-293 pose.',
  boundary:{ initialCoordinateInput:'PDB 5OVE/AXE only', sequentialPredictedReferences:true,
    historicalPreludeCoordinateInput:'PDB 6EPM/F1',
    historicalPreludeIsNotAProspectiveCampaignInput:true,
    predictionManifestSha256:digest(verified.manifestBytes),
    agentApiAuditSha256:digest(verified.auditBytes),
    agentApiAuditRecords:verified.manifest.agentApi.auditRecords,
    holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified:true },
  narrative:{ approvedSixBeats:['f1-fragment','hts-inhibitor-hit','scaffold-rewrite',
    'fragment-merge','phe890-pocket-opening','bay-293-finish'],
    cameraGrammar:{ viewingDirection:'fixed',
      movingCues:['compare-tyr884-states','compare-phe890-branches'],
      slowMotionCues:['tyr884-shift-slow-motion','phe890-flip-slow-motion'] } },
  historicalPrelude:{
    pdbId:'6EPM', ligandId:'BQ5', paperLabel:'fragment F1',
    sourceSha256:digest(f1SourceBytes), alignmentToProspectiveFrame:{
      pairedAlphaCarbons:f1Fit.pairs, rmsdAngstrom:Number(f1Fit.rmsd.toFixed(4)) },
    functionalOutcome:'stabilizes the KRAS-SOS1 complex',
    conformationalState:{ tyr884:'KRAS-compatible', phe890:'out' },
    tyr884OhDisplacementTo5oveAngstrom:Number(tyr884OhDisplacementAngstrom.toFixed(3)),
    tyr884Scenes, tyr884Trajectory,
  },
  checkpoints:verified.manifest.checkpoints,
  evaluation:verified.evaluationSummary.results,
  branchDecision:{ criterion:branchDecision.selected.criterion,
    branches:branchDecision.branches.map((entry) => ({ chiDegrees:entry.chiDegrees,
      feasible:entry.refinement.selectedFeasible,
      additionalStericClashes:entry.refinement.selectedChemicalValidity.additionalStericClashes,
      poseScoreKcalMol:entry.refinement.selectedScoreKcalMol })),
    selectedChiDegrees:branchDecision.selected.chiDegrees },
  targets:{ ligand:review.overlaySphere, phe890:review.switchSphere },
  causalVisual:{ growthAtomNames:[...growthAtomNames], collisionEvidence:collisionEvidence.map((entry)=>({
    ligandAtom:entry.ligandAtom,pheAtom:entry.pheAtom,distanceAngstrom:entry.distanceAngstrom })),
    peptideContextCoordinateClass:'allowed-hit-only', provenanceSplits },
  flipScenes, flipTrajectory,
  inputs:[
    { path:relative(root, join(runDirectory, 'prediction-manifest.json')),
      sha256:digest(verified.manifestBytes) },
    { path:relative(root, join(runDirectory, 'chemist-action-audit.json')),
      sha256:digest(verified.auditBytes) },
    { path:relative(root, join(runDirectory, 'holdout-evaluation-summary.json')),
      sha256:digest(verified.evaluationSummaryBytes) },
    { path:relative(root, join(root, verified.manifest.inputs.campaign.path)),
      sha256:digest(verified.campaignBytes) },
    { path:relative(root, reviewPath), sha256:digest(reviewBytes), role:'verified-review-source' },
  ],
  assets,
};
const output = join(generated, 'sos1-prospective-movie-assets.json');
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ output:relative(root, output), assets:assets.length,
  flipScenes, selectedPhe890ChiDegrees:branchDecision.selected.chiDegrees }, null, 2));
