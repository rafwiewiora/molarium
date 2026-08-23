#!/usr/bin/env node
/** Convert public Chemist Actions inspections plus read-only numeric Systems into oracle packets. */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Integrity hashes require finite numbers');
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(value);
    return JSON.stringify(`~f64:${bytes.toString('hex')}`);
  }
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

function hydrogenBondsOf(inspection, entryId, publicAtomIds) {
  const ligandIds = new Set(publicAtomIds);
  return (inspection.contacts || []).flatMap((contact) => {
    if (!contact.required || !contact.hydrogenBond) return [];
    const bond = contact.hydrogenBond;
    const participants = {};
    for (const role of ['donor', 'hydrogen', 'acceptor']) {
      const participant = bond.participants?.[role];
      if (!participant || !['ligand','receptor'].includes(participant.scope))
        throw new Error(`${entryId}: contact ${contact.contactId} has an invalid ${role}`);
      if (participant.scope === 'ligand' && !ligandIds.has(participant.atomId))
        throw new Error(`${entryId}: contact ${contact.contactId} references an unknown ligand atom`);
      if (!Array.isArray(participant.coordinatesAngstrom)
        || participant.coordinatesAngstrom.length !== 3
        || participant.coordinatesAngstrom.some((value) => !Number.isFinite(value)))
        throw new Error(`${entryId}: contact ${contact.contactId} is missing ${role} coordinates`);
      participants[role] = { scope:participant.scope, atomId:participant.atomId || null,
        element:participant.element || null,
        coordinatesAngstrom:participant.coordinatesAngstrom.map(Number) };
    }
    return [{ id:contact.contactId, label:contact.label || contact.contactId,
      required:true, available:Boolean(contact.available), remapStatus:contact.remapStatus || null,
      receptorRole:bond.receptorRole || null,
      selectedAlternativeId:bond.selectedAlternativeId || null,
      satisfied:bond.satisfied ?? null,
      donorAcceptorDistanceAngstrom:bond.donorAcceptorDistanceAngstrom ?? null,
      hydrogenAcceptorDistanceAngstrom:bond.hydrogenAcceptorDistanceAngstrom ?? null,
      dhaAngleDegrees:bond.dhaAngleDegrees ?? null, participants }];
  });
}

function convert(entry) {
  const envelope = entry.inspection;
  if (envelope?.schema !== 'molarium.chemist-actions/v1' || envelope.action !== 'session.inspect'
    || envelope.status !== 'completed') throw new Error(`${entry.id}: invalid public inspection envelope`);
  const inspection = envelope.result;
  if (inspection.scope !== 'ligand' || inspection.truncated
    || inspection.totalAtomCount !== inspection.atoms?.length)
    throw new Error(`${entry.id}: public ligand inspection is truncated or incomplete`);
  const publicAtomIds = inspection.atoms.map((atom) => atom.atomId);
  if (publicAtomIds.some((id) => typeof id !== 'string' || !id)
    || new Set(publicAtomIds).size !== publicAtomIds.length)
    throw new Error(`${entry.id}: inspection atom IDs are missing or non-unique`);
  const numeric = entry.numericSystem || null;
  const atomIds = numeric?.atomIds || publicAtomIds;
  if (!Array.isArray(atomIds) || atomIds.length !== publicAtomIds.length
    || new Set(atomIds).size !== atomIds.length
    || atomIds.some((id) => !publicAtomIds.includes(id)))
    throw new Error(`${entry.id}: numeric System atom IDs differ from public inspection`);
  const publicAtomById = new Map(inspection.atoms.map((atom) => [atom.atomId, atom]));
  const indexById = new Map(atomIds.map((id, index) => [id, index]));
  const atoms = atomIds.map((atomId) => {
    const atom = publicAtomById.get(atomId);
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
  if (numeric) {
    if (!numeric.system || !numeric.forcefield || !numeric.sourceSha256)
      throw new Error(`${entry.id}: numeric System provenance is incomplete`);
  }
  const molecule = { atoms, bonds,
    ...(numeric ? { parameterization:{ forcefield:numeric.forcefield,
      chargeModel:numeric.chargeModel || null, sourceSha256:numeric.sourceSha256,
      system:numeric.system } } : {}) };
  const hydrogenBonds = hydrogenBondsOf(inspection, entry.id, publicAtomIds);
  return { id:entry.id, caseId:entry.caseId || entry.id,
    endpoint:entry.endpoint || null, analogue:entry.analogue || null,
    requiredContacts:entry.requiredContacts || [], hydrogenBonds, molecule,
    integrity:{ publicInspectionAtomOrderSha256:digest(publicAtomIds),
      atomOrderSha256:digest(atomIds), topologySha256:digest(topologyOf(molecule)),
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
