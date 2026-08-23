import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { readPanelManifest, validatePanelManifest,
  validatePanelResults } from './7kpa-two-terminus-panel.mjs';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null;
};
const input = valueAfter('--input')
  || 'docking/benchmark/results/7kpa-two-terminus-panel.development.json';
const { manifest } = await readPanelManifest();
await validatePanelManifest(manifest);
const results = JSON.parse(await readFile(path.resolve(input), 'utf8'));
const validated = validatePanelResults(results, manifest, {
  requireComplete:args.includes('--require-complete'),
});
console.log(`7KPA two-terminus results: PASS (${validated.cases} cases; `
  + `${validated.agreeing} deterministic replay agreements)`);
