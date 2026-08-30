import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const seed = Math.floor(Math.random() * 1000);
const appPort = 57000 + seed;
const debugPort = 59000 + seed;
const appUrl = `http://localhost:${appPort}/`;
const chromePath = Bun.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome');
const chromePlatformArgs = process.platform === 'linux'
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
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
  server = Bun.spawn(['bun', 'server.js', '--local-only', '--test-api', '--port', String(appPort)], {
    cwd:import.meta.dir, stdout:'ignore', stderr:'pipe',
  });
  await waitFor(async () => (await fetch(appUrl)).ok);
  chrome = Bun.spawn([
    chromePath, ...chromePlatformArgs, '--headless', '--disable-extensions', '--no-first-run',
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
    const drawing = document.querySelector('#structure-2d-drawing');
    const clickDrawingNear = (point, distance = 18) => {
      const bounds = drawing.getBoundingClientRect();
      const direction = point.x < bounds.x + bounds.width / 2 ? -1 : 1;
      drawing.dispatchEvent(new MouseEvent('click', { bubbles:true,
        clientX:point.x + direction * distance, clientY:point.y }));
    };
    const atomScreenPoint = (svg, atomIndex) => {
      const bondEndpoints = [], labelPoints = [];
      svg.querySelectorAll('[class*="atom-' + atomIndex + '"]').forEach((node) => {
        const classes = [...node.classList].flatMap((name) => {
          const match = /^atom-(\d+)$/.exec(name); return match ? [Number(match[1])] : [];
        });
        let point = null;
        if (node instanceof SVGGeometryElement && classes.length >= 2) {
          const length = node.getTotalLength();
          point = classes.indexOf(atomIndex) === 0
            ? node.getPointAtLength(0) : node.getPointAtLength(length);
        } else if (node instanceof SVGGraphicsElement) {
          const box = node.getBBox(); point = { x:box.x + box.width / 2, y:box.y + box.height / 2 };
        }
        const matrix = node.getScreenCTM();
        if (point && matrix) {
          const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          if (classes.length >= 2) bondEndpoints.push(screen); else labelPoints.push(screen);
        }
      });
      const points = bondEndpoints.length ? bondEndpoints : labelPoints;
      return points.reduce((sum, point) => ({ x:sum.x + point.x / points.length,
        y:sum.y + point.y / points.length }), { x:0, y:0 });
    };
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
    clickDrawingNear({ x:box.x + box.width / 2, y:box.y + box.height / 2 });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const selected = await api.waitFor2DDepiction();
    check(selected.selectedAtoms.length === 1 && selected.selectedAtoms[0] === initial.atomIndices[2],
      'clicking empty space near a 2D atom selects the same atom in 3D', JSON.stringify(selected));

    const orientationSvg = document.querySelector('#structure-2d-drawing svg');
    const orientationBefore = initial.atomIndices.map((_, index) => atomScreenPoint(orientationSvg, index));
    await api.draw2DAtom(0, 'F');
    const orientationEdited = await api.waitFor2DDepiction();
    const orientationAfterSvg = document.querySelector('#structure-2d-drawing svg');
    const orientationAfter = initial.atomIndices.map((_, index) => atomScreenPoint(orientationAfterSvg, index));
    const orientationDisplacements = orientationBefore.map((point, index) =>
      Math.hypot(point.x - orientationAfter[index].x, point.y - orientationAfter[index].y));
    // Compare the unedited phenyl core after removing a common translation.
    // The floating panel itself can move when Build controls open, but the
    // molecule must not rotate or rescale under the user's pointer.
    const core = [3, 4, 5, 6, 7, 8];
    const centered = (points) => {
      const center = core.reduce((sum, index) => ({
        x:sum.x + points[index].x / core.length,
        y:sum.y + points[index].y / core.length,
      }), { x:0, y:0 });
      return core.map((index) => ({ x:points[index].x - center.x, y:points[index].y - center.y }));
    };
    const beforeCore = centered(orientationBefore), afterCore = centered(orientationAfter);
    const orientationRmsd = Math.sqrt(beforeCore.reduce((sum, point, index) => {
      const dx = point.x - afterCore[index].x, dy = point.y - afterCore[index].y;
      return sum + dx * dx + dy * dy;
    }, 0) / core.length);
    check(orientationEdited.alignedAtoms === initial.atomIndices.length && orientationRmsd < 8,
      'a chemistry edit preserves the screen orientation of retained 2D atoms',
      JSON.stringify({ orientationRmsd, depiction:orientationEdited,
        transform:orientationAfterSvg.querySelector(':scope > g')?.getAttribute('transform'),
        displacements:orientationDisplacements.sort((left, right) => left - right),
        before:orientationBefore, after:orientationAfter }));
    api.discardChemistryCurrent();
    await api.waitFor2DDepiction();

    api.load('CC(O)c1ccccc1');
    await api.waitFor2DDepiction();
    document.querySelector('[data-2d-tool="bond"]').click();
    const stableSvg = document.querySelector('#structure-2d-drawing svg');
    const stablePanel = document.querySelector('#structure-2d-panel');
    const repeatedCore = [3, 4, 5, 6, 7, 8];
    const coreRelativeToPanel = (svg) => {
      const panelBox = stablePanel.getBoundingClientRect();
      const points = repeatedCore.map((index) => atomScreenPoint(svg, index));
      return points.reduce((sum, point) => ({
        x:sum.x + (point.x - panelBox.x) / points.length,
        y:sum.y + (point.y - panelBox.y) / points.length,
      }), { x:0, y:0 });
    };
    const repeatedClickMeasurements = [{ click:0, selected:false,
      sameSvg:true, ...coreRelativeToPanel(stableSvg) }];
    for (let click = 1; click <= 8; click++) {
      const currentSvg = document.querySelector('#structure-2d-drawing svg');
      const atom = atomScreenPoint(currentSvg, 3);
      drawing.dispatchEvent(new MouseEvent('click', { bubbles:true,
        clientX:atom.x, clientY:atom.y }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      await api.waitFor2DDepiction();
      const afterClickSvg = document.querySelector('#structure-2d-drawing svg');
      repeatedClickMeasurements.push({ click, selected:click % 2 === 1,
        sameSvg:afterClickSvg === stableSvg,
        overlays:afterClickSvg.querySelectorAll('[data-molarium-selection]').length,
        ...coreRelativeToPanel(afterClickSvg) });
    }
    const repeatOrigin = repeatedClickMeasurements[0];
    const repeatedClickMaximumDrift = Math.max(...repeatedClickMeasurements.map((point) =>
      Math.hypot(point.x - repeatOrigin.x, point.y - repeatOrigin.y)));
    check(repeatedClickMeasurements.slice(1).every((point) => point.sameSvg)
      && repeatedClickMeasurements.slice(1).every((point) =>
        point.overlays === (point.selected ? 1 : 0))
      && repeatedClickMaximumDrift < 0.5,
    'repeated bond-tool select/cancel clicks reuse one SVG without cumulative panel-relative drift',
    JSON.stringify({ repeatedClickMaximumDrift, repeatedClickMeasurements }));

    const lsdSmiles = 'CCN(CC)C(=O)[C@H]1CN([C@@H]2CC3=CNC4=CC=CC(=C34)C2=C1)C';
    await api.loadSmilesWithRdkit(lsdSmiles, 'LSD repeated Atom edits');
    const lsdDepiction = await api.waitFor2DDepiction();
    document.querySelector('[data-2d-tool="atom"]').click();
    const originalHeavy = new Set(lsdDepiction.atomIndices);
    const originalMolecule = api.current().molecule;
    const coreNeighbors = new Map(lsdDepiction.atomIndices.map((index) => [index, new Set()]));
    originalMolecule.bonds.forEach((bond) => {
      if (!originalHeavy.has(bond.a) || !originalHeavy.has(bond.b)) return;
      coreNeighbors.get(bond.a).add(bond.b); coreNeighbors.get(bond.b).add(bond.a);
    });
    // The graph 2-core isolates LSD's retained fused-ring system without
    // depending on atom-number details from a particular RDKit build.
    const retainedCore = new Set(lsdDepiction.atomIndices);
    let peeled = true;
    while (peeled) {
      peeled = false;
      for (const index of [...retainedCore]) {
        const degree = [...coreNeighbors.get(index)].filter((neighbor) => retainedCore.has(neighbor)).length;
        if (degree < 2) { retainedCore.delete(index); peeled = true; }
      }
    }
    const retainedCoreIndices = [...retainedCore];
    const measureRetainedCore = (depiction) => {
      const panelBox = stablePanel.getBoundingClientRect();
      const svg = document.querySelector('#structure-2d-drawing svg');
      const positions = retainedCoreIndices.map((globalIndex) => {
        const localIndex = depiction.atomIndices.indexOf(globalIndex);
        const point = atomScreenPoint(svg, localIndex);
        return { globalIndex, x:point.x - panelBox.x, y:point.y - panelBox.y };
      });
      const centroid = positions.reduce((sum, point) => ({
        x:sum.x + point.x / positions.length, y:sum.y + point.y / positions.length,
      }), { x:0, y:0 });
      return { ...centroid, positions,
        transform:svg.querySelector(':scope > g')?.getAttribute('transform') || null };
    };
    const structuralRedrawMeasurements = [{ edit:0, pendingChanges:0,
      atomCount:lsdDepiction.atomIndices.length, ...measureRetainedCore(lsdDepiction) }];
    const attachmentTargets = lsdDepiction.atomIndices.filter((globalIndex) =>
      originalMolecule.atoms[globalIndex]?.element === 'C'
      && originalMolecule.bonds.some((bond) => {
        if (bond.a !== globalIndex && bond.b !== globalIndex) return false;
        const other = bond.a === globalIndex ? bond.b : bond.a;
        return originalMolecule.atoms[other]?.element === 'H';
      })).slice(0, 4);
    for (let edit = 1; edit <= 4; edit++) {
      const before = api.twoDDepiction();
      const beforeHeavy = new Set(before.atomIndices);
      const beforeSvg = document.querySelector('#structure-2d-drawing svg');
      const targetLocalIndex = before.atomIndices.indexOf(attachmentTargets[edit - 1]);
      const target = atomScreenPoint(beforeSvg, targetLocalIndex);
      drawing.dispatchEvent(new MouseEvent('click', { bubbles:true,
        clientX:target.x, clientY:target.y }));
      const started = performance.now();
      let after;
      while (performance.now() - started < 12000) {
        after = await api.waitFor2DDepiction();
        if (after.pendingChanges === edit && after.atomIndices.length === before.atomIndices.length + 1) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (after.pendingChanges !== edit || after.atomIndices.length !== before.atomIndices.length + 1)
        throw new Error('Atom edit ' + edit + ' did not complete: ' + JSON.stringify(after));
      const added = after.atomIndices.filter((globalIndex) => !beforeHeavy.has(globalIndex));
      structuralRedrawMeasurements.push({ edit, pendingChanges:after.pendingChanges,
        atomCount:after.atomIndices.length, added, ...measureRetainedCore(after) });
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    const structuralOrigin = structuralRedrawMeasurements[0];
    const structuralCentroidDrifts = structuralRedrawMeasurements.map((point) => ({
      edit:point.edit, dx:point.x - structuralOrigin.x, dy:point.y - structuralOrigin.y,
      distance:Math.hypot(point.x - structuralOrigin.x, point.y - structuralOrigin.y),
    }));
    const structuralCoreRmsds = structuralRedrawMeasurements.map((point) => ({
      edit:point.edit,
      rmsd:Math.sqrt(point.positions.reduce((sum, position, index) => {
        const origin = structuralOrigin.positions[index];
        return sum + (position.x - origin.x) ** 2 + (position.y - origin.y) ** 2;
      }, 0) / point.positions.length),
    }));
    const structuralMaximumCentroidDrift = Math.max(...structuralCentroidDrifts.map((entry) => entry.distance));
    check(retainedCoreIndices.length >= 10 && attachmentTargets.length === 4
      && structuralRedrawMeasurements.slice(1).every((entry, index) =>
        entry.pendingChanges === index + 1 && entry.added.length === 1)
      && structuralMaximumCentroidDrift < 1,
    'four sequential Atom-tool chemistry redraws keep the retained LSD ring core fixed relative to the panel',
    JSON.stringify({ retainedCoreIndices, structuralMaximumCentroidDrift,
      structuralCentroidDrifts, structuralCoreRmsds, structuralRedrawMeasurements }));
    api.discardChemistryCurrent();
    await api.waitFor2DDepiction();

    await api.loadSmilesWithRdkit(lsdSmiles, 'LSD indolic NH hit target');
    const nhBefore = await api.waitFor2DDepiction();
    const nhBeforeMolecule = api.current().molecule;
    const hydrogenBearingNitrogens = nhBefore.atomIndices.filter((globalIndex) =>
      nhBeforeMolecule.atoms[globalIndex]?.element === 'N'
      && nhBeforeMolecule.bonds.some((bond) => {
        if (bond.a !== globalIndex && bond.b !== globalIndex) return false;
        const other = bond.a === globalIndex ? bond.b : bond.a;
        return nhBeforeMolecule.atoms[other]?.element === 'H';
      }));
    const indolicNitrogenGlobalIndex = hydrogenBearingNitrogens[0];
    const indolicNitrogenLocalIndex = nhBefore.atomIndices.indexOf(indolicNitrogenGlobalIndex);
    const nhSvg = document.querySelector('#structure-2d-drawing svg');
    const nhLabelNodes = [...nhSvg.querySelectorAll('.atom-' + indolicNitrogenLocalIndex)]
      .filter((node) => [...node.classList].filter((name) => /^atom-\d+$/.test(name)).length === 1);
    const nhLabelBoxes = nhLabelNodes.map((node) => node.getBoundingClientRect())
      .filter((box) => box.width > 0 || box.height > 0);
    const nhLabelBounds = {
      left:Math.min(...nhLabelBoxes.map((box) => box.left)),
      right:Math.max(...nhLabelBoxes.map((box) => box.right)),
      top:Math.min(...nhLabelBoxes.map((box) => box.top)),
      bottom:Math.max(...nhLabelBoxes.map((box) => box.bottom)),
    };
    const nhLabelCenter = { x:(nhLabelBounds.left + nhLabelBounds.right) / 2,
      y:(nhLabelBounds.top + nhLabelBounds.bottom) / 2 };
    const nhHitCandidates = nhBefore.atomIndices.map((globalIndex, localIndex) => {
      const point = atomScreenPoint(nhSvg, localIndex);
      return { globalIndex, localIndex, element:nhBeforeMolecule.atoms[globalIndex]?.element,
        x:point.x, y:point.y,
        distance:Math.hypot(point.x - nhLabelCenter.x, point.y - nhLabelCenter.y) };
    }).sort((left, right) => left.distance - right.distance);
    const indolicCarbonNeighbors = nhBeforeMolecule.bonds.flatMap((bond) => {
      if (bond.a !== indolicNitrogenGlobalIndex && bond.b !== indolicNitrogenGlobalIndex) return [];
      const other = bond.a === indolicNitrogenGlobalIndex ? bond.b : bond.a;
      return nhBeforeMolecule.atoms[other]?.element === 'C' ? [other] : [];
    });
    const elementPickerForNh = document.querySelector('#structure-2d-element');
    elementPickerForNh.value = 'C';
    elementPickerForNh.dispatchEvent(new Event('change', { bubbles:true }));
    const nhBeforeHeavy = new Set(nhBefore.atomIndices);
    nhLabelNodes[0].dispatchEvent(new MouseEvent('click', { bubbles:true,
      clientX:nhLabelCenter.x, clientY:nhLabelCenter.y }));
    const nhEditStarted = performance.now();
    let nhAfter;
    while (performance.now() - nhEditStarted < 12000) {
      nhAfter = await api.waitFor2DDepiction();
      if (nhAfter.pendingChanges === 1 && nhAfter.atomIndices.length === nhBefore.atomIndices.length + 1) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const addedCarbonGlobalIndex = nhAfter.atomIndices.find((globalIndex) => !nhBeforeHeavy.has(globalIndex));
    const nhAfterMolecule = api.current().molecule;
    const actualHeavyAnchorGlobalIndex = nhAfterMolecule.bonds.flatMap((bond) => {
      if (bond.a !== addedCarbonGlobalIndex && bond.b !== addedCarbonGlobalIndex) return [];
      const other = bond.a === addedCarbonGlobalIndex ? bond.b : bond.a;
      return nhBeforeHeavy.has(other) ? [other] : [];
    })[0];
    const globalBondToIndolicNitrogen = nhAfterMolecule.bonds.some((bond) =>
      (bond.a === addedCarbonGlobalIndex && bond.b === indolicNitrogenGlobalIndex)
      || (bond.b === addedCarbonGlobalIndex && bond.a === indolicNitrogenGlobalIndex));
    const twoDBondToIndolicNitrogen = nhAfter.bondPairs.some((pair) =>
      pair.includes(addedCarbonGlobalIndex) && pair.includes(indolicNitrogenGlobalIndex));
    const bondedToNeighboringCarbon = indolicCarbonNeighbors.some((neighbor) =>
      nhAfterMolecule.bonds.some((bond) =>
        (bond.a === addedCarbonGlobalIndex && bond.b === neighbor)
        || (bond.b === addedCarbonGlobalIndex && bond.a === neighbor)));
    const nhLabelHit = { indolicNitrogenGlobalIndex, indolicNitrogenLocalIndex,
      indolicCarbonNeighbors, labelNodeCount:nhLabelNodes.length,
      labelBounds:nhLabelBounds, labelCenter:nhLabelCenter,
      inferredHit:nhHitCandidates[0], nearestCandidates:nhHitCandidates.slice(0, 4),
      addedCarbonGlobalIndex, actualHeavyAnchorGlobalIndex,
      globalBondToIndolicNitrogen, twoDBondToIndolicNitrogen, bondedToNeighboringCarbon };
    check(hydrogenBearingNitrogens.length === 1 && nhLabelNodes.length > 0
      && nhHitCandidates[0].globalIndex === indolicNitrogenGlobalIndex
      && globalBondToIndolicNitrogen && twoDBondToIndolicNitrogen && !bondedToNeighboringCarbon,
    'clicking the visible LSD indolic NH label attaches C to N in both 2D and global topology',
    JSON.stringify(nhLabelHit));
    api.discardChemistryCurrent();
    await api.waitFor2DDepiction();

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
    clickDrawingNear({ x:editableBox.x + editableBox.width / 2,
      y:editableBox.y + editableBox.height / 2 });
    const pointerEdited = await api.waitFor2DDepiction();
    check(pointerEdited.mode === 'build' && pointerEdited.tool === 'atom'
      && pointerEdited.atomIndices.length === 4 && pointerEdited.pendingChanges === 1,
    'the atom tool snaps to a nearby atom without an exact SVG click', JSON.stringify(pointerEdited));
    document.querySelector('#structure-2d-discard').click();
    const pointerRestored = await api.waitFor2DDepiction();
    check(pointerRestored.atomIndices.length === 3 && pointerRestored.pendingChanges === 0,
      'the inset Discard control restores the synchronized structure', JSON.stringify(pointerRestored));

    api.load('CC');
    await api.waitFor2DDepiction();
    const bondOrderPicker = document.querySelector('#structure-2d-bond-order');
    bondOrderPicker.value = '2';
    bondOrderPicker.dispatchEvent(new Event('change', { bubbles:true }));
    const bondSvg = document.querySelector('#structure-2d-drawing svg');
    const bondPath = bondSvg.querySelector('.bond-0');
    const localMidpoint = bondPath.getPointAtLength(bondPath.getTotalLength() / 2);
    const screenMidpoint = new DOMPoint(localMidpoint.x, localMidpoint.y)
      .matrixTransform(bondSvg.getScreenCTM());
    drawing.dispatchEvent(new MouseEvent('click', { bubbles:true,
      clientX:screenMidpoint.x, clientY:screenMidpoint.y + 10 }));
    const snappedBond = await api.waitFor2DDepiction();
    const snappedPair = snappedBond.atomIndices.slice(0, 2);
    const snappedOrder = api.current().molecule.bonds.find((bond) =>
      (bond.a === snappedPair[0] && bond.b === snappedPair[1])
      || (bond.a === snappedPair[1] && bond.b === snappedPair[0]))?.order;
    check(Number(snappedOrder) === 2 && snappedBond.pendingChanges === 1,
      'the bond tool snaps to a nearby bond without an exact SVG click', JSON.stringify(snappedBond));
    document.querySelector('#structure-2d-discard').click();
    await api.waitFor2DDepiction();

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
    return { passed:checks.length - failed.length, total:checks.length, failed,
      repeatedClickMaximumDrift, repeatedClickMeasurements,
      structuralMaximumCentroidDrift, structuralCentroidDrifts, structuralCoreRmsds,
      structuralRedrawMeasurements, nhLabelHit };
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
  console.log(`Repeated-click maximum panel-relative drift: ${result.repeatedClickMaximumDrift.toFixed(4)} px`);
  console.log(`Repeated-click measurements: ${JSON.stringify(result.repeatedClickMeasurements)}`);
  console.log(`Atom-edit maximum panel-relative centroid drift: ${result.structuralMaximumCentroidDrift.toFixed(4)} px`);
  console.log(`Atom-edit centroid drifts: ${JSON.stringify(result.structuralCentroidDrifts)}`);
  console.log(`Atom-edit core RMSDs: ${JSON.stringify(result.structuralCoreRmsds)}`);
  console.log(`LSD indolic NH label hit: ${JSON.stringify(result.nhLabelHit)}`);
} finally {
  client?.close(); chrome?.kill(); server?.kill(); await rm(profile, { recursive:true, force:true });
}
