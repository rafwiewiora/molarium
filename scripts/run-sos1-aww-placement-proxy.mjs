#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, openSync, writeSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { searchBestDirectionalBranchContact } from '../docking/designer-branch-contact.mjs';
import { loadA010GraphCheckpoint } from './sos1-aww-graph-checkpoint.mjs';

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
assert(args.includes('--checkpoint') && args.includes('--output'),
  'Usage: node scripts/run-sos1-aww-placement-proxy.mjs --checkpoint <exact-a010-graph> --output <new-directory> [--rotation 150]');
const rotation = args.includes('--rotation') ? Number(option('--rotation')) : 150;
assert(Number.isFinite(rotation) && Math.abs(rotation) <= 360);
const source = await loadA010GraphCheckpoint(resolve(option('--checkpoint')));
const output = resolve(option('--output'));
await mkdir(output, { recursive:false });
const save = (name, value) => writeFile(resolve(output, name),
  Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`, { flag:'wx' });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const moduleHashes = {};
for (const name of ['run-sos1-aww-placement-proxy.mjs','sos1-aww-graph-checkpoint.mjs',
  '../docking/designer-branch-contact.mjs','../docking/sidechain-rotamers.mjs'])
  moduleHashes[name] = sha256(await readFile(new URL(name, import.meta.url)));
const molecule = source.molecule;
const ligandAtomIndices = molecule.atoms.flatMap((atom, index) =>
  atom.residueName === 'AWW' && atom.chain === 'A' && atom.residueIndex === 1104 ? [index] : []);
const find = (name, residueName = 'AWW', residueIndex = 1104) => {
  const matches = molecule.atoms.flatMap((atom, index) => atom.atomName === name
    && atom.residueName === residueName && atom.chain === 'A'
    && atom.residueIndex === residueIndex ? [index] : []);
  assert.equal(matches.length, 1, `${residueName} ${residueIndex} ${name} is not unique`);
  return matches[0];
};
const donorAtomIndex = find('OX3');
const hydrogens = molecule.bonds.flatMap((bond) => {
  const index = bond.a === donorAtomIndex ? bond.b : bond.b === donorAtomIndex ? bond.a : -1;
  return molecule.atoms[index]?.element === 'H' ? [index] : [];
});
assert.equal(hydrogens.length, 1);
const request = { molecule, ligandAtomIndices,
  primaryAxisAtomIndices:['C12','C15'].map((name) => find(name)),
  upstreamAxisAtomIndices:['N7','C12'].map((name) => find(name)),
  // Designer brief: choose the forward branch into the Phe-occupied pocket.
  // The opposite branch is the separately saved a018 alternative. Receptor
  // selection follows only after this ligand hypothesis is fixed.
  upstreamRotationRangeDegrees:[0,60],
  coupledAxisAtomIndices:[['CX4','CX5'],['CX15','CX16']].map((axis) => axis.map((name) => find(name))),
  designerPrimaryRotationDegrees:rotation, donorAtomIndex, hydrogenAtomIndex:hydrogens[0],
  acceptorAtomIndex:find('O', 'TYR', 884), carbonylAtomIndex:find('C', 'TYR', 884),
  allowedResponseAtoms:['CG','CD1','CD2','CE1','CE2','CZ'].map((atomName) => ({
    residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'', atomName })) };
const { molecule:ignoredMolecule, ...requestRecord } = request;
await save('boundary.json', { schema:'molarium.sos1-aww-placement-proxy/v1',
  status:'declared-before-compute', publicationEligible:false, laterStructureAccess:true,
  designerIntentOrigin:'crystal-series-informed interaction and branch-direction hypothesis',
  externalReferenceCoordinatesUsed:false,
  coordinateTargetsFromLaterStructures:false,
  source:{ sha256:source.sha256, commitId:source.commitId, snapshotId:source.snapshotId,
    filename:'aww-graph-only-campaign.json' }, moduleHashes, request:requestRecord,
  coordinatePolicy:'Current graph checkpoint only; bounded N7-C12 upstream branch and downstream ligand torsions; receptor and waters fixed',
  candidateCoordinates:'Every candidate stores the complete upstream moving branch. All remaining atoms retain the exact source checkpoint coordinates.' });
await save('aww-graph-only-campaign.json', source.bytes);
const candidates = openSync(resolve(output, 'placement-candidates.jsonl'), 'wx');
const candidateHash = createHash('sha256');
let count = 0, directional = 0, fixedClear = 0, eligible = 0, candidateBytes = 0;
let result, failure;
try {
  result = searchBestDirectionalBranchContact({ ...request, onCandidate(candidate) {
    const line = Buffer.from(`${JSON.stringify(candidate)}\n`);
    writeSync(candidates, line); candidateHash.update(line); candidateBytes += line.length;
    count += 1; directional += Number(candidate.directionalGatePassed);
    fixedClear += Number(candidate.fixedAtomGatePassed); eligible += Number(candidate.eligible);
  } });
} catch (error) {
  failure = { message:error.message, stack:error.stack, searchAudit:error.searchAudit || null };
} finally { closeSync(candidates); }
if (result) await save('selected-placement.json', result);
const summary = { schema:'molarium.sos1-aww-placement-proxy/v1',
  status:result ? 'placement-passed-awaiting-visual-review' : 'placement-failed',
  publicationEligible:false, laterStructureAccess:true,
  designerIntentOrigin:'crystal-series-informed interaction and branch-direction hypothesis',
  externalReferenceCoordinatesUsed:false,
  designerPrimaryRotationDegrees:rotation,
  sourceSha256:source.sha256, candidateCount:count, directionalGatePassed:directional,
  fixedAtomGatePassed:fixedClear, eligibleCandidateCount:eligible,
  candidateFile:{ filename:'placement-candidates.jsonl', sha256:candidateHash.digest('hex'), bytes:candidateBytes },
  selected:result?.selected || null, failure };
await save('summary.json', summary);
console.log(JSON.stringify(summary, null, 2));
if (failure) process.exitCode = 1;
