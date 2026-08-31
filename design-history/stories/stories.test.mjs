import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCampaign } from '../ledger.mjs';
import { verifyMovieManifest } from '../movie.mjs';
import { validateActionScript } from '../replay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const generated = path.join(here, 'generated');
const index = JSON.parse(await readFile(path.join(generated, 'index.json')));
assert.equal(index.schema, 'molarium.design-story-index/v1');
assert.deepEqual(index.stories.map((entry) => entry.id), [
  'moonshot-dndi-6510', 'bclxl-fragment-linking', 'molarium-7kpa-rehearsal',
]);

const records = new Map();
for (const entry of index.stories) {
  const campaign = JSON.parse(await readFile(path.join(generated, path.basename(entry.campaign))));
  const movie = JSON.parse(await readFile(path.join(generated, path.basename(entry.movie))));
  assert.equal((await verifyCampaign(campaign)).valid, true, entry.id);
  assert.equal((await verifyMovieManifest(movie, campaign)).valid, true, `${entry.id} movie`);
  assert.equal(entry.summary.campaignSha256, campaign.campaignSha256);
  const decisions = campaign.events.filter((event) => event.kind === 'decision.recorded');
  const decided = new Set(decisions.map((event) => event.payload.targetCommitId));
  assert.deepEqual([...decided].sort(), Object.keys(campaign.objects.commits).sort(),
    `${entry.id} must preserve a disposition for every molecular commit`);
  assert(decisions.some((event) => event.payload.disposition === 'progressed'));
  assert(decisions.some((event) => event.payload.disposition !== 'progressed'));
  for (const script of Object.values(campaign.objects.actionScripts)) validateActionScript(script);
  records.set(entry.id, { campaign, movie });
}

const moonshot = records.get('moonshot-dndi-6510').campaign;
assert.equal(moonshot.events.filter((event) => event.kind === 'decision.recorded'
  && event.payload.disposition === 'not-progressed').length, 4);
assert.equal(moonshot.events.filter((event) => event.kind === 'decision.recorded'
  && event.payload.disposition === 'superseded').length, 2);
assert(moonshot.events.some((event) => event.kind === 'decision.recorded'
  && event.payload.reasonCodes.includes('program-discontinued')));
assert(moonshot.events.every((event) => ['reported-in-source','molarium-reconstruction']
  .includes(event.payload?.claimStatus) || event.kind === 'molecule.committed'
  || event.kind === 'decision.recorded' || event.kind === 'campaign.completed'));

const bcl = records.get('bclxl-fragment-linking').campaign;
assert.equal(bcl.events.filter((event) => event.kind === 'decision.recorded'
  && event.payload.disposition === 'not-progressed').length, 5);
assert(bcl.events.some((event) => event.payload?.measuredGapAngstrom === 8.2));

const rehearsal = records.get('molarium-7kpa-rehearsal').campaign;
assert.equal(Object.keys(rehearsal.objects.actionScripts).length, 3);
assert(Object.values(rehearsal.objects.actionScripts).every((script) =>
  script.actions.every((step) => !String(step.action).includes('coordinate'))));
assert(Object.values(rehearsal.objects.actionScripts).some((script) =>
  script.actions.some((step) => step.capture?.thpBridge === 'addedAtomId')));
const spiroDecision = rehearsal.events.find((event) => event.kind === 'decision.recorded'
  && event.payload.rationale.includes('11 clashes'));
assert.equal(spiroDecision.payload.disposition, 'not-progressed');

const before = new Map();
for (const file of (await readdir(generated)).sort()) {
  const bytes = await readFile(path.join(generated, file));
  before.set(file, createHash('sha256').update(bytes).digest('hex'));
}
const rebuilt = spawnSync(process.execPath, [path.join(here, 'build-pilot-stories.mjs')],
  { cwd:path.resolve(here, '../..'), encoding:'utf8' });
assert.equal(rebuilt.status, 0, rebuilt.stderr || rebuilt.stdout);
for (const [file, digest] of before) {
  const bytes = await readFile(path.join(generated, file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), digest,
    `${file} changed across a deterministic rebuild`);
}

console.log('design-history story tests passed: 3 campaigns, complete commit dispositions, deterministic rebuild');
