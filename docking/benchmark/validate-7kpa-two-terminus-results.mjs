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
const enumerationPanel = args.includes('--enumerations');
const manualRecapturePanel = args.includes('--manual-recapture');
if (enumerationPanel && manualRecapturePanel)
  throw new Error('Choose either --enumerations or --manual-recapture');
const manifest = enumerationPanel
  ? await (await import('../../enumerations/high-disruption-panel.mjs'))
    .buildHighDisruptionPanelManifest()
  : manualRecapturePanel
    ? await (await import('./7kpa-manual-contact-panel.mjs'))
      .buildManualContactPanelManifest()
  : (await readPanelManifest()).manifest;
await validatePanelManifest(manifest);
const results = JSON.parse(await readFile(path.resolve(input), 'utf8'));
const validated = validatePanelResults(results, manifest, {
  requireComplete:args.includes('--require-complete'),
});
const replayMessage = validated.repeatedCases
  ? `${validated.repeatedAgreeing}/${validated.repeatedCases} repeated replay agreements`
  : 'single-replay identity/schema checks only';
const profileLabel = enumerationPanel ? 'high-disruption enumeration'
  : manualRecapturePanel ? 'manual contact recapture' : 'two-terminus';
console.log(`7KPA ${profileLabel} results: PASS (${validated.cases} cases; ${replayMessage})`);
