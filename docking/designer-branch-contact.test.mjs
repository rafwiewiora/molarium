import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { solveDirectedBranchContact } from './designer-branch-contact.mjs';

const common = { axisStart:{ x:0, y:0, z:0 }, axisEnd:{ x:1, y:0, z:0 },
  ligandFeature:{ x:1, y:1, z:0 }, receptorTarget:{ x:1, y:0, z:2 },
  targetDistanceAngstrom:Math.sqrt(3) };
const positive = solveDirectedBranchContact({ ...common, solution:'positive' });
assert(Math.abs(positive.appliedRotationDegrees - 30) < 1e-9);
assert(Math.abs(positive.achievedDistanceAngstrom - Math.sqrt(3)) < 1e-9);
assert.equal(positive.targetReachable, true);
assert.equal(positive.externalReferenceCoordinatesUsed, false);

const negative = solveDirectedBranchContact({ ...common, solution:'negative' });
assert(Math.abs(negative.appliedRotationDegrees + 210) < 1e-9);
assert(Math.abs(negative.achievedDistanceAngstrom - Math.sqrt(3)) < 1e-9);
const nearest = solveDirectedBranchContact({ ...common, solution:'nearest' });
assert.equal(nearest.appliedRotationDegrees, positive.appliedRotationDegrees);

const unreachable = solveDirectedBranchContact({ ...common,
  targetDistanceAngstrom:.5, solution:'nearest' });
assert.equal(unreachable.targetReachable, false);
assert(Math.abs(unreachable.achievedDistanceAngstrom - 1) < 1e-9);
assert.deepEqual(unreachable.attainableDistanceRangeAngstrom, [1,3]);

assert.throws(() => solveDirectedBranchContact({ ...common,
  ligandFeature:{ x:2, y:0, z:0 } }), /lies on the rotation axis/);
assert.throws(() => solveDirectedBranchContact({ ...common, solution:'crystal' }),
  /nearest, positive, or negative/);

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert.doesNotMatch(appSource, /preservedPrecursorAtomIdsSha256\s*[,}]/,
  'public action summaries must bind the stored preserved-atom digest explicitly');
assert.match(appSource,
  /preservedPrecursorAtomIdsSha256:preservedAtomIdsSha256/g);

console.log('Designer-directed branch contact solver tests: PASS');
