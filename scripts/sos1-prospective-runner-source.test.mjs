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
assert.match(source,
  /ligandAtom:\{ componentId:'heterogen:A:1104::AWW', atomName:'N7' \}[\s\S]*receptorAtom:\{ residueName:'ASN', chain:'A', residueIndex:879,[\s\S]*atomName:'OD1'/,
  'AWW search must preserve the starting-coordinate N7 to ASN879 OD1 contact');
assert.match(source,
  /ligandAtom:\{ componentId:'heterogen:A:1104::AWW', atomName:'OX3' \}[\s\S]*receptorAtom:\{ residueName:'TYR', chain:'A', residueIndex:884,[\s\S]*atomName:'O'/,
  'AWW search must install the declared OX3 to Tyr884 backbone-carbonyl intent');
assert.match(source, /transientContactIds = \[hingeContact, intendedContact\]/,
  'both public required contacts must participate in every Phe branch');
assert.match(source, /await execute\('pose\.forgetContact'/,
  'AWW-only design hypotheses must be retired through the public API before the AXH edit');
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
const graphEditCommit = source.indexOf(
  "stageId:'compound-21-graph-edit-before-phe890-rotamer'");
const selectedRotamerCommit = source.indexOf(
  "stageId:'phe890-rotamer-before-coupled-relaxation'");
const stagedGraph = source.indexOf("const staged = await execute('designRoute.applyStep'");
const branchSearch = source.indexOf('rotamerDecision = await choosePhe890Branch');
const selectedRotamerApply = source.indexOf("`${stepId}-apply-selected-phe890-branch`");
const selectedCommitCallback = source.indexOf('await onSelectedRotamerApplied',
  selectedRotamerApply);
const selectedPoseRefinement = source.indexOf("`${stepId}-pose-selected-phe890-branch`",
  selectedRotamerApply);
assert(graphEditCommit > stagedGraph && graphEditCommit < branchSearch,
  'compound-21 graph coordinates must be committed after the edit and before branch search');
assert(selectedRotamerCommit > source.indexOf('onSelectedRotamerApplied:async () =>'),
  'the selected-rotamer callback must create its exact campaign checkpoint');
assert(selectedRotamerApply < selectedCommitCallback
  && selectedCommitCallback < selectedPoseRefinement,
  'selected Phe890 coordinates must be committed before ligand refinement');
assert.match(source,
  /intermediateFullSystemCheckpoints:\[\s*'compound-21-graph-edit-before-phe890-rotamer',\s*'phe890-rotamer-before-coupled-relaxation'/,
  'the production manifest must declare both ordered pre-refinement checkpoints');
assert.match(source, /Phe890 left the selected predecessor rotamer basin/,
  'final checkpoint must retain and remeasure the prospective Phe890 state');
assert(!source.includes('window.molariumTest'));

console.log('SOS1 reduced diagnostic runner remains public-action-only and non-promotable');
