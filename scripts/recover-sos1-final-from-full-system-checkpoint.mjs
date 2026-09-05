#!/usr/bin/env node

import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registeredFixedAtomMotion } from
  '../docking/registered-pose-retention.mjs';
import { verifyCampaign } from '../design-history/ledger.mjs';
import { deserializeCampaign, serializeCampaign } from
  '../design-history/live-campaign-store.mjs';
import { validateRegisteredDesignRoute } from
  '../design-history/structures/design-route.mjs';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';
import { finalDiagnosticGate, sha256 } from './sos1-final-step-checkpoint.mjs';

export const SOS1_FULL_SYSTEM_RECOVERY_SCHEMA =
  'molarium.sos1-full-system-final-recovery/v1';

// These coordinate digests were recorded by the original immutable a013
// prediction run before any holdout was opened.  Supplying them through the
// public action API makes this narrow recovery fail closed if the selector,
// pose application, or coupled relaxation no longer reproduces that run.
const A013_FINAL_SELECTED_COORDINATE_SHA256 =
  'a5724fac3051b1c5fb97aa80064cbcd71396ce138e59738911d57bc4327dfd28';
const A013_FINAL_APPLIED_COORDINATE_SHA256 =
  'a7891a9f5a76cb29341a04194b8f064110232eba486038c91d03d01ba372b52b';
const A013_FINAL_RELAXED_COORDINATE_SHA256 =
  '2065bca8aa7c5ee71d5d52954705042dc122aeaa7f4d4edfc55ab6162a8d8c7b';

function valueFor(args, name) {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return args.find((entry) => entry.startsWith(`${name}=`))?.slice(name.length + 1);
}

function coordinateMap(inspection, label) {
  assert.equal(inspection?.truncated, false, `${label} inspection is truncated`);
  assert.equal(inspection?.totalAtomCount, inspection?.atoms?.length,
    `${label} inspection is incomplete`);
  return new Map(inspection.atoms.map((atom) => {
    assert(typeof atom.atomId === 'string' && atom.atomId,
      `${label} inspection has no persistent atom ID`);
    assert(Array.isArray(atom.coordinatesAngstrom) && atom.coordinatesAngstrom.length === 3
      && atom.coordinatesAngstrom.every(Number.isFinite),
    `${label} inspection has invalid coordinates for ${atom.atomId}`);
    return [atom.atomId, atom.coordinatesAngstrom.map(Number)];
  }));
}

/** Prove that the atoms fixed by the relaxation plan did not move during that
 * relaxation. This deliberately compares the immediate pre/post states rather
 * than comparing either state with a predecessor reference. */
export function fixedAtomRelaxationGate({ before, after, fixedAtomIds,
  toleranceAngstrom = 1e-6 } = {}) {
  assert(Array.isArray(fixedAtomIds) && fixedAtomIds.length,
    'relaxation reported no fixed atom IDs');
  assert.equal(new Set(fixedAtomIds).size, fixedAtomIds.length,
    'relaxation reported duplicate fixed atom IDs');
  assert(Number.isFinite(toleranceAngstrom) && toleranceAngstrom >= 0,
    'fixed-atom tolerance must be nonnegative');
  const beforeById = coordinateMap(before, 'pre-relaxation pocket');
  const afterById = coordinateMap(after, 'post-relaxation pocket');
  const missingBefore = fixedAtomIds.filter((id) => !beforeById.has(id));
  const missingAfter = fixedAtomIds.filter((id) => !afterById.has(id));
  const displacements = fixedAtomIds.filter((id) => beforeById.has(id) && afterById.has(id))
    .map((atomId) => { const first = beforeById.get(atomId), second = afterById.get(atomId);
      return { atomId, displacementAngstrom:Math.hypot(
        first[0] - second[0], first[1] - second[1], first[2] - second[2]) }; });
  const fixedCoordinates = (coordinateById) => ({ atomIds:[...fixedAtomIds],
    positions:fixedAtomIds.filter((id) => coordinateById.has(id))
      .map((id) => coordinateById.get(id)) });
  const motion = registeredFixedAtomMotion(
    { fixedCoordinatesAngstrom:fixedCoordinates(beforeById) },
    { fixedCoordinatesAngstrom:fixedCoordinates(afterById) }, toleranceAngstrom);
  return { ...motion, schema:SOS1_FULL_SYSTEM_RECOVERY_SCHEMA,
    toleranceAngstrom, fixedAtomCount:fixedAtomIds.length,
    comparedAtomCount:displacements.length, missingBefore, missingAfter,
    displacements,
    passed:!missingBefore.length && !missingAfter.length
      && motion.accepted === true };
}

function requireAcceptedRelaxation(optimization, requiredFeatureIds,
  beforePocket, afterPocket) {
  assert.equal(optimization?.accepted, true, 'coupled relaxation was rejected and restored');
  const safeguard = optimization.valenceSafeguard;
  assert(safeguard?.accepted === true && safeguard?.complete === true
    && safeguard.violations?.length === 0
    && safeguard.checkedHeavyBonds === safeguard.expectedHeavyBonds
    && safeguard.bondMeasurements?.every((bond) => bond.accepted === true),
  'coupled relaxation failed the complete ligand-valence safeguard');
  const retention = optimization.registeredPoseRetention;
  assert.equal(retention?.accepted, true,
    'coupled relaxation failed registered pose retention');
  assert.equal(retention.before?.active, true, 'pre-relaxation retention plan was inactive');
  assert.equal(retention.after?.active, true, 'post-relaxation retention plan was inactive');
  assert.deepEqual(retention.after.fixedAtomIds, retention.before.fixedAtomIds,
    'fixed atom identities changed during relaxation');
  for (const featureId of requiredFeatureIds) {
    const before = retention.before.features?.filter((entry) => entry.id === featureId) || [];
    const after = retention.after.features?.filter((entry) => entry.id === featureId) || [];
    assert.equal(before.length, 1, `pre-relaxation feature ${featureId} is not unique`);
    assert.equal(after.length, 1, `post-relaxation feature ${featureId} is not unique`);
    assert.equal(before[0].accepted, true, `feature ${featureId} failed before relaxation`);
    assert.equal(after[0].accepted, true, `feature ${featureId} failed after relaxation`);
  }
  const fixedAtomGate = fixedAtomRelaxationGate({ before:beforePocket,
    after:afterPocket, fixedAtomIds:retention.before.fixedAtomIds });
  assert.equal(fixedAtomGate.passed, true,
    `fixed atoms moved during relaxation (maximum ${fixedAtomGate.maximumDisplacementAngstrom} Å)`);
  return { optimization, fixedAtomGate };
}

async function readExactFullSystemCampaign(path, expectedSha256) {
  assert.equal(basename(path), 'open-phe890-pocket-campaign.json',
    'recovery input must be the exact open-phe890-pocket full-system campaign export');
  assert(/^[a-f0-9]{64}$/.test(String(expectedSha256 || '')),
    '--campaign-sha256 must be the recorded lowercase SHA-256 digest');
  const bytes = await readFile(path);
  assert.equal(sha256(bytes), expectedSha256, 'full-system campaign bytes changed');
  const serialized = bytes.toString('utf8');
  const campaign = deserializeCampaign(serialized);
  assert.equal(serializeCampaign(campaign), serialized,
    'full-system campaign is not canonically serialized');
  const verification = await verifyCampaign(campaign);
  assert.equal(verification.valid, true,
    `full-system campaign is invalid: ${verification.reason}`);
  const branch = Object.hasOwn(campaign.branches || {}, 'main') ? 'main'
    : Object.keys(campaign.branches || {})[0];
  const commitId = campaign.branches?.[branch];
  const commit = campaign.objects?.commits?.[commitId];
  const snapshot = campaign.objects?.snapshots?.[commit?.snapshotId];
  assert(branch && commit && snapshot, 'full-system campaign head is incomplete');
  assert(snapshot.graph?.atoms?.length > 500,
    'recovery campaign is not a full-system checkpoint');
  assert(commit.tags?.includes('open-phe890-pocket'),
    'campaign head is not the frozen open-phe890-pocket checkpoint');
  assert(commit.tags?.includes('pre-holdout'),
    'campaign head is not marked as frozen before holdout access');
  return { bytes, serialized, campaign, verification, branch, commitId,
    snapshotId:commit.snapshotId };
}

export async function main(args = process.argv.slice(2)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const campaignArg = valueFor(args, '--campaign');
  const expectedSha256 = valueFor(args, '--campaign-sha256');
  const outputArg = valueFor(args, '--output');
  if (!campaignArg || !expectedSha256 || !outputArg) throw new Error(
    'Usage: bun scripts/recover-sos1-final-from-full-system-checkpoint.mjs --campaign <open-phe890-pocket-campaign.json> --campaign-sha256 <digest> --output <new-directory> [--search-chains 8|16|32|64]');
  const campaignPath = resolve(process.cwd(), campaignArg);
  const output = resolve(process.cwd(), outputArg);
  const searchChains = Number(valueFor(args, '--search-chains') || 64);
  if (![8,16,32,64].includes(searchChains))
    throw new Error('--search-chains must be 8, 16, 32, or 64');
  try { await access(output); throw new Error(`Refusing to overwrite immutable attempt: ${output}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const source = await readExactFullSystemCampaign(campaignPath, expectedSha256);
  await mkdir(output, { recursive:false });
  await writeFile(join(output, 'source-open-phe890-pocket-campaign.json'), source.bytes);
  const saveJson = (name, value) => writeFile(join(output, name),
    `${JSON.stringify(value, null, 2)}\n`);
  await saveJson('recovery-boundary.json', {
    schema:SOS1_FULL_SYSTEM_RECOVERY_SCHEMA, status:'declared-before-compute',
    source:{ path:relative(root, campaignPath), sha256:expectedSha256,
      campaignId:source.campaign.campaignId, branch:source.branch,
      commitId:source.commitId, snapshotId:source.snapshotId,
      fullSystemAtomCount:source.campaign.objects.snapshots[source.snapshotId].graph.atoms.length,
      stateId:'AWW', stepId:'open-phe890-pocket', frozenBeforeHoldoutAccess:true },
    authorization:'All molecular-state changes use public Molarium Chemist Actions.',
    holdoutCoordinatesUsed:false, immutableAttempt:true, searchChains,
    fixedAtomGate:'post-WebGPU coordinates versus exact float32-nm round-trip of immediate pre-WebGPU coordinates',
  });

  const route = JSON.parse(await readFile(join(root,
    'design-history/structures/generated/sos1-prospective-campaign.json'), 'utf8'));
  validateRegisteredDesignRoute(route);
  let browser = null;
  let execute = null;
  let phase = 'browser-start', refinement = null, candidateGate = null;
  async function history() {
    if (!browser) return [];
    try { return await browser.evaluate('window.MolariumChemistActions?.history?.() || []'); }
    catch { return []; }
  }
  try {
    browser = await startMolariumBrowser({ root, appPath:'?blank=1',
      width:1200, height:800 });
    execute = (action, actionArgs = {}, requestId = action) => browser.evaluate(
      `window.MolariumChemistActions.execute(${JSON.stringify({ action,
        args:actionArgs, requestId })})`);
    await waitFor(async () => browser.evaluate('Boolean(window.MolariumChemistActions)'),
      90000, 'Molarium Chemist Actions API');
    phase = 'campaign-import';
    await execute('campaign.import', { serialized:source.serialized },
      'recovery-import-full-system-aww');
    const importedVerification = await execute('campaign.verify', {},
      'recovery-verify-full-system-aww');
    assert.equal(importedVerification.result.campaignVerification.valid, true);
    await execute('designRoute.resume', { routeId:route.id, stateId:'AWW' },
      'recovery-resume-aww');

    phase = 'reference';
    await execute('protein.parameterize', {}, 'recovery-parameterize-aww');
    await execute('view.setMode', { mode:'build' },
      'recovery-enter-design-mode');
    await execute('pose.captureReference', { mode:'propagate' },
      'recovery-capture-aww-reference');

    phase = 'final-stage';
    const staged = await execute('designRoute.applyStep', { stepId:'finish-bay-293' },
      'recovery-stage-final-axh');
    const requiredFeatureIds = (staged.result.designStep.poseTransferPlan
      ?.featureCorrespondences || []).filter((feature) => feature.required === true)
      .map((feature) => feature.id);
    assert(requiredFeatureIds.length, 'final step has no required registered spatial feature');

    phase = 'final-refinement';
    const refined = await execute('pose.refine', { searchChains, execution:'serial',
      featureSeedingProtocol:'v5',
      expectedSelectedCoordinateSha256:A013_FINAL_SELECTED_COORDINATE_SHA256,
    }, 'recovery-refine-final-axh');
    refinement = refined.result.refinement;
    candidateGate = finalDiagnosticGate(refinement, requiredFeatureIds);
    await saveJson('refinement.json', refinement);
    await saveJson('candidate-gate.json', candidateGate);
    if (!candidateGate.passed) throw new Error(
      `Final selector failed closed: feasible=${candidateGate.selectedFeasible}, missing=${candidateGate.missingRequiredFeatureIds.join(',') || 'none'}, unsatisfied=${candidateGate.unsatisfiedRequiredFeatureIds.join(',') || 'none'}`);
    await execute('pose.apply', { index:Math.max(0,
      Number(refinement.selectedRank || 1) - 1),
      expectedSelectedCoordinateSha256:A013_FINAL_SELECTED_COORDINATE_SHA256,
      expectedOutputCoordinateSha256:A013_FINAL_APPLIED_COORDINATE_SHA256,
    }, 'recovery-apply-final-axh');

    // AXH contains atoms absent from the imported AWW checkpoint. Parameterize
    // the selected product, rather than relying on predecessor parameters,
    // before coupled relaxation.
    const parameterized = await execute('protein.parameterize', {},
      'recovery-parameterize-final-axh');

    const beforePocket = (await execute('session.inspect', { scope:'pocket',
      includeCoordinates:true, maximumAtoms:500 }, 'recovery-inspect-pre-relax-pocket')).result;
    phase = 'coupled-relaxation';
    const relaxed = await execute('optimization.run', { method:'induced-fit-webgpu',
      expectedInputCoordinateSha256:A013_FINAL_APPLIED_COORDINATE_SHA256,
      expectedOutputCoordinateSha256:A013_FINAL_RELAXED_COORDINATE_SHA256,
    }, 'recovery-relax-final-axh');
    const afterPocket = (await execute('session.inspect', { scope:'pocket',
      includeCoordinates:true, maximumAtoms:500 }, 'recovery-inspect-post-relax-pocket')).result;
    const relaxation = requireAcceptedRelaxation(relaxed.result.optimization,
      requiredFeatureIds, beforePocket, afterPocket);
    await saveJson('fixed-atom-relaxation-gate.json', relaxation.fixedAtomGate);

    phase = 'final-inspection';
    const ligand = await execute('session.inspect', { scope:'ligand',
      includeCoordinates:true, maximumAtoms:256 }, 'recovery-inspect-final-ligand');
    const routeInspection = await execute('designRoute.inspect', {},
      'recovery-inspect-final-route');
    phase = 'commit-export';
    const committed = await execute('campaign.commitCurrent', {
      message:'Freeze recovered finish-bay-293 full-system prediction',
      label:'finish-bay-293 recovered prediction',
      tags:['sos1-hit-only','pre-holdout','finish-bay-293','full-system-recovery'],
    }, 'recovery-commit-final-full-system');
    const finalVerification = await execute('campaign.verify', {},
      'recovery-verify-final-full-system');
    assert.equal(finalVerification.result.campaignVerification.valid, true);
    const exported = await execute('campaign.export', {},
      'recovery-export-final-full-system');
    const exportedBytes = Buffer.from(exported.result.campaignExport.serialized);
    await writeFile(join(output, 'finish-bay-293-campaign.json'), exportedBytes);
    const audit = await history();
    await saveJson('chemist-action-audit.json', {
      schema:'molarium.chemist-actions/v1', routeId:route.id,
      status:'completed', records:audit });
    await saveJson('recovery-result.json', {
      schema:SOS1_FULL_SYSTEM_RECOVERY_SCHEMA, status:'completed',
      holdoutCoordinatesUsed:false, sourceCampaignSha256:expectedSha256,
      finalCampaignSha256:sha256(exportedBytes), searchChains,
      candidateGate, fixedAtomGate:relaxation.fixedAtomGate,
      parameterization:parameterized.result.parameterization,
      optimization:relaxation.optimization, ligand:ligand.result,
      designRoute:routeInspection.result.designRoute,
      commit:committed.result.campaignCommit,
      export:{ campaignId:exported.result.campaignExport.campaignId,
        branch:exported.result.campaignExport.branch,
        filename:'finish-bay-293-campaign.json' } });
  } catch (error) {
    const audit = await history();
    await saveJson('chemist-action-audit.json', {
      schema:'molarium.chemist-actions/v1', routeId:route.id,
      status:'failed', records:audit });
    await saveJson('failed-run.json', {
      schema:SOS1_FULL_SYSTEM_RECOVERY_SCHEMA, status:'failed', phase,
      holdoutCoordinatesUsed:false, sourceCampaignSha256:expectedSha256,
      searchChains, candidateGate,
      candidateGateSummary:refinement?.candidateGateSummary || [],
      refinement, error:{ name:String(error?.name || 'Error'),
        message:String(error?.message || error), stack:String(error?.stack || '') },
      auditRecordCount:audit.length, lastAuditRecord:audit.at(-1) || null });
    throw error;
  } finally { await browser?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
