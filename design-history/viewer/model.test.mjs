import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCampaignModel, cueState, decisionPresentation, eventLabel,
  selectedRecord, narrativeText } from './model.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const generated = path.resolve(here, '../stories/generated');
const campaign = JSON.parse(await readFile(path.join(generated, 'moonshot-dndi-6510.campaign.json')));
const movie = JSON.parse(await readFile(path.join(generated, 'moonshot-dndi-6510.movie.json')));
const model = buildCampaignModel(campaign);
assert.equal(model.nodes.length, Object.keys(campaign.objects.commits).length);
assert(model.edges.length >= model.nodes.length - 2);
assert.equal(model.nodes.filter((node) => node.status.tone === 'stopped').length, 4);
assert(model.nodes.some((node) => node.status.tone === 'archived'));
assert(model.branchNames[0] === 'main');
assert(model.edges.some((edge) => edge.merge));
assert.equal(decisionPresentation('not-progressed').label, 'Not progressed');
assert.equal(eventLabel('hypothesis.proposed'), 'Hypothesis');

const first = cueState(movie, { cueIndex:0 });
assert.equal(first.cue.title, 'Start with (S)-x1');
assert.equal(first.frameIndex, 0);
const bounded = cueState(movie, { frame:999999 });
assert.equal(bounded.frameIndex, bounded.frames.length - 1);
const record = selectedRecord(campaign, first.cue);
assert(record.snapshot.canonicalSmiles.includes('CNC'));
assert.equal(record.actor.type, 'import');
assert.match(narrativeText(record.event, first.cue), /potent structural lead/i);

console.log(`design-history viewer model tests passed: ${model.nodes.length} commits, ${model.branchNames.length} branches`);
