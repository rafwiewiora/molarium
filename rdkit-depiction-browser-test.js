import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const seed = Math.floor(Math.random() * 1000);
const appPort = 57000 + seed;
const debugPort = 59000 + seed;
const appUrl = `http://localhost:${appPort}/`;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'molarium-depiction-test-'));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(check, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { const value = await check(); if (value) return value; } catch { /* startup retry */ }
    await delay(75);
  }
  throw new Error('Timed out waiting for the 2D depiction test');
}

class DevToolsClient {
  constructor(url) { this.socket = new WebSocket(url); this.nextId = 1; this.pending = new Map(); }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once:true });
      this.socket.addEventListener('error', reject, { once:true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data); const pending = this.pending.get(message.id);
      if (!pending) return; this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message)); else pending.resolve(message.result);
    });
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket.close(); }
}

let server; let chrome; let client;
try {
  server = Bun.spawn(['bun', 'server.js', '--port', String(appPort)], {
    cwd:import.meta.dir, stdout:'ignore', stderr:'pipe',
  });
  await waitFor(async () => (await fetch(appUrl)).ok);
  chrome = Bun.spawn([
    chromePath, '--headless', '--disable-extensions', '--no-first-run',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--window-size=1440,1000', appUrl,
  ], { stdout:'ignore', stderr:'ignore' });
  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    return pages.find((entry) => entry.type === 'page' && entry.url === appUrl);
  });
  client = new DevToolsClient(page.webSocketDebuggerUrl); await client.open();
  await waitFor(async () => (await client.call('Runtime.evaluate', {
    expression:'Boolean(window.molariumTest)', returnByValue:true,
  })).result.value);

  const expression = String.raw`(async () => {
    const api = window.molariumTest;
    const checks = [];
    const check = (condition, label, details = '') => checks.push({ passed:Boolean(condition), label, details });
    api.load('CC(O)c1ccccc1');
    const initial = await api.waitFor2DDepiction();
    check(initial.visible && initial.hasSvg && initial.atomIndices.length === 9 && initial.atomClasses > 0,
      'small molecules receive an RDKit 2D depiction', JSON.stringify(initial));
    check(initial.rdkitVersion === '2025.03.4', 'the inset reports the bundled RDKit version', initial.rdkitVersion);

    const svg = document.querySelector('#structure-2d-drawing svg');
    const oxygen = [...svg.querySelectorAll('.atom-2')].find((node) =>
      [...node.classList].filter((name) => name.startsWith('atom-')).length === 1);
    const box = oxygen.getBoundingClientRect();
    oxygen.dispatchEvent(new MouseEvent('click', { bubbles:true, clientX:box.x + box.width / 2,
      clientY:box.y + box.height / 2 }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const selected = await api.waitFor2DDepiction();
    check(selected.selectedAtoms.length === 1 && selected.selectedAtoms[0] === initial.atomIndices[2],
      'clicking a 2D atom selects the same atom in 3D', JSON.stringify(selected));

    const complex = api.parse('CC(O)c1ccccc1').molecule;
    complex.atoms.forEach((atom, index) => Object.assign(atom, {
      record:'HETATM', residueName:'LIG', residueIndex:1, chain:'L', atomName:'L' + (index + 1),
    }));
    complex.atoms.push({ element:'N', x:12, y:0, z:0, record:'ATOM', residueName:'ALA',
      residueIndex:8, chain:'A', atomName:'N', charge:0 });
    complex.source = { format:'pdb' }; complex.prediction = { kind:'pdb-import' };
    api.loadObject(complex);
    const ligand = await api.waitFor2DDepiction();
    check(ligand.label.includes('LIG ligand') && ligand.atomIndices.length === 9
      && !ligand.atomIndices.includes(complex.atoms.length - 1),
    'protein–ligand scenes depict the ligand without attempting the protein', JSON.stringify(ligand));

    api.loadObject({ name:'Protein only', atoms:[{ element:'N', x:0, y:0, z:0, record:'ATOM',
      residueName:'ALA', residueIndex:1, chain:'A', atomName:'N', charge:0 }], bonds:[], charge:0,
      multiplicity:1, source:{ format:'pdb' }, prediction:{ kind:'pdb-import' } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    check(!api.twoDDepiction().visible, 'pure proteins do not open an unreadable whole-protein depiction');

    const failed = checks.filter((entry) => !entry.passed);
    return { passed:checks.length - failed.length, total:checks.length, failed };
  })()`;
  const evaluation = await client.call('Runtime.evaluate', {
    expression, awaitPromise:true, returnByValue:true,
  });
  if (evaluation.exceptionDetails)
    throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text);
  const result = evaluation.result.value;
  if (result.failed.length) throw new Error(result.failed.map((entry) =>
    `${entry.label}${entry.details ? `: ${entry.details}` : ''}`).join('\n'));
  if (Bun.env.MOLARIUM_2D_SCREENSHOT) {
    await client.call('Runtime.evaluate', {
      expression:`window.molariumTest.load('CC(O)c1ccccc1'); window.molariumTest.waitFor2DDepiction()`,
      awaitPromise:true,
    });
    const capture = await client.call('Page.captureScreenshot', { format:'png', captureBeyondViewport:false });
    await Bun.write(Bun.env.MOLARIUM_2D_SCREENSHOT, Buffer.from(capture.data, 'base64'));
  }
  console.log(`${result.passed}/${result.total} RDKit 2D browser checks passed`);
} finally {
  client?.close(); chrome?.kill(); server?.kill(); await rm(profile, { recursive:true, force:true });
}
