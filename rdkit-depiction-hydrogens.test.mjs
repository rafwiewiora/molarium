import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';

const root = new URL('./', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(import.meta.url);
const module = await require('./rdkit/dist/RDKit_minimal.js')({
  locateFile:path => new URL('rdkit/dist/'+path, root).pathname,
});
const messages = [];
const context = vm.createContext({ self:{importScripts(){},addEventListener(){},
  initRDKitModule:() => Promise.resolve(module), location:{href:new URL('rdkit-worker.js',root).href},
  postMessage:message => messages.push(message)}, URL, performance, Float64Array, Int32Array, Uint8Array, console });
vm.runInContext(read('rdkit-worker.js').toString(), context);
const app = read('app.js').toString();
const helper = app.slice(app.indexOf('function depictionInputWithHydrogens('), app.indexOf('\nfunction depictionTarget('));
vm.runInContext(helper, context);
const release = JSON.parse(read('design-history/publications/sos1/designer-intent-2026-09-04/release.json'));
const earlier = JSON.parse(read('paper/review/captures/2026-09-07-aligned-chemistry-a22/worker-audit.json'));
for (const [index, entry] of release.checkpoints.entries()) {
  const bytes = read(entry.path);
  assert.equal(sha(bytes), entry.sha256);
  const snapshot = JSON.parse(entry.encoding ? gunzipSync(bytes) : bytes).objects.snapshots[entry.snapshotId];
  const coordinates = new Map(snapshot.coordinates.atomIds.map((id,i) => [id,snapshot.coordinates.positions[i]]));
  const byId = new Map(snapshot.graph.atoms.map((atom,i) => [atom.atomId,i]));
  const molecule = {atoms:snapshot.graph.atoms.map(atom => ({...atom,charge:atom.formalCharge || 0,
    x:coordinates.get(atom.atomId)[0],y:coordinates.get(atom.atomId)[1],z:coordinates.get(atom.atomId)[2]})),
    bonds:snapshot.graph.bonds.map(bond => ({a:byId.get(bond.atomIds[0]),b:byId.get(bond.atomIds[1]),order:bond.order}))};
  const heavy = molecule.atoms.flatMap((atom,i) => atom.record === 'HETATM'
    && ['AXE','AWT','AWZ','AWW','AXH'].includes(atom.residueName) && atom.element !== 'H' ? [i] : []);
  const before = JSON.stringify(molecule);
  const input = context.depictionInputWithHydrogens(molecule, heavy);
  assert.equal(JSON.stringify(molecule), before, 'depiction input must not mutate the simulation');
  assert.deepEqual(Array.from(input.atoms.slice(0,heavy.length), a=>a.atomId), heavy.map(i=>molecule.atoms[i].atomId));
  assert(input.atoms.length > heavy.length);
  const inputBefore = JSON.stringify(input);
  await context.runCalculation({id:index,job:'depict',molecule:input,
    options:{allowUnsanitizedDepictionFallback:true,selectedAtomIndices:[0,1,2]}});
  const result = messages.at(-1);
  assert.equal(result.type, 'result', JSON.stringify(result));
  assert.equal(result.atomCount, heavy.length);
  assert.equal(result.sanitization, 'strict RDKit sanitization; hydrogens removed after sanitization');
  assert.equal(result.canonicalSmiles, earlier.results.find(r=>r.stage===entry.id).smiles);
  assert.equal(JSON.stringify(input), inputBefore);
  const heavyBonds = input.bonds.filter(b=>b.a<heavy.length && b.b<heavy.length).map(b=>[b.a,b.b]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.bondAtomIndices)), JSON.parse(JSON.stringify(heavyBonds)),
    'SVG bond ordinals retain the exact mapped heavy-atom pairs used for editing');
  if (entry.id === 'scaffold-rewrite') {
    assert.match(result.canonicalSmiles, /\[nH\]/);
    assert(!result.svg.includes('stroke-dasharray'), 'AWT aromatic bonds must use conventional Kekule rendering');
  }
  console.log(`${entry.id}: strict depiction, identity, bond mapping, and immutable inputs PASS`);
}
