#!/usr/bin/env node

import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  alignModels, atomsForResidue, coordinateSphere, parsePdb, sha256, subsetPdb,
} from '../design-history/structures/pipeline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewerDirectory = path.join(root, 'design-history/structure-review');
const vendorDirectory = path.join(root, 'docking/validation/pose-viewer/vendor');
const STANDARD_RESIDUES = new Set([
  'ALA','ARG','ASN','ASP','CYS','GLN','GLU','GLY','HIS','ILE',
  'LEU','LYS','MET','PHE','PRO','SER','THR','TRP','TYR','VAL',
]);
const SPECS = Object.freeze([
  { stepId:'scaffold-rewrite', stateId:'AWT', compound:'17', pdbId:'5OVF',
    ligand:{ resName:'AWT', chain:'A', resSeq:1101 }, color:'#397da8',
    point:'Scaffold rewrite; preserved hit-like Phe890 basin' },
  { stepId:'fragment-merge', stateId:'AWZ', compound:'18', pdbId:'5OVG',
    ligand:{ resName:'AWZ', chain:'A', resSeq:1101 }, color:'#4f9365',
    point:'Large fragment merge; Phe890 remains in' },
  { stepId:'open-phe890-pocket', stateId:'AWW', compound:'21', pdbId:'5OVH',
    ligand:{ resName:'AWW', chain:'A', resSeq:1101 }, color:'#c9832e',
    point:'Ambiguous ring placement coupled to predicted Phe890-out state' },
  { stepId:'finish-bay-293', stateId:'AXH', compound:'23', pdbId:'5OVI',
    ligand:{ resName:'AXH', chain:'A', resSeq:2001 }, color:'#c9554c',
    point:'Final BAY-293 growth inherited from the predicted open pocket' },
]);

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!name?.startsWith('--') || !value) throw new Error('Arguments must be --name value pairs');
    values[name.slice(2)] = value;
  }
  const runDirectory = path.resolve(values.run || path.join(root,
    'outputs/design-history/sos1-hit-only-growth-clash-v7'));
  return {
    runDirectory,
    sourceDirectory:path.resolve(values['source-dir'] || path.join(root,
      'outputs/design-history/sos1-preapproval/source')),
    outputDirectory:path.resolve(values.output || path.join(runDirectory, 'review')),
  };
}

function formatAtomName(value) {
  const name = String(value || 'X').slice(0, 4);
  return name.length < 4 ? ` ${name.padEnd(3)}` : name;
}

function pdbFromInspectionAtoms(atoms, { title, record = 'HETATM', resName = 'LIG',
  chain = 'L', resSeq = 1, proteinRecords = false } = {}) {
  const lines = [`HEADER    ${String(title || 'MOLARIUM STRUCTURE').slice(0, 40).padEnd(40)}`];
  let serial = 1;
  for (const atom of atoms) {
    const atomRecord = proteinRecords && STANDARD_RESIDUES.has(atom.residueName)
      ? 'ATOM' : record;
    const atomResidue = proteinRecords ? atom.residueName : resName;
    const atomChain = proteinRecords ? atom.chain || 'A' : chain;
    const atomResidueIndex = proteinRecords ? Number(atom.residueIndex) : resSeq;
    const [x,y,z] = atom.coordinatesAngstrom.map(Number);
    lines.push(`${atomRecord.padEnd(6)}${String(serial++).padStart(5)} ${formatAtomName(atom.atomName)}`
      + ` ${String(atomResidue).slice(0, 3).padStart(3)} ${String(atomChain).slice(0, 1)}`
      + `${String(atomResidueIndex).padStart(4)}    ${x.toFixed(3).padStart(8)}`
      + `${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}`
      + `  1.00 20.00          ${String(atom.element || '').slice(0, 2).padStart(2)}`);
  }
  lines.push('END');
  return `${lines.join('\n')}\n`;
}

function roundedSphere(atoms) {
  const sphere = coordinateSphere(atoms);
  return { center:sphere.center.map((value) => Number(value.toFixed(4))),
    radius:Number(sphere.radius.toFixed(4)) };
}

async function verifiedRun(runDirectory) {
  const manifestBytes = await readFile(path.join(runDirectory, 'prediction-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.status, 'predictions-frozen-holdouts-unopened');
  assert.equal(manifest.protocol.initialCoordinateInput, 'PDB 5OVE/AXE only');
  const checkpoints = new Map();
  for (const entry of manifest.checkpoints) {
    const bytes = await readFile(path.join(runDirectory, entry.filename));
    assert.equal(sha256(bytes), entry.sha256, `${entry.stepId}: frozen prediction hash changed`);
    const checkpoint = JSON.parse(bytes);
    assert.equal(checkpoint.frozenBeforeHoldoutAccess, true);
    checkpoints.set(entry.stepId, { entry, checkpoint });
  }
  const auditBytes = await readFile(path.join(runDirectory, 'chemist-action-audit.json'));
  assert.equal(sha256(auditBytes), manifest.agentApi.auditSha256, 'Agent API audit hash changed');
  const campaignBytes = await readFile(path.join(root, manifest.inputs.campaign.path));
  assert.equal(sha256(campaignBytes), manifest.inputs.campaign.sha256, 'campaign hash changed');
  const runnerBytes = await readFile(path.join(root, manifest.inputs.runner.path));
  assert.equal(sha256(runnerBytes), manifest.inputs.runner.sha256, 'runner hash changed');
  const evaluationBytes = await readFile(path.join(runDirectory, 'holdout-evaluation-summary.json'));
  const evaluation = JSON.parse(evaluationBytes);
  assert.equal(evaluation.predictionManifestSha256, sha256(manifestBytes));
  assert.equal(evaluation.holdoutsOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified, true);
  const evaluationDetails = new Map();
  for (const summary of evaluation.results) {
    const detailBytes = await readFile(path.join(runDirectory,
      `${summary.stepId}-holdout-evaluation.json`));
    const detail = JSON.parse(detailBytes);
    assert.equal(detail.boundary.predictionManifestSha256, sha256(manifestBytes));
    assert.equal(detail.boundary.holdoutOpenedOnlyAfterAllFreezeHashesAndAgentAuditVerified,
      true);
    evaluationDetails.set(summary.stepId, { ...summary, holdout:detail.holdout,
      evaluationSha256:sha256(detailBytes) });
  }
  return { manifestBytes, manifest, checkpoints, evaluationBytes, evaluation,
    evaluationDetails };
}

function predictionEntry(spec, frozen, evaluation) {
  const ligandAtoms = frozen.checkpoint.ligand.atoms.filter((atom) => atom.element !== 'H');
  const focusAtoms = frozen.checkpoint.pocket.atoms.filter((atom) => atom.residueName === 'PHE'
    && atom.chain === 'A' && Number(atom.residueIndex) === 890 && atom.element !== 'H');
  const ligandPdb = pdbFromInspectionAtoms(ligandAtoms, {
    title:`${spec.stateId} frozen prospective prediction`, resName:spec.stateId,
  });
  const focusPdb = pdbFromInspectionAtoms(focusAtoms, {
    title:`${spec.stateId} predicted Phe890`, proteinRecords:true,
  });
  return {
    id:`${spec.stateId.toLowerCase()}-prediction`, pdbId:'5OVE-only', compound:spec.compound,
    sourceLabel:`${spec.stateId} prediction`, label:`${spec.compound} · frozen prediction`,
    badge:'pred', designPoint:spec.point, color:spec.color, coordinateClass:'prospective-prediction',
    heavyAtomCount:ligandAtoms.length, ligandPdb, focusPdb,
    sphere:roundedSphere(parsePdb(ligandPdb).atoms), alignment:{ rmsdAngstrom:0 },
    metricDisplay:`${evaluation.ligandRmsdAngstrom.toFixed(2)} Å`,
    defaultVisible:spec.stepId === 'open-phe890-pocket' || spec.stepId === 'finish-bay-293',
    source:{ url:'#provenance', sha256:frozen.entry.sha256 },
  };
}

function holdoutEntry(spec, alignedModel, alignment, evaluation, sourceHash) {
  const ligandAtoms = atomsForResidue(alignedModel, spec.ligand);
  assert(ligandAtoms.length, `${spec.pdbId}: evaluation ligand unavailable`);
  const ligandPdb = subsetPdb(alignedModel, (atom) => atom.record === 'HETATM'
    && atom.resName === spec.ligand.resName && atom.chain === spec.ligand.chain
    && atom.resSeq === spec.ligand.resSeq, `${spec.pdbId} evaluation ligand`);
  const focusPdb = subsetPdb(alignedModel, (atom) => atom.record === 'ATOM'
    && atom.chain === 'A' && atom.resName === 'PHE' && atom.resSeq === 890,
  `${spec.pdbId} evaluation Phe890`);
  return {
    id:`${spec.stateId.toLowerCase()}-crystal`, pdbId:spec.pdbId, compound:spec.compound,
    sourceLabel:`${spec.pdbId} crystal`, label:`${spec.compound} · evaluation crystal`,
    badge:'x-ray', designPoint:'Opened only after every prediction and Agent API hash passed',
    color:'#71a9c4', coordinateClass:'evaluation-only-holdout',
    heavyAtomCount:ligandAtoms.filter((atom) => atom.element !== 'H').length,
    ligandPdb, focusPdb, sphere:roundedSphere(ligandAtoms),
    alignment:{ rmsdAngstrom:Number(alignment.rmsd.toFixed(6)) },
    metricDisplay:`${evaluation.ligandRmsdAngstrom.toFixed(2)} Å`,
    defaultVisible:spec.stepId === 'open-phe890-pocket' || spec.stepId === 'finish-bay-293',
    source:{ url:`https://www.rcsb.org/structure/${spec.pdbId}`, sha256:sourceHash },
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const verified = await verifiedRun(options.runDirectory);
  const evaluationByStep = verified.evaluationDetails;
  const firstFrozen = verified.checkpoints.get(SPECS[0].stepId).checkpoint;
  const referencePocketPdb = pdbFromInspectionAtoms(firstFrozen.pocket.atoms, {
    title:'Frozen prospective SOS1 pocket', proteinRecords:true,
  });
  const referencePocket = parsePdb(referencePocketPdb);
  const hitBytes = await readFile(path.join(options.sourceDirectory, '5OVE.pdb'));
  const alignedHit = alignModels(referencePocket, parsePdb(hitBytes), 'A', 'A');
  const hitLigandAtoms = atomsForResidue(alignedHit.model,
    { resName:'AXE', chain:'A', resSeq:1104 });
  const hitLigandPdb = subsetPdb(alignedHit.model, (atom) => atom.record === 'HETATM'
    && atom.resName === 'AXE' && atom.chain === 'A' && atom.resSeq === 1104,
  '5OVE AXE sole coordinate input');
  const hitFocusPdb = subsetPdb(alignedHit.model, (atom) => atom.record === 'ATOM'
    && atom.chain === 'A' && atom.resName === 'PHE' && atom.resSeq === 890,
  '5OVE starting Phe890');
  const ligands = [{
    id:'hit', pdbId:'5OVE', compound:'1', sourceLabel:'5OVE hit',
    label:'1 · sole starting crystal', badge:'start',
    designPoint:'Only registered coordinate input for every prospective step', color:'#8064a2',
    coordinateClass:'registered-hit-only', heavyAtomCount:hitLigandAtoms.length,
    ligandPdb:hitLigandPdb, focusPdb:hitFocusPdb, sphere:roundedSphere(hitLigandAtoms),
    alignment:{ rmsdAngstrom:Number(alignedHit.rmsd.toFixed(6)) }, metricDisplay:'input',
    defaultVisible:true, source:{ url:'https://www.rcsb.org/structure/5OVE', sha256:sha256(hitBytes) },
  }];

  for (const spec of SPECS) {
    const frozen = verified.checkpoints.get(spec.stepId);
    const evaluation = evaluationByStep.get(spec.stepId);
    assert(frozen && evaluation, `${spec.stepId}: review registration incomplete`);
    const holdoutPath = path.join(options.sourceDirectory, `${spec.pdbId}.pdb`);
    const holdoutBytes = await readFile(holdoutPath);
    assert.equal(sha256(holdoutBytes), evaluation.holdout.coordinateSha256,
      `${spec.pdbId}: evaluation coordinate hash changed`);
    const predictedPocket = parsePdb(pdbFromInspectionAtoms(frozen.checkpoint.pocket.atoms, {
      title:`${spec.stateId} predicted pocket`, proteinRecords:true,
    }));
    const alignedHoldout = alignModels(predictedPocket, parsePdb(holdoutBytes), 'A', 'A');
    ligands.push(predictionEntry(spec, frozen, evaluation));
    ligands.push(holdoutEntry(spec, alignedHoldout.model, alignedHoldout, evaluation,
      sha256(holdoutBytes)));
  }

  const allLigandAtoms = ligands.flatMap((entry) => parsePdb(entry.ligandPdb).atoms);
  const allFocusAtoms = ligands.flatMap((entry) => parsePdb(entry.focusPdb).atoms);
  const proteinPdb = subsetPdb(alignedHit.model, (atom) => atom.record === 'ATOM'
    && atom.chain === 'A', '5OVE sole starting receptor aligned to prospective frame');
  const pocketPdb = pdbFromInspectionAtoms(firstFrozen.pocket.atoms.filter((atom) =>
    STANDARD_RESIDUES.has(atom.residueName) && atom.element !== 'H'), {
    title:'Frozen prospective contact pocket', proteinRecords:true,
  });
  const data = {
    schema:'molarium.structure-overlay-review/v1', id:'sos1-v7-prediction-review',
    title:'SOS1 prospective prediction review',
    subtitle:'Frozen hit-only predictions against post-freeze crystal evaluation',
    boundary:'Only 5OVE/AXE seeded the trajectory. 5OVF–5OVI were opened after all prediction and Agent API hashes passed.',
    labels:{ ligandHeading:'Prediction / crystal pairs', focusButton:'Focus Phe890 region',
      protein:'5OVE starting receptor cartoon', pocket:'Frozen prospective contact pocket',
      focusSnapshots:'Color-matched Phe890 snapshots', alignmentHeading:'Prospective result by state',
      alignmentNote:'The right column is symmetry-minimized ligand RMSD after receptor Cα alignment; no ligand fitting was performed.',
      metricHeading:'Ligand RMSD', statusPill:'Frozen vs X-ray' },
    sources:{ primaryLiterature:'https://pmc.ncbi.nlm.nih.gov/articles/PMC6377443/',
      viewer:'Mol* 5.11.0 · pinned local bundle',
      predictionManifestSha256:sha256(verified.manifestBytes),
      evaluationSummarySha256:sha256(verified.evaluationBytes) },
    receptor:{ pdbId:'5OVE', proteinPdb, pocketPdb,
      pocket:{ cutoffAngstrom:5, residueCount:new Set(firstFrozen.pocket.atoms
        .filter((atom) => STANDARD_RESIDUES.has(atom.residueName))
        .map((atom) => `${atom.chain}:${atom.residueIndex}:${atom.residueName}`)).size },
      focusResidues:[890] },
    overlaySphere:roundedSphere(allLigandAtoms), switchSphere:roundedSphere(allFocusAtoms), ligands,
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
  console.log(`wrote ${path.relative(root, options.outputDirectory)} · ${ligands.length} selectable structures`);
}

await main();
