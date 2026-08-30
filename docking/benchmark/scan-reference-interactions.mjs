import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(root, '../..');
const fixtureReportBytes = await readFile(path.join(root, 'fixture-validation.v0.1.json'));
const fixtureReport = JSON.parse(fixtureReportBytes);
const seed = Math.floor(Math.random() * 1000);
const appPort = 54000 + seed;
const debugPort = 55000 + seed;
const appUrl = `http://localhost:${appPort}/`;
const chromePath = process.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome');
const profile = await mkdtemp(path.join(tmpdir(), 'molarium-benchmark-contact-scan-'));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(check, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { const value = await check(); if (value) return value; } catch { /* retry */ }
    await delay(75);
  }
  throw new Error('Timed out waiting for Molarium interaction scan');
}

class DevToolsClient {
  constructor(url) { this.socket = new WebSocket(url); this.nextId = 1; this.pending = new Map(); }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once:true });
      this.socket.addEventListener('error', reject, { once:true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
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

const uniqueReferences = new Map();
for (const entry of fixtureReport.cases) {
  const reference = entry.reference;
  const key = `${reference.pdbId}:${reference.componentId}:${reference.selection.model}:`+
    `${reference.selection.chain}:${reference.selection.residueNumber}:${reference.selection.insertionCode}:`+
    `${reference.selection.alternateLocation}`;
  if (!uniqueReferences.has(key)) uniqueReferences.set(key, {
    key,
    caseIds:[],
    ...reference,
  });
  uniqueReferences.get(key).caseIds.push(entry.caseId);
}

let server;
let chrome;
let client;
try {
  server = Bun.spawn(['bun', 'server.js', '--local-only', '--test-api', '--port', String(appPort)], {
    cwd:repositoryRoot, stdout:'ignore', stderr:'pipe',
  });
  await waitFor(async () => (await fetch(appUrl)).ok);
  chrome = Bun.spawn([
    chromePath, '--headless', '--disable-extensions', '--no-first-run', '--disable-gpu',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--window-size=1440,1000', appUrl,
  ], { stdout:'ignore', stderr:'ignore' });
  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    return pages.find((entry) => entry.type === 'page' && entry.url === appUrl);
  });
  client = new DevToolsClient(page.webSocketDebuggerUrl);
  await client.open();
  await waitFor(async () => (await client.call('Runtime.evaluate', {
    expression:'Boolean(window.molariumTest)', returnByValue:true,
  })).result.value);

  const scans = [];
  for (const reference of uniqueReferences.values()) {
    const expression = `(async () => {
      const input = ${JSON.stringify(reference)};
      const api = window.molariumTest;
      const pdb = await fetch('/docking/benchmark/' + input.coordinateFile).then((response) => response.text());
      const ccd = await fetch('/docking/benchmark/' + input.ccdFile).then((response) => response.text());
      const selection = input.selection;
      let model = 1;
      const filtered = pdb.split(/\\r?\\n/).filter((line) => {
        if (line.startsWith('MODEL ')) { model = Number(line.slice(10, 14).trim()) || model; return model === selection.model; }
        if (line.startsWith('ENDMDL')) return model === selection.model;
        if (line.startsWith('ATOM  ')) return model === selection.model;
        if (!line.startsWith('HETATM')) return true;
        if (model !== selection.model) return false;
        const residueName = line.slice(17, 20).trim();
        const chain = line.slice(21, 22).trim();
        const residueNumber = Number(line.slice(22, 26).trim());
        const insertionCode = line.slice(26, 27).trim();
        const alternateLocation = line.slice(16, 17).trim();
        const selectedLigand = residueName === input.componentId && chain === selection.chain
          && residueNumber === selection.residueNumber && insertionCode === selection.insertionCode
          && (!selection.alternateLocation || !alternateLocation || alternateLocation === selection.alternateLocation);
        return selectedLigand || ['HOH', 'WAT'].includes(residueName);
      }).join('\\n');
      const parsed = api.loadPdb(filtered, { pdbId:input.pdbId, name:input.key });
      const definition = api.parseCcd(ccd, input.componentId);
      const preview = await api.previewPdbPreparation({ pH:7.4, histidine:'auto',
        ligandPolicy:'ccd', waterPolicy:'retain', gapPolicy:'cap', repairMissingHeavy:true },
        { [input.componentId]:definition });
      api.loadObject(preview.molecule);
      api.setRepresentation('cartoon');
      const pocket = api.pocketDiagnostics();
      const atom = (index) => {
        const value = preview.molecule.atoms[index];
        return { index, element:value.element, atomName:value.atomName || '',
          residueName:value.residueName || '', chain:value.chain || '',
          residueNumber:value.residueIndex ?? null, insertionCode:value.insertionCode || '',
          record:value.record || '' };
      };
      const isLigand = (index) => {
        const value = preview.molecule.atoms[index];
        return value?.record === 'HETATM' && value.residueName === input.componentId
          && value.chain === selection.chain && value.residueIndex === selection.residueNumber
          && (value.insertionCode || '') === selection.insertionCode;
      };
      const ligandHydrogenBonds = pocket.hydrogenBonds.filter((bond) =>
        isLigand(bond.donor) || isLigand(bond.acceptor)).map((bond) => ({
          donor:atom(bond.donor), hydrogen:atom(bond.hydrogen), acceptor:atom(bond.acceptor),
          hydrogenAcceptorDistance:bond.distance, donorHydrogenAcceptorCosine:bond.cosine,
        }));
      const ligandPiStacks = pocket.piStacks.filter((stack) =>
        stack.first.some(isLigand) || stack.second.some(isLigand)).map((stack) => ({
          first:stack.first.map(atom), second:stack.second.map(atom),
          distance:stack.distance, alignment:stack.alignment,
        }));
      const captureMolecule = structuredClone(preview.molecule);
      captureMolecule.parameterization = { forcefield:'benchmark contact-capture fixture',
        chargeModel:'test-only neutral terms', sourceSha256:input.coordinateSha256,
        system:{ nonbonded:captureMolecule.atoms.map((_, index) => ({ index,
          charge_e:0, sigma_nm:0.30, epsilon_kj:0.10 })) } };
      api.loadObject(captureMolecule);
      api.setDockingMode('propagate');
      const captured = await api.captureDockingReference();
      return { key:input.key, caseIds:input.caseIds, parsedAtoms:parsed.atoms,
        preparedAtoms:preview.molecule.atoms.length, preparationBlockers:preview.audit.blockers,
        preparationWarnings:preview.audit.warnings, ligandHydrogenBonds, ligandPiStacks,
        capturedHydrogenBonds:captured.hydrogenBonds, receptorAtomCount:captured.receptorAtomCount,
        ligandAtomCount:captured.ligandAtomCount };
    })()`;
    const response = await client.call('Runtime.evaluate', {
      expression, awaitPromise:true, returnByValue:true,
    });
    if (response.exceptionDetails)
      scans.push({ key:reference.key, caseIds:reference.caseIds,
        error:response.exceptionDetails.exception?.description || response.exceptionDetails.text });
    else scans.push(response.result.value);
    const last = scans.at(-1);
    console.log(`${reference.key}: ${last.error ? 'ERROR' : `${last.capturedHydrogenBonds.length} H-bonds, ${last.ligandPiStacks.length} pi stacks`}`);
  }

  const report = {
    schemaVersion:1,
    datasetId:fixtureReport.datasetId,
    fixtureValidationSha256:createHash('sha256').update(fixtureReportBytes).digest('hex'),
    preparationProtocol:{ pH:7.4, histidine:'auto', ligandPolicy:'RCSB CCD',
      waterPolicy:'retain', gapPolicy:'cap', repairMissingHeavy:true,
      polarHydrogens:'fixed-heavy 24-state local scan' },
    scans,
  };
  await writeFile(path.join(root, 'interaction-scan.v0.1.json'), `${JSON.stringify(report, null, 2)}\n`);
  const errors = scans.filter((entry) => entry.error);
  if (errors.length) throw new Error(`${errors.length} reference interaction scans failed`);
  console.log(`Reference interaction scan: PASS (${scans.length} unique reference complexes)`);
} finally {
  client?.close();
  chrome?.kill();
  server?.kill();
  await rm(profile, { recursive:true, force:true });
}
