import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const directory = await mkdtemp(path.join(tmpdir(), 'molarium-shortlist-'));
const source = path.join(directory, 'panel.json'), output = path.join(directory, 'shortlist.json');
const pose = (id, caseId, coordinate, feasible, score) => ({ id, caseId,
  analogue:{ feasible, scoreKcalMol:score }, integrity:{ coordinatesSha256:coordinate } });
await writeFile(source, JSON.stringify({ schema:'molarium.analogue-pose-panel/v1', protocol:{ id:'test' },
  poses:[pose('a-1','a','same',true,2), pose('a-2','a','same',true,2),
    pose('a-3','a','other',false,-100), pose('b-1','b','b1',false,3),
    pose('b-2','b','b2',false,1)] }));
const run = spawnSync(process.execPath, [path.join(import.meta.dirname, 'build_shortlist.mjs'),
  source, output], { encoding:'utf8' });
assert.equal(run.status, 0, run.stderr);
const result = JSON.parse(await readFile(output));
assert.deepEqual(result.poses.map((entry) => entry.id), ['a-1','b-2']);
assert.equal(result.protocol.shortlist.cases[0].rule, 'all-unique-feasible');
assert.equal(result.protocol.shortlist.cases[1].rule, 'best-unique-infeasible-control');
assert.match(result.protocol.shortlist.sourceSha256, /^[a-f0-9]{64}$/);
console.log('cloud-panel shortlist: PASS');
