#!/usr/bin/env node

import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  alignModels, coordinateSphere, parsePdb, sha256, subsetPdb,
} from '../design-history/structures/pipeline.mjs';
import { SOS1_AWW_REVIEW_CAPTURE_SCHEMA }
  from './sos1-aww-review-capture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewerDirectory = path.join(root, 'design-history/structure-review');
const vendorDirectory = path.join(root, 'docking/validation/pose-viewer/vendor');
const FACTORIAL_SCHEMA = 'molarium.sos1-aww-designer-contact-factorial/v2';
const REVIEW_SCHEMA = 'molarium.structure-overlay-review/v1';
const LEGACY_DIAGNOSTIC_CAPTURE_SCHEMA =
  'molarium.sos1-aww-diagnostic-coordinate-review/v1';
const STANDARD_RESIDUES = new Set([
  'ALA','ARG','ASN','ASP','CYS','GLN','GLU','GLY','HIS','ILE',
  'LEU','LYS','MET','PHE','PRO','SER','THR','TRP','TYR','VAL',
]);
const BRANCHES = Object.freeze([
  Object.freeze({ id:'phe-native', pheState:'native', label:'Native Phe890', color:'#268a73' }),
  Object.freeze({ id:'phe-plus60', pheState:'plus60', label:'Phe890 +60°', color:'#487db8' }),
  Object.freeze({ id:'phe-out', pheState:'out', label:'Phe890 out', color:'#cc8832' }),
]);

function formatAtomName(value) {
  const name = String(value || 'X').slice(0, 4);
  return name.length < 4 ? ` ${name.padEnd(3)}` : name;
}

export function pdbFromInspectionAtoms(atoms, { title,
  proteinRecords = false } = {}) {
  assert(Array.isArray(atoms) && atoms.length, 'A review PDB requires atoms');
  const lines = [`HEADER    ${String(title || 'MOLARIUM STRUCTURE').slice(0, 40).padEnd(40)}`];
  for (const [index, atom] of atoms.entries()) {
    assert(Array.isArray(atom.coordinatesAngstrom)
      && atom.coordinatesAngstrom.length === 3
      && atom.coordinatesAngstrom.every(Number.isFinite),
    `${atom.atomId || atom.atomName || index}: coordinates are incomplete`);
    const record = proteinRecords && STANDARD_RESIDUES.has(atom.residueName)
      ? 'ATOM' : 'HETATM';
    const [x,y,z] = atom.coordinatesAngstrom;
    lines.push(`${record.padEnd(6)}${String(index + 1).padStart(5)} ${formatAtomName(atom.atomName)}`
      + ` ${String(atom.residueName || 'LIG').slice(0, 3).padStart(3)}`
      + ` ${String(atom.chain || 'A').slice(0, 1)}${String(atom.residueIndex || 1).padStart(4)}`
      + `    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}`
      + `${z.toFixed(3).padStart(8)}  1.00 20.00          `
      + `${String(atom.element || '').slice(0, 2).padStart(2)}`);
  }
  lines.push('END');
  return `${lines.join('\n')}\n`;
}

function finite(value, label) {
  const number = Number(value);
  assert(Number.isFinite(number), `${label} must be finite`);
  return number;
}

function digest(value, label) {
  assert.match(String(value || ''), /^[a-f0-9]{64}$/,
    `${label} must be a lowercase SHA-256 digest`);
  return String(value);
}

function roundedSphere(atoms) {
  const sphere = coordinateSphere(atoms.map((atom) => {
    if (Number.isFinite(atom.x) && Number.isFinite(atom.y) && Number.isFinite(atom.z))
      return atom;
    const [x,y,z] = atom.coordinatesAngstrom || [];
    assert([x,y,z].every(Number.isFinite),
      `${atom.atomId || atom.atomName || 'atom'}: sphere coordinates are incomplete`);
    return { ...atom, x, y, z };
  }));
  return { center:sphere.center.map((value) => Number(value.toFixed(4))),
    radius:Number(sphere.radius.toFixed(4)) };
}

function heavyAtoms(atoms, predicate) {
  return atoms.filter((atom) => atom.element !== 'H' && predicate(atom));
}

function ox3Tyr884Contact(artifact) {
  const matches = (artifact.pocket?.contacts || []).filter((contact) =>
    String(contact.label || '').includes('AWW A1104 OX3')
      && String(contact.label || '').includes('TYR A884 O'));
  assert.equal(matches.length, 1,
    `${artifact.branch}: expected one OX3 to Tyr884 backbone-O contact annotation`);
  const hydrogenBond = matches[0].hydrogenBond;
  assert(hydrogenBond, `${artifact.branch}: OX3 contact has no hydrogen-bond evidence`);
  for (const role of ['donor','hydrogen','acceptor']) {
    const point = hydrogenBond.participants?.[role]?.coordinatesAngstrom;
    assert(Array.isArray(point) && point.length === 3 && point.every(Number.isFinite),
      `${artifact.branch}: OX3 contact lacks ${role} coordinates`);
  }
  return {
    contactId:matches[0].contactId,
    satisfied:hydrogenBond.satisfied === true,
    donorAcceptorDistanceAngstrom:finite(
      hydrogenBond.donorAcceptorDistanceAngstrom, `${artifact.branch}: OX3 D-A distance`),
    hydrogenAcceptorDistanceAngstrom:finite(
      hydrogenBond.hydrogenAcceptorDistanceAngstrom, `${artifact.branch}: OX3 H-A distance`),
    dhaAngleDegrees:finite(hydrogenBond.dhaAngleDegrees,
      `${artifact.branch}: OX3 D-H-A angle`),
  };
}

function validateBranch(artifact, spec, artifactSha256) {
  assert.equal(artifact?.schema, FACTORIAL_SCHEMA,
    `${spec.id}: unsupported factorial artifact`);
  assert.equal(artifact.branch, spec.id, `${spec.id}: branch identity changed`);
  assert.equal(artifact.pheState, spec.pheState, `${spec.id}: Phe state changed`);
  assert.equal(artifact.holdoutCoordinatesUsed, false,
    `${spec.id}: holdout coordinates are forbidden in diagnostic review`);
  assert.equal(artifact.sourceStateId, 'AWZ');
  assert.equal(artifact.predictedStateId, 'AWW');
  assert.equal(typeof artifact.eligible, 'boolean');
  assert(artifact.prospectiveGates && typeof artifact.prospectiveGates === 'object');
  assert(Object.values(artifact.prospectiveGates).every((value) => typeof value === 'boolean'),
    `${spec.id}: prospective gates must be boolean`);
  assert.equal(artifact.eligible, Object.values(artifact.prospectiveGates).every(Boolean),
    `${spec.id}: eligibility differs from the frozen gates`);
  const capture = artifact.reviewCoordinateCapture;
  assert([LEGACY_DIAGNOSTIC_CAPTURE_SCHEMA, SOS1_AWW_REVIEW_CAPTURE_SCHEMA]
    .includes(capture?.schema),
    `${spec.id}: explicit diagnostic coordinate capture is required`);
  assert.equal(capture.requested, true);
  assert.equal(capture.diagnosticOnly, true);
  assert.equal(capture.promotable, false);
  assert.equal(capture.branch, spec.id);
  assert.equal(artifact.eligible, false,
    `${spec.id}: this viewer accepts rejected branches only`);
  if (capture.schema === SOS1_AWW_REVIEW_CAPTURE_SCHEMA) {
    assert.equal(capture.disposition, 'rejected-nonpromotable',
      `${spec.id}: current capture disposition is not rejected`);
    assert.equal(capture.prospectiveEligible, artifact.eligible,
      `${spec.id}: capture eligibility differs from the prospective result`);
    assert.equal(capture.eligibilityUnchanged, true,
      `${spec.id}: review capture changed prospective eligibility`);
  } else {
    assert.equal(capture.disposition, undefined,
      `${spec.id}: legacy capture has unexpected current-schema disposition`);
    assert.equal(capture.prospectiveEligible, undefined,
      `${spec.id}: legacy capture has unexpected current-schema eligibility`);
    assert.equal(capture.eligibilityUnchanged, artifact.eligible,
      `${spec.id}: legacy capture eligibility differs from the prospective result`);
  }
  assert.equal(capture.selectedFeasible, artifact.prospectiveGates.selectedFeasible === true,
    `${spec.id}: capture feasibility differs from the frozen gate`);
  assert(Number.isInteger(capture.selectedRank) && capture.selectedRank >= 1,
    `${spec.id}: capture selected rank is invalid`);
  assert.equal(capture.appliedPoseIndex, capture.selectedRank - 1,
    `${spec.id}: capture applied a different ranked pose`);
  assert.equal(capture.allowInfeasible, true,
    `${spec.id}: review coordinates must use the guarded diagnostic path`);
  assert.equal(capture.infeasibleOverride, true,
    `${spec.id}: rejected pose was not applied through the infeasible override`);
  assert.match(String(capture.purpose || ''),
    /never production selection or promotion evidence/i,
    `${spec.id}: capture purpose does not forbid promotion`);
  for (const key of ['selectedCoordinateSha256','selectedStateSha256',
    'outputCoordinateSha256','outputStateSha256']) digest(capture[key], `${spec.id}.${key}`);
  assert.equal(artifact.pocket?.scope, 'pocket');
  assert.equal(artifact.pocket?.truncated, false,
    `${spec.id}: coordinate-bearing pocket is truncated`);
  assert.equal(artifact.pocket?.atoms?.length, artifact.pocket?.totalAtomCount,
    `${spec.id}: pocket atom count is incomplete`);
  assert.equal(capture.pocketAtomCount, artifact.pocket.atoms.length,
    `${spec.id}: capture/pocket atom counts differ`);
  assert.equal(capture.contactAnnotationCount, artifact.pocket.contacts?.length || 0,
    `${spec.id}: capture/contact annotation counts differ`);
  digest(artifactSha256, `${spec.id} artifact SHA-256`);

  const ligandAtoms = heavyAtoms(artifact.pocket.atoms,
    (atom) => atom.residueName === 'AWW');
  const pheAtoms = heavyAtoms(artifact.pocket.atoms, (atom) => atom.residueName === 'PHE'
    && atom.chain === 'A' && Number(atom.residueIndex) === 890);
  assert(ligandAtoms.length, `${spec.id}: AWW ligand coordinates are missing`);
  assert(pheAtoms.length, `${spec.id}: Phe890 coordinates are missing`);
  const failedGates = Object.entries(artifact.prospectiveGates)
    .filter(([,passed]) => passed !== true).map(([gate]) => gate).sort();
  assert(failedGates.length, `${spec.id}: diagnostic review requires a rejected branch`);
  return { artifact, spec, artifactSha256, capture, ligandAtoms, pheAtoms,
    failedGates, contact:ox3Tyr884Contact(artifact) };
}

function contactMetric(contact) {
  return `${contact.donorAcceptorDistanceAngstrom.toFixed(2)} / `
    + `${contact.hydrogenAcceptorDistanceAngstrom.toFixed(2)} Å · `
    + `${contact.dhaAngleDegrees.toFixed(1)}°`;
}

export function buildSos1AwwFactorialReviewData({ artifacts, artifactSha256,
  pdbText, pdbSha256 }) {
  assert.equal(artifacts?.length, BRANCHES.length,
    'AWW review requires native, +60°, and out branches');
  const byBranch = new Map(artifacts.map((artifact) => [artifact.branch, artifact]));
  const reviewed = BRANCHES.map((spec) => validateBranch(byBranch.get(spec.id), spec,
    artifactSha256?.[spec.id]));
  assert.equal(byBranch.size, BRANCHES.length, 'AWW review contains duplicate or unknown branches');
  digest(pdbSha256, '5OVE SHA-256');

  const referencePocketPdb = pdbFromInspectionAtoms(reviewed[0].artifact.pocket.atoms,
    { title:'AWW diagnostic native pocket', proteinRecords:true });
  const aligned = alignModels(parsePdb(referencePocketPdb), parsePdb(pdbText), 'A', 'A');
  const proteinPdb = subsetPdb(aligned.model, (atom) => atom.record === 'ATOM'
    && atom.chain === 'A', '5OVE receptor aligned to AWW diagnostic frame');
  const backgroundAtoms = heavyAtoms(reviewed[0].artifact.pocket.atoms,
    (atom) => STANDARD_RESIDUES.has(atom.residueName)
      && !(atom.residueName === 'PHE' && atom.chain === 'A'
        && Number(atom.residueIndex) === 890));
  const pocketPdb = pdbFromInspectionAtoms(backgroundAtoms,
    { title:'AWW diagnostic pocket without branch Phe890', proteinRecords:true });
  const allLigandAtoms = reviewed.flatMap((entry) => entry.ligandAtoms);
  const allFocusAtoms = reviewed.flatMap((entry) => entry.pheAtoms);

  const ligands = reviewed.map((entry, index) => {
    const failed = entry.failedGates.length
      ? `Failed gates: ${entry.failedGates.join(', ')}`
      : 'No failed prospective gate; diagnostic capture is still nonpromotable';
    return {
      id:entry.spec.id, pdbId:'5OVE-only', compound:entry.spec.pheState,
      sourceLabel:`${entry.spec.label} diagnostic artifact`,
      label:`${entry.spec.label} · ${entry.failedGates.length ? 'REJECTED' : 'diagnostic only'}`,
      badge:entry.failedGates.length ? 'rejected' : 'nonpromotable',
      designPoint:`${failed}. OX3→Tyr884 O: D–A ${entry.contact.donorAcceptorDistanceAngstrom.toFixed(2)} Å; H–A ${entry.contact.hydrogenAcceptorDistanceAngstrom.toFixed(2)} Å; D–H···A ${entry.contact.dhaAngleDegrees.toFixed(1)}°${entry.contact.satisfied ? '' : '; contact unsatisfied'}.`,
      color:entry.spec.color, coordinateClass:'diagnostic-nonpromotable',
      heavyAtomCount:entry.ligandAtoms.length,
      ligandPdb:pdbFromInspectionAtoms(entry.ligandAtoms,
        { title:`AWW ${entry.spec.id} selected diagnostic pose` }),
      focusPdb:pdbFromInspectionAtoms(entry.pheAtoms,
        { title:`AWW ${entry.spec.id} Phe890`, proteinRecords:true }),
      sphere:roundedSphere(entry.ligandAtoms), alignment:{ rmsdAngstrom:0 },
      metricDisplay:contactMetric(entry.contact), defaultVisible:index === 0,
      source:{ url:`artifacts/${entry.spec.id}.json`, sha256:entry.artifactSha256 },
      review:{ promotable:false, eligible:entry.artifact.eligible,
        failedGates:entry.failedGates, contact:entry.contact,
        capture:entry.capture },
    };
  });

  const residueCount = new Set(backgroundAtoms.map((atom) =>
    `${atom.chain}:${atom.residueIndex}:${atom.insertionCode || ''}:${atom.residueName}`)).size;
  return {
    schema:REVIEW_SCHEMA, id:'sos1-aww-factorial-diagnostic-review',
    title:'Rejected AWW receptor-state proxy poses',
    subtitle:'Three independently selectable, coordinate-bearing diagnostic branches',
    boundary:'DIAGNOSTIC REVIEW ONLY · NONPROMOTABLE. Coordinates were captured after prospective gates were frozen, using the guarded allowInfeasible review path. They cannot select, rescue, or promote a branch; 5OVH was not opened.',
    labels:{ ligandHeading:'Rejected / diagnostic branches',
      firstOnlyButton:'Native branch only', focusButton:'Focus Phe890 region',
      protein:'5OVE-only starting receptor cartoon',
      pocket:'Common AWW pocket; branch-specific Phe890 excluded',
      focusSnapshots:'Branch-specific Phe890 snapshots',
      focusSnapshotsDefaultVisible:true,
      alignmentHeading:'Prospective gate and contact audit',
      alignmentNote:'OX3 geometry is read from each captured public-API contact annotation. Values are D–A / H–A distances and D–H···A angle. These are rejected diagnostic poses, not predictions or promotion evidence.',
      metricHeading:'OX3→Tyr884 O', statusPill:'Nonpromotable', statusTone:'reject' },
    sources:{ primaryLiterature:'https://pmc.ncbi.nlm.nih.gov/articles/PMC6377443/',
      viewer:'Mol* 5.11.0 · pinned local bundle', pdbSha256 },
    receptor:{ pdbId:'5OVE-only', proteinPdb, pocketPdb,
      pocket:{ cutoffAngstrom:5, residueCount }, focusResidues:[884,890] },
    overlaySphere:roundedSphere([...allLigandAtoms, ...allFocusAtoms]),
    switchSphere:roundedSphere(allFocusAtoms), ligands,
  };
}

function argumentsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!name?.startsWith('--') || !value)
      throw new Error('Arguments must be --name value pairs');
    values[name.slice(2)] = value;
  }
  for (const key of ['native','plus60','out','pdb','output']) if (!values[key])
    throw new Error('Usage: build-sos1-aww-factorial-review.mjs --native PHE_NATIVE.json --plus60 PHE_PLUS60.json --out PHE_OUT.json --pdb 5OVE.pdb --output DIRECTORY');
  return { ...values, output:path.resolve(values.output) };
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const entries = await Promise.all(BRANCHES.map(async (spec) => {
    const key = spec.pheState === 'native' ? 'native' : spec.pheState;
    const bytes = await readFile(options[key]);
    return { spec, bytes, artifact:JSON.parse(bytes) };
  }));
  const pdbBytes = await readFile(options.pdb);
  const data = buildSos1AwwFactorialReviewData({
    artifacts:entries.map((entry) => entry.artifact),
    artifactSha256:Object.fromEntries(entries.map((entry) =>
      [entry.spec.id, sha256(entry.bytes)])),
    pdbText:pdbBytes.toString('utf8'), pdbSha256:sha256(pdbBytes),
  });
  await mkdir(path.join(options.output, 'vendor'), { recursive:true });
  await mkdir(path.join(options.output, 'artifacts'), { recursive:true });
  await Promise.all([
    copyFile(path.join(viewerDirectory, 'index.html'), path.join(options.output, 'index.html')),
    copyFile(path.join(vendorDirectory, 'molstar-5.11.0.js'),
      path.join(options.output, 'vendor/molstar-5.11.0.js')),
    copyFile(path.join(vendorDirectory, 'molstar-5.11.0.css'),
      path.join(options.output, 'vendor/molstar-5.11.0.css')),
    copyFile(path.join(root, 'docking/validation/pose-viewer/MOLSTAR-LICENSE.txt'),
      path.join(options.output, 'MOLSTAR-LICENSE.txt')),
    ...entries.map((entry) => copyFile(options[entry.spec.pheState === 'native'
      ? 'native' : entry.spec.pheState],
    path.join(options.output, 'artifacts', `${entry.spec.id}.json`))),
    writeFile(path.join(options.output, 'data.json'), `${JSON.stringify(data)}\n`),
  ]);
  console.log(`wrote ${options.output} · 3 rejected/nonpromotable AWW branches`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
