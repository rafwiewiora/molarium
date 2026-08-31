import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const here = import.meta.dirname;
const generated = join(here, 'generated');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(join(generated, 'bclxl-trajectory-manifest.json')));

assert.equal(manifest.schema, 'molarium.bclxl-trajectory-assets/v1');
assert.equal(sha256(await readFile(join(here, manifest.sourceManifest))),
  manifest.sourceManifestSha256, 'trajectory source manifest must be hash-pinned');
assert.equal(sha256(await readFile(join(here, manifest.generator.path))),
  manifest.generator.sha256, 'trajectory builder must be hash-pinned');
assert.deepEqual(manifest.states.map((state) => state.id), ['4', '6', '7', '16', '21']);

for (const state of manifest.states) {
  assert.equal(sha256(await readFile(join(generated, state.asset))), state.assetSha256,
    `compound ${state.id} asset hash`);
  if (state.id === '4') {
    assert.equal(state.coordinateClass, 'experimental');
    assert.equal(state.generation, null);
    continue;
  }
  assert.equal(state.coordinateClass, 'scaffold-constrained-reconstruction');
  assert(state.generation.templateMcsAtoms >= 49, `compound ${state.id} scaffold coverage`);
  assert(state.generation.preclampScaffoldRmsdAngstrom <= 0.05,
    `compound ${state.id} coordinate-map placement`);
  assert.equal(state.generation.proteinAtomsCloserThan1_55Angstrom, 0,
    `compound ${state.id} has a severe receptor contact`);
  assert(state.generation.minimumProteinDistanceAngstrom >= 1.55,
    `compound ${state.id} minimum receptor distance`);
}

const c16 = manifest.states.find((state) => state.id === '16');
assert.equal(c16.generation.templateMcsAtoms, c16.generation.heavyAtoms,
  'compound 16 must replay as the reported heavy-atom truncation of compound 7');
console.log('BCL-xL trajectory assets passed identity, provenance, scaffold, and receptor-contact gates');
