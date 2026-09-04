#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { actionScriptSha256 } from '../design-history/replay.mjs';
import { acceptedInspectionCheckpointReviewScript } from
  '../design-history/accepted-checkpoint-review.mjs';
import { buildAcceptedSos1ReplayScript, requireExplicitRunDirectory, sha256,
  SOS1_ROUTE_ID, SOS1_STEP_IDS, verifyAcceptedSos1Run } from './sos1-accepted-run.mjs';
import { SOS1_PUBLICATION_DECLARATION,
  SOS1_PUBLICATION_SCHEMA } from './verify-sos1-publication.mjs';
import { INSTALLED_MOVIE, INSTALLED_RENDER_MANIFEST,
  verifyInterfaceRenderForInstallation } from './install-sos1-interface-render.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SOS1_PUBLIC_REPLAY =
  'design-history/examples/sos1-accepted.action-script.json';
export const SOS1_PUBLIC_CHECKPOINT_REVIEW =
  'design-history/examples/sos1-accepted-checkpoint-review.action-script.json';
export const SOS1_PUBLIC_PROVENANCE =
  'design-history/examples/sos1-accepted.provenance.json';
export const SOS1_PUBLIC_ASSET_MANIFEST =
  'design-history/structures/generated/sos1-accepted-assets.json';
export const SOS1_PUBLIC_REVIEW =
  'design-history/structure-viewer/sos1-accepted-review.json';
export const SOS1_PUBLIC_REVIEW_ID = 'sos1-hit-to-bay293-review';

const LEGACY_REFERENCES = Object.freeze([
  'sos1-growth-clash-v7', 'sos1-v7-', 'sos1-chemist-actions-review',
  'sos1-hit-only-success',
]);
const STANDARD_RESIDUES = new Set([
  'ALA','ARG','ASN','ASP','CYS','GLN','GLU','GLY','HIS','ILE',
  'LEU','LYS','MET','PHE','PRO','SER','THR','TRP','TYR','VAL',
]);
const STEP_COPY = Object.freeze({
  'scaffold-rewrite':Object.freeze({ title:'Scaffold rewrite',
    body:'Inspect the first frozen prediction generated from the registered 5OVE/AXE hit.' }),
  'fragment-merge':Object.freeze({ title:'Fragment merge',
    body:'Inspect the next frozen prediction after the larger graph edit was applied.' }),
  'open-phe890-pocket':Object.freeze({ title:'Predicted Phe890-out pocket',
    body:'Inspect the frozen ligand and the selected Phe890 side-chain branch together.' }),
  'finish-bay-293':Object.freeze({ title:'Final BAY-293 prediction',
    body:'Inspect the final frozen ligand and receptor checkpoint in the same prediction-only review.' }),
});

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function repositoryRelative(root, path, label) {
  const value = relative(root, path);
  assert(value && value !== '..' && !value.startsWith(`..${sep}`),
    `${label} must be inside the repository`);
  return value.split(sep).join('/');
}

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive:true });
  const pending = `${path}.pending-${process.pid}`;
  await writeFile(pending, bytes);
  await rename(pending, path);
}

function formatAtomName(value) {
  const name = String(value || 'X').slice(0, 4);
  return name.length < 4 ? ` ${name.padEnd(3)}` : name;
}

export function pdbFromFrozenInspection(atoms, { title, ligand = false,
  stateId = 'LIG' } = {}) {
  assert(Array.isArray(atoms) && atoms.length, `${title}: frozen inspection is empty`);
  const heavy = atoms.filter((atom) => String(atom.element).toUpperCase() !== 'H');
  assert(heavy.length, `${title}: frozen inspection has no heavy atoms`);
  const lines = [`HEADER    ${String(title).slice(0, 40).padEnd(40)}`];
  for (const [index, atom] of heavy.entries()) {
    assert(typeof atom.atomName === 'string' && atom.atomName,
      `${title}: atom ${index + 1} has no atom name`);
    assert(Array.isArray(atom.coordinatesAngstrom) && atom.coordinatesAngstrom.length === 3
      && atom.coordinatesAngstrom.every(Number.isFinite),
    `${title}: atom ${atom.atomName} has invalid frozen coordinates`);
    const record = ligand ? 'HETATM' : STANDARD_RESIDUES.has(atom.residueName) ? 'ATOM' : 'HETATM';
    const residue = ligand ? stateId : atom.residueName;
    const chain = ligand ? 'L' : atom.chain || 'A';
    const residueIndex = ligand ? 1 : Number(atom.residueIndex);
    assert(typeof residue === 'string' && residue && Number.isInteger(residueIndex),
      `${title}: atom ${atom.atomName} has incomplete residue identity`);
    const [x,y,z] = atom.coordinatesAngstrom.map(Number);
    lines.push(`${record.padEnd(6)}${String(index + 1).padStart(5)} ${formatAtomName(atom.atomName)}`
      + ` ${residue.slice(0, 3).padStart(3)} ${String(chain).slice(0, 1)}`
      + `${String(residueIndex).padStart(4)}    ${x.toFixed(3).padStart(8)}`
      + `${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}`
      + `  1.00 20.00          ${String(atom.element).slice(0, 2).padStart(2)}`);
  }
  lines.push('END');
  return `${lines.join('\n')}\n`;
}

function requireCompleteInspection(inspection, label) {
  assert(inspection && Array.isArray(inspection.atoms) && inspection.atoms.length,
    `${label} is absent`);
  assert.equal(inspection.truncated, false, `${label} was truncated`);
  assert.equal(inspection.totalAtomCount, inspection.atoms.length,
    `${label} does not contain every inspected atom`);
  return inspection.atoms;
}

function cameraForAtoms(atoms) {
  const points = atoms.map((atom) => atom.coordinatesAngstrom.map(Number));
  const low = [0,1,2].map((axis) => Math.min(...points.map((point) => point[axis])));
  const high = [0,1,2].map((axis) => Math.max(...points.map((point) => point[axis])));
  const target = low.map((value, axis) => Number(((value + high[axis]) / 2).toFixed(4)));
  const radius = Math.max(5.5, ...high.map((value, axis) => value - low[axis])) * .72;
  return { target, radius:Number(radius.toFixed(4)), view:[1.55, .75, 2.2] };
}

function acceptedRunLink(accepted) {
  return {
    schema:'molarium.sos1-accepted-run-link/v1', routeId:SOS1_ROUTE_ID,
    runId:accepted.runId, accepted:true,
    predictionManifestSha256:sha256(accepted.manifestBytes),
    evaluationSummarySha256:sha256(accepted.evaluationBytes),
    sourceAuditSha256:sha256(accepted.auditBytes),
    checkpoints:SOS1_STEP_IDS.map((stepId) => ({ stepId,
      sha256:accepted.checkpoints.get(stepId).entry.sha256 })),
  };
}

export async function buildSos1PublicationRecords(accepted, { interfaceMovie } = {}) {
  assert(accepted?.evaluation?.accepted === true,
    'SOS1 publication records require an accepted evaluation');
  assert(interfaceMovie?.path === INSTALLED_MOVIE && interfaceMovie?.sha256
    && interfaceMovie?.renderManifest?.path === INSTALLED_RENDER_MANIFEST
    && interfaceMovie?.renderManifest?.sha256,
  'SOS1 publication records require the verified installed interface movie');
  const replay = await buildAcceptedSos1ReplayScript(accepted);
  const replayBytes = jsonBytes(replay.script);
  const checkpointReviewScript = await acceptedInspectionCheckpointReviewScript({
    label:'SOS1 accepted checkpoints · calculation-free review',
    checkpoints:SOS1_STEP_IDS.map((stepId) => {
      const frozen = accepted.checkpoints.get(stepId);
      return {
        accepted:true,
        frozenBeforeHoldoutAccess:true,
        checkpointSha256:frozen.entry.sha256,
        pocket:frozen.checkpoint.pocket,
        ligand:frozen.checkpoint.ligand,
        label:STEP_COPY[stepId].title,
      };
    }),
  });
  const checkpointReviewBytes = jsonBytes(checkpointReviewScript);
  const link = acceptedRunLink(accepted);
  const assets = [], scenes = {}, cameras = {}, checkpointAssets = new Map();

  for (const stepId of SOS1_STEP_IDS) {
    const frozen = accepted.checkpoints.get(stepId);
    assert(frozen, `${stepId}: accepted checkpoint is absent`);
    const stateId = String(frozen.entry.predictedStateId
      || frozen.checkpoint.predictedStateId || '').toUpperCase();
    assert(stateId, `${stepId}: frozen prediction has no state ID`);
    assert.equal(frozen.checkpoint.frozenBeforeHoldoutAccess, true,
      `${stepId}: prediction was not frozen before evaluation`);
    const ligandAtoms = requireCompleteInspection(frozen.checkpoint.ligand,
      `${stepId} ligand inspection`);
    const pocketAtoms = requireCompleteInspection(frozen.checkpoint.pocket,
      `${stepId} pocket inspection`);
    const pheAtoms = pocketAtoms.filter((atom) => atom.residueName === 'PHE'
      && atom.chain === 'A' && Number(atom.residueIndex) === 890
      && String(atom.element).toUpperCase() !== 'H');
    assert(pheAtoms.length, `${stepId}: frozen pocket contains no Phe890 side chain`);
    const contextAtoms = pocketAtoms.filter((atom) => !(atom.residueName === 'PHE'
      && atom.chain === 'A' && Number(atom.residueIndex) === 890));
    assert(contextAtoms.length, `${stepId}: frozen pocket has no receptor context`);

    const prefix = `sos1-accepted-${stepId}`;
    const specifications = [
      { suffix:'ligand', role:'prospective-prediction-ligand', atoms:ligandAtoms,
        ligand:true, title:`${stateId} frozen prediction` },
      { suffix:'pocket', role:'prospective-prediction-pocket', atoms:contextAtoms,
        title:`${stateId} frozen receptor pocket` },
      { suffix:'phe890', role:'prospective-prediction-phe890', atoms:pheAtoms,
        title:`${stateId} frozen Phe890` },
    ];
    const models = [];
    for (const specification of specifications) {
      const path = `design-history/structures/generated/${prefix}-${specification.suffix}.pdb`;
      const bytes = Buffer.from(pdbFromFrozenInspection(specification.atoms, {
        title:specification.title, ligand:specification.ligand, stateId,
      }));
      const digest = sha256(bytes);
      assets.push({ path, role:specification.role, stepId, stateId,
        checkpointSha256:frozen.entry.sha256, sha256:digest, bytes:bytes.length });
      checkpointAssets.set(path, bytes);
      const appearance = specification.suffix === 'ligand'
        ? { color:'#826cae', sizeFactor:.23 }
        : specification.suffix === 'phe890'
          ? { color:'#c5912e', sizeFactor:.20 }
          : { color:'#596b7e', alpha:.38, sizeFactor:.12 };
      models.push({ ref:`${stepId}-${specification.suffix}`, path:basename(path),
        sha256:digest, representation:'ball-and-stick', ...appearance });
    }
    scenes[stepId] = { label:`${stateId} · frozen prospective prediction`,
      coordinateClass:'frozen-prediction',
      coordinateLabel:`PREDICTION CHECKPOINT · ${stateId}`, models };
    cameras[stepId] = cameraForAtoms([...ligandAtoms, ...pocketAtoms]);
  }

  const assetManifest = {
    schema:'molarium.sos1-prospective-movie-assets/v1',
    boundary:{ predictionManifestSha256:sha256(accepted.manifestBytes),
      agentApiAuditSha256:sha256(accepted.auditBytes),
      coordinatePolicy:'frozen-prediction-checkpoints-only' },
    checkpoints:accepted.manifest.checkpoints.map((entry) => ({ ...entry })), assets,
  };
  const assetManifestBytes = jsonBytes(assetManifest);
  const provenance = {
    schema:'molarium.designer-moves-example-provenance/v1',
    sourceRun:{ id:accepted.runId,
      audit:{ path:`${repositoryRelative(ROOT, accepted.directory, 'accepted run')}/chemist-action-audit.json`,
        sha256:sha256(accepted.auditBytes) },
      predictionManifest:{
        path:`${repositoryRelative(ROOT, accepted.directory, 'accepted run')}/prediction-manifest.json`,
        sha256:sha256(accepted.manifestBytes) },
      evaluationSummary:{
        path:`${repositoryRelative(ROOT, accepted.directory, 'accepted run')}/holdout-evaluation-summary.json`,
        sha256:sha256(accepted.evaluationBytes), accepted:true } },
    scripts:{ acceptedRoute:{ path:SOS1_PUBLIC_REPLAY, fileSha256:sha256(replayBytes),
      actionScriptSha256:replay.actionScriptSha256 } },
  };
  const provenanceBytes = jsonBytes(provenance);
  const review = {
    schema:'molarium.structure-story/v1', id:SOS1_PUBLIC_REVIEW_ID,
    title:'SOS1 accepted prediction checkpoints',
    subtitle:'Frozen prospective states only · use arrows to inspect each accepted design decision',
    width:1600, height:900, fps:1,
    publication:link,
    review:{ schema:'molarium.precomputed-checkpoint-review/v1', calculationPolicy:'never-run',
      sourceAuditSha256:sha256(accepted.auditBytes),
      actionScript:{ path:`../examples/${basename(SOS1_PUBLIC_REPLAY)}`,
        sha256:sha256(replayBytes) },
      provenance:{ path:`../examples/${basename(SOS1_PUBLIC_PROVENANCE)}`,
        sha256:sha256(provenanceBytes) },
      assetManifest:{ path:`../structures/generated/${basename(SOS1_PUBLIC_ASSET_MANIFEST)}`,
        sha256:sha256(assetManifestBytes) } },
    sources:[
      { label:'5OVE/AXE · sole experimental coordinate input',
        url:'https://www.rcsb.org/structure/5OVE' },
      { label:'Molarium Chemist Actions · accepted frozen prediction audit', url:'#provenance' },
    ],
    legend:[
      { label:'frozen prediction', color:'#826cae' },
      { label:'Phe890', color:'#c5912e' },
      { label:'prediction-pocket context', color:'#596b7e' },
    ], cameras, scenes,
    cues:SOS1_STEP_IDS.map((stepId) => {
      const frozen = accepted.checkpoints.get(stepId);
      const copy = STEP_COPY[stepId];
      return { id:`${stepId}-checkpoint`, title:copy.title, body:copy.body,
        detail:`Frozen Agent API checkpoint · ${frozen.entry.predictedStateId}`,
        scene:stepId, durationMs:1000, cameraStart:stepId, cameraEnd:stepId,
        checkpoint:{ stepId, stateId:frozen.entry.predictedStateId,
          predictionSha256:frozen.entry.sha256,
          sourceActionSequence:frozen.entry.freezeActionSequence,
          sourceAction:'session.inspect' } };
    }),
  };
  const reviewBytes = jsonBytes(review);
  const declaration = {
    schema:SOS1_PUBLICATION_SCHEMA, routeId:SOS1_ROUTE_ID, storyId:review.id,
    acceptedRun:{ id:accepted.runId,
      directory:repositoryRelative(ROOT, accepted.directory, 'accepted run'),
      predictionManifestSha256:link.predictionManifestSha256,
      evaluationSummarySha256:link.evaluationSummarySha256,
      sourceAuditSha256:link.sourceAuditSha256, checkpoints:link.checkpoints },
    publicReplay:{ path:SOS1_PUBLIC_REPLAY, sha256:sha256(replayBytes),
      actionScriptSha256:await actionScriptSha256(replay.script) },
    interfaceMovie,
    checkpointReview:{ path:SOS1_PUBLIC_REVIEW, sha256:sha256(reviewBytes),
      application:{ path:SOS1_PUBLIC_CHECKPOINT_REVIEW,
        sha256:sha256(checkpointReviewBytes),
        actionScriptSha256:await actionScriptSha256(checkpointReviewScript),
        calculationPolicy:'none', promotable:false } },
    integration:{ applicationSource:'app.js',
      structureViewerSource:'design-history/structure-viewer/viewer.mjs',
      buildSource:'scripts/build-web.mjs',
      manifestSource:'scripts/generate-local-lab-manifest.mjs', serverSource:'server.js' },
  };
  return Object.freeze({ replay, replayBytes, checkpointReviewScript,
    checkpointReviewBytes, provenance, provenanceBytes,
    assetManifest, assetManifestBytes, review, reviewBytes, declaration,
    declarationBytes:jsonBytes(declaration), checkpointAssets });
}

function registryBounds(source, registryName) {
  const start = source.indexOf(`const ${registryName}`);
  assert(start >= 0, `Missing ${registryName}`);
  const close = source.indexOf('\n});', start);
  assert(close > start, `Cannot locate the end of ${registryName}`);
  return { start, close };
}

function entryBounds(source, registryName, key) {
  const registry = registryBounds(source, registryName);
  const keyAt = source.indexOf(`'${key}'`, registry.start);
  if (keyAt < 0 || keyAt > registry.close) return null;
  const lineStart = source.lastIndexOf('\n', keyAt) + 1;
  const objectAt = source.indexOf('Object.freeze({', keyAt);
  assert(objectAt >= 0 && objectAt < registry.close, `Malformed ${registryName}.${key}`);
  const open = source.indexOf('{', objectAt);
  let depth = 0, quote = null, escaped = false, close = -1;
  for (let index = open; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character; continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}' && --depth === 0) { close = index; break; }
  }
  assert(close >= 0, `Unclosed ${registryName}.${key}`);
  const comma = source.indexOf(',', close);
  assert(comma >= 0, `Malformed ${registryName}.${key} terminator`);
  return { start:lineStart, end:source[comma + 1] === '\n' ? comma + 2 : comma + 1 };
}

function withoutRegistryEntry(source, registryName, key) {
  const bounds = entryBounds(source, registryName, key);
  return bounds ? source.slice(0, bounds.start) + source.slice(bounds.end) : source;
}

function appendRegistryEntry(source, registryName, entry) {
  const { close } = registryBounds(source, registryName);
  return `${source.slice(0, close)}\n${entry}${source.slice(close)}`;
}

function replaceManagedArrayEntries(source, name, managedPaths) {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`));
  assert(match, `Missing ${name} array`);
  const legacy = (line) => LEGACY_REFERENCES.some((token) => line.includes(token));
  const managed = new Set([
    SOS1_PUBLICATION_DECLARATION, SOS1_PUBLIC_REPLAY, SOS1_PUBLIC_PROVENANCE,
    SOS1_PUBLIC_ASSET_MANIFEST, SOS1_PUBLIC_REVIEW, ...managedPaths,
  ]);
  const body = match[1].split('\n').filter((line) => !legacy(line)
    && ![...managed].some((path) => line.includes(`'${path}'`) || line.includes(`"${path}"`)));
  const inserted = [...managed].map((path) => `  '${path}',`);
  return source.slice(0, match.index)
    + `const ${name} = [\n${inserted.join('\n')}${body.length ? `\n${body.join('\n')}` : ''}\n];`
    + source.slice(match.index + match[0].length);
}

export function rewritePublicationIntegration({ appSource, viewerSource, buildSource,
  manifestSource, serverSource }, records) {
  let app = withoutRegistryEntry(appSource, 'DESIGNER_STORY_LINKS', 'sos1-hit-to-bay293');
  app = withoutRegistryEntry(app, 'DESIGNER_STORY_LINKS', SOS1_PUBLIC_REVIEW_ID);
  app = appendRegistryEntry(app, 'DESIGNER_STORY_LINKS',
    `  'sos1-hit-to-bay293':Object.freeze({\n`
    + `    title:'SOS1 hit to BAY-293',\n    script:'./${SOS1_PUBLIC_REPLAY}',\n`
    + `    sourcePath:'${SOS1_PUBLIC_REPLAY}',\n`
    + `    sourceSha256:'${sha256(records.replayBytes)}',\n`
    + `    presentation:'chemist-pocket',\n  }),`);
  app = appendRegistryEntry(app, 'DESIGNER_STORY_LINKS',
    `  '${SOS1_PUBLIC_REVIEW_ID}':Object.freeze({\n`
    + `    title:'SOS1 accepted checkpoints',\n`
    + `    script:'./${SOS1_PUBLIC_CHECKPOINT_REVIEW}',\n`
    + `    sourcePath:'${SOS1_PUBLIC_CHECKPOINT_REVIEW}',\n`
    + `    sourceSha256:'${sha256(records.checkpointReviewBytes)}',\n  }),`);

  let viewer = viewerSource;
  for (const key of ['sos1-hit-only-success', 'sos1-chemist-actions-review',
    SOS1_PUBLIC_REVIEW_ID]) viewer = withoutRegistryEntry(viewer, 'STORY_REGISTRY', key);
  viewer = appendRegistryEntry(viewer, 'STORY_REGISTRY',
    `  '${SOS1_PUBLIC_REVIEW_ID}':Object.freeze({\n`
    + `    path:'./${basename(SOS1_PUBLIC_REVIEW)}',\n`
    + `    sha256:'${sha256(records.reviewBytes)}',\n  }),`);

  const assetPaths = [...records.checkpointAssets.keys(), INSTALLED_MOVIE,
    INSTALLED_RENDER_MANIFEST, SOS1_PUBLIC_CHECKPOINT_REVIEW];
  let build = buildSource.replace(/\nconst generatedStructures = await readdir\([\s\S]*?\n\s*\.map\(\(name\) => `design-history\/structures\/generated\/\$\{name\}`\)\);\n/, '\n');
  build = replaceManagedArrayEntries(build, 'files', assetPaths);
  build = build.replaceAll('story=sos1-chemist-actions-review',
    `story=${SOS1_PUBLIC_REVIEW_ID}`)
    .replaceAll('/design-history/structure-viewer/?story=sos1-hit-to-bay293-review',
      '/?story=sos1-hit-to-bay293-review');
  let manifest = replaceManagedArrayEntries(manifestSource, 'reviewedFiles', assetPaths);
  const server = serverSource
    .replaceAll('story=sos1-chemist-actions-review', `story=${SOS1_PUBLIC_REVIEW_ID}`)
    .replaceAll('/design-history/structure-viewer/?story=sos1-hit-to-bay293-review',
      '/?story=sos1-hit-to-bay293-review');
  for (const [label, source] of Object.entries({ app, viewer, build, manifest, server }))
    for (const token of LEGACY_REFERENCES)
      assert(!source.includes(token), `${label} still contains retired reference ${token}`);
  return { appSource:app, viewerSource:viewer, buildSource:build,
    manifestSource:manifest, serverSource:server };
}

export async function writeSos1Publication(accepted, { root = ROOT, renderDirectory } = {}) {
  assert.equal(resolve(root), ROOT,
    'SOS1 publication builder only writes the checked-out production repository');
  assert(renderDirectory, 'SOS1 publication builder requires the explicit accepted render directory');
  for (const token of LEGACY_REFERENCES)
    assert(!accepted.runId.includes(token), `Refusing retired SOS1 run ${accepted.runId}`);
  const verifiedRender = await verifyInterfaceRenderForInstallation(accepted, renderDirectory);
  const [installedMovieBytes, installedManifestBytes] = await Promise.all([
    readFile(resolve(root, INSTALLED_MOVIE)), readFile(resolve(root, INSTALLED_RENDER_MANIFEST)),
  ]);
  assert.equal(sha256(installedMovieBytes), sha256(verifiedRender.videoBytes),
    'installed interface movie differs from the accepted render');
  assert.equal(sha256(installedManifestBytes), sha256(verifiedRender.manifestBytes),
    'installed interface render manifest differs from the accepted render');
  const interfaceMovie = { path:INSTALLED_MOVIE, sha256:sha256(installedMovieBytes),
    bytes:installedMovieBytes.length, renderManifest:{ path:INSTALLED_RENDER_MANIFEST,
      sha256:sha256(installedManifestBytes), bytes:installedManifestBytes.length } };
  const records = await buildSos1PublicationRecords(accepted, { interfaceMovie });
  const sourcePaths = {
    appSource:'app.js', viewerSource:'design-history/structure-viewer/viewer.mjs',
    buildSource:'scripts/build-web.mjs',
    manifestSource:'scripts/generate-local-lab-manifest.mjs', serverSource:'server.js',
  };
  const sources = Object.fromEntries(await Promise.all(Object.entries(sourcePaths)
    .map(async ([key, path]) => [key, await readFile(resolve(root, path), 'utf8')])));
  const rewritten = rewritePublicationIntegration(sources, records);

  const artifacts = new Map([
    [SOS1_PUBLIC_REPLAY, records.replayBytes],
    [SOS1_PUBLIC_CHECKPOINT_REVIEW, records.checkpointReviewBytes],
    [SOS1_PUBLIC_PROVENANCE, records.provenanceBytes],
    [SOS1_PUBLIC_ASSET_MANIFEST, records.assetManifestBytes],
    [SOS1_PUBLIC_REVIEW, records.reviewBytes],
    ...records.checkpointAssets,
  ]);
  for (const [path, bytes] of artifacts) await atomicWrite(resolve(root, path), bytes);
  for (const [key, path] of Object.entries(sourcePaths))
    await atomicWrite(resolve(root, path), Buffer.from(rewritten[key]));
  // The declaration is the commit point and is deliberately written last.
  await atomicWrite(resolve(root, SOS1_PUBLICATION_DECLARATION), records.declarationBytes);
  return Object.freeze({ declaration:records.declaration,
    declarationSha256:sha256(records.declarationBytes), artifacts:[...artifacts.keys()] });
}

export async function main(argv = process.argv.slice(2)) {
  const runDirectory = requireExplicitRunDirectory(argv, { root:ROOT });
  const renderValue = argv.includes('--render-dir')
    ? argv[argv.indexOf('--render-dir') + 1]
    : argv.find((entry) => entry.startsWith('--render-dir='))?.slice('--render-dir='.length);
  if (!renderValue) throw new Error('--render-dir is required; no render is selected implicitly');
  const accepted = await verifyAcceptedSos1Run(runDirectory);
  const result = await writeSos1Publication(accepted,
    { renderDirectory:resolve(ROOT, renderValue) });
  process.stdout.write(`${JSON.stringify({ acceptedRun:accepted.runId, ...result }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
