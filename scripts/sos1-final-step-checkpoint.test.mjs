import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyCampaign } from '../design-history/ledger.mjs';
import { deserializeCampaign, serializeCampaign } from
  '../design-history/live-campaign-store.mjs';
import {
  campaignFromFrozenOpenPocketCheckpoint,
  finalDiagnosticGate,
  moleculeFromFrozenOpenPocketCheckpoint,
} from './sos1-final-step-checkpoint.mjs';

const route = JSON.parse(await readFile(resolve(import.meta.dirname,
  '../design-history/structures/generated/sos1-prospective-campaign.json'), 'utf8'));
const preceding = route.steps.find((step) => step.id === 'open-phe890-pocket');
const ligandAtoms = preceding.productAtomNames.map((atomName, index) => ({
  atomId:`checkpoint:HETATM:A:AWW:1104::${atomName}:${index + 1}`,
  atomName, element:atomName.startsWith('N') ? 'N'
    : atomName.startsWith('O') ? 'O' : atomName.startsWith('S') ? 'S' : 'C',
  formalCharge:0, aromatic:false, residueName:'AWW', chain:'A', residueIndex:1104,
  insertionCode:'', coordinatesAngstrom:[index * 1.3, 0, 0],
}));
const pheNames = ['N','CA','C','O','CB','CG','CD1','CD2','CE1','CE2','CZ'];
const pheAtoms = pheNames.map((atomName, index) => ({
  atomId:`checkpoint:ATOM:A:PHE:890::${atomName}:${100 + index}`,
  atomName, element:atomName === 'N' ? 'N' : atomName === 'O' ? 'O' : 'C',
  formalCharge:0, aromatic:['CG','CD1','CD2','CE1','CE2','CZ'].includes(atomName),
  residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'',
  coordinatesAngstrom:[0, index * 1.2, 3],
}));
const atoms = [...ligandAtoms, ...pheAtoms];
const checkpoint = {
  schema:'molarium.design-prediction-checkpoint/v1', routeId:route.id,
  stepId:'open-phe890-pocket', predictedStateId:'AWW',
  frozenBeforeHoldoutAccess:true,
  ligand:{ scope:'ligand', truncated:false, totalAtomCount:ligandAtoms.length,
    atoms:ligandAtoms, bonds:[] },
  pocket:{ scope:'pocket', truncated:false, totalAtomCount:atoms.length,
    molecule:{ atoms:7935 }, atoms, bonds:[] },
};

const molecule = moleculeFromFrozenOpenPocketCheckpoint(checkpoint, route);
assert.equal(molecule.atoms.length, atoms.length);
assert.equal(molecule.atoms.filter((atom) => atom.residueName === 'AWW').length,
  ligandAtoms.length);
assert.equal(molecule.diagnosticBoundary.diagnosticOnly, true);
assert.equal(molecule.diagnosticBoundary.promotable, false);
assert.equal(molecule.diagnosticBoundary.omittedOuterAtomCount, 7935 - atoms.length);
assert.equal(molecule.source.routeId, route.id);
assert.equal(molecule.source.stateId, 'AWW');

const compiled = await campaignFromFrozenOpenPocketCheckpoint(checkpoint, route, {
  checkpointSha256:'a'.repeat(64), checkpointLabel:'synthetic-checkpoint.json',
});
const decoded = deserializeCampaign(compiled.serialized);
assert.equal(serializeCampaign(decoded), compiled.serialized);
assert.equal((await verifyCampaign(decoded)).valid, true);
const snapshot = decoded.objects.snapshots[compiled.snapshotId];
assert.equal(snapshot.properties.provenance.diagnosticOnly, true);
assert.equal(snapshot.properties.provenance.promotable, false);
assert.equal(snapshot.coordinates.positions.length, atoms.length);

const candidateGateSummary = [{ rank:1, feasible:false,
  spatialFeatures:[{ id:'terminal-feature', required:true, satisfied:false }] }];
const rejected = finalDiagnosticGate({ coverageComplete:true,
  coverage:{ allRequiredStrataCovered:true }, selectedFeasible:false,
  selectedRank:1, candidates:1, feasible:0, candidateGateSummary,
  selectedSpatialFeatures:[{ id:'terminal-feature', required:true, satisfied:false }],
}, ['terminal-feature']);
assert.equal(rejected.passed, false);
assert.equal(rejected.candidateGateSummary, candidateGateSummary);
assert.deepEqual(rejected.unsatisfiedRequiredFeatureIds, ['terminal-feature']);
const accepted = finalDiagnosticGate({ coverageComplete:true,
  coverage:{ allRequiredStrataCovered:true }, selectedFeasible:true,
  selectedRank:1, candidates:1, feasible:1, candidateGateSummary,
  selectedSpatialFeatures:[{ id:'terminal-feature', required:true, satisfied:true }],
}, ['terminal-feature']);
assert.equal(accepted.passed, true);

for (const invalid of [
  { ...checkpoint, frozenBeforeHoldoutAccess:false },
  { ...checkpoint, pocket:{ ...checkpoint.pocket, truncated:true } },
  { ...checkpoint, predictedStateId:'AXH' },
]) assert.throws(() => moleculeFromFrozenOpenPocketCheckpoint(invalid, route));

const runner = await readFile(resolve(import.meta.dirname,
  'diagnose-sos1-final-step-from-checkpoint.mjs'), 'utf8');
assert(!runner.includes('molariumTest'), 'diagnostic runner must not use the privileged test API');
assert(!runner.includes('session.loadStructure'),
  'diagnostic runner must not replace coordinates through structure loading');
assert(!runner.includes('geometry.translateAtoms'),
  'diagnostic runner must not patch checkpoint coordinates');
assert(!runner.includes('5OVI'), 'diagnostic runner must not name or open the holdout');
assert.match(runner, /campaign\.import/);
assert.match(runner, /designRoute\.resume/);
assert.match(runner, /pose\.refine/);
assert.match(runner, /optimization\.run/);
assert.match(runner, /candidate-gate\.json/);
assert.match(runner, /diagnosticOnly:true, promotable:false/);

const invoked = [...runner.matchAll(/execute\('([^']+)'/g)].map((match) => match[1]);
const allowed = new Set([
  'campaign.import','campaign.verify','designRoute.resume','view.setMode',
  'protein.parameterize','pose.captureReference','session.inspect',
  'designRoute.applyStep','pose.refine','pose.apply','designRoute.inspect',
  'optimization.run',
]);
assert(invoked.length > 0);
assert.deepEqual([...new Set(invoked.filter((name) => !allowed.has(name)))], []);
console.log('SOS1 final-step checkpoint diagnostic is canonical, nonpromotable, and public-action-only');
