import { readPanelManifest, validatePanelManifest } from './7kpa-two-terminus-panel.mjs';

const { manifest } = await readPanelManifest();
const result = await validatePanelManifest(manifest);
console.log(`7KPA two-terminus panel: PASS (${result.cases} cases; `
  + Object.entries(result.loci).map(([key, value]) => `${key}=${value}`).join(', ') + ')');
