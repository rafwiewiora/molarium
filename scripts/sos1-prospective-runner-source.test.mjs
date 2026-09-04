import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./run-sos1-prospective.mjs', import.meta.url), 'utf8');
assert.match(source,
  /\['open-phe890-pocket', 'finish-bay-293'\]\.includes\(requestedStop\)/,
  'diagnostic selector must support the reduced prefix through final BAY-293');
assert.match(source, /publicationEligible:completeRouteRun && !diagnosticPhe890/,
  'partial runs must be diagnostic and non-promotable');
assert.match(source, /--diagnostic-phe890-seed-chi-degrees/,
  'runner must accept a unique current-enumeration seed-chi selector');
assert.match(source, /resolveDiagnosticPhe890Candidate\(\{ \.\.\.ensemble,/,
  'diagnostic selector must resolve against the complete current public enumeration');
assert.match(source, /diagnosticPhe890ProtocolFields\(\{/,
  'manifest construction must fail closed when resolved same-enumeration hashes are absent');
assert.match(source, /assertSidechainChiAnglesReproduced\(candidate\.chiDegrees, appliedSeedChiDegrees\)/,
  'the applied public-action seed must be remeasured before relaxation');
assert.match(source, /expectedInputCoordinateSha256:ensemble\.inputCoordinateSha256/,
  'the public apply must fail if coordinates mutate after enumeration');
assert.match(source, /requireAcceptedRelaxation\(relaxed, stepId,/,
  'every ordinary route checkpoint must require accepted relaxation');
assert.match(source, /valence safeguard did not inspect the exact staged product graph/);
assert.match(source, /requireExactStagedProductGraph\(ligand, staged, stepId\)/);
assert.match(source, /requireRegisteredFeatureRefinement\(refined, staged, stepId\)/,
  'registered retained features must be checked on the public pose result');
assert.match(source, /await execute\('campaign\.create'/,
  'the runner must begin a public full-system Design History');
assert.match(source, /await execute\('campaign\.commitCurrent'/,
  'every accepted molecular checkpoint must commit the full system');
assert.match(source, /await execute\('campaign\.verify'/,
  'every full-system checkpoint must pass ledger verification');
assert.match(source, /await execute\('campaign\.export'/,
  'every full-system checkpoint must export a publicly resumable campaign');
assert.match(source, /fullSystemCampaign:campaignRecord/,
  'coordinate checkpoints must pin their full-system campaign snapshot');
assert.match(source, /Phe890 left the selected predecessor rotamer basin/,
  'final checkpoint must retain and remeasure the prospective Phe890 state');
assert(!source.includes('window.molariumTest'));

console.log('SOS1 reduced diagnostic runner remains public-action-only and non-promotable');
