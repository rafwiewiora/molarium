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
  'post-WebGPU coordinates versus exact float32-nm round-trip of pre-WebGPU coordinates');
assert.equal(passed.maximumDisplacementAngstrom, 0);
assert(passed.maximumFloat32RoundTripResidualAngstrom <= passed.toleranceAngstrom);
assert.equal(passed.comparedAtomCount, 2);

const preWebGpu = -23.28110572094604;
const float32RoundTrip = Math.fround(preWebGpu / 10) * 10;
const exactRoundTripPoint = [float32RoundTrip,
  Math.fround(2 / 10) * 10, Math.fround(3 / 10) * 10];
const representationOnly = fixedAtomRelaxationGate({
  before:inspection([atom('fixed-1',[preWebGpu,2,3])]),
  after:inspection([atom('fixed-1',exactRoundTripPoint)]),
  fixedAtomIds:['fixed-1'],
});
assert(representationOnly.maximumDisplacementAngstrom > representationOnly.toleranceAngstrom,
  'fixture must reproduce a raw displacement above the strict physical residual tolerance');
assert.equal(representationOnly.maximumFloat32RoundTripResidualAngstrom, 0);
assert.equal(representationOnly.passed, true,
  'an exact float32-nm storage round trip is representation loss, not fixed-atom motion');

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
  'view.setMode','pose.captureReference','finish-bay-293','pose.refine','pose.apply',
  'induced-fit-webgpu','session.inspect','campaign.commitCurrent','campaign.export',
  'candidateGateSummary','fixed-atom-relaxation-gate.json'])
  assert(runner.includes(required), `full-system recovery lacks ${required}`);
assert(!/hardAnchor\?\.rmsdAngstrom|hardAnchor\?\.maxDisplacementAngstrom/.test(runner),
  'fixed-atom gate must not assert absolute displacement from a predecessor');

const invoked = [...runner.matchAll(/execute\('([^']+)'/g)].map((match) => match[1]);
const allowed = new Set(['campaign.import','campaign.verify','designRoute.resume',
  'protein.parameterize','view.setMode','pose.captureReference','designRoute.applyStep','pose.refine',
  'pose.apply','session.inspect','optimization.run','designRoute.inspect',
  'campaign.commitCurrent','campaign.export']);
assert.deepEqual([...new Set(invoked.filter((action) => !allowed.has(action)))], []);
for (const [earlier, later] of [
  ['campaign.import','designRoute.resume'],
  ['designRoute.resume','protein.parameterize'],
  ['protein.parameterize','view.setMode'],
  ['view.setMode','pose.captureReference'],
  ['protein.parameterize','pose.captureReference'],
  ['pose.captureReference','designRoute.applyStep'],
  ['designRoute.applyStep','pose.refine'],
  ['pose.refine','pose.apply'],
  ['pose.apply','protein.parameterize'],
  ['pose.apply','optimization.run'],
  ['optimization.run','campaign.commitCurrent'],
  ['campaign.commitCurrent','campaign.export'],
]) assert(invoked.indexOf(earlier) < invoked.lastIndexOf(later),
  `${earlier} must precede ${later}`);
assert(invoked.lastIndexOf('protein.parameterize') < invoked.indexOf('optimization.run'),
  'selected AXH product must be parameterized before coupled relaxation');
assert.match(runner,
  /execute\('view\.setMode', \{ mode:'build' \},\s*'recovery-enter-design-mode'\);\s*await execute\('pose\.captureReference'/,
  'recovery must enter Design through the public API immediately before reference capture');
for (const digest of [
  'a5724fac3051b1c5fb97aa80064cbcd71396ce138e59738911d57bc4327dfd28',
  'a7891a9f5a76cb29341a04194b8f064110232eba486038c91d03d01ba372b52b',
  '2065bca8aa7c5ee71d5d52954705042dc122aeaa7f4d4edfc55ab6162a8d8c7b',
]) assert(runner.includes(digest), `recovery lacks preserved a013 coordinate guard ${digest}`);
assert.match(runner,
  /pose\.refine'[\s\S]*expectedSelectedCoordinateSha256:A013_FINAL_SELECTED_COORDINATE_SHA256/,
  'recovery selector must fail closed against the preserved a013 selected coordinates');
assert.match(runner,
  /pose\.apply'[\s\S]*expectedOutputCoordinateSha256:A013_FINAL_APPLIED_COORDINATE_SHA256/,
  'recovery pose application must fail closed against the preserved a013 applied coordinates');
assert.match(runner,
  /optimization\.run'[\s\S]*expectedInputCoordinateSha256:A013_FINAL_APPLIED_COORDINATE_SHA256[\s\S]*expectedOutputCoordinateSha256:A013_FINAL_RELAXED_COORDINATE_SHA256/,
  'recovery relaxation must fail closed against the preserved a013 input/output coordinates');

console.log('SOS1 full-system checkpoint-4 recovery runner: PASS');
