import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(root, 'fixtures');
const curationBytes = await readFile(path.join(root, 'curation.v0.1.json'));
const curation = JSON.parse(curationBytes);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const refresh = process.argv.includes('--refresh');

const required = new Map();
for (const entry of curation.cases) {
  for (const key of ['reference', 'analogue']) {
    const structure = entry[key];
    if (!structure) continue;
    const pdbId = structure.pdbId.toUpperCase();
    const componentId = structure.componentId.toUpperCase();
    if (!required.has(pdbId)) required.set(pdbId, new Set());
    required.get(pdbId).add(componentId);
  }
}

await mkdir(path.join(fixtureRoot, 'pdb'), { recursive:true });
await mkdir(path.join(fixtureRoot, 'ccd'), { recursive:true });

async function materialize(url, destination) {
  if (!refresh) {
    try { return await readFile(destination); } catch { /* download below */ }
  }
  const response = await fetch(url, { headers:{ 'user-agent':'Molarium benchmark fixture curator/0.1' } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 100, `${url} returned an implausibly small file`);
  await writeFile(destination, bytes);
  return bytes;
}

function pdbInstances(text, componentId) {
  const instances = new Map();
  let model = 1;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('MODEL ')) model = Number(line.slice(10, 14).trim()) || model;
    if (!line.startsWith('HETATM')) continue;
    const residueName = line.slice(17, 20).trim().toUpperCase();
    if (residueName !== componentId) continue;
    const chain = line.slice(21, 22).trim();
    const residueNumber = Number(line.slice(22, 26).trim());
    const insertionCode = line.slice(26, 27).trim();
    const key = `${model}:${chain}:${residueNumber}:${insertionCode}`;
    if (!instances.has(key)) instances.set(key, { model, chain, residueNumber, insertionCode,
      atomRecords:0, atomNames:new Set(), alternateLocations:new Set() });
    const instance = instances.get(key);
    instance.atomRecords += 1;
    instance.atomNames.add(line.slice(12, 16).trim());
    const alt = line.slice(16, 17).trim();
    if (alt) instance.alternateLocations.add(alt);
  }
  return [...instances.values()].map((instance) => ({
    model:instance.model,
    chain:instance.chain,
    residueNumber:instance.residueNumber,
    insertionCode:instance.insertionCode,
    atomRecords:instance.atomRecords,
    uniqueAtomNames:instance.atomNames.size,
    alternateLocations:[...instance.alternateLocations].sort(),
  }));
}

function cifTokens(line) {
  return [...String(line).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
    .map((match) => match[1] ?? match[2] ?? match[3]);
}

function cifLoopRows(text, category) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim() !== 'loop_') continue;
    const headers = [];
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim().startsWith('_')) {
      headers.push(lines[cursor].trim());
      cursor += 1;
    }
    if (!headers.some((header) => header.startsWith(`${category}.`))) continue;
    const rows = [], pending = [];
    while (cursor < lines.length) {
      const trimmed = lines[cursor].trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed === 'loop_' ||
          trimmed.startsWith('_') || trimmed.startsWith('data_')) break;
      pending.push(...cifTokens(trimmed));
      while (pending.length >= headers.length) {
        const values = pending.splice(0, headers.length);
        rows.push(Object.fromEntries(headers.map((header, column) =>
          [header.slice(category.length + 1), values[column]])));
      }
      cursor += 1;
    }
    return rows;
  }
  return [];
}

function ccdSummary(text, componentId) {
  const atomRows = cifLoopRows(text, '_chem_comp_atom');
  const bondRows = cifLoopRows(text, '_chem_comp_bond');
  const descriptors = cifLoopRows(text, '_pdbx_chem_comp_descriptor');
  assert.ok(atomRows.length && bondRows.length, `${componentId}: CCD atom/bond tables are required`);
  const preferred = descriptors.find((row) => row.type === 'SMILES_CANONICAL' && row.program?.includes('OpenEye'))
    || descriptors.find((row) => row.type === 'SMILES_CANONICAL')
    || descriptors.find((row) => row.type === 'SMILES');
  assert.ok(preferred?.descriptor, `${componentId}: CCD SMILES descriptor is required`);
  return {
    atomCount:atomRows.length,
    heavyAtomCount:atomRows.filter((row) => row.type_symbol !== 'H').length,
    bondCount:bondRows.length,
    smiles:preferred.descriptor,
    smilesType:preferred.type,
    smilesProgram:preferred.program,
    smilesProgramVersion:preferred.program_version,
  };
}

const pdbAssets = [];
for (const [pdbId, components] of [...required].sort()) {
  const file = `pdb/${pdbId.toLowerCase()}.pdb`;
  const url = `https://files.rcsb.org/download/${pdbId}.pdb`;
  const bytes = await materialize(url, path.join(fixtureRoot, file));
  const text = bytes.toString('utf8');
  assert.ok(text.includes(`HEADER`) || text.includes(`ATOM  `), `${pdbId}: not a PDB coordinate file`);
  const requiredComponents = {};
  for (const componentId of [...components].sort()) {
    const instances = pdbInstances(text, componentId);
    assert.ok(instances.length, `${pdbId}: required component ${componentId} was not found`);
    requiredComponents[componentId] = { instances };
  }
  pdbAssets.push({ pdbId, file, sourceUrl:url, sha256:sha256(bytes), bytes:bytes.length,
    requiredComponents });
  process.stdout.write(`PDB ${pdbId} ${bytes.length} bytes\n`);
}

const componentIds = [...new Set([...required.values()].flatMap((set) => [...set]))].sort();
const ccdAssets = [];
for (const componentId of componentIds) {
  const file = `ccd/${componentId}.cif`;
  const url = `https://files.rcsb.org/ligands/download/${componentId}.cif`;
  const bytes = await materialize(url, path.join(fixtureRoot, file));
  const summary = ccdSummary(bytes.toString('utf8'), componentId);
  ccdAssets.push({ componentId, file, sourceUrl:url, sha256:sha256(bytes), bytes:bytes.length,
    ...summary });
  process.stdout.write(`CCD ${componentId} ${bytes.length} bytes\n`);
}

async function pruneUnregisteredFixtures(directory, allowedNames, extension) {
  const removed = [];
  for (const name of await readdir(directory)) {
    if (!name.toLowerCase().endsWith(extension) || allowedNames.has(name)) continue;
    await unlink(path.join(directory, name));
    removed.push(name);
  }
  return removed.sort();
}

const removedPdb = await pruneUnregisteredFixtures(path.join(fixtureRoot, 'pdb'),
  new Set(pdbAssets.map(({ file }) => path.basename(file))), '.pdb');
const removedCcd = await pruneUnregisteredFixtures(path.join(fixtureRoot, 'ccd'),
  new Set(ccdAssets.map(({ file }) => path.basename(file))), '.cif');
if (removedPdb.length || removedCcd.length)
  console.log(`Pruned unregistered fixtures: ${[...removedPdb, ...removedCcd].join(', ')}`);

const index = {
  schemaVersion:1,
  datasetId:curation.datasetId,
  curationSha256:sha256(curationBytes),
  source:'RCSB Protein Data Bank',
  sourcePolicy:'Public PDB coordinate and Chemical Component Dictionary files; byte hashes pin every input.',
  pdbAssets,
  ccdAssets,
};
await writeFile(path.join(fixtureRoot, 'index.v0.1.json'), `${JSON.stringify(index, null, 2)}\n`);

const fixtureBytes = (await Promise.all([
  ...pdbAssets.map(({ file }) => stat(path.join(fixtureRoot, file))),
  ...ccdAssets.map(({ file }) => stat(path.join(fixtureRoot, file))),
])).reduce((sum, entry) => sum + entry.size, 0);
console.log(`RCSB fixture set: PASS (${pdbAssets.length} PDB, ${ccdAssets.length} CCD, ${(fixtureBytes / 1048576).toFixed(1)} MiB)`);
