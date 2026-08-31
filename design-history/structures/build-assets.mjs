import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignModels, atomsForResidue, coordinateSphere, interactionMolBlock, parsePdb,
  pocketResidues, sha256, subsetPdb } from './pipeline.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = join(here, 'generated');
const sources = JSON.parse(await readFile(join(here, 'sources.json'), 'utf8'));
const loaded = new Map();

for (const source of sources.sources) {
  const text = await readFile(join(here, source.file), 'utf8');
  if (sha256(text) !== source.sha256) throw new Error(`${source.pdbId} source hash mismatch`);
  loaded.set(source.pdbId, { source, text, model:parsePdb(text) });
}

await mkdir(output, { recursive:true });
const derived = {};
async function emit(name, text, metadata = {}) {
  await writeFile(join(output, name), text);
  derived[name] = { sha256:sha256(text), bytes:Buffer.byteLength(text), ...metadata };
}

function buildComplex(entry, model = entry.model, prefix = entry.source.pdbId.toLowerCase()) {
  const ligandAtoms = atomsForResidue(model, entry.source.ligand);
  if (!ligandAtoms.length) throw new Error(`${entry.source.pdbId} ligand was not found`);
  const pocketKeys = pocketResidues(model, ligandAtoms, 5);
  const proteinAtoms = model.atoms.filter((atom) => atom.record === 'ATOM'
    && atom.chain === entry.source.ligand.chain);
  return {
    prefix,
    ligandAtoms,
    pocketKeys,
    proteinAtoms,
    protein:subsetPdb(model, (atom) => atom.record === 'ATOM'
      && atom.chain === entry.source.ligand.chain, `${entry.source.pdbId} protein chain`),
    pocket:subsetPdb(model, (atom) => atom.record === 'ATOM'
      && atom.chain === entry.source.ligand.chain
      && pocketKeys.has(`${atom.chain}:${atom.resSeq}:${atom.iCode}:${atom.resName}`),
    `${entry.source.pdbId} 5 A ligand shell`),
    ligand:subsetPdb(model, (atom) => atom.record === 'HETATM'
      && atom.resName === entry.source.ligand.resName && atom.chain === entry.source.ligand.chain
      && atom.resSeq === entry.source.ligand.resSeq, `${entry.source.pdbId} ${entry.source.ligand.label}`),
  };
}

const x1Entry = loaded.get('7GN8');
const x38Entry = loaded.get('7GNR');
const alignedX38 = alignModels(x1Entry.model, x38Entry.model, 'A', 'A');
const x1 = buildComplex(x1Entry);
const x38 = buildComplex(x38Entry, alignedX38.model, '7gnr-aligned');
const bclEntry = loaded.get('3SPF');
const bclTemplateEntry = loaded.get('3SP7');
const alignedBclTemplate = alignModels(bclEntry.model, bclTemplateEntry.model, 'A', 'A');
const bcl = buildComplex(bclEntry);
const bclTemplate = buildComplex(bclTemplateEntry, alignedBclTemplate.model, '3sp7-aligned');

for (const complex of [x1, x38, bcl, bclTemplate]) {
  await emit(`${complex.prefix}-protein.pdb`, complex.protein, { kind:'protein' });
  await emit(`${complex.prefix}-pocket.pdb`, complex.pocket, { kind:'pocket', cutoffAngstrom:5 });
  await emit(`${complex.prefix}-ligand.pdb`, complex.ligand, { kind:'ligand' });
}

const x1Interactions = interactionMolBlock(x1Entry.model, [
  [
    { resName:'RPZ', chain:'A', resSeq:407, atomName:'N3' },
    { resName:'HIS', chain:'A', resSeq:163, atomName:'NE2' },
  ],
  [
    { resName:'RPZ', chain:'A', resSeq:407, atomName:'O1' },
    { resName:'GLU', chain:'A', resSeq:166, atomName:'N' },
  ],
], '(S)-x1 published binding interactions');
const x38Interactions = interactionMolBlock(alignedX38.model, [
  [
    { resName:'RZU', chain:'A', resSeq:408, atomName:'N3' },
    { resName:'HIS', chain:'A', resSeq:163, atomName:'NE2' },
  ],
  [
    { resName:'RZU', chain:'A', resSeq:408, atomName:'O1' },
    { resName:'GLU', chain:'A', resSeq:166, atomName:'N' },
  ],
], '(S)-x38 published binding interactions');
await emit('7gn8-interactions.mol', x1Interactions, { kind:'interaction-lines' });
await emit('7gnr-aligned-interactions.mol', x38Interactions, { kind:'interaction-lines' });

const manifest = {
  schema:'molarium.structure-assets/v1',
  curatedAt:sources.curatedAt,
  sourceManifestSha256:sha256(`${JSON.stringify(sources, null, 2)}\n`),
  alignment:{
    reference:'7GN8 chain A', mobile:'7GNR chain A', pairedAlphaCarbons:alignedX38.pairs,
    rmsdAngstrom:Number(alignedX38.rmsd.toFixed(6)),
    rotation:alignedX38.rotation.map((row) => row.map((value) => Number(value.toFixed(12)))),
    translation:alignedX38.translation.map((value) => Number(value.toFixed(12))),
  },
  bclxlAlignment:{
    reference:'3SPF chain A', mobile:'3SP7 chain A', pairedAlphaCarbons:alignedBclTemplate.pairs,
    rmsdAngstrom:Number(alignedBclTemplate.rmsd.toFixed(6)),
    rotation:alignedBclTemplate.rotation.map((row) => row.map((value) => Number(value.toFixed(12)))),
    translation:alignedBclTemplate.translation.map((value) => Number(value.toFixed(12))),
  },
  complexes:{
    x1:{ pdbId:'7GN8', label:'(S)-x1', ligandResidue:'RPZ A 407',
      proteinSphere:coordinateSphere(x1.proteinAtoms), ligandSphere:coordinateSphere(x1.ligandAtoms),
      pocketResidues:x1.pocketKeys.size },
    x38:{ pdbId:'7GNR', label:'(S)-x38 / DNDI-6510', ligandResidue:'RZU A 408', alignedTo:'7GN8 chain A',
      proteinSphere:coordinateSphere(x38.proteinAtoms), ligandSphere:coordinateSphere(x38.ligandAtoms),
      pocketResidues:x38.pocketKeys.size },
    bclxlCompound4:{ pdbId:'3SPF', label:'BCL-xL compound 4', ligandResidue:'B50 A 501',
      proteinSphere:coordinateSphere(bcl.proteinAtoms), ligandSphere:coordinateSphere(bcl.ligandAtoms),
      pocketResidues:bcl.pocketKeys.size },
    bclxlTemplate:{ pdbId:'3SP7', label:'BCL-xL BM903 structural template',
      ligandResidue:'03B A 210', alignedTo:'3SPF chain A',
      proteinSphere:coordinateSphere(bclTemplate.proteinAtoms),
      ligandSphere:coordinateSphere(bclTemplate.ligandAtoms),
      pocketResidues:bclTemplate.pocketKeys.size },
  },
  derived,
};
await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built ${Object.keys(derived).length} structure assets; 7GNR→7GN8 CA RMSD ${alignedX38.rmsd.toFixed(3)} Å; 3SP7→3SPF CA RMSD ${alignedBclTemplate.rmsd.toFixed(3)} Å`);
