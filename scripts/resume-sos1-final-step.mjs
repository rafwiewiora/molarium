import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLiveCampaign, commitLiveMolecule } from '../design-history/live-campaign.mjs';
import { serializeCampaign } from '../design-history/live-campaign-store.mjs';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueFor = (name) => {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
};
const output = resolve(root, valueFor('--output')
  || 'outputs/design-history/sos1-hit-only-growth-clash-v7/final-anchor-v8-attempt-1');
const checkpointPath = resolve(root, valueFor('--checkpoint')
  || 'outputs/design-history/sos1-hit-only-growth-clash-v7/open-phe890-pocket-prediction.json');
const searchChains = Number(valueFor('--search-chains') || 64);
if (![8, 16, 32, 64].includes(searchChains))
  throw new Error('--search-chains must be 8, 16, 32, or 64');
try {
  await access(output);
  throw new Error(`Refusing to overwrite immutable attempt directory: ${relative(root, output)}`);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(output, { recursive:false });

const checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8'));
assert.equal(checkpoint.routeId || checkpoint.campaignId, 'sos1-hit-only');
assert.equal(checkpoint.stepId, 'open-phe890-pocket');
assert.equal(checkpoint.predictedStateId, 'AWW');
const saveJson = (name, value) => writeFile(join(output, name),
  `${JSON.stringify(value, null, 2)}\n`);

function ligandGeometryAudit(inspection) {
  const atoms = new Map(inspection.atoms.map((atom) => [atom.atomId, atom]));
  const bonds = inspection.bonds.map((bond) => {
    const first = atoms.get(bond.atomIds[0]), second = atoms.get(bond.atomIds[1]);
    const distanceAngstrom = Math.hypot(...first.coordinatesAngstrom.map((value, axis) =>
      value - second.coordinatesAngstrom[axis]));
    return { atomNames:[first.atomName, second.atomName],
      elements:[first.element, second.element], order:bond.order, distanceAngstrom };
  });
  const heavy = bonds.filter((bond) => bond.elements.every((element) => element !== 'H'));
  return { atomCount:inspection.atoms.length, bondCount:bonds.length,
    allCoordinatesFinite:inspection.atoms.every((atom) =>
      atom.coordinatesAngstrom.every(Number.isFinite)),
    minimumHeavyBondAngstrom:Math.min(...heavy.map((bond) => bond.distanceAngstrom)),
    maximumHeavyBondAngstrom:Math.max(...heavy.map((bond) => bond.distanceAngstrom)),
    outlierHeavyBonds:heavy.filter((bond) => bond.distanceAngstrom < 0.9
      || bond.distanceAngstrom > 1.95),
  };
}

function restoredAwwMolecule(prepared) {
  const molecule = structuredClone(prepared);
  const identityTail = (atomId) => String(atomId || '').split(':').slice(1).join(':');
  const proteinIdentity = (atom) => [atom.chain, Number(atom.residueIndex),
    atom.atomName, atom.element].join(':');
  const checkpointProteinAtoms = checkpoint.pocket.atoms
    .filter((atom) => atom.residueName !== 'AXE');
  const checkpointPocketById = new Map(checkpointProteinAtoms
    .map((atom) => [atom.atomId, atom]));
  const checkpointPocketByTail = new Map(checkpointProteinAtoms
    .map((atom) => [identityTail(atom.atomId), atom]));
  const checkpointHeavyByIdentity = new Map(checkpointProteinAtoms
    .filter((atom) => atom.element !== 'H')
    .map((atom) => [proteinIdentity(atom), atom]));
  let restoredPocketAtoms = 0, restoredPocketHydrogens = 0;
  for (const atom of molecule.atoms) {
    if (atom.record !== 'ATOM') continue;
    const saved = checkpointPocketById.get(atom.designAtomId)
      || checkpointPocketByTail.get(identityTail(atom.designAtomId))
      || (atom.element === 'H' ? null : checkpointHeavyByIdentity.get(proteinIdentity(atom)));
    if (!saved) continue;
    [atom.x, atom.y, atom.z] = saved.coordinatesAngstrom.map(Number);
    restoredPocketAtoms += 1;
    restoredPocketHydrogens += Number(atom.element === 'H');
  }
  const restoredPhe890Atoms = molecule.atoms.filter((atom) => atom.record === 'ATOM'
    && atom.chain === 'A' && Number(atom.residueIndex) === 890
    && atom.element !== 'H' && checkpointHeavyByIdentity.has(proteinIdentity(atom))).length;
  if (restoredPhe890Atoms < 7)
    throw new Error(`The frozen Phe890 state was not restored (${restoredPhe890Atoms} atoms)`);

  const removed = new Set(molecule.atoms.flatMap((atom, index) =>
    atom.record === 'HETATM' && !['HOH', 'WAT'].includes(atom.residueName)
      ? [index] : []));
  if (!removed.size) throw new Error('The prepared hit ligand is unavailable for replacement');
  const retainedIndices = molecule.atoms.flatMap((_, index) => removed.has(index) ? [] : [index]);
  const retainedMap = new Map(retainedIndices.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  const atoms = retainedIndices.map((index) => ({ ...molecule.atoms[index] }));
  const bonds = molecule.bonds.flatMap((bond) =>
    retainedMap.has(bond.a) && retainedMap.has(bond.b) ? [{ ...bond,
      a:retainedMap.get(bond.a), b:retainedMap.get(bond.b) }] : []);

  const ligandOffset = atoms.length;
  const ligandIndexById = new Map();
  const maximumSerial = Math.max(0, ...atoms.map((atom) => Number(atom.serial) || 0));
  for (const [index, atom] of checkpoint.ligand.atoms.entries()) {
    ligandIndexById.set(atom.atomId, index);
    atoms.push({
      record:'HETATM', serial:maximumSerial + index + 1,
      atomName:atom.atomName, residueName:'AWW', chain:'A', residueIndex:1104,
      insertionCode:'', element:atom.element,
      charge:Number(atom.formalCharge || 0), formalCharge:Number(atom.formalCharge || 0),
      aromatic:Boolean(atom.aromatic), designAtomId:atom.atomId,
      x:Number(atom.coordinatesAngstrom[0]), y:Number(atom.coordinatesAngstrom[1]),
      z:Number(atom.coordinatesAngstrom[2]),
    });
  }
  for (const bond of checkpoint.ligand.bonds) {
    const a = ligandIndexById.get(bond.atomIds[0]);
    const b = ligandIndexById.get(bond.atomIds[1]);
    if (!Number.isInteger(a) || !Number.isInteger(b))
      throw new Error('The frozen AWW ligand bond graph is incomplete');
    const first = atoms[ligandOffset + a], second = atoms[ligandOffset + b];
    bonds.push({ a:ligandOffset + a, b:ligandOffset + b,
      order:Number(bond.order || 1), aromatic:Boolean(bond.aromatic),
      distance:Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z) });
  }
  const identifiers = atoms.map((atom) => atom.designAtomId);
  if (new Set(identifiers).size !== identifiers.length) {
    const duplicates = [...new Set(identifiers.filter((id, index) =>
      identifiers.indexOf(id) !== index))];
    throw new Error(`The restored full-system checkpoint has duplicate atom identities: ${duplicates.slice(0, 3).join(', ')}`);
  }
  const restoredLigandAtoms = atoms.filter((atom) => atom.record === 'HETATM'
    && atom.residueName === 'AWW').length;
  if (restoredLigandAtoms !== checkpoint.ligand.atoms.length)
    throw new Error(`The restored AWW component has ${restoredLigandAtoms} atoms`);
  const coordinateOwners = new Map(), duplicateCoordinates = [];
  for (const atom of atoms) {
    const key = [atom.x, atom.y, atom.z].map((value) => Number(value).toFixed(8)).join(':');
    if (coordinateOwners.has(key)) duplicateCoordinates.push({
      first:coordinateOwners.get(key), second:atom.designAtomId, coordinates:key,
    });
    else coordinateOwners.set(key, atom.designAtomId);
  }
  if (duplicateCoordinates.length)
    throw new Error(`The restored checkpoint contains ${duplicateCoordinates.length} coincident atom pairs`);
  return {
    ...molecule, name:'SOS1 compound 21 · frozen predicted open pocket',
    smiles:'5OVE + AWW', canonicalSmiles:null, atoms, bonds,
    source:{ source:'frozen prospective checkpoint resume', format:'molarium-campaign-snapshot',
      pdbId:'5OVE', routeId:'sos1-hit-only', stateId:'AWW',
      stepId:'open-phe890-pocket' },
    preparation:undefined, parameterization:undefined,
    resumeAudit:{ restoredPocketAtoms, restoredPocketHydrogens, restoredPhe890Atoms,
      coincidentAtomPairs:duplicateCoordinates.length,
      checkpoint:relative(root, checkpointPath) },
  };
}

const browser = await startMolariumBrowser({ root, appPath:'?prospective=sos1-hit-only',
  width:1600, height:1000 });
const execute = (action, actionArgs = {}, requestId = action) => browser.evaluate(
  `window.MolariumChemistActions.execute(${JSON.stringify({
    action, args:actionArgs, requestId,
  })})`);

try {
  await waitFor(async () => browser.evaluate(
    `Boolean(window.MolariumChemistActions && window.molariumTest)`),
  90000, 'Molarium APIs');
  await execute('designRoute.load', { routeId:'sos1-hit-only' }, 'resume-load-route-hit');
  await execute('view.setMode', { mode:'build' }, 'resume-enter-design');
  console.log('resume: preparing the original 5OVE/AXE protein once');
  await execute('protein.prepare', {
    pH:7.4, histidine:'auto', repairMissingHeavy:true,
    ligandPolicy:'ccd', waterPolicy:'retain', gapPolicy:'cap',
  }, 'resume-prepare-hit');
  await execute('session.inspect', {
    scope:'all', includeCoordinates:false, maximumAtoms:1,
  }, 'resume-assign-persistent-atom-identities');
  const prepared = await browser.evaluate('window.molariumTest.current()');
  const restored = restoredAwwMolecule(prepared.molecule);
  const created = await createLiveCampaign({
    campaignId:'sos1-final-anchor-resume-v8',
    title:'SOS1 final-step protected-anchor resume',
    description:'Frozen compound-21 state restored solely to recompute the AWW-to-AXH step.',
    actorId:'agent.molarium', actorDisplayName:'Molarium agent',
  });
  const committed = await commitLiveMolecule(created, { molecule:restored, audit:[],
    branch:'main', message:'Restore frozen AWW prediction for corrected final-step search',
    label:'AWW predicted open pocket', actorId:'agent.molarium' });
  const serialized = serializeCampaign(committed.campaign);
  await writeFile(join(output, 'resume-campaign.json'), serialized);
  await execute('campaign.import', { serialized }, 'resume-import-frozen-aww');
  await execute('designRoute.resume', {
    routeId:'sos1-hit-only', stateId:'AWW',
  }, 'resume-register-aww-state');
  await execute('view.setMode', { mode:'build' }, 'resume-return-design');
  console.log('resume: parameterizing the restored AWW complex without moving coordinates');
  const referenceParameters = await execute('protein.parameterize', {},
    'resume-parameterize-aww');
  await execute('pose.captureReference', { mode:'propagate' }, 'resume-capture-aww');
  const before = await execute('session.inspect', {
    scope:'ligand', includeCoordinates:true, maximumAtoms:256,
  }, 'resume-inspect-aww');

  console.log('finish-bay-293: staging AXH with the proximal quinazoline-thiophene core protected');
  const staged = await execute('designRoute.applyStep', {
    stepId:'finish-bay-293',
  }, 'finish-bay-293-corrected-stage');
  assert.equal(staged.result.designStep.embedding.protectedReference.atomCount, 7);
  assert.equal(staged.result.designStep.embedding.protectedReference.maxDisplacementAngstrom, 0);
  const protectedNames = staged.result.designStep.embedding.protectedReference.atomNames;
  const after = await execute('session.inspect', {
    scope:'ligand', includeCoordinates:true, maximumAtoms:256,
  }, 'finish-bay-293-inspect-staged-anchor');
  const beforeByName = new Map(before.result.atoms.map((atom) => [atom.atomName, atom]));
  const afterByName = new Map(after.result.atoms.map((atom) => [atom.atomName, atom]));
  for (const atomName of protectedNames)
    assert.deepEqual(afterByName.get(atomName).coordinatesAngstrom,
      beforeByName.get(atomName).coordinatesAngstrom,
      `${atomName} moved during corrected final-step staging`);
  await saveJson('staging.json', { staging:staged.result.designStep,
    protectedCoordinatesBefore:Object.fromEntries(protectedNames.map((name) =>
      [name, beforeByName.get(name).coordinatesAngstrom])),
    protectedCoordinatesAfter:Object.fromEntries(protectedNames.map((name) =>
      [name, afterByName.get(name).coordinatesAngstrom])),
    geometry:ligandGeometryAudit(after.result) });

  console.log(`finish-bay-293: searching ${searchChains} poses for the rebuilt distal arm around the fixed proximal core`);
  const refined = await execute('pose.refine', {
    searchChains, featureSeedingProtocol:'v5',
  }, 'finish-bay-293-corrected-pose-refine');
  await saveJson('refinement.json', refined.result.refinement);
  assert.equal(refined.result.refinement.coverageComplete, true,
    'The corrected final step did not cover every required pose-seed stratum');
  assert.equal(refined.result.refinement.coverage?.allRequiredStrataCovered, true,
    'The corrected final step returned incomplete pose-seed coverage evidence');
  assert.equal(refined.result.refinement.selectedFeasible, true,
    'The corrected final step did not produce a feasible selected pose');
  const selectedIndex = Math.max(0,
    Number(refined.result.refinement.selectedRank || 1) - 1);
  await execute('pose.apply', { index:selectedIndex },
    'finish-bay-293-corrected-pose-apply');
  const appliedLigand = await execute('session.inspect', {
    scope:'ligand', includeCoordinates:true, maximumAtoms:256,
  }, 'finish-bay-293-corrected-inspect-applied-ligand');
  const appliedGeometry = ligandGeometryAudit(appliedLigand.result);
  await saveJson('applied-pose.json', { refinement:refined.result.refinement,
    geometry:appliedGeometry, ligand:appliedLigand.result });
  assert.equal(appliedGeometry.allCoordinatesFinite, true);
  assert.deepEqual(appliedGeometry.outlierHeavyBonds, [],
    'The corrected selected pose contains an implausible heavy-atom bond');
  const parameterized = await execute('protein.parameterize', {},
    'finish-bay-293-corrected-parameterize');
  await saveJson('parameterization.json', parameterized.result.parameterization);
  console.log('finish-bay-293: coupled ligand/pocket WebGPU relaxation');
  let relaxed;
  try {
    relaxed = await execute('optimization.run', {
      method:'induced-fit-webgpu',
    }, 'finish-bay-293-corrected-relax');
  } catch (error) {
    await saveJson('relaxation-failure.json', { error:String(error.message || error),
      selectedFeasible:refined.result.refinement.selectedFeasible,
      appliedGeometry, parameterization:parameterized.result.parameterization });
    throw error;
  }
  const ligand = await execute('session.inspect', {
    scope:'ligand', includeCoordinates:true, maximumAtoms:256,
  }, 'finish-bay-293-corrected-freeze-ligand');
  const pocket = await execute('session.inspect', {
    scope:'pocket', includeCoordinates:true, maximumAtoms:500,
  }, 'finish-bay-293-corrected-freeze-pocket');
  const state = await execute('designRoute.inspect', {},
    'finish-bay-293-corrected-inspect-state');
  const audit = await browser.evaluate('window.MolariumChemistActions.history()');
  const result = {
    schema:'molarium.design-prediction-checkpoint/v1', routeId:'sos1-hit-only',
    stepId:'finish-bay-293', referenceStateId:'AWW', predictedStateId:'AXH',
    frozenBeforeHoldoutAccess:false,
    evaluationBoundary:{
      class:'post-open-software-correction',
      coordinatesUsedByRedo:['PDB 5OVE/AXE prepared system',
        'previously frozen compound-21/AWW prediction'],
      productInput:'registered AXH molecular graph plus designer-protected AWW anchor map',
      holdoutCoordinatesUsedToGeneratePrediction:false,
    },
    resume:{ checkpoint:relative(root, checkpointPath),
      campaign:'resume-campaign.json', restored:restored.resumeAudit,
      referenceParameterization:referenceParameters.result.parameterization },
    state:state.result.designRoute, staging:staged.result.designStep,
    refinement:refined.result.refinement,
    parameterization:parameterized.result.parameterization,
    relaxation:relaxed.result.optimization,
    ligand:ligand.result, pocket:pocket.result,
  };
  await saveJson('finish-bay-293-prediction.json', result);
  await saveJson('chemist-action-audit.json', {
    schema:'molarium.chemist-actions/v1', routeId:'sos1-hit-only', records:audit });
  console.log(`Wrote corrected final step to ${relative(root, output)}`);
} finally {
  await browser.close();
}
