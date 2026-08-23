import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildReviewData, moleculeToMolBlock } from './build_pose_review.mjs';
import { copyCameraSnapshot, poseArrowDelta, wrappedId } from './navigation.mjs';

const navigationEntries = [{ id:'first' }, { id:'second' }, { id:'third' }];
assert.equal(wrappedId(navigationEntries, 'first', -1), 'third');
assert.equal(wrappedId(navigationEntries, 'third', 1), 'first');
assert.equal(wrappedId(navigationEntries, 'missing', 1), 'first');
assert.equal(wrappedId([], 'missing', 1), null);
assert.equal(poseArrowDelta({ key:'ArrowLeft', tagName:'CANVAS' }), -1);
assert.equal(poseArrowDelta({ key:'ArrowRight', tagName:'BUTTON' }), 1);
assert.equal(poseArrowDelta({ key:'ArrowRight', tagName:'SELECT' }), null);
assert.equal(poseArrowDelta({ key:'ArrowRight', tagName:'CANVAS', shiftKey:true }), null);
const originalCamera = { target:[1, 2, 3], position:[4, 5, 6], up:[0, 1, 0], radius:7 };
const copiedCamera = copyCameraSnapshot(originalCamera);
originalCamera.target[0] = 99;
assert.deepEqual(copiedCamera, { target:[1, 2, 3], position:[4, 5, 6], up:[0, 1, 0], radius:7 });

const molecule = {
  atoms:[
    { atomId:'fixture:1', atomName:'C1', element:'C', formalCharge:0, x:11, y:2, z:3 },
    { atomId:'fixture:2', atomName:'N1', element:'N', formalCharge:1, x:12, y:2, z:3 },
    { atomId:'fixture:3', atomName:'O1', element:'O', formalCharge:0, x:13, y:2, z:3 }
  ],
  bonds:[{ a:0, b:1, order:1 }, { a:1, b:2, order:2 }]
};
const block = moleculeToMolBlock(molecule, 'charged fixture');
assert.match(block, /  3  2  0  0  0  0            999 V2000/);
assert.match(block, /M  CHG  1   2   1/);
assert.match(block, /M  END\n$/);

const pdb = [
  'HEADER    POSE REVIEW FIXTURE',
  'ATOM      1  CA  ALA A   1      10.000   0.000   0.000  1.00 20.00           C  ',
  'ATOM      2  N   ALA A   1      11.000   0.000   0.000  1.00 20.00           N  ',
  'ATOM      3  O   ALA A   1      12.000   0.000   0.000  1.00 20.00           O  ',
  'END'
].join('\n');
const reference = { ...molecule, atoms:molecule.atoms.map((atom, index) => ({ ...atom,
  atomId:`reference:${index + 1}`, x:11 + index, y:2, z:3 })) };
const pose = (id, rank, coordinates) => ({ id, caseId:'pyridone-parent-control', endpoint:'pyridone',
  analogue:{ name:'Fixture', rank, feasible:true, scoreKcalMol:-rank }, requiredContacts:['acceptor'],
  molecule:{ ...reference, atoms:reference.atoms.map((atom, index) => ({ ...atom, x:coordinates[index][0],
    y:coordinates[index][1], z:coordinates[index][2] })) },
  integrity:{ coordinatesSha256:`coordinates-${rank}`, numericSystemSha256:`system-${rank}` } });
const poses = [pose('pose-1', 1, [[11,2,3],[12,2,3],[13,2,3]]),
  pose('pose-2', 2, [[11,2,3],[12,2.1,3],[13,2,3]])];
const validation = { schema:'molarium.independent-panel-results/v1', results:poses.map((entry) => ({
  id:entry.id, inputSha256:`input-${entry.id}`, engines:[
    { engine:'OpenMM', potentialEnergyKcalMol:4, forceMaxAbsKjMolNm:5 },
    { engine:'RDKit MMFF94', relaxationDropKcalMol:6, heavyAtomAlignedRmsAngstrom:0.2 }
  ] })) };
const data = buildReviewData({ panel:{ schema:'molarium.analogue-pose-panel/v1', poses }, validation,
  pdbText:pdb, panelSha256:'panel', validationSha256:'validation', pdbSha256:'pdb' });
assert.deepEqual(data.alignment.translation, [1, 2, 3]);
assert.ok(data.alignment.rmsAngstrom < 1e-12);
assert.equal(data.receptor.pocket.residueCount, 1);
assert.equal(data.cases.length, 1);
assert.equal(data.cases[0].poses.length, 2);
assert.equal(data.cases[0].poses[0].independent.openmm.potentialEnergyKcalMol, 4);
assert.match(data.receptor.proteinPdb, /      11\.000   2\.000   3\.000/);

const directory = import.meta.dirname;
const files = [
  ['vendor/molstar-5.11.0.js', '7fad5561c74bc900930fb57d6ab028d1aafdda82223a901bf932b1098e84f1f3'],
  ['vendor/molstar-5.11.0.css', '5b68ceb6d3642549b4e9b2c071e58e41b98a5350ae269180587b39da86925d55']
];
for (const [name, expected] of files) {
  const bytes = await readFile(path.join(directory, name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
}
const html = await readFile(path.join(directory, 'index.html'), 'utf8');
assert.doesNotMatch(html, /https?:\/\//);
assert.match(html, /molstar\.Viewer\.create\('viewer',OPTS\)/);
assert.match(html, /dataset\.ready/);
assert.match(html, /id="previous-case"/);
assert.match(html, /id="next-case"/);
assert.match(html, /poseArrowDelta\(\{key:event\.key/);
assert.match(html, /for\(const id of \['case','pose'\]\)\$\(id\)\.disabled=value/);
assert.match(html, /const camera=snapshotCamera\(\)/);
assert.match(html, /applyCamera\(camera\)/);
assert.match(html, /id="reset-view"/);
assert.match(html, /from '\.\/navigation\.mjs'/);
console.log('Mol* pose review: PASS');
