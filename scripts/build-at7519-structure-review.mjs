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
    pdbId:'2VTA', compound:'6', ligand:{ resName:'LZ1', chain:'A', resSeq:1301 },
    label:'Compound 6 · indazole hit · 185 µM', color:'#8064a2',
    designPoint:'Minimal 1H-indazole hinge-binding hit',
  },
  {
    pdbId:'2VTL', compound:'15', ligand:{ resName:'LZ5', chain:'A', resSeq:1299 },
    label:'Compound 15 · scaffold hop · 97 µM', color:'#327fa1',
    designPoint:'N-phenyl pyrazole-3-carboxamide establishes two plausible amide vectors',
  },
  {
    pdbId:'2VTN', compound:'18', ligand:{ resName:'LZ7', chain:'A', resSeq:1299 },
    label:'Compound 18 · acetamide growth · 0.85 µM', color:'#5a9a68',
    designPoint:'C4 acetamide captures a water-mediated Asp145 interaction',
  },
  {
    pdbId:'2VTO', compound:'22', ligand:{ resName:'LZ8', chain:'A', resSeq:1299 },
    label:'Compound 22 · benzamide growth · 0.14 µM', color:'#cf9335',
    designPoint:'Acetamide-to-benzamide expansion occupies the hydrophobic channel',
  },
  {
    pdbId:'2VTP', compound:'23', ligand:{ resName:'LZ9', chain:'A', resSeq:1299 },
    label:'Compound 23 · difluoro lock · 3 nM', color:'#d36350',
    designPoint:'2,6-difluoro substitution locks the productive benzamide torsion',
  },
  {
    pdbId:'2VU3', compound:'33 / AT7519', ligand:{ resName:'LZE', chain:'A', resSeq:1299 },
    label:'Compound 33 · AT7519 · 47 nM CDK2', color:'#ba4d83',
    designPoint:'Terminal piperidine rewrite improves cellular and pharmacokinetic properties',
  },
]);

const FOCUS_RESIDUES = new Set([80, 81, 82, 83, 86, 145]);

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error('Arguments must be --name value pairs');
    values[name.slice(2)] = value;
  }
  return {
    sourceDirectory:path.resolve(values['source-dir'] || path.join(root,
      'outputs/design-history/at7519-preapproval/source')),
    outputDirectory:path.resolve(values.output || path.join(root,
      'outputs/design-history/at7519-preapproval/review')),
  };
}

function roundedSphere(atoms) {
  const sphere = coordinateSphere(atoms);
  return { center:sphere.center.map((value) => Number(value.toFixed(4))),
    radius:Number(sphere.radius.toFixed(4)) };
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
      reference:'2VTA chain A', mobile:'2VTA chain A', pairedAlphaCarbons:
        entry.model.atoms.filter((atom) => atom.record === 'ATOM' && atom.chain === 'A'
          && atom.atomName === 'CA').length,
      rmsdAngstrom:0,
    } };
    const fit = alignModels(reference.model, entry.model, 'A', 'A');
    return { ...entry, alignedModel:fit.model, alignment:{
      reference:'2VTA chain A', mobile:`${entry.spec.pdbId} chain A`,
      pairedAlphaCarbons:fit.pairs, rmsdAngstrom:Number(fit.rmsd.toFixed(6)),
      rotation:fit.rotation.map((row) => row.map((value) => Number(value.toFixed(12)))),
      translation:fit.translation.map((value) => Number(value.toFixed(12))),
    } };
  });

  const ligands = aligned.map((entry) => {
    const atoms = atomsForResidue(entry.alignedModel, entry.spec.ligand);
    if (!atoms.length) throw new Error(`${entry.spec.pdbId}: ligand was not found`);
    return {
      id:`compound-${entry.spec.compound.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
      pdbId:entry.spec.pdbId, compound:entry.spec.compound,
      label:entry.spec.label, designPoint:entry.spec.designPoint, color:entry.spec.color,
      coordinateClass:'experimental',
      ligandResidue:`${entry.spec.ligand.resName} ${entry.spec.ligand.chain} ${entry.spec.ligand.resSeq}`,
      heavyAtomCount:atoms.filter((atom) => atom.element !== 'H').length,
      ligandPdb:subsetPdb(entry.alignedModel, (atom) => atom.record === 'HETATM'
        && atom.resName === entry.spec.ligand.resName && atom.chain === entry.spec.ligand.chain
        && atom.resSeq === entry.spec.ligand.resSeq,
      `${entry.spec.pdbId} compound ${entry.spec.compound} aligned to 2VTA`),
      focusPdb:subsetPdb(entry.alignedModel, (atom) => atom.record === 'ATOM'
        && atom.chain === 'A' && FOCUS_RESIDUES.has(atom.resSeq),
      `${entry.spec.pdbId} selected CDK2 pocket residues aligned to 2VTA`),
      sphere:roundedSphere(atoms), alignment:entry.alignment,
      source:{ url:`https://www.rcsb.org/structure/${entry.spec.pdbId}`,
        sha256:entry.sha256 },
    };
  });

  const allLigandAtoms = aligned.flatMap((entry) => atomsForResidue(entry.alignedModel,
    entry.spec.ligand));
  const focusAtoms = aligned.flatMap((entry) => entry.alignedModel.atoms.filter((atom) =>
    atom.record === 'ATOM' && atom.chain === 'A' && FOCUS_RESIDUES.has(atom.resSeq)));
  const pocketKeys = pocketResidues(reference.model, allLigandAtoms, 5);
  const data = {
    schema:'molarium.structure-overlay-review/v1', id:'at7519-six-structure-preapproval',
    title:'CDK2 → AT7519 structure preapproval',
    subtitle:'Six experimental ligands · five non-trivial design transformations',
    boundary:'The displayed receptor is the 2VTA hit structure. Later protein coordinates remain hidden unless local snapshots are explicitly enabled.',
    labels:{
      focusButton:'Focus growth envelope',
      protein:'2VTA hit receptor cartoon',
      pocket:'Union contact shell within 5 Å',
      focusSnapshots:'Color-matched local pocket snapshots',
      alignmentHeading:'Alignment into 2VTA',
      alignmentNote:'Whole-chain Cα RMSD is used only to place each experimental ligand in the 2VTA hit coordinate frame.',
    },
    sources:{ primaryLiterature:'https://pubs.acs.org/doi/10.1021/jm800382h',
      viewer:'Mol* 5.11.0 · pinned local bundle' },
    receptor:{
      pdbId:'2VTA',
      proteinPdb:subsetPdb(reference.model, (atom) => atom.record === 'ATOM'
        && atom.chain === 'A', '2VTA starting CDK2 receptor'),
      pocketPdb:subsetPdb(reference.model, (atom) => atom.record === 'ATOM'
        && atom.chain === 'A'
        && pocketKeys.has(`${atom.chain}:${atom.resSeq}:${atom.iCode}:${atom.resName}`),
      '2VTA receptor union 5 A shell around aligned ligands'),
      pocket:{ cutoffAngstrom:5, residueCount:pocketKeys.size },
      focusResidues:[...FOCUS_RESIDUES].sort((left, right) => left - right),
    },
    overlaySphere:roundedSphere(allLigandAtoms), switchSphere:roundedSphere(focusAtoms), ligands,
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
  console.log(`wrote ${options.outputDirectory} · ${ligands.map((ligand) =>
    `${ligand.pdbId}:${ligand.compound} ${ligand.alignment.rmsdAngstrom.toFixed(3)} Å`).join(', ')} · union pocket ${pocketKeys.size} residues`);
}

await main();
