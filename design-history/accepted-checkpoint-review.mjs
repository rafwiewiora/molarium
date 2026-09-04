import { sha256Text } from './integrity.mjs';
import { commitMolecule, createCampaign, finalizeCampaign, storeSnapshot,
  verifyCampaign } from './ledger.mjs';
import { deserializeCampaign, serializeCampaign } from './live-campaign-store.mjs';
import { validateActionScript } from './replay.mjs';

export const ACCEPTED_CHECKPOINT_REVIEW_SCHEMA =
  'molarium.accepted-checkpoint-review/v1';

function stableText(value, label) {
  const result = String(value || '').trim();
  if (!result) throw new Error(`${label} must not be empty`);
  return result;
}

function sha256(value, label) {
  const result = stableText(value, label);
  if (!/^[a-f0-9]{64}$/.test(result))
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return result;
}

async function acceptedCheckpointMove(checkpoint, index) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint))
    throw new Error(`Checkpoint ${index + 1} must be an object`);
  if (checkpoint.accepted !== true)
    throw new Error(`Checkpoint ${index + 1} is not an accepted scientific result`);
  if (checkpoint.frozenBeforeHoldoutAccess !== true)
    throw new Error(`Checkpoint ${index + 1} was not frozen before holdout access`);
  const checkpointSha256 = sha256(checkpoint.checkpointSha256,
    `Checkpoint ${index + 1} checkpointSha256`);
  const serialized = String(checkpoint.serializedCampaign || '');
  if (!serialized.trim())
    throw new Error(`Checkpoint ${index + 1} serializedCampaign must not be empty`);
  const campaignSha256 = sha256(checkpoint.campaignSha256,
    `Checkpoint ${index + 1} campaignSha256`);
  if (await sha256Text(serialized) !== campaignSha256)
    throw new Error(`Checkpoint ${index + 1} campaign bytes do not match campaignSha256`);
  const campaign = deserializeCampaign(serialized);
  if (serializeCampaign(campaign) !== serialized)
    throw new Error(`Checkpoint ${index + 1} campaign is not canonically serialized`);
  const verification = await verifyCampaign(campaign);
  if (!verification.valid)
    throw new Error(`Checkpoint ${index + 1} campaign is invalid: ${verification.reason}`);
  const branch = stableText(checkpoint.branch || 'main',
    `Checkpoint ${index + 1} branch`);
  const commitId = stableText(checkpoint.commitId,
    `Checkpoint ${index + 1} commitId`);
  const snapshotId = stableText(checkpoint.snapshotId,
    `Checkpoint ${index + 1} snapshotId`);
  if (campaign.branches?.[branch] !== commitId)
    throw new Error(`Checkpoint ${index + 1} branch head does not match commitId`);
  if (campaign.objects?.commits?.[commitId]?.snapshotId !== snapshotId)
    throw new Error(`Checkpoint ${index + 1} commit does not match snapshotId`);
  if (!campaign.objects?.snapshots?.[snapshotId])
    throw new Error(`Checkpoint ${index + 1} snapshot is unavailable`);
  const label = stableText(checkpoint.label || `Accepted checkpoint ${index + 1}`,
    `Checkpoint ${index + 1} label`);
  return {
    action:'campaign.import',
    args:{ serialized },
    caption:`Review ${label}`,
    review:{
      schema:ACCEPTED_CHECKPOINT_REVIEW_SCHEMA,
      sourceStatus:'accepted',
      immutableSnapshot:true,
      promotable:false,
      calculationPolicy:'none',
      holdoutCoordinatesIncluded:false,
      checkpointSha256,
      campaignSha256,
      campaignId:campaign.campaignId,
      branch,
      commitId,
      snapshotId,
    },
  };
}

/**
 * Build a visible, calculation-free review of already accepted checkpoints.
 *
 * Every molecular state enters the application through the public
 * `campaign.import` Chemist Action.  The returned script is deliberately
 * non-promotable: it reviews accepted, content-addressed source snapshots but
 * does not perform or repeat the scientific calculation that produced them.
 */
export async function acceptedCheckpointReviewScript({ label, checkpoints } = {}) {
  if (!Array.isArray(checkpoints) || !checkpoints.length)
    throw new Error('At least one accepted checkpoint is required');
  const actions = [];
  for (const [index, checkpoint] of checkpoints.entries())
    actions.push(await acceptedCheckpointMove(checkpoint, index));
  const script = {
    schema:'molarium.chemist-action-script/v1',
    label:stableText(label || 'Accepted checkpoint review', 'Review label'),
    provenance:{
      schema:ACCEPTED_CHECKPOINT_REVIEW_SCHEMA,
      reviewOnly:true,
      sourceStatus:'accepted',
      sourceSnapshotsContentAddressed:true,
      promotable:false,
      nonPromotableReason:'A calculation-free review cannot create or promote a scientific result.',
      calculationPolicy:'none',
      holdoutCoordinatesIncluded:false,
      publicChemistActions:['campaign.import'],
    },
    actions,
  };
  validateActionScript(script);
  return script;
}

function acceptedInspectionSnapshot(checkpoint, index) {
  if (checkpoint.accepted !== true)
    throw new Error(`Checkpoint ${index + 1} is not an accepted scientific result`);
  if (checkpoint.frozenBeforeHoldoutAccess !== true)
    throw new Error(`Checkpoint ${index + 1} was not frozen before holdout access`);
  const pocket = checkpoint.pocket;
  if (!pocket || pocket.truncated === true || !Array.isArray(pocket.atoms)
    || pocket.atoms.length !== pocket.totalAtomCount)
    throw new Error(`Checkpoint ${index + 1} pocket inspection is incomplete`);
  const ligandIds = new Set((checkpoint.ligand?.atoms || []).map((atom) => atom.atomId));
  const pocketIds = new Set(pocket.atoms.map((atom) => atom.atomId));
  const sourceAtoms = [...pocket.atoms, ...(checkpoint.ligand?.atoms || [])
    .filter((atom) => !pocketIds.has(atom.atomId))];
  const atoms = sourceAtoms.map((atom, atomIndex) => {
    if (typeof atom.atomId !== 'string' || !atom.atomId)
      throw new Error(`Checkpoint ${index + 1} atom ${atomIndex + 1} has no persistent ID`);
    if (!Array.isArray(atom.coordinatesAngstrom) || atom.coordinatesAngstrom.length !== 3
      || !atom.coordinatesAngstrom.every(Number.isFinite))
      throw new Error(`Checkpoint ${index + 1} atom ${atom.atomId} has invalid coordinates`);
    const ligand = ligandIds.has(atom.atomId);
    return {
      atomId:atom.atomId,
      element:String(atom.element),
      formalCharge:Number(atom.formalCharge || 0),
      record:ligand ? 'HETATM' : 'ATOM',
      ...(atom.atomName ? { atomName:String(atom.atomName) } : {}),
      residueName:String(atom.residueName || (ligand ? 'LIG' : 'UNK')),
      chain:String(atom.chain || (ligand ? 'L' : 'A')),
      residueIndex:Number.isInteger(Number(atom.residueIndex))
        ? Number(atom.residueIndex) : ligand ? 1 : atomIndex + 1,
      aromatic:Boolean(atom.aromatic),
    };
  });
  if (new Set(atoms.map((atom) => atom.atomId)).size !== atoms.length)
    throw new Error(`Checkpoint ${index + 1} has duplicate persistent atom IDs`);
  const included = new Set(atoms.map((atom) => atom.atomId));
  const bonds = [], seen = new Set();
  for (const bond of [...(pocket.bonds || []), ...(checkpoint.ligand?.bonds || [])]) {
    const ids = bond.atomIds || [];
    if (ids.length !== 2 || !ids.every((id) => included.has(id))) continue;
    const key = [...ids].sort().join('\0');
    if (seen.has(key)) continue;
    seen.add(key);
    bonds.push({ atomIds:[...ids], order:Number(bond.order || 1),
      aromatic:Boolean(bond.aromatic) });
  }
  return { atoms, bonds, positions:sourceAtoms.map((atom) =>
    atom.coordinatesAngstrom.map(Number)) };
}

/** Package accepted coordinate inspections as content-addressed Design History
 * campaigns before they are registered for the full application UI. */
export async function acceptedInspectionCheckpointReviewScript({ label, checkpoints } = {}) {
  if (!Array.isArray(checkpoints) || !checkpoints.length)
    throw new Error('At least one accepted checkpoint is required');
  const packaged = [];
  for (const [index, checkpoint] of checkpoints.entries()) {
    const checkpointSha256 = sha256(checkpoint.checkpointSha256,
      `Checkpoint ${index + 1} checkpointSha256`);
    const snapshot = acceptedInspectionSnapshot(checkpoint, index);
    const occurredAt = `2000-01-01T00:00:${String(index).padStart(2, '0')}.000Z`;
    const campaign = createCampaign({
      campaignId:`accepted-checkpoint-${checkpointSha256.slice(0, 16)}`,
      title:stableText(checkpoint.label || `Accepted checkpoint ${index + 1}`,
        `Checkpoint ${index + 1} label`),
      description:'Calculation-free package of an accepted pre-holdout checkpoint.',
      createdAt:occurredAt,
      actors:[{ id:'molarium.review-packager', type:'system',
        displayName:'Molarium accepted-checkpoint packager' }],
      application:{ reviewOnly:true, promotable:false, sourceCheckpointSha256:checkpointSha256 },
    });
    const snapshotId = await storeSnapshot(campaign, {
      label:campaign.title,
      graph:{ atoms:snapshot.atoms, bonds:snapshot.bonds },
      coordinates:{ unit:'angstrom', atomIds:snapshot.atoms.map((atom) => atom.atomId),
        positions:snapshot.positions },
      properties:{ provenance:{ sourceStatus:'accepted', frozenBeforeHoldoutAccess:true,
        sourceCheckpointSha256:checkpointSha256, holdoutCoordinatesIncluded:false } },
    });
    const commitId = await commitMolecule(campaign, { snapshotId, parents:[], branch:'main',
      message:`Package ${campaign.title}`, actorId:'molarium.review-packager', occurredAt,
      tags:['accepted','pre-holdout','review-only'] });
    await finalizeCampaign(campaign, {
      finalizedAt:`2000-01-01T00:00:${String(index).padStart(2, '0')}.500Z`,
      actorId:'molarium.review-packager',
    });
    const serializedCampaign = serializeCampaign(campaign);
    packaged.push({ accepted:true, frozenBeforeHoldoutAccess:true, checkpointSha256,
      campaignSha256:await sha256Text(serializedCampaign), serializedCampaign,
      branch:'main', commitId, snapshotId, label:campaign.title });
  }
  return acceptedCheckpointReviewScript({ label, checkpoints:packaged });
}
