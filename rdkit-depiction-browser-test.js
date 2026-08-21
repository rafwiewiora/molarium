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

    document.querySelector('[data-2d-tool="select"]').click();
    check(api.twoDDepiction().tool === 'select' && api.twoDDepiction().mode === 'view',
      'the visible Select tool activates without forcing the main canvas into Build', JSON.stringify(api.twoDDepiction()));
    document.querySelector('[data-2d-tool="atom"]').click();
    check(api.twoDDepiction().tool === 'atom' && api.twoDDepiction().mode === 'build',
      'the visible Atom tool activates and opens Build', JSON.stringify(api.twoDDepiction()));
    document.querySelector('[data-2d-tool="select"]').click();
    check(api.twoDDepiction().tool === 'select',
      'the visible Select tool can be restored after entering Build', JSON.stringify(api.twoDDepiction()));

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

    api.load('CC');
    const editable = await api.waitFor2DDepiction();
    const beforeDraw = api.current().molecule;
    const drawn = await api.draw2DAtom(1, 'O');
    const afterDraw = await api.waitFor2DDepiction();
    const oxygenCount = drawn.current.molecule.atoms.filter((atom) => atom.element === 'O').length;
    check(oxygenCount === 1 && afterDraw.atomIndices.length === 3 && afterDraw.pendingChanges === 1
      && afterDraw.mode === 'build',
    'the 2D atom tool edits the shared 3D graph and stages one chemistry change', JSON.stringify(afterDraw));
    api.discardChemistryCurrent();
    const restoredDraw = await api.waitFor2DDepiction();
    check(restoredDraw.atomIndices.length === 2 && api.current().molecule.atoms.length === beforeDraw.atoms.length,
      'discard restores both 2D and 3D representations', JSON.stringify(restoredDraw));

    const doubled = await api.set2DBond(0, 1, 2);
    const afterBond = await api.waitFor2DDepiction();
    const globalPair = afterBond.atomIndices.slice(0, 2);
    const editedBond = doubled.current.molecule.bonds.find((bond) =>
      (bond.a === globalPair[0] && bond.b === globalPair[1])
      || (bond.a === globalPair[1] && bond.b === globalPair[0]));
    check(Number(editedBond?.order) === 2 && afterBond.pendingChanges === 1,
      'the 2D bond tool changes the shared bond order without creating a parallel graph', JSON.stringify(afterBond));
    api.discardChemistryCurrent();
    await api.waitFor2DDepiction();

    await api.set2DBond(0, 1, 2);
    const finishedBond = await api.finishChemistryCurrent();
    const afterFinish = await api.waitFor2DDepiction();
    check(finishedBond.validation.valid && finishedBond.valenceViolations.length === 0
      && finishedBond.formula === 'C2H4' && afterFinish.pendingChanges === 0,
    'Finish reconciles hydrogens and locally refines the resulting 3D structure', JSON.stringify({
      formula:finishedBond.formula, validation:finishedBond.validation, depiction:afterFinish,
    }));

    api.load('CCO');
    await api.waitFor2DDepiction();
    const elementPicker = document.querySelector('#structure-2d-element');
    elementPicker.value = 'C';
    elementPicker.dispatchEvent(new Event('change', { bubbles:true }));
    const editableSvg = document.querySelector('#structure-2d-drawing svg');
    const editableOxygen = [...editableSvg.querySelectorAll('.atom-2')].find((node) =>
      [...node.classList].filter((name) => name.startsWith('atom-')).length === 1);
    const editableBox = editableOxygen.getBoundingClientRect();
    editableOxygen.dispatchEvent(new MouseEvent('click', { bubbles:true,
      clientX:editableBox.x + editableBox.width / 2, clientY:editableBox.y + editableBox.height / 2 }));
    const pointerEdited = await api.waitFor2DDepiction();
    check(pointerEdited.mode === 'build' && pointerEdited.tool === 'atom'
      && pointerEdited.atomIndices.length === 4 && pointerEdited.pendingChanges === 1,
    'the visible 2D controls enter Build and edit through an actual SVG click', JSON.stringify(pointerEdited));
    document.querySelector('#structure-2d-discard').click();
    const pointerRestored = await api.waitFor2DDepiction();
    check(pointerRestored.atomIndices.length === 3 && pointerRestored.pendingChanges === 0,
      'the inset Discard control restores the synchronized structure', JSON.stringify(pointerRestored));

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
