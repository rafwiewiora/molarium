import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixedAtomRelaxationGate } from
  './recover-sos1-final-from-full-system-checkpoint.mjs';

const atom = (atomId, coordinatesAngstrom) => ({ atomId, coordinatesAngstrom });
const inspection = (atoms) => ({ truncated:false, totalAtomCount:atoms.length, atoms });
const before = inspection([atom('fixed-1',[1,2,3]), atom('fixed-2',[4,5,6]),
  atom('movable',[0,0,0])]);
const after = inspection([atom('fixed-1',[1,2,3]), atom('fixed-2',[4,5,6]),
  atom('movable',[10,10,10])]);
const passed = fixedAtomRelaxationGate({ before, after,
  fixedAtomIds:['fixed-1','fixed-2'] });
assert.equal(passed.passed, true);
assert.equal(passed.comparison,
  'immediate-pre-relaxation-versus-immediate-post-relaxation');
assert.equal(passed.maximumDisplacementAngstrom, 0);
assert.equal(passed.comparedAtomCount, 2);

const moved = fixedAtomRelaxationGate({ before,
  after:inspection([atom('fixed-1',[1.01,2,3]), atom('fixed-2',[4,5,6])]),
  fixedAtomIds:['fixed-1','fixed-2'] });
assert.equal(moved.passed, false);
assert(moved.maximumDisplacementAngstrom > moved.toleranceAngstrom);
const missing = fixedAtomRelaxationGate({ before,
  after:inspection([atom('fixed-1',[1,2,3])]),
  fixedAtomIds:['fixed-1','fixed-2'] });
assert.equal(missing.passed, false);
assert.deepEqual(missing.missingAfter, ['fixed-2']);

const runner = await readFile(resolve(import.meta.dirname,
  'recover-sos1-final-from-full-system-checkpoint.mjs'), 'utf8');
for (const forbidden of ['window.molariumTest','session.loadStructure',
  'geometry.translateAtoms','campaignFromFrozenOpenPocketCheckpoint','5OVI'])
  assert(!runner.includes(forbidden), `full-system recovery contains forbidden ${forbidden}`);
for (const required of ['open-phe890-pocket-campaign.json','campaign.import',
  'campaign.verify','designRoute.resume','stateId:\'AWW\'','protein.parameterize',
  'pose.captureReference','finish-bay-293','pose.refine','pose.apply',
  'induced-fit-webgpu','session.inspect','campaign.commitCurrent','campaign.export',
  'candidateGateSummary','fixed-atom-relaxation-gate.json'])
  assert(runner.includes(required), `full-system recovery lacks ${required}`);
assert(!/hardAnchor\?\.rmsdAngstrom|hardAnchor\?\.maxDisplacementAngstrom/.test(runner),
  'fixed-atom gate must not assert absolute displacement from a predecessor');

const invoked = [...runner.matchAll(/execute\('([^']+)'/g)].map((match) => match[1]);
const allowed = new Set(['campaign.import','campaign.verify','designRoute.resume',
  'protein.parameterize','pose.captureReference','designRoute.applyStep','pose.refine',
  'pose.apply','session.inspect','optimization.run','designRoute.inspect',
  'campaign.commitCurrent','campaign.export']);
assert.deepEqual([...new Set(invoked.filter((action) => !allowed.has(action)))], []);
for (const [earlier, later] of [
  ['campaign.import','designRoute.resume'],
  ['designRoute.resume','protein.parameterize'],
  ['protein.parameterize','pose.captureReference'],
  ['pose.captureReference','designRoute.applyStep'],
  ['designRoute.applyStep','pose.refine'],
  ['pose.refine','pose.apply'],
  ['pose.apply','optimization.run'],
  ['optimization.run','campaign.commitCurrent'],
  ['campaign.commitCurrent','campaign.export'],
]) assert(invoked.indexOf(earlier) < invoked.lastIndexOf(later),
  `${earlier} must precede ${later}`);

console.log('SOS1 full-system checkpoint-4 recovery runner: PASS');
