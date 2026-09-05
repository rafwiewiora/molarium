import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateDesignerHydrogenBond, extractRecordedLigandIntent,
  rankFiniteClashFreeCandidates }
  from './rank-sos1-phe890-fixed-ligand-energy.browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const runner = await readFile(resolve(here,
  'rank-sos1-phe890-fixed-ligand-energy.browser.mjs'), 'utf8');

function contact({ acceptor = [2.9, 0, 0], hydrogen = [1, 0, 0],
  required = true, available = true } = {}) {
  return { contactId:'designer-hbond', required, available, hydrogenBond:{ participants:{
    donor:{ scope:'ligand', coordinatesAngstrom:[0, 0, 0] },
    hydrogen:{ scope:'ligand', coordinatesAngstrom:hydrogen },
    acceptor:{ scope:'receptor', coordinatesAngstrom:acceptor },
  } } };
}

const satisfied = evaluateDesignerHydrogenBond(contact());
assert.equal(satisfied.satisfied, true);
assert(Math.abs(satisfied.donorAcceptorDistanceAngstrom - 2.9) < 1e-10);
assert(Math.abs(satisfied.hydrogenAcceptorDistanceAngstrom - 1.9) < 1e-10);
assert(Math.abs(satisfied.dhaAngleDegrees - 180) < 1e-10);
assert.equal(evaluateDesignerHydrogenBond(contact({ acceptor:[0, 2.9, 0] })).satisfied,
  false, 'Bad donor-hydrogen-acceptor direction must fail closed');
assert.equal(evaluateDesignerHydrogenBond(contact({ available:false })).satisfied, false);
assert.equal(evaluateDesignerHydrogenBond({ contactId:'missing', required:true,
  available:true, hydrogenBond:{ participants:{} } }).satisfied, false);

const fixtureCampaign = {
  schema:'molarium.design-campaign/v1', branches:{ main:'commit:head' },
  objects:{ commits:{ 'commit:head':{ snapshotId:'snapshot:head',
    actionScriptId:'script:head' } }, snapshots:{ 'snapshot:head':{
    properties:{ molecule:{ source:{ pdbId:'5OVE' } } } } }, actionScripts:{
    'script:head':{ actions:[
      { action:'pose.addContact', args:{ ligandAtom:{ componentId:'ligand', atomName:'OX3' },
        receptorAtom:{ residueName:'TYR', chain:'A', residueIndex:884,
          insertionCode:'', atomName:'O' }, ligandRole:'donor' } },
      { action:'pose.setDesignerLigandPoseFixed', args:{ fixed:true, label:'intent' } },
    ] },
  } },
};
const intent = extractRecordedLigandIntent(fixtureCampaign);
assert.equal(intent.contacts.length, 1);
assert.equal(intent.lock.fixed, true);
assert.throws(() => extractRecordedLigandIntent({ ...fixtureCampaign,
  objects:{ ...fixtureCampaign.objects, actionScripts:{ 'script:head':{ actions:[] } } } }),
/hydrogen-bond contact/);
assert.throws(() => extractRecordedLigandIntent({ ...fixtureCampaign,
  objects:{ ...fixtureCampaign.objects, actionScripts:{ 'script:head':{ actions:[
    fixtureCampaign.objects.actionScripts['script:head'].actions[0],
  ] } } } }), /active designer-fixed/);
assert.throws(() => extractRecordedLigandIntent({ ...fixtureCampaign,
  objects:{ ...fixtureCampaign.objects, snapshots:{ 'snapshot:head':{
    properties:{ molecule:{ source:{ pdbId:'later-structure' } } } } } } }),
/5OVE prospective coordinate boundary/);

const candidate = (coordinateSha256, chiDegrees, severeClashes, fullSystemEnergy) => ({
  coordinateSha256, chiDegrees, severeClashes, fullSystemEnergy,
  coordinatesSaved:true,
});
const selected = rankFiniteClashFreeCandidates([
  candidate('b'.repeat(64), [60, 90], 0, -10),
  candidate('a'.repeat(64), [-180, 90], 1, -1000),
  candidate('c'.repeat(64), [-180, -90], 0, -12),
  candidate('d'.repeat(64), [180, 180], 0, Number.NaN),
]);
assert.equal(selected.coordinateSha256, 'c'.repeat(64),
  'The minimum finite energy after the zero-severe-clash gate must win');
assert.throws(() => rankFiniteClashFreeCandidates([
  { ...candidate('e'.repeat(64), [0, 0], 0, -1), coordinatesSaved:false },
]), /lacks saved coordinates/);
assert.throws(() => rankFiniteClashFreeCandidates([
  candidate('f'.repeat(64), [0, 0], 1, -1),
]), /No finite full-system energy survived/);

for (const required of [
  "execute('campaign.import'", "execute('campaign.verify'",
  "execute('pose.setDesignerLigandPoseFixed'", "execute('protein.parameterize'",
  "execute('pose.enumerateSidechainRotamers'", "execute('pose.applySidechainRotamer'",
  "execute('calculation.run'", "execute('history.undo'", 'includeCoordinates:true',
  'Refusing to overwrite immutable attempt', 'maximumCoordinateDisplacementAngstrom',
]) assert.match(runner, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(runner, /job:'energy', method:'openmm'/);
assert.match(runner, /severeClashes/);
assert.match(runner, /coordinatesSaved:true/);
for (const forbidden of ['window.molariumTest', 'pose.refine', 'optimization.run',
  'designRoute.applyStep', 'geometry.alignBranchToContact'])
  assert.equal(runner.includes(forbidden), false,
    `Energy-rank runner must not use ${forbidden}`);
assert.doesNotMatch(runner, /5OVH|5OVI/,
  'Energy-rank runner must not name later structural holdouts');

console.log('SOS1 fixed-ligand Phe890 full-system energy rank tests passed');
