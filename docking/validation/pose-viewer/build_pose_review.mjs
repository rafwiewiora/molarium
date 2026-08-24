#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parsePdbAtom(line) {
  if (!line.startsWith('ATOM  ') && !line.startsWith('HETATM')) return null;
  return {
    record:line.slice(0, 6).trim(), serial:Number(line.slice(6, 11)), atomName:line.slice(12, 16).trim(),
    residueName:line.slice(17, 20).trim(), chain:line.slice(21, 22), residueNumber:line.slice(22, 26).trim(),
    insertionCode:line.slice(26, 27), x:Number(line.slice(30, 38)), y:Number(line.slice(38, 46)),
    z:Number(line.slice(46, 54)), line
  };
}

function writePdbCoordinates(line, [x, y, z]) {
  return `${line.slice(0, 30)}${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}`
    + `${z.toFixed(3).padStart(8)}${line.slice(54)}`;
}

function inferTranslation(referenceMolecule, pdbText) {
  const pdbBySerial = new Map(pdbText.split(/\r?\n/).map(parsePdbAtom).filter(Boolean)
    .map((atom) => [atom.serial, atom]));
  const deltas = [];
  for (const atom of referenceMolecule.atoms) {
    const serial = Number(atom.atomId?.match(/:(\d+)$/)?.[1]);
    const pdb = pdbBySerial.get(serial);
    if (pdb && atom.element !== 'H') deltas.push([atom.x - pdb.x, atom.y - pdb.y, atom.z - pdb.z]);
  }
  if (deltas.length < 3) throw new Error('Could not align the panel reference ligand to the PDB fixture');
  const translation = [0, 1, 2].map((axis) =>
    deltas.reduce((sum, delta) => sum + delta[axis], 0) / deltas.length);
  const rms = Math.sqrt(deltas.reduce((sum, delta) => sum
    + delta.reduce((value, coordinate, axis) => value + (coordinate - translation[axis]) ** 2, 0), 0)
    / deltas.length);
  if (rms > 1e-4) throw new Error(`Reference/PDB alignment is not a translation (RMS ${rms})`);
  return { translation, matchedAtomCount:deltas.length, rmsAngstrom:rms };
}

function transformedProteinPdb(pdbText, translation) {
  const out = [];
  for (const line of pdbText.split(/\r?\n/)) {
    const atom = parsePdbAtom(line);
    if (atom?.record === 'ATOM') out.push(writePdbCoordinates(line,
      [atom.x + translation[0], atom.y + translation[1], atom.z + translation[2]]));
    else if (/^(HEADER|TITLE |COMPND|SOURCE|KEYWDS|EXPDTA|HELIX |SHEET |SSBOND|TER   )/.test(line)) out.push(line);
  }
  return `${out.join('\n')}\nEND\n`;
}

function pocketPdb(pdbText, translation, referenceMolecule, cutoffAngstrom = 3.5) {
  const reference = referenceMolecule.atoms.filter((atom) => atom.element !== 'H');
  const atoms = pdbText.split(/\r?\n/).map(parsePdbAtom).filter((atom) => atom?.record === 'ATOM');
  const residueAtoms = new Map();
  for (const atom of atoms) {
    const key = `${atom.chain}|${atom.residueNumber}|${atom.insertionCode}`;
    if (!residueAtoms.has(key)) residueAtoms.set(key, []);
    residueAtoms.get(key).push(atom);
  }
  const selected = new Set();
  const cutoff2 = cutoffAngstrom ** 2;
  for (const [key, members] of residueAtoms) {
    if (members.some((atom) => reference.some((ligand) => {
      const dx = atom.x + translation[0] - ligand.x;
      const dy = atom.y + translation[1] - ligand.y;
      const dz = atom.z + translation[2] - ligand.z;
      return dx * dx + dy * dy + dz * dz <= cutoff2;
    }))) selected.add(key);
  }
  const out = atoms.filter((atom) => selected.has(`${atom.chain}|${atom.residueNumber}|${atom.insertionCode}`))
    .map((atom) => writePdbCoordinates(atom.line,
      [atom.x + translation[0], atom.y + translation[1], atom.z + translation[2]]));
  return { pdb:`${out.join('\n')}\nEND\n`, residueCount:selected.size, atomCount:out.length, cutoffAngstrom };
}

export function moleculeToMolBlock(molecule, title = 'Molarium pose') {
  if (!Array.isArray(molecule?.atoms) || !Array.isArray(molecule?.bonds))
    throw new Error('Molecule must contain atom and bond arrays');
  if (molecule.atoms.length > 999 || molecule.bonds.length > 999)
    throw new Error('Mol V2000 export supports at most 999 atoms and bonds');
  const lines = [title.slice(0, 80), '  Molarium pose review', '',
    `${String(molecule.atoms.length).padStart(3)}${String(molecule.bonds.length).padStart(3)}`
      + '  0  0  0  0            999 V2000'];
  for (const atom of molecule.atoms) {
    lines.push(`${Number(atom.x).toFixed(4).padStart(10)}${Number(atom.y).toFixed(4).padStart(10)}`
      + `${Number(atom.z).toFixed(4).padStart(10)} ${String(atom.element).padEnd(3)}`
      + ' 0  0  0  0  0  0  0  0  0  0  0  0');
  }
  for (const bond of molecule.bonds) {
    const order = Math.max(1, Math.min(3, Number(bond.order) || 1));
    lines.push(`${String(bond.a + 1).padStart(3)}${String(bond.b + 1).padStart(3)}`
      + `${String(order).padStart(3)}  0  0  0  0`);
  }
  const charged = molecule.atoms.map((atom, index) => [index + 1, Number(atom.formalCharge) || 0])
    .filter(([, charge]) => charge !== 0);
  for (let offset = 0; offset < charged.length; offset += 8) {
    const group = charged.slice(offset, offset + 8);
    lines.push(`M  CHG${String(group.length).padStart(3)}`
      + group.map(([index, charge]) => `${String(index).padStart(4)}${String(charge).padStart(4)}`).join(''));
  }
  lines.push('M  END');
  return `${lines.join('\n')}\n`;
}

export function hydrogenBondsToMolBlock(hydrogenBonds, title = 'Required hydrogen bonds') {
  const atoms = [], bonds = [];
  for (const contact of hydrogenBonds || []) {
    if (contact.satisfied !== true) continue;
    const first = contact.participants?.hydrogen?.coordinatesAngstrom;
    const second = contact.participants?.acceptor?.coordinatesAngstrom;
    if (![first, second].every((point) => Array.isArray(point) && point.length === 3
      && point.every(Number.isFinite))) continue;
    const dashCount = 6;
    for (let index = 0; index < dashCount; index++) {
      const startFraction = (index + 0.16) / dashCount;
      const endFraction = (index + 0.68) / dashCount;
      const interpolate = (fraction) => first.map((value, axis) =>
        value + (second[axis] - value) * fraction);
      const atomIndex = atoms.length;
      atoms.push({ element:'C', formalCharge:0,
        ...Object.fromEntries(['x','y','z'].map((key, axis) =>
          [key, interpolate(startFraction)[axis]])) });
      atoms.push({ element:'C', formalCharge:0,
        ...Object.fromEntries(['x','y','z'].map((key, axis) =>
          [key, interpolate(endFraction)[axis]])) });
      bonds.push({ a:atomIndex, b:atomIndex + 1, order:1 });
    }
  }
  return atoms.length ? moleculeToMolBlock({ atoms, bonds }, title) : null;
}

function engine(result, name) {
  return result?.engines?.find((entry) => entry.engine === name) || null;
}

function requireHydrogenBondEvidence(pose) {
  if (!Array.isArray(pose.requiredContacts))
    throw new Error(`${pose.id}: required-contact evidence is missing`);
  if (!Array.isArray(pose.hydrogenBonds))
    throw new Error(`${pose.id}: hydrogen-bond evidence is missing; regenerate the pose export`);
  if (pose.hydrogenBonds.length !== pose.requiredContacts.length)
    throw new Error(`${pose.id}: hydrogen-bond evidence count does not match required contacts`);
  for (const contact of pose.hydrogenBonds) {
    for (const role of ['donor', 'hydrogen', 'acceptor']) {
      const point = contact.participants?.[role]?.coordinatesAngstrom;
      if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite))
        throw new Error(`${pose.id}: ${contact.id || 'hydrogen bond'} has no ${role} coordinates`);
    }
  }
}

export function buildReviewData({ panel, validation, pdbText, panelSha256, validationSha256, pdbSha256 }) {
  if (panel?.schema !== 'molarium.analogue-pose-panel/v1' || !Array.isArray(panel.poses))
    throw new Error('Unsupported pose-panel schema');
  if (validation?.schema !== 'molarium.independent-panel-results/v1' || !Array.isArray(validation.results))
    throw new Error('Unsupported independent-validation schema');
  const referencePose = panel.poses.find((pose) => pose.caseId === 'pyridone-parent-control'
    && pose.analogue?.rank === 1) || panel.poses[0];
  if (!referencePose) throw new Error('Pose panel is empty');
  const alignment = inferTranslation(referencePose.molecule, pdbText);
  const pocket = pocketPdb(pdbText, alignment.translation, referencePose.molecule);
  const byId = new Map(validation.results.map((entry) => [entry.id, entry]));
  const groups = new Map();
  for (const pose of panel.poses) {
    requireHydrogenBondEvidence(pose);
    const result = byId.get(pose.id);
    if (!result) throw new Error(`Missing independent validation for ${pose.id}`);
    const openmm = engine(result, 'OpenMM');
    const mmff = engine(result, 'RDKit MMFF94');
    const record = {
      id:pose.id, caseId:pose.caseId, endpoint:pose.endpoint, analogue:pose.analogue,
      requiredContacts:pose.requiredContacts, integrity:pose.integrity,
      molBlock:moleculeToMolBlock(pose.molecule, pose.id),
      hydrogenBonds:pose.hydrogenBonds,
      hydrogenBondMolBlock:hydrogenBondsToMolBlock(pose.hydrogenBonds),
      independent:{ openmm, mmff, inputSha256:result.inputSha256 }
    };
    if (!groups.has(pose.caseId)) groups.set(pose.caseId, []);
    groups.get(pose.caseId).push(record);
  }
  const cases = [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([id, poses]) => ({
    id, name:poses[0].analogue?.name || id, endpoint:poses[0].endpoint,
    feasiblePoseCount:poses.filter((pose) => pose.analogue?.feasible).length,
    poses:poses.sort((left, right) => (left.analogue?.rank ?? 999) - (right.analogue?.rank ?? 999)
      || left.id.localeCompare(right.id))
  }));
  return {
    schema:'molarium.pose-review/v1',
    sources:{ panelSha256, validationSha256, pdbSha256, pdbId:'7KPA' },
    protocol:{
      purpose:'read-only visual review of preregistered browser poses and independent local checks',
      energyWarning:'Do not compare absolute energies across different analogue graphs.',
      browserScore:'Reference-subtracted pose-ranking objective (relative receptor interaction plus relative ligand strain and restraint penalties); not an absolute energy or binding free energy.',
      openmmEnergy:'Absolute isolated-ligand OpenFF Sage potential energy at the candidate coordinates, evaluated independently on OpenMM Reference.',
      viewer:'Mol* 5.11.0 using a pinned local raw-data initialization path',
      shortlist:panel.protocol?.shortlist || null
    },
    alignment,
    receptor:{ proteinPdb:transformedProteinPdb(pdbText, alignment.translation), pocketPdb:pocket.pdb,
      pocket:{ residueCount:pocket.residueCount, atomCount:pocket.atomCount,
        cutoffAngstrom:pocket.cutoffAngstrom } },
    reference:{ poseId:referencePose.id,
      molBlock:moleculeToMolBlock(referencePose.molecule, '7KPA prepared reference ligand') },
    cases
  };
}

function args(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith('--') || !argv[index + 1]) throw new Error('Arguments must be --name value pairs');
    values[argv[index].slice(2)] = argv[index + 1];
  }
  for (const key of ['poses', 'validation', 'pdb', 'output']) if (!values[key])
    throw new Error('Usage: build_pose_review.mjs --poses SHORTLIST.json --validation RESULTS.json --pdb 7kpa.pdb --output DIRECTORY');
  return values;
}

async function main() {
  const options = args(process.argv.slice(2));
  const [panelBytes, validationBytes, pdbBytes] = await Promise.all([
    readFile(options.poses), readFile(options.validation), readFile(options.pdb)
  ]);
  const data = buildReviewData({ panel:JSON.parse(panelBytes), validation:JSON.parse(validationBytes),
    pdbText:pdbBytes.toString('utf8'), panelSha256:sha256(panelBytes),
    validationSha256:sha256(validationBytes), pdbSha256:sha256(pdbBytes) });
  await mkdir(path.join(options.output, 'vendor'), { recursive:true });
  await Promise.all([
    copyFile(path.join(here, 'index.html'), path.join(options.output, 'index.html')),
    copyFile(path.join(here, 'navigation.mjs'), path.join(options.output, 'navigation.mjs')),
    copyFile(path.join(here, 'vendor/molstar-5.11.0.js'), path.join(options.output, 'vendor/molstar-5.11.0.js')),
    copyFile(path.join(here, 'vendor/molstar-5.11.0.css'), path.join(options.output, 'vendor/molstar-5.11.0.css')),
    copyFile(path.join(here, 'MOLSTAR-LICENSE.txt'), path.join(options.output, 'MOLSTAR-LICENSE.txt')),
    writeFile(path.join(options.output, 'data.json'), `${JSON.stringify(data)}\n`)
  ]);
  console.log(`wrote ${options.output} (${data.cases.length} cases, ${data.cases.reduce((n, entry) => n + entry.poses.length, 0)} poses)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main();
