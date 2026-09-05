import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { perceiveHydrogenBondFeature,
  perceiveHydrogenBondFeatures } from './contact-remap.mjs';

const atoms = [
  { element:'C' }, { element:'O' },
  { element:'N' }, { element:'H' },
  { element:'O' }, { element:'H' }, { element:'C' },
  { element:'N', aromatic:true }, { element:'C', aromatic:true },
  { element:'H' },
];
let adjacencyBuilds = 0;
const bonds = [
  { a:0,b:1,order:2 }, { a:0,b:2,order:1 }, { a:2,b:3,order:1 },
  { a:4,b:5,order:1 }, { a:4,b:6,order:1 }, { a:7,b:8,order:1.5 },
];
// adjacency() performs exactly one forEach over the molecular bond graph.
// Instrument that public collection without introducing a production hook.
bonds.forEach = function countedForEach(callback, thisArg) {
  adjacencyBuilds += 1;
  return Array.prototype.forEach.call(this, callback, thisArg);
};
const molecule = { atoms, bonds };

const bulk = perceiveHydrogenBondFeatures(molecule);
assert.equal(adjacencyBuilds, 1,
  'one bulk feature scan must construct molecular adjacency exactly once');

const plainMolecule = { atoms:structuredClone(atoms),
  bonds:bonds.map((bond) => ({ ...bond })) };
const scalar = atoms.map((_, atomIndex) => ({ atomIndex,
  donor:perceiveHydrogenBondFeature(plainMolecule, atomIndex, 'donor'),
  acceptor:perceiveHydrogenBondFeature(plainMolecule, atomIndex, 'acceptor'),
}));
assert.deepEqual(bulk, scalar,
  'bulk perception must preserve every scalar feature and signature');

assert(bulk[7].acceptor && !bulk[7].donor);
bonds.push({ a:7,b:9,order:1 });
const rescanned = perceiveHydrogenBondFeatures(molecule);
assert.equal(adjacencyBuilds, 2,
  'each chemistry scan must rebuild adjacency rather than use a stale cache');
assert.equal(rescanned[7].acceptor, null);
assert(rescanned[7].donor?.hydrogenIndices.includes(9));

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const interactionSource = appSource.slice(
  appSource.indexOf('function nonCovalentInteractions('),
  appSource.indexOf('\nfunction dockingLigandComponent()',
    appSource.indexOf('function nonCovalentInteractions(')));
assert.match(interactionSource,
  /hydrogenBondFeatureBulkPerception\(molecule, atomIndices\)/,
  'the viewer interaction scan must use the one-adjacency bulk API');

console.log('Bulk H-bond perception builds fresh adjacency once and preserves scalar chemistry');
