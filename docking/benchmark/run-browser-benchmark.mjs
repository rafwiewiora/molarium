import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(root, '../..');
const inputBytes = await readFile(path.join(root, 'run-input.v0.1.json'));
const input = JSON.parse(inputBytes);
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const onlyCase = valueAfter('--case');
const outputName = valueAfter('--output');
const smoke = args.includes('--smoke');
if (outputName && (!/^[A-Za-z0-9._-]+\.json$/.test(outputName)
  || outputName.includes('..'))) throw new Error('Benchmark output must be a simple JSON filename');
const outputTag = outputName ? outputName.replace(/\.json$/, '')
  : smoke ? 'smoke' : 'registered';
const runMode = smoke ? 'smoke' : outputName ? 'development' : 'registered';
const limit = Math.max(1, Number(valueAfter('--limit') || Number.POSITIVE_INFINITY));
const selectedCases = input.cases.filter((entry) => !onlyCase || entry.id === onlyCase).slice(0, limit);
if (!selectedCases.length) throw new Error(`No benchmark case matches ${onlyCase || 'the selection'}`);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const seed = Math.floor(Math.random() * 1000);
const appPort = 56000 + seed, debugPort = 57000 + seed;
const appUrl = `http://localhost:${appPort}/`;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(path.join(tmpdir(), 'molarium-bioisostere-benchmark-'));
const resultsDirectory = path.join(root, 'results');
await mkdir(resultsDirectory, { recursive:true });

async function waitFor(check, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { const value = await check(); if (value) return value; } catch { /* retry */ }
    await delay(75);
  }
  throw new Error('Timed out waiting for the local Molarium benchmark browser');
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

function caseExpression(entry) {
  const runSeeds = smoke ? [entry.protocol.seeds[0]] : entry.protocol.seeds;
  const conformerCount = smoke ? 2 : entry.protocol.searchChains;
  const options = smoke ? { captureSteps:8, capturePolishSweeps:1,
    torsionSteps:8, fixedRelaxIterations:4 } : {};
  return `(async () => {
    const entry = ${JSON.stringify(entry)};
    const api = window.molariumTest;
    const pdb = await fetch('/docking/benchmark/' + entry.reference.coordinateFile)
      .then((response) => response.text());
    const ccd = await fetch('/docking/benchmark/' + entry.reference.ccdFile)
      .then((response) => response.text());
    const selection = { model:1, chain:entry.reference.ligandChain,
      residueNumber:entry.reference.ligandResidueNumber,
      insertionCode:entry.reference.ligandInsertionCode,
      alternateLocation:entry.reference.alternateLocation };
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
      const insertionCode = line.slice(26, 27).trim();
      const alternateLocation = line.slice(16, 17).trim();
      const selectedLigand = residueName === entry.reference.ligandComponentId
        && chain === selection.chain && residueNumber === selection.residueNumber
        && insertionCode === selection.insertionCode
        && (!selection.alternateLocation || !alternateLocation
          || alternateLocation === selection.alternateLocation);
      return selectedLigand || ['HOH', 'WAT'].includes(residueName);
    }).join('\\n');
    api.loadPdb(filtered, { pdbId:entry.reference.pdbId, name:entry.id });
    const definition = api.parseCcd(ccd, entry.reference.ligandComponentId);
    const preview = await api.previewPdbPreparation({ pH:7.4, histidine:'auto',
      ligandPolicy:'ccd', waterPolicy:'retain', gapPolicy:'cap', repairMissingHeavy:true },
      { [entry.reference.ligandComponentId]:definition });
    if (preview.audit.blockers.length) return { caseId:entry.id,
      terminalOutcome:'preparation-blocked', preparation:{ blockers:preview.audit.blockers,
        warnings:preview.audit.warnings, outputAtoms:preview.molecule.atoms.length }, repeats:[] };
    const parameterization = await api.parameterizePdbPreview(preview);
    const preparedReference = api.current().molecule;
    const repeats = [];
    for (const seed of ${JSON.stringify(runSeeds)}) {
      api.loadObject(preparedReference);
      api.setDockingMode('propagate');
      const captured = await api.captureDockingReference();
      const staging = await api.stageBenchmarkPoseProduct({ caseId:entry.id,
        productSmiles:entry.product.canonicalSmiles,
        posePropagationMap:entry.posePropagationMap,
        interactionHypotheses:entry.interactionHypotheses });
      const targetContactCount = entry.interactionHypotheses.filter((hypothesis) =>
        hypothesis.kind === 'hydrogen-bond' && hypothesis.targetFeature).length;
      if (entry.tier === 'adversarial-negative') {
        repeats.push({ seed, captured, staging, terminalOutcome:
          staging.unavailableTargets.length === targetContactCount
            ? 'success-infeasible-negative-control' : 'unexpected-contact-transfer' });
        continue;
      }
      if (staging.unavailableTargets.length) {
        repeats.push({ seed, captured, staging, terminalOutcome:'reference-contact-unavailable' });
        continue;
      }
      const started = performance.now();
      const run = await api.runConstrainedDocking({ conformerCount:${conformerCount}, seed,
        ...${JSON.stringify(options)} });
      const labbook = api.dockingLabbook();
      await api.applyDockingPose(0);
      const selectedLigand = api.benchmarkCurrentLigand();
      const bondLengths = selectedLigand.bonds.map((bond) => {
        const first = selectedLigand.atoms[bond.a], second = selectedLigand.atoms[bond.b];
        return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
      });
      const minimumFixedCoreSageEnergyKcalMol = labbook.events
        .find((event) => event.stage === 'ligand-preparation')?.details
        ?.minimumFixedCoreSageEnergyKcalMol;
      const geometrySanity = {
        finiteCoordinates:selectedLigand.atoms.every((atom) =>
          [atom.x, atom.y, atom.z].every(Number.isFinite)),
        minimumBondLengthAngstrom:Math.min(...bondLengths),
        maximumBondLengthAngstrom:Math.max(...bondLengths),
        minimumFixedCoreSageEnergyKcalMol,
        selectedPhysicalKcalMol:run.selected.physicalKcalMol,
      };
      geometrySanity.acceptable = geometrySanity.finiteCoordinates
        && geometrySanity.minimumBondLengthAngstrom >= 0.5
        && geometrySanity.maximumBondLengthAngstrom <= 2.6
        && Number.isFinite(minimumFixedCoreSageEnergyKcalMol)
        && Math.abs(minimumFixedCoreSageEnergyKcalMol) <= 1e6
        && Math.abs(run.selected.physicalKcalMol) <= 1e6;
      repeats.push({ seed, captured, staging, run, labbook,
        selectedLigand, geometrySanity, elapsedMs:performance.now() - started,
        terminalOutcome:!geometrySanity.acceptable ? 'excessive-strain-warning'
          : run.selected.feasible ? 'success-feasible' : 'no-feasible-pose' });
    }
    const outcomes = repeats.map((repeat) => repeat.terminalOutcome);
    return { caseId:entry.id, terminalOutcome:outcomes.every((outcome) => outcome === outcomes[0])
        ? outcomes[0] : 'repeat-disagreement',
      preparation:{ blockers:[], warnings:preview.audit.warnings,
        outputAtoms:preview.molecule.atoms.length, parameterization }, repeats };
  })()`;
}

let server, chrome, client;
const results = [];
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
    expression:'Boolean(window.molariumTest)', returnByValue:true,
  })).result.value);

  for (const entry of selectedCases) {
    const startedAt = new Date().toISOString();
    let record;
    try {
      const response = await client.call('Runtime.evaluate', {
        expression:caseExpression(entry), awaitPromise:true, returnByValue:true,
      });
      if (response.exceptionDetails)
        throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      record = { ...response.result.value, startedAt, completedAt:new Date().toISOString(),
        inputCaseSha256:sha256(JSON.stringify(entry)), runMode };
    } catch (error) {
      record = { caseId:entry.id, terminalOutcome:/parameter|OpenFF|Sage/i.test(error.message)
          ? 'parameterization-unsupported' : 'runtime-failure',
        error:error.message, startedAt, completedAt:new Date().toISOString(),
        inputCaseSha256:sha256(JSON.stringify(entry)), runMode, repeats:[] };
    }
    results.push(record);
    await writeFile(path.join(resultsDirectory, `${entry.id}.${outputTag}.json`),
      `${JSON.stringify(record, null, 2)}\n`);
    console.log(`${entry.id}: ${record.terminalOutcome}`);
  }

  const report = { schemaVersion:1, datasetId:input.datasetId,
    runInputSha256:sha256(inputBytes), mode:runMode,
    selectedCaseCount:selectedCases.length, generatedAt:new Date().toISOString(), results };
  const reportName = outputName || (smoke ? 'benchmark-results.v0.1-smoke.json'
    : 'benchmark-results.v0.1.json');
  await writeFile(path.join(root, reportName), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Bioisostere browser benchmark: COMPLETE (${results.length} cases; ${report.mode})`);
} finally {
  client?.close(); chrome?.kill(); server?.kill();
  await rm(profile, { recursive:true, force:true });
}
