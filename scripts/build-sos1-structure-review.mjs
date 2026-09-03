#!/usr/bin/env node

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  alignModels,
  atomsForResidue,
  coordinateSphere,
  parsePdb,
  pocketResidues,
  sha256,
  subsetPdb,
} from '../design-history/structures/pipeline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewerDirectory = path.join(root, 'design-history/structure-review');
const vendorDirectory = path.join(root, 'docking/validation/pose-viewer/vendor');

const STRUCTURES = Object.freeze([
  {
    pdbId:'5OVE', compound:'1', ligand:{ resName:'AXE', chain:'A', resSeq:1104 },
    label:'Compound 1 · starting hit', color:'#8064a2',
    designPoint:'HTS hit and sole receptor starting point',
  },
  {
    pdbId:'5OVF', compound:'17', ligand:{ resName:'AWT', chain:'A', resSeq:1101 },
    label:'Compound 17 · scaffold rewrite', color:'#327fa1',
    designPoint:'Pyrazolylphenyl replacement and water-network extension',
  },
  {
    pdbId:'5OVG', compound:'18', ligand:{ resName:'AWZ', chain:'A', resSeq:1101 },
    label:'Compound 18 · first fragment merge', color:'#5a9a68',
    designPoint:'Large thiophene-linked merge; Phe890 remains in',
  },
  {
    pdbId:'5OVH', compound:'21', ligand:{ resName:'AWW', chain:'A', resSeq:1101 },
    label:'Compound 21 · Phe-out solution', color:'#cf9335',
    designPoint:'Benzyl alcohol recovers the induced Phe890-out state',
  },
  {
    pdbId:'5OVI', compound:'23', ligand:{ resName:'AXH', chain:'A', resSeq:2001 },
    label:'Compound 23 · BAY-293', color:'#d36350',
    designPoint:'R-aminomethyl placement; final 21 nM chemical probe',
  },
]);

const SWITCH_RESIDUES = new Set([884, 887, 890]);

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error('Arguments must be --name value pairs');
    values[name.slice(2)] = value;
  }
  return {
    sourceDirectory:path.resolve(values['source-dir'] || path.join(root,
      'outputs/design-history/sos1-preapproval/source')),
    outputDirectory:path.resolve(values.output || path.join(root,
      'outputs/design-history/sos1-preapproval/review')),
  };
}

function roundedSphere(atoms) {
  const sphere = coordinateSphere(atoms);
  return {
    center:sphere.center.map((value) => Number(value.toFixed(4))),
    radius:Number(sphere.radius.toFixed(4)),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const loaded = [];
  for (const spec of STRUCTURES) {
    const file = path.join(options.sourceDirectory, `${spec.pdbId}.pdb`);
    const text = await readFile(file, 'utf8');
    loaded.push({ spec, file, text, sha256:sha256(text), model:parsePdb(text) });
  }

  const reference = loaded[0];
  const aligned = loaded.map((entry, index) => {
    if (index === 0) return { ...entry, alignedModel:entry.model, alignment:{
      reference:'5OVE chain A', mobile:'5OVE chain A', pairedAlphaCarbons:
        entry.model.atoms.filter((atom) => atom.record === 'ATOM' && atom.chain === 'A'
          && atom.atomName === 'CA').length,
      rmsdAngstrom:0,
    } };
    const fit = alignModels(reference.model, entry.model, 'A', 'A');
    return { ...entry, alignedModel:fit.model, alignment:{
      reference:'5OVE chain A', mobile:`${entry.spec.pdbId} chain A`,
      pairedAlphaCarbons:fit.pairs, rmsdAngstrom:Number(fit.rmsd.toFixed(6)),
      rotation:fit.rotation.map((row) => row.map((value) => Number(value.toFixed(12)))),
      translation:fit.translation.map((value) => Number(value.toFixed(12))),
    } };
  });

  const ligands = aligned.map((entry) => {
    const atoms = atomsForResidue(entry.alignedModel, entry.spec.ligand);
    if (!atoms.length) throw new Error(`${entry.spec.pdbId}: ligand was not found`);
    const ligandPdb = subsetPdb(entry.alignedModel, (atom) => atom.record === 'HETATM'
      && atom.resName === entry.spec.ligand.resName && atom.chain === entry.spec.ligand.chain
      && atom.resSeq === entry.spec.ligand.resSeq,
    `${entry.spec.pdbId} compound ${entry.spec.compound} aligned to 5OVE`);
    const focusPdb = subsetPdb(entry.alignedModel, (atom) => atom.record === 'ATOM'
      && atom.chain === 'A' && SWITCH_RESIDUES.has(atom.resSeq),
    `${entry.spec.pdbId} selected SOS1 side chains aligned to 5OVE`);
    return {
      id:`compound-${entry.spec.compound}`,
      pdbId:entry.spec.pdbId,
      compound:entry.spec.compound,
      label:entry.spec.label,
      designPoint:entry.spec.designPoint,
      color:entry.spec.color,
      coordinateClass:'experimental',
      ligandResidue:`${entry.spec.ligand.resName} ${entry.spec.ligand.chain} ${entry.spec.ligand.resSeq}`,
      heavyAtomCount:atoms.filter((atom) => atom.element !== 'H').length,
      ligandPdb,
      focusPdb,
      sphere:roundedSphere(atoms),
      alignment:entry.alignment,
      source:{
        url:`https://www.rcsb.org/structure/${entry.spec.pdbId}`,
        sha256:entry.sha256,
      },
    };
  });

  const allLigandAtoms = aligned.flatMap((entry) => atomsForResidue(entry.alignedModel,
    entry.spec.ligand));
  const switchAtoms = aligned.flatMap((entry) => entry.alignedModel.atoms.filter((atom) =>
    atom.record === 'ATOM' && atom.chain === 'A' && SWITCH_RESIDUES.has(atom.resSeq)));
  const pocketKeys = pocketResidues(reference.model, allLigandAtoms, 5);
  const proteinPdb = subsetPdb(reference.model, (atom) => atom.record === 'ATOM'
    && atom.chain === 'A', '5OVE starting SOS1 receptor');
  const pocketPdb = subsetPdb(reference.model, (atom) => atom.record === 'ATOM'
    && atom.chain === 'A'
    && pocketKeys.has(`${atom.chain}:${atom.resSeq}:${atom.iCode}:${atom.resName}`),
  '5OVE receptor union 5 A shell around aligned ligands');

  const data = {
    schema:'molarium.structure-overlay-review/v1',
    id:'sos1-five-structure-preapproval',
    title:'SOS1 five-structure preapproval',
    subtitle:'All experimental ligands aligned into the compound-1 starting crystal',
    boundary:'The displayed protein and pocket are from 5OVE. Later protein coordinates are hidden unless the side-chain snapshots control is enabled.',
    sources:{
      primaryLiterature:'https://pmc.ncbi.nlm.nih.gov/articles/PMC6377443/',
      viewer:'Mol* 5.11.0 · pinned local bundle',
    },
    receptor:{
      pdbId:'5OVE', proteinPdb, pocketPdb,
      pocket:{ cutoffAngstrom:5, residueCount:pocketKeys.size },
      focusResidues:[...SWITCH_RESIDUES].sort((left, right) => left - right),
    },
    overlaySphere:roundedSphere(allLigandAtoms),
    switchSphere:roundedSphere(switchAtoms),
    ligands,
  };

  await mkdir(path.join(options.outputDirectory, 'vendor'), { recursive:true });
  await Promise.all([
    copyFile(path.join(viewerDirectory, 'index.html'), path.join(options.outputDirectory, 'index.html')),
    copyFile(path.join(vendorDirectory, 'molstar-5.11.0.js'),
      path.join(options.outputDirectory, 'vendor/molstar-5.11.0.js')),
    copyFile(path.join(vendorDirectory, 'molstar-5.11.0.css'),
      path.join(options.outputDirectory, 'vendor/molstar-5.11.0.css')),
    copyFile(path.join(root, 'docking/validation/pose-viewer/MOLSTAR-LICENSE.txt'),
      path.join(options.outputDirectory, 'MOLSTAR-LICENSE.txt')),
    writeFile(path.join(options.outputDirectory, 'data.json'), `${JSON.stringify(data)}\n`),
  ]);

  const summary = ligands.map((ligand) =>
    `${ligand.pdbId}:${ligand.compound} ${ligand.alignment.rmsdAngstrom.toFixed(3)} Å`).join(', ');
  console.log(`wrote ${options.outputDirectory} · ${summary} · union pocket ${pocketKeys.size} residues`);
}

await main();
