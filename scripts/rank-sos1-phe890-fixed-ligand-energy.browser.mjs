#!/usr/bin/env bun

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

export const SCHEMA = 'molarium.sos1-phe890-fixed-ligand-energy-rank/v1';
export const PHE890 = Object.freeze({ residueName:'PHE', chain:'A', residueIndex:890,
  insertionCode:'' });
export const ENERGY_OPTIONS = Object.freeze({ implicitSolvent:'obc2',
  nonbondedCutoffNm:1.0, constraintMode:'none' });

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_ACTIONS = Object.freeze(['campaign.import', 'campaign.verify',
  'campaign.commitCurrent', 'campaign.export', 'view.setMode', 'pose.captureReference',
  'pose.addContact', 'pose.setDesignerLigandPoseFixed', 'protein.parameterize',
  'pose.enumerateSidechainRotamers', 'pose.applySidechainRotamer', 'calculation.run',
  'history.undo', 'session.inspect']);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function valueFor(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
}

function distance(first, second) {
  return Math.hypot(...first.map((value, index) => value - second[index]));
}

function angleDegrees(first, vertex, last) {
  const a = first.map((value, index) => value - vertex[index]);
  const b = last.map((value, index) => value - vertex[index]);
  const denominator = Math.hypot(...a) * Math.hypot(...b);
  if (!(denominator > 1e-12)) return null;
  const cosine = Math.max(-1, Math.min(1,
    a.reduce((sum, value, index) => sum + value * b[index], 0) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
}

export function evaluateDesignerHydrogenBond(contact) {
  const participants = contact?.hydrogenBond?.participants || {};
  const donor = participants.donor?.coordinatesAngstrom;
  const hydrogen = participants.hydrogen?.coordinatesAngstrom;
  const acceptor = participants.acceptor?.coordinatesAngstrom;
  const coordinatesAvailable = [donor, hydrogen, acceptor].every((point) =>
    Array.isArray(point) && point.length === 3 && point.every(Number.isFinite));
  if (!coordinatesAvailable) return { contactId:contact?.contactId || null,
    required:contact?.required === true, available:contact?.available === true,
    coordinatesAvailable:false, satisfied:false };
  const donorAcceptorDistanceAngstrom = distance(donor, acceptor);
  const hydrogenAcceptorDistanceAngstrom = distance(hydrogen, acceptor);
  const dhaAngleDegrees = angleDegrees(donor, hydrogen, acceptor);
  const satisfied = contact?.required === true && contact?.available === true
    && donorAcceptorDistanceAngstrom <= 3.5
    && hydrogenAcceptorDistanceAngstrom <= 2.6
    && dhaAngleDegrees >= 150;
  return { contactId:contact.contactId, required:contact.required === true,
    available:contact.available === true, coordinatesAvailable:true,
    donorAcceptorDistanceAngstrom, hydrogenAcceptorDistanceAngstrom,
    dhaAngleDegrees, satisfied };
}

export function extractRecordedLigandIntent(campaign) {
  assert.equal(campaign?.schema, 'molarium.design-campaign/v1',
    'Input must be a Molarium design campaign');
  const headId = campaign.branches?.main;
  const head = campaign.objects?.commits?.[headId];
  assert(head, 'Campaign main branch does not resolve to a commit');
  const snapshot = campaign.objects?.snapshots?.[head.snapshotId];
  assert(snapshot, 'Campaign head does not resolve to a snapshot');
  assert.equal(snapshot.properties?.molecule?.source?.pdbId, '5OVE',
    'Only the registered 5OVE prospective coordinate boundary is allowed');
  const script = campaign.objects?.actionScripts?.[head.actionScriptId];
  assert(script && Array.isArray(script.actions),
    'Campaign head does not preserve its public action script');
  const contacts = script.actions.filter((step) => step.action === 'pose.addContact');
  assert(contacts.length > 0, 'Campaign records no designer hydrogen-bond contact');
  for (const step of contacts) {
    assert(step.args?.ligandAtom && step.args?.receptorAtom,
      'Designer contacts must use portable atom selectors');
  }
  const lock = [...script.actions].reverse().find((step) =>
    step.action === 'pose.setDesignerLigandPoseFixed');
  assert.equal(lock?.args?.fixed, true,
    'Campaign does not record an active designer-fixed ligand pose');
  return { headId, head, snapshot, contacts:contacts.map((step) =>
    structuredClone(step.args)), lock:structuredClone(lock.args) };
}

export function rankFiniteClashFreeCandidates(candidateAudits) {
  assert(Array.isArray(candidateAudits) && candidateAudits.length > 0,
    'At least one evaluated rotamer is required');
  for (const audit of candidateAudits) {
    assert(audit.coordinatesSaved === true,
      `Candidate ${audit.coordinateSha256 || audit.rank} lacks saved coordinates`);
  }
  const eligible = candidateAudits.filter((audit) =>
    Number(audit.severeClashes) === 0 && Number.isFinite(audit.fullSystemEnergy));
  assert(eligible.length > 0, 'No finite full-system energy survived the clash gate');
  return [...eligible].sort((first, second) =>
    first.fullSystemEnergy - second.fullSystemEnergy
      || JSON.stringify(first.chiDegrees).localeCompare(JSON.stringify(second.chiDegrees))
      || first.coordinateSha256.localeCompare(second.coordinateSha256))[0];
}

function requireInspection(result, label) {
  assert(result && Array.isArray(result.atoms), `${label} inspection is unavailable`);
  assert.equal(result.truncated, false, `${label} inspection was truncated`);
  assert(result.atoms.length > 0, `${label} inspection contains no atoms`);
  assert(result.atoms.every((atom) => Array.isArray(atom.coordinatesAngstrom)
    && atom.coordinatesAngstrom.length === 3
    && atom.coordinatesAngstrom.every(Number.isFinite)),
  `${label} inspection lacks complete finite coordinates`);
  return result;
}

function canonicalInspection(inspection) {
  return {
    atoms:inspection.atoms.map((atom) => ({ atomId:atom.atomId,
      element:atom.element, coordinatesAngstrom:atom.coordinatesAngstrom.map(Number) }))
      .sort((a, b) => a.atomId.localeCompare(b.atomId)),
    bonds:(inspection.bonds || []).map((bond) => ({ atomIds:[...bond.atomIds].sort(),
      order:Number(bond.order), aromatic:Boolean(bond.aromatic) }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

function inspectionSha256(inspection) {
  return sha256(jsonBytes(canonicalInspection(inspection)));
}

function matchingManualContacts(inspection, recordedContacts) {
  const contacts = inspection.contacts || [];
  return recordedContacts.map((args) => {
    const ligandName = args.ligandAtom.atomName;
    const receptor = args.receptorAtom;
    const match = contacts.find((contact) => {
      if (contact.origin?.kind !== 'user-added-hydrogen-bond-hypothesis') return false;
      const participants = Object.values(contact.hydrogenBond?.participants || {});
      return participants.some((entry) => entry?.scope === 'ligand'
        && entry.atomId?.includes(`::${ligandName}:`))
        && participants.some((entry) => entry?.scope === 'receptor'
          && entry.atomId?.includes(`:${receptor.residueName}:${receptor.residueIndex}:${receptor.insertionCode || ''}:${receptor.atomName}:`));
    });
    assert(match, `Recorded designer contact ${ligandName} -> ${receptor.residueName} ${receptor.residueIndex} ${receptor.atomName} was not restored`);
    return match;
  });
}

export async function main(argv = process.argv.slice(2)) {
  const campaignArg = valueFor(argv, '--campaign');
  const outputArg = valueFor(argv, '--output');
  const expectedSha = valueFor(argv, '--campaign-sha256');
  if (!campaignArg || !outputArg) throw new Error(
    'Usage: bun scripts/rank-sos1-phe890-fixed-ligand-energy.browser.mjs --campaign <path-under-repo> --output <new-directory> [--campaign-sha256 <sha256>]');
  const campaignPath = resolve(process.cwd(), campaignArg);
  const relativeCampaignPath = relative(root, campaignPath);
  assert(relativeCampaignPath && relativeCampaignPath !== '..'
    && !relativeCampaignPath.startsWith(`..${sep}`) && !relativeCampaignPath.startsWith(sep),
  'Campaign path must be inside the Molarium repository');
  const campaignBytes = await readFile(campaignPath);
  const campaignSha256 = sha256(campaignBytes);
  if (expectedSha != null) assert.equal(campaignSha256, expectedSha,
    'Campaign bytes do not match --campaign-sha256');
  assert(!/5OV[H-I]/i.test(campaignBytes.toString('utf8')),
    'Input campaign contains a later-structure/holdout reference');
  const campaign = JSON.parse(campaignBytes);
  const intent = extractRecordedLigandIntent(campaign);

  const output = resolve(process.cwd(), outputArg);
  try {
    await access(output);
    throw new Error(`Refusing to overwrite immutable attempt: ${output}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(output, { recursive:false });
  const save = async (name, value) => {
    const bytes = Buffer.isBuffer(value) ? value : jsonBytes(value);
    await writeFile(resolve(output, name), bytes);
    return { path:name, sha256:sha256(bytes), bytes:bytes.length };
  };
  await save('boundary.json', { schema:SCHEMA, status:'declared-before-compute',
    sourceCampaign:{ path:relativeCampaignPath, sha256:campaignSha256,
      headCommitId:intent.headId }, coordinateBoundary:'5OVE',
    laterStructureAccess:false, ligandPolicy:'designer-fixed',
    receptorPrediction:'rank every enumerated PHE A890 rotamer by full-system OpenMM energy after the severe-clash gate',
    energy:{ method:'openmm', job:'energy', options:ENERGY_OPTIONS } });

  let browser;
  const localRecords = [];
  const candidateAudits = [];
  try {
    browser = await startMolariumBrowser({ root, appPath:'?blank=1', width:1200, height:800 });
    await waitFor(async () => browser.evaluate(
      'Boolean(window.MolariumChemistActionsReady)'), 90000,
    'Molarium Chemist Actions API');
    const description = await browser.evaluate('window.MolariumChemistActions.describe()');
    for (const action of REQUIRED_ACTIONS)
      assert(description.actions[action], `Required public action is unavailable: ${action}`);
    const execute = async (action, args = {}, suffix = action) => {
      const requestId = `phe890-energy-${localRecords.length + 1}-${suffix}`;
      const response = await browser.evaluate(
        `window.MolariumChemistActions.execute(${JSON.stringify({ action, args, requestId })})`);
      localRecords.push({ requestId, action, status:response.status,
        durationMs:response.durationMs, result:response.result });
      assert.equal(response.status, 'completed', `${action} did not complete`);
      return response.result;
    };

    const imported = await execute('campaign.import', {
      sourcePath:`./${relativeCampaignPath.split(sep).join('/')}`,
      sourceSha256:campaignSha256,
    }, 'import-ligand-intent');
    assert.equal(imported.campaignImport.verification.valid, true,
      'Imported campaign failed verification');
    const verified = await execute('campaign.verify', {}, 'verify-ligand-intent');
    assert.equal(verified.campaignVerification.valid, true,
      'Active campaign failed verification');
    await execute('view.setMode', { mode:'build' }, 'enter-design');
    await execute('pose.captureReference', { mode:'propagate' }, 'capture-reference');

    const initialLigand = requireInspection((await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:256,
    }, 'inspect-initial-ligand')), 'initial ligand');
    const initialLigandSha256 = inspectionSha256(initialLigand);
    for (const [index, contact] of intent.contacts.entries())
      await execute('pose.addContact', contact, `restore-contact-${index + 1}`);
    const fixed = await execute('pose.setDesignerLigandPoseFixed', intent.lock,
      'restore-designer-lock');
    assert.equal(fixed.designerFixedLigandPose?.active, true,
      'Designer-fixed ligand lock is not active');
    const lockId = fixed.designerFixedLigandPose.lockId;
    assert.match(lockId, /^[a-f0-9]{64}$/);
    const contactInspection = requireInspection((await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, 'inspect-required-contacts')), 'required contact pocket');
    const restoredContacts = matchingManualContacts(contactInspection, intent.contacts);
    const contactEvaluations = restoredContacts.map(evaluateDesignerHydrogenBond);
    assert(contactEvaluations.every((entry) => entry.satisfied),
      `Designer hydrogen-bond precondition failed: ${JSON.stringify(contactEvaluations)}`);

    const parameterized = await execute('protein.parameterize', {},
      'parameterize-without-motion');
    assert.equal(parameterized.parameterization.maximumCoordinateDisplacementAngstrom, 0,
      'Parameter assignment moved coordinates');
    const parameterizedLigand = requireInspection((await execute('session.inspect', {
      scope:'ligand', includeCoordinates:true, maximumAtoms:256,
    }, 'inspect-parameterized-ligand')), 'parameterized ligand');
    assert.equal(inspectionSha256(parameterizedLigand), initialLigandSha256,
      'Parameter assignment changed the designer-fixed ligand');
    const parameterizedContactInspection = requireInspection((await execute(
      'session.inspect', { scope:'pocket', includeCoordinates:true, maximumAtoms:500 },
      'inspect-parameterized-contacts')), 'parameterized contact pocket');
    const parameterizedContactEvaluations = matchingManualContacts(
      parameterizedContactInspection, intent.contacts).map(evaluateDesignerHydrogenBond);
    assert(parameterizedContactEvaluations.every((entry) => entry.satisfied),
      'Parameter assignment invalidated a required designer hydrogen bond');
    const parameterizedLock = await execute('pose.setDesignerLigandPoseFixed',
      intent.lock, 'verify-parameterized-designer-lock');
    assert.equal(parameterizedLock.designerFixedLigandPose?.lockId, lockId,
      'Parameter assignment invalidated the designer-fixed ligand lock');

    const initialEnumeration = (await execute('pose.enumerateSidechainRotamers', {
      receptorResidue:PHE890, maximumCandidates:64,
    }, 'enumerate-all-phe890')).sidechainRotamers;
    assert(initialEnumeration.candidates?.length > 0, 'No Phe890 rotamers were generated');
    assert.equal(initialEnumeration.designerFixedLigandPose?.lockId, lockId,
      'Enumeration did not preserve the designer-fixed ligand lock');
    const candidateKeys = initialEnumeration.candidates.map((candidate) =>
      candidate.coordinateSha256);
    assert.equal(new Set(candidateKeys).size, candidateKeys.length,
      'Phe890 enumeration contains duplicate coordinate candidates');

    for (let ordinal = 0; ordinal < candidateKeys.length; ordinal++) {
      const enumeration = ordinal === 0 ? initialEnumeration
        : (await execute('pose.enumerateSidechainRotamers', {
          receptorResidue:PHE890, maximumCandidates:64,
        }, `reenumerate-phe890-${ordinal + 1}`)).sidechainRotamers;
      assert.deepEqual(enumeration.candidates.map((candidate) => candidate.coordinateSha256),
        candidateKeys, 'Phe890 enumeration changed after undo');
      const candidate = enumeration.candidates[ordinal];
      const application = (await execute('pose.applySidechainRotamer', {
        coordinateSha256:candidate.coordinateSha256,
        expectedInputCoordinateSha256:enumeration.inputCoordinateSha256,
        expectedSelectedCoordinateSha256:candidate.coordinateSha256,
      }, `apply-phe890-${ordinal + 1}`)).sidechainRotamer;
      assert.equal(application.selectedCoordinateSha256, candidate.coordinateSha256);
      assert.equal(application.designerFixedLigandPose?.lockId, lockId,
        'Phe890 application lost the ligand lock');
      const ligand = requireInspection((await execute('session.inspect', {
        scope:'ligand', includeCoordinates:true, maximumAtoms:256,
      }, `inspect-ligand-${ordinal + 1}`)), `candidate ${ordinal + 1} ligand`);
      assert.equal(inspectionSha256(ligand), initialLigandSha256,
        'Phe890 candidate moved the designer-fixed ligand');
      const pocket = requireInspection((await execute('session.inspect', {
        scope:'pocket', includeCoordinates:true, maximumAtoms:500,
      }, `inspect-pocket-${ordinal + 1}`)), `candidate ${ordinal + 1} pocket`);
      const calculation = (await execute('calculation.run', {
        job:'energy', method:'openmm', options:ENERGY_OPTIONS,
      }, `energy-phe890-${ordinal + 1}`)).calculation;
      assert.equal(calculation.movedHeavyAtomCount, 0,
        'Single-point energy calculation moved heavy atoms');
      assert.equal(calculation.maximumDisplacementAngstrom, 0,
        'Single-point energy calculation changed coordinates');
      const fullSystemEnergy = Number(calculation.finalEnergy ?? calculation.initialEnergy);
      const audit = { ordinal:ordinal + 1, rank:candidate.rank,
        chiDegrees:candidate.chiDegrees, severeClashes:candidate.severeClashes,
        coordinateSha256:candidate.coordinateSha256, inputCoordinateSha256:
          enumeration.inputCoordinateSha256, applied:application,
        fullSystemEnergy, energyUnit:calculation.unit, energy:calculation,
        ligandSha256:inspectionSha256(ligand), pocketSha256:inspectionSha256(pocket),
        coordinatesSaved:true, ligand, pocket };
      candidateAudits.push(audit);
      await save(`candidate-${String(ordinal + 1).padStart(2, '0')}.json`, audit);
      await execute('history.undo', {}, `undo-phe890-${ordinal + 1}`);
      const restoredLigand = requireInspection((await execute('session.inspect', {
        scope:'ligand', includeCoordinates:true, maximumAtoms:256,
      }, `verify-undo-ligand-${ordinal + 1}`)), `candidate ${ordinal + 1} undo ligand`);
      assert.equal(inspectionSha256(restoredLigand), initialLigandSha256,
        'Undo did not restore the designer-fixed ligand baseline');
    }

    const selected = rankFiniteClashFreeCandidates(candidateAudits);
    const finalEnumeration = (await execute('pose.enumerateSidechainRotamers', {
      receptorResidue:PHE890, maximumCandidates:64,
    }, 'reenumerate-selected-phe890')).sidechainRotamers;
    const finalCandidate = finalEnumeration.candidates.find((candidate) =>
      candidate.coordinateSha256 === selected.coordinateSha256);
    assert(finalCandidate, 'Selected energy-ranked Phe890 state is no longer enumerated');
    const selectedApplication = (await execute('pose.applySidechainRotamer', {
      coordinateSha256:finalCandidate.coordinateSha256,
      expectedInputCoordinateSha256:finalEnumeration.inputCoordinateSha256,
      expectedSelectedCoordinateSha256:finalCandidate.coordinateSha256,
    }, 'apply-energy-selected-phe890')).sidechainRotamer;
    const selectedPocket = requireInspection((await execute('session.inspect', {
      scope:'pocket', includeCoordinates:true, maximumAtoms:500,
    }, 'inspect-energy-selected-phe890')), 'selected Phe890 pocket');
    const committed = await execute('campaign.commitCurrent', {
      message:'Freeze Phe890 state selected by prospective full-system energy',
      label:'Designer-fixed ligand with energy-ranked Phe890',
      tags:['sos1', 'prospective', 'PHE890', 'fixed-ligand', 'openmm-energy-rank'],
    }, 'commit-energy-selected-phe890');
    const finalVerification = await execute('campaign.verify', {}, 'verify-selected-campaign');
    assert.equal(finalVerification.campaignVerification.valid, true);
    const exported = await execute('campaign.export', {}, 'export-selected-campaign');
    const campaignFile = await save('selected-phe890-campaign.json',
      Buffer.from(exported.campaignExport.serialized));
    const history = await browser.evaluate('window.MolariumChemistActions.history()');
    const auditFile = await save('chemist-action-audit.json', {
      schema:description.schema, protocol:SCHEMA, sourceCampaignSha256:campaignSha256,
      records:history, currentRunRequestIds:localRecords.map((record) => record.requestId),
    });
    const result = { schema:SCHEMA, status:'prediction-frozen-before-later-structure-access',
      sourceCampaign:{ path:relativeCampaignPath, sha256:campaignSha256 },
      preconditions:{ campaignVerified:true, requiredDesignerContacts:contactEvaluations,
        afterParameterization:parameterizedContactEvaluations,
        allSatisfied:true, designerFixedLigandPose:{ active:true, lockId },
        parameterizationCoordinateDisplacementAngstrom:0,
        ligandCoordinateSha256:initialLigandSha256 },
      enumeration:{ method:initialEnumeration.method,
        generatedCandidateCount:initialEnumeration.generatedCandidateCount,
        evaluatedCandidateCount:candidateAudits.length, allCandidatesEvaluated:
          candidateAudits.length === initialEnumeration.candidates.length },
      selection:{ policy:'minimum finite full-system OpenMM energy among zero-severe-clash candidates',
        selected:{ rank:selected.rank, chiDegrees:selected.chiDegrees,
          coordinateSha256:selected.coordinateSha256,
          fullSystemEnergy:selected.fullSystemEnergy, energyUnit:selected.energyUnit },
        application:selectedApplication, selectedPocketSha256:inspectionSha256(selectedPocket),
        selectedPocketCoordinatesFile:`candidate-${String(selected.ordinal).padStart(2, '0')}.json` },
      campaign:{ commitId:committed.campaignCommit.commitId,
        snapshotId:committed.campaignCommit.snapshotId, ...campaignFile },
      evidence:{ audit:auditFile, candidateFiles:candidateAudits.length },
      laterStructureAccess:false, promotable:true };
    await save('result.json', result);
    return result;
  } catch (error) {
    await save('chemist-action-audit.partial.json', { schema:SCHEMA,
      records:localRecords });
    await save('failure.json', { schema:SCHEMA, status:'failed-closed',
      error:String(error?.stack || error), evaluatedCandidateCount:candidateAudits.length,
      laterStructureAccess:false, promotable:false });
    throw error;
  } finally {
    await browser?.close();
  }
}

if (import.meta.main) await main();
