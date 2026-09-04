import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL(
  './run-sos1-aww-receptor-only-prospective.browser.mjs', import.meta.url), 'utf8');
const sourceCampaignBytes = await readFile(new URL(
  '../design-history/publications/sos1/checkpoints/fragment-merge-campaign.json',
  import.meta.url));
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
assert.match(source, /sourcePath:`\.\/\$\{SOURCE_CAMPAIGN_PATH\}`/,
  'campaign import must avoid cloning a multi-megabyte serialized argument');
assert.match(source, /designRoute\.resume[\s\S]{0,120}stateId:SOURCE_STATE_ID/);
assert.match(source,
  /execute\('protein\.parameterize'[\s\S]{0,240}maximumCoordinateDisplacementAngstrom, 0/,
  'the resumed coordinate checkpoint must be parameterized without movement');
assert.match(source, /stepId:AWW_STEP_ID/);
assert.match(source, /aww-graph-only-campaign\.json/);
const graphOnlyCommit = source.indexOf("'commit-aww-graph-only'");
const designerTorsion = source.indexOf("execute('geometry.setInternalCoordinate'");
assert(graphOnlyCommit > 0 && designerTorsion > graphOnlyCommit,
  'the raw AWW graph must be committed before designer torsion intent');
assert.match(source, /DESIGNER_TORSION_ATOM_NAMES = Object\.freeze\(\['N7', 'C12', 'C15', 'CX2'\]\)/);
assert.match(source, /execute\('geometry\.setInternalCoordinate'/);
assert.match(source, /relativeRotationDegrees:180/);
assert.match(source, /execute\('pose\.addContact'/);
assert.match(source, /atomName:'N7'[\s\S]{0,180}residueName:'ASN'[\s\S]{0,100}residueIndex:879/);
assert.match(source, /atomName:'OX3'[\s\S]{0,180}residueName:'TYR'[\s\S]{0,100}residueIndex:884/);
assert.match(source, /hypothesesAreScoringResults:false/);
assert.match(source, /execute\('pose\.setDesignerLigandPoseFixed'/);
assert.match(source, /ensemble\.designerFixedLigandPose\?\.lockId, designerLock\.lockId/);
assert.match(source, /applied\.designerFixedLigandPose\?\.lockId, designerLock\.lockId/);
assert.match(source, /message:'Freeze explicit AWW ligand directional intent before receptor prediction'/);

const intentCommit = source.indexOf("'commit-designer-ligand-intent'");
const enumeration = source.indexOf("execute('pose.enumerateSidechainRotamers'");
assert(intentCommit > 0 && enumeration > intentCommit,
  'designer ligand intent must be committed before Phe890 enumeration');
assert.match(source, /const selected = ensemble\.candidates\[0\]/,
  'the declared steric rank, rather than a retrospectively chosen chi vector, selects Phe890');
assert.match(source, /chiDegrees:selected\.chiDegrees/,
  'the selected receptor response must replay by portable chi angles');
assert.match(source, /expectedInputCoordinateSha256:ensemble\.inputCoordinateSha256/);
assert.match(source, /expectedSelectedCoordinateSha256:selected\.coordinateSha256/);
assert.match(source, /assert\.deepEqual\(canonicalLigandInspection\(inspections\.ligandAfterPhe\),[\s\S]{0,180}frozenLigandState/,
  'ligand coordinates and topology must be checked atom-by-atom after the receptor move');
assert.match(source, /ligandCoordinateEquality:[\s\S]{0,180}postPheLigandFingerprints\.coordinateSha256/);
assert.match(source, /DISALLOWED_CURRENT_RUN_ACTIONS/);
assert.doesNotMatch(source, /execute\('pose\.refine'/);
assert.doesNotMatch(source, /execute\('pose\.apply'/);
assert.doesNotMatch(source, /execute\('pose\.updateReceptorReference'/);
assert.doesNotMatch(source, /execute\('optimization\.run'/);
assert.doesNotMatch(source, /execute\('calculation\.run'/);
assert.doesNotMatch(source, /5OV[F-I]/,
  'prediction source must not name later structures');
assert.match(source, /Refusing to overwrite immutable attempt/);
assert.match(source, /prediction-manifest\.json/);
assert.match(source, /failed-run\.json/);
assert.match(source, /coordinate-inspections\.json/);
assert.match(source, /aww-receptor-only-prediction-campaign\.json/);

console.log('SOS1 AWW receptor-only prospective runner source tests passed');
