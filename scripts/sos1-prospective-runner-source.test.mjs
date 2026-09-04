import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./run-sos1-prospective.mjs', import.meta.url), 'utf8');
assert.match(source,
  /\['open-phe890-pocket', 'finish-bay-293'\]\.includes\(requestedStop\)/,
  'exact-coordinate diagnostic must support the reduced prefix through final BAY-293');
assert.match(source, /publicationEligible:completeRouteRun && diagnosticPhe890CoordinateSha256 == null/,
  'partial runs must be diagnostic and non-promotable');
assert.match(source, /requireAcceptedRelaxation\(relaxed, stepId,/,
  'every ordinary route checkpoint must require accepted relaxation');
assert.match(source, /valence safeguard did not inspect the exact staged product graph/);
assert.match(source, /requireExactStagedProductGraph\(ligand, staged, stepId\)/);
assert.match(source, /requireRegisteredFeatureRefinement\(refined, staged, stepId\)/,
  'registered retained features must be checked on the public pose result');
assert.match(source, /Phe890 left the selected predecessor rotamer basin/,
  'final checkpoint must retain and remeasure the prospective Phe890 state');
assert(!source.includes('window.molariumTest'));

console.log('SOS1 reduced diagnostic runner remains public-action-only and non-promotable');
