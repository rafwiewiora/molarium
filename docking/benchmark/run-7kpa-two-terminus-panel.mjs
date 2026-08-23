import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deterministicHash, graphContractFromInspection, panelRoot, readPanelManifest,
  stableReplayPayload, validatePanelManifest } from './7kpa-two-terminus-panel.mjs';
import { editDifficulty } from '../../enumerations/edit-difficulty.mjs';
import { assessEnumeratedPose } from '../../enumerations/pose-assessment.mjs';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null;
};
const enumerationPanel = args.includes('--enumerations');
const manifest = enumerationPanel
  ? await (await import('../../enumerations/high-disruption-panel.mjs'))
    .buildHighDisruptionPanelManifest()
  : (await readPanelManifest()).manifest;
await validatePanelManifest(manifest);
const onlyCase = valueAfter('--case');
const onlyLocus = valueAfter('--locus');
const replayOverride = valueAfter('--replays');
const searchOverride = valueAfter('--search-chains');
const outputArgument = valueAfter('--output');
const candidateExportArgument = valueAfter('--candidate-export-output');
const repositoryRoot = path.resolve(panelRoot, '../..');
const selected = manifest.cases.filter((entry) => (!onlyCase || entry.id === onlyCase)
  && (!onlyLocus || entry.locus === onlyLocus));
if (!selected.length) throw new Error(`No panel cases match ${onlyCase || onlyLocus || 'selection'}`);
const replays = replayOverride == null ? manifest.protocol.replays : Number(replayOverride);
if (!Number.isInteger(replays) || replays < 1 || replays > 10)
  throw new Error('--replays must be an integer from 1 to 10');
const searchChains = searchOverride == null ? manifest.protocol.searchChains : Number(searchOverride);
if (![8,16,32,64].includes(searchChains)) throw new Error('--search-chains must be 8, 16, 32, or 64');
if (onlyLocus && !['pyridone','pyrrolidone','dual','linker-pyrrolidone'].includes(onlyLocus))
  throw new Error('--locus must be pyridone, pyrrolidone, dual, or linker-pyrrolidone');
const outputPath = outputArgument ? path.resolve(outputArgument)
  : path.join(panelRoot, enumerationPanel
    ? 'results/7kpa-high-disruption-enumerations.development.json'
    : 'results/7kpa-two-terminus-panel.development.json');
const candidateExportPath = candidateExportArgument ? path.resolve(candidateExportArgument) : null;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const appPort = Number(valueAfter('--port')) || 58000 + (process.pid % 500);
const debugPort = Number(valueAfter('--debug-port')) || appPort + 500;
const appUrl = `http://127.0.0.1:${appPort}/`;
const chromePath = process.env.MOLARIUM_CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(path.join(tmpdir(), 'molarium-7kpa-panel-'));

async function waitFor(check, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { const value = await check(); if (value) return value; } catch { /* retry */ }
    await delay(75);
  }
  throw new Error('Timed out waiting for the local Molarium panel browser');
}

class DevToolsClient {
  constructor(url) { this.socket = new WebSocket(url); this.nextId = 1; this.pending = new Map(); }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once:true });
      this.socket.addEventListener('error', reject, { once:true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data), pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket.close(); }
}

const setupExpression = `(async () => {
  const panel = ${JSON.stringify({ reference:manifest.reference })};
  const api = window.molariumTest;
  const pdb = await fetch('/docking/benchmark/' + panel.reference.coordinateFile)
    .then((response) => response.text());
  const ccd = await fetch('/docking/benchmark/' + panel.reference.ccdFile)
    .then((response) => response.text());
  let model = 1;
  const filtered = pdb.split(/\\r?\\n/).filter((line) => {
    if (line.startsWith('MODEL ')) { model = Number(line.slice(10, 14).trim()) || model; return model === 1; }
    if (line.startsWith('ENDMDL')) return model === 1;
    if (line.startsWith('ATOM  ')) return model === 1;
    if (!line.startsWith('HETATM')) return true;
    if (model !== 1) return false;
    const residueName = line.slice(17, 20).trim();
    const chain = line.slice(21, 22).trim();
    const residueNumber = Number(line.slice(22, 26).trim());
    return (residueName === panel.reference.componentId && chain === panel.reference.chain
      && residueNumber === panel.reference.residueNumber) || ['HOH','WAT'].includes(residueName);
  }).join('\\n');
  const started = performance.now();
  api.loadPdb(filtered, { pdbId:panel.reference.pdbId, name:'7KPA D84 two-terminus panel' });
  const definition = api.parseCcd(ccd, panel.reference.componentId);
  const preview = await api.previewPdbPreparation({ pH:7.4, histidine:'auto', ligandPolicy:'ccd',
    waterPolicy:panel.reference.waterPolicy, gapPolicy:'cap', repairMissingHeavy:true },
    { [panel.reference.componentId]:definition });
  if (preview.audit.blockers.length) return { ready:false, blockers:preview.audit.blockers,
    warnings:preview.audit.warnings, elapsedMs:performance.now() - started };
  const parameterization = await api.parameterizePdbPreview(preview);
  window.__molarium7kpaPanelPreparedReference = structuredClone(api.current().molecule);
  return { ready:true, blockers:[], warnings:preview.audit.warnings,
    outputAtoms:preview.molecule.atoms.length,
    parameterization:{ forcefield:parameterization?.forcefield || null,
      chargeModel:parameterization?.chargeModel || null }, elapsedMs:performance.now() - started };
})()`;

function replayExpression(entry, replayOrdinal) {
  return `(async () => {
    const entry = ${JSON.stringify(entry)};
    const contactsByKey = ${JSON.stringify(manifest.referenceContacts)};
    const api = window.molariumTest;
    const chemist = await window.MolariumChemistActionsReady;
    const actions = [];
    const started = performance.now();
    const executeEnvelope = async (action, args = {}) => {
      const actionStarted = performance.now();
      const request = { action, args };
      try {
        const response = await chemist.execute(request);
        actions.push({ ...request, status:'completed', result:response.result,
          durationMs:performance.now() - actionStarted });
        return response;
      } catch (error) {
        actions.push({ ...request, status:'failed', error:String(error?.message || error),
          durationMs:performance.now() - actionStarted });
        throw error;
      }
    };
    const execute = async (action, args = {}) => (await executeEnvelope(action, args)).result;
    const inspectEnvelope = (coordinates = false) => executeEnvelope('session.inspect', {
      scope:'ligand', includeCoordinates:coordinates, maximumAtoms:200 });
    const inspect = async (coordinates = false) => (await inspectEnvelope(coordinates)).result;
    const selectNames = async (names) => {
      const current = await inspect(false);
      const byName = new Map(current.atoms.map((atom) => [atom.atomName, atom.atomId]));
      const missing = names.filter((name) => !byName.has(name) && !aliases.has(name));
      if (missing.length) throw new Error('Cannot resolve D84 atom names: ' + missing.join(', '));
      return execute('selection.replace', {
        atomIds:names.map((name) => aliases.get(name) || byName.get(name)) });
    };
    const aliases = new Map();
    const atomIds = async (names) => {
      const current = await inspect(false);
      const byName = new Map(current.atoms.map((atom) => [atom.atomName, atom.atomId]));
      const resolved = names.map((name) => aliases.get(name) || byName.get(name));
      if (resolved.some((id) => !id)) throw new Error('Cannot resolve atom references: ' + names.join(', '));
      return resolved;
    };
    let chemistry = null, contactMapping = null, refinement = null, appliedPose = null;
    const candidateValidationExports = [];
    let referenceGraph = null, labbookAudit = null;
    const chemistryCommits = [];
    let terminalOutcome = 'runtime-failure';
    try {
      api.loadObject(structuredClone(window.__molarium7kpaPanelPreparedReference));
      await execute('view.setMode', { mode:'build' });
      await execute('build.setTool', { tool:'select' });
      await execute('pose.captureReference', { mode:'propagate' });
      const captured = await inspect(false);
      referenceGraph = {
        atoms:captured.atoms.map((atom) => ({ atomId:atom.atomId, atomName:atom.atomName,
          element:atom.element, formalCharge:atom.formalCharge, aromatic:atom.aromatic })),
        bonds:captured.bonds,
      };
      for (const operation of entry.operations) {
        if (operation.op === 'finish') {
          const result = await execute('chemistry.finish');
          chemistryCommits.push({ validation:result.validation || null,
            polish:result.polish || null,
            contactFeatureRemaps:result.contactFeatureRemaps || [] });
        } else if (operation.op === 'setBond') {
          await selectNames(operation.atoms);
          await execute('chemistry.setBond', { order:operation.order });
        } else if (operation.op === 'setAtom') {
          await selectNames([operation.atom]);
          await execute('chemistry.setAtom', { element:operation.element,
            formalCharge:operation.formalCharge });
        } else if (operation.op === 'deleteAtom') {
          await selectNames([operation.atom]); await execute('chemistry.deleteAtom');
        } else if (operation.op === 'addHydrogen') {
          await selectNames([operation.atom]); await execute('chemistry.addHydrogen');
        } else if (operation.op === 'removeHydrogen') {
          await selectNames([operation.atom]); await execute('chemistry.removeHydrogen');
        } else if (operation.op === 'deleteBond') {
          await selectNames(operation.atoms); await execute('chemistry.deleteBond');
        } else if (operation.op === 'addAtom') {
          const result = await execute('chemistry.addAtom', {
            attachedToAtomId:(await atomIds([operation.attachedTo]))[0],
            element:operation.element,
          });
          if (!result.addedAtomId) throw new Error('Added atom has no persistent identity');
          aliases.set(operation.as, result.addedAtomId);
        } else if (operation.op === 'createBond') {
          await execute('chemistry.createBond', {
            atomIds:await atomIds(operation.atoms), order:operation.order,
          });
        }
      }
      const edited = await inspect(true);
      const aliasById = new Map([...aliases].map(([alias, id]) => [id, alias]));
      chemistry = { commits:chemistryCommits,
        moleculeValidation:edited.molecule?.chemistryValidation || null,
        atoms:edited.atoms.map((atom) => ({ atomId:atom.atomId,
          atomName:aliasById.get(atom.atomId) || atom.atomName,
          element:atom.element, formalCharge:atom.formalCharge, aromatic:atom.aromatic })),
        bonds:edited.bonds, transformedRingRegions:edited.transformedRingRegions };
      const policy = new Map([
        ...entry.requiredContacts.map((key) => [contactsByKey[key], 'required']),
        ...entry.omittedContacts.map((key) => [contactsByKey[key], 'omitted']),
      ]);
      const requiredUnavailable = [];
      for (const original of captured.contacts) {
        const live = edited.contacts.find((contact) => contact.contactId === original.contactId);
        const desired = policy.get(original.label);
        if (desired === 'omitted') await execute('pose.setContact', {
          contactId:original.contactId, required:false });
        else if (desired === 'required' && live?.available) await execute('pose.setContact', {
          contactId:original.contactId, required:true });
        else if (desired === 'required') requiredUnavailable.push(original.label);
      }
      const afterPolicy = await inspect(false);
      contactMapping = afterPolicy.contacts.map((contact) => ({ ...contact,
        policy:policy.get(contact.label) || 'unregistered' }));
      if (requiredUnavailable.length) {
        terminalOutcome = 'required-contact-unavailable';
        contactMapping = { contacts:contactMapping, requiredUnavailable };
      } else {
        const refinementStarted = performance.now();
        const result = await execute('pose.refine', { searchChains:${searchChains} });
        refinement = { ...result.refinement, runtimeMs:performance.now() - refinementStarted };
        const labbook = api.dockingLabbook();
        const labbookModule = await import('/docking/labbook.mjs');
        const verification = await labbookModule.verifyLabbook(labbook);
        labbookAudit = { schema:labbook?.schema || null,
          protocolSha256:labbook?.protocolSha256 || null,
          labbookSha256:labbook?.labbookSha256 || null,
          eventCount:labbook?.events?.length || 0,
          valid:Boolean(verification?.valid), reason:verification?.reason || null };
        if (${Boolean(candidateExportPath)}) {
          const numericSystem = api.dockingValidationNumericSystem();
          if (!numericSystem) throw new Error('The exact ligand numeric System is unavailable.');
          for (let poseIndex = 0; poseIndex < refinement.candidates; poseIndex++) {
            const applied = await execute('pose.apply', { index:poseIndex });
            const inspection = await inspectEnvelope(true);
            candidateValidationExports.push({
              id:entry.id + ':replay-' + ${replayOrdinal} + ':pose-' + poseIndex,
              caseId:entry.id, endpoint:entry.locus,
              analogue:{ name:entry.name, intendedRoles:entry.intendedRoles,
                replayOrdinal:${replayOrdinal}, poseIndex,
                rank:applied.appliedPose.rank, feasible:applied.appliedPose.feasible,
                scoreKcalMol:applied.appliedPose.scoreKcalMol },
              requiredContacts:entry.requiredContacts,
              inspection, numericSystem,
            });
          }
        }
        if (refinement.candidates > 0) {
          const applied = await execute('pose.apply', { index:0 });
          const pose = await inspect(true);
          appliedPose = { result:applied.appliedPose,
            atoms:pose.atoms.map((atom) => ({ atomId:atom.atomId, atomName:atom.atomName,
              element:atom.element, coordinatesAngstrom:atom.coordinatesAngstrom })),
            bonds:pose.bonds };
        }
        terminalOutcome = refinement.selectedFeasible ? 'success-feasible' : 'no-feasible-pose';
      }
    } catch (error) {
      const message = String(error?.message || error);
      terminalOutcome = /RDKit rejected|open valence|chemical state|chemistry changes/i.test(message)
        ? 'chemistry-invalid'
        : /OpenFF|Sage|parameter/i.test(message) ? 'parameterization-unsupported'
        : terminalOutcome === 'runtime-failure' ? 'runtime-failure' : terminalOutcome;
      chemistry = { ...(chemistry || {}), error:message };
    }
    return { caseId:entry.id, replayOrdinal:${replayOrdinal}, terminalOutcome, actions,
      chemistry, contactMapping, refinement, appliedPose, referenceGraph, labbookAudit,
      candidateValidationExports,
      runtime:{ totalMs:performance.now() - started,
        actionMs:actions.reduce((sum, action) => sum + action.durationMs, 0) } };
  })()`;
}

let server, chrome, client;
const caseResults = [];
const validationExports = [];
let preparation;
try {
  server = Bun.spawn(['bun', 'server.js', '--local-only', '--test-api', '--port', String(appPort)], {
    cwd:repositoryRoot, stdout:'ignore', stderr:'pipe',
  });
  await waitFor(async () => (await fetch(appUrl)).ok);
  chrome = Bun.spawn([chromePath, '--headless', '--disable-extensions', '--no-first-run',
    '--enable-unsafe-webgpu', `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`, '--window-size=1440,1000', appUrl],
  { stdout:'ignore', stderr:'ignore' });
  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    return pages.find((entry) => entry.type === 'page' && entry.url === appUrl);
  });
  client = new DevToolsClient(page.webSocketDebuggerUrl);
  await client.open();
  await waitFor(async () => (await client.call('Runtime.evaluate', {
    expression:'Boolean(window.molariumTest && window.MolariumChemistActionsReady)',
    returnByValue:true,
  })).result.value);
  const setup = await client.call('Runtime.evaluate', {
    expression:setupExpression, awaitPromise:true, returnByValue:true,
  });
  if (setup.exceptionDetails)
    throw new Error(setup.exceptionDetails.exception?.description || setup.exceptionDetails.text);
  preparation = setup.result.value;
  if (!preparation.ready) throw new Error(`7KPA preparation blocked: ${JSON.stringify(preparation.blockers)}`);

  for (const entry of selected) {
    const caseInputSha256 = deterministicHash(entry);
    const caseReplays = [];
    for (let replayOrdinal = 1; replayOrdinal <= replays; replayOrdinal++) {
      const response = await client.call('Runtime.evaluate', {
        expression:replayExpression(entry, replayOrdinal), awaitPromise:true, returnByValue:true,
      });
      let record;
      if (response.exceptionDetails) record = { caseId:entry.id, replayOrdinal,
        terminalOutcome:'runtime-failure', actions:[], chemistry:{
          error:response.exceptionDetails.exception?.description || response.exceptionDetails.text },
        contactMapping:null, refinement:null, appliedPose:null, runtime:{ totalMs:0, actionMs:0 } };
      else record = response.result.value;
      record.caseInputSha256 = caseInputSha256;
      const productGraph = record.chemistry
        ? graphContractFromInspection(record.chemistry.atoms || [], record.chemistry.bonds || [])
        : null;
      const referenceGraph = record.referenceGraph
        ? graphContractFromInspection(record.referenceGraph.atoms || [], record.referenceGraph.bonds || [])
        : null;
      record.referenceGraphSha256 = record.referenceGraph
        ? deterministicHash(referenceGraph) : deterministicHash(null);
      record.productGraphSha256 = productGraph
        ? deterministicHash(productGraph) : deterministicHash(null);
      record.expectedProductGraphSha256 = entry.expectedProductGraphSha256;
      record.productGraphMatchesExpected = record.productGraphSha256
        === entry.expectedProductGraphSha256;
      const remapCount = record.chemistry?.commits?.reduce((sum, commit) =>
        sum + (commit.contactFeatureRemaps?.length || 0), 0) || 0;
      record.editDifficulty = record.chemistry && record.referenceGraph
        ? editDifficulty(record.referenceGraph, record.chemistry, { contactRemapCount:remapCount })
        : null;
      record.enumerationPoseScreen = enumerationPanel && record.refinement
        ? assessEnumeratedPose(record.refinement) : null;
      if (!record.productGraphMatchesExpected
        && !['chemistry-invalid','runtime-failure'].includes(record.terminalOutcome))
        record.terminalOutcome = 'product-identity-mismatch';
      record.candidateExportIntegrity = (record.candidateValidationExports || []).map((exported) => ({
        id:exported.id,
        poseIndex:exported.analogue.poseIndex,
        rank:exported.analogue.rank,
        feasible:exported.analogue.feasible,
        coordinateSha256:deterministicHash(exported.inspection.result.atoms
          .map((atom) => atom.coordinatesAngstrom)),
        numericSystemSha256:deterministicHash(exported.numericSystem.system),
      }));
      for (const exported of record.candidateValidationExports || [])
        exported.analogue.editDifficulty = record.editDifficulty;
      validationExports.push(...(record.candidateValidationExports || []));
      delete record.candidateValidationExports;
      record.deterministicSha256 = deterministicHash(stableReplayPayload(record));
      caseReplays.push(record);
      console.log(`${entry.id} replay ${replayOrdinal}/${replays}: ${record.terminalOutcome}`);
    }
    const hashes = new Set(caseReplays.map((record) => record.deterministicSha256));
    caseResults.push({ caseId:entry.id, locus:entry.locus, caseInputSha256,
      terminalOutcomes:caseReplays.map((record) => record.terminalOutcome),
      replayAgreement:hashes.size === 1, replays:caseReplays });
  }
  const report = { schemaVersion:1, panelId:manifest.panelId, panelVersion:manifest.version,
    manifestSha256:deterministicHash(manifest), runMode:selected.length === manifest.cases.length
      && replays === manifest.protocol.replays && searchChains === manifest.protocol.searchChains
      ? 'preregistered-development' : 'development-shard',
    protocol:{ searchChains, replays }, selectedCaseIds:selected.map((entry) => entry.id),
    generatedAt:new Date().toISOString(), host:{ userAgent:null }, preparation,
    cases:caseResults, resultsSha256:deterministicHash(caseResults) };
  await mkdir(path.dirname(outputPath), { recursive:true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  if (candidateExportPath) {
    const exportBatch = { schema:'molarium.chemist-pose-export-batch/v1',
      protocol:{ id:manifest.protocol.id, version:manifest.protocol.version,
        panelId:manifest.panelId, panelVersion:manifest.version,
        manifestSha256:deterministicHash(manifest), searchChains, replays,
        route:'public Molarium Chemist Actions; read-only exact numeric-System attachment' },
      exports:validationExports };
    await mkdir(path.dirname(candidateExportPath), { recursive:true });
    await writeFile(candidateExportPath, `${JSON.stringify(exportBatch, null, 2)}\n`);
    console.log(`7KPA validation exports: ${validationExports.length} poses -> ${candidateExportPath}`);
  }
  console.log(`7KPA ${enumerationPanel ? 'high-disruption enumeration' : 'two-terminus'} panel: COMPLETE (${caseResults.length} cases) -> ${outputPath}`);
} finally {
  client?.close(); chrome?.kill(); server?.kill();
  await rm(profile, { recursive:true, force:true });
}
