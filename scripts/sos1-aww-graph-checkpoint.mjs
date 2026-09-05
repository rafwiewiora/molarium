import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { verifyCampaign } from '../design-history/ledger.mjs';
import { moleculeFromCampaignCommit } from '../design-history/live-campaign.mjs';

export const A010_GRAPH_SHA256 =
  'c0672efabc8da255de45a6d8b41f3f1a2bb0652ac2e683a70a9ed33b8692b3b1';

export async function loadA010GraphCheckpoint(filename) {
  const bytes = await readFile(filename);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, A010_GRAPH_SHA256, 'Resume requires the exact a010 graph-only checkpoint');
  const campaign = JSON.parse(bytes);
  const verification = await verifyCampaign(campaign);
  assert.equal(verification.valid, true, verification.reason);
  const commitId = campaign.branches.main;
  const commit = campaign.objects.commits[commitId];
  assert(commit.tags.includes('graph-only') && commit.tags.includes('pre-designer-torsion'));
  const molecule = moleculeFromCampaignCommit(campaign, commitId);
  assert.equal(molecule.source.pdbId, '5OVE');
  assert.equal(molecule.source.stateId, 'AWW');
  assert.equal(molecule.source.stepId, 'open-phe890-pocket');
  return { bytes, sha256, campaign, commitId, snapshotId:commit.snapshotId, molecule };
}
