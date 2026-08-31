import assert from 'node:assert/strict';
import { alignModels, atomsForResidue, coordinateSphere, parsePdb, rigidFit } from './pipeline.mjs';

function atom(serial, name, resName, chain, resSeq, x, y, z, record = 'ATOM') {
  return `${record.padEnd(6)}${String(serial).padStart(5)} ${name.padEnd(4)} ${resName.padStart(3)} ${chain}${String(resSeq).padStart(4)}    ${x.toFixed(3).padStart(8)}${y.toFixed(3).padStart(8)}${z.toFixed(3).padStart(8)}  1.00 20.00           ${name[0].padStart(2)}`;
}

const referencePoints = [[0, 0, 0], [2, 0, 0], [0, 3, 0], [0, 0, 4]];
const mobilePoints = referencePoints.map(([x, y, z]) => [-y + 7, x - 3, z + 2]);
const fit = rigidFit(referencePoints, mobilePoints);
assert.ok(fit.rmsd < 1e-8, `known rigid transform RMSD ${fit.rmsd}`);

const reference = parsePdb(`${[
  atom(1, 'CA', 'ALA', 'A', 1, 0, 0, 0), atom(2, 'CA', 'GLY', 'A', 2, 2, 0, 0),
  atom(3, 'CA', 'SER', 'A', 3, 0, 3, 0), atom(4, 'CA', 'VAL', 'A', 4, 0, 0, 4),
  atom(5, 'C1', 'LIG', 'A', 8, 1, 1, 1, 'HETATM'), 'END',
].join('\n')}\n`);
const mobile = parsePdb(`${[
  atom(1, 'CA', 'ALA', 'A', 1, 7, -3, 2), atom(2, 'CA', 'GLY', 'A', 2, 7, -1, 2),
  atom(3, 'CA', 'SER', 'A', 3, 4, -3, 2), atom(4, 'CA', 'VAL', 'A', 4, 7, -3, 6),
  atom(5, 'C1', 'LIG', 'A', 8, 6, -2, 3, 'HETATM'), 'END',
].join('\n')}\n`);
assert.equal(reference.atoms.length, 5, JSON.stringify(reference.atoms));
assert.equal(reference.atoms.filter((entry) => entry.atomName === 'CA' && entry.chain === 'A').length, 4,
  JSON.stringify(reference.atoms));
const aligned = alignModels(reference, mobile);
assert.equal(aligned.pairs, 4);
assert.ok(aligned.rmsd < 1e-8);
const ligand = atomsForResidue(aligned.model, { resName:'LIG', chain:'A', resSeq:8 });
assert.equal(ligand.length, 1);
assert.ok(Math.hypot(ligand[0].x - 1, ligand[0].y - 1, ligand[0].z - 1) < .002);
assert.deepEqual(coordinateSphere(ligand).center.map((value) => Number(value.toFixed(3))), [1, 1, 1]);

console.log('structure pipeline tests passed');
