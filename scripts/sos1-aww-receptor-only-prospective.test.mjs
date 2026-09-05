import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL(
  './run-sos1-aww-receptor-only-prospective.browser.mjs', import.meta.url), 'utf8');
const sourceCampaignBytes = await readFile(new URL(
  '../design-history/publications/sos1/checkpoints/fragment-merge-campaign.json',
  import.meta.url));
assert.match(source, /await browser.evaluate\('window.MolariumChemistActionsReady.then\(\(\) => true\)'\)/,
  'the runner must await API installation, not merely the existence of its readiness promise');
assert.equal(createHash('sha256').update(sourceCampaignBytes).digest('hex'),
  'e1a7722f517b5371efad860dc6d87bf31d813b05df6c3e72db74e71e3236cb81');
const sourceCampaign = JSON.parse(sourceCampaignBytes);
const sourceHead = sourceCampaign.objects.commits[sourceCampaign.branches.main];
const sourceSnapshot = sourceCampaign.objects.snapshots[sourceHead.snapshotId];
assert.equal(sourceSnapshot.properties.molecule.source.stateId, 'AWZ',
  'the hash-pinned full-system source must be the frozen AWZ state');

assert.match(source, /fragment-merge-campaign\.json/,
  'the runner must resume the exact frozen AWZ full-system campaign');
assert.match(source, /e1a7722f517b5371efad860dc6d87bf31d813b05df6c3e72db74e71e3236cb81/,
  'the AWZ source bytes must be hash-pinned');
assert.match(source, /sourcePath:`\.\/\$\{sourcePath\}`/,
  'campaign import must avoid cloning a multi-megabyte serialized argument');
assert.match(source, /designRoute\.resume[\s\S]{0,160}stateId:graphSource \? PRODUCT_STATE_ID : SOURCE_STATE_ID/);
assert.match(source, /loadA010GraphCheckpoint/);
assert.match(source, /DESIGNER_UPSTREAM_AXIS_ATOM_NAMES = Object\.freeze\(\['N7', 'C12'\]\)/);
assert.match(source, /DESIGNER_UPSTREAM_RANGE_DEGREES = Object\.freeze\(\[0,60\]\)/);
assert.match(source, /stepId:AWW_STEP_ID/);
assert.match(source, /aww-graph-only-campaign\.json/);
const graphOnlyCommit = source.indexOf("'commit-aww-graph-only'");
const hingeContact = source.indexOf("'record-designer-asn879-hypothesis'");
const distalContact = source.indexOf("'record-designer-tyr884-hypothesis'");
const designerGeometry = source.indexOf("execute('geometry.alignBranchToContact'");
assert(graphOnlyCommit > 0 && hingeContact > graphOnlyCommit
  && distalContact > hingeContact && designerGeometry > distalContact,
'the raw graph and both portable contacts must precede designer geometry');
assert.match(source, /DESIGNER_TORSION_ATOM_NAMES = Object\.freeze\(\['N7', 'C12', 'C15', 'CX2'\]\)/);
assert.match(source, /execute\('geometry\.alignBranchToContact'/);
assert.match(source, /DESIGNER_PRIMARY_ROTATION_DEGREES = 150/);
assert.match(source, /DESIGNER_PRIMARY_AXIS_ATOM_NAMES = Object\.freeze\(\['C12', 'C15'\]\)/);
assert.match(source, /Object\.freeze\(\['CX4', 'CX5'\]\)/);
assert.match(source, /Object\.freeze\(\['CX15', 'CX16'\]\)/);
assert.match(source, /axisAtomIds:primaryAxisAtomIds/);
assert.match(source, /solution:'best-directional'/);
assert.match(source, /contactId:distalHypothesis\.result\.contact\.contactId/);
assert.match(source, /designerPrimaryRotationDegrees:DESIGNER_PRIMARY_ROTATION_DEGREES/);
assert.match(source, /coupledAxisAtomIds/);
assert.match(source, /allowedResponseAtoms:PHE890_RESPONSE_ATOMS/);
assert.doesNotMatch(source, /ligandFeatureAtomId:/);
assert.doesNotMatch(source, /receptorTargetAtomId:/);
assert.doesNotMatch(source, /targetDistanceAngstrom:/);
assert.match(source, /externalReferenceCoordinatesUsed, false/);
assert.match(source, /execute\('pose\.addContact'/);
assert.match(source, /atomName:'N7'[\s\S]{0,180}residueName:'ASN'[\s\S]{0,100}residueIndex:879/);
assert.match(source, /atomName:'OX3'[\s\S]{0,180}residueName:'TYR'[\s\S]{0,100}residueIndex:884/);
assert.match(source, /hypothesesAreScoringResults:false/);
assert.match(source, /outsideAllowedResponseContactCount, 0/);
for (const field of ['searchAudit', 'algorithm', 'coarse', 'local', 'gates', 'ranking',
  'inputCoordinateSha256', 'searchDefinitionSha256', 'selectedCandidateSha256',
  'outputCoordinateSha256', 'carbonylAcceptorAngleDegrees'])
  assert(source.includes(field), `designer geometry evidence must include ${field}`);
assert.match(source, /execute\('pose\.setDesignerLigandPoseFixed'/);
assert.match(source, /ensemble\.designerFixedLigandPose\?\.lockId, designerLock\.lockId/);
assert.match(source, /applied\.designerFixedLigandPose\?\.lockId, designerLock\.lockId/);
assert.match(source, /message:'Freeze explicit AWW ligand directional intent before receptor prediction'/);

const intentCommit = source.indexOf("'commit-designer-ligand-intent'");
const parameterization = source.indexOf("'parameterize-fixed-aww-without-motion'");
const enumeration = source.indexOf("execute('pose.enumerateSidechainRotamers'");
assert(intentCommit > 0 && parameterization > intentCommit && enumeration > parameterization,
  'designer ligand intent must be committed and parameterized without motion before Phe890 enumeration');
assert.match(source,
  /execute\('protein\.parameterize'[\s\S]{0,240}maximumCoordinateDisplacementAngstrom, 0/,
  'full-system parameters must be assigned without coordinate motion');
assert.match(source, /maximumCandidates:64/);
assert.match(source, /ensemble\.candidates\.length, ensemble\.generatedCandidateCount/,
  'the runner must retain every generated Phe890 candidate');
assert.match(source, /for \(let ordinal = 0; ordinal < candidateCoordinateHashes\.length; ordinal\+\+\)/);
assert.match(source, /coordinateSha256:candidate\.coordinateSha256/);
assert.match(source, /execute\('calculation\.run'/);
assert.match(source, /job:'energy', method:'openmm', options:ENERGY_OPTIONS/);
assert.match(source, /movedHeavyAtomCount, 0/);
assert.match(source, /maximumDisplacementAngstrom, 0/);
assert.match(source, /coordinatesSaved:true/);
assert.match(source, /phe890-candidate-/);
assert.match(source, /execute\('history\.undo'/);
assert.match(source, /rankFiniteClashFreeCandidates\(candidateAudits\)/);
assert.match(source, /minimum finite full-system OpenMM single-point energy among zero-severe-clash candidates/);
assert.match(source, /chiDegrees:finalCandidate\.chiDegrees/,
  'the selected receptor response must replay by portable chi angles');
assert.match(source, /expectedInputCoordinateSha256:finalEnsemble\.inputCoordinateSha256/);
assert.match(source, /expectedSelectedCoordinateSha256:finalCandidate\.coordinateSha256/);
assert.match(source, /assert\.deepEqual\(canonicalLigandInspection\(inspections\.ligandAfterPhe\),[\s\S]{0,180}frozenLigandState/,
  'ligand coordinates and topology must be checked atom-by-atom after the receptor move');
assert.match(source, /ligandCoordinateEquality:[\s\S]{0,180}postPheLigandFingerprints\.coordinateSha256/);
assert.match(source, /DISALLOWED_CURRENT_RUN_ACTIONS/);
assert.doesNotMatch(source, /execute\('pose\.refine'/);
assert.doesNotMatch(source, /execute\('pose\.apply'/);
assert.doesNotMatch(source, /execute\('pose\.updateReceptorReference'/);
assert.doesNotMatch(source, /execute\('geometry\.setInternalCoordinate'/);
assert.doesNotMatch(source, /execute\('optimization\.run'/);
assert.doesNotMatch(source, /5OV[F-I]/,
  'prediction source must not name later structures');
assert.match(source, /const boundaryFile = await save\('boundary\.json', boundary\)/);
assert.match(source, /boundary:boundaryFile/,
  'the manifest must bind the exact prospective boundary bytes');
assert.match(source, /currentRunRequestIds:\[\.\.\.currentRequestIds\]/,
  'the manifest must bind current-run audit records by request ID');
assert.match(source, /energyCalculations:energyCalculationRecords\.map/,
  'the manifest must preserve exact energy action evidence');
assert.match(source, /Refusing to overwrite immutable attempt/);
assert.match(source, /prediction-manifest\.json/);
assert.match(source, /failed-run\.json/);
assert.match(source, /coordinate-inspections\.json/);
assert.match(source, /aww-receptor-only-prediction-campaign\.json/);

console.log('SOS1 AWW receptor-only prospective runner source tests passed');
