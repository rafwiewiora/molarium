#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const SCHEMA = 'molarium.sos1-aww-receptor-only-prospective/v1';
const SOURCE_CAMPAIGN_PATH =
  'design-history/publications/sos1/checkpoints/fragment-merge-campaign.json';
const SOURCE_CAMPAIGN_SHA256 =
  'e1a7722f517b5371efad860dc6d87bf31d813b05df6c3e72db74e71e3236cb81';
const SOURCE_STATE_ID = 'AWZ';
const PRODUCT_STATE_ID = 'AWW';
const AWW_STEP_ID = 'open-phe890-pocket';
const DESIGNER_TORSION_ATOM_NAMES = Object.freeze(['N7', 'C12', 'C15', 'CX2']);
const DESIGNER_CONTACT_TARGET_ANGSTROM = 2.9;
const PHE890 = Object.freeze({ residueName:'PHE', chain:'A', residueIndex:890,
  insertionCode:'' });
const DISALLOWED_CURRENT_RUN_ACTIONS = new Set([
  'pose.refine', 'pose.apply', 'pose.updateReceptorReference', 'optimization.run',
  'calculation.run',
]);

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
      orderedAxisAtomNames:['C12', 'C15'], ligandFeatureAtom:'AWW OX3',
      receptorTargetAtom:'TYR A884 O',
      targetDistanceAngstrom:DESIGNER_CONTACT_TARGET_ANGSTROM,
      solution:'nearest', externalReferenceCoordinatesUsed:false,
      interactionHypotheses:[
        { ligandAtom:'AWW N7', receptorAtom:'ASN A879 OD1', ligandRole:'donor' },
        { ligandAtom:'AWW OX3', receptorAtom:'TYR A884 O', ligandRole:'donor' },
      ],
      hypothesesAreScoringResults:false },
    receptorPrediction:{ residue:PHE890,
      enumeration:'canonical-chi-grid-steric-prerank-v1',
      selection:'rank 1 under the declared steric pre-rank',
      ligandCoordinatesFixed:true },
    laterStructureAccess:false,
    prohibitedCurrentRunActions:[...DISALLOWED_CURRENT_RUN_ACTIONS],
  };
  await save('boundary.json', boundary);

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
      'pose.enumerateSidechainRotamers', 'pose.applySidechainRotamer', 'session.inspect'])
      assert(description.actions[action], `Required public action is unavailable: ${action}`);

    const execute = async (action, actionArgs = {}, suffix = action) => {
      const requestId = `sos1-aww-receptor-only-${localRecords.length + 1}-${suffix}`;
      const response = await browser.evaluate(
        `window.MolariumChemistActions.execute(${JSON.stringify({
          action, args:actionArgs, requestId,
        })})`);
      assert.equal(response.status, 'completed', `${action} did not complete`);
      localRecords.push({ requestId, action, sequence:response.sequence,
        result:response.result });
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
    const parameterized = await execute('protein.parameterize', {},
      'parameterize-awz-without-motion');
    assert.equal(parameterized.result.parameterization.maximumCoordinateDisplacementAngstrom, 0,
      'Parameter assignment must not move the frozen AWZ source coordinates');
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
    const ox3 = uniqueAtom(inspections.stagedLigand, PRODUCT_STATE_ID, 1104, 'OX3');
    const tyr884O = uniqueAtom(inspections.pocketAtDesignerIntent, 'TYR', 884, 'O');
    const designerMove = await execute('geometry.alignBranchToContact', {
      axisAtomIds:[torsionAtoms[1].atomId, torsionAtoms[2].atomId],
      ligandFeatureAtomId:ox3.atomId,
      receptorTargetAtomId:tyr884O.atomId,
      targetDistanceAngstrom:DESIGNER_CONTACT_TARGET_ANGSTROM,
      solution:'nearest',
    }, 'align-designer-aww-branch-to-tyr884');
    const designerBranchContact = designerMove.result.designerBranchContact;
    assert.equal(designerBranchContact.externalReferenceCoordinatesUsed, false);
    assert.equal(designerBranchContact.targetReachable, true,
      'The chemist-requested current-scene contact is not reachable by the directed branch');
    assert(Math.abs(designerBranchContact.achievedDistanceAngstrom
      - DESIGNER_CONTACT_TARGET_ANGSTROM) <= 0.01,
    'The public geometry action did not reproduce the chemist-requested contact distance');

    inspections.ligandIntent = requireInspection((await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:256,
    }, 'inspect-designer-ligand-intent')).result, 'designer AWW ligand intent');
    const rotatedAtoms = DESIGNER_TORSION_ATOM_NAMES.map((atomName) =>
      uniqueAtom(inspections.ligandIntent, PRODUCT_STATE_ID, 1104, atomName));
    const afterDegrees = torsionDegrees(...rotatedAtoms);
    const expectedAfterDegrees = beforeDegrees + designerBranchContact.appliedRotationDegrees;
    assert(circularDistanceDegrees(afterDegrees, expectedAfterDegrees) <= 0.05,
      'The public geometry action did not reproduce its signed designer rotation');
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
    const fixed = await execute('pose.setDesignerLigandPoseFixed', {
      fixed:true,
      label:'AWW explicit OX3 toward Tyr884 directional intent before Phe890 response',
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

    inspections.pocketBeforePhe = requireInspection((await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, 'inspect-pocket-before-phe')).result, 'pocket before Phe890 prediction');
    const enumeration = await execute('pose.enumerateSidechainRotamers', {
      receptorResidue:PHE890, maximumCandidates:32,
    }, 'enumerate-phe890');
    const ensemble = enumeration.result.sidechainRotamers;
    assert.equal(ensemble.method, 'canonical-chi-grid-steric-prerank-v1');
    assert.equal(ensemble.designerFixedLigandPose?.lockId, designerLock.lockId,
      'Phe890 enumeration did not use the designer-fixed ligand pose');
    assert.equal(ensemble.ligandPosePolicy,
      'designer-fixed; receptor branches were ranked without generating or reranking ligand poses');
    assert(Array.isArray(ensemble.candidates) && ensemble.candidates.length > 0,
      'Phe890 enumeration returned no candidate');
    const selected = ensemble.candidates[0];
    assert.equal(selected.rank, 1, 'The first Phe890 candidate is not declared rank 1');
    const application = await execute('pose.applySidechainRotamer', {
      // The scientific choice is the portable chi-angle state. The coordinate
      // digest remains a fail-closed guard, not the semantic selector.
      chiDegrees:selected.chiDegrees,
      expectedInputCoordinateSha256:ensemble.inputCoordinateSha256,
      expectedSelectedCoordinateSha256:selected.coordinateSha256,
    }, 'apply-top-phe890-steric-rank');
    const applied = application.result.sidechainRotamer;
    assert.equal(applied.designerFixedLigandPose?.lockId, designerLock.lockId,
      'Phe890 application did not retain the designer-fixed ligand pose');
    assert.equal(applied.ligandPosePolicy,
      'designer-fixed; receptor-only branch applied');
    assert.equal(applied.selectedCoordinateSha256, selected.coordinateSha256);
    assert.equal(applied.inputCoordinateSha256, ensemble.inputCoordinateSha256);
    assert.equal(applied.candidateRank, 1);

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
      message:'Freeze receptor-only Phe890 response to designer-fixed AWW ligand',
      label:'AWW fixed ligand with predicted Phe890 state',
      tags:['sos1', 'prospective', 'AWW', 'receptor-only', 'PHE890'],
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
      'A ligand-moving or coupled calculation action entered the receptor-only run');
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
        afterDegrees, appliedRotationDegrees:designerBranchContact.appliedRotationDegrees },
      designerBranchContact,
      designerFixedLigandPose:designerLock,
      designerInteractionHypotheses:{
        interpretation:'chemist-supplied directional hypotheses; not computed interaction results and not used to rank the receptor-only rotamers',
        contacts:[hingeHypothesis.result.contact, distalHypothesis.result.contact],
      },
      fixedLigand:{ before:frozenLigandFingerprints,
        after:postPheLigandFingerprints, exactEquality:true },
      selectedPhe890:{ method:ensemble.method, generatedCandidateCount:
        ensemble.generatedCandidateCount, candidate:selected,
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
        directionalIntent:'chemist-specified C12-C15 branch orientation placing OX3 toward Tyr884 O through geometry.alignBranchToContact',
        directionalIntentCoordinateOrigin:'current visible AWZ-derived molecule and receptor only; no external reference coordinates',
        designerInteractionHypotheses:'N7 to ASN A879 OD1 and OX3 to TYR A884 backbone O; declared intent only, not scoring results',
        designerFixedLigandPoseLockId:designerLock.lockId,
        ligandIntentFrozenBeforeReceptorPrediction:true,
        receptorSelection:'rank 1 from canonical-chi-grid-steric-prerank-v1',
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
        appliedRotationDegrees:designerBranchContact.appliedRotationDegrees },
      designerBranchContact,
      designerFixedLigandPose:designerLock,
      designerInteractionHypotheses:{ scoringResults:false,
        contacts:[hingeHypothesis.result.contact, distalHypothesis.result.contact] },
      phe890Selection:{ method:ensemble.method,
        inputCoordinateSha256:ensemble.inputCoordinateSha256,
        generatedCandidateCount:ensemble.generatedCandidateCount,
        retainedCandidateCount:ensemble.candidates.length,
        selectedRank:selected.rank, selectedSource:selected.source,
        selectedChiDegrees:selected.chiDegrees, selectedScore:selected.score,
        selectedSevereClashes:selected.severeClashes,
        selectedStericPenalty:selected.stericPenalty,
        selectedLigandStericPenalty:selected.ligandStericPenalty,
        selectedCoordinateSha256:selected.coordinateSha256 },
      fixedLigand:{ before:frozenLigandFingerprints,
        after:postPheLigandFingerprints, exactEquality:true },
      checkpoints,
      evidence:{ audit:auditFile, coordinateInspections:inspectionFile },
      currentRun:{ actionCount:currentRunAudit.length,
        firstSequence:currentRunAudit[0]?.sequence || null,
        lastSequence:currentRunAudit.at(-1)?.sequence || null,
        actions:currentRunAudit.map((record) => record.action),
        prohibitedActionsObserved:[] },
      runner:{ path:relative(root, fileURLToPath(import.meta.url)),
        sha256:sha256(await readFile(fileURLToPath(import.meta.url))) },
    };
    await save('prediction-manifest.json', manifest);
    console.log(`SOS1_AWW_RECEPTOR_ONLY ${JSON.stringify({
      output:relative(root, output), selectedRank:selected.rank,
      selectedChiDegrees:selected.chiDegrees,
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
      checkpoints, audit:auditFile, laterStructureAccess:false,
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
