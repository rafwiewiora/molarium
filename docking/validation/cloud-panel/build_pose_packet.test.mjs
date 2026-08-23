import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'molarium-pose-packet-'));
const source = path.join(directory, 'source.json'), output = path.join(directory, 'panel.json');
const system = { particles:[{ mass_amu:16 }], constraints:[], bonds:[], angles:[], torsions:[],
  nonbonded:[{ charge_e:0, sigma_nm:0.3, epsilon_kj:0.5 }], exceptions:[] };
const inspection = { schema:'molarium.chemist-actions/v1', action:'session.inspect',
  status:'completed', result:{ scope:'ligand', truncated:false, totalAtomCount:1,
    atoms:[{ atomId:'persistent-O', element:'O', formalCharge:0, aromatic:false,
      atomName:'O1', coordinatesAngstrom:[1,2,3] }], bonds:[] } };
await writeFile(source, JSON.stringify({ schema:'molarium.chemist-pose-export-batch/v1',
  protocol:{ id:'test' }, exports:[{ id:'pose-1', inspection,
    numericSystem:{ atomIds:['persistent-O'], forcefield:'Sage test', chargeModel:'test',
      sourceSha256:'a'.repeat(64), system } }] }));
const run = spawnSync(process.execPath, [path.join(import.meta.dirname, 'build_pose_packet.mjs'),
  source, output], { encoding:'utf8' });
assert.equal(run.status, 0, run.stderr);
const panel = JSON.parse(await readFile(output));
assert.equal(panel.poses[0].molecule.bonds.length, 0);
assert.equal(panel.poses[0].integrity.atomCount, 1);
assert.match(panel.poses[0].integrity.topologySha256, /^[a-f0-9]{64}$/);

const invalid = JSON.parse(await readFile(source));
invalid.exports[0].numericSystem.atomIds = ['different-ID'];
await writeFile(source, JSON.stringify(invalid));
const rejected = spawnSync(process.execPath, [path.join(import.meta.dirname,
  'build_pose_packet.mjs'), source, output], { encoding:'utf8' });
assert.notEqual(rejected.status, 0);
assert.match(rejected.stderr, /atom order differs/);
console.log('pose packet converter: 4/4 passed');
