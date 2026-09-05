#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
import { ENERGY_OPTIONS, evaluateDesignerHydrogenBond,
  rankFiniteClashFreeCandidates } from
  './rank-sos1-phe890-fixed-ligand-energy.browser.mjs';

const SCHEMA = 'molarium.sos1-aww-receptor-only-prospective/v1';
const SOURCE_CAMPAIGN_PATH =
  'design-history/publications/sos1/checkpoints/fragment-merge-campaign.json';
const SOURCE_CAMPAIGN_SHA256 =
  'e1a7722f517b5371efad860dc6d87bf31d813b05df6c3e72db74e71e3236cb81';
const SOURCE_STATE_ID = 'AWZ';
const PRODUCT_STATE_ID = 'AWW';
const AWW_STEP_ID = 'open-phe890-pocket';
const DESIGNER_TORSION_ATOM_NAMES = Object.freeze(['N7', 'C12', 'C15', 'CX2']);
const DESIGNER_PRIMARY_ROTATION_DEGREES = 150;
const DESIGNER_PRIMARY_AXIS_ATOM_NAMES = Object.freeze(['C12', 'C15']);
const DESIGNER_COUPLED_AXIS_ATOM_NAMES = Object.freeze([
  Object.freeze(['CX4', 'CX5']),
  Object.freeze(['CX15', 'CX16']),
]);
const PHE890 = Object.freeze({ residueName:'PHE', chain:'A', residueIndex:890,
  insertionCode:'' });
const DISALLOWED_CURRENT_RUN_ACTIONS = new Set([
  'geometry.setInternalCoordinate',
  'pose.refine', 'pose.apply', 'pose.updateReceptorReference', 'optimization.run',
]);
const SHA256 = /^[a-f0-9]{64}$/;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function valueFor(name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function circularDistanceDegrees(first, second) {
  let difference = (Number(first) - Number(second)) % 360;
  if (difference <= -180) difference += 360;
  if (difference > 180) difference -= 360;
  return Math.abs(difference);
}

function torsionDegrees(first, second, third, last) {
  const subtract = (a, b) => a.map((value, index) => value - b[index]);
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const normalize = (vector) => {
    const length = Math.hypot(...vector);
    assert(length > 1e-8, 'Designer torsion must have a non-degenerate axis');
    return vector.map((value) => value / length);
  };
  const a = first.coordinatesAngstrom;
  const b = second.coordinatesAngstrom;
  const c = third.coordinatesAngstrom;
  const d = last.coordinatesAngstrom;
  const axis = normalize(subtract(c, b));
  const firstVector = subtract(a, b);
  const lastVector = subtract(d, c);
  const firstPlane = subtract(firstVector,
    axis.map((value) => value * dot(firstVector, axis)));
  const lastPlane = subtract(lastVector,
    axis.map((value) => value * dot(lastVector, axis)));
  const v = normalize(firstPlane), w = normalize(lastPlane);
  return Math.atan2(dot(cross(axis, v), w), dot(v, w)) * 180 / Math.PI;
}

function requireInspection(result, label) {
  assert(result && Array.isArray(result.atoms), `${label} inspection is unavailable`);
  assert.equal(result.truncated, false, `${label} inspection was truncated`);
  assert(result.atoms.length > 0, `${label} inspection contains no atoms`);
  if (result.atoms.some((atom) => !Array.isArray(atom.coordinatesAngstrom)
    || atom.coordinatesAngstrom.length !== 3
    || atom.coordinatesAngstrom.some((value) => !Number.isFinite(value))))
    throw new Error(`${label} inspection lacks complete finite coordinates`);
  return result;
}

function uniqueAtom(inspection, residueName, residueIndex, atomName, chain = 'A') {
  const matches = inspection.atoms.filter((atom) => atom.residueName === residueName
    && atom.chain === chain && Number(atom.residueIndex) === residueIndex
    && atom.atomName === atomName);
  assert.equal(matches.length, 1,
    `${residueName} ${chain}${residueIndex}/${atomName} must occur exactly once`);
  return matches[0];
}

function canonicalLigandInspection(inspection) {
  const atoms = inspection.atoms.map((atom) => ({
    atomId:atom.atomId,
    element:atom.element,
    formalCharge:Number(atom.formalCharge || 0),
    aromatic:Boolean(atom.aromatic),
    coordinatesAngstrom:atom.coordinatesAngstrom.map(Number),
  })).sort((first, second) => first.atomId.localeCompare(second.atomId));
  const bonds = inspection.bonds.map((bond) => ({
    atomIds:[...bond.atomIds].sort(),
    order:Number(bond.order), aromatic:Boolean(bond.aromatic),
  })).sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second)));
  return { atoms, bonds };
}

function ligandFingerprints(inspection) {
  const canonical = canonicalLigandInspection(inspection);
  return {
    atomCount:canonical.atoms.length,
    bondCount:canonical.bonds.length,
    coordinateSha256:sha256(jsonBytes(canonical.atoms.map((atom) =>
      [atom.atomId, atom.coordinatesAngstrom]))),
    stateSha256:sha256(jsonBytes(canonical)),
  };
}

function matchingManualContact(inspection, ligandAtomName, receptor) {
  const match = (inspection.contacts || []).find((contact) => {
    if (contact.origin?.kind !== 'user-added-hydrogen-bond-hypothesis') return false;
    const participants = Object.values(contact.hydrogenBond?.participants || {});
    return participants.some((entry) => entry?.scope === 'ligand'
      && entry.atomId?.includes(`::${ligandAtomName}:`))
      && participants.some((entry) => entry?.scope === 'receptor'
        && entry.atomId?.includes(`:${receptor.residueName}:${receptor.residueIndex}:${receptor.insertionCode || ''}:${receptor.atomName}:`));
  });
  assert(match,
    `Recorded designer contact ${ligandAtomName} -> ${receptor.residueName} ${receptor.residueIndex} ${receptor.atomName} is unavailable`);
  return match;
}

function assertDesignerHydrogenBond(contact, label) {
  const result = evaluateDesignerHydrogenBond(contact);
  assert.equal(result.satisfied, true,
    `${label} is not a directional hydrogen bond: ${JSON.stringify(result)}`);
  return result;
}

function assertSha256(value, label) {
  assert.match(String(value || ''), SHA256, `${label} is not a SHA-256 digest`);
}

function sameResidue(first, second) {
  return String(first?.residueName || '').toUpperCase()
      === String(second?.residueName || '').toUpperCase()
    && String(first?.chain || '') === String(second?.chain || '')
    && Number(first?.residueIndex) === Number(second?.residueIndex)
    && String(first?.insertionCode || '') === String(second?.insertionCode || '');
}

async function main() {
  const outputArg = valueFor('--output');
  if (!outputArg)
    throw new Error('Usage: bun scripts/run-sos1-aww-receptor-only-prospective.browser.mjs --output <new-directory>');
  const output = resolve(process.cwd(), outputArg);
  try {
    await access(output);
    throw new Error(`Refusing to overwrite immutable attempt: ${output}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const sourceCampaign = resolve(root, SOURCE_CAMPAIGN_PATH);
  const sourceBytes = await readFile(sourceCampaign);
  assert.equal(sha256(sourceBytes), SOURCE_CAMPAIGN_SHA256,
    'The exact frozen AWZ source campaign bytes changed');
  await mkdir(output, { recursive:false });
  const save = async (filename, value) => {
    const bytes = Buffer.isBuffer(value) ? value : jsonBytes(value);
    await writeFile(resolve(output, filename), bytes);
    return { filename, bytes:bytes.length, sha256:sha256(bytes) };
  };

  const boundary = {
    schema:SCHEMA,
    status:'declared-before-compute',
    predictionScope:'AWW ligand intent followed by a receptor-only Phe890 response',
    source:{ stateId:SOURCE_STATE_ID, kind:'exact-frozen-full-system-campaign',
      path:SOURCE_CAMPAIGN_PATH, sha256:SOURCE_CAMPAIGN_SHA256,
      coordinateLineage:'registered 5OVE/AXE coordinate boundary' },
    product:{ stateId:PRODUCT_STATE_ID, graphInput:'reported molecular graph only' },
    designerIntent:{ action:'geometry.alignBranchToContact',
      interpretation:'chemist-directed branch orientation in the current scene; not an external pose placement',
      orderedAxisAtomNames:[...DESIGNER_PRIMARY_AXIS_ATOM_NAMES],
      designerPrimaryRotationDegrees:DESIGNER_PRIMARY_ROTATION_DEGREES,
      coupledAxisAtomNames:DESIGNER_COUPLED_AXIS_ATOM_NAMES.map((axis) => [...axis]),
      directionalContact:{ ligandAtom:'AWW OX3', receptorAtom:'TYR A884 O',
        contactIdSource:'result.contact.contactId from the preceding pose.addContact action' },
      solution:'best-directional', currentSceneCoordinatesOnly:true,
      externalReferenceCoordinatesUsed:false,
      allowedResponseResidues:[PHE890],
      interactionHypotheses:[
        { ligandAtom:'AWW N7', receptorAtom:'ASN A879 OD1', ligandRole:'donor' },
        { ligandAtom:'AWW OX3', receptorAtom:'TYR A884 O', ligandRole:'donor' },
      ],
      hypothesesAreScoringResults:false },
    receptorPrediction:{ residue:PHE890,
      enumeration:'canonical-chi-grid-steric-prerank-v1',
      selection:'minimum finite full-system OpenMM single-point energy among zero-severe-clash candidates',
      energy:{ job:'energy', method:'openmm', options:ENERGY_OPTIONS,
        coordinatePolicy:'fixed-coordinate single-point; no optimization or dynamics' },
      everyEnumeratedCandidateEvaluated:true, ligandCoordinatesFixed:true },
    laterStructureAccess:false,
    prohibitedCurrentRunActions:[...DISALLOWED_CURRENT_RUN_ACTIONS],
  };
  const boundaryFile = await save('boundary.json', boundary);

  let browser = null;
  const localRecords = [];
  const inspections = {};
  const checkpoints = {};
  try {
    browser = await startMolariumBrowser({ root, appPath:'?blank=1',
      width:1200, height:800 });
    await waitFor(async () => browser.evaluate(
      'Boolean(window.MolariumChemistActionsReady)'), 90000,
    'Molarium Chemist Actions API');
    const description = await browser.evaluate(
      'window.MolariumChemistActions.describe()');
    for (const action of ['campaign.import', 'campaign.verify', 'campaign.commitCurrent',
      'campaign.export', 'designRoute.resume', 'designRoute.applyStep',
      'protein.parameterize', 'pose.captureReference',
      'geometry.alignBranchToContact', 'pose.addContact',
      'pose.setDesignerLigandPoseFixed',
      'pose.enumerateSidechainRotamers', 'pose.applySidechainRotamer',
      'calculation.run', 'history.undo', 'session.inspect'])
      assert(description.actions[action], `Required public action is unavailable: ${action}`);

    const execute = async (action, actionArgs = {}, suffix = action) => {
      const requestId = `sos1-aww-receptor-only-${localRecords.length + 1}-${suffix}`;
      const response = await browser.evaluate(
        `window.MolariumChemistActions.execute(${JSON.stringify({
          action, args:actionArgs, requestId,
        })})`);
      assert.equal(response.status, 'completed', `${action} did not complete`);
      localRecords.push({ requestId, action, args:structuredClone(actionArgs),
        status:response.status, durationMs:response.durationMs,
        sequence:response.sequence, result:response.result });
      return { ...response, requestId };
    };

    const imported = await execute('campaign.import', {
      sourcePath:`./${SOURCE_CAMPAIGN_PATH}`,
      sourceSha256:SOURCE_CAMPAIGN_SHA256,
    }, 'import-awz-source');
    assert.equal(imported.result.campaignImport.verification.valid, true,
      'The imported AWZ campaign did not verify');
    const verifiedSource = await execute('campaign.verify', {}, 'verify-awz-source');
    assert.equal(verifiedSource.result.campaignVerification.valid, true,
      'The active AWZ campaign failed verification');
    const resumed = await execute('designRoute.resume', {
      routeId:'sos1-hit-only', stateId:SOURCE_STATE_ID,
    }, 'resume-awz-route');
    assert.equal(resumed.result.designRoute.currentStateId, SOURCE_STATE_ID);
    await execute('view.setMode', { mode:'build' }, 'enter-design');
    await execute('pose.captureReference', { mode:'propagate' }, 'capture-awz-reference');

    const staged = await execute('designRoute.applyStep', {
      stepId:AWW_STEP_ID,
    }, 'apply-aww-graph');
    assert.equal(staged.result.designStep.referenceStateId, SOURCE_STATE_ID);
    assert.equal(staged.result.designStep.stateId, PRODUCT_STATE_ID);
    assert.equal(staged.result.designStep.inputKind, 'molecular-graph-only');
    const graphOnlyCommit = await execute('campaign.commitCurrent', {
      message:'Freeze the raw AWW graph edit before designer geometry intent',
      label:'AWW graph only · inherited AWZ pose',
      tags:['sos1', 'prospective', 'AWW', 'graph-only', 'pre-designer-torsion'],
    }, 'commit-aww-graph-only');
    const graphOnlyVerification = await execute('campaign.verify', {},
      'verify-aww-graph-only');
    assert.equal(graphOnlyVerification.result.campaignVerification.valid, true);
    const graphOnlyExport = await execute('campaign.export', {}, 'export-aww-graph-only');
    checkpoints.graphOnly = {
      commitId:graphOnlyCommit.result.campaignCommit.commitId,
      snapshotId:graphOnlyCommit.result.campaignCommit.snapshotId,
      ...(await save('aww-graph-only-campaign.json',
        Buffer.from(graphOnlyExport.result.campaignExport.serialized))),
    };

    inspections.stagedLigand = requireInspection((await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:256,
    }, 'inspect-staged-aww-ligand')).result, 'staged AWW ligand');
    inspections.pocketAtDesignerIntent = requireInspection((await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, 'inspect-current-pocket-for-designer-intent')).result,
    'current pocket for designer intent');
    const torsionAtoms = DESIGNER_TORSION_ATOM_NAMES.map((atomName) =>
      uniqueAtom(inspections.stagedLigand, PRODUCT_STATE_ID, 1104, atomName));
    const beforeDegrees = torsionDegrees(...torsionAtoms);
    const hingeHypothesis = await execute('pose.addContact', {
      ligandAtom:{ componentId:'heterogen:A:1104::AWW', atomName:'N7' },
      receptorAtom:{ residueName:'ASN', chain:'A', residueIndex:879,
        insertionCode:'', atomName:'OD1' },
      ligandRole:'donor',
    }, 'record-designer-asn879-hypothesis');
    const distalHypothesis = await execute('pose.addContact', {
      ligandAtom:{ componentId:'heterogen:A:1104::AWW', atomName:'OX3' },
      receptorAtom:{ residueName:'TYR', chain:'A', residueIndex:884,
        insertionCode:'', atomName:'O' },
      ligandRole:'donor',
    }, 'record-designer-tyr884-hypothesis');
    for (const hypothesis of [hingeHypothesis, distalHypothesis]) {
      assert.equal(hypothesis.result.contact.required, true,
        'Designer interaction hypothesis was not recorded as required');
      assert.equal(hypothesis.result.contact.origin.kind,
        'user-added-hydrogen-bond-hypothesis',
      'Interaction hypothesis provenance was not recorded as designer-supplied');
    }
    const stagedLigandAtomsByName = new Map(inspections.stagedLigand.atoms
      .filter((atom) => atom.residueName === PRODUCT_STATE_ID
        && Number(atom.residueIndex) === 1104)
      .map((atom) => [atom.atomName, atom]));
    const atomId = (name) => {
      const id = stagedLigandAtomsByName.get(name)?.atomId;
      assert(id, `AWW ligand lacks persistent atom ${name}`);
      return id;
    };
    const primaryAxisAtomIds = DESIGNER_PRIMARY_AXIS_ATOM_NAMES.map(atomId);
    const coupledAxisAtomIds = DESIGNER_COUPLED_AXIS_ATOM_NAMES.map((axis) =>
      axis.map(atomId));
    const designerMove = await execute('geometry.alignBranchToContact', {
      axisAtomIds:primaryAxisAtomIds,
      solution:'best-directional',
      contactId:distalHypothesis.result.contact.contactId,
      designerPrimaryRotationDegrees:DESIGNER_PRIMARY_ROTATION_DEGREES,
      coupledAxisAtomIds,
      allowedResponseResidues:[PHE890],
    }, 'align-designer-aww-branch-to-tyr884');
    const designerBranchContact = designerMove.result.designerBranchContact;
    assert.equal(designerBranchContact.coordinateOrigin, 'current-visible-molecule');
    assert.equal(designerBranchContact.externalReferenceCoordinatesUsed, false);
    assert.equal(designerBranchContact.solution, 'best-directional');
    assert.equal(designerBranchContact.contactId,
      distalHypothesis.result.contact.contactId);
    assert.deepEqual(designerBranchContact.orderedAxisAtomIds, primaryAxisAtomIds);
    assert.deepEqual(designerBranchContact.coupledAxisAtomIds, coupledAxisAtomIds);
    assert.equal(designerBranchContact.allowedResponseResidues?.length, 1);
    assert(sameResidue(designerBranchContact.allowedResponseResidues[0], PHE890),
      'The current-scene search did not preserve the declared Phe890 response allowance');
    assert.equal(designerBranchContact.selected?.designerPrimaryRotationDegrees,
      DESIGNER_PRIMARY_ROTATION_DEGREES,
    'The current-scene search changed the chemist-declared primary rotation');
    assert.equal(designerBranchContact.selected?.coupledRotationDegrees?.length,
      coupledAxisAtomIds.length,
    'The current-scene search did not report every declared coupled axis');
    const selectedGeometry = designerBranchContact.selected?.contactGeometry;
    assert(Number.isFinite(selectedGeometry?.donorAcceptorDistanceAngstrom)
      && selectedGeometry.donorAcceptorDistanceAngstrom <= 3.5,
    'The selected current-scene geometry fails the donor-acceptor distance gate');
    assert(Number.isFinite(selectedGeometry?.hydrogenAcceptorDistanceAngstrom)
      && selectedGeometry.hydrogenAcceptorDistanceAngstrom <= 2.6,
    'The selected current-scene geometry fails the hydrogen-acceptor distance gate');
    assert(Number.isFinite(selectedGeometry?.dhaAngleDegrees)
      && selectedGeometry.dhaAngleDegrees >= 150,
    'The selected current-scene geometry fails the directional D-H-A gate');
    assert(Number.isFinite(selectedGeometry?.carbonylAcceptorAngleDegrees),
      'The selected current-scene geometry lacks its carbonyl direction measurement');
    assert.equal(designerBranchContact.selected?.contacts
      ?.outsideAllowedResponseContactCount, 0,
    'The selected ligand intent has a severe contact outside the declared Phe890 response');
    assert((designerBranchContact.selected?.contacts?.contactsByResidue || [])
      .filter((entry) => !entry.responseAllowed)
      .every((entry) => Number(entry.contactCount) === 0),
    'The selected current-scene search reports a non-allowed severe-contact residue');
    assert(designerBranchContact.searchAudit
      && typeof designerBranchContact.searchAudit === 'object',
    'The current-scene contact search lacks an audit');
    for (const key of ['algorithm', 'coarse', 'local', 'gates', 'ranking'])
      assert(designerBranchContact.searchAudit[key] != null,
        `The current-scene contact search audit lacks ${key}`);
    for (const key of ['inputCoordinateSha256', 'searchDefinitionSha256',
      'selectedCandidateSha256', 'outputCoordinateSha256'])
      assertSha256(designerBranchContact.hashes?.[key],
        `designer contact search ${key}`);
    const stagedLigandAtomIds = new Set(inspections.stagedLigand.atoms
      .map((atom) => atom.atomId));
    assert(Array.isArray(designerMove.result.changedAtomIds)
      && designerMove.result.changedAtomIds.length > 0
      && designerMove.result.changedAtomIds.every((id) => stagedLigandAtomIds.has(id)),
    'Designer contact alignment moved a receptor atom or reported no ligand motion');

    inspections.ligandIntent = requireInspection((await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:256,
    }, 'inspect-designer-ligand-intent')).result, 'designer AWW ligand intent');
    inspections.pocketAtLigandIntent = requireInspection((await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, 'inspect-pocket-at-designer-ligand-intent')).result,
    'pocket at designer AWW ligand intent');
    const distalContactAtIntent = matchingManualContact(
      inspections.pocketAtLigandIntent, 'OX3', {
        residueName:'TYR', residueIndex:884, insertionCode:'', atomName:'O' });
    const distalContactEvaluation = assertDesignerHydrogenBond(
      distalContactAtIntent, 'AWW OX3 to Tyr884 backbone O designer interaction');
    const rotatedAtoms = DESIGNER_TORSION_ATOM_NAMES.map((atomName) =>
      uniqueAtom(inspections.ligandIntent, PRODUCT_STATE_ID, 1104, atomName));
    const afterDegrees = torsionDegrees(...rotatedAtoms);
    assert(circularDistanceDegrees(afterDegrees,
      beforeDegrees + DESIGNER_PRIMARY_ROTATION_DEGREES) <= 0.05,
    'The AWW N7-C12-C15-CX2 torsion did not retain the declared +150 degree move');
    const fixed = await execute('pose.setDesignerLigandPoseFixed', {
      fixed:true,
      label:'AWW +150 degree contact-directed ligand intent before Phe890 response',
    }, 'fix-designer-ligand-intent');
    const designerLock = fixed.result.designerFixedLigandPose;
    assert.equal(designerLock?.active, true,
      'The public API did not activate the designer-fixed ligand pose');
    assert.match(designerLock.lockId, /^[a-f0-9]{64}$/,
      'The designer-fixed ligand pose does not have a stable lock ID');
    const frozenLigandState = canonicalLigandInspection(inspections.ligandIntent);
    const frozenLigandFingerprints = ligandFingerprints(inspections.ligandIntent);
    const ligandIntentCommit = await execute('campaign.commitCurrent', {
      message:'Freeze explicit AWW ligand directional intent before receptor prediction',
      label:'AWW designer-fixed ligand intent',
      tags:['sos1', 'prospective', 'AWW', 'designer-ligand-intent'],
    }, 'commit-designer-ligand-intent');
    const intentVerification = await execute('campaign.verify', {},
      'verify-designer-ligand-intent');
    assert.equal(intentVerification.result.campaignVerification.valid, true);
    const intentExport = await execute('campaign.export', {},
      'export-designer-ligand-intent');
    checkpoints.ligandIntent = {
      commitId:ligandIntentCommit.result.campaignCommit.commitId,
      snapshotId:ligandIntentCommit.result.campaignCommit.snapshotId,
      ...(await save('aww-designer-ligand-intent-campaign.json',
        Buffer.from(intentExport.result.campaignExport.serialized))),
    };

    const parameterized = await execute('protein.parameterize', {},
      'parameterize-fixed-aww-without-motion');
    assert.equal(parameterized.result.parameterization.maximumCoordinateDisplacementAngstrom, 0,
      'Parameter assignment must not move the fixed AWW coordinates');
    inspections.ligandAfterParameterization = requireInspection((await execute(
      'session.inspect', { scope:'ligand', includeCoordinates:true, maximumAtoms:256 },
      'inspect-fixed-ligand-after-parameterization')).result,
    'fixed AWW ligand after parameterization');
    assert.deepEqual(canonicalLigandInspection(inspections.ligandAfterParameterization),
      frozenLigandState, 'Parameter assignment changed the designer-fixed ligand');
    const parameterizedLock = await execute('pose.setDesignerLigandPoseFixed', {
      fixed:true,
      label:'AWW +150 degree contact-directed ligand intent before Phe890 response',
    }, 'verify-fixed-ligand-lock-after-parameterization');
    assert.equal(parameterizedLock.result.designerFixedLigandPose?.lockId,
      designerLock.lockId, 'Parameter assignment invalidated the ligand lock');
    inspections.pocketBeforePhe = requireInspection((await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, 'inspect-pocket-before-phe')).result, 'pocket before Phe890 prediction');
    const parameterizedDistalContact = assertDesignerHydrogenBond(
      matchingManualContact(inspections.pocketBeforePhe, 'OX3', {
        residueName:'TYR', residueIndex:884, insertionCode:'', atomName:'O' }),
      'parameterized AWW OX3 to Tyr884 backbone O designer interaction');

    const enumeration = await execute('pose.enumerateSidechainRotamers', {
      receptorResidue:PHE890, maximumCandidates:64,
    }, 'enumerate-all-phe890');
    const ensemble = enumeration.result.sidechainRotamers;
    assert.equal(ensemble.method, 'canonical-chi-grid-steric-prerank-v1');
    assert.equal(ensemble.designerFixedLigandPose?.lockId, designerLock.lockId,
      'Phe890 enumeration did not use the designer-fixed ligand pose');
    assert.equal(ensemble.ligandPosePolicy,
      'designer-fixed; receptor branches were ranked without generating or reranking ligand poses');
    assert(Array.isArray(ensemble.candidates) && ensemble.candidates.length > 0,
      'Phe890 enumeration returned no candidate');
    assert.equal(ensemble.candidates.length, ensemble.generatedCandidateCount,
      'maximumCandidates did not retain every generated Phe890 candidate');
    const candidateCoordinateHashes = ensemble.candidates.map((candidate) =>
      candidate.coordinateSha256);
    assert.equal(new Set(candidateCoordinateHashes).size, candidateCoordinateHashes.length,
      'Phe890 enumeration returned duplicate coordinate candidates');
    const candidateAudits = [];
    for (let ordinal = 0; ordinal < candidateCoordinateHashes.length; ordinal++) {
      const currentEnsemble = ordinal === 0 ? ensemble
        : (await execute('pose.enumerateSidechainRotamers', {
          receptorResidue:PHE890, maximumCandidates:64,
        }, `reenumerate-phe890-${ordinal + 1}`)).result.sidechainRotamers;
      assert.deepEqual(currentEnsemble.candidates.map((candidate) =>
        candidate.coordinateSha256), candidateCoordinateHashes,
      'Phe890 enumeration changed after undo');
      assert.equal(currentEnsemble.designerFixedLigandPose?.lockId, designerLock.lockId,
        'Phe890 re-enumeration lost the fixed ligand lock');
      const candidate = currentEnsemble.candidates[ordinal];
      const candidateApplication = (await execute('pose.applySidechainRotamer', {
        coordinateSha256:candidate.coordinateSha256,
        expectedInputCoordinateSha256:currentEnsemble.inputCoordinateSha256,
        expectedSelectedCoordinateSha256:candidate.coordinateSha256,
      }, `apply-phe890-${ordinal + 1}`)).result.sidechainRotamer;
      assert.equal(candidateApplication.designerFixedLigandPose?.lockId,
        designerLock.lockId, 'A Phe890 candidate lost the fixed ligand lock');
      const ligand = requireInspection((await execute('session.inspect', {
        scope:'ligand', includeCoordinates:true, maximumAtoms:256,
      }, `inspect-ligand-phe890-${ordinal + 1}`)).result,
      `Phe890 candidate ${ordinal + 1} ligand`);
      assert.deepEqual(canonicalLigandInspection(ligand), frozenLigandState,
        'A Phe890 candidate changed the designer-fixed ligand');
      const pocket = requireInspection((await execute('session.inspect', {
        scope:'pocket', includeCoordinates:true, maximumAtoms:500,
      }, `inspect-pocket-phe890-${ordinal + 1}`)).result,
      `Phe890 candidate ${ordinal + 1} pocket`);
      const calculationResponse = await execute('calculation.run', {
        job:'energy', method:'openmm', options:ENERGY_OPTIONS,
      }, `energy-phe890-${ordinal + 1}`);
      const calculation = calculationResponse.result.calculation;
      assert.equal(calculation.job, 'energy');
      assert.equal(calculation.method, 'openmm');
      assert.equal(calculation.movedHeavyAtomCount, 0,
        'A Phe890 single-point energy calculation moved a heavy atom');
      assert.equal(calculation.maximumDisplacementAngstrom, 0,
        'A Phe890 single-point energy calculation changed coordinates');
      const fullSystemEnergy = Number(calculation.finalEnergy
        ?? calculation.initialEnergy);
      const finiteEnergy = Number.isFinite(fullSystemEnergy);
      const candidateAudit = { ordinal:ordinal + 1, rank:candidate.rank,
        source:candidate.source, chiDegrees:candidate.chiDegrees,
        score:candidate.score,
        severeClashes:candidate.severeClashes,
        stericPenalty:candidate.stericPenalty,
        ligandStericPenalty:candidate.ligandStericPenalty,
        coordinateSha256:candidate.coordinateSha256,
        inputCoordinateSha256:currentEnsemble.inputCoordinateSha256,
        applied:candidateApplication,
        fullSystemEnergy:finiteEnergy ? fullSystemEnergy : null, finiteEnergy,
        energyUnit:calculation.unit, energy:{ job:'energy', method:'openmm',
          options:ENERGY_OPTIONS, result:calculation, assertedZeroCoordinateMotion:true },
        ligand, pocket, coordinatesSaved:true };
      candidateAudit.file = await save(
        `phe890-candidate-${String(ordinal + 1).padStart(2, '0')}.json`,
        candidateAudit);
      candidateAudits.push(candidateAudit);
      await execute('history.undo', {}, `undo-phe890-${ordinal + 1}`);
      const restoredLigand = requireInspection((await execute('session.inspect', {
        scope:'ligand', includeCoordinates:true, maximumAtoms:256,
      }, `inspect-restored-ligand-${ordinal + 1}`)).result,
      `Phe890 candidate ${ordinal + 1} undo ligand`);
      assert.deepEqual(canonicalLigandInspection(restoredLigand), frozenLigandState,
        'Undo did not restore the designer-fixed ligand baseline');
    }
    assert.equal(candidateAudits.length, ensemble.generatedCandidateCount,
      'Not every generated Phe890 candidate received an energy evaluation');
    const selected = rankFiniteClashFreeCandidates(candidateAudits);
    const finalEnsemble = (await execute('pose.enumerateSidechainRotamers', {
      receptorResidue:PHE890, maximumCandidates:64,
    }, 'reenumerate-selected-phe890')).result.sidechainRotamers;
    const finalCandidate = finalEnsemble.candidates.find((candidate) =>
      candidate.coordinateSha256 === selected.coordinateSha256);
    assert(finalCandidate, 'The energy-selected Phe890 candidate is no longer enumerated');
    const application = await execute('pose.applySidechainRotamer', {
      chiDegrees:finalCandidate.chiDegrees,
      expectedInputCoordinateSha256:finalEnsemble.inputCoordinateSha256,
      expectedSelectedCoordinateSha256:finalCandidate.coordinateSha256,
    }, 'apply-energy-selected-phe890');
    const applied = application.result.sidechainRotamer;
    assert.equal(applied.designerFixedLigandPose?.lockId, designerLock.lockId,
      'Phe890 application did not retain the designer-fixed ligand pose');
    assert.equal(applied.ligandPosePolicy,
      'designer-fixed; receptor-only branch applied');
    assert.equal(applied.selectedCoordinateSha256, selected.coordinateSha256);
    assert.equal(applied.inputCoordinateSha256, finalEnsemble.inputCoordinateSha256);

    inspections.ligandAfterPhe = requireInspection((await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:256,
    }, 'inspect-ligand-after-phe')).result, 'AWW ligand after Phe890 response');
    assert.deepEqual(canonicalLigandInspection(inspections.ligandAfterPhe),
      frozenLigandState,
    'Ligand identity, topology, or coordinates changed during the receptor-only response');
    const postPheLigandFingerprints = ligandFingerprints(inspections.ligandAfterPhe);
    assert.deepEqual(postPheLigandFingerprints, frozenLigandFingerprints,
      'The designer-fixed ligand fingerprints changed during Phe890 application');
    inspections.pocketAfterPhe = requireInspection((await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, 'inspect-pocket-after-phe')).result, 'pocket after Phe890 prediction');

    const responseCommit = await execute('campaign.commitCurrent', {
      message:'Freeze energy-ranked receptor-only Phe890 response to designer-fixed AWW ligand',
      label:'AWW fixed ligand with energy-ranked Phe890 state',
      tags:['sos1', 'prospective', 'AWW', 'receptor-only', 'PHE890',
        'openmm-single-point-energy-rank'],
    }, 'commit-phe890-response');
    const finalVerification = await execute('campaign.verify', {},
      'verify-phe890-response');
    assert.equal(finalVerification.result.campaignVerification.valid, true);
    const finalExport = await execute('campaign.export', {}, 'export-phe890-response');
    checkpoints.receptorResponse = {
      commitId:responseCommit.result.campaignCommit.commitId,
      snapshotId:responseCommit.result.campaignCommit.snapshotId,
      ...(await save('aww-receptor-only-prediction-campaign.json',
        Buffer.from(finalExport.result.campaignExport.serialized))),
    };

    const audit = await browser.evaluate('window.MolariumChemistActions.history()');
    const currentRequestIds = new Set(localRecords.map((record) => record.requestId));
    const currentRunAudit = audit.filter((record) => currentRequestIds.has(record.requestId));
    assert.equal(currentRunAudit.length, localRecords.length,
      'The saved audit does not contain every action from this run');
    const forbidden = currentRunAudit.filter((record) =>
      DISALLOWED_CURRENT_RUN_ACTIONS.has(record.action));
    assert.deepEqual(forbidden, [],
      'A legacy ligand-moving or optimization action entered the receptor-only run');
    const energyCalculationRecords = currentRunAudit.filter((record) =>
      record.action === 'calculation.run');
    assert.equal(energyCalculationRecords.length, candidateAudits.length,
      'The action audit does not contain exactly one energy calculation per Phe890 candidate');
    for (const record of energyCalculationRecords) {
      assert.deepEqual(record.args, { job:'energy', method:'openmm',
        options:ENERGY_OPTIONS },
      'A calculation other than the declared OpenMM single-point energy entered the run');
      assert.equal(record.result?.calculation?.movedHeavyAtomCount, 0,
        'The action audit records coordinate motion during a Phe890 energy calculation');
      assert.equal(record.result?.calculation?.maximumDisplacementAngstrom, 0,
        'The action audit records nonzero displacement during a Phe890 energy calculation');
    }
    assert(currentRunAudit.findIndex((record) =>
      record.requestId === ligandIntentCommit.requestId)
      < currentRunAudit.findIndex((record) => record.requestId === enumeration.requestId),
    'Ligand intent must be committed before receptor enumeration');
    const auditRecord = { schema:description.schema, protocol:SCHEMA,
      sourceCampaignSha256:SOURCE_CAMPAIGN_SHA256,
      currentRunRequestIds:[...currentRequestIds], records:audit };
    const auditFile = await save('chemist-action-audit.json', auditRecord);
    const inspectionFile = await save('coordinate-inspections.json', {
      schema:'molarium.sos1-aww-receptor-only-coordinate-evidence/v1',
      sourceCampaignSha256:SOURCE_CAMPAIGN_SHA256,
      designerTorsion:{ atomNames:[...DESIGNER_TORSION_ATOM_NAMES],
        atomIds:torsionAtoms.map((atom) => atom.atomId), beforeDegrees,
        afterDegrees,
        designerPrimaryRotationDegrees:DESIGNER_PRIMARY_ROTATION_DEGREES,
        coupledRotationDegrees:designerBranchContact.selected.coupledRotationDegrees,
        donorHydrogenRotationDegrees:
          designerBranchContact.selected.donorHydrogenRotationDegrees },
      designerBranchContact,
      designerFixedLigandPose:designerLock,
      designerInteractionHypotheses:{
        interpretation:'chemist-supplied directional hypotheses; not computed interaction results and not used to rank the receptor-only rotamers',
        contacts:[hingeHypothesis.result.contact, distalHypothesis.result.contact],
        distalAtLigandIntent:distalContactEvaluation,
        distalAfterParameterization:parameterizedDistalContact,
      },
      fixedLigand:{ before:frozenLigandFingerprints,
        after:postPheLigandFingerprints, exactEquality:true },
      phe890CandidateFiles:candidateAudits.map((candidate) => ({
        ordinal:candidate.ordinal, coordinateSha256:candidate.coordinateSha256,
        file:candidate.file,
      })),
      selectedPhe890:{ enumerationMethod:ensemble.method,
        selectionPolicy:'minimum finite full-system OpenMM energy among zero-severe-clash candidates',
        generatedCandidateCount:ensemble.generatedCandidateCount,
        candidate:{ rank:selected.rank, source:selected.source,
          chiDegrees:selected.chiDegrees, coordinateSha256:selected.coordinateSha256,
          severeClashes:selected.severeClashes,
          fullSystemEnergy:selected.fullSystemEnergy,
          energyUnit:selected.energyUnit, file:selected.file },
        application:applied },
      inspections,
    });

    const manifest = {
      schema:SCHEMA,
      status:'prediction-frozen-later-structures-unopened',
      publicationEligible:true,
      predictionScope:boundary.predictionScope,
      source:boundary.source,
      scientificContract:{
        predecessorPosePolicy:'exact frozen AWZ full-system campaign; no regenerated AWT/AWZ geometry',
        graphAction:'registered AWW molecular graph installed by designRoute.applyStep',
        directionalIntent:'chemist-specified +150 degree C12-to-C15 branch rotation followed by current-scene coupled-axis directional contact search',
        directionalIntentCoordinateOrigin:'current visible AWZ-derived molecule and receptor only; no external reference coordinates',
        designerInteractionHypotheses:'N7 to ASN A879 OD1 and OX3 to TYR A884 backbone O; declared intent only, not scoring results',
        designerFixedLigandPoseLockId:designerLock.lockId,
        ligandIntentFrozenBeforeReceptorPrediction:true,
        receptorSelection:'minimum finite full-system OpenMM single-point energy among every zero-severe-clash enumerated Phe890 candidate',
        receptorSelectionCoordinatePolicy:'fixed-coordinate energy evaluation; no optimization or dynamics',
        everyEnumeratedReceptorCandidateEvaluated:true,
        receptorOnly:true,
        ligandCoordinateEquality:frozenLigandFingerprints.coordinateSha256
          === postPheLigandFingerprints.coordinateSha256,
        poseRefinementUsed:false,
        optimizationUsed:false,
        laterStructureAccess:false,
      },
      staging:{ stepId:staged.result.designStep.id,
        referenceStateId:staged.result.designStep.referenceStateId,
        stateId:staged.result.designStep.stateId,
        inputKind:staged.result.designStep.inputKind,
        productHeavyAtoms:staged.result.designStep.productHeavyAtoms,
        commonHitHeavyAtoms:staged.result.designStep.commonHitHeavyAtoms,
        addedHeavyAtomIds:staged.result.designStep.addedHeavyAtomIds,
        graphOnlyCheckpoint:checkpoints.graphOnly },
      designerTorsion:{ atomNames:[...DESIGNER_TORSION_ATOM_NAMES],
        beforeDegrees, afterDegrees,
        designerPrimaryRotationDegrees:DESIGNER_PRIMARY_ROTATION_DEGREES,
        coupledRotationDegrees:designerBranchContact.selected.coupledRotationDegrees,
        donorHydrogenRotationDegrees:
          designerBranchContact.selected.donorHydrogenRotationDegrees },
      designerBranchContact,
      designerFixedLigandPose:designerLock,
      designerInteractionHypotheses:{ scoringResults:false,
        contacts:[hingeHypothesis.result.contact, distalHypothesis.result.contact] },
      phe890Selection:{ enumerationMethod:ensemble.method,
        selectionPolicy:'minimum finite full-system OpenMM energy among zero-severe-clash candidates',
        energy:{ job:'energy', method:'openmm', options:ENERGY_OPTIONS,
          assertedZeroCoordinateMotion:true },
        inputCoordinateSha256:ensemble.inputCoordinateSha256,
        generatedCandidateCount:ensemble.generatedCandidateCount,
        evaluatedCandidateCount:candidateAudits.length,
        everyGeneratedCandidateEvaluated:
          candidateAudits.length === ensemble.generatedCandidateCount,
        selectedRank:selected.rank, selectedSource:selected.source,
        selectedChiDegrees:selected.chiDegrees, selectedScore:selected.score,
        selectedSevereClashes:selected.severeClashes,
        selectedStericPenalty:selected.stericPenalty,
        selectedLigandStericPenalty:selected.ligandStericPenalty,
        selectedCoordinateSha256:selected.coordinateSha256,
        selectedFullSystemEnergy:selected.fullSystemEnergy,
        selectedEnergyUnit:selected.energyUnit,
        candidateFiles:candidateAudits.map((candidate) => candidate.file) },
      fixedLigand:{ before:frozenLigandFingerprints,
        after:postPheLigandFingerprints, exactEquality:true },
      checkpoints,
      boundary:boundaryFile,
      evidence:{ boundary:boundaryFile, audit:auditFile,
        coordinateInspections:inspectionFile,
        phe890Candidates:candidateAudits.map((candidate) => candidate.file) },
      currentRun:{ actionCount:currentRunAudit.length,
        currentRunRequestIds:[...currentRequestIds],
        firstSequence:currentRunAudit[0]?.sequence || null,
        lastSequence:currentRunAudit.at(-1)?.sequence || null,
        actions:currentRunAudit.map((record) => record.action),
        energyCalculations:energyCalculationRecords.map((record) => ({
          requestId:record.requestId, job:record.args.job, method:record.args.method,
          options:record.args.options,
          movedHeavyAtomCount:record.result.calculation.movedHeavyAtomCount,
          maximumDisplacementAngstrom:
            record.result.calculation.maximumDisplacementAngstrom,
          assertedZeroCoordinateMotion:true,
        })),
        prohibitedActionsObserved:[] },
      runner:{ path:relative(root, fileURLToPath(import.meta.url)),
        sha256:sha256(await readFile(fileURLToPath(import.meta.url))) },
    };
    await save('prediction-manifest.json', manifest);
    console.log(`SOS1_AWW_RECEPTOR_ONLY ${JSON.stringify({
      output:relative(root, output), selectedRank:selected.rank,
      selectedChiDegrees:selected.chiDegrees,
      selectedFullSystemEnergy:selected.fullSystemEnergy,
      ligandCoordinateSha256:frozenLigandFingerprints.coordinateSha256,
      campaignSha256:checkpoints.receptorResponse.sha256,
    })}`);
  } catch (error) {
    let audit = [];
    try {
      audit = browser ? await browser.evaluate(
        'window.MolariumChemistActions?.history?.() || []') : [];
    } catch {
      // Keep the originating scientific or protocol failure.
    }
    const auditFile = await save('chemist-action-audit.json', {
      schema:'molarium.chemist-actions/v1', protocol:SCHEMA,
      sourceCampaignSha256:SOURCE_CAMPAIGN_SHA256,
      status:'failed', records:audit,
    });
    if (Object.keys(inspections).length)
      await save('partial-coordinate-inspections.json', { schema:SCHEMA, inspections });
    await save('failed-run.json', {
      schema:'molarium.sos1-aww-receptor-only-failure/v1',
      status:'failed', sourceCampaignSha256:SOURCE_CAMPAIGN_SHA256,
      error:{ name:String(error?.name || 'Error'),
        message:String(error?.message || error), stack:String(error?.stack || '') },
      completedActions:localRecords.map((record) => ({
        requestId:record.requestId, action:record.action, sequence:record.sequence })),
      checkpoints, boundary:boundaryFile, audit:auditFile, laterStructureAccess:false,
    });
    throw error;
  } finally {
    await browser?.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
