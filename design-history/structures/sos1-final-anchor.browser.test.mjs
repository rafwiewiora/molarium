import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from '../../scripts/headless-chrome.mjs';
import { createCampaign, commitMolecule, storeSnapshot } from '../ledger.mjs';
import { snapshotPayloadFromMolecule } from '../live-campaign.mjs';
import { serializeCampaign } from '../live-campaign-store.mjs';
import route from './generated/sos1-prospective-campaign.json' with { type:'json' };
import { validateRegisteredDesignRoute } from './design-route.mjs';

const root = resolve(import.meta.dirname, '../..');
validateRegisteredDesignRoute(route);
const finalStep = route.steps.find((step) => step.id === 'finish-bay-293');
const protectedNames = finalStep.posePropagationMap.protectedReferenceAnchor.referenceAtomNames;

// Frozen compound 21, reduced to the exact heavy-atom graph required by this
// staging regression. The production story reaches this state only through the
// preceding public actions; this fixture keeps the regression fast and local.
const atoms = [
  ['CX6','C',3.815,-15.348,27.317], ['OX1','O',3.941,-14.469,26.181],
  ['CX7','C',4.336,-15.125,25.041], ['CX8','C',3.416,-15.611,24.097],
  ['OX2','O',2.073,-15.509,24.368], ['CX9','C',1.216,-15.235,23.254],
  ['CX10','C',3.869,-16.304,22.818], ['C1','C',5.341,-16.663,22.785],
  ['C2','C',6.230,-16.182,23.764], ['N6','N',7.532,-16.500,23.711],
  ['C11','C',8.000,-17.285,22.727], ['CX1','C',9.473,-17.531,22.645],
  ['N8','N',7.189,-17.793,21.776], ['C3','C',5.876,-17.488,21.765],
  ['N7','N',5.129,-17.826,20.636], ['C12','C',5.402,-18.999,19.773],
  ['C16','C',5.036,-18.633,18.290], ['C15','C',4.646,-20.188,20.310],
  ['CX2','C',3.548,-20.738,19.702], ['CX3','C',3.018,-21.856,20.405],
  ['CX4','C',3.805,-22.239,21.488], ['CX5','C',3.695,-23.481,22.309],
  ['CX11','C',4.763,-23.806,23.242], ['CX12','C',4.698,-24.995,24.087],
  ['CX13','C',3.489,-25.782,24.031], ['CX14','C',2.401,-25.346,23.174],
  ['CX15','C',2.539,-24.331,22.223], ['CX16','C',1.442,-24.243,21.129],
  ['OX3','O',0.478,-25.297,21.094], ['SX1','S',5.121,-21.078,21.745],
  ['CX17','C',5.817,-15.235,24.844],
].map(([atomName, element, x, y, z], index) => ({
  designAtomId:`sos1-final-public-test:${atomName}`, atomName, element,
  formalCharge:0, charge:0, aromatic:[7,8,9,10,12,13,17,18,19,20,21,22,23,24,25,26,29]
    .includes(index), record:'HETATM', residueName:'AWW', chain:'A', residueIndex:1104,
  x, y, z,
}));
// A single nearby receptor atom is sufficient to exercise the same public
// reference-capture boundary without parameterizing the full SOS1 complex.
atoms.push({ designAtomId:'sos1-final-public-test:receptor-CA', atomName:'CA',
  element:'C', formalCharge:0, charge:0, aromatic:false, record:'ATOM',
  residueName:'ALA', chain:'A', residueIndex:879, x:0, y:-18, z:20 });
const bondTuples = [
  [0,1,1], [1,2,1], [2,3,2], [3,4,1], [4,5,1], [3,6,1], [6,7,1],
  [7,8,1.5], [8,9,1.5], [9,10,1.5], [10,11,1], [10,12,1.5],
  [12,13,1.5], [13,14,1], [14,15,1], [15,16,1], [15,17,1],
  [17,18,1.5], [18,19,1.5], [19,20,1.5], [20,21,1], [21,22,1.5],
  [22,23,1.5], [23,24,1.5], [24,25,1.5], [25,26,1.5], [26,27,1],
  [27,28,1], [20,29,1.5], [8,30,1], [30,2,1], [13,7,1.5], [29,17,1.5],
  [26,21,1.5],
];
const bonds = bondTuples.map(([a, b, order]) => ({ a, b, order,
  aromatic:order === 1.5,
  distance:Math.hypot(atoms[a].x - atoms[b].x, atoms[a].y - atoms[b].y,
    atoms[a].z - atoms[b].z) }));
const precedingStep = route.steps.find((step) => step.id === 'open-phe890-pocket');
const checkpointMolecule = {
  name:'SOS1 frozen compound 21 test checkpoint',
  smiles:precedingStep.productSmiles, canonicalSmiles:precedingStep.productSmiles,
  charge:0, multiplicity:1, pointGroup:'C1', symmetryNumber:1,
  source:{ designRoute:{ routeId:route.id, hitPdbId:route.hit.pdbId,
    stateId:finalStep.referenceStateId, stepId:precedingStep.id,
    coordinateInputClass:'registered-hit-only' } },
  atoms, bonds,
};
const occurredAt = '2026-01-01T00:00:00.000Z';
const fixtureCampaign = createCampaign({ campaignId:'sos1-final-public-action-test',
  title:'SOS1 final public-action staging fixture', createdAt:occurredAt,
  actors:[{ id:'test-import', type:'import', displayName:'Test fixture import' }] });
const snapshotId = await storeSnapshot(fixtureCampaign,
  snapshotPayloadFromMolecule(checkpointMolecule, { label:'Frozen compound 21' }));
await commitMolecule(fixtureCampaign, { snapshotId, parents:[], branch:'main',
  message:'Restore frozen compound 21', actorId:'test-import', occurredAt });
const serializedFixture = serializeCampaign(fixtureCampaign);

const browser = await startMolariumBrowser({ root, appPath:'?prospective=sos1-hit-only',
  width:1200, height:800 });
const execute = (action, args = {}, requestId = action) => browser.evaluate(
  `window.MolariumChemistActions.execute(${JSON.stringify({ action, args, requestId })})`);

try {
  await waitFor(async () => browser.evaluate(`Boolean(window.MolariumChemistActions)`),
    90000, 'Molarium Chemist Actions API');
  assert.equal(await browser.evaluate(`typeof window.molariumTest`), 'undefined',
    'the regression must run without the privileged test API');

  await execute('campaign.import', { serialized:serializedFixture }, 'import-aww-checkpoint');
  await execute('designRoute.resume', {
    routeId:route.id, stateId:finalStep.referenceStateId,
  }, 'resume-aww-route');
  await execute('view.setMode', { mode:'build' }, 'enter-design');
  await execute('protein.parameterize', {}, 'parameterize-aww');
  await execute('pose.captureReference', { mode:'propagate' }, 'capture-aww-reference');
  const before = await execute('session.inspect', {
    scope:'ligand', includeCoordinates:true, maximumAtoms:256,
  }, 'inspect-aww-anchor');
  const staged = await execute('designRoute.applyStep', {
    stepId:finalStep.id,
  }, 'stage-axh-through-public-route');
  const after = await execute('session.inspect', {
    scope:'ligand', includeCoordinates:true, maximumAtoms:256,
  }, 'inspect-axh-anchor');
  const routeAfter = await execute('designRoute.inspect', {}, 'inspect-final-route-state');

  const embedding = staged.result.designStep.embedding;
  const transfer = staged.result.designStep.poseTransferPlan;
  assert.deepEqual(embedding.protectedReference, {
    method:'exact-common-subgraph-after-topology-release/v1',
    label:'exact mapped atoms outside attachment-migrated ring blocks',
    atomCount:11,
    atomNames:protectedNames,
    maxDisplacementAngstrom:0,
  });
  assert.equal(after.result.poseReference.resultPoseCount, 0,
    'graph staging must not silently run pose refinement');
  assert.equal(routeAfter.result.designRoute.currentStateId, 'AXH');
  assert(after.result.atoms.every((atom) => atom.residueName === 'AXH'));
  const beforeByName = new Map(before.result.atoms.map((atom) => [atom.atomName, atom]));
  const afterByName = new Map(after.result.atoms.map((atom) => [atom.atomName, atom]));
  const afterById = new Map(after.result.atoms.map((atom) => [atom.atomId, atom]));
  for (const atomName of protectedNames) {
    assert.deepEqual(afterByName.get(atomName)?.coordinatesAngstrom,
      beforeByName.get(atomName)?.coordinatesAngstrom,
      `${atomName} must remain fixed during the public graph-staging action`);
  }
  assert(embedding.attachedPlacement.regions
    .some((region) => region.atomIndices.length > 1),
  'the regioisomeric distal arm must be a released placement region');
  assert.equal(embedding.spatialFeatures.length, 1);
  assert.equal(embedding.spatialFeatures[0].id, 'secondary-exact-fragment-1');
  assert.equal(embedding.spatialFeatures[0].kind, 'conserved-fragment-rmsd');
  assert.equal(embedding.spatialFeatures[0].treatment, 'seed-only');
  assert.equal(embedding.spatialFeatures[0].atomCount, 7);
  assert.equal(embedding.spatialFeatures[0].candidateMaps, 4);
  assert.equal(embedding.spatialFeatures[0].seedMaxDisplacementAngstrom, 0);
  assert.deepEqual(transfer.releasedMappedAtomNames, ['CX2','CX3','CX4','SX1']);
  assert.equal(embedding.seedOnlyPlacement.features.length, 1);
  assert(embedding.seedOnlyPlacement.features[0].seededRmsdAngstrom
    <= embedding.seedOnlyPlacement.features[0].initialRmsdAngstrom,
  'seed-only torsion placement must not move the inherited fragment farther away');
  const heavyBondDistances = after.result.bonds.flatMap((bond) => {
    const first = afterById.get(bond.atomIds[0]), second = afterById.get(bond.atomIds[1]);
    if (!first || !second || first.element === 'H' || second.element === 'H') return [];
    return [Math.hypot(...first.coordinatesAngstrom.map((value, axis) =>
      value - second.coordinatesAngstrom[axis]))];
  });
  assert(Math.min(...heavyBondDistances) >= 0.9
    && Math.max(...heavyBondDistances) <= 1.95,
  `seeded graph replacement distorted a heavy-atom bond (${Math.min(...heavyBondDistances)}–${Math.max(...heavyBondDistances)} Å)`);
  console.log('SOS1 AWW→AXH staging preserved the topology-derived hard core and a valid seed-only distal fragment', {
    seedRmsdAngstrom:embedding.seedOnlyPlacement.features[0].seededRmsdAngstrom,
    initialSeedRmsdAngstrom:embedding.seedOnlyPlacement.features[0].initialRmsdAngstrom,
    finalSeedMaximumDisplacementAngstrom:embedding.spatialFeatures[0]
      .seedMaxDisplacementAngstrom,
    connectorRepair:embedding.seedOnlyPlacement.connectorRepair,
    maximumHeavyBondAngstrom:Math.max(...heavyBondDistances),
  });
  const history = await browser.evaluate(`window.MolariumChemistActions.history()`);
  assert(history.some((record) => record.action === 'designRoute.applyStep'
    && record.status === 'completed'));
  assert(!history.some((record) => record.action === 'pose.refine'),
    'pose search must remain a separate, explicit public action');
  console.log('SOS1 AWW→AXH final graph step passed exclusively through public actions');
} finally {
  await browser.close();
}
