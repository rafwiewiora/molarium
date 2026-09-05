import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { searchBestDirectionalBranchContact, solveDirectedBranchContact } from
  './designer-branch-contact.mjs';

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

const atoms = [
  ['lig-0','C',0,5,0], ['lig-1','C',1,5,0], ['lig-2','C',1,4,0],
  ['lig-3','C',2,4,0], ['lig-4','C',2,3,0], ['lig-5','C',3.9,1,0],
  ['lig-O','O',3.9,0,0], ['lig-H','H',2.9,0,0],
  ['rec-C','C',0,0,0], ['rec-O','O',1,0,0],
].map(([designAtomId, element, x, y, z], index) => ({ designAtomId, element, x, y, z,
  atomName:index === 8 ? 'C' : index === 9 ? 'O' : `${element}${index}`,
  record:index < 8 ? 'HETATM' : 'ATOM', residueName:index < 8 ? 'LIG' : 'TYR',
  chain:'A', residueIndex:index < 8 ? 1 : 42, insertionCode:'' }));
const molecule = { atoms, bonds:[
  [0,1,1], [1,2,1], [2,3,1], [3,4,1], [4,5,1], [5,6,1], [6,7,1], [8,9,2],
].map(([a,b,order]) => ({ a,b,order })) };
const before = molecule.atoms.map((atom) => [atom.x, atom.y, atom.z]);
const bestDirectional = searchBestDirectionalBranchContact({ molecule,
  ligandAtomIndices:[0,1,2,3,4,5,6,7], primaryAxisAtomIndices:[0,1],
  coupledAxisAtomIndices:[[1,2],[3,4]], designerPrimaryRotationDegrees:0,
  donorAtomIndex:6, hydrogenAtomIndex:7, acceptorAtomIndex:9, carbonylAtomIndex:8,
  allowedResponseResidues:[{ residueName:'PHE', chain:'A', residueIndex:99 }] });
assert.equal(bestDirectional.schema, 'molarium.best-directional-branch-contact/v1');
assert.equal(bestDirectional.externalReferenceCoordinatesUsed, false);
assert.equal(bestDirectional.coordinateOrigin, 'current-visible-molecule');
assert.deepEqual(bestDirectional.allowedResponseResidues,
  [{ residueName:'PHE', chain:'A', residueIndex:99, insertionCode:'' }]);
assert.deepEqual(Object.keys(bestDirectional).sort(), ['allowedResponseResidues',
  'coordinateOrigin','externalReferenceCoordinatesUsed','movingAtomIndices','schema',
  'searchAudit','selected','selectedCoordinates'].sort());
assert.deepEqual(Object.keys(bestDirectional.selected).sort(), [
  'contactGeometry','contactScore','contacts','coupledMovementDegrees',
  'coupledRotationDegrees','designerPrimaryRotationDegrees',
  'donorHydrogenRotationDegrees','targetPointErrorAngstrom'].sort());
assert.equal(bestDirectional.selected.designerPrimaryRotationDegrees, 0);
assert.equal(bestDirectional.selected.contacts.outsideAllowedResponseContactCount, 0);
assert(bestDirectional.selected.contactGeometry.donorAcceptorDistanceAngstrom <= 3.5);
assert(bestDirectional.selected.contactGeometry.hydrogenAcceptorDistanceAngstrom <= 2.6);
assert(bestDirectional.selected.contactGeometry.dhaAngleDegrees >= 150);
assert(bestDirectional.selected.contactGeometry.carbonylAcceptorAngleDegrees >= 120);
assert.equal(bestDirectional.searchAudit.coarse.heavyRotorCellCount, 1296);
assert.equal(bestDirectional.searchAudit.local.heavyRotorCellCount, 441);
assert.deepEqual(bestDirectional.movingAtomIndices, [1,2,3,4,5,6,7]);
const applied = before.map((coordinates) => [...coordinates]);
bestDirectional.selectedCoordinates.forEach(({ atomIndex, coordinatesAngstrom }) => {
  applied[atomIndex] = [...coordinatesAngstrom];
});
for (const preservedIndex of [0,8,9])
  assert.deepEqual(applied[preservedIndex], before[preservedIndex],
    `best-directional search must preserve atom ${preservedIndex} bitwise`);
assert.throws(() => searchBestDirectionalBranchContact({ molecule,
  ligandAtomIndices:[0,1,2,3,4,5,6,7], primaryAxisAtomIndices:[0,1],
  coupledAxisAtomIndices:[[1,2],[3,4]], designerPrimaryRotationDegrees:0,
  donorAtomIndex:6, hydrogenAtomIndex:7, acceptorAtomIndex:9, carbonylAtomIndex:8,
  allowedResponseResidues:[] }), /allowedResponseResidues/);

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
assert.doesNotMatch(appSource, /preservedPrecursorAtomIdsSha256\s*[,}]/,
  'public action summaries must bind the stored preserved-atom digest explicitly');
assert.match(appSource,
  /preservedPrecursorAtomIdsSha256:preservedAtomIdsSha256/g);
assert.match(appSource, /solution === 'best-directional'/);
assert.match(appSource, /outsideAllowedResponseContactCount/);
assert.match(appSource, /externalReferenceCoordinatesUsed:false, contactId:args\.contactId/);

console.log('Designer-directed branch contact solver tests: PASS');
