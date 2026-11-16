// Non-learned CPU reference only: no model, weights, GPU or network operation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {relativeEncoding} from '../../vendor/localfold/cpu/af3/trunk/embedder.js';

const [inputPath, expectedPath] = process.argv.slice(2);
const input = JSON.parse(await readFile(inputPath));
assert(Number.isInteger(input.tokens) && input.tokens > 0 && input.tokens <= 512);
assert.equal(input.maxRelativeIndex, 32);
assert.equal(input.maxRelativeChain, 2);
for (const name of ['residueIndex', 'tokenIndex', 'asymId', 'entityId', 'symId']) {
  assert.equal(input.features[name].length, input.tokens);
  assert(input.features[name].every(Number.isInteger));
}
assert.equal(input.isLigand.length, input.tokens);
const raw = await readFile(expectedPath);
assert.equal(new Uint8Array(new Uint32Array([1]).buffer)[0], 1);
assert.equal(raw.byteLength, input.tokens ** 2 * 139 * 4);
const expected = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const actual = relativeEncoding(input.tokens, input.features,
                                input.maxRelativeIndex, input.maxRelativeChain);
assert.equal(actual.length, expected.length);
const groups = Object.fromEntries(['proteinProtein', 'proteinLigand', 'ligandLigand']
  .map(name => [name, {pairs: 0, values: 0, mismatchedValues: 0}]));
let mismatchedValues = 0;
for (let i = 0; i < input.tokens; i++) {
  for (let j = 0; j < input.tokens; j++) {
    const group = groups[input.isLigand[i] && input.isLigand[j] ? 'ligandLigand'
      : input.isLigand[i] || input.isLigand[j] ? 'proteinLigand' : 'proteinProtein'];
    group.pairs++;
    for (let c = 0; c < 139; c++) {
      const index = (i * input.tokens + j) * 139 + c;
      assert(Number.isFinite(expected[index]) && (expected[index] === 0 || expected[index] === 1));
      assert(Number.isFinite(actual[index]));
      group.values++;
      if (actual[index] !== expected[index]) { group.mismatchedValues++; mismatchedValues++; }
    }
  }
}
console.log(JSON.stringify({tokens: input.tokens, channels: 139, pairs: input.tokens ** 2,
  values: actual.length, mismatchedValues, exact: mismatchedValues === 0, groups,
  neuralForwards: 0, gpuRequests: 0}));
