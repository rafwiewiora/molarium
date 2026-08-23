#!/usr/bin/env node
/** Convert public Chemist Actions inspections plus read-only numeric Systems into oracle packets. */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

const digest = (value) => createHash('sha256').update(stable(value)).digest('hex');

function topologyOf(molecule) {
  return {
    atoms:molecule.atoms.map((atom) => ({ atomId:atom.atomId, element:atom.element,
      formalCharge:Number(atom.formalCharge || 0), aromatic:Boolean(atom.aromatic) })),
    bonds:molecule.bonds.map((bond) => ({ a:Math.min(bond.a, bond.b), b:Math.max(bond.a, bond.b),
      order:Number(bond.order), aromatic:Boolean(bond.aromatic) }))
      .sort((left, right) => left.a - right.a || left.b - right.b
        || left.order - right.order || Number(left.aromatic) - Number(right.aromatic)),
  };
}

function convert(entry) {
  const envelope = entry.inspection;
  if (envelope?.schema !== 'molarium.chemist-actions/v1' || envelope.action !== 'session.inspect'
    || envelope.status !== 'completed') throw new Error(`${entry.id}: invalid public inspection envelope`);
  const inspection = envelope.result;
  if (inspection.scope !== 'ligand' || inspection.truncated
    || inspection.totalAtomCount !== inspection.atoms?.length)
    throw new Error(`${entry.id}: public ligand inspection is truncated or incomplete`);
  const atomIds = inspection.atoms.map((atom) => atom.atomId);
  if (atomIds.some((id) => typeof id !== 'string' || !id)
    || new Set(atomIds).size !== atomIds.length)
    throw new Error(`${entry.id}: inspection atom IDs are missing or non-unique`);
  const indexById = new Map(atomIds.map((id, index) => [id, index]));
  const atoms = inspection.atoms.map((atom) => {
    if (!Array.isArray(atom.coordinatesAngstrom) || atom.coordinatesAngstrom.length !== 3
      || atom.coordinatesAngstrom.some((value) => !Number.isFinite(value)))
      throw new Error(`${entry.id}: inspection must include finite coordinates`);
    return { atomId:atom.atomId, element:atom.element, formalCharge:Number(atom.formalCharge || 0),
      aromatic:Boolean(atom.aromatic), atomName:atom.atomName || null,
      x:atom.coordinatesAngstrom[0], y:atom.coordinatesAngstrom[1], z:atom.coordinatesAngstrom[2] };
  });
  const bonds = inspection.bonds.map((bond) => {
    const [first, second] = bond.atomIds || [];
    if (!indexById.has(first) || !indexById.has(second) || first === second)
      throw new Error(`${entry.id}: inspection bond references an unknown atom ID`);
    return { a:indexById.get(first), b:indexById.get(second), order:Number(bond.order),
      aromatic:Boolean(bond.aromatic) };
  });
  const numeric = entry.numericSystem || null;
  if (numeric) {
    if (stable(numeric.atomIds) !== stable(atomIds))
      throw new Error(`${entry.id}: numeric System atom order differs from public inspection`);
    if (!numeric.system || !numeric.forcefield || !numeric.sourceSha256)
      throw new Error(`${entry.id}: numeric System provenance is incomplete`);
  }
  const molecule = { atoms, bonds,
    ...(numeric ? { parameterization:{ forcefield:numeric.forcefield,
      chargeModel:numeric.chargeModel || null, sourceSha256:numeric.sourceSha256,
      system:numeric.system } } : {}) };
  return { id:entry.id, caseId:entry.caseId || entry.id,
    endpoint:entry.endpoint || null, analogue:entry.analogue || null,
    requiredContacts:entry.requiredContacts || [], molecule,
    integrity:{ atomOrderSha256:digest(atomIds), topologySha256:digest(topologyOf(molecule)),
      coordinatesSha256:digest(atoms.map(({ x, y, z }) => [x, y, z])),
      numericSystemSha256:numeric ? digest(numeric.system) : null,
      atomCount:atoms.length, bondCount:bonds.length } };
}

const [sourceName, outputName] = process.argv.slice(2);
if (!sourceName || !outputName) throw new Error('Usage: build_pose_packet.mjs EXPORTS.json PANEL.json');
const source = JSON.parse(await readFile(sourceName, 'utf8'));
if (source.schema !== 'molarium.chemist-pose-export-batch/v1' || !Array.isArray(source.exports))
  throw new Error('Unsupported chemist pose export schema');
const poses = source.exports.map(convert);
if (new Set(poses.map((pose) => pose.id)).size !== poses.length)
  throw new Error('Pose export IDs are not unique');
const panel = { schema:'molarium.analogue-pose-panel/v1', protocol:source.protocol || null,
  source:{ schema:source.schema, sha256:createHash('sha256').update(await readFile(sourceName)).digest('hex') },
  poses };
await writeFile(outputName, `${JSON.stringify(panel, null, 2)}\n`);
console.log(`wrote ${outputName} (${poses.length} poses)`);
