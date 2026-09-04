import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createCampaign, commitMolecule, storeSnapshot } from
  '../design-history/ledger.mjs';
import { snapshotPayloadFromMolecule } from '../design-history/live-campaign.mjs';
import { serializeCampaign } from '../design-history/live-campaign-store.mjs';

export const SOS1_FINAL_DIAGNOSTIC_SCHEMA =
  'molarium.sos1-final-step-diagnostic/v1';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function plainAtom(record) {
  const position = record?.coordinatesAngstrom;
  if (!record?.atomId || !record?.atomName || !record?.element
    || !Array.isArray(position) || position.length !== 3
    || !position.every(Number.isFinite))
    throw new Error('The frozen pocket contains an incomplete atom record');
  const residueName = String(record.residueName || 'UNK');
  return {
    designAtomId:String(record.atomId), atomName:String(record.atomName),
    element:String(record.element), formalCharge:Number(record.formalCharge || 0),
    charge:Number(record.formalCharge || 0), aromatic:Boolean(record.aromatic),
    record:residueName === 'AWW' || ['HOH','WAT'].includes(residueName)
      ? 'HETATM' : 'ATOM',
    residueName, chain:String(record.chain || ''),
    residueIndex:Number(record.residueIndex),
    insertionCode:String(record.insertionCode || ''),
    x:Number(position[0]), y:Number(position[1]), z:Number(position[2]),
  };
}

/**
 * Convert the exact, untruncated public `session.inspect(scope:"pocket")`
 * record frozen by the prospective run into a canonical campaign molecule.
 * This intentionally restores only the ligand and local receptor site.  It is
 * suitable for a quick selector diagnostic, never publication or promotion.
 */
export function moleculeFromFrozenOpenPocketCheckpoint(checkpoint, route) {
  assert.equal(checkpoint?.schema, 'molarium.design-prediction-checkpoint/v1');
  assert.equal(checkpoint?.routeId || checkpoint?.campaignId, 'sos1-hit-only');
  assert.equal(checkpoint?.stepId, 'open-phe890-pocket');
  assert.equal(checkpoint?.predictedStateId, 'AWW');
  assert.equal(checkpoint?.frozenBeforeHoldoutAccess, true,
    'resume input must have been frozen before holdout access');
  assert.equal(checkpoint?.pocket?.scope, 'pocket');
  assert.equal(checkpoint?.pocket?.truncated, false,
    'the frozen public pocket inspection must be complete');
  assert.equal(checkpoint?.pocket?.totalAtomCount, checkpoint?.pocket?.atoms?.length,
    'the frozen public pocket inspection is incomplete');
  assert.equal(checkpoint?.ligand?.scope, 'ligand');
  assert.equal(checkpoint?.ligand?.truncated, false,
    'the frozen public ligand inspection must be complete');

  const preceding = route?.steps?.find((step) => step.id === 'open-phe890-pocket');
  const finalStep = route?.steps?.find((step) => step.id === 'finish-bay-293');
  assert(preceding && finalStep, 'the registered SOS1 final route is incomplete');
  assert.equal(finalStep.referenceStateId, 'AWW');

  const atoms = checkpoint.pocket.atoms.map(plainAtom);
  const atomIndices = new Map(atoms.map((atom, index) => [atom.designAtomId, index]));
  assert.equal(atomIndices.size, atoms.length,
    'the frozen pocket contains duplicate persistent atom identities');
  const bonds = (checkpoint.pocket.bonds || []).map((record) => {
    const a = atomIndices.get(record?.atomIds?.[0]);
    const b = atomIndices.get(record?.atomIds?.[1]);
    if (!Number.isInteger(a) || !Number.isInteger(b))
      throw new Error('The frozen pocket bond references an unavailable atom');
    const first = atoms[a], second = atoms[b];
    return { a, b, order:Number(record.order || 1),
      aromatic:Boolean(record.aromatic || Number(record.order) === 1.5),
      distance:Math.hypot(first.x - second.x, first.y - second.y,
        first.z - second.z) };
  });
  const ligandAtoms = atoms.filter((atom) => atom.residueName === 'AWW');
  assert.equal(ligandAtoms.length, checkpoint.ligand.atoms.length,
    'the frozen pocket does not contain the complete AWW ligand');
  const ligandIds = new Set(ligandAtoms.map((atom) => atom.designAtomId));
  assert(checkpoint.ligand.atoms.every((atom) => ligandIds.has(atom.atomId)),
    'the frozen pocket and ligand inspections disagree');
  const ligandHeavyNames = ligandAtoms.filter((atom) => atom.element !== 'H')
    .map((atom) => atom.atomName);
  assert.equal(ligandHeavyNames.length, preceding.productAtomNames.length,
    'the restored AWW heavy-atom count does not match the registered route');
  assert(preceding.productAtomNames.every((name) => ligandHeavyNames.includes(name)),
    'the restored AWW atom identities do not match the registered route');
  const phe890Heavy = atoms.filter((atom) => atom.record === 'ATOM'
    && atom.chain === 'A' && atom.residueIndex === 890 && atom.element !== 'H');
  assert(phe890Heavy.length >= 7,
    'the frozen local checkpoint does not contain complete Phe890 heavy atoms');

  return {
    name:'SOS1 frozen AWW open-pocket diagnostic checkpoint',
    smiles:preceding.productSmiles, canonicalSmiles:preceding.productSmiles,
    charge:0, multiplicity:1, pointGroup:'C1', symmetryNumber:1,
    source:{ routeId:route.id, stateId:'AWW', stepId:preceding.id,
      pdbId:route.hit.pdbId },
    atoms, bonds,
    diagnosticBoundary:{
      schema:SOS1_FINAL_DIAGNOSTIC_SCHEMA,
      diagnosticOnly:true, promotable:false,
      reason:'The frozen public checkpoint contains the complete local pocket, not the fixed outer receptor.',
      restoredAtomCount:atoms.length,
      omittedOuterAtomCount:Math.max(0,
        Number(checkpoint.pocket?.molecule?.atoms || atoms.length) - atoms.length),
      phe890HeavyAtomCount:phe890Heavy.length,
    },
  };
}

export async function campaignFromFrozenOpenPocketCheckpoint(checkpoint, route, {
  checkpointSha256, checkpointLabel = 'frozen open-phe890-pocket checkpoint',
  occurredAt = '2026-09-04T00:00:00.000Z',
} = {}) {
  const molecule = moleculeFromFrozenOpenPocketCheckpoint(checkpoint, route);
  const campaign = createCampaign({
    campaignId:`sos1-final-diagnostic-${String(checkpointSha256 || 'unhashed').slice(0, 12)}`,
    title:'SOS1 final-step local-pocket diagnostic resume',
    description:'Nonpromotable public-action diagnostic resumed from a frozen prospective checkpoint.',
    createdAt:occurredAt,
    actors:[{ id:'checkpoint-import', type:'import',
      displayName:'Frozen prospective checkpoint import' }],
  });
  const snapshotId = await storeSnapshot(campaign,
    snapshotPayloadFromMolecule(molecule, { label:'Frozen predicted AWW open pocket',
      provenance:{ schema:SOS1_FINAL_DIAGNOSTIC_SCHEMA,
        diagnosticOnly:true, promotable:false, checkpointSha256,
        checkpointLabel:String(checkpointLabel) } }));
  await commitMolecule(campaign, { snapshotId, parents:[], branch:'main',
    message:'Restore frozen AWW local pocket for final-step diagnostic',
    actorId:'checkpoint-import', occurredAt });
  return { molecule, campaign, serialized:serializeCampaign(campaign), snapshotId };
}

export async function readFrozenOpenPocketCheckpoint(path, route) {
  const bytes = await readFile(path);
  const checkpoint = JSON.parse(bytes);
  // Validate before returning any data to the browser boundary.
  moleculeFromFrozenOpenPocketCheckpoint(checkpoint, route);
  return { checkpoint, bytes, checkpointSha256:sha256(bytes),
    checkpointLabel:basename(path) };
}

export function finalDiagnosticGate(refinement, requiredFeatureIds = []) {
  const candidates = Array.isArray(refinement?.candidateGateSummary)
    ? refinement.candidateGateSummary : [];
  const selectedFeatures = Array.isArray(refinement?.selectedSpatialFeatures)
    ? refinement.selectedSpatialFeatures : [];
  const selectedById = new Map(selectedFeatures.map((feature) => [feature.id, feature]));
  const missingRequiredFeatureIds = requiredFeatureIds.filter((id) => !selectedById.has(id));
  const unsatisfiedRequiredFeatureIds = requiredFeatureIds.filter((id) => {
    const feature = selectedById.get(id);
    return feature && feature.satisfied !== true;
  });
  const summary = {
    schema:SOS1_FINAL_DIAGNOSTIC_SCHEMA,
    coverageComplete:refinement?.coverageComplete === true,
    allRequiredStrataCovered:refinement?.coverage?.allRequiredStrataCovered === true,
    selectedFeasible:refinement?.selectedFeasible === true,
    selectedRank:refinement?.selectedRank ?? null,
    candidateCount:Number(refinement?.candidates || candidates.length),
    feasibleCount:Number(refinement?.feasible || 0),
    candidateGateSummary:candidates,
    requiredFeatureIds:[...requiredFeatureIds],
    missingRequiredFeatureIds,
    unsatisfiedRequiredFeatureIds,
  };
  summary.passed = summary.coverageComplete && summary.allRequiredStrataCovered
    && summary.selectedFeasible && !missingRequiredFeatureIds.length
    && !unsatisfiedRequiredFeatureIds.length && candidates.length > 0;
  return summary;
}
