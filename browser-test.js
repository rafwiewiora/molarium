import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Pick per-run ports so a second Molarium checkout/test process cannot steal the
// browser harness's fixed server or DevTools endpoint.
const portSeed = Math.floor(Math.random() * 1000);
const appPort = Number(Bun.env.MOLARIUM_TEST_PORT) || 54000 + portSeed;
const debugPort = Number(Bun.env.MOLARIUM_TEST_DEBUG_PORT) || 56000 + portSeed;
const externalAppUrl = Bun.env.MOLARIUM_TEST_URL;
const appUrl = externalAppUrl || `http://localhost:${appPort}/`;
const productionApiBoundary = Bun.env.MOLARIUM_TEST_SCOPE === 'chemist-actions-production-boundary';
const chromePath = Bun.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome');
const chromePlatformArgs = process.platform === 'linux'
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
const profile = await mkdtemp(join(tmpdir(), 'molarium-browser-test-'));
let server;
let chrome;
const preparationFixture = Bun.env.MOLARIUM_PREPARATION_PDB
  ? { pdb: await Bun.file(Bun.env.MOLARIUM_PREPARATION_PDB).text(),
    ccd: Bun.env.MOLARIUM_PREPARATION_CCD ? await Bun.file(Bun.env.MOLARIUM_PREPARATION_CCD).text() : null,
    ccdId: Bun.env.MOLARIUM_PREPARATION_CCD_ID || 'LIG',
    waterPolicy: Bun.env.MOLARIUM_PREPARATION_WATER_POLICY || 'exclude',
    parameterize: Bun.env.MOLARIUM_PREPARATION_PARAMETERIZE === '1' }
  : null;
const openmmPosePacketText = Bun.env.MOLARIUM_OPENMM_POSE_PACKET
  ? await Bun.file(Bun.env.MOLARIUM_OPENMM_POSE_PACKET).text() : null;
const openmmPosePacket = openmmPosePacketText ? JSON.parse(openmmPosePacketText) : null;
const openmmPosePacketSha256 = openmmPosePacketText
  ? createHash('sha256').update(openmmPosePacketText).digest('hex') : null;
const openmmPoseOptions = Bun.env.MOLARIUM_OPENMM_POSE_OPTIONS
  ? JSON.parse(Bun.env.MOLARIUM_OPENMM_POSE_OPTIONS)
  : { implicitSolvent:'vacuum', constraintMode:'none', nonbondedCutoffNm:0 };

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch { /* retry while processes start */ }
    await delay(100);
  }
  throw new Error('Timed out waiting for browser test dependency');
}

class DevToolsClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
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

const browserSuite = String.raw`(async () => {
  const externalPreparationFixture = ${JSON.stringify(preparationFixture)};
  const externalOpenmmPosePacket = ${JSON.stringify(openmmPosePacket)};
  const externalOpenmmPosePacketSha256 = ${JSON.stringify(openmmPosePacketSha256)};
  const externalOpenmmPoseOptions = ${JSON.stringify(openmmPoseOptions)};
  const captureDockingUi = ${JSON.stringify(Boolean(Bun.env.MOLARIUM_TEST_SCREENSHOT_DOCKING))};
  const exportStrainFixture = ${JSON.stringify(Boolean(Bun.env.MOLARIUM_EXPORT_STRAIN_FIXTURE))};
  const diagnoseLactamPose = ${JSON.stringify(Boolean(Bun.env.MOLARIUM_DIAGNOSE_7KPA_LACTAM))};
  const testScope = ${JSON.stringify(Bun.env.MOLARIUM_TEST_SCOPE || '')};
  const checks = [];
  let optimizationMetrics = null;
  let rdkitMetrics = null;
  let aniMetrics = null;
  let rosemaryMetrics = null;
  const webgpuMetrics = {
    maximumRelativeEnergyError: 0, absoluteEnergyError: 0, molecule: '',
    forceRelativeRms: null, forceRmsError: null, forceMaximumError: null,
    obcEnergyError: null, obcForceRelativeRms: null, obcForceRmsError: null,
  };
  const check = (condition, label, details = '') => {
    checks.push({ label, passed: Boolean(condition), details });
  };
  const compareForces = (candidate, reference) => {
    if (!Array.isArray(candidate) || !Array.isArray(reference) || candidate.length !== reference.length || !candidate.length)
      return null;
    let squaredError = 0, squaredReference = 0, maximumError = 0;
    for (let index = 0; index < reference.length; index++) {
      const difference = candidate[index] - reference[index];
      squaredError += difference * difference;
      squaredReference += reference[index] * reference[index];
      maximumError = Math.max(maximumError, Math.abs(difference));
    }
    const rmsError = Math.sqrt(squaredError / reference.length);
    const rmsReference = Math.sqrt(squaredReference / reference.length);
    return { rmsError, rmsReference, relativeRms: rmsError / Math.max(1e-12, rmsReference), maximumError };
  };
  if (testScope === 'chemist-actions-production-boundary') {
    const chemist = await window.MolariumChemistActionsReady;
    check(chemist === window.MolariumChemistActions
      && chemist.schema === 'molarium.chemist-actions/v1'
      && Object.isFrozen(chemist),
    'production exposes the frozen Chemist Actions API');
    check(!Object.hasOwn(window, 'molariumTest'),
      'production does not install the privileged regression harness');
    check(typeof window.captureCurrentDockingReference === 'undefined'
      && typeof window.runBrowserConstrainedDocking === 'undefined'
      && typeof window.applySelectedAtomChemistry === 'undefined',
    'module scope keeps internal modeling functions off window');
    return { passed:checks.filter((item) => item.passed).length,
      total:checks.length, failed:checks.filter((item) => !item.passed),
      optimizationMetrics, rdkitMetrics, aniMetrics, webgpuMetrics,
      rosemaryMetrics, preparationMetrics:null };
  }
  const api = window.molariumTest;
  check(Boolean(api), 'test API is available');
  if (testScope === 'openmm-worker-smoke') {
    api.load('CC');
    let energy = null;
    try { energy = await api.calculateCurrent('energy', 'openmm'); }
    catch (error) { check(false, 'a fresh browser worker initializes OpenMM WebAssembly', error.stack || error.message); }
    if (energy) check(Number.isFinite(energy.finalEnergy)
      && energy.forcefield === 'OpenFF Sage 2.1.0'
      && energy.platform === 'Reference',
    'a fresh browser worker initializes OpenMM WebAssembly', JSON.stringify(energy));
    const failed = checks.filter((item) => !item.passed);
    return { passed:checks.length - failed.length, total:checks.length, failed,
      optimizationMetrics, rdkitMetrics, aniMetrics, webgpuMetrics, rosemaryMetrics,
      preparationMetrics:null };
  }
  if (testScope === 'openmm-pose-packet') {
    check(externalOpenmmPosePacket?.schema === 'molarium.analogue-pose-panel/v1'
      && Array.isArray(externalOpenmmPosePacket.poses),
    'the OpenMM pose validation packet has the expected schema');
    const poseMetrics = [];
    for (const pose of externalOpenmmPosePacket.poses || []) {
      api.loadObject(pose.molecule);
      const validationOptions = externalOpenmmPoseOptions;
      const reference = await api.calculateCurrent('energy', 'openmm', validationOptions);
      const sage = await api.calculateCurrent('energy', 'webgpu', validationOptions);
      const force = compareForces(sage.forces, reference.forces);
      const absoluteEnergyDeltaKcalMol = Math.abs(sage.finalEnergy - reference.finalEnergy);
      const gate = { passed:absoluteEnergyDeltaKcalMol <= 1e-2
          && force?.relativeRms <= 1e-3,
        maximumAbsoluteEnergyDelta:1e-2, energyUnit:'kcal/mol',
        maximumForceRelativeRms:1e-3 };
      check(gate.passed, pose.id + ': Sage WebGPU matches OpenMM WASM',
        JSON.stringify({ absoluteEnergyDeltaKcalMol, force }));
      poseMetrics.push({ id:pose.id, atomCount:pose.molecule.atoms.length,
        openmmVersion:reference.openmmVersion, openmmPlatform:reference.platform,
        openmmWasmSha256:reference.openmmWasmSha256,
        numericSystemSha256:reference.numericSystemSha256,
        parameterizedSystemSha256:reference.parameterizedSystemSha256,
        inputPositionsJsonSha256:reference.inputPositionsJsonSha256,
        implicitSolvent:reference.implicitSolvent,
        constraintMode:reference.constraintMode,
        constraintCount:reference.constraintCount,
        cutoffNm:reference.cutoffNm,
        sagePlatform:sage.platform, sageSourceSha256:sage.sourceSha256,
        openmmPotentialEnergyKcalMol:reference.finalEnergy,
        sagePotentialEnergyKcalMol:sage.finalEnergy, absoluteEnergyDeltaKcalMol,
        forceRmsDelta:force?.rmsError ?? null,
        forceMaxAbsDelta:force?.maximumError ?? null,
        forceRelativeRms:force?.relativeRms ?? null, forceDeltaUnit:'kJ/mol/nm', gate });
    }
    const failed = checks.filter((item) => !item.passed);
    return { passed:checks.length - failed.length, total:checks.length, failed,
      openmmPoseMetrics:{ schema:'molarium.browser-sage-openmm-validation/v1',
        source:{ packetSha256:externalOpenmmPosePacketSha256,
          runtimeOptions:externalOpenmmPoseOptions },
        gate:{ passed:poseMetrics.every((entry) => entry.gate.passed),
          poseCount:poseMetrics.length }, poses:poseMetrics },
      optimizationMetrics, rdkitMetrics, aniMetrics, webgpuMetrics, rosemaryMetrics,
      preparationMetrics:null };
  }
  if (testScope === 'chemist-actions') {
    const chemist = await window.MolariumChemistActionsReady;
    check(chemist === window.MolariumChemistActions
      && chemist.schema === 'molarium.chemist-actions/v1'
      && Object.isFrozen(chemist),
    'the browser exposes one frozen, versioned Chemist Actions API');
    const described = chemist.describe();
    check(described.guarantee.includes('no arbitrary code')
      && described.actions['chemistry.finish']
      && !described.actions['test.loadObject'],
    'the public action manifest contains chemist routes and no fixture or internal-code route');
    api.load('CC');
    await chemist.execute({ requestId:'browser-mode', action:'view.setMode', args:{ mode:'build' } });
    await chemist.execute({ requestId:'browser-tool', action:'build.setTool', args:{ tool:'select' } });
    const initial = (await chemist.inspect({ scope:'ligand', maximumAtoms:20 })).result;
    const carbonIds = initial.atoms.filter((atom) => atom.element === 'C').map((atom) => atom.atomId);
    const carbonBond = initial.bonds.find((bond) => carbonIds.every((id) => bond.atomIds.includes(id)));
    check(carbonIds.length === 2 && carbonBond?.order === 1
      && initial.totalAtomCount === 8 && initial.atoms.every((atom) => atom.atomId),
    'agents inspect persistent identities and the chemist-visible molecular graph');
    await chemist.execute({ action:'selection.replace', args:{ atomIds:carbonIds } });
    const staged = await chemist.execute({ requestId:'browser-double-bond',
      action:'chemistry.setBond', args:{ order:2 } });
    check(staged.result.pendingChemistry?.editCount === 1,
      'a public bond edit enters the same pending-chemistry transaction as a UI edit');
    const finished = await chemist.execute({ requestId:'browser-finish', action:'chemistry.finish' });
    const ethene = (await chemist.inspect({ scope:'ligand', maximumAtoms:20 })).result;
    check(finished.result.validation?.valid && !ethene.pendingChemistry
      && ethene.totalAtomCount === 6
      && ethene.bonds.some((bond) => carbonIds.every((id) => bond.atomIds.includes(id))
        && bond.order === 2),
    'Finish chemistry reconciles and validates ethene through the public route');
    await chemist.execute({ action:'history.undo' });
    const undone = (await chemist.inspect({ scope:'ligand', maximumAtoms:20 })).result;
    check(undone.totalAtomCount === 8
      && undone.bonds.some((bond) => carbonIds.every((id) => bond.atomIds.includes(id))
        && bond.order === 1),
    'the public Undo route restores the committed chemical graph');
    const added = await chemist.execute({ action:'chemistry.addAtom',
      args:{ attachedToAtomId:carbonIds[0], element:'O' } });
    check(typeof added.result.addedAtomId === 'string'
      && added.result.addedAtomIds.includes(added.result.addedAtomId),
    'the public Add-atom route returns the new persistent identity');
    await chemist.execute({ action:'chemistry.finish' });
    const ethanol = (await chemist.inspect({ scope:'ligand', maximumAtoms:20 })).result;
    check(ethanol.atoms.some((atom) => atom.atomId === added.result.addedAtomId
      && atom.element === 'O')
      && ethanol.bonds.some((bond) => bond.atomIds.includes(carbonIds[0])
        && bond.atomIds.includes(added.result.addedAtomId)),
    'the public Add-atom route uses the same validated graph edit as the visible 2D Add tool');
    api.load('CCC');
    await chemist.execute({ action:'view.setMode', args:{ mode:'build' } });
    const propane = (await chemist.inspect({ scope:'ligand', maximumAtoms:20 })).result;
    const propaneCarbons = propane.atoms.filter((atom) => atom.element === 'C');
    const degrees = new Map(propaneCarbons.map((atom) => [atom.atomId,
      propane.bonds.filter((bond) => bond.atomIds.includes(atom.atomId)
        && bond.atomIds.some((id) => id !== atom.atomId
          && propaneCarbons.some((carbon) => carbon.atomId === id))).length]));
    const endpoints = [...degrees].filter(([, degree]) => degree === 1).map(([id]) => id);
    await chemist.execute({ action:'chemistry.createBond',
      args:{ atomIds:endpoints, order:1 } });
    await chemist.execute({ action:'chemistry.finish' });
    const cyclopropane = (await chemist.inspect({ scope:'ligand', maximumAtoms:20 })).result;
    check(endpoints.length === 2 && cyclopropane.bonds.some((bond) =>
      endpoints.every((id) => bond.atomIds.includes(id))),
    'the public Create-bond route closes a ring through the same validated 2D Bond operation');
    let rejected = '';
    try { await chemist.execute({ action:'internal.scorePose', args:{} }); }
    catch (error) { rejected = error.message; }
    check(rejected.includes('Unknown chemist action'),
      'the public API rejects arbitrary internal-function access');
    const history = chemist.history();
    check(history.some((record) => record.requestId === 'browser-double-bond'
      && record.action === 'chemistry.setBond' && record.status === 'completed')
      && history.every((record, index) => record.sequence === index + 1
        && record.startedAt && record.completedAt && Number.isFinite(record.durationMs)),
    'every accepted browser action has an ordered, timestamped audit record');
    const failed = checks.filter((item) => !item.passed);
    return { passed:checks.length - failed.length, total:checks.length, failed,
      optimizationMetrics, rdkitMetrics, aniMetrics, webgpuMetrics, rosemaryMetrics,
      preparationMetrics:null };
  }
  const headerDestinations = [...document.querySelectorAll('[data-project-panel]')]
    .map((link) => link.textContent.trim());
  check(headerDestinations.join('|') === 'Methods|Validation|Credits',
    'header exposes Molarium-specific methods, validation and credits destinations');
  const githubLink = document.querySelector('.app-header-links .github-link');
  check(githubLink?.href === 'https://github.com/rafwiewiora/molarium'
    && githubLink.target === '_blank'
    && githubLink.rel.split(/\s+/).includes('noopener')
    && githubLink.querySelector('svg'),
    'header exposes the public Molarium GitHub repository with an accessible icon link');
  check(document.querySelector('.app-brand-mark[data-molarium-mark]')?.tagName === 'svg'
    && document.querySelector('.app-brand-name')?.textContent === 'MOLARIUM'
    && document.querySelector('link[rel="icon"]')?.getAttribute('href') === './assets/molarium-mark.svg',
    'header inlines the original Molarium mark while the favicon uses the matching asset');
  check(document.querySelector('.calculation-loader svg[data-molarium-mark]')
    && !document.querySelector('.calculation-glyph'),
    'calculation overlay uses the branded Molarium loader instead of the legacy molecular glyph');
  const launchMol = await (await fetch('./assets/lsd-launch.mol')).text();
  check(launchMol.includes(' 49 52') && launchMol.includes('M  END'),
    'launch scene ships the authoritative 49-atom PubChem LSD conformer');
  document.querySelector('[data-project-panel="credits"]').click();
  check(document.querySelector('#project-info-dialog').open
    && !document.querySelector('[data-project-section="credits"]').classList.contains('hidden')
    && document.querySelector('[data-project-section="credits"]').textContent.includes('Interface design inspired by Atomiverse')
    && document.querySelector('[data-project-section="credits"]').textContent.includes('independently implemented'),
    'credits disclose visual inspiration without claiming a shared viewer implementation');
  check(document.querySelector('[data-project-section="credits"] a[href="./licenses/ONNXRUNTIME-1.27.0-THIRD-PARTY-NOTICES.txt"]'),
    'credits link the vendored ONNX Runtime 1.27 third-party notices');
  check(document.querySelector('[data-project-section="credits"] a[href="./licenses/DIMORPHITE-DL-NOTICE.txt"]'),
    'credits link the pinned Dimorphite-DL protonation-site notice');
  check(document.querySelector('[data-project-section="credits"] a[href="./LICENSE"]')
    && document.querySelector('[data-project-section="credits"]').textContent.includes('Molarium original code'),
    'credits expose Molarium\'s MIT license');
  check(document.querySelector('[data-project-section="credits"]').textContent.includes('OpenAI’s Sol')
    && document.querySelector('[data-project-section="credits"]').textContent.includes('scientific-reasoning assistance'),
    'credits acknowledge OpenAI Sol development assistance');
  document.querySelector('[data-project-panel="validation"]').click();
  const validationRoot = document.querySelector('#validation-dashboard');
  for (let attempt = 0; attempt < 50 && validationRoot.dataset.validationMounted !== 'true'; attempt++)
    await new Promise(resolve => setTimeout(resolve, 100));
  check(document.querySelector('#project-info-dialog').classList.contains('validation-open')
    && !document.querySelector('[data-project-section="validation"]').classList.contains('hidden'),
    'Validation opens the evidence-ledger dashboard');
  check(validationRoot.querySelector('[data-validation-count="reference-systems"]')?.textContent === '18'
    && validationRoot.querySelector('[data-validation-count="cases"]')?.textContent === '25'
    && validationRoot.querySelector('[data-validation-count="targets"]')?.textContent === '15'
    && validationRoot.querySelector('[data-validation-count="crystal-scored"]')?.textContent === '5',
    'validation dashboard separates reference systems, cases, targets and crystal-scored pairs');
  check(validationRoot.querySelectorAll('[data-validation-tier]').length === 25,
    'validation dashboard preserves all 25 registered case outcomes');
  check(validationRoot.textContent.includes('Registered · partial')
    && validationRoot.textContent.includes('do not add twenty independent protein systems'),
    'validation dashboard labels the 20-case single-system chemistry panel as partial');
  const registryResponse = await fetch('./validation/registry.v0.1.json');
  const registry = await registryResponse.json();
  check(registryResponse.ok && registry.schema === 'molarium.validation-registry/v1'
    && registry.cases.length === 25
    && Object.values(registry.artifacts).every(entry => /^[a-f0-9]{64}$/.test(entry.sha256)),
    'machine-readable validation registry exposes case records and source hashes');
  const sideCards = [...document.querySelectorAll('.panel > .card')];
  const generatedDisclosures = [...document.querySelectorAll('[data-generated-card-disclosure]')];
  check(sideCards.length === 13
    && sideCards.every((card) => card.querySelector(':scope > .card-heading.disclosure')),
    'every sidebar card in View, Build and Run has a collapse control', String(sideCards.length));
  check(generatedDisclosures.length === 8, 'all eight previously fixed-open sidebar cards are collapsible',
    String(generatedDisclosures.length));
  const generatedDisclosureRoundTrip = generatedDisclosures.every((toggle) => {
    const body = document.getElementById(toggle.getAttribute('aria-controls'));
    toggle.click();
    const closed = toggle.getAttribute('aria-expanded') === 'false' && body.classList.contains('hidden');
    toggle.click();
    return closed && toggle.getAttribute('aria-expanded') === 'true' && !body.classList.contains('hidden');
  });
  check(generatedDisclosureRoundTrip, 'generated sidebar arrows collapse and restore their own card bodies');
  const projectLicenseResponse = await fetch('./LICENSE');
  const projectLicenseText = await projectLicenseResponse.text();
  check(projectLicenseResponse.ok
    && projectLicenseResponse.headers.get('content-type')?.startsWith('text/plain')
    && projectLicenseText.startsWith('MIT License')
    && projectLicenseText.includes('Copyright (c) 2026 Molarium contributors'),
    'server publishes the complete Molarium MIT license as plain text');
  document.querySelector('#project-info-dialog').close();
  const rmsdReference = [0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3];
  const rmsdRigidTransform = [4, -2, 7, 4, -1, 7, 2, -2, 7, 4, -2, 10];
  check(api.fittedRmsd(rmsdReference, rmsdRigidTransform, [0, 1, 2, 3]) < 1e-6,
    'best-fit RMSD ignores rigid translation and rotation');
  const alignedRigidTransform = api.alignedPositions(
    rmsdReference, rmsdRigidTransform, [0, 1, 2, 3]);
  const alignedDirectRmsd = Math.sqrt(alignedRigidTransform.reduce((sum, value, index) =>
    sum + (value - rmsdReference[index]) ** 2, 0) / 4);
  check(alignedDirectRmsd < 1e-6,
    'rigid alignment returns coordinates in the reference frame', alignedDirectRmsd.toExponential(3));
  check(Boolean(document.querySelector('#try-rosemary-protein'))
    && Boolean(document.querySelector('#try-ubiquitin-protein')),
    'prepared Trp-cage and ubiquitin examples are available in the load panel');

  const alanineDipeptidePdb = [
    'HEADER    MOLARIUM PDB PREPARATION TEST                  17-AUG-26   9MRC',
    'HELIX    1 AA1 ALA A    1  ALA A    2  1                                   2',
    'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 20.00           N  ',
    'ATOM      2  CA  ALA A   1       1.458   0.000   0.000  1.00 20.00           C  ',
    'ATOM      3  C   ALA A   1       1.958   1.410   0.000  1.00 20.00           C  ',
    'ATOM      4  O   ALA A   1       1.220   2.370   0.000  1.00 20.00           O  ',
    'ATOM      5  CB  ALA A   1       1.990  -0.775  -1.200  1.00 20.00           C  ',
    'ATOM      6  N   ALA A   2       3.254   1.540   0.100  1.00 20.00           N  ',
    'ATOM      7  CA  ALA A   2       3.880   2.850   0.100  1.00 20.00           C  ',
    'ATOM      8  C   ALA A   2       5.370   2.700   0.000  1.00 20.00           C  ',
    'ATOM      9  O   ALA A   2       6.000   1.650  -0.100  1.00 20.00           O  ',
    'ATOM     10  OXT ALA A   2       5.950   3.850   0.100  1.00 20.00           O  ',
    'ATOM     11  CB  ALA A   2       3.360   3.650  -1.150  1.00 20.00           C  ',
    'HETATM   12  O   HOH A 101      12.000  12.000  12.000  1.00 20.00           O  ',
    'TER', 'END',
  ].join('\n');
  const parsedPdb = api.parsePdb(alanineDipeptidePdb);
  check(parsedPdb.atoms === 12 && parsedPdb.bonds === 10 && parsedPdb.components === 2,
    'PDB parser builds standard-residue and peptide topology without distance-guess bonds', JSON.stringify(parsedPdb));
  check(parsedPdb.source.pdbId === '9MRC' && parsedPdb.source.residues === 2
    && parsedPdb.preparation.waterAtoms === 1
    && parsedPdb.source.secondaryStructure.helices.length === 1,
    'PDB parser preserves identifier and residue metadata', JSON.stringify(parsedPdb.source));
  check(parsedPdb.preparation.canAddHydrogens && parsedPdb.preparation.missingHeavyAtoms.length === 0,
    'complete standard-residue PDB is eligible for conservative hydrogen preparation');
  api.loadPdb(alanineDipeptidePdb);
  const alanineComponents = api.structureComponents();
  check(alanineComponents.components.length === 2
    && alanineComponents.components.some((component) => component.kind === 'protein' && component.visible)
    && alanineComponents.components.some((component) => component.kind === 'water' && !component.visible)
    && !document.querySelector('#structure-components').classList.contains('hidden'),
    'PDB component module separates protein from hidden-by-default crystallographic water',
    JSON.stringify(alanineComponents));
  const componentRows = [...document.querySelectorAll('.component-row')];
  const proteinRow = componentRows.find((row) => row.querySelector('strong')?.textContent.includes('Protein'));
  const waterRow = componentRows.find((row) => row.querySelector('strong')?.textContent.includes('water'));
  waterRow?.querySelector('[data-component-action="zoom"]')?.click();
  const waterZoom = api.structureComponents();
  const waterCamera = api.viewerState();
  const waterAtom = api.current().molecule.atoms.find((atom) => atom.residueName === 'HOH');
  check(componentRows.length === 2
    && componentRows.every((row) => row.querySelectorAll('[data-component-action]').length === 2)
    && waterZoom.components.every((component) => component.visible)
    && waterZoom.focusedComponentId === waterZoom.components.find((component) => component.kind === 'water')?.id
    && waterAtom && waterCamera.center && Math.hypot(waterCamera.center.x - waterAtom.x,
      waterCamera.center.y - waterAtom.y, waterCamera.center.z - waterAtom.z) < 1e-6,
  'component Zoom frames the selection without hiding the rest of the structure',
  JSON.stringify({ components:waterZoom, camera:waterCamera.center, atom:waterAtom }));
  proteinRow?.querySelector('[data-component-action="only"]')?.click();
  const proteinOnly = api.structureComponents();
  check(proteinOnly.components.find((component) => component.kind === 'protein')?.visible
    && !proteinOnly.components.find((component) => component.kind === 'water')?.visible,
  'component Only isolates the selection as a separate explicit action', JSON.stringify(proteinOnly));
  document.querySelector('#components-reset').click();
  check(document.querySelector('#hydrogen-toggle').disabled
    && document.querySelector('#hydrogen-toggle-text').textContent.includes('none loaded')
    && document.querySelector('#interaction-toggle-text').textContent.includes('no H loaded'),
    'raw hydrogen-free PDBs make the unavailable hydrogen and H-bond state explicit');
  const hydrogenatedPdb = api.addPdbHydrogens();
  check(hydrogenatedPdb.atoms === 24 && hydrogenatedPdb.bonds === 22
    && hydrogenatedPdb.preparation.hydrogensAdded === 12,
    'PDB preparation adds deterministic standard-residue hydrogens and explicit bonds', JSON.stringify(hydrogenatedPdb));
  check(hydrogenatedPdb.charge === 0 && hydrogenatedPdb.components === 2,
    'PDB preparation applies neutral zwitterionic terminal charge bookkeeping', JSON.stringify(hydrogenatedPdb));
  const modeBeforePreparation = document.querySelector('.mode-bar button.active')?.dataset.mode;
  let preparedPdb = null;
  try { preparedPdb = await api.prepareCurrentPdb(); }
  catch (error) { check(false, 'prepared PDB removes crystallographic water and reaches numeric force-field parameterization', error.message); }
  if (preparedPdb) {
    check(preparedPdb.atoms === 23 && preparedPdb.forcefield === 'OpenFF Sage 2.1.0'
      && preparedPdb.parameterCounts?.bonds === 22,
      'prepared PDB removes crystallographic water and reaches numeric force-field parameterization', JSON.stringify(preparedPdb));
    const appliedPreparedMolecule = api.current().molecule;
    const appliedWithCoordinateOmission = structuredClone(appliedPreparedMolecule);
    appliedWithCoordinateOmission.atoms.forEach((atom) => {
      if (atom.residueIndex === 2) atom.residueIndex = 3;
    });
    appliedWithCoordinateOmission.source.missingResidues = [{
      residueName:'ALA', chain:'A', residueIndex:2, insertionCode:'', reason:'test-coordinate-omission',
    }];
    api.loadObject(appliedWithCoordinateOmission);
    check(document.querySelector('#preparation-issue-badge').textContent === 'Ready'
      && document.querySelector('#preparation-guidance').textContent.includes('numeric System was built')
      && document.querySelector('#preparation-issues').textContent.includes('accepted omission'),
    'an applied preparation audit remains authoritative when the source PDB declared omitted coordinates',
    document.querySelector('#preparation-inspector').textContent);
    api.loadObject(appliedPreparedMolecule);
    let pdbEnergy = null;
    try { pdbEnergy = await api.calculateCurrent('energy', 'openmm'); }
    catch (error) { check(false, 'prepared PDB executes an OpenMM Reference single point', error.message); }
    if (pdbEnergy) check(Number.isFinite(pdbEnergy.finalEnergy) && pdbEnergy.forcefield === 'OpenFF Sage 2.1.0',
      'prepared PDB executes an OpenMM Reference single point', JSON.stringify(pdbEnergy));
    let pdbMinimization = null;
    try { pdbMinimization = await api.calculateCurrent('geometry', 'openmm'); }
    catch (error) { check(false, 'prepared PDB executes an OpenMM Reference minimization', error.message); }
    if (pdbMinimization) check(Number.isFinite(pdbMinimization.finalEnergy)
      && pdbMinimization.finalEnergy < pdbMinimization.initialEnergy,
      'prepared PDB executes an OpenMM Reference minimization', JSON.stringify(pdbMinimization));
  }
  check(Boolean(document.querySelector('#pdb-preparation.ready'))
    && document.querySelector('#prepare-pdb').textContent === 'Prepared'
    && document.querySelector('#pdb-preparation-badge').textContent === 'Prepared'
    && document.querySelector('#preparation-inspector-body').classList.contains('hidden')
    && document.querySelector('.mode-bar button.active')?.dataset.mode === modeBeforePreparation,
    'successful one-action preparation keeps the current mode and leaves its optional report collapsed');
  const ubiquitinPdb = await (await fetch('./openff/ubiquitin-1ubq.pdb')).text();
  const importedUbiquitin = api.parsePdb(ubiquitinPdb);
  check(importedUbiquitin.atoms === 660 && importedUbiquitin.source.pdbId === '1UBQ'
    && importedUbiquitin.source.residues === 76 && importedUbiquitin.preparation.waterAtoms === 58,
    'PDB parser accepts a real RCSB ubiquitin file and identifies crystallographic waters',
    JSON.stringify({ atoms: importedUbiquitin.atoms, source: importedUbiquitin.source,
      preparation: importedUbiquitin.preparation }));
  check(importedUbiquitin.preparation.canAddHydrogens
    && importedUbiquitin.preparation.missingHeavyAtoms.length === 0
    && importedUbiquitin.components === 59,
    'real 1UBQ topology is one protein component plus 58 explicit waters',
    JSON.stringify({ components: importedUbiquitin.components, preparation: importedUbiquitin.preparation }));
  api.loadPdb(ubiquitinPdb);
  const hydrogenatedUbiquitin = api.addPdbHydrogens();
  check(hydrogenatedUbiquitin.atoms === 1289
    && hydrogenatedUbiquitin.preparation.hydrogensAdded === 629
    && hydrogenatedUbiquitin.components === 59,
    'real 1UBQ receives a complete deterministic standard-residue hydrogen layer',
    JSON.stringify(hydrogenatedUbiquitin));
  let preparedUbiquitin = null;
  try { preparedUbiquitin = await api.prepareCurrentPdb(); }
  catch (error) { check(false, 'real 1UBQ reaches an in-browser numeric System', error.message); }
  if (preparedUbiquitin) {
    const ubiquitinWaterAction = preparedUbiquitin.audit.actions.find((action) =>
      action.action === 'retain-crucial-crystallographic-water');
    check(preparedUbiquitin.atoms === 1285
    && preparedUbiquitin.hydrogensAdded === 629
    && preparedUbiquitin.forcefield === 'OpenFF Sage 2.1.0'
    && preparedUbiquitin.parameterCounts?.particles === 1285
    && ubiquitinWaterAction?.watersExamined === 58
    && ubiquitinWaterAction?.watersRetained === 18
    && ubiquitinWaterAction?.hydrogensAdded === 36,
    'real 1UBQ reaches a numeric System with its screened structural waters retained',
    JSON.stringify(preparedUbiquitin));
  }
  if (preparedUbiquitin) {
    let ubiquitinEnergy = null;
    try { ubiquitinEnergy = await api.calculateCurrent('energy', 'openmm'); }
    catch (error) { check(false, 'newly prepared 1UBQ System executes in OpenMM Reference', error.message); }
    if (ubiquitinEnergy) check(Number.isFinite(ubiquitinEnergy.finalEnergy)
      && ubiquitinEnergy.forcefield === 'OpenFF Sage 2.1.0',
      'newly prepared 1UBQ System executes in OpenMM Reference', JSON.stringify(ubiquitinEnergy));
  }
  const pocketInteractionPdb = [
    'ATOM      1  N   SER A   1      -2.000   0.000   0.000  1.00 20.00           N  ',
    'ATOM      2  CA  SER A   1      -1.000   0.000   0.000  1.00 20.00           C  ',
    'ATOM      3  C   SER A   1      -1.000   1.400   0.000  1.00 20.00           C  ',
    'ATOM      4  O   SER A   1      -1.000   2.500   0.000  1.00 20.00           O  ',
    'ATOM      5  CB  SER A   1       0.000   0.000   0.000  1.00 20.00           C  ',
    'ATOM      6  OG  SER A   1       1.000   0.000   0.000  1.00 20.00           O  ',
    'ATOM      7  HG  SER A   1       1.960   0.000   0.000  1.00 20.00           H  ',
    'ATOM      8  N   ALA A  20      20.000   0.000   0.000  1.00 20.00           N  ',
    'ATOM      9  CA  ALA A  20      21.458   0.000   0.000  1.00 20.00           C  ',
    'ATOM     10  C   ALA A  20      21.958   1.410   0.000  1.00 20.00           C  ',
    'ATOM     11  O   ALA A  20      21.220   2.370   0.000  1.00 20.00           O  ',
    'ATOM     12  CB  ALA A  20      21.990  -0.775  -1.200  1.00 20.00           C  ',
    'HETATM   13  O1  LIG B 101       3.700   0.000   0.000  1.00 20.00           O  ',
    'HETATM   14  C1  LIG B 101       5.100   0.000   0.000  1.00 20.00           C  ',
    'CONECT   13   14', 'CONECT   14   13', 'END',
  ].join('\n');
  api.loadPdb(pocketInteractionPdb);
  api.setRepresentation('cartoon');
  const pocketView = api.pocketDiagnostics();
  check(pocketView.radius === 5 && pocketView.ligandAtomCount === 2
    && JSON.stringify(pocketView.residueKeys) === JSON.stringify(['A:1:'])
    && pocketView.pocketAtomCount === 7 && pocketView.renderedChemistryAtomCount === 9,
  'protein-ligand cartoon expands complete 5 Å pocket residues but not distant residues',
  JSON.stringify(pocketView));
  check(pocketView.hydrogenBonds.length === 1
    && pocketView.hydrogenBonds[0].distance > 1.2 && pocketView.hydrogenBonds[0].distance < 2.6
    && !document.querySelector('#pocket-toggle-label').classList.contains('hidden')
    && document.querySelector('#pocket-toggle').checked,
  'cartoon pocket keeps explicit protein hydrogens in the H-bond chemistry selection',
  JSON.stringify(pocketView.hydrogenBonds));
  check(api.atomStyle(4).base === '#4f79a7' && api.atomStyle(13).base === '#d97745',
    'pocket protein carbons inherit their chain color while ligand carbons use the ligand accent',
    JSON.stringify({ protein:api.atomStyle(4), ligand:api.atomStyle(13) }));
  document.querySelector('#interaction-toggle').click();
  check(!api.renderDiagnostics().showInteractions, 'H-bond and pi-stack display option switches overlays off');
  document.querySelector('#interaction-toggle').click();
  check(api.renderDiagnostics().showInteractions && document.querySelector('#interaction-toggle').checked,
    'H-bond and pi-stack display option switches overlays back on');
  const contactOnlyPocket = api.setPocketAtomMode('contacts');
  check(contactOnlyPocket.mode === 'contacts' && contactOnlyPocket.residueKeys.length === 1
    && document.querySelector('#pocket-mode-toggle').textContent === 'Contacts'
    && document.querySelector('#pocket-mode-toggle').getAttribute('aria-pressed') === 'true',
  'compact pocket mode retains only residues making displayed ligand contacts',
  JSON.stringify(contactOnlyPocket));
  api.setPocketAtomMode('radius');
  const coordinatesBeforePan = api.current().molecule.atoms.map((atom) => [atom.x, atom.y, atom.z]);
  const screenBeforePan = new Map(api.viewerState().atoms.map((atom) => [atom.index, atom]));
  const pan = api.panViewer(24, -12);
  const screenAfterPan = new Map(api.viewerState().atoms.map((atom) => [atom.index, atom]));
  const coordinatesAfterPan = api.current().molecule.atoms.map((atom) => [atom.x, atom.y, atom.z]);
  const shiftedTogether = [0, 12, 13].every((index) =>
    Math.abs(screenAfterPan.get(index).sx - screenBeforePan.get(index).sx - 24) < 1e-6
      && Math.abs(screenAfterPan.get(index).sy - screenBeforePan.get(index).sy + 12) < 1e-6);
  check(pan.x === 24 && pan.y === -12 && shiftedTogether
    && JSON.stringify(coordinatesAfterPan) === JSON.stringify(coordinatesBeforePan)
    && !document.querySelector('.canvas-help'),
  'Mol*-style camera pan moves the entire projected scene without changing molecular coordinates',
  JSON.stringify({ pan, shiftedTogether }));
  api.panViewer(-24, 12);
  const ligandOnlyView = api.setPocketAtoms(false);
  check(ligandOnlyView.residueKeys.length === 0 && ligandOnlyView.renderedChemistryAtomCount === 2
    && ligandOnlyView.hydrogenBonds.length === 0,
  'pocket toggle collapses cartoon atom detail back to the ligand only', JSON.stringify(ligandOnlyView));
  api.setPocketAtoms(true);
  const dockingFixture = {
    name:'Molarium ConstraintDock browser fixture', smiles:'protein + flexible analogue', charge:0, multiplicity:1,
    atoms:[
      { element:'N', x:-2, y:0, z:0, record:'ATOM', atomName:'NZ', residueName:'LYS', chain:'A', residueIndex:1 },
      { element:'H', x:-1, y:0, z:0, record:'ATOM', atomName:'HZ1', residueName:'LYS', chain:'A', residueIndex:1 },
      { element:'O', x:0.8, y:0, z:0, record:'HETATM', atomName:'O1', residueName:'DME', chain:'B', residueIndex:2 },
      { element:'C', x:1.8, y:0, z:0, record:'HETATM', atomName:'C1', residueName:'DME', chain:'B', residueIndex:2 },
      { element:'C', x:2.8, y:0.8, z:0, record:'HETATM', atomName:'C2', residueName:'DME', chain:'B', residueIndex:2 },
      { element:'C', x:2.8, y:-0.8, z:0, record:'HETATM', atomName:'C3', residueName:'DME', chain:'B', residueIndex:2 },
      { element:'C', x:3.8, y:0.8, z:0, record:'HETATM', atomName:'C4', residueName:'DME', chain:'B', residueIndex:2 },
      { element:'F', x:4.8, y:0.8, z:0, record:'HETATM', atomName:'F1', residueName:'DME', chain:'B', residueIndex:2 },
    ],
    bonds:[{ a:0, b:1, order:1 }, { a:2, b:3, order:2 },
      { a:3, b:4, order:1 }, { a:4, b:5, order:1 }, { a:5, b:3, order:1 },
      { a:4, b:6, order:1 }, { a:6, b:7, order:1 }],
    parameterization:{ forcefield:'OpenFF Sage 2.1.0 browser-test fixture', chargeModel:'test charges',
      sourceSha256:'browser-test', system:{
        particles:[14, 1, 16, 12, 12, 12, 12, 19].map((mass_amu, index) => ({ index, mass_amu })),
        constraints:[], bonds:[], angles:[], torsions:[], exceptions:[],
        nonbonded:[
          { index:0, charge_e:0.3, sigma_nm:0.325, epsilon_kj:0.7 },
          { index:1, charge_e:0.1, sigma_nm:0.1, epsilon_kj:0.05 },
          { index:2, charge_e:-0.3, sigma_nm:0.296, epsilon_kj:0.8 },
          { index:3, charge_e:-0.05, sigma_nm:0.34, epsilon_kj:0.4 },
          { index:4, charge_e:-0.05, sigma_nm:0.34, epsilon_kj:0.4 },
          { index:5, charge_e:-0.05, sigma_nm:0.34, epsilon_kj:0.4 },
          { index:6, charge_e:0.1, sigma_nm:0.34, epsilon_kj:0.4 },
          { index:7, charge_e:-0.1, sigma_nm:0.30, epsilon_kj:0.2 },
        ],
      } },
  };
  const valenceCompleteDockingFixture = structuredClone(dockingFixture);
  [
    { parent:4, x:2.8, y:1.8, z:0 },
    { parent:5, x:2.8, y:-1.8, z:.8 },
    { parent:5, x:2.8, y:-1.8, z:-.8 },
    { parent:6, x:3.8, y:1.6, z:.8 },
    { parent:6, x:3.8, y:1.6, z:-.8 },
  ].forEach((entry, ordinal) => {
    const index = valenceCompleteDockingFixture.atoms.length;
    valenceCompleteDockingFixture.atoms.push({ element:'H', x:entry.x, y:entry.y, z:entry.z,
      record:'HETATM', atomName:'H' + (ordinal + 1), residueName:'DME', chain:'B', residueIndex:2 });
    valenceCompleteDockingFixture.bonds.push({ a:entry.parent, b:index, order:1 });
    valenceCompleteDockingFixture.parameterization.system.particles.push({ index, mass_amu:1 });
    valenceCompleteDockingFixture.parameterization.system.nonbonded.push({ index, charge_e:0,
      sigma_nm:0.1, epsilon_kj:0.05 });
  });
  api.loadObject(dockingFixture);
  document.querySelector('.mode-bar button[data-mode="build"]').click();
  api.setDockingMode('selected-core');
  const dockingSelection = api.setDockingSelection([3, 4, 5]);
  const buildToolLayout = [...document.querySelectorAll('#build-tool-tabs .build-tool-choice')].map((choice) => {
    const button = choice.querySelector('[data-tool]');
    const info = choice.querySelector('.build-tool-info');
    const buttonRect = button.getBoundingClientRect();
    const infoRect = info.getBoundingClientRect();
    return {
      label:button.textContent.trim(), height:buttonRect.height,
      infoPosition:getComputedStyle(info).position,
      infoInsideButton:infoRect.top >= buttonRect.top - 0.5 && infoRect.bottom <= buttonRect.bottom + 0.5,
    };
  });
  check(!document.querySelector('#docking-workbench').classList.contains('hidden')
    && dockingSelection.captureDisabled === false
    && dockingSelection.status.includes('3 core atoms')
    && document.querySelector('#docking-workbench').previousElementSibling?.id === 'build-tool-tabs'
    && document.querySelectorAll('#build-tool-tabs [data-tool]').length === 3
    && document.querySelectorAll('#build-tool-tabs .build-tool-info [aria-describedby]').length === 3
    && buildToolLayout.every((entry) => entry.infoPosition === 'absolute' && entry.infoInsideButton)
    && Math.max(...buildToolLayout.map((entry) => entry.height))
      - Math.min(...buildToolLayout.map((entry) => entry.height)) < 0.5
    && document.querySelector('#build-right-panel > .generated-card-heading span')?.textContent === 'Design workspace',
  'prepared protein-ligand complexes expose a compact core-constrained docking setup',
  JSON.stringify({ dockingSelection, buildToolLayout }));
  let dockingReference = null;
  try { dockingReference = await api.captureDockingReference(); }
  catch (error) { check(false, 'browser captures the ligand core and explicit cross H-bond', error.message); }
  if (dockingReference) check(dockingReference.coreAtomIds.length === 3
    && dockingReference.ligandAtomCount === 6
    && dockingReference.receptorAtomCount === 2
    && dockingReference.hydrogenBonds.length === 1
    && dockingReference.hydrogenBonds[0].receptorRole === 'donor',
  'browser captures the ligand core and explicit cross H-bond', JSON.stringify(dockingReference));
  const editedDockingLigand = api.addElementCurrent('F', 6);
  check(editedDockingLigand.atoms === 9 && !api.current().molecule.parameterization
    && document.querySelector('#docking-status').textContent.includes('3 core atoms'),
  'an in-browser ligand edit invalidates stale complex parameters but preserves the docking reference',
  JSON.stringify(editedDockingLigand));
  let dockingRun = null;
  try { dockingRun = await api.runConstrainedDocking({ conformerCount:4, seed:20260819, torsionSteps:32 }); }
  catch (error) { check(false, 'browser completes deterministic constrained docking with a verified labbook', error.message); }
  if (dockingRun) {
    const dockingLabbook = api.dockingLabbook();
    const validationSystem = api.dockingValidationNumericSystem();
    check(dockingRun.candidates >= 1 && dockingRun.feasible >= 1
      && dockingRun.selected.feasible && Number.isFinite(dockingRun.selected.scoreKcalMol)
      && dockingRun.selected.coreRmsdAngstrom < 1e-12
      && dockingRun.selected.refinement.rotatableBondCount >= 1
      && dockingRun.selected.refinement.proposals === 32
      && dockingRun.labbook.valid && dockingRun.coordinatePayloadIncluded === false
      && !JSON.stringify(dockingLabbook).includes('"positions"')
      && dockingLabbook.inputs.ligand.atoms === 7
      && dockingLabbook.events.some((event) => event.stage === 'method-decision')
      && dockingLabbook.events.some((event) => event.stage === 'in-pocket-torsion-search')
      && dockingLabbook.events.findIndex((event) => event.stage === 'in-pocket-torsion-search')
        < dockingLabbook.events.findIndex((event) => event.stage === 'constraint-audit-and-ranking')
      && validationSystem.atomIds.length === 7
      && validationSystem.system.particles.length === 7
      && validationSystem.system.nonbonded.length === 7
      && validationSystem.forcefield.includes('Sage')
      && /^[a-f0-9]{64}$/.test(validationSystem.sourceSha256)
      && document.querySelectorAll('.docking-pose').length >= 1
      && document.querySelector('#docking-score-note').textContent.includes('not') === false,
    'browser completes deterministic constrained docking with a verified coordinate-free audit',
    JSON.stringify(dockingRun));
    const dockingReplay = await api.runConstrainedDocking({ conformerCount:4, seed:20260819, torsionSteps:32 });
    check(dockingReplay.selectedCoordinatesSha256 === dockingRun.selectedCoordinatesSha256
      && Math.abs(dockingReplay.selected.scoreKcalMol - dockingRun.selected.scoreKcalMol) < 1e-12,
    'same docking seed reproduces the selected coordinates and score bit for bit',
    JSON.stringify({ first:dockingRun.selectedCoordinatesSha256,
      replay:dockingReplay.selectedCoordinatesSha256,
      scoreDifference:dockingReplay.selected.scoreKcalMol - dockingRun.selected.scoreKcalMol }));
    const proteinBeforeDockingApply = api.current().molecule.atoms.slice(0, 2)
      .map((atom) => [atom.x, atom.y, atom.z]);
    const appliedDocking = await api.applyDockingPose(0);
    const proteinAfterDockingApply = appliedDocking.molecule.atoms.slice(0, 2)
      .map((atom) => [atom.x, atom.y, atom.z]);
    check(JSON.stringify(proteinBeforeDockingApply) === JSON.stringify(proteinAfterDockingApply)
      && appliedDocking.molecule.source.docking.protocol === 'molarium-constraint-dock-1',
    'applying a docking pose moves only the mapped ligand and records protocol provenance');
  }
  api.loadObject(dockingFixture);
  document.querySelector('.mode-bar button[data-mode="build"]').click();
  api.setDockingMode('selected-core');
  api.setDockingSelection([3, 4, 5]);
  await api.captureDockingReference();
  await api.deleteAtomCurrent(2);
  const unavailableContact = document.querySelector('#docking-hbond-list label.unavailable');
  check(unavailableContact?.textContent.includes('atom removed')
    && unavailableContact.querySelector('input')?.disabled
    && !unavailableContact.querySelector('input')?.checked,
  'a captured contact whose ligand atom was deleted is disabled without unsafe remapping',
  unavailableContact?.textContent || 'missing unavailable contact');
  let omittedContactRun = null;
  try { omittedContactRun = await api.runConstrainedDocking({ conformerCount:2, seed:91, torsionSteps:8 }); }
  catch (error) { check(false, 'docking continues after an unavailable contact is explicitly omitted', error.message); }
  if (omittedContactRun) {
    const omittedLabbook = api.dockingLabbook();
    check(omittedContactRun.candidates >= 1
      && omittedLabbook.selections.omittedHydrogenBonds?.[0]?.reason === 'ligand-atom-removed'
      && omittedLabbook.outcome.omittedHydrogenBonds?.[0]?.reason === 'ligand-atom-removed',
    'unavailable reference contacts are recorded in the coordinate-free labbook',
    JSON.stringify(omittedLabbook.selections.omittedHydrogenBonds));
  }
  api.loadObject(dockingFixture);
  document.querySelector('.mode-bar button[data-mode="build"]').click();
  const propagationSetup = api.setDockingMode('propagate');
  check(propagationSetup.captureDisabled === false
    && propagationSetup.status.includes('Capture this ligand pose'),
  'reference-pose propagation requires no manual core selection', JSON.stringify(propagationSetup));
  const propagationReference = await api.captureDockingReference();
  const cleanupDefault = api.setDockingEditCleanup('preserve-reference');
  api.addElementCurrent('F', 6);
  check(propagationReference.mode === 'pose-propagation'
    && propagationReference.coreAtomIds.length === 6
    && cleanupDefault.visible && cleanupDefault.mode === 'preserve-reference'
    && document.querySelector('#docking-status').textContent.includes('6 unchanged atoms fixed'),
  'recorded edits automatically inherit every surviving reference heavy atom',
  JSON.stringify(propagationReference));
  let propagationRun = null;
  try { propagationRun = await api.runConstrainedDocking({ conformerCount:2, seed:20260819,
    torsionSteps:4, fixedRelaxIterations:4 }); }
  catch (error) { check(false, 'browser propagates and relaxes an edit-derived pose', error.message); }
  if (propagationRun) {
    const propagationLabbook = api.dockingLabbook();
    check(propagationRun.mode === 'pose-propagation'
      && propagationRun.selected.coreRmsdAngstrom < 1e-12
      && propagationRun.selected.refinement?.relaxation?.method.includes('fixed-scaffold')
      && propagationRun.selected.refinement.relaxation.stepScale === 1e-4
      && propagationRun.selected.refinement.relaxation
        .maximumDisplacementAngstromPerIteration === 0.01
      && propagationLabbook.protocol.id === 'molarium-pose-propagation-1'
      && propagationLabbook.protocol.version === '0.9.0'
      && propagationRun.selected.refinement.method
        === 'molarium-restraint-biased-internal-coordinate-search/v3'
      && propagationRun.selected.refinement.captureFeasible
      && propagationRun.selected.refinement.physicalRefinementAttempted
      && propagationRun.selected.refinement.capture?.bestEvaluation?.feasible
      && propagationRun.selected.refinement.capture.bestEvaluation.chemicalValidity?.valid
      && propagationRun.selected.refinement.capture.bestEvaluation.chemicalValidity
        .maximumRelativeLigandStrainKcalMol === 100
      && propagationRun.selected.refinement.capture.bestEvaluation.chemicalValidity
        .maximumAdditionalStericClashes === 2
      && propagationRun.selected.refinement.capture.bestEvaluation.chemicalValidity
        .maximumAdditionalLennardJonesKcalMol === 100
      && propagationLabbook.selections.atomLineage.inheritedAtomIds.length === 6
      && propagationLabbook.selections.atomLineage.addedAtomIds.length === 1
      && propagationLabbook.selections.editPreparation.selectedCleanupMode === 'preserve-reference'
      && Array.isArray(propagationLabbook.selections.editPreparation.interactivePolishHistory)
      && Array.isArray(propagationLabbook.selections.fixedReceptorContactParticipantIds)
      && propagationLabbook.events.some((event) => event.stage === 'captured-ligand-hydrogen-restoration')
      && propagationLabbook.events.some((event) => event.stage === 'in-pocket-restraint-biased-generation'
        && event.details.restraintParticipation.includes('stage 1 generates')
        && event.details.restraintParticipation.includes('sanity gates'))
      && propagationLabbook.events.some((event) => event.stage === 'fixed-scaffold-relaxation'),
    'pose propagation records automatic atom lineage and fixed-scaffold Sage relaxation',
    JSON.stringify({ run:propagationRun, protocol:propagationLabbook.protocol.id,
      lineage:propagationLabbook.selections.atomLineage,
      events:propagationLabbook.events.map((event) => event.stage) }));
    const propagated = await api.applyDockingPose(0);
    check(propagated.molecule.source.docking.protocol === 'molarium-pose-propagation-1',
      'applied propagated poses retain their distinct protocol identity');
  }

  api.loadObject(valenceCompleteDockingFixture);
  document.querySelector('.mode-bar button[data-mode="build"]').click();
  api.setDockingMode('propagate');
  await api.captureDockingReference();
  const capturedContactMolecule = api.current().molecule;
  const replacedCarbonylOxygenId = capturedContactMolecule.atoms[2].designAtomId;
  const carbonylCarbonId = capturedContactMolecule.atoms[3].designAtomId;
  await api.stageDeleteAtomCurrent(2);
  const pendingContact = document.querySelector('#docking-hbond-list label');
  check(api.chemistryTransaction()?.editCount === 1
    && pendingContact?.textContent.includes('finish chemistry')
    && pendingContact.querySelector('input')?.checked
    && pendingContact.querySelector('input')?.disabled
    && document.querySelector('#run-constrained-docking').disabled
    && !document.querySelector('#viewer-finish-chemistry').classList.contains('hidden'),
  'a pending R-group replacement preserves the required-contact intent and blocks refinement');
  const carbonylCarbonAfterDelete = api.current().molecule.atoms.findIndex((atom) =>
    atom.designAtomId === carbonylCarbonId);
  await api.stageAddElementCurrent('O', carbonylCarbonAfterDelete);
  const replacementOxygen = api.current().molecule.atoms.findIndex((atom) =>
    atom.element === 'O' && atom.designAtomId !== replacedCarbonylOxygenId);
  await api.stageBondCurrent(carbonylCarbonAfterDelete, replacementOxygen, 2);
  const remapFinish = await api.finishChemistryCurrent();
  const contactResolutions = api.dockingContactResolutions();
  const mappedContact = document.querySelector('#docking-hbond-list label');
  check(remapFinish.validation.valid && !remapFinish.pending
    && contactResolutions.remaps.length === 1
    && contactResolutions.proposals.length === 0
    && contactResolutions.remaps[0].method === 'automatic-unique-exact'
    && contactResolutions.remaps[0].originalLigandAtomIds.includes(replacedCarbonylOxygenId)
    && !contactResolutions.remaps[0].replacementLigandAtomIds.includes(replacedCarbonylOxygenId)
    && mappedContact?.textContent.includes('carbonyl acceptor mapped')
    && mappedContact.querySelector('input')?.checked
    && !mappedContact.querySelector('input')?.disabled,
  'Finish chemistry automatically transfers a required contact to one exact replacement feature',
  JSON.stringify({ remapFinish, contactResolutions }));
  const replacementCarbonylOxygenId = contactResolutions.remaps[0]?.replacementLigandAtomIds[0];
  document.querySelector('#undo-atom').click();
  const undoneContactState = api.dockingContactResolutions();
  check(api.current().molecule.atoms.some((atom) => atom.designAtomId === replacedCarbonylOxygenId)
    && !api.current().molecule.atoms.some((atom) => atom.designAtomId === replacementCarbonylOxygenId)
    && undoneContactState.remaps.length === 0 && undoneContactState.proposals.length === 0,
  'Undo restores both the reference feature and its matching restraint state');
  document.querySelector('#redo-atom').click();
  const redoneContactState = api.dockingContactResolutions();
  check(api.current().molecule.atoms.some((atom) => atom.designAtomId === replacementCarbonylOxygenId)
    && !api.current().molecule.atoms.some((atom) => atom.designAtomId === replacedCarbonylOxygenId)
    && redoneContactState.remaps.length === 1 && redoneContactState.proposals.length === 0,
  'Redo restores the replacement feature and its audited restraint mapping');
  let remappedContactRun = null;
  try { remappedContactRun = await api.runConstrainedDocking({ conformerCount:2,
    seed:20260819, torsionSteps:4, fixedRelaxIterations:2 }); }
  catch (error) { check(false, 'the remapped feature participates in reference-guided refinement', error.message); }
  if (remappedContactRun) {
    const remappedLabbook = api.dockingLabbook();
    const monotonicEventTimes = remappedLabbook.events.every((event, index, events) => !index
      || Date.parse(event.at) >= Date.parse(events[index - 1].at));
    check(remappedLabbook.selections.ligandFeatureRemaps.length === 1
      && remappedLabbook.events.some((event) => event.stage === 'captured-contact-feature-mapping')
      && remappedLabbook.outcome.ligandFeatureRemaps.length === 1
      && monotonicEventTimes,
    'the automatic feature transfer is hash-linked into the docking labbook',
    JSON.stringify({ selectionRemaps:remappedLabbook.selections.ligandFeatureRemaps,
      eventStages:remappedLabbook.events.map((event) => event.stage),
      outcomeRemaps:remappedLabbook.outcome.ligandFeatureRemaps,
      eventTimes:remappedLabbook.events.map((event) => event.at), monotonicEventTimes }));
  }
  api.loadObject(valenceCompleteDockingFixture);
  document.querySelector('.mode-bar button[data-mode="build"]').click();
  api.setDockingMode('propagate');
  await api.captureDockingReference();
  const immediateRoleChange = await api.editBondCurrent(2, 3, 1);
  const immediateContactState = api.dockingContactResolutions();
  const roleCompatibleRemapContact = document.querySelector('#docking-hbond-list label');
  check(immediateRoleChange.validation.valid && immediateContactState.remaps.length === 1
    && immediateContactState.remaps[0].method === 'automatic-unique-role-compatible'
    && immediateContactState.remaps[0].matchKind === 'role-compatible-bioisostere'
    && immediateContactState.proposals.length === 0
    && roleCompatibleRemapContact?.textContent.includes('hydroxyl oxygen acceptor mapped')
    && !document.querySelector('#run-constrained-docking').disabled,
  'immediate chemistry edits transfer a contact to a role-compatible replacement',
  JSON.stringify(immediateContactState));
  roleCompatibleRemapContact.querySelector('input').click();
  check(!api.dockingContactResolutions().selectedIds.length
    && !document.querySelector('#run-constrained-docking').disabled,
  'a user may explicitly omit a viable role-compatible contact');

  // Canvas/fragment additions can predate a staged chemistry transaction. A
  // new atom must receive an identity before the transaction snapshot is
  // taken, otherwise Finish chemistry cannot canonically hash the old graph.
  api.loadObject(valenceCompleteDockingFixture);
  document.querySelector('.mode-bar button[data-mode="build"]').click();
  api.setDockingMode('propagate');
  await api.captureDockingReference();
  api.addElementCurrent('F', 6);
  const anonymousAddedIndex = api.current().molecule.atoms.findIndex((atom) => !atom.designAtomId);
  const anonymousBeforeStaging = anonymousAddedIndex >= 0;
  await api.stageDeleteAtomCurrent(anonymousAddedIndex);
  const stagedIdentityTransaction = await api.finishChemistryCurrent();
  check(anonymousBeforeStaging && stagedIdentityTransaction.validation.valid
    && !stagedIdentityTransaction.pending && !api.chemistryTransaction(),
  'Finish chemistry assigns stable identities before snapshotting a graph with a newly added atom',
  JSON.stringify(stagedIdentityTransaction));

  // A realistic R-group replacement can cross two completed edit batches:
  // remove the old group first, then build and finish the replacement. The
  // first batch is the only one that knows the deleted feature's attachment
  // boundary, so that provenance must survive long enough to type the new
  // carbonyl in the second batch.
  api.loadObject(valenceCompleteDockingFixture);
  document.querySelector('.mode-bar button[data-mode="build"]').click();
  api.setDockingMode('propagate');
  await api.captureDockingReference();
  const sequentialReference = api.current().molecule;
  const sequentialOldOxygenId = sequentialReference.atoms[2].designAtomId;
  const sequentialCarbonId = sequentialReference.atoms[3].designAtomId;
  await api.stageDeleteAtomCurrent(2);
  const deletionFinish = await api.finishChemistryCurrent();
  const deletedFeatureState = api.dockingContactResolutions();
  const sequentialCarbon = api.current().molecule.atoms.findIndex((atom) =>
    atom.designAtomId === sequentialCarbonId);
  await api.stageAddElementCurrent('O', sequentialCarbon);
  const sequentialReplacementOxygen = api.current().molecule.atoms.findIndex((atom) =>
    atom.element === 'O' && atom.designAtomId !== sequentialOldOxygenId);
  const stagedReplacementOxygenId = api.current().molecule
    .atoms[sequentialReplacementOxygen]?.designAtomId;
  await api.stageBondCurrent(sequentialCarbon, sequentialReplacementOxygen, 2);
  const additionFinish = await api.finishChemistryCurrent();
  const sequentialContactState = api.dockingContactResolutions();
  const sequentialDepiction = await api.waitFor2DDepiction();
  const committedSequentialMolecule = api.current().molecule;
  const committedSequentialCarbon = committedSequentialMolecule.atoms.findIndex((atom) =>
    atom.designAtomId === sequentialCarbonId);
  const committedReplacementOxygen = committedSequentialMolecule.atoms.findIndex((atom) =>
    sequentialContactState.remaps[0]?.replacementLigandAtomIds.includes(atom.designAtomId));
  const depictionShowsReplacementCarbonyl = sequentialDepiction.bondPairs.some((pair) =>
    (pair[0] === committedSequentialCarbon && pair[1] === committedReplacementOxygen)
      || (pair[1] === committedSequentialCarbon && pair[0] === committedReplacementOxygen));
  check(deletionFinish.validation.valid
    && deletedFeatureState.proposals.length === 1
    && deletedFeatureState.proposals[0].status === 'unavailable'
    && additionFinish.validation.valid
    && sequentialContactState.proposals.length === 0
    && sequentialContactState.remaps.length === 1
    && sequentialContactState.remaps[0]?.method === 'automatic-unique-exact'
    && sequentialContactState.remaps[0]?.replacementLigandAtomIds.length === 1
    && Boolean(stagedReplacementOxygenId)
    && sequentialContactState.remaps[0]?.replacementLigandAtomIds.includes(
      stagedReplacementOxygenId)
    && !sequentialContactState.remaps[0]?.replacementLigandAtomIds.includes(
      sequentialOldOxygenId)
    && sequentialContactState.remaps[0]?.originatingCommittedEditId
      !== sequentialContactState.remaps[0]?.committedEditId
    && sequentialDepiction.alignmentBackend.includes('RDKit 2D layout')
    && depictionShowsReplacementCarbonyl,
  'a replacement carbonyl created in the next completed edit batch inherits the deleted acceptor restraint',
  JSON.stringify({ deletionFinish, deletedFeatureState, additionFinish,
    sequentialContactState, sequentialDepiction, depictionShowsReplacementCarbonyl }));

  // Replace the captured carbonyl oxygen with a sulfonamide group. Both
  // sulfonyl oxygens are acceptor hypotheses on the same recorded boundary;
  // the browser must refine them as one any-of contact without requiring a
  // pre-geometry user choice, and the labbook must retain both evaluations.
  api.loadObject(valenceCompleteDockingFixture);
  document.querySelector('.mode-bar button[data-mode="build"]').click();
  api.setDockingMode('propagate');
  await api.captureDockingReference();
  const sulfoneReference = api.current().molecule;
  const sulfoneOldOxygenId = sulfoneReference.atoms[2].designAtomId;
  const sulfoneAnchorId = sulfoneReference.atoms[3].designAtomId;
  await api.stageDeleteAtomCurrent(2);
  const sulfoneDeletionFinish = await api.finishChemistryCurrent();
  const addStagedAtom = async (element, anchorId) => {
    const beforeIds = new Set(api.current().molecule.atoms.map((atom) => atom.designAtomId));
    const anchorIndex = api.current().molecule.atoms.findIndex((atom) =>
      atom.designAtomId === anchorId);
    await api.stageAddElementCurrent(element, anchorIndex);
    return api.current().molecule.atoms.find((atom) =>
      atom.element === element && !beforeIds.has(atom.designAtomId))?.designAtomId;
  };
  const liveAtomIndex = (designAtomId) => api.current().molecule.atoms.findIndex((atom) =>
    atom.designAtomId === designAtomId);
  // Build the expanded-valence sulfur center directly. The interactive
  // attachment gate must permit ordinary S(IV)/S(VI) chemistry without a
  // temporary carbon workaround, while the unfinished transaction remains
  // chemically incomplete until both S=O bonds are assigned.
  const sulfurId = await addStagedAtom('S', sulfoneAnchorId);
  const sulfoneOxygen1Id = await addStagedAtom('O', sulfurId);
  const sulfoneOxygen2Id = await addStagedAtom('O', sulfurId);
  await addStagedAtom('N', sulfurId);
  await api.stageBondCurrent(liveAtomIndex(sulfurId), liveAtomIndex(sulfoneOxygen1Id), 2);
  await api.stageBondCurrent(liveAtomIndex(sulfurId), liveAtomIndex(sulfoneOxygen2Id), 2);
  const sulfoneFinish = await api.finishChemistryCurrent();
  const sulfoneContactState = api.dockingContactResolutions();
  const sulfoneProposal = sulfoneContactState.proposals[0];
  const sulfoneContactLabel = document.querySelector('#docking-hbond-list label');
  const sulfoneChoice = document.querySelector('.docking-contact-remap-select');
  check(sulfoneDeletionFinish.validation.valid && sulfoneFinish.validation.valid
    && sulfoneContactState.remaps.length === 0
    && sulfoneContactState.proposals.length === 1
    && sulfoneProposal?.status === 'ambiguous'
    && sulfoneProposal?.candidates.length === 2
    && sulfoneProposal?.candidates.every((candidate) => candidate.label.includes('sulfonyl'))
    && sulfoneContactLabel?.textContent.includes('2 alternatives')
    && sulfoneChoice?.value === ''
    && !document.querySelector('#run-constrained-docking').disabled,
  'two sulfonyl oxygens remain an uncollapsed role-compatible any-of hypothesis in the browser',
  JSON.stringify({ sulfoneFinish, sulfoneContactState, sulfoneOldOxygenId }));
  let sulfoneRun = null;
  try { sulfoneRun = await api.runConstrainedDocking({ conformerCount:2,
    seed:20260819, torsionSteps:4, fixedRelaxIterations:2 }); }
  catch (error) { check(false, 'ambiguous any-of hypotheses execute in reference-guided refinement',
    error.message); }
  if (sulfoneRun) {
    const sulfoneLabbook = api.dockingLabbook();
    const selectedContact = sulfoneRun.selected.hydrogenBonds[0];
    const outcomeContact = sulfoneLabbook.outcome.selectedHydrogenBonds[0];
    check(sulfoneLabbook.selections.hydrogenBonds[0].alternativeIds.length === 2
      && selectedContact.alternativeCount === 2
      && selectedContact.alternatives.length === 2
      && selectedContact.selectedAlternativeId
      && outcomeContact.alternativeCount === 2
      && outcomeContact.alternatives.length === 2
      && outcomeContact.selectedAlternativeId === selectedContact.selectedAlternativeId,
    'any-of refinement records the selected sulfonyl oxygen and every alternative evaluation',
    JSON.stringify({ selection:sulfoneLabbook.selections.hydrogenBonds[0],
      selectedContact, outcomeContact }));
  }
  if (testScope === 'docking-contact-remap') {
    const failed = checks.filter((item) => !item.passed);
    return { passed:checks.length - failed.length, total:checks.length, failed,
      optimizationMetrics, rdkitMetrics, aniMetrics, webgpuMetrics, rosemaryMetrics,
      preparationMetrics:null };
  }

  await api.loadSmilesWithRdkit('c1ccccc1', 'Reference phenyl edit');
  const arylEditFixture = structuredClone(api.current().molecule);
  arylEditFixture.atoms.forEach((atom, index) => Object.assign(atom, {
    record:'HETATM', atomName:'L' + (index + 1), residueName:'BEN', residueIndex:1, chain:'L',
  }));
  const arylLigandAtomCount = arylEditFixture.atoms.length;
  arylEditFixture.atoms.push(
    { element:'N', x:-5, y:0, z:0, record:'ATOM', atomName:'N', residueName:'ALA', residueIndex:1, chain:'A' },
    { element:'H', x:-4, y:0, z:0, record:'ATOM', atomName:'H', residueName:'ALA', residueIndex:1, chain:'A' });
  arylEditFixture.bonds.push({ a:arylLigandAtomCount, b:arylLigandAtomCount + 1, order:1 });
  const regressionMasses = { H:1.008, C:12.011, N:14.007 };
  arylEditFixture.parameterization = {
    forcefield:'browser regression fixture', chargeModel:'zero charges', sourceSha256:'browser-regression',
    system:{ particles:arylEditFixture.atoms.map((atom, index) => ({ index,
      mass_amu:regressionMasses[atom.element] || 12 })), constraints:[], bonds:[], angles:[], torsions:[],
      exceptions:[], nonbonded:arylEditFixture.atoms.map((atom, index) => ({ index, charge_e:0,
        sigma_nm:atom.element === 'H' ? 0.1 : 0.34, epsilon_kj:atom.element === 'H' ? 0.02 : 0.4 })) },
  };
  arylEditFixture.source = { format:'pdb', pdbId:'ARYL-EDIT-REGRESSION' };
  arylEditFixture.prediction = { kind:'pdb-import' };
  api.loadObject(arylEditFixture);
  document.querySelector('.mode-bar button[data-mode="build"]').click();
  api.setDockingMode('propagate');
  const arylReference = await api.captureDockingReference();
  const arylReferenceHeavyIndices = api.current().molecule.atoms.flatMap((atom, index) =>
    atom.record === 'HETATM' && atom.element !== 'H' ? [index] : []);
  const arylReferenceHeavyPositions = arylReferenceHeavyIndices.map((index) => {
    const atom = api.current().molecule.atoms[index]; return [atom.x, atom.y, atom.z];
  });
  const arylCleanupDefault = api.setDockingEditCleanup('preserve-reference');
  document.querySelector('[data-tool="add"]').click();
  document.querySelector('[data-element="C"]').click();
  const arylTarget = api.viewerState().atoms.find((atom) => atom.index === 0);
  const arylCanvas = document.querySelector('#molecule-canvas');
  const arylCanvasRect = arylCanvas.getBoundingClientRect();
  for (const type of ['pointerdown', 'pointerup']) arylCanvas.dispatchEvent(new PointerEvent(type, {
    bubbles:true, pointerId:83,
    clientX:arylCanvasRect.left + arylTarget.sx,
    clientY:arylCanvasRect.top + arylTarget.sy,
  }));
  const referenceEditPolish = await new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      const source = api.current().molecule.source || {};
      if (source.lastInteractivePolish) return resolve(source.lastInteractivePolish);
      if (source.lastInteractivePolishError) return reject(new Error(source.lastInteractivePolishError));
      if (performance.now() - started > 10000)
        return reject(new Error('Timed out waiting for reference-preserving edit cleanup'));
      setTimeout(poll, 50);
    };
    poll();
  });
  const arylEdited = api.current().molecule;
  const inheritedMaximumDisplacement = Math.max(...arylReferenceHeavyIndices.map((atomIndex, ordinal) => {
    const atom = arylEdited.atoms[atomIndex], before = arylReferenceHeavyPositions[ordinal];
    return Math.hypot(atom.x - before[0], atom.y - before[1], atom.z - before[2]);
  }));
  const addedMethylCarbon = arylEdited.atoms.findIndex((atom) =>
    atom.element === 'C' && !atom.designAtomId);
  const methylBondLength = Math.hypot(arylEdited.atoms[0].x - arylEdited.atoms[addedMethylCarbon].x,
    arylEdited.atoms[0].y - arylEdited.atoms[addedMethylCarbon].y,
    arylEdited.atoms[0].z - arylEdited.atoms[addedMethylCarbon].z);
  const preservedSelection = api.localPolishSelection([0, addedMethylCarbon], 2);
  const freeCleanup = api.setDockingEditCleanup('free-local');
  const freeSelection = api.localPolishSelection([0, addedMethylCarbon], 2);
  check(arylReference.mode === 'pose-propagation' && arylReference.coreAtomIds.length === 6
    && arylCleanupDefault.visible && arylCleanupDefault.mode === 'preserve-reference'
    && referenceEditPolish.cleanupMode === 'preserve-reference'
    && referenceEditPolish.fixedInheritedHeavyAtomCount === 6
    && inheritedMaximumDisplacement < 1e-12
    && methylBondLength > 1.35 && methylBondLength < 1.65
    && arylReferenceHeavyIndices.every((index) => !preservedSelection.movableAtomIndices.includes(index))
    && freeCleanup.mode === 'free-local'
    && arylReferenceHeavyIndices.every((index) => freeSelection.movableAtomIndices.includes(index))
    && arylEdited.source.interactivePolishHistory.length >= 1,
  'the real canvas add-methyl path preserves a captured aromatic scaffold by default and exposes free ring cleanup explicitly',
  JSON.stringify({ arylCleanupDefault, referenceEditPolish, inheritedMaximumDisplacement,
    methylBondLength, preservedSelection, freeSelection }));
  document.querySelector('.mode-bar button[data-mode="view"]').click();
  const bentHydroxylFixture = {
    name:'Tyr-ligand polar-H fixture', smiles:'protein-ligand fixture', charge:0, multiplicity:1,
    atoms:[
      { element:'C', x:-1.40, y:0, z:0, record:'ATOM', atomName:'CZ', residueName:'TYR', chain:'A', residueIndex:10 },
      { element:'O', x:0, y:0, z:0, record:'ATOM', atomName:'OH', residueName:'TYR', chain:'A', residueIndex:10 },
      { element:'H', x:0.98, y:0, z:0, record:'ATOM', atomName:'HH', residueName:'TYR', chain:'A', residueIndex:10, prepared:true },
      { element:'N', x:0.90, y:2.50, z:0, record:'HETATM', atomName:'N1', residueName:'LIG', chain:'B', residueIndex:20 },
      { element:'C', x:2.20, y:2.50, z:0, record:'HETATM', atomName:'C1', residueName:'LIG', chain:'B', residueIndex:20 },
    ],
    bonds:[
      { a:0, b:1, order:1, distance:1.40 }, { a:1, b:2, order:1, distance:0.98 },
      { a:3, b:4, order:1, distance:1.30 },
    ],
  };
  const bentHydroxyl = api.relaxPolarHydrogens(bentHydroxylFixture);
  api.loadObject(bentHydroxyl.molecule);
  const bentHydroxylInteractions = api.renderDiagnostics();
  check(bentHydroxyl.rotatableHydrogens === 1 && bentHydroxyl.moved === 1
    && bentHydroxyl.heavyAtomMaximumDisplacement === 0
    && Math.abs(bentHydroxyl.diagnostics.angles[0].degrees - 108.5) < 1e-6
    && bentHydroxyl.diagnostics.linear === 0,
  'preparation bends a phenolic O-H and relaxes only its polar hydrogen while fixing every heavy atom',
  JSON.stringify(bentHydroxyl));
  check(bentHydroxylInteractions.hydrogenBonds.some((bond) =>
    bond.donor === 1 && bond.hydrogen === 2 && bond.acceptor === 3),
  'preparation polar-H scan recovers the Tyr-like hydroxyl to ligand-N hydrogen bond',
  JSON.stringify(bentHydroxylInteractions.hydrogenBonds));
  const disconnectedLigandPdb = [
    'HETATM    1  C1  LIG A   1       0.000   0.000   0.000  1.00 20.00           C  ',
    'HETATM    2  C2  LIG B   2       1.200   0.000   0.000  1.00 20.00           C  ',
    'END',
  ].join('\n');
  const disconnectedPdb = api.parsePdb(disconnectedLigandPdb);
  check(disconnectedPdb.bonds === 0 && disconnectedPdb.components === 2,
    'PDB parser does not draw proximity-only bonds between unconnected records', JSON.stringify(disconnectedPdb));
  const disulfidePdb = [
    'SSBOND   1 CYS A    6    CYS A  127                          1555   1555  2.03',
    'ATOM      1  SG  CYS A   6       0.000   0.000   0.000  1.00 20.00           S  ',
    'ATOM      2  SG  CYS A 127       2.030   0.000   0.000  1.00 20.00           S  ',
    'END',
  ].join('\n');
  const disulfide = api.parsePdb(disulfidePdb);
  check(disulfide.bonds === 1 && disulfide.components === 1
    && disulfide.source.disulfideBonds === 1
    && disulfide.molecule.bonds[0].topology === 'SSBOND',
    'PDB SSBOND records create authoritative disulfide topology', JSON.stringify(disulfide));
  const incompleteAlaninePdb = [
    'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 20.00           N  ',
    'ATOM      2  CA  ALA A   1       1.458   0.000   0.000  1.00 20.00           C  ',
    'ATOM      3  C   ALA A   1       1.958   1.410   0.000  1.00 20.00           C  ',
    'ATOM      4  O   ALA A   1       1.220   2.370   0.000  1.00 20.00           O  ',
    'END',
  ].join('\n');
  api.loadPdb(incompleteAlaninePdb);
  const prepareButton = document.querySelector('#prepare-pdb');
  check(prepareButton.dataset.action === 'prepare'
    && prepareButton.textContent === 'Prepare structure'
    && document.querySelector('#preparation-inspector-body').classList.contains('hidden'),
    'a repairable PDB starts with one preparation action and collapsed optional details');
  prepareButton.click();
  const preparationStarted = performance.now();
  while (prepareButton.dataset.action !== 'ready' && performance.now() - preparationStarted < 15000)
    await new Promise((resolve) => setTimeout(resolve, 50));
  check(prepareButton.dataset.action === 'ready'
    && document.querySelector('#pdb-preparation-badge').textContent === 'Prepared'
    && document.querySelector('#preparation-inspector-body').classList.contains('hidden'),
    'one click repairs, audits, parameterizes, and keeps a successful report folded away',
    document.querySelector('#pdb-preparation').textContent);
  api.loadPdb(incompleteAlaninePdb);
  const repairedAlanine = api.repairPdbHeavyAtoms();
  check(repairedAlanine.repaired.length === 1 && repairedAlanine.repaired[0].atomName === 'CB'
    && repairedAlanine.unresolved.length === 0 && repairedAlanine.preparation.missingHeavyAtoms.length === 0
    && repairedAlanine.molecule.atoms.some((atom) => atom.atomName === 'CB' && atom.modeled),
    'browser repair restores a missing canonical side-chain atom from the residue template',
    JSON.stringify(repairedAlanine));
  const lowPhAlanine = await api.previewPdbPreparation({ pH: 2.0, ligandPolicy: 'exclude', waterPolicy: 'exclude' });
  check(lowPhAlanine.audit.blockers.length === 0 && lowPhAlanine.molecule.charge === 1
    && lowPhAlanine.audit.actions.some((action) => action.action === 'restore-terminal-oxygen' && action.added === 1)
    && lowPhAlanine.molecule.atoms.some((atom) => atom.atomName === 'OXT'),
    'preparation preview restores a terminal oxygen and applies pH-dependent terminal protonation',
    JSON.stringify(lowPhAlanine.audit));
  const structuralWaterPdb = [
    'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 20.00           N  ',
    'ATOM      2  CA  ALA A   1      -1.458   0.000   0.000  1.00 20.00           C  ',
    'ATOM      3  C   ALA A   1      -2.858   0.000   0.000  1.00 20.00           C  ',
    'ATOM      4  O   ALA A   1      -3.958   0.000   0.000  1.00 20.00           O  ',
    'ATOM      5  CB  ALA A   1      -1.458   1.500   0.000  1.00 20.00           C  ',
    'ATOM      6  N   ALA B   1      10.000   0.000   0.000  1.00 20.00           N  ',
    'ATOM      7  CA  ALA B   1       8.542   0.000   0.000  1.00 20.00           C  ',
    'ATOM      8  C   ALA B   1       7.142   0.000   0.000  1.00 20.00           C  ',
    'ATOM      9  O   ALA B   1       6.000   0.000   0.000  1.00 20.00           O  ',
    'ATOM     10  CB  ALA B   1       8.542   1.500   0.000  1.00 20.00           C  ',
    'HETATM   11  O   HOH W 101       3.000   0.000   0.000  1.00 20.00           O  ',
    'HETATM   12  O   HOH W 102      20.000  20.000  20.000  1.00 20.00           O  ',
    'TER', 'END',
  ].join('\n');
  api.loadPdb(structuralWaterPdb);
  const crucialWaterPreview = await api.previewPdbPreparation({
    ligandPolicy:'exclude', waterPolicy:'crucial', repairMissingHeavy:true,
  });
  const crucialWaterAction = crucialWaterPreview.audit.actions.find((action) =>
    action.action === 'retain-crucial-crystallographic-water');
  const retainedWaterAtoms = crucialWaterPreview.molecule.atoms.filter((atom) =>
    ['HOH', 'WAT', 'H2O', 'TIP3', 'TIP3P'].includes(atom.residueName));
  check(document.querySelector('#preparation-waters').value === 'crucial'
    && crucialWaterAction?.watersExamined === 2
    && crucialWaterAction?.watersRetained === 1
    && crucialWaterAction?.watersRemoved === 1
    && crucialWaterAction?.hydrogensAdded === 2
    && crucialWaterAction.retained[0]?.reason === 'multi-residue protein polar network'
    && crucialWaterPreview.report.waterResidues === 1
    && retainedWaterAtoms.length === 3
    && retainedWaterAtoms.every((atom) => atom.residueIndex === 101),
  'recommended preparation keeps a deposited structural water and removes a remote crystal water',
  JSON.stringify({ action:crucialWaterAction, blockers:crucialWaterPreview.audit.blockers }));
  const internalGapPdb = [
    'REMARK 465     GLY A   2',
    'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 20.00           N  ',
    'ATOM      2  CA  ALA A   1       1.458   0.000   0.000  1.00 20.00           C  ',
    'ATOM      3  C   ALA A   1       1.958   1.410   0.000  1.00 20.00           C  ',
    'ATOM      4  O   ALA A   1       1.220   2.370   0.000  1.00 20.00           O  ',
    'ATOM      5  CB  ALA A   1       1.990  -0.775  -1.200  1.00 20.00           C  ',
    'ATOM      6  N   ALA A   3       8.000   0.000   0.000  1.00 20.00           N  ',
    'ATOM      7  CA  ALA A   3       9.458   0.000   0.000  1.00 20.00           C  ',
    'ATOM      8  C   ALA A   3       9.958   1.410   0.000  1.00 20.00           C  ',
    'ATOM      9  O   ALA A   3       9.220   2.370   0.000  1.00 20.00           O  ',
    'ATOM     10  CB  ALA A   3       9.990  -0.775  -1.200  1.00 20.00           C  ',
    'END',
  ].join('\n');
  api.loadPdb(internalGapPdb);
  const gapPolicyControl = document.querySelector('#preparation-gaps');
  gapPolicyControl.value = 'block'; gapPolicyControl.dispatchEvent(new Event('change', { bubbles:true }));
  const blockedPrepareButton = document.querySelector('#prepare-pdb');
  blockedPrepareButton.click();
  const blockerAuditStarted = performance.now();
  while (blockedPrepareButton.dataset.action !== 'inspect' && performance.now() - blockerAuditStarted < 10000)
    await new Promise((resolve) => setTimeout(resolve, 50));
  check(blockedPrepareButton.dataset.action === 'inspect'
    && !document.querySelector('#preparation-inspector-body').classList.contains('hidden')
    && document.querySelector('#preparation-issues').textContent.includes('internal missing residues'),
  'the same preparation action opens optional details only when its internal audit finds a blocker',
  document.querySelector('#preparation-inspector').textContent);
  gapPolicyControl.value = 'cap'; gapPolicyControl.dispatchEvent(new Event('change', { bubbles:true }));
  const internalGapPreview = await api.previewPdbPreparation({ ligandPolicy: 'exclude', waterPolicy: 'exclude', gapPolicy: 'block' });
  check(internalGapPreview.report.internalMissingResidues.length === 1
    && internalGapPreview.audit.blockers.some((blocker) => blocker.includes('internal missing residues')),
    'internal REMARK 465 gaps remain explicit loop-modeling or capping blockers',
    JSON.stringify(internalGapPreview.audit));
  const cappedGapPreview = await api.previewPdbPreparation({ ligandPolicy: 'exclude', waterPolicy: 'exclude' });
  check(cappedGapPreview.audit.blockers.length === 0
    && cappedGapPreview.audit.actions.some((action) => action.action === 'accept-chain-breaks')
    && cappedGapPreview.audit.actions.some((action) => action.action === 'restore-terminal-oxygen' && action.added === 2),
    'default cap policy converts resolved fragments around a missing loop into auditable termini',
    JSON.stringify(cappedGapPreview.audit));
  const methanolPdb = [
    'HETATM    1  C1  LIG A   1       0.000   0.000   0.000  1.00 20.00           C  ',
    'HETATM    2  O1  LIG A   1       1.430   0.000   0.000  1.00 20.00           O  ',
    'CONECT    1    2', 'CONECT    2    1', 'END',
  ].join('\n');
  const methanolCcd = [
    'data_LIG', '#', 'loop_',
    '_chem_comp_atom.comp_id', '_chem_comp_atom.atom_id', '_chem_comp_atom.type_symbol',
    '_chem_comp_atom.charge', '_chem_comp_atom.pdbx_aromatic_flag', '_chem_comp_atom.pdbx_leaving_atom_flag',
    'LIG C1 C 0 N N', 'LIG O1 O 0 N N', 'LIG H1 H 0 N N', 'LIG H2 H 0 N N',
    'LIG H3 H 0 N N', 'LIG HO H 0 N N', '#', 'loop_',
    '_chem_comp_bond.comp_id', '_chem_comp_bond.atom_id_1', '_chem_comp_bond.atom_id_2',
    '_chem_comp_bond.value_order', '_chem_comp_bond.pdbx_aromatic_flag',
    'LIG C1 O1 SING N', 'LIG C1 H1 SING N', 'LIG C1 H2 SING N',
    'LIG C1 H3 SING N', 'LIG O1 HO SING N', '#',
  ].join('\n');
  api.loadPdb(methanolPdb);
  const parsedMethanolCcd = api.parseCcd(methanolCcd, 'LIG');
  const preparedMethanol = api.prepareLigandsWithCcd({ LIG: parsedMethanolCcd });
  check(preparedMethanol.atoms === 6 && preparedMethanol.bonds === 5
    && preparedMethanol.prepared[0].hydrogensAdded === 4
    && preparedMethanol.preparation.unpreparedLigands.length === 0,
    'CCD preparation restores ligand bond orders, formal chemistry, and explicit hydrogens locally',
    JSON.stringify(preparedMethanol));
  const ligandBridgeWaterPdb = [
    'ATOM      1  N   ALA A   1       0.000   0.000   0.000  1.00 20.00           N  ',
    'ATOM      2  CA  ALA A   1      -1.458   0.000   0.000  1.00 20.00           C  ',
    'ATOM      3  C   ALA A   1      -2.858   0.000   0.000  1.00 20.00           C  ',
    'ATOM      4  O   ALA A   1      -3.958   0.000   0.000  1.00 20.00           O  ',
    'ATOM      5  CB  ALA A   1      -1.458   1.500   0.000  1.00 20.00           C  ',
    'HETATM    6  C1  LIG L   1       7.430   0.000   0.000  1.00 20.00           C  ',
    'HETATM    7  O1  LIG L   1       6.000   0.000   0.000  1.00 20.00           O  ',
    'HETATM    8  O   HOH W 201       3.000   0.000   0.000  1.00 20.00           O  ',
    'HETATM    9  O   HOH W 202      20.000  20.000  20.000  1.00 20.00           O  ',
    'CONECT    6    7', 'CONECT    7    6', 'TER', 'END',
  ].join('\n');
  api.loadPdb(ligandBridgeWaterPdb);
  const ligandBridgeWaterPreview = await api.previewPdbPreparation({
    ligandPolicy:'ccd', waterPolicy:'crucial', repairMissingHeavy:true,
  }, { LIG:parsedMethanolCcd });
  const ligandBridgeWaterAction = ligandBridgeWaterPreview.audit.actions.find((action) =>
    action.action === 'retain-crucial-crystallographic-water');
  check(ligandBridgeWaterAction?.watersRetained === 1
    && ligandBridgeWaterAction?.watersRemoved === 1
    && ligandBridgeWaterAction?.retained[0]?.reason === 'ligand–protein bridge'
    && ligandBridgeWaterAction.retained[0].ligandContacts >= 1
    && ligandBridgeWaterAction.retained[0].proteinContacts >= 1
    && ligandBridgeWaterPreview.molecule.atoms.filter((atom) => atom.residueName === 'HOH').length === 3,
  'recommended preparation preserves a crystallographic ligand–protein bridging water',
  JSON.stringify({ action:ligandBridgeWaterAction, blockers:ligandBridgeWaterPreview.audit.blockers }));
  check(!document.querySelector('#preview-pdb-preparation')
    && document.querySelector('#preparation-inspector-toggle > span')?.textContent === 'Preparation details'
    && Boolean(document.querySelector('#preparation-ph'))
    && Boolean(document.querySelector('#preparation-histidine'))
    && Boolean(document.querySelector('#download-preparation-report')),
    'PDB preparation keeps advanced options and its downloadable audit without a separate preview button');
  let preparationMetrics = null;
  if (externalPreparationFixture) {
    const imported = api.loadPdb(externalPreparationFixture.pdb);
    const ccd = externalPreparationFixture.ccd
      ? api.parseCcd(externalPreparationFixture.ccd, externalPreparationFixture.ccdId) : null;
    const preview = await api.previewPdbPreparation({ pH: 7.4, histidine: 'auto', repairMissingHeavy: true,
      ligandPolicy: 'ccd', waterPolicy:externalPreparationFixture.waterPolicy, gapPolicy: 'cap' },
    ccd ? { [externalPreparationFixture.ccdId]: ccd } : null);
    const heavyRepair = preview.audit.actions.find((action) => action.action === 'repair-heavy-atoms');
    const ligandRepair = preview.audit.actions.find((action) => action.action === 'prepare-ligands-from-ccd');
    const ligandIndices = new Set(preview.molecule.atoms.map((atom, index) => ({ atom, index }))
      .filter(({ atom }) => atom.record === 'HETATM' && !['HOH', 'WAT', 'H2O', 'TIP3', 'TIP3P'].includes(atom.residueName))
      .map(({ index }) => index));
    const ligandAdjacency = new Map([...ligandIndices].map((index) => [index, []]));
    preview.molecule.bonds.forEach((bond) => {
      if (!ligandIndices.has(bond.a) || !ligandIndices.has(bond.b)) return;
      ligandAdjacency.get(bond.a).push(bond.b); ligandAdjacency.get(bond.b).push(bond.a);
    });
    const ligandComponents = [];
    const ligandSeen = new Set();
    for (const root of ligandIndices) {
      if (ligandSeen.has(root)) continue;
      const pending = [root], component = []; ligandSeen.add(root);
      while (pending.length) {
        const atom = pending.shift(); component.push(atom);
        for (const neighbor of ligandAdjacency.get(atom)) if (!ligandSeen.has(neighbor)) {
          ligandSeen.add(neighbor); pending.push(neighbor);
        }
      }
      ligandComponents.push(component);
    }
    preparationMetrics = { inputAtoms: imported.atoms, outputAtoms: preview.molecule.atoms.length,
      inputMissingHeavy: imported.preparation.missingHeavyAtoms.length,
      repairedHeavy: heavyRepair?.added || 0,
      ligandComponents: ligandRepair?.components?.length || 0,
      ligandHydrogens: ligandRepair?.components?.reduce((sum, item) => sum + item.hydrogensAdded, 0) || 0,
      ligandGraphComponents: ligandComponents.map((component) => component.length),
      internalMissingResidues: preview.report.internalMissingResidues.length,
      blockers: preview.audit.blockers, warnings: preview.audit.warnings, geometry: preview.audit.geometry };
    check(imported.source.pdbId === '7KPA' && imported.preparation.missingHeavyAtoms.length === 170,
      '7KPA real-structure fixture reaches the browser preparation audit', JSON.stringify(preparationMetrics));
    check(heavyRepair?.added === 170 && preview.report.missingHeavyAtoms.length === 0,
      '7KPA canonical modeled-residue repair restores all 170 declared heavy atoms', JSON.stringify(preparationMetrics));
    check(ligandRepair?.components?.length === 1 && preparationMetrics.ligandHydrogens === 26
      && preview.report.unpreparedLigands.length === 0 && ligandComponents.length === 1,
      '7KPA D84 ligand chemistry is reconstructed from its official CCD definition', JSON.stringify(preparationMetrics));
    check(preview.audit.geometry.invalidAtoms === 0 && preview.audit.geometry.invalidBonds === 0,
      '7KPA repair produces finite coordinates and valid topology indices', JSON.stringify(preparationMetrics));
    check((heavyRepair?.rotamersOptimized || 0) > 0 && preview.audit.geometry.minimumModeledNonbondedDistance > 1.0
      && !preview.audit.blockers.length,
      '7KPA reconstructed sidechains pass the rotamer clash gate', JSON.stringify(preparationMetrics));
    api.loadObject(preview.molecule);
    api.setRepresentation('cartoon');
    preparationMetrics.pocket = api.pocketDiagnostics();
    preparationMetrics.interactivePocketMovableAtoms = api.interactivePocketMovableAtoms();
    check(preparationMetrics.interactivePocketMovableAtoms.length > preparationMetrics.pocket.ligandAtomCount
      && preparationMetrics.interactivePocketMovableAtoms.length < preview.molecule.atoms.length
      && !document.querySelector('#build-optimizer-select option[value="pocket-webgpu"]').disabled
      && document.querySelector('#build-optimizer-select option[value="webgpu"]').hidden
      && document.querySelector('#build-optimizer-select').value === 'ligand-rdkit',
    'prepared 7KPA exposes ligand and pocket relaxation without an accidental full-complex Build action',
    String(preparationMetrics.interactivePocketMovableAtoms.length));
    const polarRelaxation = preview.audit.actions.find((action) => action.action === 'relax-polar-hydrogens');
    preparationMetrics.polarHydrogenRelaxation = polarRelaxation;
    const atomLabel = (index) => {
      const atom = preview.molecule.atoms[index];
      return [atom.atomName, atom.residueName, String(atom.chain || '')
        + String(atom.residueIndex ?? '') + String(atom.insertionCode || '')].join(':');
    };
    preparationMetrics.ligandContacts = preparationMetrics.pocket.hydrogenBonds
      .filter((bond) => preview.molecule.atoms[bond.donor].record === 'HETATM'
        || preview.molecule.atoms[bond.acceptor].record === 'HETATM')
      .map((bond) => ({ donor:atomLabel(bond.donor), hydrogen:atomLabel(bond.hydrogen),
        acceptor:atomLabel(bond.acceptor), distance:bond.distance, cosine:bond.cosine }));
    check(polarRelaxation?.rotatableHydrogens > 0 && polarRelaxation.moved > 0
      && polarRelaxation.linearHydrogens === 0 && polarRelaxation.elapsedMs < 1000,
    '7KPA preparation performs bounded fixed-heavy polar-H relaxation without linear hydroxyls',
    JSON.stringify(polarRelaxation));
    check(preparationMetrics.pocket.ligandAtomCount > 0
      && preparationMetrics.pocket.residueKeys.length > 0
      && preparationMetrics.pocket.pocketAtomCount > preparationMetrics.pocket.residueKeys.length
      && preparationMetrics.pocket.hydrogenBonds.length > 0
      && preparationMetrics.pocket.ligandHydrogenBondCount > 0,
    '7KPA cartoon view expands complete residues around the prepared D84 ligand',
    JSON.stringify(preparationMetrics.pocket));
    check(preparationMetrics.ligandContacts.some((contact) =>
      contact.donor === 'OH:TYR:C151' && contact.acceptor === 'N2:D84:C201'
        && contact.distance < 2.0 && contact.cosine < -0.95),
    '7KPA preparation recovers the observed Tyr C151 O-H to D84 imidazole N2 contact',
    JSON.stringify(preparationMetrics.ligandContacts));
    check(preparationMetrics.ligandContacts.some((contact) =>
      contact.donor === 'NZ:LYS:A11' && contact.acceptor === 'O3:D84:C201'
        && contact.distance < 2.6 && contact.cosine < -0.85),
    '7KPA preparation recovers the Lys A11 N-H to D84 pyridone O3 contact',
    JSON.stringify(preparationMetrics.ligandContacts));
    if (externalPreparationFixture.waterPolicy === 'retain') {
      const captureMolecule = structuredClone(preview.molecule);
      captureMolecule.parameterization = {
        forcefield:'7KPA contact-capture fixture', chargeModel:'test-only neutral terms',
        sourceSha256:'7kpa-contact-capture', system:{
          nonbonded:captureMolecule.atoms.map((_, index) => ({ index,
            charge_e:0, sigma_nm:0.30, epsilon_kj:0.10 })),
        },
      };
      api.loadObject(captureMolecule);
      api.setDockingMode('propagate');
      const hydratedReference = await api.captureDockingReference();
      preparationMetrics.hydratedReferenceContacts = hydratedReference.hydrogenBonds;
      const capturedLabels = hydratedReference.hydrogenBonds.map((entry) => entry.label);
      const expectedHydratedLabels = [
        'D84 C201 N3 → HOH C307 O',
        'SER A60 N → D84 C201 O2',
        'TYR C151 OH → D84 C201 N2',
        'LYS A11 NZ → D84 C201 O3',
      ];
      check(capturedLabels.length === expectedHydratedLabels.length
        && expectedHydratedLabels.every((label) => capturedLabels.includes(label)),
      'hydrated 7KPA reference capture retains both pyridone contacts beyond the viewer display cap',
      JSON.stringify(capturedLabels));
      // Exact user regression: first saturate the two pyridone C=C bonds,
      // delete that ring, build a valid cyclohexanol in a later commit, and
      // only then assign C=O in a third commit. The Lys->O3 hypothesis must
      // follow the exact replacement carbonyl across the cumulative edit
      // region; the deleted N3-H->water hypothesis must remain unavailable.
      const capturedHydratedMolecule = api.current().molecule;
      const referenceLigandIds = new Set(capturedHydratedMolecule.atoms
        .filter((atom) => atom.record === 'HETATM' && atom.residueName === 'D84')
        .map((atom) => atom.designAtomId));
      const originalO3Id = capturedHydratedMolecule.atoms.find((atom) =>
        atom.record === 'HETATM' && atom.residueName === 'D84' && atom.atomName === 'O3')?.designAtomId;
      const originalO2Id = capturedHydratedMolecule.atoms.find((atom) =>
        atom.record === 'HETATM' && atom.residueName === 'D84' && atom.atomName === 'O2')?.designAtomId;
      const originalC23Id = capturedHydratedMolecule.atoms.find((atom) =>
        atom.record === 'HETATM' && atom.residueName === 'D84' && atom.atomName === 'C23')?.designAtomId;
      const d84Index = (name) => api.current().molecule.atoms.findIndex((atom) =>
        atom.record === 'HETATM' && atom.residueName === 'D84' && atom.atomName === name);
      const o3Contact = hydratedReference.hydrogenBonds.find((entry) =>
        entry.label === 'LYS A11 NZ → D84 C201 O3');
      const n3Contact = hydratedReference.hydrogenBonds.find((entry) =>
        entry.label === 'D84 C201 N3 → HOH C307 O');
      // Preferred chemist route: keep graph identity, saturate the two C=C
      // bonds, then change the lactam N-H into cyclohexanone CH2. Execute the
      // complete edit through the public Chemist Actions surface so this is
      // the same route available to an agent or a person, not a test-only
      // direct call into pose code.
      const chemist = await window.MolariumChemistActionsReady;
      const directReferenceLigand = api.benchmarkCurrentLigand();
      await chemist.execute({ action:'view.setMode', args:{ mode:'build' } });
      await chemist.execute({ action:'build.setTool', args:{ tool:'select' } });
      const directReference = (await chemist.inspect({ scope:'ligand', includeCoordinates:true,
        maximumAtoms:200 })).result;
      const directByName = new Map(directReference.atoms.map((atom) => [atom.atomName, atom]));
      const directRequiredNames = ['C23','O3','C28','N3','C26','C27','C29','C30'];
      if (directRequiredNames.some((name) => !directByName.has(name)))
        throw new Error('7KPA direct-edit regression cannot find: '
          + directRequiredNames.filter((name) => !directByName.has(name)).join(', '));
      const directSelect = async (...names) => chemist.execute({ action:'selection.replace',
        args:{ atomIds:names.map((name) => directByName.get(name).atomId) } });
      await directSelect('C26','C27');
      await chemist.execute({ action:'chemistry.setBond', args:{ order:1 } });
      await directSelect('C30','C29');
      await chemist.execute({ action:'chemistry.setBond', args:{ order:1 } });
      const directLactamFinish = await chemist.execute({ action:'chemistry.finish' });
      const directLactam = (await chemist.inspect({ scope:'ligand', includeCoordinates:true,
        maximumAtoms:200 })).result;
      if (diagnoseLactamPose) {
        preparationMetrics.lactamRefinement =
          (await chemist.execute({ action:'pose.refine', args:{ searchChains:8 } })).result.refinement;
        const lactamPoseText = document.querySelector('.docking-pose')?.textContent || '';
        const lactamScoreNote = document.querySelector('#docking-score-note')?.textContent || '';
        const lactam = preparationMetrics.lactamRefinement;
        check(lactam.selectedPhysicalComponents?.lennardJonesKcalMol > 100
          && lactam.selectedPhysicalComponents.ligandStrainKcalMol < 10
          && lactam.selectedPhysicalComponents.relativeInteractionKcalMol <= 100
          && lactam.selectedConstraintPenaltyKcalMol < 5
          && lactam.selectedChemicalValidity?.maximumAdditionalLennardJonesKcalMol === 100
          && lactam.selectedChemicalValidity?.lennardJonesExcessKcalMol === 0
          && lactam.selectedChemicalValidity?.minimumFixedCoreStartStericClashes >= 1
          && lactamPoseText.includes('contact missed')
          && !lactamPoseText.includes('kcal/mol')
          && lactamScoreNote.includes('start'),
        '7KPA lactam refinement separates inherited clash baseline from ligand strain and restraint failure',
        JSON.stringify({ lactam, lactamPoseText, lactamScoreNote }));
      }
      await directSelect('N3');
      await chemist.execute({ action:'chemistry.setAtom', args:{ element:'C', formalCharge:0 } });
      const directCyclohexanoneFinish = await chemist.execute({ action:'chemistry.finish' });
      const directCyclohexanone = (await chemist.inspect({ scope:'ligand', includeCoordinates:true,
        maximumAtoms:200 })).result;
      const liveDirectByName = new Map(directCyclohexanone.atoms.map((atom) => [atom.atomName, atom]));
      const releasedIds = new Set(directCyclohexanone.transformedRingRegions
        .flatMap((entry) => entry.releasedHeavyAtomIds || []));
      const ringIds = ['O3','C28','N3','C26','C27','C29','C30']
        .map((name) => directByName.get(name).atomId);
      const c23Before = directByName.get('C23').coordinatesAngstrom;
      const c23After = liveDirectByName.get('C23').coordinatesAngstrom;
      const externalAnchorMotion = Math.hypot(...c23Before.map((value, axis) =>
        value - c23After[axis]));
      const releasedMotion = Math.max(...ringIds.map((id) => {
        const before = directReference.atoms.find((atom) => atom.atomId === id)?.coordinatesAngstrom;
        const after = directCyclohexanone.atoms.find((atom) => atom.atomId === id)?.coordinatesAngstrom;
        return before && after ? Math.hypot(...before.map((value, axis) => value - after[axis])) : 0;
      }));
      const directO3Id = directByName.get('O3').atomId;
      const directC28Id = directByName.get('C28').atomId;
      const finalCarbonyl = directCyclohexanone.bonds.find((bond) =>
        bond.atomIds.includes(directO3Id) && bond.atomIds.includes(directC28Id));
      const directO3Contact = directCyclohexanone.contacts.find((entry) =>
        entry.contactId === o3Contact?.id);
      const directN3Contact = directCyclohexanone.contacts.find((entry) =>
        entry.contactId === n3Contact?.id);
      check(directLactamFinish.result.validation?.valid
        && directCyclohexanoneFinish.result.validation?.valid
        && directCyclohexanone.atoms.find((atom) => atom.atomId === directByName.get('N3').atomId)?.element === 'C'
        && Number(finalCarbonyl?.order) === 2
        && ringIds.every((id) => releasedIds.has(id))
        && !releasedIds.has(directByName.get('C23').atomId)
        && externalAnchorMotion < 1e-7 && releasedMotion > 1e-3
        && directO3Contact?.available && directO3Contact.required
        && directN3Contact && !directN3Contact.available,
      '7KPA direct saturation and N-to-CH2 edit releases the transformed ring while preserving its scaffold and carbonyl hypothesis',
      JSON.stringify({ directLactamFinish, directLactam,
        directCyclohexanoneFinish,
        transformedRingRegions:directCyclohexanone.transformedRingRegions,
        externalAnchorMotion, releasedMotion, finalCarbonyl,
        directO3Contact, directN3Contact }));
      // An explicit validation-only export can compare the edited bound
      // geometry against the crystallographic parent with the same isolated-
      // ligand strain protocol. It deliberately omits the receptor, so this
      // fixture is not an interaction or binding score.
      const directLigand = api.benchmarkCurrentLigand();
      const editedStrainMolecule = { name:'7KPA D84 cyclohexanone strain probe', charge:0,
        multiplicity:1,
        atoms:directLigand.atoms.map((atom) => ({ element:atom.element,
          designAtomId:atom.designAtomId, atomName:atom.atomName,
          x:atom.x, y:atom.y, z:atom.z, charge:0 })),
        bonds:directLigand.bonds.map((bond) => ({ ...bond })) };
      const referenceStrainMolecule = { name:'7KPA D84 crystallographic strain control',
        charge:0, multiplicity:1,
        atoms:directReferenceLigand.atoms.map((atom) => ({ element:atom.element,
          designAtomId:atom.designAtomId, atomName:atom.atomName,
          x:atom.x, y:atom.y, z:atom.z, charge:0 })),
        bonds:directReferenceLigand.bonds.map((bond) => ({ ...bond })) };
      preparationMetrics.cyclohexanoneStrainFixture = exportStrainFixture
        ? { reference:referenceStrainMolecule, edited:editedStrainMolecule } : null;
      // Restore the exact prepared reference before independently testing the
      // harder delete-and-rebuild feature-remapping route below.
      api.loadObject(captureMolecule);
      await chemist.execute({ action:'view.setMode', args:{ mode:'build' } });
      await chemist.execute({ action:'build.setTool', args:{ tool:'select' } });
      await chemist.execute({ action:'pose.captureReference', args:{ mode:'propagate' } });
      const saturationIndices = ['C26', 'C27', 'C30', 'C29'].map((name) => [name, d84Index(name)]);
      if (saturationIndices.some(([, index]) => index < 0))
        throw new Error('7KPA regression cannot find pyridone atoms: ' + JSON.stringify(saturationIndices));
      await api.stageBondCurrent(saturationIndices[0][1], saturationIndices[1][1], 1);
      await api.stageBondCurrent(d84Index('C30'), d84Index('C29'), 1);
      const saturationFinish = await api.finishChemistryCurrent();
      for (const name of ['O3', 'C28', 'N3', 'C27', 'C29', 'C30', 'C26'])
        await api.stageDeleteAtomCurrent(d84Index(name));
      const ringDeletionFinish = await api.finishChemistryCurrent();
      const deletedRingState = api.dockingContactResolutions();
      const scaffoldAnchor = d84Index('C23');
      const addPendingCarbon = async (target) => {
        const beforeIds = new Set(api.current().molecule.atoms.map((atom) => atom.designAtomId));
        await api.stageAddElementCurrent('C', target);
        return api.current().molecule.atoms.findIndex((atom) => atom.element === 'C'
          && !beforeIds.has(atom.designAtomId));
      };
      const ringC4 = await addPendingCarbon(scaffoldAnchor);
      const ringC3 = await addPendingCarbon(ringC4);
      const ringC2 = await addPendingCarbon(ringC3);
      const ringC1 = await addPendingCarbon(ringC2);
      const ringC6 = await addPendingCarbon(ringC1);
      const ringC5 = await addPendingCarbon(ringC6);
      await api.stageBondCurrent(ringC5, ringC4, 1);
      const beforeOxygenIds = new Set(api.current().molecule.atoms.map((atom) => atom.designAtomId));
      await api.stageAddElementCurrent('O', ringC1);
      const stagedOxygen = api.current().molecule.atoms.findIndex((atom) => atom.element === 'O'
        && !beforeOxygenIds.has(atom.designAtomId));
      const stagedOxygenId = api.current().molecule.atoms[stagedOxygen]?.designAtomId;
      const cyclohexanolFinish = await api.finishChemistryCurrent();
      const intermediateContactState = api.dockingContactResolutions();
      const liveAfterAlcohol = api.current().molecule;
      const replacementOxygen = liveAfterAlcohol.atoms.findIndex((atom) => atom.element === 'O'
        && atom.record === 'HETATM' && !referenceLigandIds.has(atom.designAtomId)
        && atom.designAtomId === stagedOxygenId);
      const replacementCarbon = liveAfterAlcohol.bonds.flatMap((bond) => bond.a === replacementOxygen
        ? [bond.b] : bond.b === replacementOxygen ? [bond.a] : [])
        .find((index) => liveAfterAlcohol.atoms[index]?.element === 'C');
      const alcoholBond = liveAfterAlcohol.bonds.find((bond) =>
        bond.a === replacementOxygen && bond.b === replacementCarbon
        || bond.b === replacementOxygen && bond.a === replacementCarbon);
      const alcoholHasHydrogen = liveAfterAlcohol.bonds.some((bond) =>
        (bond.a === replacementOxygen && liveAfterAlcohol.atoms[bond.b]?.element === 'H')
        || (bond.b === replacementOxygen && liveAfterAlcohol.atoms[bond.a]?.element === 'H'));
      await api.stageBondCurrent(replacementCarbon, replacementOxygen, 2);
      const carbonylFinish = await api.finishChemistryCurrent();
      const cumulativeContactState = api.dockingContactResolutions();
      const o3Remap = cumulativeContactState.remaps.find((entry) => entry.contactId === o3Contact?.id);
      const o3RemapChain = cumulativeContactState.remapChains
        .find((entry) => entry.contactId === o3Contact?.id)?.chain || [];
      const unresolvedN3 = cumulativeContactState.proposals.find((entry) => entry.id === n3Contact?.id);
      const intermediateO3 = intermediateContactState.remaps
        .find((entry) => entry.contactId === o3Contact?.id);
      const intermediateN3 = intermediateContactState.remaps
        .find((entry) => entry.contactId === n3Contact?.id);
      const finalMolecule = api.current().molecule;
      const finalOxygen = finalMolecule.atoms.findIndex((atom) => atom.designAtomId === stagedOxygenId);
      const finalComponent = new Set([finalOxygen]), componentQueue = [finalOxygen];
      while (componentQueue.length) {
        const index = componentQueue.shift();
        finalMolecule.bonds.forEach((bond) => {
          const neighbor = bond.a === index ? bond.b : bond.b === index ? bond.a : -1;
          if (neighbor >= 0 && !finalComponent.has(neighbor)) {
            finalComponent.add(neighbor); componentQueue.push(neighbor);
          }
        });
      }
      const expectedCumulativeIds = [...finalComponent]
        .map((index) => finalMolecule.atoms[index]?.designAtomId)
        .filter((id) => id && !referenceLigandIds.has(id)).sort();
      check(saturationFinish.validation.valid && ringDeletionFinish.validation.valid
        && cyclohexanolFinish.validation.valid && carbonylFinish.validation.valid
        && alcoholBond?.order === 1 && alcoholHasHydrogen
        && deletedRingState.proposals.some((entry) => entry.id === o3Contact?.id
          && entry.status === 'unavailable')
        && intermediateContactState.proposals.length === 0
        && intermediateO3?.method === 'automatic-unique-role-compatible'
        && intermediateO3?.matchKind === 'role-compatible-bioisostere'
        && intermediateO3?.cumulativeEditRegionAtomIds.length >= 7
        && intermediateN3?.method === 'automatic-unique-role-compatible'
        && intermediateN3?.matchKind === 'role-compatible-bioisostere'
        && cumulativeContactState.remaps.length === 1
        && o3Remap?.method === 'automatic-unique-role-compatible'
        && o3Remap?.matchKind === 'role-compatible-bioisostere'
        && o3Remap?.algorithm === 'role-compatible-edit-boundary/v3'
        && o3Remap.candidateIds.length === 1
        && o3RemapChain.length === 2
        && JSON.stringify(o3RemapChain[0].boundaryAnchorIds) === JSON.stringify([originalC23Id])
        && o3RemapChain[0].cumulativeEditRegionAtomIds.includes(stagedOxygenId)
        && !o3RemapChain[0].cumulativeEditRegionAtomIds.includes(originalC23Id)
        && !o3RemapChain[0].cumulativeEditRegionAtomIds.includes(originalO2Id)
        && o3RemapChain.flatMap((entry) => entry.editLineage).length === 3
        && o3RemapChain.flatMap((entry) => entry.editLineage).every((entry) =>
          entry.committedEditId && entry.beforeTopologySha256 && entry.afterTopologySha256)
        && o3RemapChain[0].originalLigandAtomIds.includes(originalO3Id)
        && o3RemapChain.every((entry) => entry.replacementLigandAtomIds.includes(stagedOxygenId))
        && o3Remap.replacementLigandAtomIds.includes(stagedOxygenId)
        && unresolvedN3?.status === 'unavailable',
      '7KPA saturate-delete-build-C=O sequence tracks role-compatible OH hypotheses then retains only the carbonyl acceptor',
      JSON.stringify({ validation:[saturationFinish, ringDeletionFinish, cyclohexanolFinish,
        carbonylFinish].map((entry) => entry.validation), deletedRingState,
        intermediateContactState, cumulativeContactState, o3RemapChain,
        originalO3Id, stagedOxygenId,
        originalC23Id, originalO2Id, replacementOxygen, replacementCarbon,
        alcoholBond, alcoholHasHydrogen, expectedCumulativeIds }));
      api.loadObject(preview.molecule);
      api.setRepresentation('cartoon');
    }
    const contactOnly7kpa = api.setPocketAtomMode('contacts');
    preparationMetrics.contactOnlyPocket = contactOnly7kpa;
    check(contactOnly7kpa.residueKeys.length === 3 && contactOnly7kpa.radiusResidueCount === 36
      && contactOnly7kpa.residueKeys.includes('C:151:')
      && contactOnly7kpa.pocketAtomCount < preparationMetrics.pocket.pocketAtomCount
      && contactOnly7kpa.ligandHydrogenBondCount === 3,
    '7KPA contact-only pocket hides non-interacting 5 Å residues while retaining dashed ligand contacts',
    JSON.stringify(contactOnly7kpa));
    api.setPocketAtomMode('radius');
    const preparedHydrogenCount = preview.molecule.atoms.filter((atom) => atom.element === 'H').length;
    check(document.querySelector('#hydrogen-toggle-text').textContent.includes(preparedHydrogenCount.toLocaleString())
      && document.querySelector('#interaction-toggle-text').textContent.includes('ligand contacts'),
    'prepared 7KPA reports its loaded hydrogens and visible ligand-contact count in the controls',
    document.querySelector('#interaction-toggle-text').textContent);
    preparationMetrics.cartoonViewer = api.benchmarkViewer(3);
    check(preparationMetrics.cartoonViewer.meanMs < 100,
      '7KPA cartoon rendering keeps atom-level work scoped to ligand and pocket residues', JSON.stringify(preparationMetrics));
    const d84Atom = (name) => preview.molecule.atoms.findIndex((atom) => atom.record === 'HETATM'
      && atom.residueName === 'D84' && atom.atomName === name);
    const d84Carbon = d84Atom('C28'), d84Oxygen = d84Atom('O3'), d84Nitrogen = d84Atom('N3');
    const d84CarbonylSingle = await api.editBondCurrent(d84Carbon, d84Oxygen, 1);
    const d84Pyridinol = await api.editBondCurrent(d84Carbon, d84Nitrogen, 2);
    const d84AttachedHydrogens = (name) => {
      const atomIndex = d84Pyridinol.molecule.atoms.findIndex((atom) => atom.record === 'HETATM'
        && atom.residueName === 'D84' && atom.atomName === name);
      return d84Pyridinol.molecule.bonds.flatMap((bond) => bond.a === atomIndex
        ? [bond.b] : bond.b === atomIndex ? [bond.a] : [])
        .filter((index) => d84Pyridinol.molecule.atoms[index].element === 'H').length;
    };
    const d84FinalAtom = (name) => d84Pyridinol.molecule.atoms.findIndex((atom) => atom.record === 'HETATM'
      && atom.residueName === 'D84' && atom.atomName === name);
    const d84FinalOxygen = d84FinalAtom('O3'), d84FinalCarbon = d84FinalAtom('C28');
    const d84FinalHydrogen = d84Pyridinol.molecule.bonds.flatMap((bond) => bond.a === d84FinalOxygen
      ? [bond.b] : bond.b === d84FinalOxygen ? [bond.a] : [])
      .find((index) => d84Pyridinol.molecule.atoms[index].element === 'H');
    const d84Vector = (index) => ({
      x:d84Pyridinol.molecule.atoms[index].x - d84Pyridinol.molecule.atoms[d84FinalOxygen].x,
      y:d84Pyridinol.molecule.atoms[index].y - d84Pyridinol.molecule.atoms[d84FinalOxygen].y,
      z:d84Pyridinol.molecule.atoms[index].z - d84Pyridinol.molecule.atoms[d84FinalOxygen].z,
    });
    const d84AnchorVector = d84Vector(d84FinalCarbon), d84HydrogenVector = d84Vector(d84FinalHydrogen);
    const d84OhLength = Math.hypot(d84HydrogenVector.x, d84HydrogenVector.y, d84HydrogenVector.z);
    const d84OhAngle = Math.acos(Math.max(-1, Math.min(1,
      (d84AnchorVector.x * d84HydrogenVector.x + d84AnchorVector.y * d84HydrogenVector.y
        + d84AnchorVector.z * d84HydrogenVector.z)
      / (Math.hypot(d84AnchorVector.x, d84AnchorVector.y, d84AnchorVector.z) * d84OhLength)))) * 180 / Math.PI;
    check(d84CarbonylSingle.validation.valid && d84Pyridinol.validation.valid
      && d84Pyridinol.valenceViolations.length === 0
      && d84AttachedHydrogens('O3') === 1 && d84AttachedHydrogens('N3') === 0
      && Math.abs(d84OhLength - 0.98) < 1e-6
      && Math.abs(d84OhAngle - 108.5) < 1e-5,
    'prepared 7KPA D84 supports the pyridone-to-pyridinol edit with a bent O-H seed',
    JSON.stringify({ carbonyl:d84CarbonylSingle.validation, pyridinol:d84Pyridinol.validation,
      oxygenHydrogens:d84AttachedHydrogens('O3'), nitrogenHydrogens:d84AttachedHydrogens('N3'),
      ohAngle:d84OhAngle, violations:d84Pyridinol.valenceViolations }));
    api.loadObject(preview.molecule);
    api.setRepresentation('cartoon');
    if (externalPreparationFixture.parameterize) {
      if (preview.audit.blockers.length) {
        check(true, '7KPA safety gate refuses parameterization while preparation blockers remain',
          JSON.stringify(preparationMetrics));
      } else {
        const energy = await api.calculateCurrent('energy', 'openmm');
        preparationMetrics.openmmEnergy = energy.finalEnergy;
        preparationMetrics.openmmAtoms = energy.parameterCounts?.particles;
        preparationMetrics.openmmElapsedMs = energy.elapsedMs;
        check(energy.parameterCounts?.particles === preview.molecule.atoms.length
          && Number.isFinite(energy.finalEnergy) && Math.abs(energy.finalEnergy) < 1e8
          && energy.backend === 'OpenMM WebAssembly',
        '7KPA prepared complex reaches a finite, sanity-bounded OpenMM Reference WASM single point', JSON.stringify(preparationMetrics));
        const minimization = await api.calculateCurrent('geometry', 'openmm', { maxIterations: 50, tolerance: 10 });
        preparationMetrics.openmmMinimizedEnergy = minimization.finalEnergy;
        preparationMetrics.openmmMinimizationMs = minimization.elapsedMs;
        check(Number.isFinite(minimization.finalEnergy) && minimization.finalEnergy < energy.finalEnergy,
          '7KPA prepared complex begins stable local OpenMM Reference WASM minimization', JSON.stringify(preparationMetrics));
      }
    }
    if (testScope === '7kpa-contact-capture') {
      const scopedChecks = checks.filter((item) =>
        item.label.includes('Lys A11 N-H to D84 pyridone O3')
        || item.label.includes('hydrated 7KPA reference capture')
        || item.label.includes('7KPA lactam refinement separates')
        || item.label.includes('7KPA direct saturation and N-to-CH2 edit')
        || item.label.includes('7KPA saturate-delete-build-C=O sequence'));
      const failed = scopedChecks.filter((item) => !item.passed);
      return { passed:scopedChecks.length - failed.length, total:scopedChecks.length, failed,
        optimizationMetrics, rdkitMetrics, aniMetrics, webgpuMetrics, rosemaryMetrics,
        preparationMetrics:{ ligandContacts:preparationMetrics.ligandContacts,
          hydratedReferenceContacts:preparationMetrics.hydratedReferenceContacts,
          lactamRefinement:preparationMetrics.lactamRefinement || null,
          cyclohexanoneStrainFixture:preparationMetrics.cyclohexanoneStrainFixture } };
    }
  }
  const smilesCases = [
    ['O', 'H2O', 0],
    ['CCO', 'C2H6O', 0],
    ['c1ccccc1', 'C6H6', 0],
    ['Cc1ccccc1', 'C7H8', 0],
    ['CC(C)C', 'C4H10', 0],
    ['CC(=O)O', 'C2H4O2', 0],
    ['[NH4+]', 'H4N', 1],
    ['Cn1c(=O)c2c(ncn2C)n(C)c1=O', 'C8H10N4O2', 0],
    ['CC(=O)Oc1ccccc1C(=O)O', 'C9H8O4', 0],
  ];
  for (const [smiles, formula, charge] of smilesCases) {
    const result = api.parse(smiles);
    check(result.formula === formula, 'SMILES formula: ' + smiles, result.formula);
    check(result.charge === charge, 'SMILES charge: ' + smiles, String(result.charge));
    check(result.finite, 'finite coordinates: ' + smiles);
    check(result.valenceViolations.length === 0, 'valid valences: ' + smiles, JSON.stringify(result.valenceViolations));
  }

  check(['chemistry-element', 'chemistry-formal-charge', 'chemistry-bond-order',
    'apply-atom-chemistry', 'apply-bond-chemistry', 'delete-bond-chemistry',
    'add-explicit-hydrogen', 'remove-explicit-hydrogen', 'delete-selected-atom']
    .every((id) => document.getElementById(id)),
  'Build exposes atom identity, formal charge, bond-order, bond topology, and explicit-H controls');
  api.load('CC');
  const buildCameraBefore = api.viewerState();
  api.setInternalCoordinate([0, 1], 3, true);
  const buildCameraAfter = api.viewerState();
  check(Math.abs(buildCameraAfter.scale - buildCameraBefore.scale) < 1e-9
    && Math.hypot(buildCameraAfter.center.x - buildCameraBefore.center.x,
      buildCameraAfter.center.y - buildCameraBefore.center.y,
      buildCameraAfter.center.z - buildCameraBefore.center.z) < 1e-9,
  'Build modifications preserve the current camera frame instead of auto-zooming',
  JSON.stringify({ before:buildCameraBefore, after:buildCameraAfter }));
  const bondedHydrogenIndices = (molecule, atomIndex) => molecule.bonds.flatMap((bond) => bond.a === atomIndex
    ? [bond.b] : bond.b === atomIndex ? [bond.a] : [])
    .filter((index) => molecule.atoms[index].element === 'H');
  const atomDistance = (molecule, first, second) => Math.hypot(
    molecule.atoms[first].x - molecule.atoms[second].x,
    molecule.atoms[first].y - molecule.atoms[second].y,
    molecule.atoms[first].z - molecule.atoms[second].z);
  const atomAngle = (molecule, first, center, last) => {
    const vector = (index) => ({ x:molecule.atoms[index].x - molecule.atoms[center].x,
      y:molecule.atoms[index].y - molecule.atoms[center].y,
      z:molecule.atoms[index].z - molecule.atoms[center].z });
    const a = vector(first), b = vector(last);
    return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z)
      / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z))))) * 180 / Math.PI;
  };

  api.load('CC');
  const etheneEdit = await api.editBondCurrent(0, 1, 2);
  check(etheneEdit.formula === 'C2H4' && etheneEdit.charge === 0
    && etheneEdit.molecule.bonds.some((bond) => bond.a < 2 && bond.b < 2 && bond.order === 2)
    && etheneEdit.valenceViolations.length === 0 && etheneEdit.validation.valid,
  'changing a bond to double reconciles explicit hydrogens and sanitizes ethene', JSON.stringify(etheneEdit.validation));
  const ethyneEdit = await api.editBondCurrent(0, 1, 3);
  check(ethyneEdit.formula === 'C2H2'
    && ethyneEdit.molecule.bonds.some((bond) => bond.a < 2 && bond.b < 2 && bond.order === 3)
    && ethyneEdit.valenceViolations.length === 0 && ethyneEdit.validation.valid,
  'changing a bond to triple reconciles explicit hydrogens and sanitizes ethyne', JSON.stringify(ethyneEdit.validation));
  const ethaneEdit = await api.editBondCurrent(0, 1, 1);
  check(ethaneEdit.formula === 'C2H6' && ethaneEdit.valenceViolations.length === 0
    && ethaneEdit.validation.valid,
  'restoring a single bond restores the carbon valences', JSON.stringify(ethaneEdit.validation));

  api.load('N');
  const ammoniumEdit = await api.editAtomCurrent(0, 'N', 1);
  const ammoniumHydrogens = bondedHydrogenIndices(ammoniumEdit.molecule, 0);
  const ammoniumBondLengths = ammoniumHydrogens.map((index) =>
    atomDistance(ammoniumEdit.molecule, 0, index));
  const ammoniumAngles = ammoniumHydrogens.flatMap((first, position) =>
    ammoniumHydrogens.slice(position + 1).map((second) => atomAngle(ammoniumEdit.molecule, first, 0, second)));
  check(ammoniumEdit.formula === 'H4N' && ammoniumEdit.charge === 1
    && ammoniumEdit.molecule.atoms[0].formalCharge === 1
    && ammoniumEdit.valenceViolations.length === 0 && ammoniumEdit.validation.valid
    && ammoniumBondLengths.every((length) => length > 0.95 && length < 1.10)
    // The local MMFF/UFF polish is allowed to move the ideal construction by
    // sub-millidegrees; test tetrahedral chemistry, not floating-point identity.
    && ammoniumAngles.every((angle) => Math.abs(angle - 109.4712206) < 1e-3),
  'formal-charge editing produces a sanitized tetrahedral explicit ammonium ion',
  JSON.stringify({ validation:ammoniumEdit.validation,
    bondLengths:ammoniumBondLengths, angles:ammoniumAngles }));

  api.load('C');
  const waterEdit = await api.editAtomCurrent(0, 'O', 0);
  const waterHydrogens = bondedHydrogenIndices(waterEdit.molecule, 0);
  const waterBondLengths = waterHydrogens.map((index) =>
    atomDistance(waterEdit.molecule, 0, index));
  const waterAngle = atomAngle(waterEdit.molecule, waterHydrogens[0], 0, waterHydrogens[1]);
  check(waterEdit.formula === 'H2O' && waterEdit.molecule.atoms[0].element === 'O'
    && waterEdit.valenceViolations.length === 0 && waterEdit.validation.valid
    && api.structureComponents().components[0]?.atomCount === waterEdit.atoms
    && waterBondLengths.every((length) => length > 0.90 && length < 1.05)
    // Isolated-water force fields do not share one exact gas-phase angle. The
    // invariant here is a chemically bent, non-linear H-O-H geometry.
    && waterAngle > 100 && waterAngle < 110,
  'element replacement reconciles methane into sanitized bent water geometry',
  JSON.stringify({ validation:waterEdit.validation, bondLengths:waterBondLengths, angle:waterAngle,
    components:api.structureComponents() }));

  api.load('C.C');
  const createdBond = await api.editBondCurrent(0, 1, 1);
  check(createdBond.formula === 'C2H6' && createdBond.components === 1
    && createdBond.valenceViolations.length === 0 && createdBond.validation.valid,
  'a selected unbonded atom pair can be joined with a chemically valid bond', JSON.stringify(createdBond.validation));
  const deletedBond = await api.deleteBondCurrent(0, 1);
  check(deletedBond.formula === 'C2H8' && deletedBond.components === 2
    && deletedBond.valenceViolations.length === 0 && deletedBond.validation.valid,
  'deleting a bond separates components and restores their open valences', JSON.stringify(deletedBond.validation));

  api.load('C');
  const openValence = await api.removeHydrogenCurrent(0);
  check(openValence.formula === 'CH3' && !openValence.validation.valid
    && openValence.valenceViolations.length === 1,
  'explicit hydrogen removal retains an intentional open-valence intermediate', JSON.stringify(openValence.validation));
  const closedValence = await api.addHydrogenCurrent(0);
  check(closedValence.formula === 'CH4' && closedValence.validation.valid
    && closedValence.valenceViolations.length === 0,
  'explicit hydrogen addition closes and sanitizes the intermediate', JSON.stringify(closedValence.validation));

  api.load('c1ccccc1');
  const kekuleEdit = await api.editBondCurrent(0, 1, 2);
  const kekuleRingBonds = kekuleEdit.molecule.bonds.filter((bond) => bond.a < 6 && bond.b < 6);
  check(kekuleEdit.formula === 'C6H6' && kekuleRingBonds.filter((bond) => bond.order === 2).length === 3
    && kekuleRingBonds.filter((bond) => bond.order === 1).length === 3
    && kekuleEdit.molecule.atoms.slice(0, 6).every((atom) => !atom.aromatic)
    && kekuleEdit.validation.valid,
  'editing an aromatic ring edge creates a complete alternating Kekule ring', JSON.stringify(kekuleRingBonds));
  const aromaticEdit = await api.editBondCurrent(0, 1, 1.5);
  const aromaticRingBonds = aromaticEdit.molecule.bonds.filter((bond) => bond.a < 6 && bond.b < 6);
  check(aromaticRingBonds.length === 6 && aromaticRingBonds.every((bond) => bond.order === 1.5)
    && aromaticEdit.molecule.atoms.slice(0, 6).every((atom) => atom.aromatic)
    && aromaticEdit.validation.valid,
  'setting aromatic order restores the whole aromatic ring rather than one fractional bond', JSON.stringify(aromaticRingBonds));

  api.load('O=C1NC=CC=C1');
  const pyridone = api.current().molecule;
  const pyridoneCarbonyl = pyridone.bonds.find((bond) => bond.order === 2
    && [pyridone.atoms[bond.a].element, pyridone.atoms[bond.b].element].sort().join('') === 'CO');
  const pyridoneOxygen = pyridone.atoms[pyridoneCarbonyl.a].element === 'O'
    ? pyridoneCarbonyl.a : pyridoneCarbonyl.b;
  const pyridoneCarbon = pyridoneCarbonyl.a === pyridoneOxygen ? pyridoneCarbonyl.b : pyridoneCarbonyl.a;
  const pyridoneNitrogen = pyridone.bonds.flatMap((bond) => bond.a === pyridoneCarbon
    ? [bond.b] : bond.b === pyridoneCarbon ? [bond.a] : [])
    .find((index) => pyridone.atoms[index].element === 'N');
  const attachedHydrogens = (molecule, atomIndex) => molecule.bonds.flatMap((bond) => bond.a === atomIndex
    ? [bond.b] : bond.b === atomIndex ? [bond.a] : [])
    .filter((index) => molecule.atoms[index].element === 'H').length;
  const pyridoneCoordinates = JSON.stringify(pyridone.atoms.map((atom) => [atom.x, atom.y, atom.z]));
  const pyridoneHydrogenCount = pyridone.atoms.filter((atom) => atom.element === 'H').length;
  await api.stageBondCurrent(pyridoneCarbon, pyridoneOxygen, 1);
  const discarded = api.discardChemistryCurrent();
  const discardedPyridone = api.current().molecule;
  check(discarded && !api.chemistryTransaction()
    && discardedPyridone.bonds.some((bond) => ((bond.a === pyridoneCarbon && bond.b === pyridoneOxygen)
      || (bond.b === pyridoneCarbon && bond.a === pyridoneOxygen)) && Number(bond.order) === 2)
    && JSON.stringify(discardedPyridone.atoms.map((atom) => [atom.x, atom.y, atom.z])) === pyridoneCoordinates
    && document.querySelector('#chemistry-pending').classList.contains('hidden'),
  'Discard restores the exact pre-edit topology and coordinates');
  const pyridinolIntermediate = await api.stageBondCurrent(pyridoneCarbon, pyridoneOxygen, 1);
  const afterCarbonylStage = api.current().molecule;
  check(pyridinolIntermediate.validation.pending && api.chemistryTransaction()?.editCount === 1
    && afterCarbonylStage.atoms.filter((atom) => atom.element === 'H').length === pyridoneHydrogenCount
    && attachedHydrogens(afterCarbonylStage, pyridoneOxygen) === 0
    && JSON.stringify(afterCarbonylStage.atoms.map((atom) => [atom.x, atom.y, atom.z])) === pyridoneCoordinates
    && !document.querySelector('#chemistry-pending').classList.contains('hidden')
    && !document.querySelector('#viewer-finish-chemistry').classList.contains('hidden')
    && !document.querySelector('#viewer-discard-chemistry').classList.contains('hidden')
    && document.querySelector('#export-button').classList.contains('hidden')
    && !document.querySelector('#fullscreen-button').classList.contains('hidden')
    && document.querySelector('#optimize-button').disabled
    && !document.querySelector('#chemistry-immediate-refine').checked,
  'a staged edit preserves geometry and promotes Finish chemistry into the viewer toolbar');
  const stagedPyridinol = await api.stageBondCurrent(pyridoneCarbon, pyridoneNitrogen, 2);
  const beforeTautomerFinish = api.current().molecule;
  check(stagedPyridinol.validation.pending && api.chemistryTransaction()?.editCount === 2
    && attachedHydrogens(beforeTautomerFinish, pyridoneOxygen) === 0
    && attachedHydrogens(beforeTautomerFinish, pyridoneNitrogen) === 1
    && JSON.stringify(beforeTautomerFinish.atoms.map((atom) => [atom.x, atom.y, atom.z])) === pyridoneCoordinates,
  'coupled staged bond changes retain the original N-H and geometry until Finish');
  const pyridinol = await api.finishChemistryCurrent();
  const pyridinolHydrogen = bondedHydrogenIndices(pyridinol.molecule, pyridoneOxygen)[0];
  const pyridinolOhAngle = atomAngle(pyridinol.molecule, pyridoneCarbon, pyridoneOxygen, pyridinolHydrogen);
  check(pyridinol.validation.valid && !pyridinol.pending && !api.chemistryTransaction()
    && pyridinol.valenceViolations.length === 0
    && attachedHydrogens(pyridinol.molecule, pyridoneOxygen) === 1
    && attachedHydrogens(pyridinol.molecule, pyridoneNitrogen) === 0
    && Math.abs(atomDistance(pyridinol.molecule, pyridoneOxygen, pyridinolHydrogen) - 0.98) < 0.08
    && pyridinolOhAngle > 90 && pyridinolOhAngle < 125
    && document.querySelector('#chemistry-pending').classList.contains('hidden')
    && document.querySelector('#viewer-finish-chemistry').classList.contains('hidden')
    && !document.querySelector('#export-button').classList.contains('hidden'),
  'Finish transfers pyridone N-H to O-H, validates once, and closes the staged batch',
  JSON.stringify({ final:pyridinol.validation,
    oxygenHydrogens:attachedHydrogens(pyridinol.molecule, pyridoneOxygen),
    nitrogenHydrogens:attachedHydrogens(pyridinol.molecule, pyridoneNitrogen),
    ohAngle:pyridinolOhAngle, violations:pyridinol.valenceViolations }));
  document.querySelector('#undo-atom').click();
  const restoredPyridone = api.current().molecule;
  check(restoredPyridone.bonds.some((bond) => ((bond.a === pyridoneCarbon && bond.b === pyridoneOxygen)
      || (bond.b === pyridoneCarbon && bond.a === pyridoneOxygen)) && Number(bond.order) === 2)
    && bondedHydrogenIndices(restoredPyridone, pyridoneOxygen).length === 0
    && bondedHydrogenIndices(restoredPyridone, pyridoneNitrogen).length === 1,
  'one Undo restores the complete staged tautomer transaction');

  const pyridoneBesideProtectedProtein = structuredClone(pyridone);
  pyridoneBesideProtectedProtein.atoms.push({ element:'N', x:8, y:0, z:0, charge:0,
    record:'ATOM', atomName:'N', residueName:'ALA', residueIndex:1, chain:'A' });
  api.loadObject(pyridoneBesideProtectedProtein);
  const complexCarbonylSingle = await api.editBondCurrent(pyridoneCarbon, pyridoneOxygen, 1);
  const complexPyridinol = await api.editBondCurrent(pyridoneCarbon, pyridoneNitrogen, 2);
  check(complexCarbonylSingle.validation.valid && complexPyridinol.validation.valid
    && complexPyridinol.valenceViolations.length === 0,
  'ligand sanitation is scoped to its connected component and ignores protected protein-template topology',
  JSON.stringify({ intermediate:complexCarbonylSingle.validation, final:complexPyridinol.validation,
    violations:complexPyridinol.valenceViolations }));

  const pdbLigandComplex = structuredClone(pyridone);
  pdbLigandComplex.atoms.forEach((atom, index) => Object.assign(atom, {
    record:'HETATM', atomName:'L' + (index + 1), residueName:'LIG', residueIndex:1, chain:'L',
  }));
  const protectedProteinIndex = pdbLigandComplex.atoms.length;
  pdbLigandComplex.atoms.push({ element:'N', x:8, y:4, z:-3, charge:0,
    record:'ATOM', atomName:'N', residueName:'ALA', residueIndex:8, chain:'A' });
  pdbLigandComplex.source = { format:'pdb', pdbId:'LOCAL-POLISH-TEST' };
  pdbLigandComplex.prediction = { kind:'pdb-import' };
  api.loadObject(pdbLigandComplex);
  const pdbLigandCameraBefore = api.viewerState();
  const protectedProteinAtom = (molecule) => molecule.atoms.find((atom) =>
    atom.record === 'ATOM' && atom.chain === 'A' && atom.residueIndex === 8 && atom.atomName === 'N');
  const protectedProteinPosition = ['x', 'y', 'z'].map((axis) =>
    protectedProteinAtom(api.current().molecule)[axis]);
  check(document.querySelector('#build-optimizer-select').value === 'ligand-rdkit'
    && !document.querySelector('#build-optimizer-select option[value="ligand-rdkit"]').disabled,
  'a protein–ligand complex defaults Build optimization to the safe ligand-only path');
  await api.editBondCurrent(pyridoneCarbon, pyridoneOxygen, 1);
  await api.editBondCurrent(pyridoneCarbon, pyridoneNitrogen, 2);
  const pdbLigandPolish = await new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      const source = api.current().molecule.source || {};
      if (source.lastInteractivePolish) return resolve(source.lastInteractivePolish);
      if (source.lastInteractivePolishError) return reject(new Error(source.lastInteractivePolishError));
      if (performance.now() - started > 10000) return reject(new Error('Timed out waiting for PDB ligand polish'));
      setTimeout(poll, 50);
    };
    poll();
  });
  const protectedAfterLocalPolish = protectedProteinAtom(api.current().molecule);
  const pdbLigandCameraAfter = api.viewerState();
  const protectedLocalDisplacement = Math.hypot(
    protectedAfterLocalPolish.x - protectedProteinPosition[0],
    protectedAfterLocalPolish.y - protectedProteinPosition[1],
    protectedAfterLocalPolish.z - protectedProteinPosition[2]);
  check(pdbLigandPolish.scope === 'ligand component'
    && pdbLigandPolish.proteinFixedAtomCount === 1 && protectedLocalDisplacement < 1e-12
    && Math.abs(pdbLigandCameraAfter.scale - pdbLigandCameraBefore.scale) < 1e-9
    && Math.hypot(pdbLigandCameraAfter.center.x - pdbLigandCameraBefore.center.x,
      pdbLigandCameraAfter.center.y - pdbLigandCameraBefore.center.y,
      pdbLigandCameraAfter.center.z - pdbLigandCameraBefore.center.z) < 1e-9,
  'automatic PDB ligand polish applies the two-shell rule only inside the ligand and fixes protein coordinates',
  JSON.stringify({ pdbLigandPolish, protectedLocalDisplacement,
    cameraBefore:pdbLigandCameraBefore, cameraAfter:pdbLigandCameraAfter }));
  const explicitBuildMethod = document.querySelector('#build-optimizer-select').value;
  const explicitLigandResult = await api.optimizeSelectedBuildCurrent();
  const explicitLigandOptimization = explicitLigandResult.source.lastLigandOptimization || {};
  const explicitLigandFrames = api.calculationFrames();
  const protectedAfterExplicitOptimization = protectedProteinAtom(api.current().molecule);
  const explicitLigandAtomCount = api.current().molecule.atoms.filter((atom) => atom.record !== 'ATOM').length;
  const protectedExplicitDisplacement = Math.hypot(
    protectedAfterExplicitOptimization.x - protectedProteinPosition[0],
    protectedAfterExplicitOptimization.y - protectedProteinPosition[1],
    protectedAfterExplicitOptimization.z - protectedProteinPosition[2]);
  check(explicitLigandOptimization.proteinFixedAtomCount === 1
    && explicitLigandOptimization.atomCount === explicitLigandAtomCount
    && protectedExplicitDisplacement < 1e-12,
  'explicit ligand-only optimization relaxes the complete ligand while keeping the protein bitwise fixed',
  JSON.stringify({ explicitBuildMethod, explicitLigandOptimization, optimization:explicitLigandResult.optimization,
    protectedExplicitDisplacement }));
  check(explicitLigandFrames.count >= 2 && explicitLigandFrames.count <= 26
    && explicitLigandFrames.job === 'geometry'
    && document.querySelector('[data-mode="view"]').classList.contains('active')
    && !document.querySelector('#result-frames').classList.contains('hidden')
    && document.querySelector('#result-frame-heading').textContent.includes('Minimization path')
    && document.querySelector('#result-title').textContent === 'Ligand Optimization',
  'ligand-only Build optimization opens its saved full-complex minimization path in View',
  JSON.stringify(explicitLigandFrames));
  api.selectCalculationFrame(0);
  const protectedAtLigandStart = ['x', 'y', 'z'].map((axis) =>
    protectedProteinAtom(api.current().molecule)[axis]);
  api.selectCalculationFrame(explicitLigandFrames.count - 1);
  const protectedAtLigandFinish = ['x', 'y', 'z'].map((axis) =>
    protectedProteinAtom(api.current().molecule)[axis]);
  check(protectedAtLigandStart.every((value, axis) => value === protectedProteinPosition[axis])
      && protectedAtLigandFinish.every((value, axis) => value === protectedProteinPosition[axis]),
  'every ligand minimization snapshot retains the exact fixed protein coordinates');

  api.load('CC');
  const deletedAtom = await api.deleteAtomCurrent(1);
  check(deletedAtom.formula === 'CH4' && deletedAtom.components === 1
    && deletedAtom.atoms === 5 && deletedAtom.validation.valid,
  'atom deletion removes its attached hydrogens and repairs neighboring valence', JSON.stringify(deletedAtom.validation));

  const toluenePolish = await api.loadSmilesWithRdkit('c1ccccc1C', 'Toluene');
  const toluene = api.current().molecule;
  const tolueneAdjacency = toluene.atoms.map(() => []);
  toluene.bonds.forEach((bond) => {
    tolueneAdjacency[bond.a].push(bond.b); tolueneAdjacency[bond.b].push(bond.a);
  });
  const methylCarbon = toluene.atoms.findIndex((atom, index) => atom.element === 'C'
    && tolueneAdjacency[index].filter((neighbor) => toluene.atoms[neighbor].element === 'H').length === 3);
  const methylHydrogens = tolueneAdjacency[methylCarbon].filter((index) => toluene.atoms[index].element === 'H');
  const minimumMethylHydrogenDistance = Math.min(...methylHydrogens.flatMap((first, position) =>
    methylHydrogens.slice(position + 1).map((second) => Math.hypot(
      toluene.atoms[first].x - toluene.atoms[second].x,
      toluene.atoms[first].y - toluene.atoms[second].y,
      toluene.atoms[first].z - toluene.atoms[second].z))));
  check(toluenePolish.forcefield === 'MMFF94' && !toluenePolish.fallback
    && Number.isFinite(toluenePolish.finalEnergy)
    && minimumMethylHydrogenDistance > 1.5
    && toluenePolish.source.initialGeometryPolish?.engine === 'MMFF94'
    && toluenePolish.source.initialGeometryPolish?.embedding === 'ETKDGv3'
    && toluenePolish.source.initialGeometryPolish?.embeddedConformers >= 1,
  'SMILES loading replaces its rough graph layout with a ranked ETKDGv3/MMFF94 conformer',
  JSON.stringify({ toluenePolish, minimumMethylHydrogenDistance }));
  let invalidRejected = false;
  try { api.parse('c1ccccc'); } catch { invalidRejected = true; }
  check(invalidRejected, 'rejects unclosed rings');

  const fragmentCases = {
    methyl: 'C7H8', ethyl: 'C8H10', isopropyl: 'C9H12', 'tert-butyl': 'C10H14',
    formyl: 'C7H6O', hydroxyl: 'C6H6O', carboxyl: 'C7H6O2', ethynyl: 'C8H6',
    trifluoromethyl: 'C7H5F3', cyano: 'C7H5N', amino: 'C6H7N', phenyl: 'C12H10',
  };
  for (const [fragment, formula] of Object.entries(fragmentCases)) {
    const result = api.attach('c1ccccc1', fragment, 0);
    check(result.formula === formula, 'fragment formula: ' + fragment, result.formula);
    check(result.components === 1, 'fragment connected: ' + fragment, String(result.components));
    check(result.finite, 'fragment finite: ' + fragment);
    check(result.valenceViolations.length === 0, 'fragment valences: ' + fragment, JSON.stringify(result.valenceViolations));
    check(result.maxBondError < 0.22, 'fragment bond lengths: ' + fragment, result.maxBondError.toFixed(4));
  }

  const elementCarbon = api.addElement('c1ccccc1', 'C', 0);
  check(elementCarbon.formula === 'C7H8', 'adding C to benzene produces toluene', elementCarbon.formula);
  check(elementCarbon.atoms === 15 && elementCarbon.bonds === 15, 'element addition has the expected atom and bond counts', elementCarbon.atoms + ' atoms, ' + elementCarbon.bonds + ' bonds');
  check(elementCarbon.valenceViolations.length === 0, 'element addition preserves valence', JSON.stringify(elementCarbon.valenceViolations));
  const addedCarbonIndex = elementCarbon.molecule.atoms.findIndex((atom, index) => index > 5 && atom.element === 'C' && !atom.aromatic);
  const addedHeavyNeighbors = elementCarbon.molecule.bonds
    .filter((bond) => bond.a === addedCarbonIndex || bond.b === addedCarbonIndex)
    .map((bond) => bond.a === addedCarbonIndex ? bond.b : bond.a)
    .filter((index) => elementCarbon.molecule.atoms[index].element !== 'H');
  check(addedHeavyNeighbors.length === 1, 'added carbon creates exactly one heavy-atom bond', JSON.stringify(addedHeavyNeighbors));
  check(elementCarbon.components === 1, 'added carbon remains in one molecular component', String(elementCarbon.components));

  api.load('c1ccccc1');
  const benzeneLocalSelection = api.localPolishSelection([0], 2);
  check([0, 1, 2, 3, 4, 5].every((index) => benzeneLocalSelection.movableAtomIndices.includes(index)),
    'local edit polishing expands a touched ring as one movable unit',
    JSON.stringify(benzeneLocalSelection));

  await api.loadSmilesWithRdkit('CCCCCCCCCC', 'n-decane');
  const decaneBeforeEdit = api.current().molecule;
  const remoteHeavyAtom = decaneBeforeEdit.atoms[9];
  const remotePosition = [remoteHeavyAtom.x, remoteHeavyAtom.y, remoteHeavyAtom.z];
  document.querySelector('[data-mode="build"]').click();
  document.querySelector('[data-element="C"]').click();
  const editTarget = api.viewerState().atoms.find((atom) => atom.index === 0);
  const editCanvasRect = document.querySelector('#molecule-canvas').getBoundingClientRect();
  document.querySelector('#molecule-canvas').dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, pointerId: 40,
    clientX: editCanvasRect.left + editTarget.sx,
    clientY: editCanvasRect.top + editTarget.sy,
  }));
  document.querySelector('#molecule-canvas').dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 40,
    clientX: editCanvasRect.left + editTarget.sx,
    clientY: editCanvasRect.top + editTarget.sy,
  }));
  const interactivePolish = await new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      const result = api.current().molecule.source?.lastInteractivePolish;
      if (result) return resolve(result);
      const error = api.current().molecule.source?.lastInteractivePolishError;
      if (error) return reject(new Error('Local builder polish failed: ' + error));
      if (performance.now() - started > 10000) return reject(new Error('Timed out waiting for local builder polish'));
      setTimeout(poll, 50);
    };
    poll();
  });
  const decaneAfterEdit = api.current().molecule;
  const fixedRemoteAtom = decaneAfterEdit.atoms[9];
  const fixedRemoteDisplacement = Math.hypot(
    fixedRemoteAtom.x - remotePosition[0],
    fixedRemoteAtom.y - remotePosition[1],
    fixedRemoteAtom.z - remotePosition[2]);
  check(api.current().formula === 'C11H24'
    && interactivePolish.fixedAtomCount > 0
    && interactivePolish.movableAtomCount < decaneAfterEdit.atoms.length
    && interactivePolish.bondRadius === 2,
  'automatic post-edit polish limits movement to the edited two-shell neighborhood',
  JSON.stringify({ formula:api.current().formula, interactivePolish }));
  check(fixedRemoteDisplacement < 1e-12,
    'automatic post-edit polish leaves remote fixed atoms exactly stationary',
    fixedRemoteDisplacement.toExponential(3));

  api.load('c1ccccc1');
  document.querySelector('[data-mode="build"]').click();
  document.querySelector('[data-element="C"]').click();
  const benzeneBeforeClick = api.current().molecule;
  const hydrogenIndex = benzeneBeforeClick.atoms.findIndex((atom) => atom.element === 'H');
  const hydrogenScreen = api.viewerState().atoms.find((atom) => atom.index === hydrogenIndex);
  const canvasRect = document.querySelector('#molecule-canvas').getBoundingClientRect();
  document.querySelector('#molecule-canvas').dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, pointerId: 41,
    clientX: canvasRect.left + hydrogenScreen.sx,
    clientY: canvasRect.top + hydrogenScreen.sy,
  }));
  document.querySelector('#molecule-canvas').dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 41,
    clientX: canvasRect.left + hydrogenScreen.sx,
    clientY: canvasRect.top + hydrogenScreen.sy,
  }));
  const clickAdded = api.current();
  check(clickAdded.formula === 'C7H8', 'element tool click adds methyl without fake bonds', clickAdded.formula);
  check(clickAdded.bonds === 15 && clickAdded.valenceViolations.length === 0, 'element tool click keeps explicit valid topology', clickAdded.bonds + ' bonds');

  api.load('c1ccccc1');
  document.querySelector('[data-mode="build"]').click();
  document.querySelector('[data-tool="select"]').click();
  const buildCanvas = document.querySelector('#molecule-canvas');
  const buildRect = buildCanvas.getBoundingClientRect();
  const buildAtom = api.viewerState().atoms.find((atom) => atom.index === 0);
  const buildRotationBefore = api.viewerState().rotation;
  buildCanvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, pointerId:42,
    button:0, clientX:buildRect.left + buildAtom.sx, clientY:buildRect.top + buildAtom.sy }));
  buildCanvas.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, pointerId:42,
    button:0, buttons:1, clientX:buildRect.left + buildAtom.sx + 70, clientY:buildRect.top + buildAtom.sy + 35 }));
  buildCanvas.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, pointerId:42,
    button:0, clientX:buildRect.left + buildAtom.sx + 70, clientY:buildRect.top + buildAtom.sy + 35 }));
  const buildRotationAfter = api.viewerState().rotation;
  const buildRotationDelta = ['w', 'x', 'y', 'z'].reduce((sum, key) =>
    sum + Math.abs(buildRotationAfter[key] - buildRotationBefore[key]), 0);
  check(buildRotationDelta > 1e-3
    && document.querySelector('#geometry-selection-help').textContent.includes('Choose Select'),
  'left-drag rotates in Build Select without accidentally selecting the starting atom',
  JSON.stringify({ buildRotationDelta }));

  for (let index = 0; index < 6; index++) {
    const projected = api.viewerState().atoms.find((atom) => atom.index === index);
    buildCanvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, pointerId:50 + index,
      button:0, clientX:buildRect.left + projected.sx, clientY:buildRect.top + projected.sy }));
    buildCanvas.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, pointerId:50 + index,
      button:0, clientX:buildRect.left + projected.sx, clientY:buildRect.top + projected.sy }));
  }
  check(document.querySelector('#geometry-selection-help').textContent.includes('6 atoms selected for a docking core')
    && document.querySelector('#build-status').textContent.includes('6 atoms selected'),
  'Build Select accepts a connected docking core larger than four atoms');

  const buildPanBefore = api.viewerState().pan;
  const coordinatesBeforeBuildPan = api.current().molecule.atoms.map((atom) => [atom.x, atom.y, atom.z]);
  buildCanvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, pointerId:60,
    button:2, clientX:buildRect.left + 200, clientY:buildRect.top + 200 }));
  buildCanvas.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, pointerId:60,
    button:2, buttons:2, clientX:buildRect.left + 230, clientY:buildRect.top + 182 }));
  buildCanvas.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, pointerId:60,
    button:2, clientX:buildRect.left + 230, clientY:buildRect.top + 182 }));
  const buildPanAfter = api.viewerState().pan;
  check(buildPanAfter.x - buildPanBefore.x === 30 && buildPanAfter.y - buildPanBefore.y === -18
    && JSON.stringify(api.current().molecule.atoms.map((atom) => [atom.x, atom.y, atom.z]))
      === JSON.stringify(coordinatesBeforeBuildPan),
  'right-drag pans the full scene in Build without changing molecular coordinates',
  JSON.stringify({ before:buildPanBefore, after:buildPanAfter }));

  const cf3Seed = api.attach('c1ccccc1', 'trifluoromethyl', 0).molecule;
  const cf3Carbon = cf3Seed.atoms.findIndex((atom, index) => index > 5 && atom.element === 'C' && !atom.aromatic);
  const fluorines = cf3Seed.bonds
    .filter((bond) => bond.a === cf3Carbon || bond.b === cf3Carbon)
    .map((bond) => bond.a === cf3Carbon ? bond.b : bond.a)
    .filter((index) => cf3Seed.atoms[index].element === 'F');
  const cf3Vectors = fluorines.map((index) => {
    const atom = cf3Seed.atoms[index], center = cf3Seed.atoms[cf3Carbon];
    const length = Math.hypot(atom.x - center.x, atom.y - center.y, atom.z - center.z);
    return { x: (atom.x - center.x) / length, y: (atom.y - center.y) / length, z: (atom.z - center.z) / length };
  });
  const cf3Cosines = [];
  for (let a = 0; a < cf3Vectors.length; a++) for (let b = a + 1; b < cf3Vectors.length; b++)
    cf3Cosines.push(cf3Vectors[a].x * cf3Vectors[b].x + cf3Vectors[a].y * cf3Vectors[b].y + cf3Vectors[a].z * cf3Vectors[b].z);
  const cf3Volume = Math.abs(
    cf3Vectors[0].x * (cf3Vectors[1].y * cf3Vectors[2].z - cf3Vectors[1].z * cf3Vectors[2].y)
    - cf3Vectors[0].y * (cf3Vectors[1].x * cf3Vectors[2].z - cf3Vectors[1].z * cf3Vectors[2].x)
    + cf3Vectors[0].z * (cf3Vectors[1].x * cf3Vectors[2].y - cf3Vectors[1].y * cf3Vectors[2].x)
  );
  check(fluorines.length === 3, 'CF3 seed has three fluorines', String(fluorines.length));
  check(cf3Cosines.every((cosine) => Math.abs(cosine + 1 / 3) < 0.035), 'CF3 starts tetrahedral', JSON.stringify(cf3Cosines));
  check(cf3Volume > 0.65, 'CF3 seed is non-planar', cf3Volume.toFixed(4));

  const methyl = api.attach('c1ccccc1', 'methyl', 0).molecule;
  const target = methyl.atoms[0];
  const attachedCarbon = methyl.atoms.findIndex((atom, index) => index > 5 && atom.element === 'C');
  const ringNeighbors = methyl.bonds
    .filter((bond) => (bond.a === 0 || bond.b === 0))
    .map((bond) => bond.a === 0 ? bond.b : bond.a)
    .filter((index) => index !== attachedCarbon && methyl.atoms[index].element !== 'H');
  const neighborCenter = ringNeighbors.reduce((acc, index) => ({ x: acc.x + methyl.atoms[index].x, y: acc.y + methyl.atoms[index].y, z: acc.z + methyl.atoms[index].z }), { x: 0, y: 0, z: 0 });
  const outward = { x: target.x - neighborCenter.x / ringNeighbors.length, y: target.y - neighborCenter.y / ringNeighbors.length, z: target.z - neighborCenter.z / ringNeighbors.length };
  const attachment = { x: methyl.atoms[attachedCarbon].x - target.x, y: methyl.atoms[attachedCarbon].y - target.y, z: methyl.atoms[attachedCarbon].z - target.z };
  const alignment = (outward.x * attachment.x + outward.y * attachment.y + outward.z * attachment.z) / (Math.hypot(outward.x, outward.y, outward.z) * Math.hypot(attachment.x, attachment.y, attachment.z));
  check(alignment > 0.98, 'fragment follows removed-H direction', alignment.toFixed(4));

  api.load('c1ccccc1');
  api.attachCurrent('methyl', 0);
  check(api.current().formula === 'C7H8', 'interactive attachment');
  document.querySelector('#undo-atom').click();
  check(api.current().formula === 'C6H6', 'undo attachment');
  document.querySelector('#redo-atom').click();
  check(api.current().formula === 'C7H8', 'redo attachment');

  api.load('CCCC');
  const stretched = api.setInternalCoordinate([0, 1], 1.80, true);
  check(stretched.kind === 'bond' && Math.abs(stretched.value - 1.80) < 1e-6, 'viewer bond-length editing reaches the requested Å value', JSON.stringify(stretched));
  const angled = api.setInternalCoordinate([0, 1, 2], 125, true);
  check(angled.kind === 'angle' && Math.abs(angled.value - 125) < 1e-6, 'viewer bond-angle editing reaches the requested degree value', JSON.stringify(angled));
  const torsionBeforeEdit = api.internalCoordinate([0, 1, 2, 3]).value;
  const twisted = api.setInternalCoordinate([0, 1, 2, 3], 60, true);
  const torsionError = Math.abs(((twisted.value - 60 + 540) % 360) - 180);
  check(twisted.kind === 'torsion' && torsionError < 1e-6, 'viewer torsion editing reaches the requested degree value', JSON.stringify(twisted));
  check(document.querySelector('#geometry-unit').textContent === '°' && document.querySelector('#geometry-selection-help').textContent.includes('Torsion'), 'internal-coordinate control identifies the selected coordinate');
  document.querySelector('#undo-atom').click();
  const torsionAfterUndo = api.internalCoordinate([0, 1, 2, 3]).value;
  check(Math.abs(((torsionAfterUndo - torsionBeforeEdit + 540) % 360) - 180) < 1e-6, 'internal-coordinate edits participate in undo history', torsionBeforeEdit + ' vs ' + torsionAfterUndo);

  api.load('Cc1ccccc1');
  const minimised = await api.minimiseCurrent();
  optimizationMetrics = minimised.optimization;
  check(minimised.formula === 'C7H8', 'minimizer preserves formula', minimised.formula);
  check(minimised.finite, 'minimizer produces finite coordinates');
  check(minimised.valenceViolations.length === 0, 'minimizer preserves valences', JSON.stringify(minimised.valenceViolations));
  check(minimised.maxBondError < 0.22, 'minimizer bond convergence', minimised.maxBondError.toFixed(4));
  check(minimised.optimization.finalEnergy < minimised.optimization.initialEnergy, 'minimizer lowers force-field energy', JSON.stringify(minimised.optimization));

  check(document.querySelector('#method-select').options[0].value === 'webgpu', 'direct Sage WebGPU is the default calculation engine');
  check([...document.querySelector('#method-select').options].map((option) => option.value).join(',') === 'webgpu,stormm,rdkit,ani2x'
      && document.querySelector('#method-select option[value="stormm"]').hidden,
    'the calculation menu contains only applicable production engines');
  check(!document.querySelector('#job-select option[value="conformers"]').disabled,
    'conformer search is directly selectable and chooses its WebGPU backend');
  check(![...document.querySelector('#build-optimizer-select').options].some((option) => option.value === 'browser' || option.value === 'openmm')
      && ![...document.querySelector('#method-select').options].some((option) => option.value === 'openmm'),
    'Build and Run do not expose approximate cleanup or OpenMM Reference');
  check(document.querySelector('#solvent-select').value === 'obc2'
      && document.querySelector('#constraint-select').value === 'hbonds'
      && !document.querySelector('#cutoff-select')
      && !document.querySelector('#simulation-settings').open
      && document.querySelector('#simulation-settings-summary').textContent.startsWith('Recommended'),
    'recommended solvent and constraints stay behind progressive disclosure while cutoff is not exposed');
  const aniGoldens = await (await fetch('./mlip/models/ani2x-goldens.json')).json();
  const aniGolden = aniGoldens.records.find((record) => record.name === 'ethanol');
  const aniElements = { 1:'H', 6:'C', 7:'N', 8:'O', 9:'F', 16:'S', 17:'Cl' };
  const aniBonds = {
    ethanol:[[0,1], [1,2], [0,3], [0,4], [0,5], [1,6], [1,7], [2,8]],
    methylamine:[[0,1], [0,2], [0,3], [0,4], [1,5], [1,6]],
    methanethiol:[[0,1], [0,2], [0,3], [0,4], [1,5]],
    fluoromethane:[[0,1], [0,2], [0,3], [0,4]],
    chloromethane:[[0,1], [0,2], [0,3], [0,4]],
  };
  const loadAniGolden = (record) => api.loadObject({
    name:'ANI-2x ' + record.name + ' golden', multiplicity:1,
    atoms:record.atomicNumbers.map((number, index) => ({
      element:aniElements[number], x:record.positionsAngstrom[index][0],
      y:record.positionsAngstrom[index][1], z:record.positionsAngstrom[index][2], charge:0,
    })),
    bonds:aniBonds[record.name].map(([a,b]) => ({ a,b,order:1 })),
  });
  loadAniGolden(aniGolden);
  const aniEnergy = await api.calculateCurrent('energy', 'ani2x');
  const aniEnergyError = Math.abs(aniEnergy.finalEnergy
    - aniGolden.energyHartree * 627.5094740631);
  const aniForceReference = aniGolden.forcesHartreePerAngstrom.flat()
    .map((value) => value * 627.5094740631);
  const aniForceComparison = compareForces(aniEnergy.forces, aniForceReference);
  check(aniEnergy.model === 'ANI-2x ensemble (8 members)'
    && aniEnergy.modelSourceSha256 === 'ad5c45c9722d32d07fe19894d931bc1e4c64dacaeb4090129e4363614ba98bf9',
    'ANI-2x uses the official hashed eight-member TorchANI ensemble', JSON.stringify(aniEnergy));
  check(aniEnergyError < 0.02,
    'browser ANI-2x total energy matches the TorchANI f32 golden', aniEnergyError.toExponential(4) + ' kcal/mol');
  check(aniForceComparison && aniForceComparison.relativeRms < 2e-3
    && aniForceComparison.maximumError < 0.08,
    'browser ANI-2x analytical forces match TorchANI autograd', JSON.stringify(aniForceComparison));
  for (const name of ['methylamine', 'methanethiol', 'fluoromethane', 'chloromethane']) {
    const golden = aniGoldens.records.find((record) => record.name === name);
    loadAniGolden(golden);
    const evaluated = await api.calculateCurrent('energy', 'ani2x');
    const energyError = Math.abs(evaluated.finalEnergy - golden.energyHartree * 627.5094740631);
    const referenceForces = golden.forcesHartreePerAngstrom.flat()
      .map((value) => value * 627.5094740631);
    const forceComparison = compareForces(evaluated.forces, referenceForces);
    check(energyError < 0.03 && forceComparison && forceComparison.relativeRms < 3e-3,
      'ANI-2x ' + name + ' covers its element network with native parity',
      energyError.toExponential(3) + ' kcal/mol · ' + JSON.stringify(forceComparison));
  }
  api.load('CBr');
  check(document.querySelector('#method-select option[value="ani2x"]').disabled
    && document.querySelector('#build-optimizer-select option[value="ani2x"]').title.includes('Br'),
    'ANI-2x is disabled visibly outside its supported element domain');
  loadAniGolden(aniGolden);
  const aniMinimized = await api.calculateCurrent('geometry', 'ani2x', {
    maxIterations:12, forceTolerance:0.01,
  });
  aniMetrics = {
    platform:aniEnergy.platform, coldEnergyMs:aniEnergy.elapsedMs,
    energyError:aniEnergyError, forceRelativeRms:aniForceComparison.relativeRms,
    forceMaximumError:aniForceComparison.maximumError,
    minimizationMs:aniMinimized.elapsedMs, initialEnergy:aniMinimized.initialEnergy,
    finalEnergy:aniMinimized.finalEnergy, evaluations:aniMinimized.modelEvaluations,
  };
  check(aniMinimized.finalEnergy < aniMinimized.initialEnergy
    && aniMinimized.frameCount >= 2 && aniMinimized.modelEvaluations >= 2,
    'ANI-2x L-BFGS minimization lowers its own energy and saves a trajectory', JSON.stringify(aniMinimized));
  api.load('CC');
  check([...document.querySelector('#stormm-system').options].map((option) => option.value).join(',') === 'current'
    && document.querySelector('#stormm-system').classList.contains('hidden'),
  'STORMM exposes only the current molecule instead of demo alkane and water systems');
  const stormm = await api.calculateCurrent('dynamics', 'stormm', {
    stormmSystem: 'c16', replicaCount: 4, steps: 6, savedFrameCount: 3,
  });
  check(stormm.backend === 'STORMM WebGPU ensemble' && stormm.replicaCount === 4,
    'STORMM runs a homogeneous stack as independent GPU trajectories', JSON.stringify(stormm));
  check(stormm.frameCount === 3 && stormm.frameEnergies.every(Number.isFinite),
    'STORMM retains sampled frames for the selected replica', JSON.stringify(stormm));
  check(api.current().atoms === 16 && api.current().bonds === 15 && api.current().components === 1,
    'STORMM C16 viewer uses only the 15 explicit topology bonds', JSON.stringify(api.current()));
  api.selectCalculationReplica(2);
  const selectedStormm = api.calculationFrames();
  check(selectedStormm.replicaIndex === 2 && selectedStormm.replicaCount === 4
    && document.querySelector('#result-replica-select').value === '2'
    && document.querySelector('#result-frame-heading').textContent.includes('Aligned trajectory 3'),
    'STORMM replica selector switches trajectories without concatenating them', JSON.stringify(selectedStormm));
  check(selectedStormm.replicaRmsds.length === 4
    && selectedStormm.replicaRmsds.every((value) => Number.isFinite(value) && value >= 0)
    && document.querySelector('#result-replica-summary').textContent.includes('heavy-atom RMSD')
    && document.querySelector('#replica-rmsd-low').textContent.includes('Å')
    && document.querySelector('#replica-rmsd-high').textContent.includes('Å'),
    'STORMM mosaic reports best-fit final heavy-atom RMSD with a visible scale',
    JSON.stringify(selectedStormm.replicaRmsds));
  check(!document.querySelector('#result-ensemble').classList.contains('hidden')
    && document.querySelector('#result-ensemble').textContent.includes('Independent trajectories'),
    'STORMM result exposes the ensemble mosaic and selector');
  check(!document.querySelector('#result-aggregate-performance').classList.contains('hidden')
    && document.querySelector('#result-runtime').textContent.includes('× 4 replicas')
    && document.querySelector('#result-aggregate-throughput').textContent.includes('replica-steps/s'),
    'STORMM distinguishes per-trajectory rate from cumulative ensemble throughput');
  const replicaSmoke = await api.tuneStormmReplicas({
    stormmSystem:'c16', replicaCounts:[1, 4, 16, 64], warmupSteps:2, sampleSteps:8,
  });
  const tunedOptions = api.stormmReplicaOptions();
  check(replicaSmoke.samples.length === 4
    && replicaSmoke.samples.every((sample) => Number.isFinite(sample.aggregateReplicaStepsPerSecond)
      && sample.aggregateReplicaStepsPerSecond > 0),
  'STORMM smoke sweep measures finite aggregate throughput across valid replica counts',
  JSON.stringify(replicaSmoke.samples));
  check(tunedOptions.selected === replicaSmoke.recommendedReplicaCount
    && tunedOptions.options.find((option) => option.count === tunedOptions.selected)?.label.includes('recommended')
    && tunedOptions.status.includes('peak'),
  'replica smoke sweep selects and annotates the smallest near-peak ensemble size',
  JSON.stringify(tunedOptions));
  document.querySelector('#stormm-system').value = 'current';
  document.querySelector('#stormm-system').dispatchEvent(new Event('change'));
  const longerStormm = await api.calculateCurrent('dynamics', 'stormm', {
    stormmSystem: 'c16', replicaCount: 4, steps: 5001, savedFrameCount: 2,
  });
  check(longerStormm.frameCount === 2 && api.calculationFrames().steps.at(-1) === 5001
    && Number.isFinite(longerStormm.finalEnergy),
    'STORMM accepts trajectories beyond the obsolete 5,000-step worker cap',
    JSON.stringify(longerStormm));
  api.load('CCO');
  const parameterizedStormm = await api.calculateCurrent('dynamics', 'stormm', {
    stormmSystem: 'current', replicaCount: 4, steps: 2, savedFrameCount: 2,
  });
  check(parameterizedStormm.forcefield === 'OpenFF Sage 2.1.0'
    && parameterizedStormm.stormmSystem === 'current' && parameterizedStormm.replicaCount === 4,
    'STORMM consumes the current molecule System from the OpenMM parameterization path', JSON.stringify(parameterizedStormm));
  check(api.current().formula === 'C2H6O' && api.current().bonds === 8,
    'parameterized STORMM preserves the current molecule and explicit bond graph', JSON.stringify(api.current()));
  const parameterizedStormmEnergy = parameterizedStormm.finalEnergy;
  const parameterizedStormmReference = await api.calculateCurrent('energy', 'openmm', {
    implicitSolvent:'obc2', constraintMode:'hbonds', nonbondedCutoffNm:0,
  });
  const parameterizedStormmError = Math.abs(parameterizedStormmEnergy - parameterizedStormmReference.finalEnergy);
  check(parameterizedStormmError < 0.02,
    'OpenMM Reference confirms the parameterized STORMM final geometry energy',
    parameterizedStormmError.toExponential(4) + ' kcal/mol');
  api.load('CCO');
  const implicitStormm = await api.calculateCurrent('dynamics', 'stormm', {
    stormmSystem: 'current', replicaCount: 4, steps: 1, savedFrameCount: 2,
    implicitSolvent: 'obc2',
  });
  check(implicitStormm.implicitSolvent === 'OBC2'
    && !document.querySelector('#solvent-field').classList.contains('hidden'),
    'STORMM current-molecule ensembles expose and report OBC2 implicit water',
    JSON.stringify(implicitStormm));
  const implicitStormmReference = await api.calculateCurrent('energy', 'openmm', {
    implicitSolvent:'obc2', constraintMode:'hbonds', nonbondedCutoffNm:0,
  });
  const implicitStormmError = Math.abs(implicitStormm.finalEnergy - implicitStormmReference.finalEnergy);
  check(implicitStormmError < 0.02,
    'OpenMM Reference confirms the OBC2 STORMM final geometry energy',
    implicitStormmError.toExponential(4) + ' kcal/mol');
  api.load('CCO');
  const constrainedStormm = await api.calculateCurrent('dynamics', 'stormm', {
    stormmSystem: 'current', replicaCount: 4, steps: 20, savedFrameCount: 3,
    constraintMode: 'hbonds', implicitSolvent: 'obc2',
  });
  check(constrainedStormm.timestepFs === 2 && constrainedStormm.constraintCount > 0
      && constrainedStormm.constraintsConverged
      && constrainedStormm.constraintError < 2e-5,
    'STORMM SHAKE/RATTLE holds X–H constraints at 2 fs in every replica',
    JSON.stringify(constrainedStormm));
  const constrainedStormmTrajectory = api.trajectoryDiagnostics();
  const constrainedStormmFrames = api.calculationFrames();
  check(constrainedStormmTrajectory.constraintCount === constrainedStormm.constraintCount
      && constrainedStormmTrajectory.maximumConstraintRelativeError < 2e-5
      && Number.isFinite(constrainedStormmTrajectory.radiusOfGyrationAngstrom.relativeSpan)
      && Number.isFinite(constrainedStormmTrajectory.maximumHeavyAtomRmsdAngstrom),
    'STORMM retained frames pass positional X–H, size, COM, and fitted-RMSD diagnostics',
    JSON.stringify(constrainedStormmTrajectory));
  check(constrainedStormmFrames.alignment?.mode === 'fixed-identity heavy-atom rigid fit'
      && constrainedStormmFrames.alignment.referenceFrame === null
      && constrainedStormmFrames.alignment.referenceGeometry === 'input coordinates'
      && constrainedStormmFrames.alignment.sharedAcrossReplicas
      && constrainedStormmFrames.alignment.heavyAtomCount === 3
      && constrainedStormmFrames.alignment.displayOnly,
    'STORMM MD replicas share the unrandomized input display reference without changing raw diagnostics',
    JSON.stringify(constrainedStormmFrames.alignment));
  api.selectCalculationFrame(0);
  const alignedStormmReplica0 = Float64Array.from(
    api.current().molecule.atoms.flatMap((atom) => [atom.x, atom.y, atom.z]));
  api.selectCalculationReplica(1);
  const alignedStormmReplica1 = Float64Array.from(
    api.current().molecule.atoms.flatMap((atom) => [atom.x, atom.y, atom.z]));
  const directCoordinateRmsd = (first, second) => Math.sqrt(first.reduce((sum, value, index) =>
    sum + (value - second[index]) ** 2, 0) / (first.length / 3));
  const replicaPairRmsd = directCoordinateRmsd(alignedStormmReplica0, alignedStormmReplica1);
  check(replicaPairRmsd < 0.15,
    'switching STORMM replicas preserves one display orientation despite randomized starts',
    replicaPairRmsd.toExponential(3) + ' Å direct coordinate RMSD');
  api.load('CCCC');
  const conformerSearch = await api.calculateCurrent('conformers', 'stormm', {
    conformerCount: 32, conformerSearchSteps: 50, conformerClusterRms: 0.5,
    implicitSolvent: 'obc2', constraintMode: 'hbonds', stormmSystem: 'current',
  });
  const conformerFrames = api.calculationFrames();
  check(conformerSearch.conformerCount >= 2 && conformerSearch.conformerCount <= 32
      && conformerSearch.conformerClusterCount >= 1,
    'conformer search runs symmetry-pruned ETKDG seeds as one WebGPU synthesis',
    JSON.stringify(conformerSearch));
  check(conformerSearch.conformerSeedWorkerCount >= 2
      && conformerSearch.conformerSeedWorkerCount <= 4
      && conformerSearch.conformerSeedGeneratedCount >= conformerSearch.conformerCount,
    'large conformer searches use a bounded RDKit worker pool and cross-worker pruning',
    JSON.stringify(conformerSearch));
  check(conformerSearch.conformerEnergyOffsets.every(Number.isFinite)
      && Math.min(...conformerSearch.conformerEnergyOffsets) === 0
      && conformerSearch.conformerRmsds.every((value) => Number.isFinite(value) && value >= 0)
      && conformerSearch.conformerTorsionDistances.every((value) => Number.isFinite(value) && value >= 0)
      && conformerSearch.conformerRadiiOfGyration.every((value) => Number.isFinite(value) && value > 0),
    'conformer search ranks finite Sage energies and computes RMSD, torsion, and radius-of-gyration CVs',
    JSON.stringify(conformerSearch));
  check(conformerFrames.conformerAnalysis?.representativeIndices.length
      === conformerSearch.conformerClusterCount
      && conformerFrames.alignment?.mode === 'symmetry-aware heavy-atom rigid fit'
      && conformerFrames.alignment.referenceReplica === conformerSearch.conformerBestIndex
      && conformerFrames.alignment.heavyAtomCount > 0
      && conformerFrames.alignment.symmetryMappingCount > 0
      && document.querySelectorAll('#result-conformer-points circle').length
      === conformerSearch.conformerCount
      && !document.querySelector('#result-conformers').classList.contains('hidden'),
    'energy–RMSD landscape exposes every conformer and symmetry-aligns viewer coordinates',
    JSON.stringify({ analysis:conformerFrames.conformerAnalysis, alignment:conformerFrames.alignment }));
  const conformerCv = document.querySelector('#result-conformer-cv');
  conformerCv.value = 'torsion';
  conformerCv.dispatchEvent(new Event('change'));
  check(conformerSearch.conformerTorsionCount >= 1
      && document.querySelector('#result-conformer-x-label').textContent.includes('Rotatable-torsion')
      && document.querySelectorAll('#result-conformer-filter option').length === 5,
    'conformer landscape switches to a torsional CV and offers ranked or energy-window filtering');
  const firstRankedReplica = api.calculationFrames().replicaIndex;
  document.querySelector('#result-conformer-next').click();
  check(api.calculationFrames().replicaIndex !== firstRankedReplica
      && document.querySelector('#result-conformer-label').textContent.startsWith('Selected #')
      && !document.querySelector('#result-conformer-previous').disabled,
    'rank controls navigate directly between adjacent conformers');
  document.querySelector('#result-conformer-best').click();
  conformerCv.value = 'rmsd';
  conformerCv.dispatchEvent(new Event('change'));
  check(conformerFrames.energies[1] <= conformerFrames.energies[0] + 1e-3
      && conformerFrames.energies.at(-1) <= conformerFrames.energies.at(-2) + 1e-3,
    'batched Sage minimization lowers the selected seed before and after annealing',
    JSON.stringify(conformerFrames.energies));
  api.selectCalculationReplica(conformerSearch.conformerBestIndex);
  check(document.querySelector('#result-conformer-summary').textContent.includes('symmetry-aware RMSD')
      && document.querySelector('#result-frame-heading').textContent.includes('search stages'),
    'selecting a conformer loads its staged annealing path in the viewer');
  document.querySelector('#conformer-arena').checked = true;
  document.querySelector('#conformer-arena').dispatchEvent(new Event('change'));
  document.querySelector('#solvent-select').value = 'vacuum';
  document.querySelector('#constraint-select').value = 'none';
  const arena = await api.calculateCurrent('conformers', 'stormm', {
    conformerArena: true, conformerCount: 4, conformerEffort: 'quick',
    conformerClusterRms: 0.5, implicitSolvent: 'vacuum', constraintMode: 'none',
    nonbondedCutoffNm: 1.0,
    aniConformerIterations: 4,
  });
  const arenaMethods = arena.conformerArena?.methods || [];
  check(arenaMethods.length === 3
      && arenaMethods.map((entry) => entry.id).join('|')
        === 'etkdg-mmff|stormm-webgpu|ani2x'
      && arena.conformerArena.ani2xIncluded
      && arenaMethods.every((entry) => entry.candidateCount >= 2
        && Number.isFinite(entry.regret) && entry.regret >= -1e-9
        && entry.lowEnergyRecall >= 0 && entry.lowEnergyRecall <= 1),
    'Conformer Arena defaults to MMFF seeds, STORMM WebGPU, and ANI-2x under one judge',
    JSON.stringify(arena.conformerArena));
  const stormmParity = arena.conformerArena.stormmRescoreConsistency;
  check(arena.implicitSolvent === 'OBC2' && arena.constraintMode === 'hbonds'
      && stormmParity?.settings?.implicitSolvent === 'obc2'
      && stormmParity.settings.constraintMode === 'hbonds'
      && stormmParity.settings.nonbondedCutoffNm === 0
      && document.querySelector('#solvent-field').classList.contains('hidden')
      && document.querySelector('#constraint-field').classList.contains('hidden')
      && !document.querySelector('#cutoff-field')
      && document.querySelector('#simulation-settings').classList.contains('hidden')
      && document.querySelector('#solvent-select').value === 'vacuum'
      && document.querySelector('#constraint-select').value === 'none',
    'Conformer search uses fixed OBC2/X–H/no-cutoff settings and hides MD selectors',
    JSON.stringify({ implicit:arena.implicitSolvent, constraints:arena.constraintMode,
      parity:stormmParity }));
  check(stormmParity?.passed && stormmParity.sampleCount > 0
      && stormmParity.maximumAbsoluteKcalMol <= stormmParity.absoluteToleranceKcalMol
      && Number.isFinite(stormmParity.rmsKcalMol)
      && document.querySelector('#result-arena-parity').textContent.includes('rescore consistent'),
    'Arena checks STORMM refinement energies against its separate batched WebGPU rescore',
    JSON.stringify(stormmParity));
  check(arena.ani2xBatchSize >= 2
      && arena.ani2xInferenceBatches > 0
      && arena.ani2xModelEvaluations > arena.ani2xInferenceBatches,
    'Conformer Arena batches independent ANI-2x refinements into fewer GPU inference calls',
    JSON.stringify({ batchSize:arena.ani2xBatchSize,
      evaluations:arena.ani2xModelEvaluations, batches:arena.ani2xInferenceBatches }));
  check(arena.conformerArena.ani2xRescoreAvailable
      && arena.ani2xRescoreModelEvaluations === arena.conformerCount
      && arena.ani2xRescoreInferenceBatches > 0
      && arena.ani2xRescoreInferenceBatches < arena.ani2xRescoreModelEvaluations
      && arena.ani2xRescoreLaneMaximumDifference <= 0.02,
    'Conformer Arena batch-rescores every final candidate with ANI-2x',
    JSON.stringify({ count:arena.conformerCount, rescore:arena.conformerArena }));
  const arenaFrames = api.calculationFrames();
  const nativeScores = arenaFrames.conformerAnalysis?.scoreSeries || {};
  const methodIds = arenaFrames.conformerAnalysis?.methodIds || [];
  check(Object.keys(nativeScores).join('|') === 'ani2x'
      && arena.conformerArena.judge.includes('Sage 2.1 + OBC2/ACE')
      && arena.conformerArena.environments?.['etkdg-mmff'] === 'vacuum'
      && arena.conformerArena.environments?.['stormm-webgpu'] === 'OBC2/ACE implicit water'
      && arena.conformerArena.environments?.judge === 'OBC2/ACE implicit water'
      && arena.conformerArena.environments?.ani2x === 'vacuum'
      && nativeScores.ani2x.provenance.includes('Vacuum ANI-2x')
      && nativeScores.ani2x.provenance.includes('no implicit-solvent term')
      && nativeScores.ani2x.provenance.includes('every final Arena candidate')
      && methodIds.every((methodId, index) => Number.isFinite(nativeScores.ani2x.energies[index])),
    'Arena labels the Sage/OBC2 judge separately from full-union vacuum ANI scores',
    JSON.stringify(nativeScores));
  check(!document.querySelector('#result-arena').classList.contains('hidden')
      && document.querySelectorAll('#result-arena-methods .arena-method').length === 3
      && new Set([...document.querySelectorAll('#result-conformer-points circle')]
        .map((circle) => circle.getAttribute('fill'))).size >= 2,
    'Conformer Arena renders a compact comparison and colors candidates by generator');
  const shortlist = [...document.querySelectorAll('#result-conformer-shortlist tr')];
  check(shortlist.length === Math.min(5, arena.conformerCount)
      && arenaFrames.count === 1
      && document.querySelector('#result-frames').classList.contains('hidden')
      && document.querySelector('#result-energy-chart').classList.contains('hidden')
      && !document.querySelector('#result-conformer-map-details').open
      && document.querySelector('#result-performance').classList.contains('hidden'),
    'Arena defaults to a five-conformer shortlist and one final geometry without minimization playback');
  if (shortlist.length > 1) {
    shortlist[1].click();
    const selectedShortlist = api.calculationFrames();
    check(selectedShortlist.count === 1
        && selectedShortlist.replicaIndex === Number(shortlist[1].dataset.replicaIndex)
        && shortlist[1].classList.contains('active'),
      'shortlist rows select only the final geometry for that conformer');
  }
  check(document.querySelectorAll('#result-arena-methods .arena-method small').length === 0
      && !document.querySelector('#result-arena').textContent.includes('end-to-end')
      && document.querySelector('#result-arena-summary').textContent.length < 190,
    'Arena comparison summary stays concise and focused on judged score and low-energy recall');
  const xAxis = document.querySelector('#result-conformer-cv');
  const yAxis = document.querySelector('#result-conformer-y');
  const axisOptions = [...xAxis.options].map((option) => option.value);
  check(xAxis.value === 'sage-rank' && yAxis.value === 'ani2x-rank'
      && axisOptions.includes('sage-delta')
      && axisOptions.includes('sage-rank')
      && axisOptions.includes('ani2x-delta')
      && axisOptions.includes('ani2x-energy')
      && axisOptions.includes('ani2x-rank')
      && !axisOptions.some((value) => value.includes('stormm-webgpu'))
      && !axisOptions.some((value) => value.includes('etkdg-mmff')),
    'Arena defaults to Sage-versus-ANI ranks and exposes scores without STORMM implementation diagnostics',
    axisOptions.join('|'));
  xAxis.value = 'sage-delta';
  xAxis.dispatchEvent(new Event('change'));
  yAxis.value = 'ani2x-delta';
  yAxis.dispatchEvent(new Event('change'));
  document.querySelector('#result-conformer-filter').value = 'all';
  document.querySelector('#result-conformer-filter').dispatchEvent(new Event('change'));
  const aniPoints = [...document.querySelectorAll('#result-conformer-points circle')];
  check(document.querySelector('#result-conformer-scatter').dataset.xMetric === 'sage-delta'
      && document.querySelector('#result-conformer-scatter').dataset.yMetric === 'ani2x-delta'
      && document.querySelector('#result-conformer-y-label').textContent.includes('ANI-2x native')
      && aniPoints.length === methodIds.length
      && new Set(aniPoints.map((point) => point.dataset.generator)).size === 3
      && aniPoints.every((point) => Number.isFinite(Number(point.dataset.xValue))
        && Number.isFinite(Number(point.dataset.yValue)))
      && document.querySelector('#result-conformer-axis-note').textContent
        .includes('every final Arena candidate')
      && document.querySelector('#result-conformer-axis-note').textContent.includes('MMFF seed energies were not retained'),
    'Sage-vs-ANI plots the same full candidate union and explains score provenance');
  check(new Set(aniPoints.map((point) => point.getAttribute('fill'))).size === 3
      && document.querySelector('#result-conformer-legend-label').textContent
        .includes('Generator'),
    'Full-union Sage-vs-ANI plots preserve all candidate-generator colors');
  xAxis.value = 'sage-rank';
  xAxis.dispatchEvent(new Event('change'));
  yAxis.value = 'ani2x-rank';
  yAxis.dispatchEvent(new Event('change'));
  const rankPoints = [...document.querySelectorAll('#result-conformer-points circle')];
  const rankCount = methodIds.length;
  check(document.querySelector('#result-conformer-scatter').dataset.xMetric === 'sage-rank'
      && document.querySelector('#result-conformer-scatter').dataset.yMetric === 'ani2x-rank'
      && rankPoints.length === rankCount
      && rankPoints.every((point) => Number(point.dataset.xValue) >= 1
        && Number(point.dataset.xValue) <= rankCount
        && Number(point.dataset.yValue) >= 1
        && Number(point.dataset.yValue) <= rankCount)
      && document.querySelector('#result-conformer-axis-note').textContent
        .includes('rank 1 is lowest'),
    'Arena compares Sage and ANI ordering without conflating their absolute energy scales');
  const conformerFilter = document.querySelector('#result-conformer-filter');
  const generatorFilters = [...conformerFilter.options]
    .filter((option) => option.value.startsWith('generator:'));
  conformerFilter.value = 'generator:ani2x';
  conformerFilter.dispatchEvent(new Event('change'));
  const aniOnlyPoints = [...document.querySelectorAll('#result-conformer-points circle')];
  const aniCandidateCount = methodIds.filter((methodId) => methodId === 'ani2x').length;
  check(generatorFilters.length === 3
      && generatorFilters.some((option) => option.textContent.includes('MMFF seeds'))
      && generatorFilters.some((option) => option.textContent.includes('STORMM GPU'))
      && generatorFilters.some((option) => option.textContent.includes('ANI-2x'))
      && aniOnlyPoints.length === aniCandidateCount
      && aniOnlyPoints.every((point) => point.dataset.generator === 'ani2x')
      && document.querySelectorAll('#result-conformer-select option').length === aniCandidateCount
      && document.querySelector('#result-conformer-legend-label').textContent
        .includes('ANI-2x'),
    'Show menu filters the plot and conformer navigation to one candidate generator');
  conformerFilter.value = 'all';
  conformerFilter.dispatchEvent(new Event('change'));
  const conformerSort = document.querySelector('#result-conformer-sort');
  conformerSort.value = 'y';
  conformerSort.dispatchEvent(new Event('change'));
  check(document.querySelectorAll('#result-conformer-select option').length === methodIds.length
      && [...document.querySelectorAll('#result-conformer-select option')]
        .every((option) => !option.textContent.includes('rank rank')),
    'Selected-conformer menu sorts the full common ANI rescore without redundant labels');
  xAxis.value = 'rmsd'; xAxis.dispatchEvent(new Event('change'));
  yAxis.value = 'sage-delta'; yAxis.dispatchEvent(new Event('change'));
  conformerSort.value = 'sage'; conformerSort.dispatchEvent(new Event('change'));
  check(document.querySelector('#method-help').textContent.length < 100
      && document.querySelector('#method-info').textContent.includes('batched STORMM WebGPU pass'),
    'Conformer Arena keeps visible help concise and moves details behind information',
    JSON.stringify({ help:document.querySelector('#method-help').textContent,
      info:document.querySelector('#method-info').textContent }));
  document.querySelector('#method-select').value = 'webgpu';
  document.querySelector('#method-select').dispatchEvent(new Event('change'));
  api.load('c1ccccc1');
  const render = api.renderDiagnostics();
  check(render.ringCount === 1, 'benzene renderer finds one ring hull', String(render.ringCount));
  check(render.aromaticDoubleBonds === 3, 'benzene renderer assigns three aromatic double bonds', String(render.aromaticDoubleBonds));
  check(render.showHulls && document.querySelector('#hull-toggle').checked, 'ring hull visualization defaults on');
  check(document.querySelector('#info-point-group').textContent === 'D₆h', 'benzene symmetry label', document.querySelector('#info-point-group').textContent);
  document.querySelector('#hull-toggle').click();
  check(!api.renderDiagnostics().showHulls, 'ring hull visualization toggles off');
  document.querySelector('#hull-toggle').click();
  const benzeneDimer = api.parse('c1ccccc1').molecule;
  const firstRingAtomCount = benzeneDimer.atoms.length;
  benzeneDimer.atoms.push(...benzeneDimer.atoms.map((atom) => ({ ...atom, z:atom.z + 3.5 })));
  benzeneDimer.bonds.push(...benzeneDimer.bonds.slice().map((bond) => ({
    ...bond, a:bond.a + firstRingAtomCount, b:bond.b + firstRingAtomCount,
  })));
  api.loadObject(benzeneDimer);
  const stackedRender = api.renderDiagnostics();
  check(stackedRender.piStacks.length >= 1 && stackedRender.showInteractions
    && document.querySelector('#interaction-toggle').checked,
  'viewer recognizes and enables dashed parallel pi-stack overlays',
  JSON.stringify(stackedRender.piStacks));
  api.load('c1ccccc1');
  const cameraBefore = api.viewerState();
  const cameraAfter = api.rotateViewer({ x: 0, y: 0, z: 1 }, { x: 0.58, y: 0.24, z: 0.78 });
  const quaternionNorm = Math.hypot(cameraAfter.rotation.w, cameraAfter.rotation.x, cameraAfter.rotation.y, cameraAfter.rotation.z);
  check(Math.abs(cameraAfter.scale - cameraBefore.scale) < 1e-9, 'viewer fit stays constant through rotation', cameraBefore.scale + ' → ' + cameraAfter.scale);
  check(Math.abs(quaternionNorm - 1) < 1e-9, 'trackball quaternion remains normalized', String(quaternionNorm));
  document.querySelector('[data-mode="run"]').click();
  check(!document.querySelector('#run-left-panel').classList.contains('hidden'), 'Run mode shows calculation controls');
  check(document.querySelector('#display-options').classList.contains('hidden'), 'Run mode hides View-only display controls');
  check(document.querySelector('.protein-fold-card').classList.contains('hidden'), 'Run mode keeps protein folding controls out of the calculation workflow');
  const workerAsset = document.querySelector('link[data-rdkit-worker]').href;
  const workerResponse = await fetch(workerAsset);
  const workerSource = await workerResponse.text();
  check(workerResponse.ok, 'RDKit worker asset is served', workerAsset + ' · ' + workerResponse.status);
  check(workerSource.includes('run_forcefield'), 'RDKit worker contains the force-field bridge', workerAsset);
  check(workerSource.includes('generate_conformers'), 'RDKit worker exposes ETKDGv3 conformer generation', workerAsset);
  check(workerSource.includes('enumerate_protonation_states') && workerSource.includes('dimorphite-sites.js'),
    'RDKit worker exposes the pinned browser protonation bridge', workerAsset);
  const dimorphiteResponse = await fetch('/rdkit/dimorphite-sites.js');
  const dimorphiteSource = await dimorphiteResponse.text();
  check(dimorphiteResponse.ok && dimorphiteSource.includes('1166e1f7b4b2f792a02867636af4af49555a8f11')
    && dimorphiteSource.includes('Amines_primary_secondary_tertiary'),
  'ordered Dimorphite-DL 2.0.2 empirical site data is pinned and served');
  const wasmResponse = await fetch('/rdkit/dist/RDKit_minimal.wasm');
  const wasmBytes = await wasmResponse.arrayBuffer();
  check(wasmResponse.ok && WebAssembly.validate(wasmBytes), 'RDKit WASM asset validates', String(wasmResponse.status));

  const acetateStates = await api.enumerateProtonation('CC(=O)O', {
    ph:7.4, phSpread:0, precision:0, maxStates:8,
  });
  check(acetateStates.states.length === 1 && acetateStates.states[0].smiles === 'CC(=O)[O-]'
    && acetateStates.states[0].formalCharge === -1,
  'browser protonation matches Dimorphite-DL carboxyl output above its empirical pKa',
  JSON.stringify(acetateStates.states));
  const amineStates = await api.enumerateProtonation('CCN(CC)CC', {
    ph:7.4, phSpread:0, precision:0, maxStates:8,
  });
  check(amineStates.states.length === 1 && amineStates.states[0].smiles === 'CC[NH+](CC)CC'
    && amineStates.states[0].formalCharge === 1,
  'browser protonation matches Dimorphite-DL tertiary-amine output below its empirical pKa',
  JSON.stringify(amineStates.states));
  const amineBoundary = await api.enumerateProtonation('CCN(CC)CC', {
    ph:8.159107682388349, phSpread:0, precision:0, maxStates:8,
  });
  check(amineBoundary.states.length === 2
    && amineBoundary.states.map((variant) => variant.formalCharge).sort().join(',') === '0,1'
    && Math.abs(amineBoundary.states.reduce((sum, variant) => sum + variant.estimatedPopulation, 0) - 1) < 1e-12,
  'pKa-boundary enumeration branches and normalizes both protonation states',
  JSON.stringify(amineBoundary.states));
  const lsdStates = await api.enumerateProtonation('CCN(CC)C(=O)[C@H]1CN([C@@H]2CC3=CNC4=CC=CC(=C34)C2=C1)C', {
    ph:7.4, phSpread:0.5, precision:1, maxStates:16,
  });
  check(lsdStates.states.length >= 2 && lsdStates.states[0].formalCharge === 1
    && lsdStates.states[0].recommended && lsdStates.source.version === '2.0.2'
    && lsdStates.sites.some((site) => Math.abs(site.meanPka - 8.159107682388349) < 1e-12),
  'LSD exposes ranked neutral/cation states with pinned empirical pKa provenance',
  JSON.stringify({ sites:lsdStates.sites, states:lsdStates.states }));
  await api.loadSmilesWithRdkit('CCN(CC)C(=O)[C@H]1CN([C@@H]2CC3=CNC4=CC=CC(=C34)C2=C1)C', 'LSD');
  await api.enumerateProtonation('CCN(CC)C(=O)[C@H]1CN([C@@H]2CC3=CNC4=CC=CC(=C34)C2=C1)C', {
    ph:7.4, phSpread:0.5, precision:1, maxStates:16,
  });
  const appliedLsdState = await api.applyProtonationState(0);
  check(appliedLsdState.charge === 1 && appliedLsdState.finite
    && appliedLsdState.protonation?.source?.version === '2.0.2'
    && appliedLsdState.protonation?.targetPh === 7.4,
  'selected LSD protonation state is rebuilt in 3D and retains pH/provenance metadata',
  JSON.stringify({ charge:appliedLsdState.charge, protonation:appliedLsdState.protonation }));

  api.load('c1ccccc1');
  api.attachCurrent('trifluoromethyl', 0);
  let singlePoint;
  try { singlePoint = await api.calculateCurrent('energy', 'rdkit'); }
  catch (error) {
    check(false, 'RDKit single-point job starts', error.message);
    const failed = checks.filter((item) => !item.passed);
    return { passed: checks.length - failed.length, total: checks.length, failed, optimizationMetrics, rdkitMetrics };
  }
  check(Number.isFinite(singlePoint.finalEnergy), 'RDKit single-point energy is finite', String(singlePoint.finalEnergy));
  check(singlePoint.forcefield === 'MMFF94' && !singlePoint.fallback, 'MMFF94 parameters are used for benzene + CF3', JSON.stringify(singlePoint));
  check(/^2025\.03\.4/.test(singlePoint.rdkitVersion), 'RDKit WASM version is reported', singlePoint.rdkitVersion);
  check(singlePoint.platform === 'WebAssembly' && singlePoint.backend === 'RDKit', 'RDKit executes in browser WebAssembly', JSON.stringify(singlePoint));
  check(singlePoint.unit === 'kcal/mol', 'RDKit reports kcal/mol natively', singlePoint.unit);
  check(api.current().formula === 'C7H5F3', 'RDKit receives benzene + CF3', api.current().formula);
  const repeatedSinglePoint = await api.calculateCurrent('energy', 'rdkit');
  check(Math.abs(repeatedSinglePoint.finalEnergy - singlePoint.finalEnergy) < 1e-8, 'repeated MMFF94 energies are deterministic', singlePoint.finalEnergy + ' vs ' + repeatedSinglePoint.finalEnergy);
  const rdkitOptimisation = await api.calculateCurrent('geometry', 'rdkit');
  rdkitMetrics = rdkitOptimisation;
  check(Math.abs(rdkitOptimisation.initialEnergy - singlePoint.finalEnergy) < 1e-8, 'optimization starts at the reported single-point energy', singlePoint.finalEnergy + ' vs ' + rdkitOptimisation.initialEnergy);
  check(Number.isFinite(rdkitOptimisation.finalEnergy), 'RDKit optimization energy is finite', String(rdkitOptimisation.finalEnergy));
  check(rdkitOptimisation.finalEnergy <= rdkitOptimisation.initialEnergy + 1e-6, 'MMFF94 optimization lowers potential energy', JSON.stringify(rdkitOptimisation));
  check(api.current().finite, 'RDKit returns finite coordinates');
  check(api.current().formula === 'C7H5F3', 'RDKit optimization preserves benzene + CF3', api.current().formula);
  check(rdkitOptimisation.frameCount >= 3, 'RDKit optimization saves trajectory frames', String(rdkitOptimisation.frameCount));
  check(document.querySelectorAll('#energy-points circle').length === rdkitOptimisation.frameCount, 'RDKit frames populate the energy curve');
  const rdkitFrames = api.calculationFrames();
  const finalGeometry = api.current().molecule;
  api.selectCalculationFrame(0);
  const firstGeometry = api.current().molecule;
  const trajectoryDisplacement = Math.max(...firstGeometry.atoms.map((atom, index) => {
    const final = finalGeometry.atoms[index];
    return Math.hypot(atom.x - final.x, atom.y - final.y, atom.z - final.z);
  }));
  check(trajectoryDisplacement > 0.01, 'selecting an MMFF94 curve dot previews its geometry', trajectoryDisplacement.toFixed(5));
  api.selectCalculationFrame(rdkitFrames.count - 1);
  const restoredGeometry = api.current().molecule;
  const restoreError = Math.max(...restoredGeometry.atoms.map((atom, index) => {
    const final = finalGeometry.atoms[index];
    return Math.hypot(atom.x - final.x, atom.y - final.y, atom.z - final.z);
  }));
  check(restoreError < 1e-10, 'Show final restores the MMFF94 geometry', restoreError.toExponential(3));
  document.querySelector('#trajectory-frame-count').value = '26';
  const dynamics = await api.calculateCurrent('dynamics', 'rdkit');
  check(dynamics.job === 'dynamics', 'RDKit dynamics job completes', dynamics.job);
  check(Number.isFinite(dynamics.finalEnergy), 'RDKit dynamics energy is finite', String(dynamics.finalEnergy));
  check(api.current().finite, 'RDKit dynamics returns finite coordinates');
  check(!document.querySelector('#trajectory-frame-field').classList.contains('hidden'), 'MD shows the saved-frame selector');
  check(!document.querySelector('#simulation-step-field').classList.contains('hidden')
    && document.querySelector('#simulation-step-count').options.length === 5,
    'MD exposes selectable simulation lengths through 100,000 steps');
  check(dynamics.frameCount === 26, 'RDKit dynamics honors the 26-frame selection', String(dynamics.frameCount));
  const rdkitMdFrames = api.calculationFrames();
  check(rdkitMdFrames.job === 'dynamics' && rdkitMdFrames.steps[0] === 0 && rdkitMdFrames.steps.at(-1) === 250 && rdkitMdFrames.timestepFs === 0.1, 'RDKit MD replaces prior frames with a complete step-labelled trajectory', JSON.stringify(rdkitMdFrames));
  check(rdkitMdFrames.alignment?.mode === 'fixed-identity heavy-atom rigid fit'
      && rdkitMdFrames.alignment.referenceFrame === 0
      && rdkitMdFrames.alignment.displayOnly,
    'ordinary MD trajectories report display-only heavy-atom alignment',
    JSON.stringify(rdkitMdFrames.alignment));
  api.selectCalculationFrame(0);
  const rdkitMdStart = api.current().molecule.atoms.filter((atom) => atom.element !== 'H');
  const startCenter = [0, 1, 2].map((axis) => rdkitMdStart.reduce((sum, atom) =>
    sum + atom[['x', 'y', 'z'][axis]], 0) / rdkitMdStart.length);
  api.selectCalculationFrame(rdkitMdFrames.count - 1);
  const rdkitMdEnd = api.current().molecule.atoms.filter((atom) => atom.element !== 'H');
  const endCenter = [0, 1, 2].map((axis) => rdkitMdEnd.reduce((sum, atom) =>
    sum + atom[['x', 'y', 'z'][axis]], 0) / rdkitMdEnd.length);
  check(Math.hypot(...startCenter.map((value, axis) => value - endCenter[axis])) < 1e-8,
    'MD display alignment removes rigid translation across trajectory playback');
  check(document.querySelector('#result-frame-heading').textContent.includes('MD trajectory') && document.querySelector('#result-frame-label').textContent.includes('0.025 ps'), 'RDKit saved frames are visibly labelled as MD snapshots');
  check(!document.querySelector('#result-card').classList.contains('hidden'), 'run workflow completes');
  check(document.querySelector('#result-energy').textContent.includes('kcal/mol'), 'RDKit energy is displayed in kcal/mol');
  check(!document.querySelector('#result-performance').classList.contains('hidden')
    && document.querySelector('#result-throughput').textContent.includes('steps/s'),
    'MD results display runtime and trajectory throughput prominently');
  check(getComputedStyle(document.querySelector('#result-throughput')).whiteSpace === 'normal',
    'trajectory throughput remains fully visible instead of truncating');
  check(!document.querySelector('#result-card').textContent.includes('kJ/mol'), 'Results panel does not show kJ/mol');
  check(document.querySelector('#method-info').textContent.includes('potential energy')
      && document.querySelector('#method-info').textContent.includes('not total energy'),
    'MD information popover distinguishes potential from total energy');

  for (const [smiles, label] of [
    ['c1ccccc1', 'benzene'],
    ['Cn1c(=O)c2c(ncn2C)n(C)c1=O', 'caffeine'],
    ['CC(=O)Oc1ccccc1C(=O)O', 'aspirin'],
  ]) {
    api.load(smiles);
    const energy = await api.calculateCurrent('energy', 'rdkit');
    check(energy.forcefield === 'MMFF94' && !energy.fallback, label + ' uses MMFF94', JSON.stringify(energy));
    check(Number.isFinite(energy.finalEnergy), label + ' MMFF94 energy is finite', String(energy.finalEnergy));
  }

  api.load('CC(=O)Oc1ccccc1C(=O)O');
  let sageEnergy;
  try { sageEnergy = await api.calculateCurrent('energy', 'openmm'); }
  catch (error) {
    check(false, 'OpenFF Sage/OpenMM aspirin single point starts', error.message);
    const failed = checks.filter((item) => !item.passed);
    return { passed: checks.length - failed.length, total: checks.length, failed, optimizationMetrics, rdkitMetrics };
  }
  check(sageEnergy.forcefield === 'OpenFF Sage 2.1.0', 'OpenMM uses OpenFF Sage 2.1.0', JSON.stringify(sageEnergy));
  check(sageEnergy.backend === 'OpenMM WebAssembly' && sageEnergy.platform === 'Reference', 'Sage executes in OpenMM Reference WebAssembly', JSON.stringify(sageEnergy));
  check(sageEnergy.chargeModel.includes('Gasteiger'), 'Sage charge model is explicit', sageEnergy.chargeModel);
  check(sageEnergy.unit === 'kcal/mol' && Number.isFinite(sageEnergy.finalEnergy), 'Sage energy is finite and reported in kcal/mol', JSON.stringify(sageEnergy));
  check(sageEnergy.parameterCounts.constraints === 0 && sageEnergy.parameterCounts.bonds === 21, 'ordinary X-H bonds use unconstrained Sage parameters', JSON.stringify(sageEnergy.parameterCounts));
  let sageWebgpuEnergy;
  try { sageWebgpuEnergy = await api.calculateCurrent('energy', 'webgpu'); }
  catch (error) {
    check(false, 'OpenFF Sage/WebGPU aspirin single point starts', error.message);
  }
  if (sageWebgpuEnergy) {
    const webgpuEnergyError = Math.abs(sageWebgpuEnergy.finalEnergy - sageEnergy.finalEnergy);
    check(sageWebgpuEnergy.forcefield === 'OpenFF Sage 2.1.0' && sageWebgpuEnergy.backend === 'Sage WebGPU', 'WebGPU uses the real Sage parameterization', JSON.stringify(sageWebgpuEnergy));
    check(sageWebgpuEnergy.unit === 'kcal/mol' && Number.isFinite(sageWebgpuEnergy.finalEnergy), 'Sage/WebGPU reports a finite kcal/mol energy', JSON.stringify(sageWebgpuEnergy));
    check(webgpuEnergyError < 0.02, 'Sage/WebGPU single-point energy agrees with OpenMM Reference', webgpuEnergyError.toExponential(4) + ' kcal/mol');
    check(JSON.stringify(sageWebgpuEnergy.parameterCounts) === JSON.stringify(sageEnergy.parameterCounts), 'WebGPU and OpenMM receive identical Sage term counts', JSON.stringify(sageWebgpuEnergy.parameterCounts));
    const forceComparison = compareForces(sageWebgpuEnergy.forces, sageEnergy.forces);
    if (forceComparison) {
      webgpuMetrics.forceRelativeRms = forceComparison.relativeRms;
      webgpuMetrics.forceRmsError = forceComparison.rmsError;
      webgpuMetrics.forceMaximumError = forceComparison.maximumError;
    }
    check(forceComparison && forceComparison.relativeRms < 0.05,
      'Sage/WebGPU force gradient agrees with OpenMM Reference',
      forceComparison ? forceComparison.relativeRms.toExponential(4) + ' relative RMS · '
        + forceComparison.rmsError.toExponential(4) + ' kJ/mol/nm RMS · '
        + forceComparison.maximumError.toExponential(4) + ' kJ/mol/nm max' : 'missing force vectors');
    const webgpuOptimisation = await api.calculateCurrent('geometry', 'webgpu');
    check(webgpuOptimisation.finalEnergy <= webgpuOptimisation.initialEnergy + 1e-4, 'Sage/WebGPU minimization lowers its potential energy', JSON.stringify(webgpuOptimisation));
    check(webgpuOptimisation.frameCount === 26 && api.current().finite,
      'Sage/WebGPU minimization retains 26 evenly spaced real trajectory frames',
      JSON.stringify(webgpuOptimisation));
    const webgpuFinalReference = await api.calculateCurrent('energy', 'openmm');
    const webgpuFinalEnergyError = Math.abs(webgpuOptimisation.finalEnergy - webgpuFinalReference.finalEnergy);
    check(webgpuFinalEnergyError < 0.05, 'OpenMM confirms the final Sage/WebGPU geometry energy', webgpuFinalEnergyError.toExponential(4) + ' kcal/mol');
    api.load('CC(=O)Oc1ccccc1C(=O)O');
    const maskedBefore = api.current().molecule.atoms.map((atom) => [atom.x, atom.y, atom.z]);
    const maskedRelaxation = await api.calculateCurrent('geometry', 'webgpu', {
      movableAtomIndices:[0], maxIterations:20,
    });
    const maskedAfter = api.current().molecule.atoms.map((atom) => [atom.x, atom.y, atom.z]);
    const movableDisplacement = Math.hypot(...maskedAfter[0].map((value, axis) => value - maskedBefore[0][axis]));
    const fixedMaximumDisplacement = Math.max(...maskedAfter.slice(1).map((position, atom) =>
      Math.hypot(...position.map((value, axis) => value - maskedBefore[atom + 1][axis]))));
    check(maskedRelaxation.movableAtomCount === 1 && maskedRelaxation.fixedAtomCount === maskedAfter.length - 1
      && movableDisplacement > 1e-6 && fixedMaximumDisplacement < 1e-5,
    'WebGPU minimization supports an active atom region while outer coordinates remain fixed',
    JSON.stringify({ maskedRelaxation, movableDisplacement, fixedMaximumDisplacement }));
    api.load('CC(=O)Oc1ccccc1C(=O)O');
  }
  const solventSelect = document.querySelector('#solvent-select');
  check(solventSelect && [...solventSelect.options].some((option) => option.value === 'obc2'),
    'Run controls expose OBC2 implicit water');
  solventSelect.value = 'obc2';
  solventSelect.dispatchEvent(new Event('change'));
  check(document.querySelector('#environment-info').textContent.includes('mbondi2')
      && document.querySelectorAll('.info-button[aria-describedby]').length >= 3,
    'Run information buttons explain the selected OBC2 model');
  solventSelect.value = 'vacuum';
  solventSelect.dispatchEvent(new Event('change'));
  const obcReference = await api.calculateCurrent('energy', 'openmm', { implicitSolvent: 'obc2' });
  const obcWebgpu = await api.calculateCurrent('energy', 'webgpu', { implicitSolvent: 'obc2' });
  const obcEnergyError = Math.abs(obcWebgpu.finalEnergy - obcReference.finalEnergy);
  const obcForceComparison = compareForces(obcWebgpu.forces, obcReference.forces);
  webgpuMetrics.obcEnergyError = obcEnergyError;
  webgpuMetrics.obcForceRelativeRms = obcForceComparison?.relativeRms ?? null;
  webgpuMetrics.obcForceRmsError = obcForceComparison?.rmsError ?? null;
  check(obcReference.implicitSolvent === 'OBC2' && obcWebgpu.implicitSolvent === 'OBC2',
    'OpenMM and WebGPU report OBC2 implicit solvent', JSON.stringify({ obcReference, obcWebgpu }));
  check(Number.isFinite(obcWebgpu.finalEnergy) && obcEnergyError < 0.5,
    'OBC2 WebGPU energy agrees with OpenMM Reference', obcEnergyError.toExponential(4) + ' kcal/mol');
  check(obcForceComparison && obcForceComparison.relativeRms < 0.02,
    'OBC2 WebGPU analytical forces agree with OpenMM Reference',
    obcForceComparison ? obcForceComparison.relativeRms.toExponential(4) + ' relative RMS · '
      + obcForceComparison.rmsError.toExponential(4) + ' kJ/mol/nm RMS · '
      + obcForceComparison.maximumError.toExponential(4) + ' kJ/mol/nm max' : 'missing force vectors');
  const cutoffReference = await api.calculateCurrent('energy', 'openmm', {
    implicitSolvent: 'obc2', nonbondedCutoffNm: 1.0,
  });
  const cutoffWebgpu = await api.calculateCurrent('energy', 'webgpu', {
    implicitSolvent: 'obc2', nonbondedCutoffNm: 1.0,
  });
  const cutoffEnergyError = Math.abs(cutoffWebgpu.finalEnergy - cutoffReference.finalEnergy);
  const cutoffForceComparison = compareForces(cutoffWebgpu.forces, cutoffReference.forces);
  check(cutoffReference.cutoffNm === 1 && cutoffWebgpu.cutoffNm === 1
      && cutoffWebgpu.neighborRadiusNm > cutoffWebgpu.cutoffNm,
    'OpenMM and WebGPU report the requested nonperiodic cutoff and Verlet skin',
    JSON.stringify({ cutoffReference, cutoffWebgpu }));
  check(cutoffEnergyError < 0.5,
    'OBC2/cutoff WebGPU energy agrees with OpenMM Reference', cutoffEnergyError.toExponential(4) + ' kcal/mol');
  check(cutoffForceComparison && cutoffForceComparison.relativeRms < 0.02,
    'OBC2/cutoff WebGPU forces agree with OpenMM Reference',
    cutoffForceComparison ? cutoffForceComparison.relativeRms.toExponential(4) + ' relative RMS · '
      + cutoffForceComparison.rmsError.toExponential(4) + ' kJ/mol/nm RMS' : 'missing force vectors');
  check([...document.querySelector('#constraint-select').options].some((option) => option.value === 'hbonds')
      && !document.querySelector('#cutoff-select'),
    'Run controls expose X–H SHAKE/RATTLE but keep the validation-only cutoff out of the UI');
  api.load('CCO');
  const constrainedReference = await api.calculateCurrent('dynamics', 'openmm', {
    constraintMode: 'hbonds', implicitSolvent: 'obc2', nonbondedCutoffNm: 1.0,
    steps: 20, savedFrameCount: 3,
  });
  check(constrainedReference.timestepFs === 2 && constrainedReference.constraintCount > 0
      && constrainedReference.constraintError < 2e-5,
    'OpenMM applies X–H constraints at 2 fs', JSON.stringify(constrainedReference));
  api.load('CCO');
  const constrainedWebgpu = await api.calculateCurrent('dynamics', 'webgpu', {
    constraintMode: 'hbonds', implicitSolvent: 'obc2', nonbondedCutoffNm: 1.0,
    steps: 20, savedFrameCount: 3,
  });
  check(constrainedWebgpu.timestepFs === 2 && constrainedWebgpu.constraintCount > 0
      && constrainedWebgpu.constraintError < 5e-5,
    'WebGPU SHAKE/RATTLE holds X–H constraints at 2 fs', JSON.stringify(constrainedWebgpu));
  api.load('CC(=O)Oc1ccccc1C(=O)O');
  const sageOptimisation = await api.calculateCurrent('geometry', 'openmm');
  check(sageOptimisation.finalEnergy <= sageOptimisation.initialEnergy + 1e-6, 'Sage/OpenMM optimization lowers potential energy', JSON.stringify(sageOptimisation));
  check(sageOptimisation.frameCount >= 2 && api.current().finite, 'Sage/OpenMM optimization returns finite frames', JSON.stringify(sageOptimisation));
  const minimizationPlay = document.querySelector('#result-play-trajectory');
  minimizationPlay.click();
  check(api.calculationFrames().playing && api.calculationFrames().index === 0 && minimizationPlay.textContent.includes('Pause'), 'Play restarts and animates a minimization path');
  await new Promise((resolve) => setTimeout(resolve, 320));
  check(api.calculationFrames().index > 0, 'Minimization playback advances the displayed geometry', JSON.stringify(api.calculationFrames()));
  minimizationPlay.click();
  check(!api.calculationFrames().playing, 'Minimization playback can be paused');
  document.querySelector('#trajectory-frame-count').value = '51';
  const sageDynamics = await api.calculateCurrent('dynamics', 'openmm');
  check(sageDynamics.frameCount === 51 && Number.isFinite(sageDynamics.finalEnergy), 'Sage/OpenMM dynamics honors the 51-frame selection', JSON.stringify(sageDynamics));
  check(document.querySelector('#result-frame-heading').textContent.includes('MD trajectory') && document.querySelector('#result-frame-label').textContent.includes('0.250 ps'), 'OpenMM saved frames show MD time rather than minimization labels');
  const dynamicsPlay = document.querySelector('#result-play-trajectory');
  dynamicsPlay.click();
  check(api.calculationFrames().playing && api.calculationFrames().index === 0 && dynamicsPlay.textContent.includes('Pause'), 'Play restarts and animates an MD trajectory');
  await new Promise((resolve) => setTimeout(resolve, 380));
  check(api.calculationFrames().index > 0, 'MD playback advances the displayed geometry', JSON.stringify(api.calculationFrames()));
  dynamicsPlay.click();
  check(!api.calculationFrames().playing, 'MD playback can be paused');
  check(document.querySelector('#result-energy').textContent.includes('kcal/mol') && !document.querySelector('#result-card').textContent.includes('kJ/mol'), 'Sage result UI uses kcal/mol only');

  api.load('CCO');
  document.querySelector('#trajectory-frame-count').value = '26';
  const webgpuDynamics = await api.calculateCurrent('dynamics', 'webgpu');
  check(webgpuDynamics.backend === 'Sage WebGPU' && Number.isFinite(webgpuDynamics.finalEnergy), 'Sage/WebGPU molecular dynamics completes with finite energy', JSON.stringify(webgpuDynamics));
  check(webgpuDynamics.frameCount === 26 && webgpuDynamics.timestepFs === 1 && api.current().finite, 'Sage/WebGPU dynamics honors frame count and reports its 1 fs step', JSON.stringify(webgpuDynamics));
  const webgpuMdFrames = api.calculationFrames();
  check(webgpuMdFrames.steps[0] === 0 && webgpuMdFrames.steps.at(-1) === 250, 'Sage/WebGPU trajectory spans the requested MD steps', JSON.stringify(webgpuMdFrames));
  api.selectCalculationFrame(0);
  const trajectoryScaleStart = api.viewerState().scale;
  api.selectCalculationFrame(Math.floor(webgpuMdFrames.count / 2));
  const trajectoryScaleMiddle = api.viewerState().scale;
  api.selectCalculationFrame(webgpuMdFrames.count - 1);
  const trajectoryScaleEnd = api.viewerState().scale;
  check(Math.max(trajectoryScaleStart, trajectoryScaleMiddle, trajectoryScaleEnd)
      - Math.min(trajectoryScaleStart, trajectoryScaleMiddle, trajectoryScaleEnd) < 1e-9,
    'trajectory playback keeps a fixed camera scale instead of visually breathing',
    trajectoryScaleStart + ' · ' + trajectoryScaleMiddle + ' · ' + trajectoryScaleEnd);
  const webgpuDynamicsReference = await api.calculateCurrent('energy', 'openmm');
  const webgpuDynamicsEnergyError = Math.abs(webgpuDynamics.finalEnergy - webgpuDynamicsReference.finalEnergy);
  check(webgpuDynamicsEnergyError < 0.05, 'OpenMM confirms the final Sage/WebGPU MD frame energy', webgpuDynamicsEnergyError.toExponential(4) + ' kcal/mol');

  for (const [smiles, label] of [
    ['CCO', 'ethanol'],
    ['c1ccccc1', 'benzene'],
    ['Cn1c(=O)c2c(ncn2C)n(C)c1=O', 'caffeine'],
    ['CC(C)Cc1ccc(cc1)C(C)C(=O)O', 'ibuprofen'],
    ['CC(=O)[O-]', 'acetate anion'],
    ['C[NH3+]', 'methylammonium'],
    ['NS(=O)(=O)c1ccccc1', 'benzenesulfonamide'],
    ['O=[N+]([O-])c1ccccc1', 'nitrobenzene'],
    ['FC(F)(F)c1ccccc1', 'trifluorotoluene'],
    ['c1c[nH]cn1', 'imidazole'],
    ['CNC(C)=O', 'N-methylacetamide'],
    ['NC1CC1', 'cyclopropylamine'],
    ['c1cc[nH+]cc1', 'pyridinium'],
    ['COP(=O)([O-])OC', 'dimethylphosphate'],
  ]) {
    api.load(smiles);
    try {
      const energy = await api.calculateCurrent('energy', 'openmm');
      check(Number.isFinite(energy.finalEnergy), label + ' is covered by Sage/OpenMM', JSON.stringify(energy));
      const gpuEnergy = await api.calculateCurrent('energy', 'webgpu');
      const error = Math.abs(gpuEnergy.finalEnergy - energy.finalEnergy);
      const relativeError = error / Math.max(1, Math.abs(energy.finalEnergy));
      if (relativeError > webgpuMetrics.maximumRelativeEnergyError) {
        webgpuMetrics.maximumRelativeEnergyError = relativeError;
        webgpuMetrics.absoluteEnergyError = error;
        webgpuMetrics.molecule = label;
      }
      check(Number.isFinite(gpuEnergy.finalEnergy) && relativeError < 3e-6,
        label + ' Sage/WebGPU energy agrees with OpenMM Reference',
        relativeError.toExponential(4) + ' relative · ' + error.toExponential(4) + ' kcal/mol · GPU ' + gpuEnergy.finalEnergy.toFixed(6)
          + ' · Reference ' + energy.finalEnergy.toFixed(6));
    } catch (error) {
      check(false, label + ' is covered by Sage/OpenMM', error.message);
    }
  }

  const rosemary = await api.loadRosemaryExample();
  check(rosemary.atoms === 304 && rosemary.bonds === 310 && rosemary.residues === 20,
    'Rosemary reference loads all-atom 20-residue Trp-cage', JSON.stringify(rosemary));
  check(rosemary.forcefield === 'OpenFF Rosemary 3.0.0-alpha0'
    && rosemary.chargeModel === 'NAGL openff-gnn-am1bcc-1.0.0',
    'Rosemary alpha and its NAGL charge model are explicit', JSON.stringify(rosemary));
  check(rosemary.sourceSha256 === 'b64617260a6bdf7befa6920d19e943ba09bb20b12968944fc369dbf86ee44e45',
    'Rosemary fixture records the exact unconstrained alpha OFFXML hash', rosemary.sourceSha256);
  check(rosemary.parameterCounts.particles === 304 && rosemary.parameterCounts.bonds === 310
    && rosemary.parameterCounts.angles === 565 && rosemary.parameterCounts.torsions === 1436
    && rosemary.parameterCounts.exceptions === 1687,
    'Rosemary fixture contains the complete exported OpenMM System', JSON.stringify(rosemary.parameterCounts));
  check(document.querySelector('#method-select option[value="webgpu"]').textContent.includes('Rosemary')
    && document.querySelector('#method-info').textContent.includes('NAGL'),
    'Run controls identify Rosemary and NAGL for the prepared protein');
  check(document.querySelector('#protein-result-title').textContent.includes('Rosemary')
    && document.querySelector('#protein-plddt').textContent === 'PDB',
    'experimental PDB coordinates are not presented as an OpenFold confidence score');

  const rosemaryInteractions = api.renderDiagnostics();
  check(rosemaryInteractions.showInteractions && rosemaryInteractions.hydrogenBonds.length > 0
    && rosemaryInteractions.hydrogenBonds.every((bond) => bond.distance <= 2.6),
  'trajectory viewer derives geometry-filtered dashed hydrogen bonds from the current frame',
  JSON.stringify(rosemaryInteractions.hydrogenBonds));
  const residueFocus = api.focusResidue(0);
  check(Boolean(residueFocus.key) && residueFocus.radius >= 3.5
    && !document.querySelector('#residue-follow-chip').classList.contains('hidden'),
  'protein atoms can establish a persistent residue-follow camera target',
  JSON.stringify(residueFocus));

  const rosemaryReference = await api.calculateCurrent('energy', 'openmm');
  rosemaryMetrics = { openmmEnergy: rosemaryReference.finalEnergy, openmmMs: rosemaryReference.elapsedMs };
  check(rosemaryReference.forcefield === rosemary.forcefield
    && rosemaryReference.chargeModel === rosemary.chargeModel,
    'OpenMM consumes the prepared Rosemary/NAGL System without Sage retyping', JSON.stringify(rosemaryReference));
  check(rosemaryReference.backend === 'OpenMM WebAssembly' && rosemaryReference.platform === 'Reference',
    'Rosemary protein executes in OpenMM Reference WebAssembly', JSON.stringify(rosemaryReference));
  check(Math.abs(rosemaryReference.finalEnergy - (-19.347817409065605)) < 1e-5,
    'browser OpenMM reproduces the native OpenFF Rosemary energy', rosemaryReference.finalEnergy.toFixed(10) + ' kcal/mol');
  check(JSON.stringify(rosemaryReference.parameterCounts) === JSON.stringify(rosemary.parameterCounts),
    'browser OpenMM receives every exported Rosemary term', JSON.stringify(rosemaryReference.parameterCounts));
  check(api.renderDiagnostics().focusedResidueKey === residueFocus.key,
    'residue camera target survives calculation frame updates', api.renderDiagnostics().focusedResidueKey);
  api.focusResidue(0);
  check(api.renderDiagnostics().focusedResidueKey === null
    && document.querySelector('#residue-follow-chip').classList.contains('hidden'),
  'clicking the followed residue again clears trajectory tracking');

  let rosemaryGpu;
  try { rosemaryGpu = await api.calculateCurrent('energy', 'webgpu'); }
  catch (error) { check(false, 'Rosemary direct WebGPU protein single point starts', error.message); }
  if (rosemaryGpu) {
    const energyError = Math.abs(rosemaryGpu.finalEnergy - rosemaryReference.finalEnergy);
    const forceComparison = compareForces(rosemaryGpu.forces, rosemaryReference.forces);
    rosemaryMetrics.webgpuEnergy = rosemaryGpu.finalEnergy;
    rosemaryMetrics.webgpuMs = rosemaryGpu.elapsedMs;
    rosemaryMetrics.energyError = energyError;
    rosemaryMetrics.forceRelativeRms = forceComparison?.relativeRms ?? null;
    check(rosemaryGpu.backend === 'Rosemary WebGPU' && rosemaryGpu.forcefield === rosemary.forcefield,
      'experimental WebGPU evaluator consumes the same Rosemary System', JSON.stringify(rosemaryGpu));
    check(Number.isFinite(rosemaryGpu.finalEnergy) && energyError < 0.1,
      'Rosemary/WebGPU protein energy agrees with OpenMM Reference', energyError.toExponential(4) + ' kcal/mol');
    check(forceComparison && forceComparison.relativeRms < 0.08,
      'Rosemary/WebGPU protein forces agree with OpenMM Reference',
      forceComparison ? forceComparison.relativeRms.toExponential(4) + ' relative RMS' : 'missing force vectors');
  }

  api.load('B');
  check(!document.querySelector('#run-left-panel').classList.contains('hidden') && document.querySelector('#display-options').classList.contains('hidden'), 'loading a molecule preserves the Run-mode panel state');
  const uffEnergy = await api.calculateCurrent('energy', 'rdkit');
  check(uffEnergy.forcefield === 'UFF' && uffEnergy.fallback, 'unsupported MMFF94 chemistry uses genuine UFF fallback', JSON.stringify(uffEnergy));
  check(Number.isFinite(uffEnergy.finalEnergy), 'UFF fallback energy is finite', String(uffEnergy.finalEnergy));
  check(uffEnergy.unit === 'kcal/mol', 'UFF fallback reports kcal/mol', uffEnergy.unit);

  if (captureDockingUi) {
    api.loadObject(dockingFixture);
    document.querySelector('.mode-bar button[data-mode="build"]').click();
    api.setDockingMode('selected-core');
    api.setDockingSelection([3, 4, 5]);
    await api.captureDockingReference();
    await api.runConstrainedDocking({ conformerCount:4, seed:20260819, torsionSteps:32 });
  }
  const failed = checks.filter((item) => !item.passed);
  return { passed: checks.length - failed.length, total: checks.length, failed, optimizationMetrics, rdkitMetrics, aniMetrics, webgpuMetrics, rosemaryMetrics, preparationMetrics };
})()`;

try {
  if (!externalAppUrl) {
    server = Bun.spawn(['bun', 'server.js',
      ...(productionApiBoundary ? [] : ['--test-api']), '--port', String(appPort)], {
      cwd: import.meta.dir,
      stdout: 'ignore',
      stderr: 'pipe',
    });
  }
  await waitFor(async () => (await fetch(appUrl)).ok);

  chrome = Bun.spawn([
    chromePath,
    ...chromePlatformArgs,
    '--headless',
    '--disable-extensions',
    '--no-first-run',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1000',
    appUrl,
  ], { stdout: 'ignore', stderr: 'ignore' });

  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    return pages.find((item) => item.type === 'page' && item.url === appUrl);
  });
  const client = new DevToolsClient(page.webSocketDebuggerUrl);
  await client.open();
  await waitFor(async () => {
    const readiness = await client.call('Runtime.evaluate', {
      expression:productionApiBoundary
        ? 'Boolean(window.MolariumChemistActionsReady)'
        : 'Boolean(window.molariumTest)', returnByValue: true });
    return readiness.result.value;
  });
  const evaluation = await client.call('Runtime.evaluate', { expression: browserSuite, awaitPromise: true, returnByValue: true });
  if (evaluation.exceptionDetails) throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text);
  if (Bun.env.MOLARIUM_TEST_SCREENSHOT) {
    if (Bun.env.MOLARIUM_TEST_SCREENSHOT_SMILES) {
      const smiles = JSON.stringify(Bun.env.MOLARIUM_TEST_SCREENSHOT_SMILES);
      await client.call('Runtime.evaluate', {
        expression: `window.molariumTest.load(${smiles}); document.querySelector('[data-mode="${Bun.env.MOLARIUM_TEST_SCREENSHOT_ADD_ELEMENT ? 'build' : 'view'}"]').click();${Bun.env.MOLARIUM_TEST_SCREENSHOT_ADD_ELEMENT ? `window.molariumTest.addElementCurrent(${JSON.stringify(Bun.env.MOLARIUM_TEST_SCREENSHOT_ADD_ELEMENT)}, 0);` : ''}`,
      });
      await delay(100);
    }
    const capture = await client.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await Bun.write(Bun.env.MOLARIUM_TEST_SCREENSHOT, Buffer.from(capture.data, 'base64'));
  }
  client.close();
  const report = evaluation.result.value;
  if (Bun.env.MOLARIUM_OPENMM_POSE_RESULT && report.openmmPoseMetrics)
    await Bun.write(Bun.env.MOLARIUM_OPENMM_POSE_RESULT,
      JSON.stringify(report.openmmPoseMetrics, null, 2) + '\n');
  if (Bun.env.MOLARIUM_EXPORT_STRAIN_FIXTURE
      && report.preparationMetrics?.cyclohexanoneStrainFixture) {
    await Bun.write(Bun.env.MOLARIUM_EXPORT_STRAIN_FIXTURE,
      JSON.stringify(report.preparationMetrics.cyclohexanoneStrainFixture, null, 2));
    report.preparationMetrics.cyclohexanoneStrainFixture = {
      writtenTo:Bun.env.MOLARIUM_EXPORT_STRAIN_FIXTURE,
    };
  }
  for (const failure of report.failed) console.error(`FAIL ${failure.label}${failure.details ? ` — ${failure.details}` : ''}`);
  console.log(`${report.passed}/${report.total} browser checks passed`);
  if (report.optimizationMetrics) {
    const metric = report.optimizationMetrics;
    console.log(`Optimization: E ${metric.initialEnergy.toFixed(6)} → ${metric.finalEnergy.toFixed(6)}, RMS force ${metric.rmsForce.toExponential(3)}, ${metric.iterations} iterations`);
  }
  if (report.rdkitMetrics) {
    const metric = report.rdkitMetrics;
    console.log(`RDKit ${metric.rdkitVersion} ${metric.forcefield}: E ${metric.initialEnergy.toFixed(6)} → ${metric.finalEnergy.toFixed(6)} kcal/mol in ${(metric.elapsedMs / 1000).toFixed(3)} s`);
  }
  if (report.aniMetrics) {
    const metric = report.aniMetrics;
    console.log(`ANI-2x ${metric.platform}: TorchANI ΔE ${metric.energyError.toExponential(3)} kcal/mol · force ${metric.forceRelativeRms.toExponential(3)} relative RMS / ${metric.forceMaximumError.toExponential(3)} max`);
    console.log(`ANI-2x minimization: E ${metric.initialEnergy.toFixed(6)} → ${metric.finalEnergy.toFixed(6)} kcal/mol · ${metric.evaluations} evaluations in ${(metric.minimizationMs / 1000).toFixed(3)} s`);
  }
  if (report.webgpuMetrics) {
    const metric = report.webgpuMetrics;
    console.log(`Sage WebGPU: maximum OpenMM single-point deviation ${metric.maximumRelativeEnergyError.toExponential(3)} relative / ${metric.absoluteEnergyError.toExponential(3)} kcal/mol (${metric.molecule})`);
    if (metric.forceRelativeRms !== null)
      console.log(`Sage WebGPU: OpenMM force deviation ${metric.forceRelativeRms.toExponential(3)} relative RMS / ${metric.forceRmsError.toExponential(3)} kJ/mol/nm RMS / ${metric.forceMaximumError.toExponential(3)} max`);
    if (metric.obcEnergyError !== null)
      console.log(`OBC2 WebGPU: OpenMM energy deviation ${metric.obcEnergyError.toExponential(3)} kcal/mol · force deviation ${metric.obcForceRelativeRms.toExponential(3)} relative RMS / ${metric.obcForceRmsError.toExponential(3)} kJ/mol/nm RMS`);
  }
  if (report.rosemaryMetrics) {
    const metric = report.rosemaryMetrics;
    console.log(`Rosemary Trp-cage: OpenMM ${metric.openmmEnergy.toFixed(8)} kcal/mol in ${(metric.openmmMs / 1000).toFixed(3)} s`
      + (Number.isFinite(metric.webgpuEnergy) ? ` · WebGPU ${metric.webgpuEnergy.toFixed(8)} kcal/mol in ${(metric.webgpuMs / 1000).toFixed(3)} s · Δ ${metric.energyError.toExponential(3)} kcal/mol` : ''));
  }
  if (report.preparationMetrics) console.log(`Protein preparation fixture: ${JSON.stringify(report.preparationMetrics)}`);
  if (report.failed.length) process.exitCode = 1;
} finally {
  chrome?.kill();
  server?.kill();
  await rm(profile, { recursive: true, force: true });
}
