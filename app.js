import { validateRegisteredDesignRoute } from './design-history/structures/design-route.mjs';
import { applyRegisteredLigandDefinition, serializeRegisteredLigandDefinition,
  validateConnectedMolecularGraph } from
  './design-history/structures/registered-ligand-graph.mjs';
import { DESIGNER_REVIEW_DIRECTIONS, designerReplayReviewState,
  designerReplayReviewTarget } from './design-history/designer-replay-review.mjs';
import { MOLECULAR_STATE_HASH_SCHEMA, molecularStateSha256 } from './molecular-state-hash.mjs';
import { registeredPoseRetentionPlan } from './docking/registered-pose-retention.mjs';

const MOLARIUM_NETWORK_POLICY = Object.freeze({
  mode:'connected', localOnly:false, policy:'connected-v1',
  allowedNetworkOrigins:['user-approved external services'],
  buildManifest:'./local-lab-manifest.json',
  ...(globalThis.MOLARIUM_RUNTIME_CONFIG || {}),
});
const MOLARIUM_LOCAL_ONLY = MOLARIUM_NETWORK_POLICY.localOnly === true;
const MOLARIUM_ASSET_BASE = MOLARIUM_NETWORK_POLICY.assetBase
  ? new URL(MOLARIUM_NETWORK_POLICY.assetBase, location.href).href : null;
let hydrogenBondFeaturePerception = null;
let hydrogenBondFeatureValidation = null;
let manualHydrogenBondModule = null;
import('./docking/contact-remap.mjs').then((module) => {
  hydrogenBondFeaturePerception = module.perceiveHydrogenBondFeature;
  hydrogenBondFeatureValidation = module.validateCapturedLigandHydrogenBondFeature;
  if (typeof state !== 'undefined' && state.molecule) draw();
}).catch(() => { /* capture/refinement reports a precise error if the module is unavailable */ });
import('./docking/manual-hbond.mjs').then((module) => {
  manualHydrogenBondModule = module;
  if (typeof state !== 'undefined' && state.molecule) draw();
}).catch(() => { /* the add-contact action reports a precise error if unavailable */ });

function molariumAssetUrl(path, localUrl) {
  return MOLARIUM_ASSET_BASE ? new URL(path, MOLARIUM_ASSET_BASE).href : localUrl;
}

function requireExternalNetwork(feature) {
  if (MOLARIUM_LOCAL_ONLY)
    throw new Error(`${feature} is disabled by Local Lab. Load a downloaded file instead, or restart Molarium in connected mode.`);
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyLoadedBuild() {
  const button = document.querySelector('#verify-local-build');
  const result = document.querySelector('#network-verification-result');
  button.disabled = true;
  result.className = 'network-verification-result';
  result.textContent = 'Hashing reviewed application files…';
  try {
    const manifestResponse = await fetch(MOLARIUM_NETWORK_POLICY.buildManifest, { cache:'no-store' });
    if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    if (manifest.algorithm !== 'SHA-256' || !Array.isArray(manifest.files) || !manifest.files.length)
      throw new Error('invalid manifest');
    for (const entry of manifest.files) {
      const response = await fetch(new URL(entry.path, location.href), { cache:'no-store' });
      if (!response.ok) throw new Error(`${entry.path}: HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== entry.bytes) throw new Error(`${entry.path}: size mismatch`);
      if (await sha256Hex(bytes) !== entry.sha256) throw new Error(`${entry.path}: hash mismatch`);
    }
    result.classList.add('success');
    result.textContent = `Verified ${manifest.files.length} reviewed files against the SHA-256 manifest.`;
  } catch (error) {
    result.classList.add('failure');
    result.textContent = `Verification failed: ${error.message}`;
  } finally { button.disabled = false; }
}

function initializeNetworkPolicyUi() {
  const button = document.querySelector('#network-policy-button');
  const label = document.querySelector('#network-policy-label');
  const origin = location.origin;
  button.classList.add(MOLARIUM_LOCAL_ONLY ? 'local-lab' : 'connected');
  label.textContent = MOLARIUM_LOCAL_ONLY ? 'Local Lab · network locked' : 'Connected features';
  button.dataset.networkMode = MOLARIUM_NETWORK_POLICY.mode;
  document.querySelector('#network-policy-mode').textContent = MOLARIUM_LOCAL_ONLY ? 'Local Lab' : 'Connected';
  document.querySelector('#network-policy-connections').textContent = MOLARIUM_LOCAL_ONLY
    ? `${origin} only` : 'Same-origin assets plus explicit RCSB/MSA requests';
  document.querySelector('#network-policy-enforcement').textContent = MOLARIUM_LOCAL_ONLY
    ? 'Browser CSP + disabled connected controls' : 'Explicit action and destination disclosure';
  document.querySelector('#network-policy-id').textContent = MOLARIUM_NETWORK_POLICY.policy;
  document.querySelector('#network-policy-summary').textContent = MOLARIUM_LOCAL_ONLY
    ? 'External network access is blocked by the browser. Molecular inputs and results remain on this device.'
    : 'Calculations are local, but PDB/CCD retrieval and MSA search can contact the destination shown in the interface.';
  document.documentElement.dataset.networkMode = MOLARIUM_NETWORK_POLICY.mode;
  if (!MOLARIUM_LOCAL_ONLY) return;

  const msaEndpoint = document.querySelector('#msa-endpoint');
  const foldButton = document.querySelector('#fold-protein');
  msaEndpoint.disabled = true;
  foldButton.disabled = true;
  foldButton.textContent = 'MSA unavailable in Local Lab';
  document.querySelector('.fold-privacy').textContent = 'Local Lab blocks sequence submission. Local inference can use a future imported MSA bundle.';
  document.querySelector('.fold-settings').classList.add('network-disabled');
  const ligandMode = document.querySelector('#preparation-ligands');
  ligandMode.value = 'exclude';
  ligandMode.querySelector('option[value="ccd"]').disabled = true;
  document.querySelector('#identifier-input').placeholder = 'SMILES or common name (PDB lookup is blocked)';
}

const ELEMENTS = {
  H: { color: '#e8edf2', edge: '#a9b3c0', radius: 0.32, covalent: 0.31, name: 'Hydrogen' },
  B: { color: '#e8998f', edge: '#9f4b44', radius: 0.56, covalent: 0.85, name: 'Boron' },
  C: { color: '#27313d', edge: '#080d12', radius: 0.54, covalent: 0.76, name: 'Carbon' },
  N: { color: '#3155cf', edge: '#172f8f', radius: 0.52, covalent: 0.71, name: 'Nitrogen' },
  O: { color: '#e0473e', edge: '#a6201a', radius: 0.50, covalent: 0.66, name: 'Oxygen' },
  F: { color: '#63c86c', edge: '#258d32', radius: 0.48, covalent: 0.57, name: 'Fluorine' },
  Si: { color: '#c6a176', edge: '#80603f', radius: 0.66, covalent: 1.11, name: 'Silicon' },
  S: { color: '#e9c948', edge: '#a48510', radius: 0.64, covalent: 1.05, name: 'Sulfur' },
  P: { color: '#ec8b42', edge: '#a94a16', radius: 0.61, covalent: 1.07, name: 'Phosphorus' },
  Cl: { color: '#46b852', edge: '#1c7626', radius: 0.62, covalent: 1.02, name: 'Chlorine' },
  Br: { color: '#a93d32', edge: '#61211c', radius: 0.65, covalent: 1.20, name: 'Bromine' },
  I: { color: '#7852a9', edge: '#432967', radius: 0.72, covalent: 1.39, name: 'Iodine' },
};

const ATOM_RENDER_STYLE = Object.freeze({
  H: { highlight: '#ffffff', base: '#f4f5f3', shade: '#c8ccce' },
  C: { highlight: '#f3f3ef', base: '#a9adae', shade: '#666c70' },
  N: { highlight: '#dce7ff', base: '#5579df', shade: '#263e9c' },
  O: { highlight: '#ffe2de', base: '#e9564c', shade: '#a8201b' },
  F: { highlight: '#e3ffdc', base: '#65c95f', shade: '#288d31' },
  Cl: { highlight: '#ddffd8', base: '#55bd54', shade: '#207428' },
  Br: { highlight: '#ffd9d0', base: '#aa493d', shade: '#64231e' },
  I: { highlight: '#eee2ff', base: '#8262ad', shade: '#493267' },
  S: { highlight: '#fff8c9', base: '#ebcf4e', shade: '#9b8214' },
  P: { highlight: '#ffe0c8', base: '#ed914c', shade: '#a64d1d' },
  B: { highlight: '#ffe1dc', base: '#e89b90', shade: '#9d4c46' },
  Si: { highlight: '#f9e8d4', base: '#c7a47e', shade: '#806142' },
});

const DESIGN_DISPLAY_THEMES = Object.freeze({
  'design-hit':Object.freeze({ ligand:'#16838a' }),
  'design-prediction':Object.freeze({ ligand:'#7159a3' }),
  'design-validation':Object.freeze({ ligand:'#d07836' }),
});
const RESIDUE_LABEL_TONES = Object.freeze({
  gold:Object.freeze({ base:'#bf842d', line:'#9a681c', text:'#68420b' }),
  blue:Object.freeze({ base:'#337fa2', line:'#24718f', text:'#16485d' }),
  slate:Object.freeze({ base:'#7b8795', line:'#637080', text:'#364152' }),
});
const STORY_PROTEIN_CARBON = '#aeb9c5';
const STORY_CARTOON_COLOR = '#cfe5df';
const DISPLAY_VDW_RADII = Object.freeze({
  H:1.20, B:1.92, C:1.70, N:1.55, O:1.52, F:1.47, Si:2.10, P:1.80,
  S:1.80, Cl:1.75, Br:1.85, I:1.98,
});

function mixHexColors(first, second, amount) {
  const channel = (color, offset) => Number.parseInt(color.slice(offset, offset + 2), 16);
  const mixed = [1, 3, 5].map((offset) => Math.round(channel(first, offset) * (1 - amount)
    + channel(second, offset) * amount));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function colorRenderStyle(base, highlightAmount = .68, shadeAmount = .38) {
  return { highlight:mixHexColors(base, '#ffffff', highlightAmount), base,
    shade:mixHexColors(base, '#000000', shadeAmount) };
}

function residueLabelForAtom(atom) {
  if (!isProteinAtom(atom)) return null;
  return state.focusedAtomResidueLabels.find((spec) =>
    String(atom.chain || 'A') === String(spec.chain || 'A')
    && String(atom.residueIndex) === String(spec.residueIndex)
    && String(atom.insertionCode || '') === String(spec.insertionCode || '')) || null;
}

function atomRenderStyle(atom) {
  const fallback = ATOM_RENDER_STYLE[atom.element]
    || { highlight: '#f2f2f2', base: ELEMENTS[atom.element].color, shade: ELEMENTS[atom.element].edge };
  if (atom.element !== 'C') return fallback;
  const componentId = state.atomComponentIds[atom.index];
  const component = state.structureComponents.find((entry) => entry.id === componentId);
  if (!component || !['protein', 'ligand'].includes(component.kind)) return fallback;
  const labelTone = RESIDUE_LABEL_TONES[residueLabelForAtom(atom)?.tone];
  if (labelTone) return colorRenderStyle(labelTone.base, .62, .34);
  const storyTheme = DESIGN_DISPLAY_THEMES[state.displayColorTheme];
  if (storyTheme) return colorRenderStyle(
    component.kind === 'ligand' ? storyTheme.ligand : STORY_PROTEIN_CARBON,
    component.kind === 'ligand' ? .48 : .72,
    component.kind === 'ligand' ? .34 : .25,
  );
  return colorRenderStyle(component.color);
}

const DEFAULT_XYZ = `38
Molecular system
C -1.3357 3.0834 -2.7427
O -0.3726 2.0370 -2.7181
C -0.5062 0.8722 -3.4797
O -1.4813 0.7341 -4.2657
C 0.5502 -0.1498 -3.4219
C 1.9041 0.2221 -3.3689
C 2.7727 -0.8587 -3.4462
N 4.2013 -0.7819 -3.4428
O 4.7757 0.3227 -3.3562
O 4.9541 -1.9292 -3.5331
S 1.8865 -2.2797 -3.5643
C 0.3746 -1.5446 -3.5031
O -0.8106 -2.2939 -3.4777
C -2.0563 -1.8448 -2.9575
H -1.0129 3.8923 -2.0557
H -2.3228 2.6993 -2.4084
H -1.4219 3.4968 -3.7700
H 2.2395 1.2503 -3.3149
H -1.9029 -1.1805 -2.0805
H -2.6411 -1.3357 -3.7482
H -2.6422 -2.7268 -2.6271
C 0.2596 -0.5444 2.7716
C -1.2431 -0.2671 2.8786
C -1.5259 0.7233 4.0138
N -0.9969 0.2113 5.2853
C 0.4609 0.0443 5.2110
C 0.8286 -0.9751 4.1270
H 0.7830 0.3735 2.4236
H 0.4368 -1.3461 2.0228
H -1.7849 -1.2186 3.0738
H -1.6123 0.1525 1.9181
H -1.0803 1.7161 3.7758
H -2.6253 0.8576 4.1052
H -1.1984 0.9248 6.0242
H 0.8348 -0.3249 6.1903
H 0.9567 1.0200 5.0033
H 0.4205 -1.9723 4.4028
H 1.9343 -1.0596 4.0554`;

const LSD_SMILES = 'CCN(CC)C(=O)[C@H]1CN([C@@H]2CC3=CNC4=CC=CC(=C34)C2=C1)C';

const LIBRARY = {
  lsd: { name: 'LSD', smiles: LSD_SMILES },
  water: { name: 'Water', smiles: 'O', xyz: `3\nWater\nO 0 0 0\nH 0.758 0.586 0\nH -0.758 0.586 0` },
  ethanol: { name: 'Ethanol', smiles: 'CCO', xyz: `9\nEthanol\nC -0.75 0 0\nC 0.72 0 0\nO 1.35 1.15 0\nH -1.12 -0.54 0.89\nH -1.12 -0.54 -0.89\nH -1.12 1.03 0\nH 1.08 -0.52 0.89\nH 1.08 -0.52 -0.89\nH 2.29 1.03 0` },
  benzene: { name: 'Benzene', smiles: 'c1ccccc1', xyz: makeRingXYZ('C', 6, 1.39, true) },
  caffeine: { name: 'Caffeine', smiles: 'Cn1c(=O)c2c(ncn2C)n(C)c1=O', xyz: `14\nCaffeine core\nN -1.20 0.58 0.08\nC -0.20 1.45 0.03\nN 1.02 0.87 -0.04\nC 0.68 -0.47 -0.03\nC -0.73 -0.56 0.04\nC -1.61 -1.61 0.09\nO -1.23 -2.78 0.09\nN 0.10 -1.45 -0.03\nC 1.47 -1.01 -0.08\nO 2.43 -1.76 -0.11\nN 2.05 0.06 -0.10\nC -2.58 0.93 0.15\nC 0.24 -2.87 -0.06\nC 3.45 0.36 -0.17` },
  aspirin: { name: 'Aspirin', smiles: 'CC(=O)Oc1ccccc1C(=O)O', xyz: `13\nAspirin core\nC -1.40 0.00 0\nC -0.70 1.21 0\nC 0.70 1.21 0\nC 1.40 0.00 0\nC 0.70 -1.21 0\nC -0.70 -1.21 0\nC 2.86 0.00 0\nO 3.48 1.05 0\nO 3.49 -1.10 0\nO -1.42 2.39 0\nC -2.81 2.42 0\nO -3.38 3.48 0\nC -3.47 1.12 0` },
};

const FRAGMENTS = [
  { id: 'methyl', label: '−CH₃', name: 'Methyl', smiles: 'C', attach: 0 },
  { id: 'ethyl', label: '−CH₂CH₃', name: 'Ethyl', smiles: 'CC', attach: 0 },
  { id: 'isopropyl', label: '−CH(CH₃)₂', name: 'Isopropyl', smiles: 'CC(C)', attach: 1 },
  { id: 'tert-butyl', label: '−C(CH₃)₃', name: 'Tert-butyl', smiles: 'CC(C)(C)', attach: 1 },
  { id: 'formyl', label: '−CHO', name: 'Formyl', smiles: 'C=O', attach: 0 },
  { id: 'hydroxyl', label: '−OH', name: 'Hydroxyl', smiles: 'O', attach: 0 },
  { id: 'carboxyl', label: '−COOH', name: 'Carboxyl', smiles: 'C(=O)O', attach: 0 },
  { id: 'ethynyl', label: '−C≡CH', name: 'Ethynyl', smiles: 'C#C', attach: 0 },
  { id: 'trifluoromethyl', label: '−CF₃', name: 'Trifluoromethyl', smiles: 'C(F)(F)F', attach: 0 },
  { id: 'cyano', label: '−C≡N', name: 'Cyano', smiles: 'C#N', attach: 0 },
  { id: 'amino', label: '−NH₂', name: 'Amino', smiles: 'N', attach: 0 },
  { id: 'phenyl', label: '−C₆H₅', name: 'Phenyl', smiles: 'c1ccccc1', attach: 0 },
];

function makeRingXYZ(element, count, radius, hydrogens) {
  const atoms = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    atoms.push(`${element} ${(Math.cos(a) * radius).toFixed(3)} ${(Math.sin(a) * radius).toFixed(3)} 0`);
  }
  if (hydrogens) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      atoms.push(`H ${(Math.cos(a) * (radius + 1.08)).toFixed(3)} ${(Math.sin(a) * (radius + 1.08)).toFixed(3)} 0`);
    }
  }
  return `${atoms.length}\nRing\n${atoms.join('\n')}`;
}

function parseSMILES(input, name = 'SMILES structure') {
  const source = input.trim();
  if (!source) throw new Error('Enter a SMILES string first.');
  if (/^InChI=/i.test(source)) throw new Error('InChI lookup needs a remote chemistry service. Please enter SMILES.');

  const atoms = [];
  const bonds = [];
  const branches = [];
  const rings = new Map();
  let current = null;
  let pendingBond = null;
  let i = 0;

  const appendBond = (a, b, order = null) => {
    if (a == null || b == null || a === b) throw new Error('Invalid bond placement in SMILES.');
    if (bonds.some((bond) => (bond.a === a && bond.b === b) || (bond.a === b && bond.b === a))) return;
    const aromatic = atoms[a].aromatic && atoms[b].aromatic;
    bonds.push({ a, b, order: order ?? (aromatic ? 1.5 : 1) });
  };

  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) { i += 1; continue; }

    if (char === '(') {
      if (current == null) throw new Error('A branch must follow an atom.');
      branches.push(current); i += 1; continue;
    }
    if (char === ')') {
      if (!branches.length) throw new Error('Unmatched closing branch in SMILES.');
      current = branches.pop(); i += 1; continue;
    }
    if (char === '.') { current = null; pendingBond = null; i += 1; continue; }
    if (char === '-') { pendingBond = 1; i += 1; continue; }
    if (char === '=') { pendingBond = 2; i += 1; continue; }
    if (char === '#') { pendingBond = 3; i += 1; continue; }
    if (char === ':') { pendingBond = 1.5; i += 1; continue; }
    if (char === '/' || char === '\\') { pendingBond ??= 1; i += 1; continue; }
    if (char === '@') { i += source[i + 1] === '@' ? 2 : 1; continue; }

    if (/\d/.test(char) || char === '%') {
      if (current == null) throw new Error('A ring number must follow an atom.');
      let ringKey;
      if (char === '%') {
        ringKey = source.slice(i + 1, i + 3);
        if (!/^\d{2}$/.test(ringKey)) throw new Error('Ring numbers after % need two digits.');
        i += 3;
      } else {
        ringKey = char; i += 1;
      }
      if (rings.has(ringKey)) {
        const ring = rings.get(ringKey);
        appendBond(ring.atom, current, pendingBond ?? ring.order);
        rings.delete(ringKey);
      } else {
        rings.set(ringKey, { atom: current, order: pendingBond });
      }
      pendingBond = null;
      continue;
    }

    let token = null;
    if (char === '[') {
      const end = source.indexOf(']', i + 1);
      if (end < 0) throw new Error('Unclosed bracket atom in SMILES.');
      const content = source.slice(i + 1, end);
      const match = content.match(/^(?:\d+)?([A-Z][a-z]?|[bcnops])/);
      if (!match) throw new Error(`Unsupported bracket atom [${content}].`);
      const symbol = match[1];
      const hydrogenMatch = content.slice(match[0].length).match(/H(\d*)/);
      const chargeMatch = content.match(/([+-])(\d*)/);
      const repeatedCharge = content.match(/(\+{2,}|-{2,})/);
      let charge = 0;
      if (repeatedCharge) charge = repeatedCharge[0][0] === '+' ? repeatedCharge[0].length : -repeatedCharge[0].length;
      else if (chargeMatch) charge = (chargeMatch[1] === '+' ? 1 : -1) * Number(chargeMatch[2] || 1);
      token = {
        element: normalizeElement(symbol),
        aromatic: symbol === symbol.toLowerCase(),
        bracketed: true,
        explicitHydrogens: hydrogenMatch ? Number(hydrogenMatch[1] || 1) : 0,
        charge,
      };
      i = end + 1;
    } else {
      const pair = source.slice(i, i + 2);
      if (['Cl', 'Br', 'Si'].includes(pair)) {
        token = { element: pair, aromatic: false, bracketed: false, explicitHydrogens: null, charge: 0 };
        i += 2;
      } else if (/[BCNOPSFHI]/.test(char)) {
        token = { element: char, aromatic: false, bracketed: false, explicitHydrogens: null, charge: 0 };
        i += 1;
      } else if (/[bcnops]/.test(char)) {
        token = { element: normalizeElement(char), aromatic: true, bracketed: false, explicitHydrogens: null, charge: 0 };
        i += 1;
      } else {
        throw new Error(`Could not parse SMILES near “${source.slice(i, i + 8)}”.`);
      }
    }

    if (!ELEMENTS[token.element]) throw new Error(`${token.element} is not supported by this viewer yet.`);
    const next = atoms.length;
    atoms.push({ ...token, x: 0, y: 0, z: 0 });
    if (current != null) appendBond(current, next, pendingBond);
    current = next;
    pendingBond = null;
  }

  if (branches.length) throw new Error('Unclosed branch in SMILES.');
  if (rings.size) throw new Error(`Ring ${[...rings.keys()][0]} was not closed.`);
  if (!atoms.length) throw new Error('No atoms were found in that SMILES string.');

  layoutMolecularGraph(atoms, bonds);
  addImplicitHydrogens(atoms, bonds);
  seedLocal3DGeometry(atoms, bonds);
  const totalCharge = atoms.reduce((sum, atom) => sum + (atom.charge || 0), 0);
  return { atoms, bonds, name, smiles: source, charge: totalCharge, multiplicity: 1,
    source:{ format:'smiles', input:source, topologyParser:'Molarium SMILES parser' } };
}

function layoutMolecularGraph(atoms, bonds) {
  const adjacency = atoms.map(() => []);
  bonds.forEach((bond) => { adjacency[bond.a].push(bond.b); adjacency[bond.b].push(bond.a); });
  const seen = new Set();
  const components = [];
  for (let root = 0; root < atoms.length; root++) {
    if (seen.has(root)) continue;
    const component = [];
    const queue = [root]; seen.add(root);
    while (queue.length) {
      const index = queue.shift(); component.push(index);
      for (const neighbor of adjacency[index]) if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
    }
    // SMILES atom order follows the molecular walk. Keeping that order here is
    // especially important for rings; breadth-first order would seed ring atoms
    // around the circle as 0, 1, 5, 2, 4, 3 and create crossed geometry.
    components.push(component.sort((a, b) => a - b));
  }

  let componentOffset = 0;
  const bondedPairs = new Set(bonds.map((bond) => pairKey(bond.a, bond.b)));
  components.forEach((component, componentNumber) => {
    const count = component.length;
    const radius = count < 3 ? 0.75 : Math.max(1.25, count * 0.21);
    component.forEach((atomIndex, index) => {
      const angle = count === 1 ? 0 : (index / count) * Math.PI * 2 - Math.PI / 2;
      atoms[atomIndex].x = Math.cos(angle) * radius;
      atoms[atomIndex].y = Math.sin(angle) * radius;
      atoms[atomIndex].z = 0;
    });

    for (let iteration = 0; iteration < 420; iteration++) {
      const forces = new Map(component.map((index) => [index, { x: 0, y: 0 }]));
      for (let a = 0; a < component.length; a++) {
        for (let b = a + 1; b < component.length; b++) {
          const ia = component[a], ib = component[b];
          let dx = atoms[ib].x - atoms[ia].x, dy = atoms[ib].y - atoms[ia].y;
          let distance = Math.hypot(dx, dy) || 0.001;
          const bonded = bondedPairs.has(pairKey(ia, ib));
          if (!bonded && distance < 1.35) {
            const push = (1.35 - distance) * 0.026;
            dx /= distance; dy /= distance;
            forces.get(ia).x -= dx * push; forces.get(ia).y -= dy * push;
            forces.get(ib).x += dx * push; forces.get(ib).y += dy * push;
          }
        }
      }
      for (const bond of bonds) {
        if (!forces.has(bond.a) || !forces.has(bond.b)) continue;
        let dx = atoms[bond.b].x - atoms[bond.a].x, dy = atoms[bond.b].y - atoms[bond.a].y;
        const distance = Math.hypot(dx, dy) || 0.001;
        const target = bond.order >= 2 ? 1.32 : bond.order === 1.5 ? 1.39 : 1.48;
        const pull = (distance - target) * 0.038;
        dx /= distance; dy /= distance;
        forces.get(bond.a).x += dx * pull; forces.get(bond.a).y += dy * pull;
        forces.get(bond.b).x -= dx * pull; forces.get(bond.b).y -= dy * pull;
      }
      component.forEach((index) => {
        const force = forces.get(index);
        atoms[index].x += Math.max(-0.08, Math.min(0.08, force.x));
        atoms[index].y += Math.max(-0.08, Math.min(0.08, force.y));
      });
    }

    const minX = Math.min(...component.map((index) => atoms[index].x));
    const maxX = Math.max(...component.map((index) => atoms[index].x));
    const centerX = (minX + maxX) / 2;
    component.forEach((index) => { atoms[index].x += componentOffset - centerX; });
    componentOffset += maxX - minX + 2.5;
  });

  const center = atoms.reduce((acc, atom) => ({ x: acc.x + atom.x, y: acc.y + atom.y }), { x: 0, y: 0 });
  center.x /= atoms.length; center.y /= atoms.length;
  atoms.forEach((atom) => { atom.x -= center.x; atom.y -= center.y; });
}

function addImplicitHydrogens(atoms, bonds) {
  const heavyCount = atoms.length;
  const valences = { B: 3, C: 4, N: 3, O: 2, F: 1, Si: 4, P: 3, S: 2, Cl: 1, Br: 1, I: 1 };
  const adjacency = Array.from({ length: heavyCount }, () => []);
  bonds.forEach((bond) => {
    if (bond.a < heavyCount && bond.b < heavyCount) {
      adjacency[bond.a].push({ index: bond.b, order: bond.order || 1 });
      adjacency[bond.b].push({ index: bond.a, order: bond.order || 1 });
    }
  });

  for (let index = 0; index < heavyCount; index++) {
    const atom = atoms[index];
    let targetValence = valences[atom.element] ?? 0;
    if (atom.element === 'N' && atom.charge > 0) targetValence = 4;
    if (atom.element === 'S' && adjacency[index].some((entry) => entry.order >= 2)) targetValence = 6;
    const usedValence = adjacency[index].reduce((sum, entry) => sum + entry.order, 0);
    const hydrogenCount = atom.bracketed
      ? atom.explicitHydrogens
      : Math.max(0, Math.floor(targetValence - usedValence + 0.05));
    if (!hydrogenCount) continue;

    let baseAngle = index * 2.39996;
    const isolated = adjacency[index].length === 0;
    if (!isolated) {
      const average = adjacency[index].reduce((acc, entry) => ({
        x: acc.x + atoms[entry.index].x,
        y: acc.y + atoms[entry.index].y,
      }), { x: 0, y: 0 });
      baseAngle = Math.atan2(atom.y - average.y / adjacency[index].length, atom.x - average.x / adjacency[index].length);
    }

    for (let h = 0; h < hydrogenCount; h++) {
      const spread = isolated
        ? h / hydrogenCount * Math.PI * 2
        : hydrogenCount === 1 ? 0 : (h - (hydrogenCount - 1) / 2) * 0.78;
      const angle = baseAngle + spread;
      const hydrogenIndex = atoms.length;
      atoms.push({
        element: 'H', aromatic: false, bracketed: false, explicitHydrogens: 0, charge: 0,
        x: atom.x + Math.cos(angle) * 0.95,
        y: atom.y + Math.sin(angle) * 0.95,
        z: atom.aromatic ? atom.z : atom.z + (hydrogenCount === 1 ? 0.08 : (h % 2 ? -0.34 : 0.34)),
      });
      bonds.push({ a: index, b: hydrogenIndex, order: 1 });
    }
  }
}

function rotateAtomSubsetToVector(atoms, indices, centerIndex, fromVector, toVector) {
  const from = normaliseVector(fromVector), to = normaliseVector(toVector);
  let axis = {
    x: from.y * to.z - from.z * to.y,
    y: from.z * to.x - from.x * to.z,
    z: from.x * to.y - from.y * to.x,
  };
  let sine = Math.hypot(axis.x, axis.y, axis.z);
  const cosine = Math.max(-1, Math.min(1, from.x * to.x + from.y * to.y + from.z * to.z));
  if (sine < 1e-8) {
    if (cosine > 0) return;
    axis = Math.abs(from.x) < 0.8
      ? normaliseVector({ x: 0, y: -from.z, z: from.y })
      : normaliseVector({ x: -from.y, y: from.x, z: 0 });
    sine = 0;
  } else {
    axis = { x: axis.x / sine, y: axis.y / sine, z: axis.z / sine };
  }
  const center = atoms[centerIndex];
  indices.forEach((index) => {
    const atom = atoms[index];
    const vector = { x: atom.x - center.x, y: atom.y - center.y, z: atom.z - center.z };
    const cross = {
      x: axis.y * vector.z - axis.z * vector.y,
      y: axis.z * vector.x - axis.x * vector.z,
      z: axis.x * vector.y - axis.y * vector.x,
    };
    const dot = axis.x * vector.x + axis.y * vector.y + axis.z * vector.z;
    atom.x = center.x + vector.x * cosine + cross.x * sine + axis.x * dot * (1 - cosine);
    atom.y = center.y + vector.y * cosine + cross.y * sine + axis.y * dot * (1 - cosine);
    atom.z = center.z + vector.z * cosine + cross.z * sine + axis.z * dot * (1 - cosine);
  });
}

function seedLocal3DGeometry(atoms, bonds) {
  const adjacency = atoms.map(() => []);
  bonds.forEach((bond) => {
    adjacency[bond.a].push({ index: bond.b, order: bond.order || 1 });
    adjacency[bond.b].push({ index: bond.a, order: bond.order || 1 });
  });

  const collectBranch = (start, blocked) => {
    const branch = [];
    const seen = new Set([blocked, start]);
    const queue = [start];
    while (queue.length) {
      const index = queue.shift();
      branch.push(index);
      adjacency[index].forEach(({ index: neighbor }) => {
        if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
      });
    }
    return branch;
  };

  atoms.forEach((center, centerIndex) => {
    const neighbors = adjacency[centerIndex];
    if (center.aromatic || neighbors.some((entry) => entry.order > 1.1)) return;
    let targetAngle = null;
    if (neighbors.length === 4) targetAngle = 109.4712206;
    else if (center.element === 'N' && neighbors.length === 3 && (center.charge || 0) <= 0) targetAngle = 109.4712206;
    else if (['O', 'S'].includes(center.element) && neighbors.length === 2) targetAngle = 104.5;
    if (targetAngle == null) return;

    const branches = neighbors.map(({ index }) => ({
      neighbor: index,
      atoms: collectBranch(index, centerIndex),
    }));
    // Removing a ring atom does not produce independent branches, so avoid
    // twisting cyclic systems while establishing acyclic local geometry.
    const ownership = new Set();
    if (branches.some((branch) => branch.atoms.some((index) => ownership.has(index)) || !branch.atoms.every((index) => { ownership.add(index); return true; }))) return;

    branches.sort((a, b) => b.atoms.length - a.atoms.length || a.neighbor - b.neighbor);
    const fixed = branches[0];
    const fixedAtom = atoms[fixed.neighbor];
    const axis = normaliseVector({ x: fixedAtom.x - center.x, y: fixedAtom.y - center.y, z: fixedAtom.z - center.z });
    const reference = Math.abs(axis.z) < 0.82 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    const tangent = normaliseVector({
      x: axis.y * reference.z - axis.z * reference.y,
      y: axis.z * reference.x - axis.x * reference.z,
      z: axis.x * reference.y - axis.y * reference.x,
    });
    const bitangent = {
      x: axis.y * tangent.z - axis.z * tangent.y,
      y: axis.z * tangent.x - axis.x * tangent.z,
      z: axis.x * tangent.y - axis.y * tangent.x,
    };
    const theta = targetAngle * Math.PI / 180;
    const candidates = [0, 1, 2].map((slot) => {
      const azimuth = slot * Math.PI * 2 / 3;
      const radialX = tangent.x * Math.cos(azimuth) + bitangent.x * Math.sin(azimuth);
      const radialY = tangent.y * Math.cos(azimuth) + bitangent.y * Math.sin(azimuth);
      const radialZ = tangent.z * Math.cos(azimuth) + bitangent.z * Math.sin(azimuth);
      return {
        x: axis.x * Math.cos(theta) + radialX * Math.sin(theta),
        y: axis.y * Math.cos(theta) + radialY * Math.sin(theta),
        z: axis.z * Math.cos(theta) + radialZ * Math.sin(theta),
      };
    });

    const moving = branches.slice(1);
    let best = null;
    const assign = (branchIndex, available, choices, score) => {
      if (branchIndex === moving.length) {
        if (!best || score > best.score) best = { choices: [...choices], score };
        return;
      }
      const neighbor = atoms[moving[branchIndex].neighbor];
      const current = normaliseVector({ x: neighbor.x - center.x, y: neighbor.y - center.y, z: neighbor.z - center.z });
      available.forEach((candidateIndex) => {
        const desired = candidates[candidateIndex];
        const alignment = current.x * desired.x + current.y * desired.y + current.z * desired.z;
        assign(branchIndex + 1, available.filter((index) => index !== candidateIndex), [...choices, candidateIndex], score + alignment);
      });
    };
    assign(0, [0, 1, 2], [], 0);

    moving.forEach((branch, index) => {
      const neighbor = atoms[branch.neighbor];
      rotateAtomSubsetToVector(atoms, branch.atoms, centerIndex, {
        x: neighbor.x - center.x,
        y: neighbor.y - center.y,
        z: neighbor.z - center.z,
      }, candidates[best.choices[index]]);
    });
  });
}

function normaliseQuaternion(quaternion) {
  const length = Math.hypot(quaternion.w, quaternion.x, quaternion.y, quaternion.z) || 1;
  return { w: quaternion.w / length, x: quaternion.x / length, y: quaternion.y / length, z: quaternion.z / length };
}

function multiplyQuaternions(first, second) {
  return {
    w: first.w * second.w - first.x * second.x - first.y * second.y - first.z * second.z,
    x: first.w * second.x + first.x * second.w + first.y * second.z - first.z * second.y,
    y: first.w * second.y - first.x * second.z + first.y * second.w + first.z * second.x,
    z: first.w * second.z + first.x * second.y - first.y * second.x + first.z * second.w,
  };
}

function quaternionFromAxisAngle(axis, angle) {
  const unit = normaliseVector(axis, { x: 0, y: 1, z: 0 });
  const sine = Math.sin(angle / 2);
  return { w: Math.cos(angle / 2), x: unit.x * sine, y: unit.y * sine, z: unit.z * sine };
}

function quaternionFromUnitVectors(from, to) {
  const dot = Math.max(-1, Math.min(1, from.x * to.x + from.y * to.y + from.z * to.z));
  if (dot < -0.999999) {
    const axis = Math.abs(from.x) < 0.8
      ? normaliseVector({ x: 0, y: -from.z, z: from.y })
      : normaliseVector({ x: -from.y, y: from.x, z: 0 });
    return quaternionFromAxisAngle(axis, Math.PI);
  }
  return normaliseQuaternion({
    w: 1 + dot,
    x: from.y * to.z - from.z * to.y,
    y: from.z * to.x - from.x * to.z,
    z: from.x * to.y - from.y * to.x,
  });
}

function rotateVectorByQuaternion(vector, quaternion) {
  const q = normaliseQuaternion(quaternion);
  const tx = 2 * (q.y * vector.z - q.z * vector.y);
  const ty = 2 * (q.z * vector.x - q.x * vector.z);
  const tz = 2 * (q.x * vector.y - q.y * vector.x);
  return {
    x: vector.x + q.w * tx + q.y * tz - q.z * ty,
    y: vector.y + q.w * ty + q.z * tx - q.x * tz,
    z: vector.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

function defaultViewRotation() {
  return normaliseQuaternion(multiplyQuaternions(
    quaternionFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.28),
    quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.48),
  ));
}

const state = {
  molecule: null,
  rotation: defaultViewRotation(),
  rotationStart: null,
  arcballStart: null,
  projection: null,
  viewProjectionCenter: null,
  viewProjectionRadius: null,
  viewPan: { x: 0, y: 0 },
  zoom: 1,
  dragging: false,
  pointer: { x: 0, y: 0 },
  pointerStart: null,
  pointerDragged: false,
  pendingBuildAction: null,
  hoverAtom: null,
  autoRotate: 'none',
  playing: false,
  showHydrogens: true,
  showHulls: true,
  showInteractions: true,
  showPocketAtoms: true,
  pocketAtomMode: 'radius',
  displayColorTheme: 'standard',
  changeMarkerStyle: 'rings',
  showStericClashes: false,
  visibleStericClashCount: 0,
  vdw: false,
  representation: 'ball-stick',
  mode: 'view',
  selectedElement: 'C',
  buildTool: 'add',
  stagedFragment: null,
  selectedAtom: null,
  selectedAtoms: [],
  chemistryTransaction: null,
  chemistryEditPolicy: 'staged',
  chemistryEditFinishing: false,
  chemistActionAudit: [],
  liveCampaign: null,
  liveCampaignBranch: 'main',
  liveCampaignCommittedThroughSequence: 0,
  designRoute: null,
  designRouteStepId: null,
  geometryEditActive: false,
  dragAtom: null,
  panningView: false,
  buildHistory: [],
  redoHistory: [],
  minimizing: false,
  preparing: false,
  calculating: false,
  lastCalculation: null,
  calculationFrames: [],
  calculationRawFrames: [],
  calculationProjectionRadius: null,
  calculationEnsemble: null,
  conformerAnalysis: null,
  conformerDisplayAlignment: null,
  trajectoryDisplayAlignment: null,
  calculationReplicaIndex: 0,
  replicaMosaicLayout: null,
  calculationFrameIndex: 0,
  calculationUnit: 'kcal/mol',
  calculationJob: 'energy',
  calculationTimestepFs: null,
  calculationConstraintMode: 'none',
  calculationPlaying: false,
  calculationPlaybackRaf: 0,
  calculationPlaybackTime: 0,
  proteinPrediction: null,
  pdbPreparationPreview: null,
  ligandProtonation: null,
  protonatingLigand: false,
  ligandProtonationSequence: 0,
  dockingReference: null,
  dockingResult: null,
  dockingRunning: false,
  dockingSelectedHbondIds: new Set(),
  dockingContactRemaps: new Map(),
  dockingContactRemapProposals: new Map(),
  dockingContactDraft: null,
  dockingPoseIndex: 0,
  sidechainRotamerEnsemble: null,
  designerMoveScript: null,
  designerMoveRegisteredStory: null,
  designerMoveReplay: null,
  designerMoveReplaying: false,
  designerMoveReplayScheduled: false,
  designerMoveReplayPaused: false,
  designerMoveReplayIndex: 0,
  designerMoveReplayFrontier: 0,
  designerMoveReplayPhase: null,
  designerMoveReplayStep: null,
  designerMoveReplayActionRunning: false,
  designerMovePresentationStep: null,
  designerMoveReplayCheckpoints: [],
  structureComponents: [],
  atomComponentIds: [],
  componentVisibility: new Map(),
  focusedComponentId: null,
  focusedComponentCenter: null,
  focusedComponentRadius: null,
  focusedResidueKey: null,
  focusedResidueRadius: null,
  focusedAtomIds: [],
  focusedAtomCenter: null,
  focusedAtomRadius: null,
  focusedAtomContextRadius: 4.5,
  focusedAtomContextIds: [],
  focusedAtomResidueLabels: [],
  emphasizedAtomIds: [],
  depictionSequence: 0,
  depictionTimer: 0,
  depictionGlobalAtomIndices: [],
  depictionGlobalBondPairs: [],
  depictionAtomObjects: [],
  depictionComponentId: null,
  depictionPinnedLigand: null,
  depictionOrientationAnchor: null,
  depictionTemplateMolBlock: null,
  depictionKey: null,
  depictionTool: 'select',
  depictionBondStart: null,
  depictionBondOrder: 1,
  depictionEditing: false,
  stormmReplicaTuning: new Map(),
  tuningStormmReplicas: false,
  foldAbortController: null,
  raf: 0,
  lastFrame: performance.now(),
};

const canvas = document.querySelector('#molecule-canvas');
const ctx = canvas.getContext('2d');
const sceneCanvas = document.querySelector('#scene-canvas');
const sceneCtx = sceneCanvas.getContext('2d');

const MAX_DEPICTION_ATOMS = 256;

function depictionTarget(molecule = state.molecule) {
  if (!molecule?.atoms?.length) return null;
  const eligible = (component) => {
    if (!component || !['ligand', 'molecule'].includes(component.kind)) return false;
    const heavy = component.atomIndices.filter((index) => molecule.atoms[index]?.element !== 'H');
    return heavy.length > 0 && heavy.length <= MAX_DEPICTION_ATOMS;
  };
  const selectedComponentId = state.selectedAtom == null ? null : state.atomComponentIds[state.selectedAtom];
  const pinnedComponent = state.depictionPinnedLigand
    ? state.structureComponents.find((component) => component.kind === 'ligand'
      && component.chain === state.depictionPinnedLigand.chain
      && component.residueIndex === state.depictionPinnedLigand.residueIndex
      && (component.insertionCode || '') === (state.depictionPinnedLigand.insertionCode || '')
      && eligible(component)) : null;
  const selectedComponent = state.structureComponents.find((component) =>
    component.id === selectedComponentId && eligible(component));
  const focusedComponent = state.structureComponents.find((component) =>
    component.id === state.focusedComponentId && eligible(component));
  const ligand = state.structureComponents.find((component) => component.kind === 'ligand'
    && state.componentVisibility.get(component.id) !== false && eligible(component));
  const main = state.structureComponents.find((component) => component.kind === 'molecule' && eligible(component));
  const component = pinnedComponent || selectedComponent || focusedComponent || ligand || main;
  if (!component) return null;
  const globalAtomIndices = component.atomIndices.filter((index) => molecule.atoms[index].element !== 'H');
  const mapped = mappedMoleculeSubset(molecule, globalAtomIndices, component.label || '2D structure');
  if (!mapped) return null;
  const graph = validateConnectedMolecularGraph(mapped.molecule, { maximumAtoms:MAX_DEPICTION_ATOMS });
  return { ...mapped, graph, label:component.label || molecule.name || 'Structure', componentId:component.id };
}

function depictionSignature(target) {
  const molecule = target?.molecule;
  if (!molecule) return '';
  return JSON.stringify({
    component:target.componentId,
    atoms:molecule.atoms.map((atom) => [atom.element, atomFormalCharge(atom)]),
    bonds:molecule.bonds.map((bond) => [bond.a, bond.b, Number(bond.order || 1)]),
  });
}

function update2DSelectionOverlay() {
  const svg = document.querySelector('#structure-2d-drawing svg');
  if (!svg) return;
  svg.querySelectorAll('[data-molarium-selection]').forEach((node) => node.remove());
  const selected = new Set(state.selectedAtoms);
  state.depictionGlobalAtomIndices.forEach((globalIndex, localIndex) => {
    if (!selected.has(globalIndex)) return;
    const point = depictionAtomPoint(svg, localIndex);
    if (!point) return;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(point.x)); circle.setAttribute('cy', String(point.y));
    circle.setAttribute('r', '7.5'); circle.setAttribute('data-molarium-selection', 'true');
    circle.setAttribute('fill', 'rgba(248,113,113,.28)');
    circle.setAttribute('stroke', 'rgba(239,68,68,.72)'); circle.setAttribute('stroke-width', '1.4');
    circle.setAttribute('pointer-events', 'none');
    svg.appendChild(circle);
  });
}

function update2DEditorUi() {
  const panel = document.querySelector('#structure-2d-panel');
  if (!panel) return;
  panel.dataset.mode = state.mode;
  document.querySelectorAll('[data-2d-tool]').forEach((button) => {
    const selected = button.dataset['2dTool'] === state.depictionTool;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const element = document.querySelector('#structure-2d-element');
  const bondOrder = document.querySelector('#structure-2d-bond-order');
  if (element && [...element.options].some((option) => option.value === state.selectedElement))
    element.value = state.selectedElement;
  if (bondOrder) bondOrder.value = String(state.depictionBondOrder);
  const pending = document.querySelector('#structure-2d-pending');
  pending?.classList.toggle('hidden', !state.chemistryTransaction);
  if (pending) pending.querySelectorAll('button').forEach((button) => {
    button.disabled = state.chemistryEditFinishing || state.depictionEditing;
  });
  const help = document.querySelector('#structure-2d-help');
  if (!help) return;
  if (state.depictionEditing) help.textContent = 'Updating the shared molecular graph…';
  else if (state.mode !== 'build') help.textContent = state.depictionTool === 'select'
    ? 'Select an atom here to select the same atom in 3D.'
    : 'This drawing tool opens Design and edits the shared 2D/3D structure.';
  else if (state.depictionTool === 'atom') help.textContent = `Click an atom to attach ${state.selectedElement}; use Select to change an existing atom.`;
  else if (state.depictionTool === 'bond') help.textContent = state.depictionBondStart == null
    ? 'Pick two atoms, or click a bond directly, to set its order.'
    : 'Pick the second atom. Both views keep the same atom identities.';
  else if (state.depictionTool === 'erase') help.textContent = 'Click an atom or bond to stage its deletion.';
  else help.textContent = 'Select an atom or bond here; use the Design panel for element and charge changes.';
  update2DSelectionOverlay();
}
function sanitizedDepictionSvg(svgText) {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg.localName !== 'svg' || parsed.querySelector('parsererror')) throw new Error('Invalid 2D SVG');
  svg.querySelectorAll('script, foreignObject').forEach((node) => node.remove());
  svg.querySelectorAll('*').forEach((node) => [...node.attributes].forEach((attribute) => {
    if (/^on/i.test(attribute.name) || /^(?:href|xlink:href)$/i.test(attribute.name)) node.removeAttribute(attribute.name);
  }));
  svg.removeAttribute('width'); svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  return document.importNode(svg, true);
}

function depictionGraphicsPointInRoot(svg, node, point) {
  const nodeMatrix = node.getScreenCTM();
  const rootMatrix = svg.getScreenCTM();
  if (!nodeMatrix || !rootMatrix) return null;
  const screen = new DOMPoint(point.x, point.y).matrixTransform(nodeMatrix);
  return screen.matrixTransform(rootMatrix.inverse());
}

function captureDepictionOrientation(svg) {
  if (!svg || !state.depictionAtomObjects.length) return;
  const transaction = state.chemistryTransaction;
  if (transaction?.depictionOrientationAnchor?.componentId === state.depictionComponentId) return;
  const drawingRect = document.querySelector('#structure-2d-drawing')?.getBoundingClientRect();
  if (!drawingRect) return;
  const points = new Map();
  state.depictionAtomObjects.forEach((atom, localIndex) => {
    const point = depictionScreenPoint(svg, depictionAtomPoint(svg, localIndex));
    if (atom && point) points.set(atom, {
      x:point.x - drawingRect.x, y:point.y - drawingRect.y,
    });
  });
  if (points.size < 2) return;
  const anchor = { componentId:state.depictionComponentId, coordinateSpace:'drawing', points };
  if (transaction) transaction.depictionOrientationAnchor = anchor;
  else state.depictionOrientationAnchor = anchor;
}

function activeDepictionOrientationAnchor() {
  return state.chemistryTransaction?.depictionOrientationAnchor || state.depictionOrientationAnchor;
}

function depictionSimilarityTransform(source, target) {
  const sourceCenter = source.reduce((sum, point) => ({ x:sum.x + point.x / source.length,
    y:sum.y + point.y / source.length }), { x:0, y:0 });
  const targetCenter = target.reduce((sum, point) => ({ x:sum.x + point.x / target.length,
    y:sum.y + point.y / target.length }), { x:0, y:0 });
  let dot = 0, cross = 0, denominator = 0;
  source.forEach((point, index) => {
    const px = point.x - sourceCenter.x, py = point.y - sourceCenter.y;
    const qx = target[index].x - targetCenter.x, qy = target[index].y - targetCenter.y;
    dot += px * qx + py * qy;
    cross += px * qy - py * qx;
    denominator += px * px + py * py;
  });
  const magnitude = Math.hypot(dot, cross);
  if (denominator < 1e-6 || magnitude < 1e-6) return null;
  const scale = Math.max(0.72, Math.min(1.38, magnitude / denominator));
  const cosine = dot / magnitude, sine = cross / magnitude;
  const a = scale * cosine, b = scale * sine, c = -scale * sine, d = scale * cosine;
  const e = targetCenter.x - a * sourceCenter.x - c * sourceCenter.y;
  const f = targetCenter.y - b * sourceCenter.x - d * sourceCenter.y;
  return { a, b, c, d, e, f };
}

function depictionRobustSimilarityTransform(source, target) {
  if (source.length < 3) return depictionSimilarityTransform(source, target);
  let best = null;
  for (let first = 0; first < source.length - 1; first++) {
    for (let second = first + 1; second < source.length; second++) {
      const sx = source[second].x - source[first].x;
      const sy = source[second].y - source[first].y;
      const tx = target[second].x - target[first].x;
      const ty = target[second].y - target[first].y;
      const sourceLength = Math.hypot(sx, sy);
      const targetLength = Math.hypot(tx, ty);
      if (sourceLength < 12 || targetLength < 12) continue;
      const scale = Math.max(0.72, Math.min(1.38, targetLength / sourceLength));
      const cosine = (sx * tx + sy * ty) / (sourceLength * targetLength);
      const sine = (sx * ty - sy * tx) / (sourceLength * targetLength);
      const a = scale * cosine, b = scale * sine, c = -scale * sine, d = scale * cosine;
      const e = target[first].x - a * source[first].x - c * source[first].y;
      const f = target[first].y - b * source[first].x - d * source[first].y;
      const residuals = source.map((point, index) => Math.hypot(
        a * point.x + c * point.y + e - target[index].x,
        b * point.x + d * point.y + f - target[index].y,
      )).sort((left, right) => left - right);
      const median = residuals[Math.floor(residuals.length / 2)];
      if (!best || median < best.median) best = { a, b, c, d, e, f, median };
    }
  }
  if (!best) return depictionSimilarityTransform(source, target);
  const cutoff = Math.max(4, best.median * 2.5);
  const inlierSource = [], inlierTarget = [];
  source.forEach((point, index) => {
    const residual = Math.hypot(
      best.a * point.x + best.c * point.y + best.e - target[index].x,
      best.b * point.x + best.d * point.y + best.f - target[index].y,
    );
    if (residual <= cutoff) { inlierSource.push(point); inlierTarget.push(target[index]); }
  });
  return inlierSource.length >= 2
    ? depictionSimilarityTransform(inlierSource, inlierTarget) : best;
}

function alignDepictionToPrevious(svg, target) {
  const anchor = activeDepictionOrientationAnchor();
  if (!anchor || anchor.componentId !== target.componentId) return null;
  const inverseRoot = svg.getScreenCTM()?.inverse();
  if (!inverseRoot) return null;
  const drawingRect = document.querySelector('#structure-2d-drawing')?.getBoundingClientRect();
  const source = [], destination = [];
  target.globalAtomIndices.forEach((globalIndex, localIndex) => {
    const atom = state.molecule?.atoms?.[globalIndex];
    const previous = anchor.points.get(atom);
    const current = depictionAtomPoint(svg, localIndex);
    const priorScreen = previous && anchor.coordinateSpace === 'drawing' && drawingRect
      ? new DOMPoint(drawingRect.x + previous.x, drawingRect.y + previous.y)
      : previous ? new DOMPoint(previous.x, previous.y) : null;
    const priorInCurrentSvg = priorScreen?.matrixTransform(inverseRoot) || null;
    if (priorInCurrentSvg && current) { source.push(current); destination.push(priorInCurrentSvg); }
  });
  if (source.length < 2) return null;
  // RDKit renders wedge bonds as several short SVG paths. Their averaged
  // endpoints are useful hit targets but can be poor geometric anchors, so fit
  // the viewport transform robustly to the stable majority of common atoms.
  const transform = depictionRobustSimilarityTransform(source, destination);
  if (!transform) return null;
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  while (svg.firstChild) group.appendChild(svg.firstChild);
  group.setAttribute('transform', `matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})`);
  svg.appendChild(group);
  return { commonAtoms:source.length, ...transform };
}
async function update2DDepiction() {
  const panel = document.querySelector('#structure-2d-panel');
  const drawing = document.querySelector('#structure-2d-drawing');
  const sequence = ++state.depictionSequence;
  let target;
  try { target = depictionTarget(); }
  catch (error) {
    panel.classList.remove('hidden');
    drawing.replaceChildren(Object.assign(document.createElement('span'), { textContent:'2D depiction unavailable' }));
    state.depictionGlobalAtomIndices = []; state.depictionGlobalBondPairs = [];
    state.depictionAtomObjects = []; state.depictionComponentId = null;
    state.depictionKey = null; panel.dataset.error = error.message; delete panel.dataset.pending;
    return;
  }
  if (!target) {
    panel.classList.add('hidden'); state.depictionGlobalAtomIndices = [];
    state.depictionGlobalBondPairs = []; state.depictionAtomObjects = [];
    state.depictionComponentId = null; state.depictionOrientationAnchor = null;
    state.depictionTemplateMolBlock = null; state.depictionKey = null;
    return;
  }
  const key = depictionSignature(target);
  if (key === state.depictionKey && drawing.querySelector('svg')) return;
  state.depictionKey = key;
  panel.classList.remove('hidden');
  setText('#structure-2d-label', target.label);
  drawing.replaceChildren(Object.assign(document.createElement('span'), { textContent:'Drawing…' }));
  try {
    const anchor = activeDepictionOrientationAnchor();
    const trustedSanitizedGraph = Boolean(state.molecule?.source?.initialGeometryPolish
      || state.chemistryTransaction?.snapshot?.source?.initialGeometryPolish);
    const result = await runRDKitJob('depict', target.molecule, () => {},
      { trustedSanitizedGraph });
    if (sequence !== state.depictionSequence || key !== state.depictionKey) return;
    const svg = sanitizedDepictionSvg(result.svg);
    drawing.replaceChildren(svg);
    state.depictionGlobalAtomIndices = target.globalAtomIndices.slice();
    state.depictionGlobalBondPairs = target.molecule.bonds.map((bond) => [
      target.globalAtomIndices[bond.a], target.globalAtomIndices[bond.b],
    ]);
    state.depictionAtomObjects = target.globalAtomIndices.map((index) => state.molecule?.atoms?.[index] || null);
    state.depictionComponentId = target.componentId;
    state.depictionTemplateMolBlock = null;
    // Settle tool/help layout before converting the prior screen positions into
    // this SVG's coordinate system. Design-mode help can change the panel height.
    update2DEditorUi();
    const alignment = alignDepictionToPrevious(svg, target);
    panel.dataset.alignedAtoms = String(alignment?.commonAtoms || 0);
    panel.dataset.alignmentBackend = alignment
      ? 'RDKit 2D layout + viewport alignment' : 'fresh RDKit 2D layout';
    panel.dataset.rdkitVersion = result.rdkitVersion || '';
    delete panel.dataset.error; delete panel.dataset.pending;
  } catch (error) {
    if (sequence !== state.depictionSequence) return;
    drawing.replaceChildren(Object.assign(document.createElement('span'), { textContent:'2D depiction unavailable' }));
    panel.dataset.error = error.message; delete panel.dataset.pending;
  }
}

function schedule2DDepiction(delay = 50) {
  clearTimeout(state.depictionTimer);
  const panel = document.querySelector('#structure-2d-panel');
  const drawing = document.querySelector('#structure-2d-drawing');
  let target;
  try { target = depictionTarget(); }
  catch (error) {
    state.depictionSequence += 1; state.depictionKey = null;
    state.depictionGlobalAtomIndices = []; state.depictionGlobalBondPairs = [];
    state.depictionAtomObjects = []; state.depictionComponentId = null;
    panel.classList.remove('hidden'); delete panel.dataset.pending;
    drawing.replaceChildren(Object.assign(document.createElement('span'), { textContent:'2D depiction unavailable' }));
    panel.dataset.error = error.message;
    return;
  }
  if (!target) {
    state.depictionSequence += 1; state.depictionKey = null; state.depictionGlobalAtomIndices = [];
    state.depictionGlobalBondPairs = []; state.depictionAtomObjects = [];
    state.depictionComponentId = null; state.depictionOrientationAnchor = null;
    state.depictionTemplateMolBlock = null;
    panel.classList.add('hidden'); delete panel.dataset.pending;
    return;
  }
  const key = depictionSignature(target);
  if (key !== state.depictionKey) {
    captureDepictionOrientation(drawing.querySelector('svg'));
    panel.classList.remove('hidden'); panel.dataset.pending = 'true';
    setText('#structure-2d-label', target.label);
    drawing.replaceChildren(Object.assign(document.createElement('span'), { textContent:'Drawing…' }));
  }
  else update2DSelectionOverlay();
  state.depictionTimer = setTimeout(update2DDepiction, delay);
}

function depictionAtomPoint(svg, atomIndex) {
  const bondEndpoints = [], labelPoints = [];
  svg.querySelectorAll(`[class*="atom-${atomIndex}"]`).forEach((node) => {
    const atomClasses = [...node.classList].flatMap((name) => {
      const match = /^atom-(\d+)$/.exec(name); return match ? [Number(match[1])] : [];
    });
    if (node instanceof SVGGeometryElement && atomClasses.length >= 2) {
      const length = node.getTotalLength();
      const endpoint = atomClasses.indexOf(atomIndex) === 0
        ? node.getPointAtLength(0) : node.getPointAtLength(length);
      const point = depictionGraphicsPointInRoot(svg, node, endpoint);
      if (point) bondEndpoints.push(point);
    } else if (node instanceof SVGGraphicsElement) {
      const box = node.getBBox();
      const point = depictionGraphicsPointInRoot(svg, node,
        { x:box.x + box.width / 2, y:box.y + box.height / 2 });
      if (point) labelPoints.push(point);
    }
  });
  // RDKit shortens bonds around a visible heteroatom label. Those shortened
  // endpoints describe the edge of the glyph, not the place the user sees as
  // the atom. Prefer label geometry for heteroatoms; carbon stereolabels and
  // ordinary unlabeled carbons retain their more stable bond-based centers.
  const globalIndex = state.depictionGlobalAtomIndices[atomIndex];
  const element = state.molecule?.atoms?.[globalIndex]?.element;
  const points = labelPoints.length && element && element !== 'C'
    ? labelPoints : bondEndpoints.length ? bondEndpoints : labelPoints;
  if (!points.length) return null;
  return points.reduce((sum, point) => ({ x:sum.x + point.x / points.length,
    y:sum.y + point.y / points.length }), { x:0, y:0 });
}

function selectDepictionAtom(localIndex) {
  const globalIndex = state.depictionGlobalAtomIndices[localIndex];
  if (!Number.isInteger(globalIndex) || !state.molecule?.atoms?.[globalIndex]) return;
  if (state.mode === 'build') selectGeometryAtom(globalIndex);
  else {
    state.selectedAtoms = [globalIndex]; state.selectedAtom = globalIndex;
    updateGeometryControl(); draw(); schedule2DDepiction(0);
  }
}

function setDepictionSelection(indices) {
  const selected = indices.map(Number).filter((index) => Number.isInteger(index)
    && state.molecule?.atoms?.[index]);
  state.selectedAtoms = selected;
  state.selectedAtom = selected.at(-1) ?? null;
  updateGeometryControl(); updateBuildStatus(); draw(); schedule2DDepiction(0);
}

function depictionScreenPoint(svg, localPoint) {
  const matrix = svg.getScreenCTM();
  return matrix && localPoint ? new DOMPoint(localPoint.x, localPoint.y).matrixTransform(matrix) : null;
}

function pointSegmentDistance(point, first, second) {
  const dx = second.x - first.x, dy = second.y - first.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator > 1e-8
    ? Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / denominator)) : 0;
  return Math.hypot(point.x - (first.x + t * dx), point.y - (first.y + t * dy));
}

function depictionProximityHit(event, svg) {
  const atomSnapRadius = 56;
  const bondSnapRadius = 18;
  const pointer = { x:event.clientX, y:event.clientY };
  let atom = null;
  for (let localIndex = 0; localIndex < state.depictionGlobalAtomIndices.length; localIndex++) {
    const screen = depictionScreenPoint(svg, depictionAtomPoint(svg, localIndex));
    if (!screen) continue;
    const distance = Math.hypot(pointer.x - screen.x, pointer.y - screen.y);
    if (!atom || distance < atom.distance) atom = { localIndex, distance, screen };
  }
  const directTarget = event.target instanceof SVGElement ? event.target : null;
  const directAtomClasses = directTarget ? [...directTarget.classList].flatMap((name) => {
    const match = /^atom-(\d+)$/.exec(name); return match ? [Number(match[1])] : [];
  }) : [];
  const directBond = directTarget && [...directTarget.classList]
    .some((name) => /^bond-\d+$/.test(name));
  // A label path carries exactly one atom class. Honor that explicit RDKit
  // identity before applying the forgiving nearest-center fallback. Bond
  // paths carry two atom classes and remain available to the bond picker.
  if (!directBond && directAtomClasses.length === 1) {
    const localIndex = directAtomClasses[0];
    const screen = depictionScreenPoint(svg, depictionAtomPoint(svg, localIndex));
    if (screen) atom = { localIndex, distance:0, screen, directLabel:true };
  }
  let bond = null;
  state.depictionGlobalBondPairs.forEach((pair, localIndex) => {
    const localAtoms = pair.map((globalIndex) => state.depictionGlobalAtomIndices.indexOf(globalIndex));
    const points = localAtoms.map((atomIndex) => depictionScreenPoint(svg, depictionAtomPoint(svg, atomIndex)));
    if (points.some((point) => !point)) return;
    const distance = pointSegmentDistance(pointer, points[0], points[1]);
    const endpointDistance = Math.min(...points.map((point) => Math.hypot(pointer.x - point.x, pointer.y - point.y)));
    if (!bond || distance < bond.distance) bond = { localIndex, distance, endpointDistance };
  });
  if (atom?.distance > atomSnapRadius) atom = null;
  if (bond?.distance > bondSnapRadius) bond = null;
  const preferBond = Boolean(!atom?.directLabel && bond
    && (!atom || atom.distance > 24) && bond.endpointDistance > 18);
  return { atom, bond, preferBond };
}

async function addDepictionAtom(globalIndex, element = state.selectedElement) {
  if (!ELEMENTS[element]) throw new Error(`Unsupported drawing element ${element}.`);
  if (!state.molecule?.atoms?.[globalIndex]) throw new Error('Choose an atom in the 2D structure first.');
  setDepictionSelection([globalIndex]);
  return applyChemistryMutation((molecule) => {
    const anchor = molecule.atoms[globalIndex];
    const before = new Set(molecule.atoms);
    const direction = attachmentDirection(molecule, globalIndex);
    const distance = ELEMENTS[anchor.element].covalent + ELEMENTS[element].covalent;
    const targetPoint = { x:anchor.x + direction.x * distance, y:anchor.y + direction.y * distance,
      z:anchor.z + direction.z * distance };
    addElementToMolecule(molecule, element, globalIndex, targetPoint);
    const added = molecule.atoms.filter((atom) => !before.has(atom));
    const addedHeavy = added.find((atom) => atom.element !== 'H') || added[0];
    return { selection:addedHeavy ? [addedHeavy] : [anchor], changedAtoms:[anchor, ...added] };
  });
}

async function applyDepictionBond(firstIndex, secondIndex, order = state.depictionBondOrder) {
  setDepictionSelection([firstIndex, secondIndex]);
  return applySelectedBondChemistry(order);
}

async function runDepictionEdit(edit) {
  if (state.depictionEditing) return null;
  state.depictionEditing = true; update2DEditorUi();
  try { return await edit(); }
  catch (error) { showNotice(error.message || String(error)); return null; }
  finally {
    state.depictionEditing = false; state.depictionBondStart = null;
    update2DEditorUi(); schedule2DDepiction(0);
  }
}
function parseXYZ(text, meta = {}) {
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let start = /^\d+$/.test(lines[0]) ? 2 : 0;
  const atoms = [];
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(/[\s,]+/);
    const element = normalizeElement(parts[0]);
    const coords = parts.slice(1, 4).map(Number);
    if (ELEMENTS[element] && coords.length === 3 && coords.every(Number.isFinite)) {
      atoms.push({ element, x: coords[0], y: coords[1], z: coords[2] });
    }
  }
  if (!atoms.length) throw new Error('No valid XYZ atom coordinates were found.');
  const center = atoms.reduce((acc, atom) => ({ x: acc.x + atom.x, y: acc.y + atom.y, z: acc.z + atom.z }), { x: 0, y: 0, z: 0 });
  center.x /= atoms.length; center.y /= atoms.length; center.z /= atoms.length;
  atoms.forEach((atom) => { atom.x -= center.x; atom.y -= center.y; atom.z -= center.z; });
  return {
    atoms,
    bonds: inferBonds(atoms),
    name: meta.name || (start === 2 && lines[1]) || 'Imported molecule',
    smiles: meta.smiles || 'Structure imported from XYZ',
    charge: meta.charge ?? 0,
    multiplicity: meta.multiplicity ?? 1,
    source:{ format:'xyz' },
  };
}

function parseMolBlock(text, meta = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const countsIndex = lines.findIndex((line) => line.includes('V2000'));
  if (countsIndex < 0) throw new Error('RDKit returned an unsupported mol block');
  const atomCount = Number.parseInt(lines[countsIndex].slice(0, 3), 10);
  const bondCount = Number.parseInt(lines[countsIndex].slice(3, 6), 10);
  if (!Number.isInteger(atomCount) || atomCount < 1 || !Number.isInteger(bondCount) || bondCount < 0)
    throw new Error('RDKit returned invalid mol-block counts');
  const atoms = [];
  const chargeCodes = new Map([[1, 3], [2, 2], [3, 1], [5, -1], [6, -2], [7, -3]]);
  for (let index = 0; index < atomCount; index++) {
    const line = lines[countsIndex + 1 + index] || '';
    const element = normalizeElement(line.slice(31, 34));
    const x = Number(line.slice(0, 10)), y = Number(line.slice(10, 20)), z = Number(line.slice(20, 30));
    if (!ELEMENTS[element] || ![x, y, z].every(Number.isFinite))
      throw new Error(`RDKit returned an invalid atom at position ${index + 1}`);
    atoms.push({ element, x, y, z, charge:chargeCodes.get(Number.parseInt(line.slice(36, 39), 10)) || 0,
      aromatic:false });
  }
  const bonds = [];
  for (let index = 0; index < bondCount; index++) {
    const line = lines[countsIndex + 1 + atomCount + index] || '';
    const a = Number.parseInt(line.slice(0, 3), 10) - 1;
    const b = Number.parseInt(line.slice(3, 6), 10) - 1;
    const type = Number.parseInt(line.slice(6, 9), 10);
    if (a < 0 || b < 0 || a >= atomCount || b >= atomCount || a === b)
      throw new Error(`RDKit returned an invalid bond at position ${index + 1}`);
    const order = type === 4 ? 1.5 : Math.max(1, Math.min(3, type || 1));
    if (type === 4) { atoms[a].aromatic = true; atoms[b].aromatic = true; }
    bonds.push({ a, b, order });
  }
  for (const line of lines.slice(countsIndex + 1 + atomCount + bondCount)) {
    if (!line.startsWith('M  CHG')) continue;
    const count = Number.parseInt(line.slice(6, 9), 10);
    for (let entry = 0; entry < count; entry++) {
      const atomIndex = Number.parseInt(line.slice(9 + entry * 8, 13 + entry * 8), 10) - 1;
      const charge = Number.parseInt(line.slice(13 + entry * 8, 17 + entry * 8), 10);
      if (atomIndex >= 0 && atomIndex < atoms.length && Number.isFinite(charge)) atoms[atomIndex].charge = charge;
    }
  }
  centerMoleculeAtoms(atoms);
  return {
    atoms, bonds, name:meta.name || lines[0]?.trim() || 'RDKit structure',
    smiles:meta.smiles || 'RDKit structure',
    charge:atoms.reduce((sum, atom) => sum + (atom.charge || 0), 0), multiplicity:1,
    source:{ format:'smiles', input:meta.smiles || '', canonicalSmiles:meta.canonicalSmiles || '',
      topologyParser:'RDKit', ...(meta.source || {}) },
  };
}

function pdbElement(line, atomName) {
  const declared = normalizeElement(line.slice(76, 78));
  if (ELEMENTS[declared]) return declared;
  const raw = String(atomName || '').trim().replace(/^\d+/, '');
  if (!raw) return '';
  const two = normalizeElement(raw.slice(0, 2));
  if (ELEMENTS[two] && raw[1] === raw[1]?.toLowerCase()) return two;
  return normalizeElement(raw[0]);
}

function pdbFormalCharge(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const match = raw.match(/^(\d?)([+-])$/);
  if (!match) return 0;
  return (Number(match[1] || 1)) * (match[2] === '+' ? 1 : -1);
}

function centerMoleculeAtoms(atoms) {
  const center = atoms.reduce((acc, atom) => ({
    x: acc.x + atom.x, y: acc.y + atom.y, z: acc.z + atom.z,
  }), { x: 0, y: 0, z: 0 });
  center.x /= atoms.length; center.y /= atoms.length; center.z /= atoms.length;
  atoms.forEach((atom) => { atom.x -= center.x; atom.y -= center.y; atom.z -= center.z; });
}

function parsePdbAnnotations(lines) {
  const helices = [], sheets = [], missingResidues = [], missingAtoms = [];
  const heterogenNames = new Map();
  for (const line of lines) {
    const record = line.slice(0, 6).trim().toUpperCase();
    if (record === 'HELIX') {
      helices.push({
        chain: line.slice(19, 20).trim() || 'A', start: Number.parseInt(line.slice(21, 25), 10),
        endChain: line.slice(31, 32).trim() || line.slice(19, 20).trim() || 'A',
        end: Number.parseInt(line.slice(33, 37), 10), helixClass: Number.parseInt(line.slice(38, 40), 10) || 0,
      });
    } else if (record === 'SHEET') {
      sheets.push({
        chain: line.slice(21, 22).trim() || 'A', start: Number.parseInt(line.slice(22, 26), 10),
        endChain: line.slice(32, 33).trim() || line.slice(21, 22).trim() || 'A',
        end: Number.parseInt(line.slice(33, 37), 10), sheet: line.slice(11, 14).trim(),
      });
    } else if (line.startsWith('REMARK 465')) {
      const match = line.match(/^REMARK 465\s+(?:\d+\s+)?([A-Z0-9]{3})\s+(\S)\s+(-?\d+)(\S?)/);
      if (match && PROTEIN_RESIDUE_BONDS[match[1]]) missingResidues.push({
        residueName: match[1], chain: match[2], residueIndex: Number(match[3]), insertionCode: match[4] || '',
      });
    } else if (line.startsWith('REMARK 470')) {
      const match = line.match(/^REMARK 470\s+(?:\d+\s+)?([A-Z0-9]{3})\s+(\S)\s*(-?\d+)(\S?)\s+(.+)$/);
      if (match && PROTEIN_RESIDUE_BONDS[match[1]]) missingAtoms.push({
        residueName: match[1], chain: match[2], residueIndex: Number(match[3]), insertionCode: match[4] || '',
        atoms: match[5].trim().split(/\s+/).filter(Boolean),
      });
    } else if (record === 'HETNAM') {
      const residueName = line.slice(11, 14).trim();
      const name = line.slice(15).trim();
      if (residueName && name) heterogenNames.set(residueName,
        `${heterogenNames.get(residueName) || ''}${heterogenNames.has(residueName) ? ' ' : ''}${name}`.replace(/\s+/g, ' ').trim());
    }
  }
  return { helices, sheets, missingResidues, missingAtoms,
    heterogenNames: Object.fromEntries(heterogenNames) };
}

function parsePDB(text, meta = {}) {
  const source = String(text || '');
  const lines = source.split(/\r?\n/);
  const annotations = parsePdbAnnotations(lines);
  const candidates = [];
  let model = 1;
  let explicitModels = 0;
  for (const line of lines) {
    const record = line.slice(0, 6).trim().toUpperCase();
    if (record === 'MODEL') { explicitModels += 1; model = Number.parseInt(line.slice(10, 14), 10) || explicitModels; continue; }
    if (record === 'ENDMDL') { if (model === 1 || explicitModels === 1) break; continue; }
    if (record !== 'ATOM' && record !== 'HETATM') continue;
    if (explicitModels && model !== 1 && explicitModels !== 1) continue;
    const atomName = line.slice(12, 16).trim();
    const element = pdbElement(line, atomName);
    const x = Number(line.slice(30, 38));
    const y = Number(line.slice(38, 46));
    const z = Number(line.slice(46, 54));
    if (!ELEMENTS[element] || ![x, y, z].every(Number.isFinite)) continue;
    candidates.push({
      record, serial: Number.parseInt(line.slice(6, 11), 10), atomName,
      altLoc: line.slice(16, 17).trim(), residueName: line.slice(17, 20).trim().toUpperCase() || 'UNK',
      chain: line.slice(21, 22).trim() || 'A', residueIndex: Number.parseInt(line.slice(22, 26), 10) || 0,
      insertionCode: line.slice(26, 27).trim(), occupancy: Number(line.slice(54, 60)) || 0,
      element, x, y, z, charge: pdbFormalCharge(line.slice(78, 80)),
    });
  }
  if (!candidates.length) throw new Error('No valid PDB ATOM or HETATM coordinates were found.');

  const selected = new Map();
  for (const atom of candidates) {
    const key = `${atom.record}:${atom.chain}:${atom.residueIndex}:${atom.insertionCode}:${atom.residueName}:${atom.atomName}`;
    const previous = selected.get(key);
    const preferred = !atom.altLoc || atom.altLoc === 'A';
    const previousPreferred = previous && (!previous.altLoc || previous.altLoc === 'A');
    if (!previous || (preferred && !previousPreferred) || (preferred === previousPreferred && atom.occupancy > previous.occupancy))
      selected.set(key, atom);
  }
  const atoms = [...selected.values()];
  const serialToIndex = new Map(atoms.map((atom, index) => [atom.serial, index]));
  const bondMap = new Map();
  const addBond = (a, b, order = 1, topology = 'pdb') => {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const first = atoms[a], second = atoms[b];
    const distance = Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
    const existing = bondMap.get(key);
    if (!existing || Number(order) > Number(existing.order))
      bondMap.set(key, { a: Math.min(a, b), b: Math.max(a, b), order, distance, topology });
  };

  proteinCovalentBonds(atoms).forEach((bond) => addBond(bond.a, bond.b, bond.order, bond.topology));
  const atomLookup = new Map(atoms.map((atom, index) => [
    `${atom.chain}:${atom.residueIndex}:${atom.insertionCode}:${atom.atomName}`, index,
  ]));
  for (const line of lines) {
    if (line.slice(0, 6).trim().toUpperCase() !== 'SSBOND') continue;
    const first = atomLookup.get(`${line.slice(15, 16).trim() || 'A'}:${Number.parseInt(line.slice(17, 21), 10) || 0}:${line.slice(21, 22).trim()}:SG`);
    const second = atomLookup.get(`${line.slice(29, 30).trim() || 'A'}:${Number.parseInt(line.slice(31, 35), 10) || 0}:${line.slice(35, 36).trim()}:SG`);
    addBond(first, second, 1, 'SSBOND');
  }
  for (const line of lines) {
    if (line.slice(0, 6).trim().toUpperCase() !== 'CONECT') continue;
    const serials = line.slice(6).match(/.{1,5}/g)?.map((field) => Number.parseInt(field, 10)).filter(Number.isFinite) || [];
    const sourceIndex = serialToIndex.get(serials[0]);
    const multiplicity = new Map();
    serials.slice(1).forEach((serial) => multiplicity.set(serial, (multiplicity.get(serial) || 0) + 1));
    multiplicity.forEach((order, serial) => addBond(sourceIndex, serialToIndex.get(serial), Math.min(3, order), 'CONECT'));
  }
  // Explicit hydrogens are attached only to the nearest covalent partner in
  // their own residue. This avoids the long-distance and inter-chain false
  // bonds that global distance guessing creates in packed PDB structures.
  atoms.forEach((atom, hydrogenIndex) => {
    if (atom.element !== 'H' || [...bondMap.values()].some((bond) => bond.a === hydrogenIndex || bond.b === hydrogenIndex)) return;
    let best = null;
    atoms.forEach((candidate, candidateIndex) => {
      if (candidate.element === 'H' || candidate.chain !== atom.chain || candidate.residueIndex !== atom.residueIndex
        || candidate.insertionCode !== atom.insertionCode) return;
      const distance = Math.hypot(atom.x - candidate.x, atom.y - candidate.y, atom.z - candidate.z);
      const limit = candidate.element === 'S' ? 1.55 : 1.30;
      if (distance <= limit && (!best || distance < best.distance)) best = { candidateIndex, distance };
    });
    if (best) addBond(hydrogenIndex, best.candidateIndex, 1, 'PDB hydrogen');
  });

  centerMoleculeAtoms(atoms);
  const headerLine = lines.find((line) => line.startsWith('HEADER'));
  const header = headerLine?.slice(10, 50).trim();
  const fixedWidthId = headerLine?.slice(62, 66).trim().toUpperCase();
  const trailingId = headerLine?.match(/\s([0-9][A-Z0-9]{3})\s*$/i)?.[1]?.toUpperCase();
  const pdbId = meta.pdbId || (/^[0-9][A-Z0-9]{3}$/.test(fixedWidthId || '')
    ? fixedWidthId : trailingId) || null;
  const alternateLocationsRemoved = candidates.length - atoms.length;
  const proteinAtoms = atoms.filter((atom) => atom.record === 'ATOM').length;
  const residues = new Set(atoms.filter((atom) => atom.record === 'ATOM')
    .map((atom) => `${atom.chain}:${atom.residueIndex}:${atom.insertionCode}`)).size;
  return {
    atoms, bonds: [...bondMap.values()], name: meta.name || header || (pdbId ? `PDB ${pdbId}` : 'Imported PDB structure'),
    smiles: pdbId ? `Protein Data Bank · ${pdbId}` : 'Structure imported from PDB',
    charge: atoms.reduce((sum, atom) => sum + Number(atom.charge || 0), 0), multiplicity: 1,
    prediction: proteinAtoms ? { kind: 'pdb-import', pdb: source, sequence: '', meanPlddt: 0, ptm: 0,
      msaDepth: 0, provider: 'pdb', recycles: 0, model: pdbId || 'uploaded PDB' } : null,
    source: {
      format: 'pdb', pdbId, residues, proteinAtoms, alternateLocationsRemoved,
      heterogenAtoms: atoms.length - proteinAtoms, modelCount: Math.max(1, explicitModels),
      conectBonds: [...bondMap.values()].filter((bond) => bond.topology === 'CONECT').length,
      disulfideBonds: [...bondMap.values()].filter((bond) => bond.topology === 'SSBOND').length,
      secondaryStructure: { helices: annotations.helices, sheets: annotations.sheets },
      missingResidues: annotations.missingResidues, missingAtoms: annotations.missingAtoms,
      heterogenNames: annotations.heterogenNames,
    },
    preparation: { status: 'loaded', hydrogensAdded: 0, parameterized: false },
  };
}

function parseStructureInput(text, meta = {}) {
  const source = String(text || '');
  if (/^(?:HEADER|TITLE |MODEL |ATOM  |HETATM)/m.test(source)) return parsePDB(source, meta);
  return parseXYZ(source, meta);
}

function normalizeElement(value = '') {
  const raw = value.replace(/[^a-z]/gi, '');
  return raw ? raw[0].toUpperCase() + raw.slice(1).toLowerCase() : '';
}

function inferBonds(atoms) {
  const bonds = [];
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i], b = atoms[j];
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      const distance = Math.hypot(dx, dy, dz);
      const threshold = ELEMENTS[a.element].covalent + ELEMENTS[b.element].covalent + 0.46;
      if (distance > 0.2 && distance <= threshold) bonds.push({ a: i, b: j, distance });
    }
  }
  return bonds;
}

const PROTEIN_RESIDUE_BONDS = Object.freeze({
  ALA: [['CA', 'CB']],
  ARG: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD'], ['CD', 'NE'], ['NE', 'CZ'], ['CZ', 'NH1'], ['CZ', 'NH2', 2]],
  ASN: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'OD1', 2], ['CG', 'ND2']],
  ASP: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'OD1', 2], ['CG', 'OD2']],
  CYS: [['CA', 'CB'], ['CB', 'SG']],
  GLN: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD'], ['CD', 'OE1', 2], ['CD', 'NE2']],
  GLU: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD'], ['CD', 'OE1', 2], ['CD', 'OE2']],
  GLY: [],
  HIS: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'ND1', 1.5], ['ND1', 'CE1', 1.5], ['CE1', 'NE2', 1.5], ['NE2', 'CD2', 1.5], ['CD2', 'CG', 1.5]],
  ILE: [['CA', 'CB'], ['CB', 'CG1'], ['CB', 'CG2'], ['CG1', 'CD1']],
  LEU: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD1'], ['CG', 'CD2']],
  LYS: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD'], ['CD', 'CE'], ['CE', 'NZ']],
  MET: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'SD'], ['SD', 'CE']],
  PHE: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD1', 1.5], ['CD1', 'CE1', 1.5], ['CE1', 'CZ', 1.5], ['CZ', 'CE2', 1.5], ['CE2', 'CD2', 1.5], ['CD2', 'CG', 1.5]],
  PRO: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD'], ['CD', 'N']],
  SER: [['CA', 'CB'], ['CB', 'OG']],
  THR: [['CA', 'CB'], ['CB', 'OG1'], ['CB', 'CG2']],
  TPO: [['CA', 'CB'], ['CB', 'OG1'], ['CB', 'CG2'], ['OG1', 'P'],
    ['P', 'O1P', 2], ['P', 'O2P'], ['P', 'O3P']],
  TRP: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD1', 1.5], ['CD1', 'NE1', 1.5], ['NE1', 'CE2', 1.5],
    ['CE2', 'CD2', 1.5], ['CD2', 'CG', 1.5], ['CD2', 'CE3', 1.5], ['CE3', 'CZ3', 1.5],
    ['CZ3', 'CH2', 1.5], ['CH2', 'CZ2', 1.5], ['CZ2', 'CE2', 1.5]],
  TYR: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD1', 1.5], ['CD1', 'CE1', 1.5], ['CE1', 'CZ', 1.5], ['CZ', 'CE2', 1.5], ['CE2', 'CD2', 1.5], ['CD2', 'CG', 1.5], ['CZ', 'OH']],
  VAL: [['CA', 'CB'], ['CB', 'CG1'], ['CB', 'CG2']],
});

function proteinCovalentBonds(atoms) {
  const bonds = [];
  const seen = new Set();
  const atomKey = (chain, residue, insertion, name) => `${chain || 'A'}:${residue}:${insertion || ''}:${name}`;
  const lookup = new Map(atoms.map((atom, index) => [atomKey(atom.chain, atom.residueIndex, atom.insertionCode, atom.atomName), index]));
  const addIndices = (a, b, order = 1) => {
    if (a === undefined || b === undefined || a === b) return;
    const pair = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(pair)) return;
    seen.add(pair);
    const first = atoms[a], second = atoms[b];
    bonds.push({ a, b, order, distance: Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z), topology: 'protein' });
  };
  const residues = new Map();
  atoms.forEach((atom, atomIndex) => {
    if (atom.record && atom.record !== 'ATOM') return;
    const key = `${atom.chain || 'A'}:${atom.residueIndex}:${atom.insertionCode || ''}`;
    if (!residues.has(key)) residues.set(key, {
      chain: atom.chain || 'A', index: atom.residueIndex, insertion: atom.insertionCode || '',
      name: atom.residueName, firstAtom: atomIndex,
    });
  });
  const ordered = [...residues.values()].sort((a, b) => a.firstAtom - b.firstAtom);
  ordered.forEach((residue, residuePosition) => {
    const find = (name) => lookup.get(atomKey(residue.chain, residue.index, residue.insertion, name));
    addIndices(find('N'), find('CA'));
    addIndices(find('CA'), find('C'));
    addIndices(find('C'), find('O'), 2);
    addIndices(find('C'), find('OXT'));
    for (const [first, second, order = 1] of PROTEIN_RESIDUE_BONDS[residue.name] || [])
      addIndices(find(first), find(second), order);
    const next = ordered[residuePosition + 1];
    if (next?.chain === residue.chain) {
      const carbon = find('C');
      const nitrogen = lookup.get(atomKey(next.chain, next.index, next.insertion, 'N'));
      if (carbon !== undefined && nitrogen !== undefined) {
        const a = atoms[carbon], b = atoms[nitrogen];
        if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= 1.9) addIndices(carbon, nitrogen);
      }
    }
  });
  return bonds;
}

const PROTEIN_SIDECHAIN_HYDROGENS = Object.freeze({
  ALA: { CB: 3 },
  ARG: { CB: 2, CG: 2, CD: 2, NE: 1, NH1: 2, NH2: 2 },
  ASN: { CB: 2, ND2: 2 },
  ASP: { CB: 2 },
  CYS: { CB: 2, SG: 1 },
  GLN: { CB: 2, CG: 2, NE2: 2 },
  GLU: { CB: 2, CG: 2 },
  GLY: {},
  HIS: { CB: 2, ND1: 1, CE1: 1, CD2: 1 },
  ILE: { CB: 1, CG1: 2, CG2: 3, CD1: 3 },
  LEU: { CB: 2, CG: 1, CD1: 3, CD2: 3 },
  LYS: { CB: 2, CG: 2, CD: 2, CE: 2, NZ: 3 },
  MET: { CB: 2, CG: 2, CE: 3 },
  PHE: { CB: 2, CD1: 1, CE1: 1, CZ: 1, CE2: 1, CD2: 1 },
  PRO: { CB: 2, CG: 2, CD: 2 },
  SER: { CB: 2, OG: 1 },
  THR: { CB: 1, OG1: 1, CG2: 3 },
  TPO: { CB: 1, CG2: 3 },
  TRP: { CB: 2, CD1: 1, NE1: 1, CE3: 1, CZ3: 1, CH2: 1, CZ2: 1 },
  TYR: { CB: 2, CD1: 1, CE1: 1, CE2: 1, CD2: 1, OH: 1 },
  VAL: { CB: 1, CG1: 3, CG2: 3 },
});

function proteinResidues(molecule) {
  const residues = new Map();
  molecule.atoms.forEach((atom, atomIndex) => {
    if (atom.record && atom.record !== 'ATOM') return;
    const key = `${atom.chain || 'A'}:${atom.residueIndex}:${atom.insertionCode || ''}`;
    if (!residues.has(key)) residues.set(key, {
      key, chain: atom.chain || 'A', residueIndex: atom.residueIndex,
      insertionCode: atom.insertionCode || '', residueName: atom.residueName,
      atoms: [], firstAtom: atomIndex,
    });
    residues.get(key).atoms.push(atomIndex);
  });
  return [...residues.values()].sort((a, b) => a.firstAtom - b.firstAtom);
}

function proteinPreparationReport(molecule) {
  const residues = proteinResidues(molecule);
  const unknownResidues = [];
  const missingHeavyAtoms = [];
  const missingHeavyAtomDetails = [];
  residues.forEach((residue) => {
    const sidechain = PROTEIN_RESIDUE_BONDS[residue.residueName];
    if (!sidechain) { unknownResidues.push(`${residue.residueName} ${residue.chain}${residue.residueIndex}${residue.insertionCode}`); return; }
    const expected = new Set(['N', 'CA', 'C', 'O']);
    sidechain.forEach(([first, second]) => { expected.add(first); expected.add(second); });
    const present = new Set(residue.atoms.filter((index) => molecule.atoms[index].element !== 'H')
      .map((index) => molecule.atoms[index].atomName));
    expected.forEach((name) => {
      if (!present.has(name)) {
        missingHeavyAtoms.push(`${residue.residueName} ${residue.chain}${residue.residueIndex}${residue.insertionCode}:${name}`);
        missingHeavyAtomDetails.push({ residueName: residue.residueName, chain: residue.chain,
          residueIndex: residue.residueIndex, insertionCode: residue.insertionCode, atomName: name });
      }
    });
  });
  const heterogens = molecule.atoms.filter((atom) => atom.record === 'HETATM');
  const waterAtoms = heterogens.filter((atom) => ['HOH', 'WAT', 'H2O', 'TIP3', 'TIP3P'].includes(atom.residueName));
  const waterResidues = new Set(waterAtoms.map(waterResidueKey)).size;
  const heterogenGroups = new Map();
  molecule.atoms.forEach((atom, atomIndex) => {
    if (atom.record !== 'HETATM' || isWaterAtom(atom)) return;
    const key = `${atom.chain}:${atom.residueIndex}:${atom.insertionCode || ''}:${atom.residueName}`;
    if (!heterogenGroups.has(key)) heterogenGroups.set(key, { key, residueName: atom.residueName,
      chain: atom.chain, residueIndex: atom.residueIndex, insertionCode: atom.insertionCode || '',
      atomIndices: [], heavyAtoms: 0, hydrogens: 0 });
    const group = heterogenGroups.get(key); group.atomIndices.push(atomIndex);
    if (atom.element === 'H') group.hydrogens += 1; else group.heavyAtoms += 1;
  });
  const ligandGroups = [...heterogenGroups.values()];
  const unpreparedLigands = ligandGroups.filter((group) => group.heavyAtoms > 1 && group.hydrogens === 0);
  const hydrogens = molecule.atoms.filter((atom) => atom.element === 'H').length;
  const missingResidues = molecule.source?.missingResidues || [];
  const modeledByChain = new Map();
  residues.forEach((residue) => {
    if (!modeledByChain.has(residue.chain)) modeledByChain.set(residue.chain, []);
    modeledByChain.get(residue.chain).push(residue.residueIndex);
  });
  const internalMissingResidues = missingResidues.filter((entry) => {
    const modeled = modeledByChain.get(entry.chain) || [];
    return modeled.length && entry.residueIndex > Math.min(...modeled) && entry.residueIndex < Math.max(...modeled);
  });
  const repairableHeavyAtoms = missingHeavyAtomDetails.filter((detail) =>
    !['N', 'CA', 'C'].includes(detail.atomName)
    && Boolean(globalThis.MOLARIUM_PROTEIN_HEAVY_TEMPLATES?.[detail.residueName]?.[detail.atomName]));
  return {
    residues: residues.length, unknownResidues, missingHeavyAtoms, missingHeavyAtomDetails,
    heterogenAtoms: heterogens.length, waterAtoms: waterAtoms.length, waterResidues,
    nonWaterHeterogenAtoms: heterogens.length - waterAtoms.length, ligandGroups, unpreparedLigands, hydrogens,
    missingResidues, internalMissingResidues, repairableHeavyAtoms,
    canRepairHeavyAtoms: Boolean(missingHeavyAtoms.length)
      && repairableHeavyAtoms.length === missingHeavyAtoms.length,
    canAddHydrogens: Boolean(residues.length) && !unknownResidues.length && !missingHeavyAtoms.length
      && !internalMissingResidues.length,
  };
}

function templateFrame(points, originName, axisName, planeName) {
  const origin = points[originName], axisPoint = points[axisName], planePoint = points[planeName];
  if (!origin || !axisPoint || !planePoint) return null;
  const e1 = normaliseVector({ x: axisPoint[0] - origin[0], y: axisPoint[1] - origin[1], z: axisPoint[2] - origin[2] });
  const plane = { x: planePoint[0] - origin[0], y: planePoint[1] - origin[1], z: planePoint[2] - origin[2] };
  const projection = plane.x * e1.x + plane.y * e1.y + plane.z * e1.z;
  const orthogonal = { x: plane.x - projection * e1.x, y: plane.y - projection * e1.y, z: plane.z - projection * e1.z };
  if (Math.hypot(orthogonal.x, orthogonal.y, orthogonal.z) < 1e-5) return null;
  const e2 = normaliseVector(orthogonal);
  const e3 = normaliseVector(crossVector(e1, e2));
  return { origin: { x: origin[0], y: origin[1], z: origin[2] }, e1, e2, e3 };
}

function residueTemplateTransform(molecule, residue, template) {
  const actual = {};
  residue.atoms.forEach((index) => {
    const atom = molecule.atoms[index];
    if (atom.element !== 'H' && template[atom.atomName]) actual[atom.atomName] = [atom.x, atom.y, atom.z];
  });
  if (!actual.CA || !actual.N || !actual.C) return null;
  const common = Object.keys(actual).filter((name) => template[name]);
  const sidechain = common.filter((name) => !['N', 'CA', 'C', 'O', 'OXT'].includes(name));
  const distanceSquared = (name) => template[name].reduce((sum, value, axis) =>
    sum + (value - template.CA[axis]) ** 2, 0);
  const axisName = sidechain.sort((a, b) => distanceSquared(b) - distanceSquared(a))[0] || 'C';
  const origin = template.CA;
  const axis = template[axisName].map((value, index) => value - origin[index]);
  const axisNorm = Math.hypot(...axis) || 1;
  const planeCandidates = common.filter((name) => name !== 'CA' && name !== axisName)
    .map((name) => {
      const delta = template[name].map((value, index) => value - origin[index]);
      const projection = delta.reduce((sum, value, index) => sum + value * axis[index], 0) / (axisNorm ** 2);
      const perpendicular = delta.map((value, index) => value - projection * axis[index]);
      return { name, score: Math.hypot(...perpendicular) };
    }).sort((a, b) => b.score - a.score);
  const planeName = planeCandidates[0]?.name || (axisName === 'C' ? 'N' : 'C');
  const sourceFrame = templateFrame(template, 'CA', axisName, planeName);
  const targetFrame = templateFrame(actual, 'CA', axisName, planeName);
  if (!sourceFrame || !targetFrame) return null;
  return (coordinates) => {
    const delta = { x: coordinates[0] - sourceFrame.origin.x, y: coordinates[1] - sourceFrame.origin.y,
      z: coordinates[2] - sourceFrame.origin.z };
    const local = [
      delta.x * sourceFrame.e1.x + delta.y * sourceFrame.e1.y + delta.z * sourceFrame.e1.z,
      delta.x * sourceFrame.e2.x + delta.y * sourceFrame.e2.y + delta.z * sourceFrame.e2.z,
      delta.x * sourceFrame.e3.x + delta.y * sourceFrame.e3.y + delta.z * sourceFrame.e3.z,
    ];
    return {
      x: targetFrame.origin.x + local[0] * targetFrame.e1.x + local[1] * targetFrame.e2.x + local[2] * targetFrame.e3.x,
      y: targetFrame.origin.y + local[0] * targetFrame.e1.y + local[1] * targetFrame.e2.y + local[2] * targetFrame.e3.y,
      z: targetFrame.origin.z + local[0] * targetFrame.e1.z + local[1] * targetFrame.e2.z + local[2] * targetFrame.e3.z,
    };
  };
}

function proteinHeavyAtomElement(atomName) {
  if (/^O/.test(atomName)) return 'O';
  if (/^N/.test(atomName)) return 'N';
  if (/^S/.test(atomName)) return 'S';
  if (/^P/.test(atomName)) return 'P';
  return 'C';
}

function rebuildProteinTopology(molecule) {
  const retained = molecule.bonds.filter((bond) => bond.topology !== 'protein');
  const regenerated = proteinCovalentBonds(molecule.atoms);
  const seen = new Set();
  molecule.bonds = [...retained, ...regenerated].filter((bond) => {
    const key = bond.a < bond.b ? `${bond.a}:${bond.b}` : `${bond.b}:${bond.a}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function rotatePointAboutAxis(point, origin, axis, radians) {
  const relative = { x: point.x - origin.x, y: point.y - origin.y, z: point.z - origin.z };
  const cosine = Math.cos(radians), sine = Math.sin(radians);
  const dot = relative.x * axis.x + relative.y * axis.y + relative.z * axis.z;
  const cross = crossVector(axis, relative);
  return {
    x: origin.x + relative.x * cosine + cross.x * sine + axis.x * dot * (1 - cosine),
    y: origin.y + relative.y * cosine + cross.y * sine + axis.y * dot * (1 - cosine),
    z: origin.z + relative.z * cosine + cross.z * sine + axis.z * dot * (1 - cosine),
  };
}

function optimizeModeledSidechainRotamers(molecule) {
  const choices = [];
  const bonded = new Set(molecule.bonds.map((bond) => bond.a < bond.b
    ? `${bond.a}:${bond.b}` : `${bond.b}:${bond.a}`));
  for (const residue of proteinResidues(molecule)) {
    const residueEdges = PROTEIN_RESIDUE_BONDS[residue.residueName] || [];
    if (!residueEdges.length) continue;
    const byName = new Map(residue.atoms.map((index) => [molecule.atoms[index].atomName, index]));
    const modeledNames = new Set(residue.atoms.filter((index) => {
      const atom = molecule.atoms[index];
      return atom.modeled && atom.element !== 'H' && !['N', 'CA', 'C', 'O', 'OXT'].includes(atom.atomName);
    }).map((index) => molecule.atoms[index].atomName));
    if (!modeledNames.size) continue;
    const adjacency = new Map();
    const connect = (first, second) => {
      if (!adjacency.has(first)) adjacency.set(first, []);
      adjacency.get(first).push(second);
    };
    residueEdges.forEach(([first, second]) => { connect(first, second); connect(second, first); });
    const depths = new Map([['CA', 0]]), queue = ['CA'];
    while (queue.length) {
      const name = queue.shift();
      for (const neighbor of adjacency.get(name) || []) if (!depths.has(neighbor)) {
        depths.set(neighbor, depths.get(name) + 1); queue.push(neighbor);
      }
    }
    const visited = new Set();
    for (const seed of modeledNames) {
      if (visited.has(seed)) continue;
      const component = new Set([seed]), pending = [seed]; visited.add(seed);
      while (pending.length) {
        const name = pending.shift();
        for (const neighbor of adjacency.get(name) || []) if (modeledNames.has(neighbor) && !visited.has(neighbor)) {
          visited.add(neighbor); component.add(neighbor); pending.push(neighbor);
        }
      }
      const boundaries = [...new Set([...component].flatMap((name) =>
        (adjacency.get(name) || []).filter((neighbor) => !component.has(neighbor) && byName.has(neighbor))))];
      if (boundaries.length !== 1) continue;
      const anchorName = boundaries[0];
      const predecessorName = (adjacency.get(anchorName) || [])
        .filter((name) => !component.has(name) && byName.has(name))
        .sort((a, b) => (depths.get(a) ?? Infinity) - (depths.get(b) ?? Infinity))[0];
      if (!predecessorName) continue;
      const anchor = molecule.atoms[byName.get(anchorName)];
      const predecessor = molecule.atoms[byName.get(predecessorName)];
      const axisDelta = { x: anchor.x - predecessor.x, y: anchor.y - predecessor.y, z: anchor.z - predecessor.z };
      if (Math.hypot(axisDelta.x, axisDelta.y, axisDelta.z) < 1e-6) continue;
      const axis = normaliseVector(axisDelta);
      const movable = [...component].map((name) => byName.get(name)).filter(Number.isInteger);
      const movableSet = new Set(movable);
      const original = new Map(movable.map((index) => [index, { x: molecule.atoms[index].x,
        y: molecule.atoms[index].y, z: molecule.atoms[index].z }]));
      let best = null;
      for (let degrees = 0; degrees < 360; degrees += 30) {
        const radians = degrees * Math.PI / 180;
        movable.forEach((index) => Object.assign(molecule.atoms[index],
          rotatePointAboutAxis(original.get(index), anchor, axis, radians)));
        let minimum = Infinity, overlapPenalty = 0;
        for (const index of movable) {
          const atom = molecule.atoms[index];
          molecule.atoms.forEach((other, otherIndex) => {
            if (movableSet.has(otherIndex) || other.element === 'H') return;
            const key = index < otherIndex ? `${index}:${otherIndex}` : `${otherIndex}:${index}`;
            if (bonded.has(key)) return;
            const distance = Math.hypot(atom.x - other.x, atom.y - other.y, atom.z - other.z);
            minimum = Math.min(minimum, distance);
            overlapPenalty += Math.max(0, 1.7 - distance) ** 2;
          });
        }
        if (!best || minimum > best.minimum + 1e-6
          || (Math.abs(minimum - best.minimum) <= 1e-6 && overlapPenalty < best.overlapPenalty))
          best = { degrees, minimum, overlapPenalty,
            positions: movable.map((index) => ({ index, ...molecule.atoms[index] })) };
      }
      best.positions.forEach(({ index, x, y, z }) => Object.assign(molecule.atoms[index], { x, y, z }));
      choices.push({ residueName: residue.residueName, chain: residue.chain,
        residueIndex: residue.residueIndex, insertionCode: residue.insertionCode,
        anchor: `${predecessorName}-${anchorName}`, atoms: [...component], degrees: best.degrees,
        minimumExternalDistance: best.minimum });
    }
  }
  molecule.bonds.forEach((bond) => { bond.distance = bondDistance(molecule, bond.a, bond.b); });
  return choices;
}

function repairCanonicalHeavyAtoms(inputMolecule) {
  const molecule = structuredClone(inputMolecule);
  delete molecule.parameterization;
  const before = proteinPreparationReport(molecule);
  const repaired = [], unresolved = [];
  const detailsByResidue = new Map();
  before.missingHeavyAtomDetails.forEach((detail) => {
    const key = `${detail.chain}:${detail.residueIndex}:${detail.insertionCode}:${detail.residueName}`;
    if (!detailsByResidue.has(key)) detailsByResidue.set(key, []);
    detailsByResidue.get(key).push(detail);
  });
  for (const residue of proteinResidues(molecule)) {
    const key = `${residue.chain}:${residue.residueIndex}:${residue.insertionCode}:${residue.residueName}`;
    const details = detailsByResidue.get(key);
    if (!details?.length) continue;
    const template = globalThis.MOLARIUM_PROTEIN_HEAVY_TEMPLATES?.[residue.residueName];
    const transform = template && residueTemplateTransform(molecule, residue, template);
    for (const detail of details) {
      if (!transform || ['N', 'CA', 'C'].includes(detail.atomName) || !template[detail.atomName]) {
        unresolved.push(detail); continue;
      }
      const position = transform(template[detail.atomName]);
      molecule.atoms.push({
        element: proteinHeavyAtomElement(detail.atomName), ...position, record: 'ATOM', atomName: detail.atomName,
        residueName: detail.residueName, chain: detail.chain, residueIndex: detail.residueIndex,
        insertionCode: detail.insertionCode || '', occupancy: 0, charge: 0, modeled: true,
      });
      repaired.push({ ...detail, position });
    }
  }
  rebuildProteinTopology(molecule);
  const rotamers = optimizeModeledSidechainRotamers(molecule);
  molecule.source = { ...(molecule.source || {}), repairedHeavyAtoms: repaired.map(({ position, ...entry }) => entry),
    repairedSidechainRotamers: rotamers };
  molecule.preparation = { ...(molecule.preparation || {}), status: 'repaired', heavyAtomsAdded: repaired.length,
    rotamersOptimized: rotamers.length, parameterized: false };
  return { molecule, repaired, unresolved, rotamers, before, after: proteinPreparationReport(molecule) };
}

function proteinSegments(molecule) {
  const residues = proteinResidues(molecule);
  const atomIndex = new Map();
  residues.forEach((residue) => residue.atoms.forEach((index) =>
    atomIndex.set(`${residue.key}:${molecule.atoms[index].atomName}`, index)));
  const segments = [];
  for (const residue of residues) {
    const current = segments.at(-1);
    const previous = current?.at(-1);
    let connected = false;
    if (previous?.chain === residue.chain) {
      const carbon = atomIndex.get(`${previous.key}:C`), nitrogen = atomIndex.get(`${residue.key}:N`);
      connected = molecule.bonds.some((bond) => (bond.a === carbon && bond.b === nitrogen)
        || (bond.b === carbon && bond.a === nitrogen));
    }
    if (!current || !connected) segments.push([residue]); else current.push(residue);
  }
  return segments;
}

function addMissingTerminalOxygens(inputMolecule) {
  const molecule = structuredClone(inputMolecule);
  const added = [];
  for (const segment of proteinSegments(molecule)) {
    const residue = segment.at(-1);
    const atoms = new Map(residue.atoms.map((index) => [molecule.atoms[index].atomName, { atom: molecule.atoms[index], index }]));
    if (atoms.has('OXT') || !atoms.has('CA') || !atoms.has('C') || !atoms.has('O')) continue;
    const ca = atoms.get('CA').atom, carbon = atoms.get('C').atom, oxygen = atoms.get('O').atom;
    const axis = normaliseVector({ x: carbon.x - ca.x, y: carbon.y - ca.y, z: carbon.z - ca.z });
    const caToO = { x: oxygen.x - ca.x, y: oxygen.y - ca.y, z: oxygen.z - ca.z };
    const projection = caToO.x * axis.x + caToO.y * axis.y + caToO.z * axis.z;
    const perpendicular = { x: caToO.x - projection * axis.x, y: caToO.y - projection * axis.y,
      z: caToO.z - projection * axis.z };
    const position = { x: oxygen.x - 2 * perpendicular.x, y: oxygen.y - 2 * perpendicular.y,
      z: oxygen.z - 2 * perpendicular.z };
    const index = molecule.atoms.length;
    molecule.atoms.push({ element: 'O', ...position, record: 'ATOM', atomName: 'OXT',
      residueName: residue.residueName, chain: residue.chain, residueIndex: residue.residueIndex,
      insertionCode: residue.insertionCode, occupancy: 0, charge: 0, modeled: true });
    molecule.bonds.push({ a: atoms.get('C').index, b: index, order: 1,
      distance: Math.hypot(carbon.x - position.x, carbon.y - position.y, carbon.z - position.z),
      topology: 'prepared terminal' });
    added.push({ residueName: residue.residueName, chain: residue.chain,
      residueIndex: residue.residueIndex, insertionCode: residue.insertionCode, atomName: 'OXT' });
  }
  molecule.source = { ...(molecule.source || {}), repairedTerminalAtoms: added };
  return { molecule, added };
}

function cifLineTokens(line) {
  return [...String(line).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
    .map((match) => match[1] ?? match[2] ?? match[3]);
}

function ccdLoopRows(lines, category) {
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim() !== 'loop_') continue;
    const headers = [];
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim().startsWith('_')) {
      headers.push(lines[cursor].trim()); cursor += 1;
    }
    if (!headers.some((header) => header.startsWith(`${category}.`))) continue;
    const rows = [], pending = [];
    while (cursor < lines.length) {
      const trimmed = lines[cursor].trim();
      if (!trimmed || trimmed.startsWith('#')) break;
      if (trimmed === 'loop_' || trimmed.startsWith('_') || trimmed.startsWith('data_')) break;
      pending.push(...cifLineTokens(trimmed));
      while (pending.length >= headers.length) {
        const values = pending.splice(0, headers.length);
        rows.push(Object.fromEntries(headers.map((header, column) =>
          [header.slice(category.length + 1), values[column]])));
      }
      cursor += 1;
    }
    return rows;
  }
  return [];
}

function parseCcdDefinition(text, expectedId = '') {
  const lines = String(text || '').split(/\r?\n/);
  const atomRows = ccdLoopRows(lines, '_chem_comp_atom');
  const bondRows = ccdLoopRows(lines, '_chem_comp_bond');
  if (!atomRows.length || !bondRows.length) throw new Error('CCD definition contains no atom or bond table');
  const atoms = atomRows.map((row) => ({
    id: row.atom_id, element: normalizeElement(row.type_symbol), charge: Number(row.charge) || 0,
    aromatic: row.pdbx_aromatic_flag === 'Y', leaving: row.pdbx_leaving_atom_flag === 'Y',
    x: Number(row.pdbx_model_Cartn_x_ideal ?? row.model_Cartn_x),
    y: Number(row.pdbx_model_Cartn_y_ideal ?? row.model_Cartn_y),
    z: Number(row.pdbx_model_Cartn_z_ideal ?? row.model_Cartn_z),
  }));
  const atomIds = new Set(atoms.map((atom) => atom.id));
  const order = { SING: 1, DOUB: 2, TRIP: 3, AROM: 1.5, QUAD: 4 };
  const bonds = bondRows.map((row) => ({ a: row.atom_id_1, b: row.atom_id_2,
    order: order[row.value_order] || (row.pdbx_aromatic_flag === 'Y' ? 1.5 : 1),
    aromatic: row.pdbx_aromatic_flag === 'Y' })).filter((bond) => atomIds.has(bond.a) && atomIds.has(bond.b));
  const dataLine = lines.find((line) => line.trim().startsWith('data_'))?.trim().slice(5).toUpperCase();
  const id = (dataLine || expectedId || '').toUpperCase();
  if (expectedId && id !== expectedId.toUpperCase()) throw new Error(`CCD identity mismatch: requested ${expectedId}, received ${id}`);
  if (atoms.some((atom) => !ELEMENTS[atom.element])) throw new Error(`${id || 'CCD'} contains an unsupported element`);
  return { id, atoms, bonds };
}

const ccdDefinitionCache = new Map();

async function fetchCcdDefinition(residueName) {
  requireExternalNetwork('RCSB CCD retrieval');
  const id = String(residueName || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,5}$/.test(id)) throw new Error(`Invalid CCD identifier ${id || '(empty)'}`);
  if (!ccdDefinitionCache.has(id)) ccdDefinitionCache.set(id, (async () => {
    const response = await fetch(`https://files.rcsb.org/ligands/download/${encodeURIComponent(id)}.cif`);
    if (!response.ok) throw new Error(`RCSB CCD ${id} lookup failed (${response.status})`);
    return parseCcdDefinition(await response.text(), id);
  })().catch((error) => { ccdDefinitionCache.delete(id); throw error; }));
  return ccdDefinitionCache.get(id);
}

function moleculeWithAtomsRemoved(inputMolecule, remove) {
  const oldToNew = new Map(), atoms = [];
  inputMolecule.atoms.forEach((atom, index) => {
    if (remove(atom, index)) return;
    oldToNew.set(index, atoms.length); atoms.push(structuredClone(atom));
  });
  const bonds = inputMolecule.bonds.filter((bond) => oldToNew.has(bond.a) && oldToNew.has(bond.b))
    .map((bond) => ({ ...structuredClone(bond), a: oldToNew.get(bond.a), b: oldToNew.get(bond.b) }));
  const molecule = structuredClone(inputMolecule); molecule.atoms = atoms; molecule.bonds = bonds;
  molecule.charge = atoms.reduce((sum, atom) => sum + Number(atom.charge || 0), 0);
  return molecule;
}

function prepareLigandsFromCcdDefinitions(inputMolecule, definitions) {
  const molecule = structuredClone(inputMolecule);
  delete molecule.parameterization;
  const prepared = [];
  const groups = proteinPreparationReport(molecule).ligandGroups.filter((group) => group.heavyAtoms > 1);
  for (const group of groups) {
    const definition = definitions[group.residueName];
    if (!definition) throw new Error(`No CCD definition supplied for ${group.residueName}`);
    const definitionAtoms = new Map(definition.atoms.map((atom) => [atom.id, atom]));
    const existing = new Map(group.atomIndices.map((index) => [molecule.atoms[index].atomName, index]));
    for (const [name, index] of existing) {
      const expected = definitionAtoms.get(name);
      if (!expected) throw new Error(`${group.residueName} atom ${name} is absent from its CCD definition`);
      if (molecule.atoms[index].element !== expected.element)
        throw new Error(`${group.residueName} atom ${name} element differs from CCD (${molecule.atoms[index].element}/${expected.element})`);
      molecule.atoms[index].charge = Number(expected.formalCharge ?? expected.charge ?? 0);
      molecule.atoms[index].aromatic = expected.aromatic;
      molecule.atoms[index].ccd = group.residueName;
    }
    const inGroup = new Set(group.atomIndices);
    molecule.bonds = molecule.bonds.filter((bond) => !(inGroup.has(bond.a) && inGroup.has(bond.b)));
    const ccdIndex = new Map(existing);
    for (const bond of definition.bonds) {
      const firstDefinition = definitionAtoms.get(bond.a), secondDefinition = definitionAtoms.get(bond.b);
      if (firstDefinition?.element === 'H' || secondDefinition?.element === 'H') continue;
      const a = ccdIndex.get(bond.a), b = ccdIndex.get(bond.b);
      if (a === undefined || b === undefined) continue;
      const first = molecule.atoms[a], second = molecule.atoms[b];
      molecule.bonds.push({ a, b, order: bond.order,
        distance: Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z),
        topology: 'RCSB CCD', aromatic: bond.aromatic });
    }
    for (const atom of definition.atoms.filter((entry) => entry.element === 'H' && !entry.leaving)) {
      if (ccdIndex.has(atom.id)) continue;
      const parentBond = definition.bonds.find((bond) => bond.a === atom.id || bond.b === atom.id);
      const parentName = parentBond && (parentBond.a === atom.id ? parentBond.b : parentBond.a);
      const parentIndex = ccdIndex.get(parentName);
      if (parentIndex === undefined) throw new Error(`${group.residueName} hydrogen ${atom.id} has no retained CCD parent`);
      const parent = molecule.atoms[parentIndex];
      const siblings = definition.bonds.filter((bond) => bond.a === parentName || bond.b === parentName)
        .map((bond) => bond.a === parentName ? bond.b : bond.a)
        .filter((name) => definitionAtoms.get(name)?.element === 'H' && !definitionAtoms.get(name)?.leaving);
      const ordinal = siblings.indexOf(atom.id);
      const position = proteinHydrogenPosition(molecule, parentIndex, Math.max(0, ordinal), Math.max(1, siblings.length));
      const index = molecule.atoms.length;
      molecule.atoms.push({ element: 'H', ...position, record: 'HETATM', atomName: atom.id,
        residueName: group.residueName, chain: group.chain, residueIndex: group.residueIndex,
        insertionCode: group.insertionCode, occupancy: 0,
        charge:Number(atom.formalCharge ?? atom.charge ?? 0), prepared: true, ccd: group.residueName });
      ccdIndex.set(atom.id, index); inGroup.add(index);
    }
    for (const bond of definition.bonds) {
      const a = ccdIndex.get(bond.a), b = ccdIndex.get(bond.b);
      if (a === undefined || b === undefined) continue;
      if (definitionAtoms.get(bond.a)?.element !== 'H' && definitionAtoms.get(bond.b)?.element !== 'H') continue;
      const first = molecule.atoms[a], second = molecule.atoms[b];
      molecule.bonds.push({ a, b, order: bond.order,
        distance: Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z),
        topology: 'RCSB CCD', aromatic: bond.aromatic });
    }
    prepared.push({ residueName: group.residueName, chain: group.chain, residueIndex: group.residueIndex,
      insertionCode: group.insertionCode, atoms: ccdIndex.size,
      hydrogensAdded: [...ccdIndex.keys()].filter((name) => definitionAtoms.get(name)?.element === 'H' && !existing.has(name)).length });
  }
  molecule.charge = molecule.atoms.reduce((sum, atom) => sum + Number(atom.charge || 0), 0);
  molecule.source = { ...(molecule.source || {}), preparedLigands: prepared };
  return { molecule, prepared };
}

async function preparePdbLigands(inputMolecule) {
  const groups = proteinPreparationReport(inputMolecule).ligandGroups.filter((group) => group.heavyAtoms > 1);
  const ids = [...new Set(groups.map((group) => group.residueName))];
  const definitions = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await fetchCcdDefinition(id)])));
  return prepareLigandsFromCcdDefinitions(inputMolecule, definitions);
}

function addCrystallographicWaterHydrogens(inputMolecule) {
  const molecule = structuredClone(inputMolecule);
  let added = 0;
  const angle = 104.52 * Math.PI / 180;
  molecule.atoms.forEach((oxygen, oxygenIndex) => {
    if (!isWaterAtom(oxygen) || oxygen.element !== 'O') return;
    const existing = molecule.bonds.filter((bond) => bond.a === oxygenIndex || bond.b === oxygenIndex)
      .map((bond) => bond.a === oxygenIndex ? bond.b : bond.a).filter((index) => molecule.atoms[index].element === 'H').length;
    if (existing >= 2) return;
    const axis = deterministicUnitVector(`${oxygen.chain}:${oxygen.residueIndex}:water`);
    const helper = Math.abs(axis.z) < 0.8 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    const perpendicular = normaliseVector(crossVector(axis, helper));
    for (let ordinal = existing; ordinal < 2; ordinal++) {
      const sign = ordinal ? -1 : 1;
      const direction = {
        x: axis.x * Math.cos(angle / 2) + perpendicular.x * Math.sin(angle / 2) * sign,
        y: axis.y * Math.cos(angle / 2) + perpendicular.y * Math.sin(angle / 2) * sign,
        z: axis.z * Math.cos(angle / 2) + perpendicular.z * Math.sin(angle / 2) * sign,
      };
      const position = { x: oxygen.x + 0.9572 * direction.x, y: oxygen.y + 0.9572 * direction.y,
        z: oxygen.z + 0.9572 * direction.z };
      const index = molecule.atoms.length;
      molecule.atoms.push({ element: 'H', ...position, record: 'HETATM', atomName: `H${ordinal + 1}`,
        residueName: oxygen.residueName, chain: oxygen.chain, residueIndex: oxygen.residueIndex,
        insertionCode: oxygen.insertionCode || '', occupancy: 0, charge: 0, prepared: true });
      molecule.bonds.push({ a: oxygenIndex, b: index, order: 1, distance: 0.9572, topology: 'prepared water' });
      added += 1;
    }
  });
  molecule.source = { ...(molecule.source || {}), waterHydrogensAdded: added };
  return { molecule, added };
}

const COMPONENT_COLORS = ['#4f79a7', '#45a07a', '#8c6bb1', '#cf7b45', '#3c94a6', '#b05c78'];

function isProteinAtom(atom) {
  return atom?.record === 'ATOM' || Boolean(atom?.atomName && PROTEIN_RESIDUE_BONDS[atom.residueName]);
}

function isWaterAtom(atom) {
  return atom?.record === 'HETATM' && ['HOH', 'WAT', 'H2O', 'TIP3', 'TIP3P'].includes(atom.residueName);
}

function buildStructureComponents(molecule) {
  const groups = new Map();
  const ensure = (id, data) => {
    if (!groups.has(id)) groups.set(id, { id, atomIndices: [], residueKeys: new Set(), ...data });
    return groups.get(id);
  };
  molecule.atoms.forEach((atom, atomIndex) => {
    let group;
    if (isProteinAtom(atom)) {
      const chain = atom.chain || 'A';
      group = ensure(`protein:${chain}`, { kind: 'protein', label: `Protein chain ${chain}`, chain });
      group.residueKeys.add(`${chain}:${atom.residueIndex}:${atom.insertionCode || ''}`);
    } else if (isWaterAtom(atom)) {
      group = ensure('solvent:water', { kind: 'water', label: 'Crystallographic water' });
      group.residueKeys.add(`${atom.chain}:${atom.residueIndex}:${atom.insertionCode || ''}`);
    } else if (atom.record === 'HETATM') {
      const key = `${atom.chain || 'A'}:${atom.residueIndex}:${atom.insertionCode || ''}:${atom.residueName || 'UNL'}`;
      group = ensure(`heterogen:${key}`, { kind: 'ligand', residueName: atom.residueName || 'UNL',
        chain: atom.chain || 'A', residueIndex: atom.residueIndex, insertionCode: atom.insertionCode || '' });
      group.residueKeys.add(key);
    } else {
      group = ensure('molecule:main', { kind: 'molecule', label: molecule.name || 'Molecule' });
    }
    group.atomIndices.push(atomIndex);
  });
  const components = [...groups.values()];
  components.forEach((component, index) => {
    component.residueCount = component.residueKeys.size;
    delete component.residueKeys;
    component.color = component.kind === 'protein'
      ? COMPONENT_COLORS[components.filter((entry) => entry.kind === 'protein').indexOf(component) % COMPONENT_COLORS.length]
      : component.kind === 'ligand' ? '#d97745' : component.kind === 'water' ? '#65a9d7' : '#64748b';
    if (component.kind === 'ligand') {
      const longName = molecule.source?.heterogenNames?.[component.residueName];
      const ionLike = component.atomIndices.length === 1 && molecule.atoms[component.atomIndices[0]].element !== 'C';
      component.kind = ionLike ? 'ion' : 'ligand';
      component.label = ionLike ? `${component.residueName} ion`
        : `${component.residueName} ligand`;
      component.description = longName || `Chain ${component.chain} · residue ${component.residueIndex}${component.insertionCode}`;
    } else if (component.kind === 'protein') {
      component.description = `${component.residueCount} modeled residues`;
    } else if (component.kind === 'water') {
      component.description = `${component.residueCount} waters · hidden by default`;
    }
    component.index = index;
  });
  return components;
}

function resetStructureComponents(molecule, preserveDisplay = false) {
  const previousVisibility = state.componentVisibility;
  const previousFocus = state.focusedComponentId;
  const previousComponents = state.structureComponents;
  const previousFocusedComponent = previousComponents.find((component) =>
    component.id === previousFocus) || null;
  const semanticMatch = (component, previous) => {
    if (!component || !previous || component.kind !== previous.kind) return false;
    if (component.kind === 'ligand' || component.kind === 'ion') return (
      component.chain === previous.chain
      && component.residueIndex === previous.residueIndex
      && (component.insertionCode || '') === (previous.insertionCode || '')
    );
    return false;
  };
  state.structureComponents = buildStructureComponents(molecule);
  state.atomComponentIds = Array(molecule.atoms.length).fill(null);
  state.structureComponents.forEach((component) => component.atomIndices.forEach((index) => {
    state.atomComponentIds[index] = component.id;
  }));
  state.componentVisibility = new Map(state.structureComponents.map((component) => {
    const previousSemanticComponent = preserveDisplay && !previousVisibility.has(component.id)
      ? previousComponents.find((entry) => semanticMatch(component, entry)) : null;
    const previousId = previousVisibility.has(component.id)
      ? component.id : previousSemanticComponent?.id;
    return [component.id, preserveDisplay && previousId
      ? previousVisibility.get(previousId) : component.kind !== 'water'];
  }));
  const restoredFocus = preserveDisplay && previousFocusedComponent
    ? state.structureComponents.find((component) => component.id === previousFocus)
      || state.structureComponents.find((component) =>
        semanticMatch(component, previousFocusedComponent))
    : null;
  if (restoredFocus) {
    // Registered graph edits replace the ligand component and therefore its
    // residue-name-derived ID.  Keep the established pocket camera exactly;
    // only retarget the semantic focus to the replacement ligand.
    state.focusedComponentId = restoredFocus.id;
  } else if (!preserveDisplay || previousFocus) {
    state.focusedComponentId = null;
    state.focusedComponentCenter = null;
    state.focusedComponentRadius = null;
  }
}

function refreshStructureComponents() {
  if (!state.molecule) return;
  resetStructureComponents(state.molecule, true);
  updateStructureComponentsUi();
}

function componentVisible(atomIndex) {
  const componentId = state.atomComponentIds[atomIndex];
  return componentId == null || state.componentVisibility.get(componentId) !== false;
}

function structureComponentSummary() {
  const count = (kind) => state.structureComponents.filter((component) => component.kind === kind).length;
  const proteins = count('protein'), ligands = count('ligand'), ions = count('ion');
  const waters = state.structureComponents.find((component) => component.kind === 'water')?.residueCount || 0;
  return [proteins && `${proteins} protein chain${proteins === 1 ? '' : 's'}`,
    ligands && `${ligands} ligand${ligands === 1 ? '' : 's'}`, ions && `${ions} ion${ions === 1 ? '' : 's'}`,
    waters && `${waters} water${waters === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
}

const COMPONENT_FOCUS_CONTEXT_ANGSTROM = 5;

function focusedAtomEntries(molecule = state.molecule) {
  if (!molecule || !state.focusedAtomIds.length) return [];
  const ids = new Set(state.focusedAtomIds);
  return molecule.atoms.map((atom, index) => ({ atom, index }))
    .filter(({ atom, index }) => ids.has(atom.designAtomId) && componentVisible(index));
}

function updateChangedRegionChip() {
  const chip = document.querySelector('#changed-region-chip');
  if (!chip) return;
  const emphasized = new Set(state.emphasizedAtomIds);
  const count = state.molecule?.atoms.filter((atom, index) => atom.element !== 'H'
    && emphasized.has(atom.designAtomId) && componentVisible(index)).length || 0;
  chip.classList.toggle('hidden', !count);
  chip.textContent = count ? `Changed region · ${count} atom${count === 1 ? '' : 's'} ×` : '';
}

function clearFocusedAtomRegion({ redraw = false } = {}) {
  state.focusedAtomIds = [];
  state.focusedAtomCenter = null;
  state.focusedAtomRadius = null;
  state.focusedAtomContextIds = [];
  state.focusedAtomResidueLabels = [];
  state.emphasizedAtomIds = [];
  updateChangedRegionChip();
  if (redraw) draw();
}

function calculateFocusedAtomContextIndices(molecule, targets) {
  if (!molecule || !targets.length) return null;
  const context = new Set(targets.map(({ index }) => index));
  const activeLigand = connectedLigandAtomIndexSet(molecule);
  activeLigand.forEach((index) => context.add(index));
  const targetProteinResidues = new Set(targets
    .filter(({ atom }) => isProteinAtom(atom)).map(({ atom }) => residueKey(atom)));
  molecule.atoms.forEach((atom, index) => {
    if (targetProteinResidues.has(residueKey(atom))) context.add(index);
  });
  const adjacency = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond) => {
    adjacency[bond.a]?.push(bond.b); adjacency[bond.b]?.push(bond.a);
  });
  // Retain two covalent shells so a changed substituent or side chain is
  // legible as chemistry rather than a collection of disconnected atoms.
  let frontier = [...context];
  for (let shell = 0; shell < 2; shell++) {
    const next = [];
    frontier.forEach((index) => adjacency[index]?.forEach((neighbor) => {
      if (context.has(neighbor)) return;
      context.add(neighbor); next.push(neighbor);
    }));
    frontier = next;
  }
  const cutoffSquared = state.focusedAtomContextRadius ** 2;
  const nearbyResidues = new Set();
  const componentKindById = new Map(state.structureComponents.map((component) =>
    [component.id, component.kind]));
  const anchors = [...new Set([...targets.map(({ index }) => index), ...activeLigand])]
    .map((index) => molecule.atoms[index]).filter((atom) => atom && atom.element !== 'H');
  molecule.atoms.forEach((atom, index) => {
    if (context.has(index)) return;
    const near = anchors.some((target) => {
      const dx = atom.x - target.x, dy = atom.y - target.y, dz = atom.z - target.z;
      return dx * dx + dy * dy + dz * dz <= cutoffSquared;
    });
    if (!near) return;
    const kind = componentKindById.get(state.atomComponentIds[index]);
    if (kind === 'protein' || kind === 'water') nearbyResidues.add(residueKey(atom));
    else context.add(index);
  });
  molecule.atoms.forEach((atom, index) => {
    if (nearbyResidues.has(residueKey(atom))) context.add(index);
  });
  return context;
}

function focusedAtomContextIndices(molecule = state.molecule) {
  if (!molecule || !state.focusedAtomContextIds.length) return null;
  const ids = new Set(state.focusedAtomContextIds);
  return new Set(molecule.atoms.flatMap((atom, index) =>
    ids.has(atom.designAtomId) ? [index] : []));
}

function focusStructureAtoms(atomIds, contextRadiusAngstrom = 4.5, highlight = true,
  residueLabels = []) {
  const ids = [...new Set(atomIds)];
  if (!ids.length) {
    state.emphasizedAtomIds = [];
    updateChangedRegionChip(); draw();
    return [];
  }
  state.focusedAtomIds = ids;
  state.focusedAtomContextRadius = contextRadiusAngstrom;
  state.focusedAtomResidueLabels = structuredClone(residueLabels);
  state.emphasizedAtomIds = highlight ? ids.slice() : [];
  state.focusedComponentId = null; state.focusedComponentCenter = null;
  state.focusedComponentRadius = null;
  state.focusedResidueKey = null; state.focusedResidueRadius = null;
  const targets = focusedAtomEntries();
  if (targets.length) {
    const context = calculateFocusedAtomContextIndices(state.molecule, targets);
    state.focusedAtomContextIds = [...(context || [])].map((index) =>
      state.molecule.atoms[index]?.designAtomId).filter(Boolean);
    const fitted = [...(context || [])].map((index) => state.molecule.atoms[index])
      .filter((atom) => atom && (state.showHydrogens || atom.element !== 'H'));
    const fitAtoms = fitted.length ? fitted : targets.map(({ atom }) => atom);
    const center = fitAtoms.reduce((sum, atom) => ({
      x:sum.x + atom.x, y:sum.y + atom.y, z:sum.z + atom.z,
    }), { x:0, y:0, z:0 });
    center.x /= fitAtoms.length; center.y /= fitAtoms.length; center.z /= fitAtoms.length;
    state.focusedAtomCenter = { ...center };
    const radius = Math.max(0, ...fitAtoms.map((atom) =>
      Math.hypot(atom.x - center.x, atom.y - center.y, atom.z - center.z)));
    state.focusedAtomRadius = Math.max(6, radius * 1.08 + 1.5);
    state.zoom = 1; state.viewPan = { x:0, y:0 };
  } else {
    state.focusedAtomCenter = null;
    state.focusedAtomRadius = null;
    state.focusedAtomContextIds = [];
  }
  updateResidueFollowChip(); updateChangedRegionChip();
  updateStructureComponentsUi(); updateInfo(); draw();
  return targets;
}

function highlightStructureAtoms(atomIds) {
  const ids = [...new Set(atomIds)];
  state.emphasizedAtomIds = ids;
  const targets = state.molecule?.atoms.map((atom, index) => ({ atom, index }))
    .filter(({ atom, index }) => ids.includes(atom.designAtomId) && componentVisible(index)) || [];
  updateChangedRegionChip(); draw();
  return targets;
}

function setHighlightedStructureAtoms(atomIds, residueLabels = null) {
  if (residueLabels != null) state.focusedAtomResidueLabels = structuredClone(residueLabels);
  return highlightStructureAtoms(atomIds);
}

function focusedComponentContextIndices(molecule = state.molecule) {
  if (!molecule || !state.focusedComponentId) return null;
  const component = state.structureComponents.find((entry) => entry.id === state.focusedComponentId);
  if (!component || component.kind !== 'ligand') return null;
  const focused = new Set(component.atomIndices);
  const anchors = component.atomIndices.map((index) => molecule.atoms[index])
    .filter((atom) => atom && atom.element !== 'H');
  if (!anchors.length) return focused;
  const cutoffSquared = COMPONENT_FOCUS_CONTEXT_ANGSTROM ** 2;
  const nearbyResidues = new Set();
  const nearbyAtoms = new Set(component.atomIndices);
  molecule.atoms.forEach((atom, index) => {
    if (focused.has(index)) return;
    const near = anchors.some((anchor) => {
      const dx = atom.x - anchor.x, dy = atom.y - anchor.y, dz = atom.z - anchor.z;
      return dx * dx + dy * dy + dz * dz <= cutoffSquared;
    });
    if (!near) return;
    const atomComponent = state.structureComponents.find((entry) =>
      entry.id === state.atomComponentIds[index]);
    if (atomComponent?.kind === 'protein' || atomComponent?.kind === 'water')
      nearbyResidues.add(residueKey(atom));
    else nearbyAtoms.add(index);
  });
  molecule.atoms.forEach((atom, index) => {
    if (nearbyResidues.has(residueKey(atom))) nearbyAtoms.add(index);
  });
  labeledResiduePeptideContextIndices(molecule).forEach((index) => nearbyAtoms.add(index));
  return nearbyAtoms;
}

const PEPTIDE_CONTEXT_ATOM_NAMES = new Set(['N','CA','C','O','OXT']);

function labeledResiduePeptideContextIndices(molecule = state.molecule) {
  const indices = new Set();
  if (!molecule || !state.focusedAtomResidueLabels.length) return indices;
  for (const spec of state.focusedAtomResidueLabels) molecule.atoms.forEach((atom, index) => {
    if (!isProteinAtom(atom) || String(atom.chain || 'A') !== String(spec.chain || 'A')) return;
    const offset = Number(atom.residueIndex) - Number(spec.residueIndex);
    if (offset === 0 || Math.abs(offset) === 1 && PEPTIDE_CONTEXT_ATOM_NAMES.has(atom.atomName))
      indices.add(index);
  });
  return indices;
}

function focusStructureComponent(componentId, isolate = false) {
  const component = state.structureComponents.find((entry) => entry.id === componentId);
  if (!component) return;
  if (isolate) {
    state.structureComponents.forEach((entry) => state.componentVisibility.set(entry.id, entry.id === componentId));
  } else {
    state.componentVisibility.set(componentId, true);
  }
  const atoms = component.atomIndices.map((index) => state.molecule?.atoms?.[index]).filter(Boolean);
  if (!atoms.length) return;
  const center = atoms.reduce((sum, atom) => ({
    x:sum.x + atom.x, y:sum.y + atom.y, z:sum.z + atom.z,
  }), { x:0, y:0, z:0 });
  center.x /= atoms.length; center.y /= atoms.length; center.z /= atoms.length;
  const radius = Math.max(0, ...atoms.map((atom) =>
    Math.hypot(atom.x - center.x, atom.y - center.y, atom.z - center.z)));
  state.focusedComponentId = componentId;
  state.focusedComponentCenter = { ...center };
  // Leave a pocket-sized margin around a ligand. Fitting only its atomic
  // sphere makes the surrounding residues clip across the viewport.
  state.focusedComponentRadius = component.kind === 'ligand'
    ? Math.max(6, radius * 1.15 + 2.5) : Math.max(2.5, radius * 1.2);
  state.focusedResidueKey = null;
  state.focusedResidueRadius = null;
  clearFocusedAtomRegion();
  state.zoom = 1;
  state.viewPan = { x:0, y:0 };
  updateResidueFollowChip();
  updateStructureComponentsUi();
  updateInfo();
  draw();
}

function updateStructureComponentsUi() {
  const card = document.querySelector('#structure-components');
  if (!card) return;
  const relevant = Boolean(state.molecule?.source?.format === 'pdb' || state.molecule?.prediction);
  card.classList.toggle('hidden', !relevant);
  if (!relevant) return;
  setText('#component-summary', structureComponentSummary() || 'One molecular component');
  const list = document.querySelector('#component-list');
  list.replaceChildren();
  state.structureComponents.forEach((component) => {
    const row = document.createElement('div');
    row.className = `component-row${state.focusedComponentId === component.id ? ' focused' : ''}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.checked = state.componentVisibility.get(component.id) !== false;
    checkbox.setAttribute('aria-label', `Show ${component.label}`);
    checkbox.addEventListener('change', () => {
      const ordinal = state.structureComponents.filter((entry) =>
        entry.kind === component.kind).findIndex((entry) => entry.id === component.id);
      runChemistUiAction('view.setComponentVisibility', {
        kind:component.kind, ordinal, visible:checkbox.checked,
      }).catch(() => { checkbox.checked = !checkbox.checked; });
    });
    const swatch = document.createElement('i'); swatch.style.background = component.color;
    const copy = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = component.label;
    const detail = document.createElement('span');
    detail.textContent = `${component.atomIndices.length} atoms${component.description ? ` · ${component.description}` : ''}`;
    copy.append(title, detail);
    const actions = document.createElement('div'); actions.className = 'component-row-actions';
    const zoom = document.createElement('button'); zoom.type = 'button';
    zoom.dataset.componentAction = 'zoom';
    zoom.textContent = state.focusedComponentId === component.id ? 'Zoomed' : 'Zoom';
    zoom.setAttribute('aria-label', `Zoom to ${component.label} without hiding other components`);
    zoom.addEventListener('click', () => {
      const ordinal = state.structureComponents.filter((entry) =>
        entry.kind === component.kind).findIndex((entry) => entry.id === component.id);
      runChemistUiAction('view.focusComponent', {
        kind:component.kind, ordinal, isolate:false,
      });
    });
    const only = document.createElement('button'); only.type = 'button';
    only.dataset.componentAction = 'only'; only.textContent = 'Only';
    only.setAttribute('aria-label', `Show only ${component.label}`);
    only.addEventListener('click', () => {
      const ordinal = state.structureComponents.filter((entry) =>
        entry.kind === component.kind).findIndex((entry) => entry.id === component.id);
      runChemistUiAction('view.focusComponent', {
        kind:component.kind, ordinal, isolate:true,
      });
    });
    actions.append(zoom, only);
    row.append(checkbox, swatch, copy, actions); list.append(row);
  });
}

function waterResidueKey(atom) {
  return `${atom.chain || 'A'}:${atom.residueIndex}:${atom.insertionCode || ''}:${atom.residueName}`;
}

function selectCrucialCrystallographicWaters(molecule) {
  const groups = new Map();
  molecule.atoms.forEach((atom, index) => {
    if (!isWaterAtom(atom)) return;
    const key = waterResidueKey(atom);
    if (!groups.has(key)) groups.set(key, { key, atomIndices:[], oxygenIndex:null });
    const group = groups.get(key); group.atomIndices.push(index);
    if (atom.element === 'O') group.oxygenIndex = index;
  });
  const polarAtoms = molecule.atoms.map((atom, index) => ({ atom, index }))
    .filter(({ atom }) => !isWaterAtom(atom) && atom.element !== 'H'
      && ['N', 'O', 'S'].includes(atom.element));
  const retained = [];
  for (const group of groups.values()) {
    const oxygen = molecule.atoms[group.oxygenIndex];
    if (!oxygen) continue;
    const contacts = polarAtoms.flatMap(({ atom, index }) => {
      const distance = Math.hypot(oxygen.x - atom.x, oxygen.y - atom.y, oxygen.z - atom.z);
      if (distance < 2.2 || distance > 3.5) return [];
      return [{ index, distance, kind:isProteinAtom(atom) ? 'protein' : 'ligand',
        residue:`${atom.residueName || atom.element} ${atom.chain || 'A'}${atom.residueIndex ?? ''}${atom.insertionCode || ''}`,
        atomName:atom.atomName || atom.element }];
    });
    const ligandContacts = contacts.filter((contact) => contact.kind === 'ligand');
    const proteinContacts = contacts.filter((contact) => contact.kind === 'protein');
    const proteinResidues = new Set(proteinContacts.map((contact) => contact.residue));
    const occupancy = Number(oxygen.occupancy || 0);
    const occupancyAccepted = occupancy === 0 || occupancy >= 0.5;
    const ligandBridge = ligandContacts.length >= 1 && proteinContacts.length >= 1;
    const proteinNetwork = proteinContacts.length >= 3
      || (proteinContacts.length >= 2 && proteinResidues.size >= 2);
    if (!occupancyAccepted || (!ligandBridge && !proteinNetwork)) continue;
    retained.push({
      key:group.key, chain:oxygen.chain || 'A', residueIndex:oxygen.residueIndex,
      insertionCode:oxygen.insertionCode || '', residueName:oxygen.residueName,
      occupancy:occupancy || null,
      reason:ligandBridge ? 'ligand–protein bridge' : 'multi-residue protein polar network',
      ligandContacts:ligandContacts.length, proteinContacts:proteinContacts.length,
      contacts:contacts.map((contact) => ({ kind:contact.kind, residue:contact.residue,
        atomName:contact.atomName, distance:Number(contact.distance.toFixed(3)) })),
    });
  }
  return {
    examined:groups.size, retained,
    retainedKeys:new Set(retained.map((water) => water.key)),
    criteria:{ contactDistanceAngstrom:[2.2, 3.5], minimumOccupancy:0.5,
      unknownOccupancyAccepted:true,
      rules:['at least one ligand and one protein polar contact',
        'at least two protein polar contacts from distinct residues, or at least three protein polar contacts'] },
  };
}

function removePdbWaters(inputMolecule, retainedWaterKeys = new Set()) {
  const keep = inputMolecule.atoms.map((atom) => !isWaterAtom(atom)
    || retainedWaterKeys.has(waterResidueKey(atom)));
  const removed = keep.reduce((count, retained) => count + (retained ? 0 : 1), 0);
  if (!removed) return { molecule: structuredClone(inputMolecule), removed: 0 };
  const oldToNew = new Map();
  const atoms = [];
  inputMolecule.atoms.forEach((atom, index) => {
    if (!keep[index]) return;
    oldToNew.set(index, atoms.length);
    atoms.push(structuredClone(atom));
  });
  const bonds = inputMolecule.bonds
    .filter((bond) => keep[bond.a] && keep[bond.b])
    .map((bond) => ({ ...structuredClone(bond), a: oldToNew.get(bond.a), b: oldToNew.get(bond.b) }));
  const molecule = structuredClone(inputMolecule);
  molecule.atoms = atoms;
  molecule.bonds = bonds;
  molecule.source = { ...(molecule.source || {}), watersRemoved: removed,
    heterogenAtoms: atoms.filter((atom) => atom.record === 'HETATM').length };
  return { molecule, removed };
}

function deterministicUnitVector(seed) {
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  const z = ((value & 0xffff) / 0x7fff) - 1;
  const angle = (((value >>> 16) & 0xffff) / 0xffff) * Math.PI * 2;
  const radial = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: radial * Math.cos(angle), y: radial * Math.sin(angle), z };
}

function crossVector(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function perpendicularBasis(axis, seed) {
  const random = deterministicUnitVector(seed);
  let first = {
    x: random.x - axis.x * (random.x * axis.x + random.y * axis.y + random.z * axis.z),
    y: random.y - axis.y * (random.x * axis.x + random.y * axis.y + random.z * axis.z),
    z: random.z - axis.z * (random.x * axis.x + random.y * axis.y + random.z * axis.z),
  };
  if (Math.hypot(first.x, first.y, first.z) < 1e-5) {
    const helper = Math.abs(axis.z) < 0.8 ? { x:0, y:0, z:1 } : { x:0, y:1, z:0 };
    first = crossVector(axis, helper);
  }
  first = normaliseVector(first);
  return { first, second:normaliseVector(crossVector(axis, first)) };
}

function polarHydrogenAngle(parent) {
  if (parent.element === 'O') return 108.5 * Math.PI / 180;
  if (parent.element === 'S') return 96 * Math.PI / 180;
  return 109.47 * Math.PI / 180;
}

function directionOnBondCone(axis, first, second, angle, torsion) {
  const radial = {
    x:first.x * Math.cos(torsion) + second.x * Math.sin(torsion),
    y:first.y * Math.cos(torsion) + second.y * Math.sin(torsion),
    z:first.z * Math.cos(torsion) + second.z * Math.sin(torsion),
  };
  return normaliseVector({
    x:axis.x * Math.cos(angle) + radial.x * Math.sin(angle),
    y:axis.y * Math.cos(angle) + radial.y * Math.sin(angle),
    z:axis.z * Math.cos(angle) + radial.z * Math.sin(angle),
  });
}

function proteinHydrogenPosition(molecule, parentIndex, ordinal, count) {
  const parent = molecule.atoms[parentIndex];
  const neighborEntries = molecule.bonds
    .filter((bond) => bond.a === parentIndex || bond.b === parentIndex)
    .map((bond) => ({ index:bond.a === parentIndex ? bond.b : bond.a, order:Number(bond.order || 1) }))
    .filter(({ index }) => molecule.atoms[index].element !== 'H');
  const neighbors = neighborEntries.map(({ index }) => normaliseVector({
      x: molecule.atoms[index].x - parent.x,
      y: molecule.atoms[index].y - parent.y,
      z: molecule.atoms[index].z - parent.z,
    }));
  let axis = neighbors.reduce((sum, vector) => ({
    x: sum.x - vector.x, y: sum.y - vector.y, z: sum.z - vector.z,
  }), { x: 0, y: 0, z: 0 });
  if (Math.hypot(axis.x, axis.y, axis.z) < 1e-5)
    axis = deterministicUnitVector(`${parent.chain}:${parent.residueIndex}:${parent.atomName}`);
  axis = normaliseVector(axis);
  const neighborPlane = neighbors.length >= 2 ? crossVector(neighbors[0], neighbors[1]) : null;
  const helper = Math.abs(axis.z) < 0.8 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const first = neighborPlane && Math.hypot(neighborPlane.x, neighborPlane.y, neighborPlane.z) > 1e-5
    ? normaliseVector(neighborPlane) : normaliseVector(crossVector(axis, helper));
  const second = normaliseVector(crossVector(axis, first));
  let direction = axis;
  if (!neighbors.length && count === 4) {
    const pattern = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]][ordinal % 4];
    direction = normaliseVector({
      x:first.x * pattern[0] + second.x * pattern[1] + axis.x * pattern[2],
      y:first.y * pattern[0] + second.y * pattern[1] + axis.y * pattern[2],
      z:first.z * pattern[0] + second.z * pattern[1] + axis.z * pattern[2],
    });
  } else if (!neighbors.length && count === 3) {
    const torsion = ordinal / 3 * Math.PI * 2;
    direction = normaliseVector({
      x:axis.x / 3 + (first.x * Math.cos(torsion) + second.x * Math.sin(torsion)) * Math.sqrt(8) / 3,
      y:axis.y / 3 + (first.y * Math.cos(torsion) + second.y * Math.sin(torsion)) * Math.sqrt(8) / 3,
      z:axis.z / 3 + (first.z * Math.cos(torsion) + second.z * Math.sin(torsion)) * Math.sqrt(8) / 3,
    });
  } else if (!neighbors.length && count === 2) {
    const angle = (parent.element === 'O' ? 104.52 : 109.4712206) * Math.PI / 360;
    const sign = ordinal ? -1 : 1;
    direction = normaliseVector({
      x:axis.x * Math.cos(angle) + first.x * Math.sin(angle) * sign,
      y:axis.y * Math.cos(angle) + first.y * Math.sin(angle) * sign,
      z:axis.z * Math.cos(angle) + first.z * Math.sin(angle) * sign,
    });
  } else if (count === 1 && neighbors.length === 1 && ['O', 'S'].includes(parent.element)) {
    // A one-neighbour hydroxyl/thiol is bent, not anti-collinear.  Its torsion is
    // refined against the local H-bond network after all hydrogens are present.
    const basis = perpendicularBasis(neighbors[0],
      `${parent.chain}:${parent.residueIndex}:${parent.atomName}:polar`);
    direction = directionOnBondCone(neighbors[0], basis.first, basis.second,
      polarHydrogenAngle(parent), 0);
  } else if (count === 1 && neighbors.length === 1 && parent.element === 'N'
    && neighborEntries[0].order > 1.1) {
    const basis = perpendicularBasis(neighbors[0],
      `${parent.chain}:${parent.residueIndex}:${parent.atomName}:imine`);
    direction = directionOnBondCone(neighbors[0], basis.first, basis.second,
      120 * Math.PI / 180, 0);
  } else if (neighbors.length === 1 && count >= 2) {
    const basis = perpendicularBasis(neighbors[0],
      `${parent.chain}:${parent.residueIndex}:${parent.atomName}:tetrahedral`);
    direction = directionOnBondCone(neighbors[0], basis.first, basis.second,
      109.4712206 * Math.PI / 180, ordinal / count * Math.PI * 2);
  } else if (count === 2) {
    const sign = ordinal ? -1 : 1;
    direction = normaliseVector({ x: axis.x * 0.57735 + first.x * 0.81650 * sign,
      y: axis.y * 0.57735 + first.y * 0.81650 * sign, z: axis.z * 0.57735 + first.z * 0.81650 * sign });
  } else if (count >= 3) {
    const angle = ordinal / count * Math.PI * 2;
    direction = normaliseVector({
      x: axis.x * 0.34 + (first.x * Math.cos(angle) + second.x * Math.sin(angle)) * 0.94,
      y: axis.y * 0.34 + (first.y * Math.cos(angle) + second.y * Math.sin(angle)) * 0.94,
      z: axis.z * 0.34 + (first.z * Math.cos(angle) + second.z * Math.sin(angle)) * 0.94,
    });
  }
  const length = parent.element === 'O' ? 0.98 : parent.element === 'S' ? 1.34 : parent.element === 'N' ? 1.01 : 1.09;
  return { x: parent.x + direction.x * length, y: parent.y + direction.y * length, z: parent.z + direction.z * length };
}

function atomResidueIdentity(atom) {
  return `${atom.chain || ''}:${atom.residueIndex ?? ''}:${atom.insertionCode || ''}:${atom.residueName || ''}`;
}

function polarHydrogenDiagnostics(molecule) {
  const adjacency = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond) => {
    adjacency[bond.a].push(bond.b); adjacency[bond.b].push(bond.a);
  });
  const angles = [];
  molecule.atoms.forEach((hydrogen, hydrogenIndex) => {
    if (hydrogen.element !== 'H') return;
    const donorIndex = adjacency[hydrogenIndex].find((index) => ['O', 'S'].includes(molecule.atoms[index].element));
    if (donorIndex === undefined) return;
    const heavy = adjacency[donorIndex].filter((index) => molecule.atoms[index].element !== 'H');
    const hydrogens = adjacency[donorIndex].filter((index) => molecule.atoms[index].element === 'H');
    if (heavy.length !== 1 || hydrogens.length !== 1) return;
    const donor = molecule.atoms[donorIndex], anchor = molecule.atoms[heavy[0]];
    const first = normaliseVector({ x:anchor.x - donor.x, y:anchor.y - donor.y, z:anchor.z - donor.z });
    const second = normaliseVector({ x:hydrogen.x - donor.x, y:hydrogen.y - donor.y, z:hydrogen.z - donor.z });
    const degrees = Math.acos(Math.max(-1, Math.min(1,
      first.x * second.x + first.y * second.y + first.z * second.z))) * 180 / Math.PI;
    angles.push({ hydrogen:hydrogenIndex, donor:donorIndex, anchor:heavy[0], degrees });
  });
  return {
    count:angles.length,
    linear:angles.filter((entry) => entry.degrees > 170).length,
    minimumAngle:angles.length ? Math.min(...angles.map((entry) => entry.degrees)) : null,
    maximumAngle:angles.length ? Math.max(...angles.map((entry) => entry.degrees)) : null,
    angles,
  };
}

function relaxPreparationPolarHydrogens(molecule, targetHydrogenIndices = null) {
  const started = performance.now();
  const targetHydrogens = targetHydrogenIndices == null ? null : new Set(targetHydrogenIndices);
  const adjacency = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond) => {
    adjacency[bond.a].push(bond.b); adjacency[bond.b].push(bond.a);
  });
  const acceptor = molecule.atoms.map((atom, index) => {
    if (Number(atom.formalCharge ?? atom.charge ?? 0) > 0) return false;
    if (['O', 'S', 'F'].includes(atom.element)) return true;
    return atom.element === 'N' && adjacency[index].length < 4
      && !adjacency[index].some((neighbor) => molecule.atoms[neighbor].element === 'H');
  });
  const cellSize = 3.2;
  const cellKey = (atom) => `${Math.floor(atom.x / cellSize)}:${Math.floor(atom.y / cellSize)}:${Math.floor(atom.z / cellSize)}`;
  const cells = new Map();
  molecule.atoms.forEach((atom, index) => {
    const key = cellKey(atom);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(index);
  });
  const nearbyAtoms = (position) => {
    const x = Math.floor(position.x / cellSize), y = Math.floor(position.y / cellSize), z = Math.floor(position.z / cellSize);
    const result = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++)
      result.push(...(cells.get(`${x + dx}:${y + dy}:${z + dz}`) || []));
    return result;
  };
  let moved = 0, hydrogenBonded = 0;
  const rotatable = [];
  molecule.atoms.forEach((hydrogen, hydrogenIndex) => {
    if (hydrogen.element !== 'H' || !hydrogen.prepared
      || (targetHydrogens && !targetHydrogens.has(hydrogenIndex))) return;
    const donorIndex = adjacency[hydrogenIndex].find((index) => ['O', 'S'].includes(molecule.atoms[index].element));
    if (donorIndex === undefined) return;
    const heavy = adjacency[donorIndex].filter((index) => molecule.atoms[index].element !== 'H');
    const donorHydrogens = adjacency[donorIndex].filter((index) => molecule.atoms[index].element === 'H');
    if (heavy.length !== 1 || donorHydrogens.length !== 1) return;
    const donor = molecule.atoms[donorIndex], anchorIndex = heavy[0], anchor = molecule.atoms[anchorIndex];
    const axis = normaliseVector({ x:anchor.x - donor.x, y:anchor.y - donor.y, z:anchor.z - donor.z });
    const basis = perpendicularBasis(axis,
      `${donor.chain}:${donor.residueIndex}:${donor.atomName}:network`);
    const targetAngle = polarHydrogenAngle(donor);
    const length = donor.element === 'S' ? 1.34 : 0.98;
    let best = null;
    for (let ordinal = 0; ordinal < 24; ordinal++) {
      const direction = directionOnBondCone(axis, basis.first, basis.second,
        targetAngle, ordinal * Math.PI * 2 / 24);
      const position = { x:donor.x + direction.x * length,
        y:donor.y + direction.y * length, z:donor.z + direction.z * length };
      let score = ordinal * 1e-8, contact = false;
      for (const atomIndex of nearbyAtoms(position)) {
        if (atomIndex === hydrogenIndex || atomIndex === donorIndex || atomIndex === anchorIndex) continue;
        const atom = molecule.atoms[atomIndex];
        const dx = atom.x - position.x, dy = atom.y - position.y, dz = atom.z - position.z;
        const distance = Math.hypot(dx, dy, dz) || 1e-6;
        let goodHydrogenBond = false;
        if (acceptor[atomIndex] && atomResidueIdentity(atom) !== atomResidueIdentity(donor)
          && distance >= 1.25 && distance <= 2.8) {
          const cosine = (-direction.x * dx - direction.y * dy - direction.z * dz) / distance;
          if (cosine <= -0.70710678) {
            const distanceQuality = Math.max(0, 1 - Math.abs(distance - 1.9) / 0.9);
            const angleQuality = Math.max(0, (-cosine - 0.70710678) / (1 - 0.70710678));
            score -= 18 * distanceQuality * (0.35 + 0.65 * angleQuality);
            goodHydrogenBond = true; contact = true;
          }
        }
        const contactDistance = goodHydrogenBond ? 1.2
          : atom.element === 'H' ? 1.45 : atom.element === 'C' ? 1.72 : 1.55;
        if (distance < contactDistance) score += 55 * (contactDistance - distance) ** 2;
        if (distance < 0.8) score += 250 * (0.8 - distance) ** 2;
      }
      if (!best || score < best.score) best = { score, position, contact };
    }
    const displacement = Math.hypot(hydrogen.x - best.position.x,
      hydrogen.y - best.position.y, hydrogen.z - best.position.z);
    const previousCell = cells.get(cellKey(hydrogen));
    if (previousCell) {
      const position = previousCell.indexOf(hydrogenIndex);
      if (position >= 0) previousCell.splice(position, 1);
    }
    hydrogen.x = best.position.x; hydrogen.y = best.position.y; hydrogen.z = best.position.z;
    const nextCellKey = cellKey(hydrogen);
    if (!cells.has(nextCellKey)) cells.set(nextCellKey, []);
    cells.get(nextCellKey).push(hydrogenIndex);
    const bond = molecule.bonds.find((entry) => (entry.a === donorIndex && entry.b === hydrogenIndex)
      || (entry.b === donorIndex && entry.a === hydrogenIndex));
    if (bond) bond.distance = length;
    if (displacement > 1e-4) moved += 1;
    if (best.contact) hydrogenBonded += 1;
    rotatable.push(hydrogenIndex);
  });
  const diagnostics = polarHydrogenDiagnostics(molecule);
  return { rotatableHydrogens:rotatable.length, moved, hydrogenBonded,
    elapsedMs:performance.now() - started,
    minimumAngle:diagnostics.minimumAngle, maximumAngle:diagnostics.maximumAngle,
    linearHydrogens:diagnostics.linear };
}

function histidineProtonationVariant(molecule, residue, atomByResidueAndName, options) {
  const requested = String(options.histidine || 'auto').toUpperCase();
  if (['HID', 'HIE', 'HIP'].includes(requested)) return requested;
  if (options.pH <= 6.0) return 'HIP';
  const score = (atomName) => {
    const parentIndex = atomByResidueAndName.get(`${residue.key}:${atomName}`);
    if (parentIndex === undefined) return -Infinity;
    const position = proteinHydrogenPosition(molecule, parentIndex, 0, 1);
    return molecule.atoms.reduce((sum, atom, index) => {
      if (index === parentIndex || atom.element === 'H'
        || (atom.chain === residue.chain && atom.residueIndex === residue.residueIndex
          && (atom.insertionCode || '') === residue.insertionCode)) return sum;
      if (!['O', 'N', 'S'].includes(atom.element) || Number(atom.charge || 0) > 0) return sum;
      const distance = Math.hypot(position.x - atom.x, position.y - atom.y, position.z - atom.z);
      return distance > 1.4 && distance < 3.5 ? sum + (3.5 - distance) : sum;
    }, 0);
  };
  return score('NE2') > score('ND1') ? 'HIE' : 'HID';
}

function addStandardProteinHydrogens(inputMolecule, options = {}) {
  const settings = { pH: Math.max(0, Math.min(14, Number(options.pH ?? 7.4))),
    histidine: String(options.histidine || 'auto').toLowerCase(),
    gapPolicy: options.gapPolicy === 'block' ? 'block' : 'cap' };
  const removedProteinHydrogens = inputMolecule.atoms.filter((atom) => atom.element === 'H' && isProteinAtom(atom)).length;
  const molecule = moleculeWithAtomsRemoved(inputMolecule,
    (atom) => atom.element === 'H' && isProteinAtom(atom));
  delete molecule.parameterization;
  const report = proteinPreparationReport(molecule);
  const canAddHydrogens = Boolean(report.residues) && !report.unknownResidues.length
    && !report.missingHeavyAtoms.length && (!report.internalMissingResidues.length || settings.gapPolicy === 'cap');
  if (!canAddHydrogens) {
    const reasons = [];
    if (report.unknownResidues.length) reasons.push(`unsupported residues: ${report.unknownResidues.slice(0, 4).join(', ')}`);
    if (report.missingHeavyAtoms.length) reasons.push(`missing heavy atoms: ${report.missingHeavyAtoms.slice(0, 6).join(', ')}`);
    if (report.internalMissingResidues.length) reasons.push(`${report.internalMissingResidues.length} unresolved internal residues`);
    throw new Error(`Conservative PDB preparation stopped; ${reasons.join('; ')}. Missing heavy atoms are never fabricated.`);
  }
  const residues = proteinResidues(molecule);
  const segments = proteinSegments(molecule);
  const firstResidues = new Set(segments.map((segment) => segment[0].key));
  const lastResidues = new Set(segments.map((segment) => segment.at(-1).key));
  const atomByResidueAndName = new Map();
  residues.forEach((residue) => residue.atoms.forEach((index) => {
    atomByResidueAndName.set(`${residue.key}:${molecule.atoms[index].atomName}`, index);
  }));
  const bondedHydrogens = (parentIndex) => molecule.bonds
    .filter((bond) => bond.a === parentIndex || bond.b === parentIndex)
    .map((bond) => bond.a === parentIndex ? bond.b : bond.a)
    .filter((index) => molecule.atoms[index].element === 'H').length;
  let added = 0;
  const addTarget = (residue, atomName, target) => {
    const parentIndex = atomByResidueAndName.get(`${residue.key}:${atomName}`);
    if (parentIndex === undefined) return;
    if (residue.residueName === 'CYS' && atomName === 'SG') {
      const disulfide = molecule.bonds.some((bond) => {
        if (bond.a !== parentIndex && bond.b !== parentIndex) return false;
        const other = molecule.atoms[bond.a === parentIndex ? bond.b : bond.a];
        return other.element === 'S' && other.residueIndex !== residue.residueIndex;
      });
      if (disulfide) target = 0;
    }
    const existing = bondedHydrogens(parentIndex);
    const count = Math.max(0, target - existing);
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const parent = molecule.atoms[parentIndex];
      const position = proteinHydrogenPosition(molecule, parentIndex, ordinal, count);
      const hydrogenIndex = molecule.atoms.length;
      molecule.atoms.push({
        element: 'H', ...position, record: 'ATOM', atomName: `H${atomName}${existing + ordinal + 1}`.slice(0, 4),
        residueName: parent.residueName, chain: parent.chain, residueIndex: parent.residueIndex,
        insertionCode: parent.insertionCode || '', charge: 0, prepared: true,
      });
      molecule.bonds.push({ a: parentIndex, b: hydrogenIndex, order: 1, distance: Math.hypot(
        parent.x - position.x, parent.y - position.y, parent.z - position.z), topology: 'prepared protein hydrogen' });
      added += 1;
    }
  };
  const variants = {};
  residues.forEach((residue) => {
    const first = firstResidues.has(residue.key);
    const terminalProtonated = settings.pH < 8.0;
    addTarget(residue, 'N', first ? (residue.residueName === 'PRO'
      ? (terminalProtonated ? 2 : 1) : (terminalProtonated ? 3 : 2))
      : (residue.residueName === 'PRO' ? 0 : 1));
    addTarget(residue, 'CA', residue.residueName === 'GLY' ? 2 : 1);
    const targets = { ...PROTEIN_SIDECHAIN_HYDROGENS[residue.residueName] };
    if (residue.residueName === 'ASP') targets.OD2 = settings.pH < 3.9 ? 1 : 0;
    if (residue.residueName === 'GLU') targets.OE2 = settings.pH < 4.2 ? 1 : 0;
    if (residue.residueName === 'CYS') targets.SG = settings.pH < 8.3 ? 1 : 0;
    if (residue.residueName === 'TYR') targets.OH = settings.pH < 10.1 ? 1 : 0;
    if (residue.residueName === 'LYS') targets.NZ = settings.pH < 10.5 ? 3 : 2;
    if (residue.residueName === 'ARG' && settings.pH >= 12.5) targets.NH2 = 1;
    if (residue.residueName === 'HIS') {
      const variant = histidineProtonationVariant(molecule, residue, atomByResidueAndName, settings);
      variants[residue.key] = variant;
      targets.ND1 = variant === 'HID' || variant === 'HIP' ? 1 : 0;
      targets.NE2 = variant === 'HIE' || variant === 'HIP' ? 1 : 0;
    }
    if (lastResidues.has(residue.key)) targets.OXT = settings.pH < 3.1 ? 1 : 0;
    Object.entries(targets).forEach(([atomName, target]) => addTarget(residue, atomName, target));
  });

  const setCharge = (residue, atomName, charge) => {
    const index = atomByResidueAndName.get(`${residue.key}:${atomName}`);
    if (index !== undefined) molecule.atoms[index].charge = charge;
  };
  residues.forEach((residue) => {
    residue.atoms.forEach((index) => { molecule.atoms[index].charge = 0; });
    if (firstResidues.has(residue.key) && settings.pH < 8.0) setCharge(residue, 'N', 1);
    if (residue.residueName === 'LYS' && settings.pH < 10.5) setCharge(residue, 'NZ', 1);
    if (residue.residueName === 'ARG' && settings.pH < 12.5) setCharge(residue, 'NH2', 1);
    if (residue.residueName === 'ASP' && settings.pH >= 3.9) setCharge(residue, 'OD2', -1);
    if (residue.residueName === 'GLU' && settings.pH >= 4.2) setCharge(residue, 'OE2', -1);
    if (residue.residueName === 'CYS' && settings.pH >= 8.3) setCharge(residue, 'SG', -1);
    if (residue.residueName === 'TYR' && settings.pH >= 10.1) setCharge(residue, 'OH', -1);
    if (residue.residueName === 'HIS' && variants[residue.key] === 'HIP') setCharge(residue, 'NE2', 1);
    if (residue.residueName === 'TPO') {
      setCharge(residue, 'O2P', -1); setCharge(residue, 'O3P', -1);
    }
    if (lastResidues.has(residue.key) && settings.pH >= 3.1
      && atomByResidueAndName.has(`${residue.key}:OXT`)) setCharge(residue, 'OXT', -1);
  });
  molecule.charge = molecule.atoms.reduce((sum, atom) => sum + Number(atom.charge || 0), 0);
  molecule.preparation = { ...(molecule.preparation || {}), status: 'hydrogenated', hydrogensAdded: added,
    hydrogensReplaced: removedProteinHydrogens, pH: settings.pH, histidinePolicy: settings.histidine,
    histidineVariants: variants, protonation: `dominant-state rules at pH ${settings.pH.toFixed(1)}`,
    parameterized: false };
  return { molecule, report: { ...report, hydrogensAdded: added, hydrogensReplaced: removedProteinHydrogens,
    charge: molecule.charge, pH: settings.pH, histidineVariants: variants } };
}

function normalizePdbPreparationOptions(options = {}) {
  return {
    pH: Math.max(0, Math.min(14, Number(options.pH ?? 7.4))),
    histidine: ['auto', 'hid', 'hie', 'hip'].includes(String(options.histidine || '').toLowerCase())
      ? String(options.histidine).toLowerCase() : 'auto',
    repairMissingHeavy: options.repairMissingHeavy !== false,
    ligandPolicy: ['ccd', 'registered', 'exclude'].includes(options.ligandPolicy)
      ? options.ligandPolicy : 'ccd',
    waterPolicy: ['crucial', 'retain', 'exclude'].includes(options.waterPolicy)
      ? options.waterPolicy : 'crucial',
    gapPolicy: options.gapPolicy === 'block' ? 'block' : 'cap',
  };
}

function pdbPreparationOptionsFromUi() {
  return normalizePdbPreparationOptions({
    pH: document.querySelector('#preparation-ph')?.value,
    histidine: document.querySelector('#preparation-histidine')?.value,
    repairMissingHeavy: document.querySelector('#preparation-repair-heavy')?.checked,
    ligandPolicy: document.querySelector('#preparation-ligands')?.value,
    waterPolicy: document.querySelector('#preparation-waters')?.value,
    gapPolicy: document.querySelector('#preparation-gaps')?.value,
  });
}

function pdbPreparationFingerprint(molecule, options) {
  return JSON.stringify({ atoms: molecule.atoms.map((atom) => [atom.atomName, atom.residueName, atom.chain,
    atom.residueIndex, atom.insertionCode || '', atom.element, atom.x, atom.y, atom.z]), options });
}

function preparationGeometryAudit(molecule) {
  const invalidAtoms = molecule.atoms.filter((atom) => ![atom.x, atom.y, atom.z].every(Number.isFinite)).length;
  const invalidBonds = molecule.bonds.filter((bond) => !molecule.atoms[bond.a] || !molecule.atoms[bond.b]).length;
  const bonded = new Set(molecule.bonds.map((bond) => bond.a < bond.b ? `${bond.a}:${bond.b}` : `${bond.b}:${bond.a}`));
  const minimum = { heavy: Infinity, generated: Infinity };
  const pairs = { heavy: null, generated: null };
  const generated = molecule.atoms.map((atom, index) => ({ atom, index }))
    .filter(({ atom }) => atom.modeled || atom.prepared);
  const labelPair = (first, second) => [first, second].map((atomIndex) => {
    const entry = molecule.atoms[atomIndex];
    return `${entry.atomName || entry.element}:${entry.residueName || 'MOL'}:${entry.chain || 'A'}${entry.residueIndex ?? ''}${entry.insertionCode || ''}`;
  });
  for (const { atom, index } of generated) molecule.atoms.forEach((other, otherIndex) => {
    if (otherIndex === index || (molecule.atoms[otherIndex].modeled || molecule.atoms[otherIndex].prepared) && otherIndex < index) return;
    const key = index < otherIndex ? `${index}:${otherIndex}` : `${otherIndex}:${index}`;
    if (bonded.has(key)) return;
    const distance = Math.hypot(atom.x - other.x, atom.y - other.y, atom.z - other.z);
    if (distance < minimum.generated) { minimum.generated = distance; pairs.generated = labelPair(index, otherIndex); }
    if (atom.element !== 'H' && other.element !== 'H' && distance < minimum.heavy) {
      minimum.heavy = distance; pairs.heavy = labelPair(index, otherIndex);
    }
  });
  return { invalidAtoms, invalidBonds,
    modeledHeavyAtoms: generated.filter(({ atom }) => atom.modeled && atom.element !== 'H').length,
    generatedAtoms: generated.length,
    minimumModeledNonbondedDistance: Number.isFinite(minimum.heavy) ? minimum.heavy : null,
    minimumModeledPair: pairs.heavy,
    minimumGeneratedNonbondedDistance: Number.isFinite(minimum.generated) ? minimum.generated : null,
    minimumGeneratedPair: pairs.generated,
    severeModeledClash: minimum.heavy < 1.0,
    severeGeneratedClash: minimum.generated < 0.55 };
}

async function createPdbPreparationPreview(inputMolecule, rawOptions = {}, suppliedCcdDefinitions = null) {
  const options = normalizePdbPreparationOptions(rawOptions);
  let molecule = structuredClone(inputMolecule);
  delete molecule.parameterization;
  const inputReport = proteinPreparationReport(molecule);
  const actions = [], blockers = [], warnings = [];

  if (options.repairMissingHeavy && inputReport.missingHeavyAtoms.length) {
    const repair = repairCanonicalHeavyAtoms(molecule); molecule = repair.molecule;
    actions.push({ action: 'repair-heavy-atoms', added: repair.repaired.length,
      rotamersOptimized: repair.rotamers.length,
      source: 'PDBFixer 1.12 canonical residue coordinate templates' });
    if (repair.unresolved.length) blockers.push(`${repair.unresolved.length} missing backbone or unsupported heavy atoms cannot be template-repaired`);
  } else if (inputReport.missingHeavyAtoms.length) {
    blockers.push(`${inputReport.missingHeavyAtoms.length} missing heavy atoms were left unresolved by user choice`);
  }

  if (options.ligandPolicy === 'exclude') {
    const before = molecule.atoms.length;
    molecule = moleculeWithAtomsRemoved(molecule, (atom) => atom.record === 'HETATM' && !isWaterAtom(atom));
    actions.push({ action: 'exclude-heterogens', atomsRemoved: before - molecule.atoms.length });
  } else if (options.ligandPolicy === 'registered') {
    const registration = molecule.source?.registeredLigandGraph;
    const locator = registration?.locator;
    const definition = registration?.definition;
    if (!locator || !definition || !registration.graphSha256) {
      blockers.push('Registered-ligand preparation requires a hash-pinned graph installed through ligand.installRegisteredGraph');
    } else {
      try {
        const actualGraphSha256 = await sha256Hex(new TextEncoder().encode(
          serializeRegisteredLigandDefinition(definition)));
        if (actualGraphSha256 !== registration.graphSha256)
          throw new Error('stored definition does not match its registered graph hash');
        molecule = applyRegisteredLigandDefinition(molecule, {
          locator, residueName:locator.residueName, definition,
        }).molecule;
        const before = molecule.atoms.length;
        molecule = moleculeWithAtomsRemoved(molecule, (atom) => atom.record === 'HETATM'
          && !isWaterAtom(atom) && !(String(atom.residueName || '').trim().toUpperCase()
            === locator.residueName && String(atom.chain || 'A') === locator.chain
            && Number(atom.residueIndex || 0) === locator.residueIndex
            && String(atom.insertionCode || '') === locator.insertionCode));
        actions.push({ action:'exclude-unregistered-heterogens',
          atomsRemoved:before - molecule.atoms.length,
          retained:{ ...structuredClone(locator), graphSha256:registration.graphSha256 } });
        const result = prepareLigandsFromCcdDefinitions(molecule, {
          [locator.residueName]:structuredClone(definition),
        });
        molecule = result.molecule;
        actions.push({ action:'prepare-ligands-from-registered-graph',
          graphSha256:registration.graphSha256, components:result.prepared });
      } catch (error) {
        blockers.push(`Registered ligand preparation failed: ${error.message}`);
      }
    }
  } else {
    const ligandGroups = proteinPreparationReport(molecule).ligandGroups.filter((group) => group.heavyAtoms > 1);
    if (ligandGroups.length) {
      try {
        const result = suppliedCcdDefinitions
          ? prepareLigandsFromCcdDefinitions(molecule, suppliedCcdDefinitions)
          : await preparePdbLigands(molecule);
        molecule = result.molecule;
        actions.push({ action: 'prepare-ligands-from-ccd', components: result.prepared });
      } catch (error) {
        blockers.push(`Ligand CCD preparation failed: ${error.message}`);
      }
    }
  }

  if (options.waterPolicy === 'exclude') {
    const result = removePdbWaters(molecule); molecule = result.molecule;
    actions.push({ action: 'exclude-crystallographic-water', atomsRemoved: result.removed });
  } else if (options.waterPolicy === 'crucial') {
    const selection = selectCrucialCrystallographicWaters(molecule);
    const filtered = removePdbWaters(molecule, selection.retainedKeys); molecule = filtered.molecule;
    const result = addCrystallographicWaterHydrogens(molecule); molecule = result.molecule;
    actions.push({ action: 'retain-crucial-crystallographic-water',
      watersExamined:selection.examined, watersRetained:selection.retained.length,
      watersRemoved:selection.examined - selection.retained.length,
      atomsRemoved:filtered.removed, hydrogensAdded:result.added,
      criteria:selection.criteria, retained:selection.retained });
  } else {
    const result = addCrystallographicWaterHydrogens(molecule); molecule = result.molecule;
    actions.push({ action: 'retain-crystallographic-water', hydrogensAdded: result.added });
  }

  const afterRepair = proteinPreparationReport(molecule);
  if (afterRepair.unknownResidues.length) blockers.push(`${afterRepair.unknownResidues.length} unsupported protein residues remain`);
  if (afterRepair.missingHeavyAtoms.length) blockers.push(`${afterRepair.missingHeavyAtoms.length} missing modeled-residue heavy atoms remain`);
  if (afterRepair.unpreparedLigands.length) blockers.push(`${afterRepair.unpreparedLigands.length} ligands remain chemically incomplete`);
  if (afterRepair.internalMissingResidues.length && options.gapPolicy === 'block')
    blockers.push(`${afterRepair.internalMissingResidues.length} internal missing residues require loop modeling or explicit chain capping`);
  else if (afterRepair.internalMissingResidues.length) {
    warnings.push(`${afterRepair.internalMissingResidues.length} internal missing residues remain omitted; resolved segments were explicitly capped as separate chains`);
    actions.push({ action: 'accept-chain-breaks', missingResidues: afterRepair.internalMissingResidues.length,
      policy: 'cap-resolved-segments' });
  }
  const terminalMissing = afterRepair.missingResidues.length - afterRepair.internalMissingResidues.length;
  if (terminalMissing) warnings.push(`${terminalMissing} unmodeled terminal residues remain omitted`);

  if (!blockers.length && afterRepair.residues) {
    const terminal = addMissingTerminalOxygens(molecule); molecule = terminal.molecule;
    actions.push({ action: 'restore-terminal-oxygen', added: terminal.added.length });
    const hydrogenated = addStandardProteinHydrogens(molecule, options); molecule = hydrogenated.molecule;
    actions.push({ action: 'rebuild-protein-hydrogens', added: hydrogenated.report.hydrogensAdded,
      replaced: hydrogenated.report.hydrogensReplaced, pH: options.pH,
      histidinePolicy: options.histidine, histidineVariants: hydrogenated.report.histidineVariants });
    const hydrogenRelaxation = relaxPreparationPolarHydrogens(molecule);
    actions.push({ action: 'relax-polar-hydrogens', ...hydrogenRelaxation,
      method: 'fixed-heavy-atom 24-state torsion scan with local clash and H-bond scoring' });
  }

  const geometry = preparationGeometryAudit(molecule);
  if (geometry.invalidAtoms || geometry.invalidBonds) blockers.push('Prepared topology contains invalid coordinates or bond indices');
  if (geometry.severeModeledClash) blockers.push(`A modeled atom has a severe ${geometry.minimumModeledNonbondedDistance.toFixed(3)} Å nonbonded clash`);
  if (geometry.severeGeneratedClash && !geometry.severeModeledClash)
    blockers.push(`A generated atom has a severe ${geometry.minimumGeneratedNonbondedDistance.toFixed(3)} Å nonbonded clash`);
  const outputReport = proteinPreparationReport(molecule);
  const audit = {
    schema: 1, engine: 'Molarium browser protein preparation 0.4',
    references: {
      residueTemplates: 'PDBFixer 1.12 / MIT',
      ligandChemistry: options.ligandPolicy === 'registered'
        ? `hash-pinned registered graph ${molecule.source?.registeredLigandGraph?.graphSha256 || '(missing)'}`
        : options.ligandPolicy === 'ccd' ? 'RCSB Chemical Component Dictionary' : 'excluded',
      numericParameters: 'OpenFF Sage 2.1.0 with explicitly labelled RDKit Gasteiger charges',
      parameterizationScope: 'Experimental whole-system small-molecule-style assignment; not a validated protein force field',
    },
    input: { name: inputMolecule.name, pdbId: inputMolecule.source?.pdbId || null,
      atoms: inputMolecule.atoms.length, residues: inputReport.residues,
      missingResidues: inputReport.missingResidues.length, missingHeavyAtoms: inputReport.missingHeavyAtoms.length,
      ligands: inputReport.ligandGroups.map((group) => group.residueName),
      crystallographicWaterAtoms:inputReport.waterAtoms,
      crystallographicWaters:inputReport.waterResidues },
    options, actions, warnings, blockers, geometry,
    output: { atoms: molecule.atoms.length, residues: outputReport.residues, charge: molecule.charge,
      missingHeavyAtoms: outputReport.missingHeavyAtoms.length,
      crystallographicWaterAtoms:outputReport.waterAtoms,
      crystallographicWaters:outputReport.waterResidues,
      hydrogens: outputReport.hydrogens, readyForExperimentalParameterization: blockers.length === 0,
      readyForProductionSimulation: false },
  };
  molecule.preparation = { ...(molecule.preparation || {}), status: blockers.length ? 'blocked' : 'preview',
    parameterized: false, pH: options.pH, audit };
  molecule.prediction = molecule.prediction ? { ...molecule.prediction, pdb: proteinMoleculeToPdb(molecule) } : null;
  return { molecule, audit, report: outputReport, options,
    fingerprint: pdbPreparationFingerprint(inputMolecule, options) };
}

function downloadCurrentPreparationAudit() {
  const audit = state.pdbPreparationPreview?.audit || state.molecule?.preparation?.audit;
  if (!audit) return showToast('Preview or prepare the structure first');
  const identity = state.molecule?.source?.pdbId || state.molecule?.name || 'structure';
  downloadBlob(`${JSON.stringify(audit, null, 2)}\n`, `${slug(identity)}-preparation-report.json`, 'application/json');
  showToast('Preparation report downloaded');
}

function composition(atoms) {
  const counts = {};
  for (const atom of atoms) counts[atom.element] = (counts[atom.element] || 0) + 1;
  const order = ['C', 'H', ...Object.keys(counts).filter((k) => k !== 'C' && k !== 'H').sort()];
  const formula = order.filter((k) => counts[k]).map((k) => `${k}${counts[k] > 1 ? toSubscript(counts[k]) : ''}`).join('');
  const words = order.filter((k) => counts[k]).map((k) => `${k} ${counts[k]}`).join(', ');
  return { counts, formula, words };
}

function toSubscript(value) { return String(value).replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[d]); }

function loadMolecule(molecule, resetView = true) {
  if (!state.calculating) clearCalculationResult();
  state.chemistryTransaction = null;
  state.chemistryEditFinishing = false;
  const protonationInput = ligandProtonationInput(molecule);
  if (!protonationInput || state.ligandProtonation?.inputSmiles !== protonationInput) {
    state.ligandProtonation = null;
    state.ligandProtonationSequence++;
    state.protonatingLigand = false;
  }
  state.molecule = molecule;
  state.depictionPinnedLigand = molecule.source?.registeredLigandGraph?.locator
    ? structuredClone(molecule.source.registeredLigandGraph.locator) : null;
  state.chemistActionAudit = structuredClone(molecule.source?.chemistActionAudit || []);
  state.dockingReference = null;
  state.dockingResult = null;
  state.dockingRunning = false;
  state.dockingSelectedHbondIds = new Set();
  state.dockingContactRemaps = new Map();
  state.dockingContactRemapProposals = new Map();
  state.dockingContactDraft = null;
  state.dockingPoseIndex = 0;
  state.sidechainRotamerEnsemble = null;
  document.querySelector('#docking-edit-cleanup').value = 'preserve-reference';
  state.pdbPreparationPreview = null;
  state.focusedResidueKey = null;
  state.focusedResidueRadius = null;
  clearFocusedAtomRegion();
  state.selectedAtom = null;
  state.selectedAtoms = [];
  delete document.querySelector('#build-optimizer-select').dataset.userSelected;
  resetStructureComponents(molecule);
  state.proteinPrediction = molecule.prediction || null;
  state.representation = state.proteinPrediction ? 'cartoon' : 'ball-stick';
  const representationSelect = document.querySelector('#representation-select');
  representationSelect.disabled = !state.proteinPrediction;
  representationSelect.value = state.representation;
  document.querySelector('#display-theme-select').value = state.displayColorTheme;
  document.querySelector('#change-marker-select').value = state.changeMarkerStyle;
  document.querySelector('#steric-clash-toggle').checked = state.showStericClashes;
  document.querySelector('#protein-result-card').classList.toggle('hidden', !state.proteinPrediction);
  if (resetView) {
    state.rotation = defaultViewRotation(); state.zoom = 1; state.viewPan = { x:0, y:0 };
    state.viewProjectionCenter = null; state.viewProjectionRadius = null;
  }
  document.querySelector('#viewer-hint').classList.remove('visible');
  document.querySelector('#display-options').classList.toggle('hidden', state.mode !== 'view');
  document.querySelector('#molecule-info').classList.remove('hidden');
  document.querySelector('.scene-card').classList.toggle('hidden', state.mode !== 'view');
  if (state.proteinPrediction?.kind === 'pdb-import') {
    setText('#protein-result-title', molecule.source?.pdbId ? `PDB · ${molecule.source.pdbId}` : 'Imported PDB Structure');
    setText('#protein-plddt', 'PDB');
    setText('#protein-ptm', '—');
    setText('#protein-msa-depth', '—');
    setText('#protein-backend', molecule.parameterization ? 'SAGE' : 'PDB');
    setText('#protein-result-meta', `${molecule.source?.residues || 0} residues · ${molecule.atoms.length} atoms · explicit/template topology`);
    document.querySelector('#protein-confidence-bar').style.width = '0%';
  }
  updatePdbPreparationUi();
  updateLigandProtonationUi();
  updateStructureComponentsUi();
  updatePreparationInspectorUi();
  updateInfo();
  updateGeometryControl();
  updateOptimizerControls();
  updateDockingUi();
  updateDesignerMoveControls();
  updateResidueFollowChip();
  draw();
}

function updateInfo() {
  if (!state.molecule) return;
  const { atoms, name, smiles, charge, multiplicity } = state.molecule;
  const data = composition(atoms);
  setText('#info-atoms', data.words);
  setText('#info-formula', data.formula);
  setText('#info-charge', charge);
  setText('#info-multiplicity', multiplicity);
  const isWater = atoms.length === 3 && data.formula === 'H₂O';
  const isBenzene = data.formula === 'C₆H₆' && smiles === 'c1ccccc1';
  setText('#info-point-group', isBenzene ? 'D₆h' : isWater ? 'C₂v' : 'C1');
  setText('#info-symmetry', isBenzene ? '12' : isWater ? '2' : '1');
  setText('#info-smiles', smiles);
  setText('#scene-name', name);
  const representation = state.proteinPrediction
    ? state.representation === 'ball-stick' ? 'ball & stick' : state.representation === 'both' ? 'cartoon + atoms' : 'cartoon'
    : 'ball & stick';
  const visibleAtoms = atoms.reduce((count, _, index) => count + (componentVisible(index) ? 1 : 0), 0);
  const pocket = state.representation === 'cartoon' && state.showPocketAtoms ? proteinLigandPocket() : null;
  const pocketMeta = pocket?.pocketResidueKeys.size ? ` · ${pocket.pocketResidueKeys.size} pocket residues` : '';
  setText('#scene-meta', `${visibleAtoms === atoms.length ? atoms.length : `${visibleAtoms}/${atoms.length}`} atoms · ${representation}${pocketMeta}`);
  updatePocketControl();
  updateChemistryDisplayControls();
  updateOptimizerControls();
  updateDockingUi();
  schedule2DDepiction();
}

function updatePdbPreparationUi() {
  const panel = document.querySelector('#pdb-preparation');
  const molecule = state.molecule;
  const visible = molecule?.source?.format === 'pdb';
  panel.classList.toggle('hidden', !visible);
  if (!visible) return;
  const badge = document.querySelector('#pdb-preparation-badge');
  const status = document.querySelector('#pdb-preparation-status');
  const button = document.querySelector('#prepare-pdb');
  const report = proteinPreparationReport(molecule);
  const preview = state.pdbPreparationPreview;
  panel.classList.remove('ready', 'warning');
  if (molecule.parameterization?.system) {
    panel.classList.add('ready'); badge.textContent = 'Prepared';
    const localRelaxation = molecule.preparation?.audit?.actions?.find((action) => action.action === 'relax-polar-hydrogens');
    const local = localRelaxation
      ? ` · ${localRelaxation.rotatableHydrogens} polar H relaxed`
      : '';
    status.textContent = `${molecule.parameterization.forcefield} · ${molecule.atoms.length} atoms${local}`;
    button.textContent = 'Prepared'; button.disabled = true; button.dataset.action = 'ready';
  } else if (preview) {
    if (preview.audit.blockers.length) {
      panel.classList.add('warning'); badge.textContent = 'Review';
      button.textContent = 'Review blockers'; button.disabled = false; button.dataset.action = 'inspect';
    } else {
      panel.classList.add('ready'); badge.textContent = 'Preview';
      button.textContent = 'Prepare structure'; button.disabled = false; button.dataset.action = 'prepare';
    }
  } else if (report.unknownResidues.length || report.missingHeavyAtoms.length || report.unpreparedLigands.length
    || report.internalMissingResidues.length) {
    panel.classList.add('warning'); badge.textContent = 'Repair';
    const details = report.missingHeavyAtoms.length
      ? `${report.missingHeavyAtoms.length} missing heavy atom${report.missingHeavyAtoms.length === 1 ? '' : 's'}`
      : report.unknownResidues.length
        ? `${report.unknownResidues.length} unsupported residue${report.unknownResidues.length === 1 ? '' : 's'}`
        : report.unpreparedLigands.length
          ? `${report.unpreparedLigands.length} ligand${report.unpreparedLigands.length === 1 ? '' : 's'} without explicit hydrogens`
          : `${report.internalMissingResidues.length} internal missing residue${report.internalMissingResidues.length === 1 ? '' : 's'}`;
    status.textContent = `${molecule.atoms.length} atoms · ${details}`;
    button.textContent = 'Prepare structure'; button.disabled = false; button.dataset.action = 'prepare';
  } else {
    badge.textContent = report.hydrogens ? 'Hydrogenated' : 'Loaded';
    const waters = report.waterResidues ? ` · ${report.waterResidues} waters` : '';
    const heterogens = report.nonWaterHeterogenAtoms ? ` · ${report.nonWaterHeterogenAtoms} ligand atoms` : '';
    status.textContent = `${report.residues} residues · ${report.hydrogens} H${waters}${heterogens}`;
    button.textContent = 'Prepare structure';
    button.disabled = false; button.dataset.action = 'prepare';
  }
}

function groupedMissingHeavyAtoms(report) {
  const groups = new Map();
  for (const detail of report.missingHeavyAtomDetails || []) {
    const key = `${detail.chain}:${detail.residueIndex}:${detail.insertionCode}:${detail.residueName}`;
    if (!groups.has(key)) groups.set(key, { residueName: detail.residueName, chain: detail.chain,
      residueIndex: detail.residueIndex, insertionCode: detail.insertionCode, atoms: [] });
    groups.get(key).atoms.push(detail.atomName);
  }
  return [...groups.values()];
}

function appendPreparationIssue(container, title, detail, className = '') {
  const row = document.createElement('div'); row.className = `preparation-issue ${className}`.trim();
  const strong = document.createElement('strong'); strong.textContent = title;
  const span = document.createElement('span'); span.textContent = detail;
  row.append(strong, span); container.append(row);
}

function updatePreparationInspectorUi() {
  const card = document.querySelector('#preparation-inspector');
  if (!card) return;
  const molecule = state.molecule;
  const visible = molecule?.source?.format === 'pdb';
  card.classList.toggle('hidden', !visible);
  if (!visible) return;
  const report = proteinPreparationReport(molecule);
  const missingResidues = molecule.source?.missingResidues || [];
  const incomplete = groupedMissingHeavyAtoms(report);
  const preview = state.pdbPreparationPreview;
  const appliedAudit = molecule.parameterization?.system
    ? molecule.preparation?.audit || { blockers:[], warnings:[] } : null;
  const authoritativeAudit = preview?.audit || appliedAudit;
  const blockerCount = authoritativeAudit ? authoritativeAudit.blockers.length
    : incomplete.length + report.unknownResidues.length + report.unpreparedLigands.length + report.internalMissingResidues.length;
  card.classList.toggle('ready', blockerCount === 0);
  setText('#preparation-issue-badge', blockerCount ? `${blockerCount} blockers` : 'Ready');
  const stats = document.querySelector('#preparation-stat-grid'); stats.replaceChildren();
  const stat = (label, value) => {
    const box = document.createElement('div');
    const span = document.createElement('span'); span.textContent = label;
    const strong = document.createElement('strong'); strong.textContent = value;
    box.append(span, strong); stats.append(box);
  };
  stat('Modeled residues', report.residues);
  stat('Missing residues', missingResidues.length);
  stat('Incomplete residues', incomplete.length);
  stat('Missing heavy atoms', report.missingHeavyAtoms.length);
  const guidance = document.querySelector('#preparation-guidance');
  if (appliedAudit && !preview && !blockerCount) guidance.textContent = 'Preparation was applied and the experimental numeric System was built. Omitted PDB coordinates and accepted chain breaks below are provenance warnings, not new preparation blockers.';
  else if (preview && !blockerCount) guidance.textContent = 'The browser-local repair preview is complete. Review the actions below, then build an experimental Sage/Gasteiger numeric System for minimization; it is not a validated protein force field.';
  else if (blockerCount) guidance.textContent = 'Viewing and component inspection are safe. Preview performs conservative canonical-residue and CCD repair; unresolved loops, unsupported chemistry, and severe clashes remain blockers.';
  else {
    const waterPolicy = document.querySelector('#preparation-waters')?.value || 'crucial';
    const waterPlan = !report.waterResidues ? ''
      : waterPolicy === 'retain' ? `${report.waterResidues} crystallographic waters will be retained. `
        : waterPolicy === 'exclude' ? `${report.waterResidues} crystallographic waters will be excluded. `
          : `${report.waterResidues} crystallographic waters will be screened for ligand bridges and structural polar networks. `;
    guidance.textContent = `The modeled protein is complete. ${waterPlan}Molarium can add protein hydrogens and build an experimental numeric System for minimization.`;
  }
  const previewBox = document.querySelector('#preparation-preview');
  const reportButton = document.querySelector('#download-preparation-report');
  previewBox.classList.toggle('hidden', !preview);
  reportButton.classList.toggle('hidden', !preview && !molecule.preparation?.audit);
  if (preview) {
    previewBox.replaceChildren();
    const title = document.createElement('strong'); title.textContent = preview.audit.blockers.length
      ? 'Repair preview requires review' : 'Repair preview ready';
    const detail = document.createElement('span');
    const addedHeavy = preview.audit.actions.find((action) => action.action === 'repair-heavy-atoms')?.added || 0;
    const ligandCount = preview.audit.actions.find((action) =>
      ['prepare-ligands-from-ccd', 'prepare-ligands-from-registered-graph'].includes(action.action))
      ?.components?.length || 0;
    const crucialWaters = preview.audit.actions.find((action) => action.action === 'retain-crucial-crystallographic-water');
    const waters = crucialWaters
      ? ` · ${crucialWaters.watersRetained}/${crucialWaters.watersExamined} crucial crystal waters kept`
      : '';
    const polarRelaxation = preview.audit.actions.find((action) => action.action === 'relax-polar-hydrogens');
    const polar = polarRelaxation
      ? ` · ${polarRelaxation.rotatableHydrogens} polar H locally relaxed in ${polarRelaxation.elapsedMs.toFixed(1)} ms`
      : '';
    detail.textContent = `${preview.molecule.atoms.length} output atoms · ${addedHeavy} heavy atoms rebuilt · ${ligandCount} prepared ligand components${waters}${polar} · pH ${preview.options.pH.toFixed(1)} · ${preview.audit.blockers.length} blockers.`;
    previewBox.append(title, detail);
  }
  const issues = document.querySelector('#preparation-issues'); issues.replaceChildren();
  incomplete.forEach((entry) => appendPreparationIssue(issues,
    `${entry.residueName} · chain ${entry.chain} ${entry.residueIndex}${entry.insertionCode}`,
    `Missing ${entry.atoms.join(', ')}`));
  report.unpreparedLigands.forEach((entry) => appendPreparationIssue(issues,
    `${entry.residueName} ligand · chain ${entry.chain} ${entry.residueIndex}${entry.insertionCode}`,
    `${entry.heavyAtoms} heavy atoms, no explicit hydrogens; retained for viewing but not ready for joint minimization.`));
  report.unknownResidues.forEach((entry) => appendPreparationIssue(issues, entry,
    'Unsupported protein residue; no template topology or protonation will be invented.'));
  missingResidues.forEach((entry) => appendPreparationIssue(issues,
    `${entry.residueName} · chain ${entry.chain} ${entry.residueIndex}${entry.insertionCode}`,
    `Unmodeled residue declared by PDB REMARK 465; it is absent from the coordinate model${appliedAudit ? ' and was retained as an accepted omission, not counted as a blocker' : ''}.`, 'missing-residue'));
  preview?.audit.blockers.forEach((entry) => appendPreparationIssue(issues, 'Preview blocker', entry));
  preview?.audit.warnings.forEach((entry) => appendPreparationIssue(issues, 'Preview warning', entry, 'missing-residue'));
  if (appliedAudit && !preview) {
    appliedAudit.blockers?.forEach((entry) => appendPreparationIssue(issues, 'Applied preparation blocker', entry));
    appliedAudit.warnings?.forEach((entry) => appendPreparationIssue(issues, 'Applied preparation warning', entry, 'missing-residue'));
  }
  if (!issues.childElementCount) appendPreparationIssue(issues, 'No blocking coordinate defects',
    'All modeled standard residues contain their expected heavy atoms.', 'missing-residue');
}

function setPreparationInspectorOpen(open) {
  const body = document.querySelector('#preparation-inspector-body');
  const toggle = document.querySelector('#preparation-inspector-toggle');
  body.classList.toggle('hidden', !open); toggle.setAttribute('aria-expanded', String(open));
  toggle.querySelector('.chevron').classList.toggle('open', open);
}

function openPreparationInspector() {
  updatePreparationInspectorUi(); setPreparationInspectorOpen(true);
  document.querySelector('#preparation-inspector').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setText(selector, value) { document.querySelector(selector).textContent = value; }

function resizeCanvas(targetCanvas, targetCtx) {
  const rect = targetCanvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (targetCanvas.width !== width || targetCanvas.height !== height) {
    targetCanvas.width = width; targetCanvas.height = height;
    targetCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  return { width: rect.width, height: rect.height };
}

function residueKey(atom) {
  if (!atom || atom.residueIndex == null || !atom.residueName) return null;
  return `${atom.chain || 'A'}:${atom.residueIndex}:${atom.insertionCode || ''}`;
}

const LIGAND_POCKET_RADIUS_ANGSTROM = 5;

function connectedLigandAtomIndexSet(molecule = state.molecule) {
  if (!molecule?.atoms?.length) return new Set();
  const seeds = new Set(state.structureComponents.filter((component) => component.kind === 'ligand'
    && state.componentVisibility.get(component.id) !== false).flatMap((component) => component.atomIndices));
  const ligandIndices = new Set();
  moleculeComponents(molecule).forEach((component) => {
    if (!component.some((index) => seeds.has(index))
      || component.some((index) => isProteinAtom(molecule.atoms[index]) || isWaterAtom(molecule.atoms[index]))) return;
    component.forEach((index) => ligandIndices.add(index));
  });
  return ligandIndices;
}

function proteinLigandPocket(molecule = state.molecule, radius = LIGAND_POCKET_RADIUS_ANGSTROM,
  ignoreDisplayToggle = false) {
  const ligandIndices = connectedLigandAtomIndexSet(molecule);
  const pocketResidueKeys = new Set();
  const pocketAtomIndices = new Set();
  if (!molecule || (!state.showPocketAtoms && !ignoreDisplayToggle) || !ligandIndices.size)
    return { radius, ligandIndices, pocketResidueKeys, pocketAtomIndices };

  const ligandHeavyAtoms = [...ligandIndices].map((index) => molecule.atoms[index])
    .filter((atom) => atom && atom.element !== 'H');
  if (!ligandHeavyAtoms.length)
    return { radius, ligandIndices, pocketResidueKeys, pocketAtomIndices };
  const radiusSquared = radius * radius;
  molecule.atoms.forEach((atom, index) => {
    if (!isProteinAtom(atom) || atom.element === 'H' || !componentVisible(index)) return;
    if (ligandHeavyAtoms.some((ligand) => {
      const dx = atom.x - ligand.x, dy = atom.y - ligand.y, dz = atom.z - ligand.z;
      return dx * dx + dy * dy + dz * dz <= radiusSquared;
    })) pocketResidueKeys.add(residueKey(atom));
  });
  molecule.atoms.forEach((atom, index) => {
    if (componentVisible(index) && pocketResidueKeys.has(residueKey(atom))) pocketAtomIndices.add(index);
  });
  return { radius, ligandIndices, pocketResidueKeys, pocketAtomIndices };
}

function contactProteinLigandPocket(molecule, radiusPocket) {
  if (state.pocketAtomMode !== 'contacts' || !radiusPocket.ligandIndices.size)
    return radiusPocket;
  const candidates = new Set([...radiusPocket.ligandIndices, ...radiusPocket.pocketAtomIndices]);
  const cycles = findRingCycles(molecule, 12, candidates);
  const interactions = nonCovalentInteractions(molecule, cycles, candidates);
  const contactResidueKeys = new Set();
  interactions.hydrogenBonds.forEach((bond) => {
    const donorIsLigand = radiusPocket.ligandIndices.has(bond.donor);
    const acceptorIsLigand = radiusPocket.ligandIndices.has(bond.acceptor);
    if (donorIsLigand === acceptorIsLigand) return;
    const proteinIndex = donorIsLigand ? bond.acceptor : bond.donor;
    if (isProteinAtom(molecule.atoms[proteinIndex])) contactResidueKeys.add(residueKey(molecule.atoms[proteinIndex]));
  });
  interactions.piStacks.forEach((stack) => {
    const firstIsLigand = stack.first.some((index) => radiusPocket.ligandIndices.has(index));
    const secondIsLigand = stack.second.some((index) => radiusPocket.ligandIndices.has(index));
    if (firstIsLigand === secondIsLigand) return;
    const proteinRing = firstIsLigand ? stack.second : stack.first;
    proteinRing.forEach((index) => {
      if (isProteinAtom(molecule.atoms[index])) contactResidueKeys.add(residueKey(molecule.atoms[index]));
    });
  });
  const contactAtomIndices = new Set();
  molecule.atoms.forEach((atom, index) => {
    if (componentVisible(index) && contactResidueKeys.has(residueKey(atom))) contactAtomIndices.add(index);
  });
  return { ...radiusPocket, pocketResidueKeys:contactResidueKeys,
    pocketAtomIndices:contactAtomIndices, radiusResidueCount:radiusPocket.pocketResidueKeys.size };
}

function cartoonAtomSelection(molecule = state.molecule) {
  const pocket = contactProteinLigandPocket(molecule, proteinLigandPocket(molecule));
  const allowedIndices = new Set();
  molecule?.atoms?.forEach((atom, index) => {
    if (!componentVisible(index)) return;
    if (!isProteinAtom(atom) || pocket.pocketAtomIndices.has(index)) allowedIndices.add(index);
  });
  labeledResiduePeptideContextIndices(molecule).forEach((index) => {
    if (componentVisible(index)) allowedIndices.add(index);
  });
  return { ...pocket, allowedIndices };
}

function interactivePocketMovableAtomIndices(molecule = state.molecule) {
  if (!molecule?.atoms?.length) return [];
  const pocket = proteinLigandPocket(molecule, LIGAND_POCKET_RADIUS_ANGSTROM, true);
  if (!pocket.ligandIndices.size) return [];
  const backbone = new Set(['N', 'CA', 'C', 'O', 'OXT']);
  const movable = new Set(pocket.ligandIndices);
  pocket.pocketAtomIndices.forEach((index) => {
    const atom = molecule.atoms[index];
    if (atom.element !== 'H' && !backbone.has(atom.atomName)) movable.add(index);
  });
  const adjacency = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond) => {
    adjacency[bond.a].push(bond.b); adjacency[bond.b].push(bond.a);
  });
  pocket.pocketAtomIndices.forEach((index) => {
    const atom = molecule.atoms[index];
    if (atom.element !== 'H') return;
    if (adjacency[index].some((neighbor) => movable.has(neighbor))) movable.add(index);
  });
  return [...movable].sort((first, second) => first - second);
}

function currentRegisteredPoseRetentionPlan(molecule = state.molecule) {
  const releasedReferenceAtomIds = Array.from(
    molecule?.source?.posePropagationEditRegions || []).flatMap((region) =>
    Array.from(region.releasedHeavyAtomIds || []));
  return registeredPoseRetentionPlan({ molecule, referenceLigand:state.dockingReference?.ligand,
    spatialFeatures:molecule?.source?.posePropagationSpatialFeatures || [],
    releasedReferenceAtomIds });
}

function inducedFitPocketMovableAtomIndices(molecule = state.molecule,
  retentionPlan = currentRegisteredPoseRetentionPlan(molecule)) {
  if (!molecule?.atoms?.length) return [];
  const pocket = proteinLigandPocket(molecule, 6, true);
  if (!pocket.ligandIndices.size) return [];
  // Unlike the fast pocket lane, the induced-fit lane releases the backbone
  // and side chain of every residue entering the 6 Å shell.  Atoms outside
  // that shell remain fixed and provide the covalent/structural boundary.
  const fixed = new Set(retentionPlan.fixedAtomIndices || []);
  return [...new Set([...pocket.ligandIndices, ...pocket.pocketAtomIndices])]
    .filter((index) => !fixed.has(index))
    .sort((first, second) => first - second);
}

function updatePocketControl() {
  const label = document.querySelector('#pocket-toggle-label');
  if (!label) return;
  const hasProtein = state.structureComponents.some((component) => component.kind === 'protein'
    && state.componentVisibility.get(component.id) !== false);
  const hasLigand = state.structureComponents.some((component) => component.kind === 'ligand'
    && state.componentVisibility.get(component.id) !== false);
  const relevant = hasProtein && hasLigand;
  label.classList.toggle('hidden', !relevant);
  const input = document.querySelector('#pocket-toggle');
  input.disabled = state.representation !== 'cartoon';
  input.checked = state.showPocketAtoms;
  const pocket = relevant ? contactProteinLigandPocket(state.molecule, proteinLigandPocket()) : null;
  const count = pocket?.pocketResidueKeys.size || 0;
  setText('#pocket-toggle-text', state.pocketAtomMode === 'contacts'
    ? `Show contact atoms${count ? ` · ${count} residues` : ''}`
    : `Show pocket atoms${count ? ` · ${count} residues` : ''}`);
  const mode = document.querySelector('#pocket-mode-toggle');
  mode.textContent = state.pocketAtomMode === 'contacts' ? 'Contacts' : `${LIGAND_POCKET_RADIUS_ANGSTROM} Å`;
  mode.setAttribute('aria-pressed', String(state.pocketAtomMode === 'contacts'));
  mode.disabled = !relevant || state.representation !== 'cartoon' || !state.showPocketAtoms;
}

function ligandAtomIndexSet() {
  return connectedLigandAtomIndexSet();
}

function interactionCounts(interactions) {
  const ligand = ligandAtomIndexSet();
  const crossesLigand = (indices) => indices.some((index) => ligand.has(index))
    && indices.some((index) => !ligand.has(index));
  return {
    hydrogenBonds:interactions?.hydrogenBonds?.length || 0,
    ligandHydrogenBonds:(interactions?.hydrogenBonds || []).filter((bond) =>
      crossesLigand([bond.donor, bond.acceptor])).length,
    piStacks:interactions?.piStacks?.length || 0,
    ligandPiStacks:(interactions?.piStacks || []).filter((stack) =>
      crossesLigand([...stack.first, ...stack.second])).length,
  };
}

function updateChemistryDisplayControls(interactions = null) {
  const hydrogenCount = state.molecule?.atoms?.reduce((count, atom, index) =>
    count + (atom.element === 'H' && componentVisible(index) ? 1 : 0), 0) || 0;
  const hydrogenInput = document.querySelector('#hydrogen-toggle');
  hydrogenInput.disabled = hydrogenCount === 0;
  setText('#hydrogen-toggle-text', hydrogenCount
    ? `Show hydrogen · ${hydrogenCount.toLocaleString()}`
    : 'Show hydrogen · none loaded');
  if (!hydrogenCount) {
    setText('#interaction-toggle-text', 'Show H-bonds & π-stacks · no H loaded');
    return;
  }
  if (!interactions) {
    setText('#interaction-toggle-text', 'Show H-bonds & π-stacks');
    return;
  }
  const counts = interactionCounts(interactions);
  const ligand = counts.ligandHydrogenBonds || counts.ligandPiStacks
    ? ` · ${counts.ligandHydrogenBonds + counts.ligandPiStacks} ligand contacts` : '';
  setText('#interaction-toggle-text', `Show H-bonds & π-stacks · ${counts.hydrogenBonds} H-bonds${ligand}`);
}

function focusedResidueAtoms(molecule = state.molecule) {
  if (!molecule || !state.focusedResidueKey) return [];
  return molecule.atoms.map((atom, index) => ({ atom, index }))
    .filter(({ atom, index }) => residueKey(atom) === state.focusedResidueKey && componentVisible(index));
}

function updateResidueFollowChip() {
  const chip = document.querySelector('#residue-follow-chip');
  const focused = focusedResidueAtoms();
  chip.classList.toggle('hidden', !focused.length);
  if (!focused.length) { chip.textContent = ''; return; }
  const atom = focused[0].atom;
  chip.textContent = `Following ${atom.residueName} ${atom.chain || 'A'}${atom.residueIndex}${atom.insertionCode || ''} ×`;
}

function setFocusedResidue(atomIndex = null) {
  const atom = atomIndex == null ? null : state.molecule?.atoms?.[atomIndex];
  const nextKey = residueKey(atom);
  if (!nextKey || nextKey === state.focusedResidueKey) {
    state.focusedResidueKey = null;
    state.focusedResidueRadius = null;
  } else {
    state.focusedComponentId = null;
    state.focusedComponentCenter = null;
    state.focusedComponentRadius = null;
    clearFocusedAtomRegion();
    state.focusedResidueKey = nextKey;
    const focused = focusedResidueAtoms();
    const center = focused.reduce((sum, entry) => ({
      x:sum.x + entry.atom.x, y:sum.y + entry.atom.y, z:sum.z + entry.atom.z,
    }), { x:0, y:0, z:0 });
    center.x /= focused.length; center.y /= focused.length; center.z /= focused.length;
    const radius = Math.max(0, ...focused.map(({ atom: item }) =>
      Math.hypot(item.x - center.x, item.y - center.y, item.z - center.z)));
    state.focusedResidueRadius = Math.max(3.5, radius * 1.8);
    state.zoom = 1; state.viewPan = { x:0, y:0 };
  }
  updateResidueFollowChip();
  draw();
}

function projectAtoms(width, height, molecule = state.molecule, miniature = false) {
  if (!molecule) return [];
  let componentFiltered = molecule.atoms.map((atom, index) => ({ ...atom, index }))
    .filter((atom) => componentVisible(atom.index));
  const atomContextIndices = miniature ? null : focusedAtomContextIndices(molecule);
  const contextIndices = atomContextIndices || (miniature ? null : focusedComponentContextIndices(molecule));
  if (contextIndices) componentFiltered = componentFiltered.filter((atom) => contextIndices.has(atom.index));
  if (!componentFiltered.length) return [];
  const visible = componentFiltered.filter((atom) => state.showHydrogens || atom.element !== 'H');
  const focusedAtoms = !miniature ? focusedAtomEntries(molecule)
    .map(({ index }) => componentFiltered.find((atom) => atom.index === index)).filter(Boolean) : [];
  const focused = !miniature && !focusedAtoms.length && state.focusedResidueKey
    ? componentFiltered.filter((atom) => residueKey(atom) === state.focusedResidueKey) : [];
  const focusedComponent = !miniature && !focusedAtoms.length && !focused.length && state.focusedComponentId
    ? componentFiltered.filter((atom) => state.atomComponentIds[atom.index] === state.focusedComponentId) : [];
  const centerAtoms = focusedAtoms.length ? focusedAtoms
    : focused.length ? focused : focusedComponent.length ? focusedComponent : componentFiltered;
  let center = centerAtoms.reduce((sum, atom) => ({ x: sum.x + atom.x, y: sum.y + atom.y, z: sum.z + atom.z }), { x: 0, y: 0, z: 0 });
  center.x /= centerAtoms.length; center.y /= centerAtoms.length; center.z /= centerAtoms.length;
  if (!miniature && focusedAtoms.length && state.focusedAtomCenter)
    center = { ...state.focusedAtomCenter };
  else if (!miniature && focusedComponent.length && state.focusedComponentCenter)
    center = { ...state.focusedComponentCenter };
  let radius = Math.max(0.1, ...componentFiltered.map((atom) =>
    Math.hypot(atom.x - center.x, atom.y - center.y, atom.z - center.z)));
  const persistentView = !miniature && !focusedAtoms.length && !focused.length && !focusedComponent.length
    && !Number.isFinite(state.calculationProjectionRadius);
  if (persistentView) {
    if (!state.viewProjectionCenter || !Number.isFinite(state.viewProjectionRadius)) {
      state.viewProjectionCenter = { ...center };
      state.viewProjectionRadius = radius;
    } else {
      center = { ...state.viewProjectionCenter };
      radius = state.viewProjectionRadius;
    }
  }
  const rotated = visible.map((atom) => {
    const point = rotateVectorByQuaternion({ x: atom.x - center.x, y: atom.y - center.y, z: atom.z - center.z }, state.rotation);
    return { ...atom, rx: point.x, ry: point.y, rz: point.z };
  });
  // A 3D bounding sphere is invariant under rotation, so dragging no longer
  // makes the camera visibly zoom in and out as projected extents change.
  // Keep a trajectory at one camera scale. Re-fitting to every frame's
  // instantaneous outermost atom makes ordinary fluctuations look like a
  // synchronized whole-molecule breathing mode.
  const fitRadius = !miniature && focusedAtoms.length && Number.isFinite(state.focusedAtomRadius)
    ? state.focusedAtomRadius
    : !miniature && focused.length && Number.isFinite(state.focusedResidueRadius)
    ? state.focusedResidueRadius
    : !miniature && focusedComponent.length && Number.isFinite(state.focusedComponentRadius)
      ? state.focusedComponentRadius
    : !miniature && Number.isFinite(state.calculationProjectionRadius)
      ? state.calculationProjectionRadius : radius;
  const maximumFit = miniature ? 11 : focusedAtoms.length ? 54 : 72;
  const fit = Math.min(Math.min(width, height) * (miniature ? 0.38 : 0.42) / fitRadius,
    maximumFit);
  const scale = fit * state.zoom;
  const pan = miniature ? { x:0, y:0 } : state.viewPan;
  if (!miniature) state.projection = { center, scale, rotation: { ...state.rotation }, pan:{ ...pan } };
  return rotated.map((atom) => {
    const perspective = miniature ? 1 : 850 / (850 + atom.rz * scale * .08);
    return { ...atom, sx: width / 2 + pan.x + atom.rx * scale * perspective,
      sy: height / 2 + pan.y - atom.ry * scale * perspective, scale, perspective };
  });
}

function draw() {
  const size = resizeCanvas(canvas, ctx);
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size.width, size.height);
  if (!state.molecule) {
    state.visibleStericClashCount = 0; updateStericClashDisplayLabel(0); return;
  }
  const projected = projectAtoms(size.width, size.height);
  drawMolecule(ctx, projected, state.molecule, false);
  drawScenePreview();
}

function drawScenePreview() {
  const size = resizeCanvas(sceneCanvas, sceneCtx);
  sceneCtx.clearRect(0, 0, size.width, size.height);
  sceneCtx.fillStyle = '#f8fafc'; sceneCtx.fillRect(0, 0, size.width, size.height);
  if (!state.molecule) return;
  drawMolecule(sceneCtx, projectAtoms(size.width, size.height, state.molecule, true), state.molecule, true);
}

function canonicalCycle(cycle) {
  const variants = [];
  for (const direction of [cycle, [...cycle].reverse()]) {
    for (let offset = 0; offset < direction.length; offset++)
      variants.push([...direction.slice(offset), ...direction.slice(0, offset)]);
  }
  variants.sort((first, second) => {
    for (let index = 0; index < first.length; index++) {
      if (first[index] !== second[index]) return first[index] - second[index];
    }
    return 0;
  });
  return variants[0];
}

function findRingCycles(molecule, maximumSize = 12, allowedIndices = null) {
  const allowed = allowedIndices instanceof Set ? allowedIndices
    : allowedIndices ? new Set(allowedIndices) : null;
  const eligibleBonds = molecule.bonds.map((bond, bondIndex) => ({ bond, bondIndex }))
    .filter(({ bond }) => !allowed || (allowed.has(bond.a) && allowed.has(bond.b)));
  const adjacency = molecule.atoms.map(() => []);
  eligibleBonds.forEach(({ bond, bondIndex }) => {
    adjacency[bond.a].push({ atom: bond.b, bondIndex });
    adjacency[bond.b].push({ atom: bond.a, bondIndex });
  });
  const cycles = new Map();
  eligibleBonds.forEach(({ bond: excludedBond, bondIndex: excludedIndex }) => {
    const queue = [excludedBond.a];
    const previous = new Map([[excludedBond.a, null]]);
    for (let cursor = 0; cursor < queue.length && !previous.has(excludedBond.b); cursor++) {
      const atom = queue[cursor];
      for (const edge of adjacency[atom]) {
        if (edge.bondIndex === excludedIndex || previous.has(edge.atom)) continue;
        previous.set(edge.atom, atom); queue.push(edge.atom);
      }
    }
    if (!previous.has(excludedBond.b)) return;
    const path = [];
    for (let atom = excludedBond.b; atom != null; atom = previous.get(atom)) path.push(atom);
    path.reverse();
    if (path.length < 3 || path.length > maximumSize) return;
    const cycle = canonicalCycle(path);
    cycles.set(cycle.join(':'), cycle);
  });
  return [...cycles.values()].sort((first, second) => first.length - second.length);
}

function aromaticDoubleBonds(molecule, cycles) {
  const result = new Set();
  const bondByPair = new Map(molecule.bonds.map((bond) => [pairKey(bond.a, bond.b), bond]));
  cycles.forEach((cycle) => {
    if (cycle.length % 2 || !cycle.every((index) => molecule.atoms[index].aromatic)) return;
    if (!cycle.every((index, position) => (bondByPair.get(pairKey(index, cycle[(position + 1) % cycle.length]))?.order || 0) === 1.5)) return;
    cycle.forEach((index, position) => {
      if (position % 2 === 0) result.add(pairKey(index, cycle[(position + 1) % cycle.length]));
    });
  });
  return result;
}

function drawRingHulls(context, projectedByIndex, cycles) {
  if (!state.showHulls) return;
  cycles.forEach((cycle) => {
    const points = cycle.map((index) => projectedByIndex.get(index));
    if (points.some((point) => !point)) return;
    context.beginPath();
    points.forEach((point, index) => index ? context.lineTo(point.sx, point.sy) : context.moveTo(point.sx, point.sy));
    context.closePath();
    context.fillStyle = 'rgba(199, 235, 235, 0.48)'; context.fill();
    context.strokeStyle = 'rgba(105, 184, 187, 0.42)'; context.lineWidth = 1; context.stroke();
  });
}

function ringGeometry(molecule, cycle) {
  const atoms = cycle.map((index) => molecule.atoms[index]);
  const centroid = atoms.reduce((sum, atom) => ({
    x:sum.x + atom.x, y:sum.y + atom.y, z:sum.z + atom.z,
  }), { x:0, y:0, z:0 });
  centroid.x /= atoms.length; centroid.y /= atoms.length; centroid.z /= atoms.length;
  const normal = { x:0, y:0, z:0 };
  for (let index = 0; index < atoms.length; index++) {
    const current = atoms[index], next = atoms[(index + 1) % atoms.length];
    normal.x += (current.y - centroid.y) * (next.z - centroid.z)
      - (current.z - centroid.z) * (next.y - centroid.y);
    normal.y += (current.z - centroid.z) * (next.x - centroid.x)
      - (current.x - centroid.x) * (next.z - centroid.z);
    normal.z += (current.x - centroid.x) * (next.y - centroid.y)
      - (current.y - centroid.y) * (next.x - centroid.x);
  }
  const magnitude = Math.hypot(normal.x, normal.y, normal.z) || 1;
  normal.x /= magnitude; normal.y /= magnitude; normal.z /= magnitude;
  return { centroid, normal };
}

function nonCovalentInteractions(molecule, cycles = findRingCycles(molecule), allowedIndices = null,
  limits = {}) {
  if (!molecule?.atoms?.length) return { hydrogenBonds:[], piStacks:[] };
  const allowed = allowedIndices instanceof Set ? allowedIndices
    : allowedIndices ? new Set(allowedIndices) : null;
  const eligibleBonds = molecule.bonds.filter((bond) => !allowed
    || (allowed.has(bond.a) && allowed.has(bond.b)));
  const adjacency = molecule.atoms.map(() => []);
  eligibleBonds.forEach((bond) => {
    adjacency[bond.a].push(bond.b);
    adjacency[bond.b].push(bond.a);
  });
  const donors = [], acceptors = [];
  if (hydrogenBondFeaturePerception) {
    molecule.atoms.forEach((_, index) => {
      if (allowed && !allowed.has(index)) return;
      const donor = hydrogenBondFeaturePerception(molecule, index, 'donor');
      donor?.hydrogenIndices.filter((hydrogen) => !allowed || allowed.has(hydrogen))
        .forEach((hydrogen) => donors.push({ donor:index, hydrogen }));
      if (hydrogenBondFeaturePerception(molecule, index, 'acceptor')) acceptors.push(index);
    });
  } else {
    eligibleBonds.forEach((bond) => {
      const first = molecule.atoms[bond.a], second = molecule.atoms[bond.b];
      if (first.element === 'H' && ['N', 'O', 'S'].includes(second.element))
        donors.push({ donor:bond.b, hydrogen:bond.a });
      if (second.element === 'H' && ['N', 'O', 'S'].includes(first.element))
        donors.push({ donor:bond.a, hydrogen:bond.b });
    });
    molecule.atoms.forEach((atom, index) => {
      if (allowed && !allowed.has(index)) return;
      if (['O', 'S', 'F'].includes(atom.element) && Number(atom.formalCharge || 0) <= 0)
        acceptors.push(index);
      else if (atom.element === 'N' && Number(atom.formalCharge || 0) <= 0
        && adjacency[index].length < 4
        && !adjacency[index].some((neighbor) => molecule.atoms[neighbor].element === 'H'))
        acceptors.push(index);
    });
  }
  const hydrogenBonds = [];
  donors.forEach(({ donor, hydrogen }) => {
    const near = new Set([donor, hydrogen, ...adjacency[donor]]);
    adjacency[donor].forEach((neighbor) => adjacency[neighbor].forEach((next) => near.add(next)));
    const d = molecule.atoms[donor], h = molecule.atoms[hydrogen];
    acceptors.forEach((acceptor) => {
      if (near.has(acceptor)) return;
      const a = molecule.atoms[acceptor];
      const hx = d.x - h.x, hy = d.y - h.y, hz = d.z - h.z;
      const ax = a.x - h.x, ay = a.y - h.y, az = a.z - h.z;
      const ha = Math.hypot(ax, ay, az), hd = Math.hypot(hx, hy, hz);
      if (ha < 1.2 || ha > 2.6 || !hd) return;
      const cosine = (hx * ax + hy * ay + hz * az) / (hd * ha);
      if (cosine > -0.70710678) return;
      hydrogenBonds.push({ donor, hydrogen, acceptor, distance:ha, cosine });
    });
  });
  hydrogenBonds.sort((first, second) => first.distance - second.distance);

  const aromaticRings = cycles.filter((cycle) => cycle.length >= 5 && cycle.length <= 7
    && cycle.every((index) => molecule.atoms[index].aromatic));
  const piStacks = [];
  for (let firstIndex = 0; firstIndex < aromaticRings.length; firstIndex++) {
    const first = aromaticRings[firstIndex], firstSet = new Set(first);
    const firstGeometry = ringGeometry(molecule, first);
    for (let secondIndex = firstIndex + 1; secondIndex < aromaticRings.length; secondIndex++) {
      const second = aromaticRings[secondIndex];
      if (second.some((atom) => firstSet.has(atom))) continue;
      const secondGeometry = ringGeometry(molecule, second);
      const dx = secondGeometry.centroid.x - firstGeometry.centroid.x;
      const dy = secondGeometry.centroid.y - firstGeometry.centroid.y;
      const dz = secondGeometry.centroid.z - firstGeometry.centroid.z;
      const distance = Math.hypot(dx, dy, dz);
      const alignment = Math.abs(firstGeometry.normal.x * secondGeometry.normal.x
        + firstGeometry.normal.y * secondGeometry.normal.y
        + firstGeometry.normal.z * secondGeometry.normal.z);
      const axial = Math.abs(dx * firstGeometry.normal.x + dy * firstGeometry.normal.y
        + dz * firstGeometry.normal.z);
      const lateral = Math.sqrt(Math.max(0, distance * distance - axial * axial));
      if (distance < 3.0 || distance > 6.0 || alignment < 0.819 || axial < 2.6 || lateral > 2.5) continue;
      piStacks.push({ first, second, distance, alignment, lateral });
    }
  }
  const hydrogenBondLimit = limits.hydrogenBonds === Infinity ? hydrogenBonds.length
    : Math.max(0, Number.isFinite(limits.hydrogenBonds) ? Math.floor(limits.hydrogenBonds) : 96);
  const piStackLimit = limits.piStacks === Infinity ? piStacks.length
    : Math.max(0, Number.isFinite(limits.piStacks) ? Math.floor(limits.piStacks) : 48);
  return { hydrogenBonds:hydrogenBonds.slice(0, hydrogenBondLimit),
    piStacks:piStacks.slice(0, piStackLimit) };
}

function dockingLigandComponent() {
  const ligands = state.structureComponents.filter((component) => component.kind === 'ligand');
  if (!ligands.length) return null;
  const selected = state.selectedAtoms || [];
  return ligands.find((component) => selected.some((index) => component.atomIndices.includes(index)))
    || ligands.find((component) => component.id === state.focusedComponentId)
    || (ligands.length === 1 ? ligands[0] : null);
}

function dockingLigandAtomIndicesInMolecule(molecule, reference = state.dockingReference) {
  if (!reference || !molecule?.atoms?.length) return [];
  const referenceIds = new Set(reference.ligand.atomIds);
  const seed = molecule.atoms.findIndex((atom) => referenceIds.has(atom.designAtomId));
  if (seed < 0) return [];
  const component = moleculeComponents(molecule).find((indices) => indices.includes(seed)) || [];
  return component.some((index) => molecule.atoms[index]?.record === 'ATOM') ? [] : component;
}

function currentDockingLigandAtomIndices(reference = state.dockingReference) {
  if (!reference || !state.molecule?.atoms?.length) return dockingLigandComponent()?.atomIndices.slice() || [];
  return dockingLigandAtomIndicesInMolecule(state.molecule, reference);
}

function currentIndicesForDockingPlan(plan) {
  const byId = new Map(state.molecule?.atoms?.map((atom, index) => [atom.designAtomId, index]) || []);
  const indices = plan.molecule.atoms.map((atom) => byId.get(atom.designAtomId));
  return indices.every(Number.isInteger) ? indices : [];
}

function dockingSelectedCore(component = dockingLigandComponent()) {
  if (!component) return [];
  const ligand = new Set(component.atomIndices);
  return state.selectedAtoms.filter((index) => ligand.has(index)
    && state.molecule?.atoms[index]?.element !== 'H');
}

function selectedDockingMode() {
  return document.querySelector('#docking-mode')?.value === 'selected-core'
    ? 'selected-core' : 'pose-propagation';
}

function selectedDockingEditCleanup() {
  return document.querySelector('#docking-edit-cleanup')?.value === 'free-local'
    ? 'free-local' : 'preserve-reference';
}

function survivingReferenceHeavyAtoms(reference, component = dockingLigandComponent()) {
  if (!reference?.ligand || !component) return 0;
  const liveIds = new Set(component.atomIndices.map((index) =>
    state.molecule?.atoms[index]?.designAtomId).filter(Boolean));
  return reference.ligand.atomIds.reduce((count, id, referenceIndex) => count
    + Number(reference.ligand.elements[referenceIndex] !== 'H' && liveIds.has(id)), 0);
}

function setDockingStatus(message) { setText('#docking-status', message); }

let analogueDesignPromptPromise = null;
let resolveAnalogueDesignPrompt = null;

function analogueDesignCaptureNeeded(targetAtomIndices = state.selectedAtoms) {
  if (state.mode !== 'build' || state.dockingReference || state.chemistryTransaction
    || selectedDockingMode() !== 'pose-propagation'
    || !state.molecule?.parameterization?.system) return false;
  if (!state.structureComponents.some((component) => component.kind === 'protein')) return false;
  const ligand = dockingLigandComponent();
  if (!ligand) return false;
  const ligandAtoms = new Set(ligand.atomIndices);
  return Array.from(targetAtomIndices || [], Number).some((index) => ligandAtoms.has(index));
}

function settleAnalogueDesignPrompt(accepted) {
  const dialog = document.querySelector('#analogue-design-dialog');
  if (dialog?.open) dialog.close();
  const resolve = resolveAnalogueDesignPrompt;
  analogueDesignPromptPromise = null; resolveAnalogueDesignPrompt = null;
  resolve?.(Boolean(accepted));
}

function requestAnalogueDesignCapture() {
  if (analogueDesignPromptPromise) return analogueDesignPromptPromise;
  const dialog = document.querySelector('#analogue-design-dialog');
  if (!dialog?.showModal) return Promise.resolve(false);
  analogueDesignPromptPromise = new Promise((resolve) => { resolveAnalogueDesignPrompt = resolve; });
  dialog.showModal();
  requestAnimationFrame(() => document.querySelector('#confirm-analogue-design')?.focus());
  return analogueDesignPromptPromise;
}

async function ensureAnalogueDesignReferenceBeforeChemistry(targetAtomIndices = state.selectedAtoms) {
  if (!analogueDesignCaptureNeeded(targetAtomIndices)) return true;
  if (!await requestAnalogueDesignCapture()) return false;
  await captureCurrentDockingReference();
  return true;
}

function effectiveDockingHydrogenBondDefinition(definition) {
  return state.dockingContactRemaps.get(definition?.id)?.effectiveDefinition
    || state.dockingContactRemapProposals.get(definition?.id)?.priorEffectiveDefinition
    || definition;
}

function effectiveDockingHydrogenBondDefinitions() {
  return (state.dockingReference?.hydrogenBonds || [])
    .map((definition) => effectiveDockingHydrogenBondDefinition(definition));
}

function dockingContactAvailable(definition) {
  if (hydrogenBondFeatureValidation && state.molecule)
    return hydrogenBondFeatureValidation(definition, state.molecule).available;
  const liveById = new Map(state.molecule?.atoms?.map((atom) => [atom.designAtomId, atom]) || []);
  return [definition?.donor, definition?.hydrogen, definition?.acceptor]
    .filter((descriptor) => descriptor?.scope === 'ligand')
    .every((descriptor) => {
      const atom = liveById.get(descriptor.designAtomId);
      return Boolean(atom && (!descriptor.element || descriptor.element === atom.element));
    });
}

function unresolvedSelectedDockingContacts() {
  return [...state.dockingSelectedHbondIds].filter((id) =>
    state.dockingContactRemapProposals.has(id)
      && !state.dockingContactRemapProposals.get(id)?.candidates?.length);
}

function dockingContactFeatureLabel(definition, proposal = null) {
  const ligandRole = proposal?.ligandRole
    || (definition?.receptorRole === 'donor' ? 'acceptor' : 'donor');
  const descriptor = ligandRole === 'acceptor' ? definition?.acceptor : definition?.donor;
  const signature = proposal?.originalFeatureSignature || descriptor?.featureSignature;
  let type = '';
  try { type = JSON.parse(signature || '{}').type || ''; } catch {}
  return ({
    'carbonyl oxygen acceptor':'carbonyl acceptor',
    'aromatic nitrogen acceptor':'aromatic N acceptor',
    'neutral nitrogen acceptor':'N acceptor',
    'nitrile nitrogen acceptor':'nitrile N acceptor',
    'sulfonyl oxygen acceptor':'sulfonyl O acceptor',
    'phosphoryl oxygen acceptor':'phosphoryl O acceptor',
    'nitrogen donor':'N–H donor',
    'oxygen donor':'O–H donor',
    'sulfur donor':'S–H donor',
  })[type] || type || `ligand ${ligandRole}`;
}

function contactParticipantIds(definition, scope) {
  return [definition?.donor, definition?.hydrogen, definition?.acceptor]
    .filter((descriptor) => descriptor?.scope === scope)
    .map((descriptor) => descriptor.designAtomId);
}

function recordDockingContactRemap(audit) {
  if (!state.molecule) return;
  state.molecule.source = { ...(state.molecule.source || {}) };
  const history = [...(state.molecule.source.dockingContactRemapHistory || [])];
  history.push(structuredClone(audit));
  state.molecule.source.dockingContactRemapHistory = history.slice(-64);
}

async function chooseDockingContactRemap(contactId, candidateId,
  method = 'user-selected-role-compatible') {
  const proposal = state.dockingContactRemapProposals.get(contactId);
  const rawDefinition = state.dockingReference?.hydrogenBonds
    .find((definition) => definition.id === contactId);
  const candidate = proposal?.candidates?.find((entry) => entry.id === candidateId);
  if (!proposal || !rawDefinition || !candidate)
    throw new Error('The selected contact replacement is no longer available.');
  const { applyLigandHydrogenBondFeatureRemap } = await import('./docking/contact-remap.mjs');
  const priorRemap = state.dockingContactRemaps.get(contactId);
  const priorDefinition = proposal.priorEffectiveDefinition
    || priorRemap?.effectiveDefinition || rawDefinition;
  const effectiveDefinition = applyLigandHydrogenBondFeatureRemap(priorDefinition, candidate);
  const priorChain = proposal.priorRemapChain || priorRemap?.chain
    || (proposal.priorRemapAudit ? [proposal.priorRemapAudit]
      : priorRemap?.audit ? [priorRemap.audit] : []);
  const audit = {
    schema:'molarium.docking.contact-feature-remap/v1', algorithm:'role-compatible-edit-boundary/v3',
    contactId, method, at:new Date().toISOString(), ligandRole:proposal.ligandRole,
    originalLigandAtomIds:contactParticipantIds(priorDefinition, 'ligand'),
    replacementLigandAtomIds:[...candidate.atomIds],
    originalFeatureSignature:proposal.originalFeatureSignature,
    replacementFeatureSignature:candidate.signature,
    matchKind:candidate.matchKind || 'role-compatible-bioisostere',
    boundaryAnchorIds:[...(candidate.boundaryAnchorIds || [])],
    cumulativeEditRegionAtomIds:[...(proposal.cumulativeEditRegionAtomIds || [])],
    editLineage:structuredClone(proposal.editLineage || []),
    candidateIds:proposal.candidates.map((entry) => entry.id),
    receptorParticipantIds:contactParticipantIds(rawDefinition, 'receptor'),
    beforeTopologySha256:proposal.beforeTopologySha256,
    afterTopologySha256:proposal.afterTopologySha256,
    committedEditId:proposal.committedEditId || null,
    originatingCommittedEditId:proposal.originatingCommittedEditId
      || proposal.committedEditId || null,
    previousRemap:priorChain.length ? {
      contactId, sourceLigandAtomIds:contactParticipantIds(priorDefinition, 'ligand'),
      priorDecisionCount:priorChain.length,
      priorReplacementLigandAtomIds:priorChain.at(-1)?.replacementLigandAtomIds || [],
    } : null,
    geometryEvidence:structuredClone(candidate.geometry),
    geometryUsedForSelection:false,
  };
  state.dockingContactRemaps.set(contactId,
    { effectiveDefinition, audit, chain:[...structuredClone(priorChain), structuredClone(audit)] });
  state.dockingContactRemapProposals.delete(contactId);
  state.dockingResult = null;
  recordDockingContactRemap(audit);
  updateDockingUi();
  showToast(method === 'automatic-unique-exact'
    ? 'Required contact mapped to the unique exact replacement feature'
    : method === 'automatic-unique-role-compatible'
      ? 'Required contact mapped to the unique role-compatible replacement'
      : 'Required contact mapped to the selected replacement feature');
  return audit;
}

function canonicalDockingTopology(molecule, atomIndices) {
  const included = new Set(atomIndices);
  const atoms = atomIndices.map((index) => molecule.atoms[index]).filter(Boolean)
    .map((atom) => {
      if (!atom.designAtomId)
        throw new Error('A staged ligand atom is missing its stable design identity.');
      return { id:atom.designAtomId, element:atom.element,
        charge:Number(atom.formalCharge ?? atom.charge ?? 0),
        aromatic:Boolean(atom.aromatic) };
    })
    .sort((first, second) => first.id.localeCompare(second.id));
  const bonds = (molecule.bonds || []).flatMap((bond) => included.has(bond.a) && included.has(bond.b)
    ? [{ ids:[molecule.atoms[bond.a].designAtomId, molecule.atoms[bond.b].designAtomId].sort(),
      order:Number(bond.order || 1) }] : [])
    .sort((first, second) => `${first.ids.join(':')}:${first.order}`
      .localeCompare(`${second.ids.join(':')}:${second.order}`));
  return JSON.stringify({ atoms, bonds });
}

async function reconcileDockingContactFeaturesAfterChemistry(transaction, changedAtomIndices) {
  const reference = state.dockingReference;
  if (!reference || reference.mode !== 'pose-propagation' || !reference.hydrogenBonds.length)
    return [];
  const [referenceCore, remapModule] = await Promise.all([
    import('./docking/reference-core.mjs'), import('./docking/contact-remap.mjs'),
  ]);
  const reservedAtomIds = new Set([
    ...transaction.snapshot.atoms.map((atom) => atom.designAtomId),
    ...(reference.ligand.atomIds || []),
  ].filter(Boolean));
  referenceCore.ensureStableAtomIds(state.molecule,
    `design-${state.molecule.source?.pdbId || 'complex'}`, reservedAtomIds);
  const beforeLigandIndices = dockingLigandAtomIndicesInMolecule(transaction.snapshot, reference);
  const ligandAtomIndices = currentDockingLigandAtomIndices(reference);
  if (!beforeLigandIndices.length || !ligandAtomIndices.length) return [];
  const beforeIds = new Set(transaction.snapshot.atoms.map((atom) => atom.designAtomId));
  const eligibleAtomIndices = [...new Set([
    ...changedAtomIndices,
    ...ligandAtomIndices.filter((index) => !beforeIds.has(state.molecule.atoms[index]?.designAtomId)),
  ])];
  let proposals = remapModule.proposeLigandHydrogenBondFeatureRemaps(
    effectiveDockingHydrogenBondDefinitions(), state.molecule, ligandAtomIndices,
    { eligibleAtomIndices, beforeMolecule:transaction.snapshot });
  proposals = proposals.map((proposal) =>
    remapModule.retainOriginatingHydrogenBondRemapCandidates(
      state.dockingContactRemapProposals.get(proposal.id), proposal,
      state.molecule, ligandAtomIndices));
  const [beforeTopologySha256, afterTopologySha256] = await Promise.all([
    sha256Hex(new TextEncoder().encode(canonicalDockingTopology(
      transaction.snapshot, beforeLigandIndices))),
    sha256Hex(new TextEncoder().encode(canonicalDockingTopology(state.molecule, ligandAtomIndices))),
  ]);
  const applied = [];
  for (const proposal of proposals) {
    if (proposal.status === 'available') {
      state.dockingContactRemapProposals.delete(proposal.id);
      continue;
    }
    const priorRemap = state.dockingContactRemaps.get(proposal.id);
    const priorProposal = state.dockingContactRemapProposals.get(proposal.id);
    const editLineage = [...structuredClone(priorProposal?.editLineage || []), {
      committedEditId:transaction.editId || null,
      beforeTopologySha256,
      afterTopologySha256,
      editRegionAtomIds:[...(proposal.editRegionAtomIds || [])],
      cumulativeEditRegionAtomIds:[...(proposal.cumulativeEditRegionAtomIds || [])],
    }];
    const recordedProposal = { ...proposal,
      beforeTopologySha256:priorProposal?.beforeTopologySha256 || beforeTopologySha256,
      afterTopologySha256,
      committedEditId:transaction.editId || null,
      originatingCommittedEditId:priorProposal?.originatingCommittedEditId
        || priorProposal?.committedEditId || transaction.editId || null,
      editLineage,
      priorEffectiveDefinition:structuredClone(priorRemap?.effectiveDefinition
        || priorProposal?.priorEffectiveDefinition
        || state.dockingReference.hydrogenBonds.find((entry) => entry.id === proposal.id)),
      priorRemapAudit:structuredClone(priorRemap?.audit || priorProposal?.priorRemapAudit || null),
      priorRemapChain:structuredClone(priorRemap?.chain || priorProposal?.priorRemapChain || []),
    };
    state.dockingContactRemapProposals.set(proposal.id, recordedProposal);
    state.dockingContactRemaps.delete(proposal.id);
    if (proposal.status === 'unique')
      applied.push(await chooseDockingContactRemap(proposal.id, proposal.candidates[0].id,
        proposal.candidates[0].matchKind === 'exact-feature'
          ? 'automatic-unique-exact' : 'automatic-unique-role-compatible'));
  }
  return applied;
}

function recordManualDockingContactEvent(kind, definition, extra = {}) {
  if (!state.molecule || !state.dockingReference) return;
  const event = { schema:'molarium.docking.contact-amendment/v1', kind,
    at:new Date().toISOString(), contactId:definition.id, label:definition.label,
    origin:structuredClone(definition.origin || null), ...structuredClone(extra) };
  state.molecule.source = { ...(state.molecule.source || {}),
    dockingContactAmendments:[...(state.molecule.source?.dockingContactAmendments || []),
      event].slice(-128) };
  state.dockingReference.contactAmendments = [
    ...(state.dockingReference.contactAmendments || []), structuredClone(event),
  ].slice(-128);
}

async function refreshDockingReceptorProvenance() {
  const reference = state.dockingReference;
  if (!reference || !state.molecule) return;
  const adapter = await import('./docking/browser-adapter.mjs');
  const currentById = new Map(state.molecule.atoms.map((atom, index) =>
    [atom.designAtomId, index]));
  const receptorParticipantIds = reference.hydrogenBonds.flatMap((definition) =>
    [definition.donor, definition.hydrogen, definition.acceptor]
      .filter((descriptor) => descriptor?.scope === 'receptor')
      .map((descriptor) => descriptor.designAtomId));
  const receptorSiteIds = reference.receptorSite.atoms.map((atom) => atom.designAtomId);
  const indices = [...new Set([...receptorSiteIds, ...receptorParticipantIds]
    .map((id) => currentById.get(id)).filter(Number.isInteger))].sort((a, b) => a - b);
  reference.receptorProvenanceAtomCount = indices.length;
  reference.receptorInputText = adapter.dockingInputText(state.molecule, indices);
}

function nextManualDockingContactId() {
  const used = new Set(state.dockingReference?.hydrogenBonds.map((entry) => entry.id) || []);
  let ordinal = 1;
  while (used.has(`manual-hbond-${ordinal}`)) ordinal += 1;
  return `manual-hbond-${ordinal}`;
}

function cancelManualDockingContact() {
  if (!state.dockingContactDraft) return false;
  state.dockingContactDraft = null;
  state.selectedAtoms = []; state.selectedAtom = null;
  updateGeometryControl(); updateBuildStatus(); updateDockingUi(); draw();
  return true;
}

async function addManualDockingContactByIndices(ligandAtomIndex, receptorAtomIndex,
  ligandRole = 'auto', method = 'two-atom-selection') {
  if (!state.dockingReference)
    throw new Error('Begin analogue design before adding a required contact');
  if (state.chemistryTransaction)
    throw new Error('Finish chemistry before adding a required contact');
  const ligandAtomIndices = currentDockingLigandAtomIndices();
  if (!ligandAtomIndices.length) throw new Error('The editable ligand is unavailable');
  const { ensureStableAtomIds } = await import('./docking/reference-core.mjs');
  ensureStableAtomIds(state.molecule, `manual-contact-${state.molecule.source?.pdbId || 'complex'}`,
    state.dockingReference.ligand?.atomIds || []);
  const module = manualHydrogenBondModule || await import('./docking/manual-hbond.mjs');
  const definition = module.createManualHydrogenBondDefinition({ molecule:state.molecule,
    ligandAtomIndices, ligandAtomIndex, receptorAtomIndex, ligandRole,
    id:nextManualDockingContactId(), method });
  const key = module.manualHydrogenBondParticipantKey(definition);
  const duplicate = state.dockingReference.hydrogenBonds.find((entry) =>
    module.manualHydrogenBondParticipantKey(effectiveDockingHydrogenBondDefinition(entry)) === key);
  if (duplicate) throw new Error(`That H-bond hypothesis already exists as ${duplicate.label}`);
  state.dockingReference.hydrogenBonds.push(definition);
  state.dockingSelectedHbondIds.add(definition.id);
  state.dockingResult = null; state.dockingPoseIndex = 0;
  recordManualDockingContactEvent('added', definition, {
    activeContactIds:[...state.dockingSelectedHbondIds] });
  await refreshDockingReceptorProvenance();
  state.dockingContactDraft = null;
  state.selectedAtoms = []; state.selectedAtom = null;
  updateGeometryControl(); updateBuildStatus(); updateDockingUi(); draw();
  showToast('Required H-bond added');
  return definition;
}

async function forgetDockingContact(contactId, method = 'user-forgot-contact') {
  const reference = state.dockingReference;
  const definition = reference?.hydrogenBonds.find((entry) => entry.id === contactId);
  if (!definition) throw new Error(`Unknown contact ${contactId}`);
  const proposal = state.dockingContactRemapProposals.get(contactId);
  if (!definition.origin && proposal?.status !== 'unavailable')
    throw new Error('Only a manually added or currently unavailable contact can be forgotten');
  reference.hydrogenBonds = reference.hydrogenBonds.filter((entry) => entry.id !== contactId);
  state.dockingSelectedHbondIds.delete(contactId);
  state.dockingContactRemaps.delete(contactId);
  state.dockingContactRemapProposals.delete(contactId);
  state.dockingResult = null; state.dockingPoseIndex = 0;
  recordManualDockingContactEvent('forgotten', definition, { method,
    activeContactIds:[...state.dockingSelectedHbondIds] });
  await refreshDockingReceptorProvenance();
  updateDockingUi(); draw(); showToast('Contact hypothesis forgotten');
  return definition;
}

function renderManualDockingContactBuilder() {
  const panel = document.querySelector('#docking-contact-builder');
  const status = document.querySelector('#docking-contact-builder-status');
  const choices = document.querySelector('#docking-contact-builder-options');
  if (!panel || !status || !choices) return;
  const draft = state.dockingContactDraft;
  panel.classList.toggle('hidden', !draft);
  choices.replaceChildren();
  if (!draft) return;
  if (!Number.isInteger(draft.ligandAtomIndex)) {
    status.textContent = 'Pick a ligand donor or acceptor.'; return;
  }
  if (!draft.options?.length) {
    const atom = state.molecule?.atoms[draft.ligandAtomIndex];
    status.textContent = `${atom?.atomName || atom?.element || 'Ligand atom'} selected · pick a receptor donor or acceptor.`;
    return;
  }
  status.textContent = 'Choose the direction of the H-bond:';
  draft.options.forEach((option) => {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = option.ligandRole === 'acceptor' ? 'Ligand accepts' : 'Ligand donates';
    button.addEventListener('click', () => addManualDockingContactThroughAction(
      draft.ligandAtomIndex, draft.receptorAtomIndex, option.ligandRole));
    choices.append(button);
  });
}

async function addManualDockingContactThroughAction(ligandAtomIndex,
  receptorAtomIndex, ligandRole = 'auto') {
  try {
    await ensureChemistActionAtomIds();
    return await runChemistUiAction('pose.addContact', {
      ligandAtomId:state.molecule.atoms[ligandAtomIndex].designAtomId,
      receptorAtomId:state.molecule.atoms[receptorAtomIndex].designAtomId,
      ligandRole,
    }, { reportError:false });
  } catch (error) { showNotice(error.message); return null; }
}

async function selectManualDockingContactAtom(atomIndex) {
  const draft = state.dockingContactDraft;
  if (!draft) return false;
  if (state.chemistryTransaction) {
    cancelManualDockingContact();
    throw new Error('Finish chemistry before adding a required contact');
  }
  const ligandIndices = currentDockingLigandAtomIndices();
  const ligand = new Set(ligandIndices);
  if (!Number.isInteger(draft.ligandAtomIndex)) {
    if (!ligand.has(atomIndex)) throw new Error('Pick a donor or acceptor on the ligand first');
    if (!hydrogenBondFeaturePerception
      || !hydrogenBondFeaturePerception(state.molecule, atomIndex, 'acceptor')
        && !hydrogenBondFeaturePerception(state.molecule, atomIndex, 'donor'))
      throw new Error('That ligand atom is not currently a hydrogen-bond donor or acceptor');
    draft.ligandAtomIndex = atomIndex; draft.options = [];
    state.selectedAtoms = [atomIndex]; state.selectedAtom = atomIndex;
    updateGeometryControl(); updateBuildStatus(); updateDockingUi(); draw();
    return true;
  }
  if (ligand.has(atomIndex)) {
    draft.ligandAtomIndex = null; draft.receptorAtomIndex = null; draft.options = [];
    return selectManualDockingContactAtom(atomIndex);
  }
  const module = manualHydrogenBondModule || await import('./docking/manual-hbond.mjs');
  const options = module.manualHydrogenBondOptions({ molecule:state.molecule,
    ligandAtomIndices:ligandIndices, ligandAtomIndex:draft.ligandAtomIndex,
    receptorAtomIndex:atomIndex });
  if (!options.length)
    throw new Error('Those atoms do not have complementary donor/acceptor roles');
  draft.receptorAtomIndex = atomIndex;
  draft.options = options.map((entry) => ({ ligandRole:entry.ligandRole,
    receptorRole:entry.receptorRole }));
  state.selectedAtoms = [draft.ligandAtomIndex, atomIndex]; state.selectedAtom = atomIndex;
  if (draft.options.length === 1) {
    await addManualDockingContactThroughAction(draft.ligandAtomIndex, atomIndex,
      draft.options[0].ligandRole);
  } else {
    updateGeometryControl(); updateBuildStatus(); updateDockingUi(); draw();
  }
  return true;
}

function beginManualDockingContact() {
  if (!state.dockingReference) return showNotice('Begin analogue design first');
  if (state.chemistryTransaction) return showNotice('Finish chemistry before adding a contact');
  state.dockingContactDraft = { startedAt:new Date().toISOString(),
    ligandAtomIndex:null, receptorAtomIndex:null, options:[] };
  state.selectedAtoms = []; state.selectedAtom = null;
  const select = document.querySelector('#build-tool-tabs [data-tool="select"]');
  if (select && !select.classList.contains('selected')) select.click();
  updateGeometryControl(); updateBuildStatus(); updateDockingUi(); draw();
}

function renderDockingConstraints() {
  const container = document.querySelector('#docking-hbond-list');
  if (!container) return;
  container.replaceChildren();
  const definitions = state.dockingReference?.hydrogenBonds || [];
  if (!definitions.length) {
    const empty = document.createElement('span');
    empty.textContent = 'None'; container.append(empty);
    renderManualDockingContactBuilder(); return;
  }
  definitions.forEach((definition) => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    const proposal = state.dockingContactRemapProposals.get(definition.id);
    const effective = effectiveDockingHydrogenBondDefinition(definition);
    const pending = Boolean(state.chemistryTransaction);
    const available = !pending && !proposal && dockingContactAvailable(effective);
    const selectedCoreUnavailable = !pending && !available && !proposal
      && state.dockingReference?.mode !== 'pose-propagation';
    if (selectedCoreUnavailable) state.dockingSelectedHbondIds.delete(definition.id);
    checkbox.checked = state.dockingSelectedHbondIds.has(definition.id);
    checkbox.disabled = pending || selectedCoreUnavailable;
    checkbox.dataset.constraintId = definition.id;
    checkbox.setAttribute('aria-label', `Require ${definition.label}`);
    checkbox.addEventListener('change', () => {
      runChemistUiAction('pose.setContact', {
        contactId:definition.id, required:checkbox.checked,
      }).catch(() => updateDockingUi());
    });
    const text = document.createElement('span');
    const mapped = state.dockingContactRemaps.get(definition.id);
    const featureLabel = dockingContactFeatureLabel(mapped?.effectiveDefinition || definition,
      proposal);
    const suffix = pending ? ' · finish chemistry'
      : proposal?.status === 'ambiguous' ? ` · ${proposal.candidates.length} alternatives`
      : proposal?.status === 'unavailable' ? ` · ${featureLabel} removed`
      : mapped ? ` · ${featureLabel} mapped` : available ? ` · ${featureLabel}`
        : ' · atom removed or changed';
    text.textContent = `${definition.label}${suffix}`;
    if (!available) label.classList.add(pending ? 'pending-contact'
      : proposal?.status === 'ambiguous' ? 'requires-remap' : 'unavailable');
    label.append(checkbox, text);
    if (proposal?.status === 'ambiguous') {
      const select = document.createElement('select');
      select.className = 'docking-contact-remap-select';
      select.append(new Option('Refine all alternatives', ''));
      proposal.candidates.forEach((candidate) => select.append(new Option(candidate.label, candidate.id)));
      select.addEventListener('change', () => {
        if (select.value) runChemistUiAction('pose.remapContact', {
          contactId:definition.id, candidateId:select.value,
        }).catch(() => updateDockingUi());
      });
      label.append(select);
    }
    const forgettable = Boolean(definition.origin) || proposal?.status === 'unavailable';
    if (forgettable && !pending) {
      const forget = document.createElement('button'); forget.type = 'button';
      forget.className = 'forget-docking-contact'; forget.textContent = '×';
      forget.title = 'Forget this contact hypothesis';
      forget.setAttribute('aria-label', `Forget ${definition.label}`);
      forget.addEventListener('click', () => runChemistUiAction('pose.forgetContact', {
        contactId:definition.id,
      }).catch(() => updateDockingUi()));
      label.append(forget);
    }
    container.append(label);
  });
  renderManualDockingContactBuilder();
}

function updateDockingUi() {
  const panel = document.querySelector('#docking-workbench');
  if (!panel) return;
  const protein = state.structureComponents.some((component) => component.kind === 'protein');
  const ligand = dockingLigandComponent();
  const visible = Boolean(state.molecule && protein && ligand);
  panel.classList.toggle('hidden', !visible);
  const results = document.querySelector('#docking-results');
  results?.classList.toggle('hidden', !state.dockingResult || state.mode !== 'build');
  if (!visible) return;
  const capture = document.querySelector('#capture-docking-reference');
  const updateReceptor = document.querySelector('#update-docking-receptor');
  const clear = document.querySelector('#clear-docking-reference');
  const modeSelect = document.querySelector('#docking-mode');
  const cleanupField = document.querySelector('#docking-cleanup-field');
  const constraints = document.querySelector('#docking-constraints');
  const runRow = document.querySelector('#docking-run-row');
  const run = document.querySelector('#run-constrained-docking');
  if (state.dockingReference) {
    const referenceMode = state.dockingReference.mode || 'selected-core';
    const contactCount = state.dockingReference.hydrogenBonds.length;
    modeSelect.value = referenceMode === 'pose-propagation' ? 'propagate' : 'selected-core';
    modeSelect.disabled = true;
    cleanupField.classList.toggle('hidden', referenceMode !== 'pose-propagation');
    capture.classList.add('hidden'); updateReceptor.classList.remove('hidden');
    clear.classList.remove('hidden');
    constraints.classList.remove('hidden'); runRow.classList.remove('hidden');
    const pendingChemistry = Boolean(state.chemistryTransaction);
    const unresolvedSelected = unresolvedSelectedDockingContacts();
    clear.disabled = state.dockingRunning || state.chemistryEditFinishing;
    updateReceptor.disabled = state.dockingRunning || pendingChemistry
      || state.chemistryEditFinishing;
    const addContact = document.querySelector('#add-docking-contact');
    addContact.disabled = state.dockingRunning || pendingChemistry
      || state.chemistryEditFinishing;
    run.disabled = state.dockingRunning || pendingChemistry || unresolvedSelected.length > 0;
    run.textContent = state.dockingRunning ? 'Refining…'
      : referenceMode === 'pose-propagation' ? 'Refine edited group' : 'Dock';
    if (!state.dockingRunning) {
      const fixedAtoms = referenceMode === 'pose-propagation'
        ? survivingReferenceHeavyAtoms(state.dockingReference, ligand)
        : state.dockingReference.ligand.coreAtomIds.length;
      if (pendingChemistry) setDockingStatus('Finish chemistry before refining the pose.');
      else if (unresolvedSelected.length) {
        const unresolved = unresolvedSelected.map((id) =>
          state.dockingContactRemapProposals.get(id)).filter(Boolean);
        const onlyUnavailable = unresolved.every((proposal) => proposal.status === 'unavailable');
        if (onlyUnavailable && unresolved.length === 1) {
          const definition = state.dockingReference.hydrogenBonds.find((entry) =>
            entry.id === unresolved[0].id);
          setDockingStatus(`Uncheck the ${dockingContactFeatureLabel(
            definition, unresolved[0])} contact to omit it and continue.`);
        }
        else if (onlyUnavailable)
          setDockingStatus('Uncheck unavailable contacts to omit them and continue.');
        else setDockingStatus('Choose a compatible replacement feature, or uncheck that contact.');
      }
      else {
        const hypothesisCount = [...state.dockingSelectedHbondIds].reduce((sum, id) =>
          sum + (state.dockingContactRemapProposals.get(id)?.candidates?.length || 0), 0);
        setDockingStatus(`${fixedAtoms} ${referenceMode === 'pose-propagation' ? 'unchanged atoms fixed' : 'core atoms'} · ${contactCount} contact${contactCount === 1 ? '' : 's'}${hypothesisCount ? ` · ${hypothesisCount} replacement hypotheses` : ''}`);
      }
    }
    renderDockingConstraints();
  } else {
    const mode = selectedDockingMode();
    const core = dockingSelectedCore(ligand);
    modeSelect.disabled = state.dockingRunning;
    cleanupField.classList.add('hidden');
    capture.classList.remove('hidden'); updateReceptor.classList.add('hidden');
    clear.classList.add('hidden');
    constraints.classList.add('hidden'); runRow.classList.add('hidden');
    state.dockingContactDraft = null;
    capture.textContent = mode === 'pose-propagation' ? 'Begin analogue design' : 'Set selected core';
    capture.disabled = state.dockingRunning || !state.molecule.parameterization?.system
      || !ligand || mode === 'selected-core'
        && (core.length < 3 || state.selectedAtoms.length !== core.length);
    if (!state.molecule.parameterization?.system) setDockingStatus('Prepare the complex first.');
    else if (mode === 'pose-propagation')
      setDockingStatus('Begin analogue design to freeze this prepared ligand pose.');
    else if (core.length >= 3 && state.selectedAtoms.length === core.length)
      setDockingStatus(`${core.length} core atoms selected.`);
    else setDockingStatus('Select at least 3 connected ligand heavy atoms.');
  }
}

async function captureCurrentDockingReference() {
  if (!state.molecule?.parameterization?.system)
    throw new Error('Prepare and parameterize the complex before setting a docking reference.');
  const component = dockingLigandComponent();
  const mode = selectedDockingMode();
  const core = mode === 'selected-core' ? dockingSelectedCore(component) : [];
  if (!component) throw new Error('Choose one ligand component first.');
  if (mode === 'selected-core' && (core.length < 3 || core.length !== state.selectedAtoms.length))
    throw new Error('Select at least 3 connected heavy atoms from one ligand.');
  const [{ captureReferenceLigand }, { buildReceptorSite }, adapter] = await Promise.all([
    import('./docking/reference-core.mjs'), import('./docking/receptor-score.mjs'),
    import('./docking/browser-adapter.mjs'),
  ]);
  const plan = adapter.createLigandPlan(state.molecule, component.atomIndices,
    `reference-${state.molecule.source?.pdbId || 'complex'}`);
  const ligand = captureReferenceLigand(state.molecule, component.atomIndices,
    mode === 'selected-core' ? core : null,
    `reference-${state.molecule.source?.pdbId || 'complex'}`);
  const receptorSite = buildReceptorSite(state.molecule, component.atomIndices,
    state.molecule.parameterization.system, { radiusAngstrom:8 });
  // Reference constraints are scientific inputs, not drawing primitives.  Do
  // not let the viewer's display cap silently remove a valid ligand contact in
  // a hydrated protein with many shorter, unrelated hydrogen bonds.
  const interactions = nonCovalentInteractions(state.molecule, undefined, undefined,
    { hydrogenBonds:Infinity });
  const hydrogenBonds = adapter.captureCrossHydrogenBonds(state.molecule,
    component.atomIndices, interactions.hydrogenBonds);
  const receptorProvenanceAtomIndices = [...new Set([
    ...receptorSite.atoms.map((atom) => atom.globalAtomIndex),
    ...hydrogenBonds.flatMap((definition) => [definition.donor, definition.hydrogen,
      definition.acceptor].filter((descriptor) => descriptor.scope === 'receptor')
      .map((descriptor) => descriptor.sourceGlobalAtomIndex)),
  ])].sort((first, second) => first - second);
  state.dockingReference = {
    schema:'molarium.docking.browser-reference/v1',
    mode,
    capturedAt:new Date().toISOString(),
    moleculeName:state.molecule.name || 'complex',
    ligandComponentId:component.id,
    ligand,
    receptorSite,
    hydrogenBonds,
    contactAmendments:[],
    receptorProvenanceAtomCount:receptorProvenanceAtomIndices.length,
    receptorInputText:adapter.dockingInputText(state.molecule, receptorProvenanceAtomIndices),
    referenceLigandInputText:adapter.dockingInputText(state.molecule, plan.globalAtomIndices),
    forcefield:state.molecule.parameterization.forcefield || null,
    chargeModel:state.molecule.parameterization.chargeModel || null,
    sourceSha256:state.molecule.parameterization.sourceSha256 || null,
  };
  if (mode === 'pose-propagation')
    document.querySelector('#docking-edit-cleanup').value = 'preserve-reference';
  state.dockingSelectedHbondIds = new Set(hydrogenBonds.map((entry) => entry.id));
  state.dockingContactRemaps = new Map();
  state.dockingContactRemapProposals = new Map();
  state.dockingContactDraft = null;
  state.dockingResult = null; state.dockingPoseIndex = 0;
  updateDockingUi(); updateOptimizerControls();
  showToast(mode === 'pose-propagation'
    ? `Reference pose captured · ${ligand.coreAtomIds.length} heavy atoms`
    : `Docking reference set · ${core.length}-atom core`);
  return state.dockingReference;
}

function refreshCapturedReceptorDescriptors(value, atomsById) {
  if (Array.isArray(value)) return value.map((entry) =>
    refreshCapturedReceptorDescriptors(entry, atomsById));
  if (!value || typeof value !== 'object') return value;
  const refreshed = Object.fromEntries(Object.entries(value).map(([key, entry]) =>
    [key, refreshCapturedReceptorDescriptors(entry, atomsById)]));
  if (value.scope !== 'receptor' || !value.designAtomId) return refreshed;
  const current = atomsById.get(value.designAtomId);
  if (!current || current.atom.element !== value.element)
    throw new Error(`Captured receptor atom ${value.designAtomId} is unavailable`);
  refreshed.sourceGlobalAtomIndex = current.index;
  refreshed.point = { x:Number(current.atom.x), y:Number(current.atom.y), z:Number(current.atom.z) };
  return refreshed;
}

function capturedReceptorDescriptorIndices(value, output = new Set()) {
  if (Array.isArray(value)) value.forEach((entry) =>
    capturedReceptorDescriptorIndices(entry, output));
  else if (value && typeof value === 'object') {
    if (value.scope === 'receptor' && Number.isInteger(value.sourceGlobalAtomIndex))
      output.add(value.sourceGlobalAtomIndex);
    Object.values(value).forEach((entry) => capturedReceptorDescriptorIndices(entry, output));
  }
  return output;
}

async function updateCurrentDockingReceptorReference() {
  if (!state.dockingReference) throw new Error('Capture a ligand reference first.');
  if (state.chemistryTransaction)
    throw new Error('Finish or discard pending chemistry before updating the receptor reference.');
  await ensureChemistActionAtomIds();
  const reference = state.dockingReference;
  const atomsById = new Map(state.molecule.atoms.map((atom, index) =>
    [atom.designAtomId, { atom, index }]));
  const inputCoordinates = Float64Array.from(reference.receptorSite.atoms.flatMap((atom) =>
    [Number(atom.position.x), Number(atom.position.y), Number(atom.position.z)]));
  let changedAtoms = 0, maximumDisplacementAngstrom = 0;
  const siteAtoms = reference.receptorSite.atoms.map((captured) => {
    const current = atomsById.get(captured.designAtomId);
    if (!current || current.atom.element !== captured.element)
      throw new Error(`Captured receptor-site atom ${captured.designAtomId || '(missing identity)'} is unavailable`);
    const displacement = Math.hypot(current.atom.x - captured.position.x,
      current.atom.y - captured.position.y, current.atom.z - captured.position.z);
    if (displacement > 1e-6) changedAtoms += 1;
    maximumDisplacementAngstrom = Math.max(maximumDisplacementAngstrom, displacement);
    return { ...captured, globalAtomIndex:current.index,
      position:{ x:Number(current.atom.x), y:Number(current.atom.y), z:Number(current.atom.z) } };
  });
  const outputCoordinates = Float64Array.from(siteAtoms.flatMap((atom) =>
    [atom.position.x, atom.position.y, atom.position.z]));
  const inputCoordinateSha256 = await sha256Hex(inputCoordinates.buffer);
  const outputCoordinateSha256 = await sha256Hex(outputCoordinates.buffer);
  reference.receptorSite = { ...reference.receptorSite, atoms:siteAtoms };
  reference.hydrogenBonds = refreshCapturedReceptorDescriptors(
    reference.hydrogenBonds, atomsById);
  reference.contactAmendments = refreshCapturedReceptorDescriptors(
    reference.contactAmendments || [], atomsById);
  state.dockingContactRemaps = new Map([...state.dockingContactRemaps].map(([id, value]) =>
    [id, refreshCapturedReceptorDescriptors(value, atomsById)]));
  state.dockingContactRemapProposals = new Map([...state.dockingContactRemapProposals]
    .map(([id, value]) => [id, refreshCapturedReceptorDescriptors(value, atomsById)]));
  const receptorProvenanceAtomIndices = capturedReceptorDescriptorIndices(
    reference.hydrogenBonds, new Set(siteAtoms.map((atom) => atom.globalAtomIndex)));
  const adapter = await import('./docking/browser-adapter.mjs');
  reference.receptorProvenanceAtomCount = receptorProvenanceAtomIndices.size;
  reference.receptorInputText = adapter.dockingInputText(state.molecule,
    [...receptorProvenanceAtomIndices].sort((first, second) => first - second));
  const update = { schema:'molarium.docking-receptor-reference-update/v1',
    method:'retain-ligand-lineage-refresh-receptor-site',
    changedAtoms, maximumDisplacementAngstrom,
    inputCoordinateSha256, outputCoordinateSha256,
    coordinateInputClass:state.molecule.source?.designRoute?.coordinateInputClass
      || 'current-visible-complex', updatedAt:new Date().toISOString() };
  reference.receptorUpdates = [...(reference.receptorUpdates || []), update].slice(-50);
  state.dockingResult = null; state.dockingPoseIndex = 0;
  updateDockingUi(); updateOptimizerControls();
  showToast(`${changedAtoms} receptor-site atom${changedAtoms === 1 ? '' : 's'} accepted; ligand lineage retained`);
  return structuredClone(update);
}

function clearDockingReference() {
  state.dockingReference = null; state.dockingResult = null;
  state.dockingSelectedHbondIds = new Set(); state.dockingPoseIndex = 0;
  state.dockingContactRemaps = new Map();
  state.dockingContactRemapProposals = new Map();
  state.dockingContactDraft = null;
  document.querySelector('#docking-edit-cleanup').value = 'preserve-reference';
  updateDockingUi(); updateOptimizerControls();
}

function dockingProgress(message) {
  if (message?.phase) setDockingStatus(message.phase.replace(/…$/, ''));
}

function indexedNonbonded(system, atomCount) {
  const byIndex = new Map((system?.nonbonded || []).map((term, ordinal) =>
    [Number.isInteger(term.index) ? term.index : ordinal, term]));
  return Array.from({ length:atomCount }, (_, index) => {
    const term = byIndex.get(index);
    if (!term) throw new Error(`Ligand parameterization omitted atom ${index + 1}.`);
    return term;
  });
}

function automaticPoseSearchWorkerCount(chainCount, requested = null) {
  if (typeof Worker === 'undefined') return 1;
  if (requested != null) {
    const explicit = Math.round(Number(requested));
    return Number.isInteger(explicit) ? Math.max(1, Math.min(8, chainCount, explicit)) : 1;
  }
  if (chainCount < 16) return 1;
  const hardwareThreads = Math.max(1, Number(navigator.hardwareConcurrency || 4));
  return Math.min(8, Math.max(1, hardwareThreads - 1), Math.ceil(chainCount / 8));
}

function runPoseSearchWorkerPartition(worker, payload, onProgress) {
  const id = `pose-ensemble-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    const onMessage = (event) => {
      const message = event.data;
      if (message?.id !== id) return;
      if (message.type === 'progress') { onProgress(message.progress); return; }
      cleanup();
      if (message.type === 'result') resolve(message.result);
      else reject(new Error(message.message || 'Pose-search worker failed'));
    };
    const onError = (event) => {
      cleanup(); reject(new Error(event.message || 'Pose-search worker crashed'));
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({ type:'run', id, payload });
  });
}

async function runPoseSearchEnsemble({ positions, scoring, search, seed, seedMultiplier,
  requestedWorkers = null, onProgress = null } = {}) {
  const workerCount = automaticPoseSearchWorkerCount(positions.length, requestedWorkers);
  if (workerCount < 2) return null;
  const candidates = positions.map((candidatePositions, conformerIndex) => ({
    conformerIndex, positions:candidatePositions,
    seed:(seed ^ Math.imul(conformerIndex + 1, seedMultiplier)) >>> 0,
  }));
  const partitions = Array.from({ length:workerCount }, () => []);
  candidates.forEach((candidate, index) => partitions[index % workerCount].push(candidate));
  const workers = partitions.map(() => new Worker(
    new URL('./docking/pose-search-worker.mjs', import.meta.url), { type:'module' }));
  const completed = new Set();
  const started = performance.now();
  try {
    const partitionResults = await Promise.all(workers.map((worker, workerIndex) =>
      runPoseSearchWorkerPartition(worker, { scoring, search,
        candidates:partitions[workerIndex] }, (progress) => {
        if (progress?.type === 'chain-complete') completed.add(progress.conformerIndex);
        onProgress?.({ ...progress, workerIndex, workerCount,
          completedChains:completed.size, totalChains:positions.length,
          ensembleElapsedMs:performance.now() - started });
      })));
    const elapsedMs = performance.now() - started;
    const results = partitionResults.flatMap((partition) => partition.results)
      .sort((first, second) => first.conformerIndex - second.conformerIndex);
    if (results.length !== positions.length
      || results.some((entry, index) => entry.conformerIndex !== index))
      throw new Error('Pose-search ensemble returned an incomplete candidate set');
    return { results:results.map((entry) => entry.refinement), workerCount, elapsedMs,
      chainsPerSecond:elapsedMs > 0 ? results.length * 1000 / elapsedMs : null,
      backend:'deterministic Web Worker pose-chain ensemble',
      layout:'worker-partitioned independent chains; results restored to conformer order' };
  } finally {
    workers.forEach((worker) => worker.terminate());
  }
}

async function runBrowserConstrainedDocking(options = {}) {
  if (state.dockingRunning) return null;
  const reference = state.dockingReference;
  if (!reference) throw new Error('Set a docking core first.');
  if (state.chemistryTransaction)
    throw new Error('Finish or discard the pending chemistry changes before refining the pose.');
  const unresolvedSelected = unresolvedSelectedDockingContacts();
  if (unresolvedSelected.length)
    throw new Error('A selected contact has no role-compatible replacement feature; omit it or continue editing.');
  state.dockingRunning = true; state.dockingResult = null;
  updateDockingUi(); setDockingStatus('Preparing edited ligand');
  try {
    let lastBrowserYieldAt = performance.now();
    let lastProgressUpdateAt = 0;
    const yieldDuringDocking = async (progress = {}) => {
      const now = performance.now();
      if (now - lastBrowserYieldAt < 40) return;
      if (now - lastProgressUpdateAt >= 250) {
        const candidate = Number.isInteger(progress.conformerIndex)
          ? `pose ${progress.conformerIndex + 1}/${progress.conformerCount}` : 'poses';
        const stage = progress.stage || 'search';
        const fraction = Number(progress.total) > 0
          ? ` · ${Math.min(100, Math.round(Number(progress.completed || 0)
            / Number(progress.total) * 100))}%` : '';
        setDockingStatus(`Refining ${candidate} · ${stage}${fraction}`);
        lastProgressUpdateAt = now;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastBrowserYieldAt = performance.now();
    };
    const [adapter, referenceCore, receptorScore, workflow, protocolModule, labbookModule,
      torsionSearch, biasedSearch, constraints, stormmCore, remapModule, featureSeeding,
      transformedRings, poseScoring] = await Promise.all([
      import('./docking/browser-adapter.mjs'), import('./docking/reference-core.mjs'),
      import('./docking/receptor-score.mjs'), import('./docking/workflow.mjs'),
      import('./docking/protocol.mjs'), import('./docking/labbook.mjs'),
      import('./docking/torsion-search.mjs'), import('./docking/restraint-biased-search.mjs'),
      import('./docking/constraints.mjs'),
      import('./stormm/core.mjs'), import('./docking/contact-remap.mjs'),
      import('./docking/feature-seeding.mjs'),
      import('./docking/transformed-ring-region.mjs'),
      import('./docking/pose-propagation-scoring.mjs'),
    ]);
    referenceCore.ensureStableAtomIds(state.molecule,
      `design-${state.molecule.source?.pdbId || 'complex'}`);
    const posePropagation = reference.mode === 'pose-propagation';
    const effectiveHydrogenBonds = (reference.hydrogenBonds || []).map((definition) => {
      const remap = state.dockingContactRemaps.get(definition.id);
      if (remap) return remap.effectiveDefinition;
      const proposal = state.dockingContactRemapProposals.get(definition.id);
      const base = proposal?.priorEffectiveDefinition || definition;
      if (!proposal?.candidates?.length) return base;
      return { ...structuredClone(base), alternatives:proposal.candidates.map((candidate) => ({
        ...remapModule.applyLigandHydrogenBondFeatureRemap(base, candidate),
        alternativeId:candidate.id,
        matchKind:candidate.matchKind || 'role-compatible-bioisostere',
      })) };
    });
    const activeProtocol = posePropagation
      ? protocolModule.MOLARIUM_POSE_PROPAGATION_PROTOCOL
      : protocolModule.MOLARIUM_CONSTRAINT_DOCK_PROTOCOL;
    const ligandAtomIndices = currentDockingLigandAtomIndices(reference);
    if (!ligandAtomIndices.length) throw new Error('The edited ligand is no longer a separate molecular component.');
    const plan = adapter.createLigandPlan(state.molecule, ligandAtomIndices,
      `design-${state.molecule.source?.pdbId || 'complex'}`);
    const receptorIntegrity = receptorScore.receptorSiteIntegrity(reference.receptorSite, state.molecule);
    if (!receptorIntegrity.valid)
      throw new Error('The captured receptor site changed; reset the docking reference.');
    const contactParticipantIntegrity = adapter.capturedReceptorContactIntegrity(
      effectiveHydrogenBonds, state.molecule);
    if (!contactParticipantIntegrity.valid)
      throw new Error('A fixed receptor or water contact participant changed; reset the docking reference.');
    const currentLigandInputText = adapter.dockingInputText(state.molecule, plan.globalAtomIndices);
    const currentLigandTopologyText = adapter.dockingTopologyText(state.molecule, plan.globalAtomIndices);
    const releasedReferenceAtomIds = posePropagation
      ? transformedRings.cumulativeReleasedAtomIds(state.molecule) : [];
    let coreMap = posePropagation
      ? referenceCore.mapSurvivingReferenceAtoms(reference.ligand, plan.molecule.atoms,
        { releasedAtomIds:releasedReferenceAtomIds })
      : referenceCore.mapReferenceCore(reference.ligand, plan.molecule.atoms);
    if (posePropagation && !coreMap.usable) throw new Error(coreMap.reason);
    if (!posePropagation && !coreMap.complete) throw new Error(`The conserved core is incomplete (${coreMap.missingAtomIds.length} atom${coreMap.missingAtomIds.length === 1 ? '' : 's'} missing).`);
    const spatialFeatureConstraints = posePropagation
      ? Array.from(state.molecule.source?.posePropagationSpatialFeatures || [])
        .filter((feature) => feature.treatment === 'soft-restraint')
        .map((feature) => {
        const referenceById = new Map(reference.ligand.atomIds.map((id, index) => [id, index]));
        const productById = new Map(plan.molecule.atoms.map((atom, index) =>
          [atom.designAtomId, index]));
        const atomPairVariants = Array.from(feature.mappingVariants || []).map((variant) => {
          const referenceIds = Array.from(variant.referenceAtomIds || []);
          const productIds = Array.from(variant.productAtomIds || []);
          if (referenceIds.length < 3 || referenceIds.length !== productIds.length)
            throw new Error(`Spatial feature ${feature.id} has an incomplete atom map`);
          const pairs = referenceIds.map((id, index) =>
            [referenceById.get(id), productById.get(productIds[index])]);
          if (pairs.some(([referenceIndex, productIndex]) =>
            !Number.isInteger(referenceIndex) || !Number.isInteger(productIndex)))
            throw new Error(`Spatial feature ${feature.id} atom identity is unavailable`);
          return pairs;
        });
        return { id:feature.id, kind:feature.kind,
          treatment:feature.treatment, required:Boolean(feature.required),
          source:feature.source, registeredIntentId:feature.registeredIntentId || null,
          restraint:structuredClone(feature.restraint),
          atomPairVariants };
      }) : [];
    const contactAvailability = adapter.capturedHydrogenBondAvailability(effectiveHydrogenBonds,
      plan.molecule.atoms);
    const availableContactIds = new Set(contactAvailability.filter((entry) => entry.available)
      .map((entry) => entry.id));
    const unavailableSelected = [...state.dockingSelectedHbondIds]
      .filter((id) => !availableContactIds.has(id));
    if (unavailableSelected.length)
      throw new Error('A selected required contact no longer has a compatible ligand feature.');
    const selectedHbondIds = [...state.dockingSelectedHbondIds];
    const mappedHydrogenBonds = adapter.mapCapturedHydrogenBonds(effectiveHydrogenBonds,
      plan.molecule.atoms, selectedHbondIds);
    if (!mappedHydrogenBonds.complete) throw new Error('The selected H-bond mapping is inconsistent.');
    const omittedHydrogenBonds = effectiveHydrogenBonds.flatMap((definition) => {
      const availability = contactAvailability.find((entry) => entry.id === definition.id);
      if (selectedHbondIds.includes(definition.id)) return [];
      return [{ id:definition.id, label:definition.label,
        reason:availability?.available ? 'user-disabled'
          : posePropagation ? 'ligand-feature-unavailable' : 'ligand-atom-removed',
        missingAtomIds:availability?.missingAtomIds || [],
        incompatibleAtomIds:availability?.incompatibleAtomIds || [] }];
    });

    const requestedConformers = Math.max(1, Math.min(64, Math.round(Number(options.conformerCount
      ?? document.querySelector('#docking-conformer-count').value))));
    const seed = Number(options.seed ?? activeProtocol.sampling.seed);
    let coreAtomIndices = coreMap.atomPairs.map((pair) => pair[1]);
    let conformerResult, allConformers, valid, minimumRdkitEnergy = null;
    let featureSeedResult = null;
    if (posePropagation) {
      setDockingStatus(`Propagating ${coreMap.atomPairs.length} unchanged atoms`);
      const editedPositions = Float64Array.from(plan.molecule.atoms.flatMap((atom) =>
        [atom.x, atom.y, atom.z]));
      const graphEdit = state.molecule.source?.posePropagationGraphEdit || {};
      const localIndexById = new Map(plan.molecule.atoms.map((atom, index) =>
        [atom.designAtomId, index]));
      const editedAtomIndices = [...new Set([
        ...coreMap.addedAtomIds,
        ...Array.from(graphEdit.addedAtomIds || []),
      ].map((id) => localIndexById.get(id)).filter(Number.isInteger))];
      const affectedAtomIndices = [...new Set(Array.from(graphEdit.affectedCoreAtomIds || [])
        .map((id) => localIndexById.get(id)).filter(Number.isInteger))];
      featureSeedResult = featureSeeding.featureGuidedPoseSeeds({ molecule:plan.molecule,
        initialPositions:editedPositions, coreAtomIndices,
        editedAtomIndices, affectedAtomIndices,
        hydrogenBondConstraints:mappedHydrogenBonds.constraints,
        spatialFeatureConstraints,
        referencePositions:reference.ligand.positions,
        count:requestedConformers,
        featureSeedingProtocol:options.featureSeedingProtocol ?? 'v5' });
      if (!featureSeedResult.coverage?.allRequiredStrataCovered)
        throw new Error('Feature-guided pose initialization did not cover every required seed stratum');
      if (featureSeedResult.releasedCoreAtomIndices.length) {
        const releasedProductIndices = new Set(featureSeedResult.releasedCoreAtomIndices);
        const releasedEnvironmentAtomIds = featureSeedResult.releasedCoreAtomIndices
          .map((index) => plan.molecule.atoms[index]?.designAtomId).filter(Boolean);
        const releasedIdSet = new Set(releasedEnvironmentAtomIds);
        coreMap = { ...coreMap,
          atomPairs:coreMap.atomPairs.filter((pair) => !releasedProductIndices.has(pair[1])),
          mappedAtomIds:coreMap.mappedAtomIds.filter((id) => !releasedIdSet.has(id)),
          releasedReferenceAtomIds:[...new Set([
            ...(coreMap.releasedReferenceAtomIds || []), ...releasedEnvironmentAtomIds,
          ])],
          environmentReleasedAtomIds:releasedEnvironmentAtomIds };
        if (coreMap.atomPairs.length < 3)
          throw new Error('Affected-rotor sampling released too much of the inherited pose');
        coreAtomIndices = coreMap.atomPairs.map((pair) => pair[1]);
      }
      allConformers = featureSeedResult.seeds.map((entry) => entry.positions);
      valid = featureSeedResult.seeds.map(({ positions, audit }) => ({ positions, energy:null,
        forcefield:featureSeedResult.method, featureSeedAudit:audit }));
      conformerResult = { backend:'Molarium stable edit lineage + captured-feature seeding',
        rdkitVersion:null, preparationForcefield:featureSeedResult.method };
    } else {
      setDockingStatus(`Generating ${requestedConformers} conformers`);
      conformerResult = await runWorkerJob('rdkit', 'conformers', plan.molecule,
        dockingProgress, { conformerCount:requestedConformers, conformerSeed:seed,
          conformerPruneRms:0.35, conformerMinimizeIterations:100, returnEnergies:true });
      allConformers = adapter.unpackConformerStack(conformerResult.conformers,
        plan.molecule.atoms.length);
      if (!Array.isArray(conformerResult.conformerEnergies)
        || conformerResult.conformerEnergies.length !== allConformers.length)
        throw new Error('RDKit returned no auditable conformer strain energies.');
      valid = allConformers.flatMap((positions, index) => {
        const energy = Number(conformerResult.conformerEnergies[index]);
        return Number.isFinite(energy) ? [{ positions, energy,
          forcefield:conformerResult.conformerForcefields?.[index]
            || conformerResult.preparationForcefield }] : [];
      });
      if (!valid.length) throw new Error('RDKit could not score any generated ligand conformer.');
      minimumRdkitEnergy = Math.min(...valid.map((entry) => entry.energy));
    }

    setDockingStatus('Assigning edited-ligand OpenFF terms');
    const ligandParameters = await runOpenMMJob('parameters', plan.molecule, dockingProgress);
    const ligandNonbonded = indexedNonbonded(ligandParameters.system, plan.molecule.atoms.length);
    const ligandTopology = stormmCore.buildParameterizedSystem(plan.molecule, ligandParameters);
    const ligandInternalEnergy = (positions) => stormmCore.cpuEnergies(ligandTopology,
      torsionSearch.packPositions4(positions)).total;
    const fixedCoreStarts = valid.map((entry) => {
      const snapped = constraints.snapCorePositions(reference.ligand.positions,
        constraints.applyCoreTransform(entry.positions, constraints.fittedCoreTransform(
          reference.ligand.positions, entry.positions, coreMap.atomPairs)), coreMap.atomPairs);
      return posePropagation
        ? constraints.restoreCapturedLigandDonorHydrogens(snapped,
          mappedHydrogenBonds.constraints).positions
        : snapped;
    });
    const fixedCoreStartEnergies = fixedCoreStarts.map(ligandInternalEnergy);
    const fixedCoreStartHydrogenBonds = fixedCoreStarts.map((positions) =>
      workflow.evaluatePoseHydrogenBonds(mappedHydrogenBonds.constraints, positions,
        activeProtocol.hydrogenBondConstraint));
    if (fixedCoreStartEnergies.some((energy) => !Number.isFinite(energy)))
      throw new Error('OpenFF Sage returned a non-finite fixed-core ligand energy.');
    const minimumSageStartEnergy = Math.min(...fixedCoreStartEnergies);
    const generationProtocol = activeProtocol.restraintBiasedGeneration
      || biasedSearch.RESTRAINT_BIASED_SEARCH_DEFAULTS;
    const captureMaximumRelativeLigandStrainKcalMol = Number(
      generationProtocol.captureMaximumRelativeLigandStrainKcalMol ?? 100);
    const captureMaximumAdditionalStericClashes = Number(
      generationProtocol.captureMaximumAdditionalStericClashes ?? 2);
    const captureMaximumAdditionalLennardJonesKcalMol = Number(
      generationProtocol.captureMaximumAdditionalLennardJonesKcalMol ?? 100);
    const rawReceptorScoreFor = (positions, sageInternalEnergyKcalMol) =>
      receptorScore.scoreReceptorLigand(reference.receptorSite, positions, ligandNonbonded, {
          relativeDielectric:Number(activeProtocol.scoring.relativeDielectric ?? 4),
          cutoffAngstrom:Number(activeProtocol.scoring.pairCutoffAngstrom ?? 8),
          ligandStrainKcalMol:sageInternalEnergyKcalMol - minimumSageStartEnergy,
          ligandStrainIdentity:'relative vacuum OpenFF Sage 2.1 intramolecular energy' });
    const fixedCoreStartPhysical = fixedCoreStarts.map((positions, index) =>
      rawReceptorScoreFor(positions, fixedCoreStartEnergies[index]));
    const interactionReferenceKcalMol = Math.min(...fixedCoreStartPhysical
      .map((entry) => Number(entry.interactionKcalMol)));
    if (!Number.isFinite(interactionReferenceKcalMol))
      throw new Error('The inherited fixed-scaffold interaction reference is non-finite.');
    const minimumFixedCoreStartStericClashes = Math.min(...fixedCoreStartPhysical
      .map((entry) => Number(entry.stericClashes)));
    const minimumFixedCoreStartLennardJonesKcalMol = Math.min(...fixedCoreStartPhysical
      .map((entry) => Number(entry.lennardJonesKcalMol)));
    const poseScoringContext = {
      molecule:plan.molecule,
      ligandParameters,
      receptorSite:reference.receptorSite,
      referenceLigandPositions:reference.ligand.positions,
      coreAtomPairs:coreMap.atomPairs,
      coreAtomIndices,
      hydrogenBondConstraints:mappedHydrogenBonds.constraints,
      spatialFeatureConstraints,
      protocol:activeProtocol,
      minimumSageStartEnergy,
      interactionReferenceKcalMol,
      minimumFixedCoreStartStericClashes,
      minimumFixedCoreStartLennardJonesKcalMol,
      captureMaximumRelativeLigandStrainKcalMol,
      captureMaximumAdditionalStericClashes,
      captureMaximumAdditionalLennardJonesKcalMol,
    };
    const sharedPoseScoring = poseScoring.createPosePropagationScoring(poseScoringContext);
    const { scorePositions, scoreRestraintCapturePositions } = sharedPoseScoring;
    const torsionProtocol = activeProtocol.torsionMonteCarlo || torsionSearch.TORSION_SEARCH_DEFAULTS;
    const torsionSteps = Math.max(0, Math.min(512, Math.round(Number(options.torsionSteps
      ?? generationProtocol.physicalRefinementStepsDefault
      ?? generationProtocol.stepsDefault ?? torsionProtocol.stepsDefault
      ?? activeProtocol.sampling.torsionMonteCarloSteps ?? 96))));
    const captureSteps = Math.max(0, Math.min(512, Math.round(Number(options.captureSteps
      ?? generationProtocol.captureStepsDefault ?? torsionSteps))));
    const capturePolishSweeps = Math.max(0, Math.min(8,
      Math.round(Number(options.capturePolishSweeps
        ?? generationProtocol.capturePolishSweeps ?? 3))));
    const fixedRelaxProtocol = activeProtocol.fixedScaffoldRelaxation || {};
    const fixedRelaxIterations = posePropagation ? Math.max(0, Math.min(250,
      Math.round(Number(options.fixedRelaxIterations
        ?? fixedRelaxProtocol.iterationsDefault ?? 60)))) : 0;
    const startedAt = new Date().toISOString();
    const inputs = await labbookModule.inputProvenance({
      receptorText:reference.receptorInputText,
      ligandText:currentLigandInputText,
      receptorLabel:`${reference.moleculeName} · rigid 8 Å site and fixed contact participants`,
      ligandLabel:plan.molecule.name,
      receptorAtoms:reference.receptorProvenanceAtomCount || reference.receptorSite.atoms.length,
      ligandAtoms:plan.molecule.atoms.length,
    });
    const referenceLigandSha256 = await labbookModule.sha256Text(reference.referenceLigandInputText);
    const runId=`${posePropagation ? 'pose-propagation' : 'constraint-dock'}-${Date.now().toString(36)}-${seed}`;
    const labbook = await labbookModule.createLabbook({ runId, startedAt, inputs,
      protocol:activeProtocol,
      selections:{
        referenceLigandSha256,
        coreAtomPairs:coreMap.atomPairs,
        coreAtomIds:posePropagation ? [...coreMap.mappedAtomIds] : [...reference.ligand.coreAtomIds],
        atomLineage:posePropagation ? {
          mapping:'stable designAtomId from recorded Molarium graph edits',
          inheritedAtomIds:[...coreMap.mappedAtomIds],
          addedAtomIds:[...coreMap.addedAtomIds],
          removedAtomIds:[...coreMap.removedAtomIds],
          changedElementAtomIds:[...coreMap.changedElementAtomIds],
          releasedReferenceAtomIds:[...(coreMap.releasedReferenceAtomIds || [])],
        } : null,
        editPreparation:posePropagation ? {
          selectedCleanupMode:selectedDockingEditCleanup(),
          interactivePolishHistory:structuredClone(
            state.molecule.source?.interactivePolishHistory || []),
        } : null,
        hydrogenBonds:mappedHydrogenBonds.constraints.map((entry) => ({
          id:entry.id, label:entry.label, required:entry.required, receptorRole:entry.receptorRole,
          alternativeIds:(entry.alternatives || []).map((alternative) => alternative.id),
          origin:structuredClone(reference.hydrogenBonds
            .find((definition) => definition.id === entry.id)?.origin || null),
          ligandFeatureRemap:structuredClone(
            state.dockingContactRemaps.get(entry.id)?.audit || null),
        })),
        spatialFeatures:spatialFeatureConstraints.map((feature) => ({
          id:feature.id, kind:feature.kind, treatment:feature.treatment,
          required:feature.required, source:feature.source,
          registeredIntentId:feature.registeredIntentId,
          restraint:structuredClone(feature.restraint),
          candidateMaps:feature.atomPairVariants.length,
          atomCount:feature.atomPairVariants[0]?.length || 0,
        })),
        contactAmendments:structuredClone(reference.contactAmendments || []),
        droppedHydrogenBondAlternatives:structuredClone(
          mappedHydrogenBonds.droppedAlternatives || []),
        ligandFeatureRemaps:[...state.dockingContactRemaps.values()]
          .flatMap((entry) => structuredClone(entry.chain || [entry.audit])),
        fixedReceptorContactParticipantIds:[...new Set(reference.hydrogenBonds.flatMap((definition) =>
          [definition.donor, definition.hydrogen, definition.acceptor]
            .filter((descriptor) => descriptor.scope === 'receptor')
            .map((descriptor) => descriptor.designAtomId)))],
        omittedHydrogenBonds,
      },
      environment:{ execution:'browser-local', networkUsed:false, webgpuAvailable:Boolean(navigator.gpu),
        userAgent:navigator.userAgent, deterministicSeed:seed,
        receptorForcefield:reference.forcefield, receptorChargeModel:reference.chargeModel,
        receptorSourceSha256:reference.sourceSha256,
        ligandForcefield:ligandParameters.forcefield, ligandChargeModel:ligandParameters.chargeModel,
        ligandSourceSha256:ligandParameters.sourceSha256,
        conformerBackend:conformerResult.backend, rdkitVersion:conformerResult.rdkitVersion,
        conformerPreparationForcefields:[...new Set(valid.map((entry) => entry.forcefield).filter(Boolean))],
      },
      application:{ version:'1.0.0', feature:activeProtocol.name },
    });
    if (state.dockingContactRemaps.size || state.dockingContactRemapProposals.size)
      await labbookModule.appendLabbookEvent(labbook, { at:new Date().toISOString(),
        stage:'captured-contact-feature-mapping', status:'recorded', details:{
          algorithm:'role-compatible-edit-boundary/v3',
          policy:'all donor/acceptor-role-compatible features on the connected edit boundary are hypotheses; multiple hypotheses use an any-of restraint and physical/strain ranking; geometry never establishes eligibility',
          applied:[...state.dockingContactRemaps.values()]
            .flatMap((entry) => structuredClone(entry.chain || [entry.audit])),
          unresolved:[...state.dockingContactRemapProposals.values()].map((entry) => ({
            contactId:entry.id, status:entry.status, ligandRole:entry.ligandRole,
            originalFeatureSignature:entry.originalFeatureSignature,
            boundaryAnchorIds:[...(entry.boundaryAnchorIds || [])],
            cumulativeEditRegionAtomIds:[...(entry.cumulativeEditRegionAtomIds || [])],
            editLineage:structuredClone(entry.editLineage || []),
            candidateIds:entry.candidates.map((candidate) => candidate.id),
          })),
        } });
    if (reference.contactAmendments?.length)
      await labbookModule.appendLabbookEvent(labbook, { at:new Date().toISOString(),
        stage:'contact-hypothesis-amendments', status:'recorded', details:{
          policy:'manual contact hypotheses use two visible atom selections, inferred complementary roles, and deterministic feature-guided pose seeding',
          amendments:structuredClone(reference.contactAmendments),
        } });
    await labbookModule.appendLabbookEvent(labbook, { at:new Date().toISOString(),
      stage:'method-configuration', status:'locked', details:{
        receptorModel:'rigid', receptorSiteRadiusAngstrom:8,
        relativeDielectric:Number(activeProtocol.scoring.relativeDielectric ?? 4),
        combiningRules:'Lorentz-Berthelot',
        crossTerms:['Lennard-Jones', 'Coulomb'],
        ligandStrain:'relative vacuum OpenFF Sage 2.1 intramolecular energy from lowest fixed-core starting seed',
        hardCore:posePropagation
          ? 'surviving reference heavy atoms outside registered transformed regions fixed exactly by stable edit lineage'
          : 'user-selected matched core atoms snapped exactly to reference coordinates',
        editCleanup:posePropagation ? {
          selected:selectedDockingEditCleanup(),
          preserveReference:'fix every inherited heavy atom; move only new atoms and hydrogens',
          freeLocal:'move the edited two-bond neighborhood and each touched fused ring as a unit',
        } : null,
        restraintBiasedGeneration:posePropagation ? {
          method:biasedSearch.RESTRAINT_BIASED_SEARCH_DEFAULTS.method,
          captureSteps, capturePolishSweeps, physicalRefinementSteps:torsionSteps,
          temperatureStartKelvin:Number(generationProtocol.temperatureStartKelvin),
          temperatureEndKelvin:Number(generationProtocol.temperatureEndKelvin),
          torsionAnglesDegrees:[...generationProtocol.torsionAnglesDegrees],
          ringCrankshaftAnglesDegrees:[...generationProtocol.ringCrankshaftAnglesDegrees],
          localLineFractions:[...generationProtocol.localLineFractions],
          captureObjective:'selected required-contact flat-bottom penalties plus registered chemical-sanity gate excess penalties',
          captureMaximumRelativeLigandStrainKcalMol,
          captureMaximumAdditionalStericClashes,
          captureMaximumAdditionalLennardJonesKcalMol,
          minimumFixedCoreStartStericClashes,
          minimumFixedCoreStartLennardJonesKcalMol,
          physicalStageGate:'starts only after contact capture and chemical-sanity validation; feasible-to-infeasible moves are rejected',
        } : { method:torsionSearch.TORSION_SEARCH_DEFAULTS.method, steps:torsionSteps,
          temperatureStartKelvin:Number(torsionProtocol.temperatureStartKelvin),
          temperatureEndKelvin:Number(torsionProtocol.temperatureEndKelvin),
          proposalAnglesDegrees:[...torsionProtocol.proposalAnglesDegrees] },
        fixedScaffoldRelaxation:posePropagation ? {
          engine:'OpenMM WebAssembly', forcefield:'OpenFF Sage 2.1',
          iterations:fixedRelaxIterations, fixedHeavyAtoms:coreAtomIndices.length,
          stepScale:Number(fixedRelaxProtocol.stepScale ?? 1e-4),
          maximumDisplacementAngstromPerIteration:Number(
            fixedRelaxProtocol.maximumDisplacementAngstromPerIteration ?? 0.01),
          environment:'vacuum', constraintMode:'none', receptorIncluded:false,
          acceptance:'retain only if constraint feasibility is not lost and the complete ranking objective improves',
        } : null,
        featureGuidedSeeding:posePropagation && featureSeedResult ? {
          method:featureSeedResult.method,
          requested:featureSeedResult.requestedCount,
          uniqueSeeds:featureSeedResult.uniqueSeedCount,
          targetVariants:featureSeedResult.targetVariantCount,
          spatialFeatureMaps:featureSeedResult.spatialFeatureMapCount,
          untargetedEditRotors:featureSeedResult.untargetedRotorCount,
          affectedExistingRotors:featureSeedResult.affectedRotorCount,
          affectedRotorReleases:featureSeedResult.releasedCoreAtomIndices.length,
          editRegionAnglesDegrees:featureSeedResult.editRegionAnglesDegrees,
          coverage:structuredClone(featureSeedResult.coverage),
          limitation:featureSeedResult.limitation,
        } : null,
        feasibilityRule:'all required constraints rank before energy',
        omitted:['receptor relaxation', 'receptor grid', 'desolvation', 'entropy',
          'macrocycle-specific moves', 'binding free energy'],
      } });
    await labbookModule.appendLabbookEvent(labbook, { at:new Date().toISOString(),
      stage:'method-decision', status:'recorded', details:{
        selected:posePropagation
          ? 'reference-pose propagation through recorded graph edits, restraint-biased internal-coordinate generation, and fixed-scaffold Sage relaxation'
          : 'independent fixed-core torsion Monte Carlo under the active receptor and restraint score',
        rationale:[
          posePropagation
            ? 'Recorded graph edits provide exact atom correspondence, so an inferred or manually selected core is unnecessary.'
            : 'Rigid core alignment alone does not optimize ligand torsions against the receptor.',
          'Edit-lineage atom identity gives an exact, auditable analogue mapping.',
          'Chemically transformed rings are released as complete units while their unchanged external scaffold boundary remains fixed.',
          ...(posePropagation && featureSeedResult ? [!featureSeedResult.method.endsWith('/v3')
            ? 'A pre-existing non-ring single bond is resampled when added, deleted, or substituted atoms alter its local graph environment; conjugated amide-like and ring bonds remain fixed.'
            : 'Pinned feature-seeding protocol v3 samples untargeted edit-region torsions but leaves affected pre-existing rotors fixed.'] : []),
          'Only graph branches containing no fixed scaffold atom are eligible to rotate; local ring moves touching a perceived stereocenter, ring multiple-bond atom, carbonyl, or lactam geometry are excluded.',
          'A pharmacophore-capture stage drives every torsion and safe ring proposal before ordinary physical energy is allowed to act; only registered chemical-sanity gates accompany the restraint objective.',
          'A captured contact is not called feasible when its ligand strain exceeds 100 kcal/mol above the best exact-core start or it introduces more than two additional steric-clash diagnostics.',
          'Required contacts are explicit feasible states and cannot be traded away for a lower energy.',
          'A deleted ligand contact atom can transfer to any complementary donor or acceptor created at the same recorded edit boundary; receptor participants remain immutable and physical refinement ranks the hypotheses.',
          ...(posePropagation ? [
            'Only capture-feasible poses enter physical search and fixed-scaffold OpenFF relaxation; a failed capture remains an explicit negative result.',
            'Fixed-scaffold OpenFF relaxation repairs local valence geometry without moving inherited heavy atoms.',
            'A relaxed pose is rejected if it loses contact feasibility or worsens the complete receptor-aware objective.',
          ] : []),
        ],
        relatedMethods:[
          ...(posePropagation ? [
            { method:'RBFE practical guidance', use:'published protocol basis',
              adopted:'reference common-region placement plus sampling of modified substituents' },
            { method:'Ohadi et al. FEP input-pose benchmark', use:'published empirical motivation',
              adopted:'MCS/reference information and explicit H-bond constraints' },
            { method:'TEMPL', use:'published template-pose baseline',
              adopted:'hard reference coordinates for mapped atoms',
              notAdopted:'template database search and shape-only ranking' },
          ] : []),
          { method:'Rowan openconf analogue mode', use:'method inspiration only',
            adopted:'free terminal rotors outside a fixed core plus exact post-search core snap',
            notAdopted:'openconf code, CrystalFF library, MMFF minimization, ring and macrocycle moves' },
          { method:'AutoPose', use:'related congeneric pose-construction alternative',
            notAdopted:'R-group decomposition, Free-Wilson model and TMD RBFE workflow' },
          { method:'Glide and ICM', use:'published staged/internal-coordinate docking lineage',
            notAdopted:'commercial grids, scores, defaults, code, or ICM Biased Probability Monte Carlo kernel' },
        ],
        omittedReferenceContacts:omittedHydrogenBonds,
      } });
    await labbookModule.appendLabbookEvent(labbook, { at:new Date().toISOString(),
      stage:'ligand-preparation', status:'completed', details:{
        requestedConformers, generatedConformers:allConformers.length,
        finiteScoredConformers:valid.length, seed,
        conformerBackend:conformerResult.backend, rdkitVersion:conformerResult.rdkitVersion,
        conformerForcefields:[...new Set(valid.map((entry) => entry.forcefield).filter(Boolean))],
        featureGuidedSeeding:featureSeedResult ? {
          method:featureSeedResult.method,
          requested:featureSeedResult.requestedCount,
          uniqueSeeds:featureSeedResult.uniqueSeedCount,
          targetVariants:featureSeedResult.targetVariantCount,
          spatialFeatureMaps:featureSeedResult.spatialFeatureMapCount,
          untargetedEditRotors:featureSeedResult.untargetedRotorCount,
          affectedExistingRotors:featureSeedResult.affectedRotorCount,
          affectedRotorReleases:featureSeedResult.releasedCoreAtomIndices.length,
          editRegionAnglesDegrees:featureSeedResult.editRegionAnglesDegrees,
          coverage:structuredClone(featureSeedResult.coverage),
          limitation:featureSeedResult.limitation,
          seeds:valid.map((entry, index) => ({ conformerIndex:index,
            ...structuredClone(entry.featureSeedAudit),
            hydrogenBonds:fixedCoreStartHydrogenBonds[index].map((constraint) => ({
              id:constraint.id,
              selectedAlternativeId:constraint.selectedAlternativeId || null,
              satisfied:constraint.satisfied,
              donorAcceptorDistanceAngstrom:constraint.donorAcceptorDistanceAngstrom,
              hydrogenAcceptorDistanceAngstrom:constraint.hydrogenAcceptorDistanceAngstrom,
              dhaAngleDegrees:constraint.dhaAngleDegrees,
              penaltyKcalMol:constraint.penaltyKcalMol,
            })),
          })),
        } : null,
        minimumConformerEnergyKcalMol:minimumRdkitEnergy,
        minimumFixedCoreSageEnergyKcalMol:minimumSageStartEnergy,
        minimumFixedCoreStartStericClashes,
        ligandForcefield:ligandParameters.forcefield,
        ligandChargeModel:ligandParameters.chargeModel,
        ligandParameterSourceSha256:ligandParameters.sourceSha256,
    } });
    setDockingStatus(`${posePropagation ? 'Generating' : 'Optimizing'} ${valid.length} restrained poses`);
    let refinementAudit = [];
    let poseSearchExecution = {
      backend:'browser main-thread serial search', workerCount:1,
      chainCount:valid.length, elapsedMs:null, chainsPerSecond:null,
      deterministicOrdering:'conformer index', fallbackReason:null,
    };
    const seedMultiplier = Number(activeProtocol.candidateInitialization
      ?.candidateSeedXorMultiplierUint32 ?? 0x9e3779b9) >>> 0;
    const runPoseGeneration = (positions, conformerIndex) => {
      setDockingStatus(`Generating restrained pose ${conformerIndex + 1}/${valid.length}`);
      const yieldControl = (progress) => yieldDuringDocking({ ...progress,
        conformerIndex, conformerCount:valid.length });
      const conformerSeed = (seed ^ Math.imul(conformerIndex + 1, seedMultiplier)) >>> 0;
      if (posePropagation) return biasedSearch.generatePoseByRestraintBiasedSearch({
        molecule:plan.molecule, initialPositions:positions, coreAtomIndices,
        restraintScorePose:scoreRestraintCapturePositions, physicalScorePose:scorePositions,
        random:stormmCore.mulberry32(conformerSeed), seed:conformerSeed,
        captureSteps, capturePolishSweeps, refinementSteps:torsionSteps,
        temperatureStartKelvin:Number(generationProtocol.temperatureStartKelvin),
        temperatureEndKelvin:Number(generationProtocol.temperatureEndKelvin),
        torsionAnglesDegrees:[...generationProtocol.torsionAnglesDegrees],
        ringCrankshaftAnglesDegrees:[...generationProtocol.ringCrankshaftAnglesDegrees],
        localLineFractions:[...generationProtocol.localLineFractions], yieldControl });
      return torsionSearch.refinePoseByTorsionMonteCarlo({ molecule:plan.molecule,
        initialPositions:positions, coreAtomIndices, scorePose:scorePositions,
        random:stormmCore.mulberry32(conformerSeed), seed:conformerSeed, steps:torsionSteps,
        temperatureStartKelvin:Number(torsionProtocol.temperatureStartKelvin),
        temperatureEndKelvin:Number(torsionProtocol.temperatureEndKelvin),
        proposalAnglesDegrees:[...torsionProtocol.proposalAnglesDegrees], yieldControl });
    };
    const refinePropagatedBatch = async ({ positions }) => {
      let torsionRuns = [];
      try {
        let lastEnsembleStatusAt = 0;
        const ensemble = await runPoseSearchEnsemble({ positions,
          scoring:poseScoringContext,
          search:{ captureSteps, capturePolishSweeps, refinementSteps:torsionSteps,
            temperatureStartKelvin:Number(generationProtocol.temperatureStartKelvin),
            temperatureEndKelvin:Number(generationProtocol.temperatureEndKelvin),
            torsionAnglesDegrees:[...generationProtocol.torsionAnglesDegrees],
            ringCrankshaftAnglesDegrees:[...generationProtocol.ringCrankshaftAnglesDegrees],
            localLineFractions:[...generationProtocol.localLineFractions] },
          seed, seedMultiplier, requestedWorkers:options.poseSearchWorkers,
          onProgress:(progress) => {
            const now = performance.now();
            if (progress.type === 'chain-progress' && now - lastEnsembleStatusAt >= 250) {
              const stage = progress.stage || 'search';
              const fraction = Number(progress.total) > 0
                ? ` · ${Math.min(100, Math.round(Number(progress.completed || 0)
                  / Number(progress.total) * 100))}%` : '';
              setDockingStatus(`Refining pose ${progress.conformerIndex + 1}/${progress.totalChains} · ${stage}${fraction} · ${progress.workerCount}-worker ensemble`);
              lastEnsembleStatusAt = now;
              return;
            }
            if (progress.type !== 'chain-complete') return;
            const elapsedSeconds = Math.max(0.001, progress.ensembleElapsedMs / 1000);
            const rate = progress.completedChains / elapsedSeconds;
            setDockingStatus(`Pose ensemble · ${progress.completedChains}/${progress.totalChains} chains · ${progress.workerCount} workers · ${rate.toFixed(1)} chains/s`);
            lastEnsembleStatusAt = now;
          } });
        if (ensemble) {
          torsionRuns = ensemble.results;
          poseSearchExecution = { backend:ensemble.backend,
            layout:ensemble.layout, workerCount:ensemble.workerCount,
            chainCount:positions.length, elapsedMs:ensemble.elapsedMs,
            chainsPerSecond:ensemble.chainsPerSecond,
            deterministicOrdering:'independent per-chain seed; results restored to conformer index',
            fallbackReason:null };
          setDockingStatus(`Pose ensemble complete · ${positions.length} chains · ${ensemble.workerCount} workers · ${ensemble.chainsPerSecond.toFixed(1)} chains/s`);
        }
      } catch (error) {
        poseSearchExecution.fallbackReason = error instanceof Error ? error.message : String(error);
        setDockingStatus('Pose workers unavailable · continuing deterministic serial search');
      }
      if (!torsionRuns.length) {
        const serialStarted = performance.now();
        for (let index = 0; index < positions.length; index++)
          torsionRuns.push(await runPoseGeneration(positions[index], index));
        const serialElapsedMs = performance.now() - serialStarted;
        poseSearchExecution = { ...poseSearchExecution,
          elapsedMs:serialElapsedMs,
          chainsPerSecond:positions.length * 1000 / Math.max(1, serialElapsedMs) };
      }
      if (!fixedRelaxIterations || coreAtomIndices.length >= plan.molecule.atoms.length)
        return torsionRuns.map((entry) => ({ ...entry, relaxation:{
          method:'OpenMM fixed-scaffold Sage relaxation', iterations:0,
          accepted:false, reason:'no movable atoms or zero requested iterations',
        } }));
      const eligibleIndices = torsionRuns.flatMap((entry, index) =>
        entry.captureFeasible ? [index] : []);
      if (!eligibleIndices.length) return torsionRuns.map((entry) => ({ ...entry, relaxation:{
        method:'OpenMM fixed-scaffold Sage relaxation', iterations:0,
        accepted:false, reason:'skipped because pharmacophore capture was infeasible',
      } }));
      setDockingStatus(`Relaxing ${eligibleIndices.length} captured fixed-scaffold poses`);
      const stride = plan.molecule.atoms.length * 3;
      const coordinateStack = new Float64Array(eligibleIndices.length * stride);
      eligibleIndices.forEach((sourceIndex, index) =>
        coordinateStack.set(torsionRuns[sourceIndex].positions, index * stride));
      const parameterizedLigand = { ...plan.molecule, parameterization:ligandParameters };
      const relaxed = await runOpenMMJob('fixed-conformers', parameterizedLigand,
        dockingProgress, { initialConformers:coordinateStack,
          fixedAtomIndices:coreAtomIndices, fixedRelaxIterations,
          fixedRelaxStepScale:Number(fixedRelaxProtocol.stepScale ?? 1e-4),
          fixedRelaxMaximumDisplacementAngstrom:Number(
            fixedRelaxProtocol.maximumDisplacementAngstromPerIteration ?? 0.01),
          constraintMode:'none', implicitSolvent:'vacuum' });
      return torsionRuns.map((entry, index) => {
        const relaxedIndex = eligibleIndices.indexOf(index);
        if (relaxedIndex < 0) return { ...entry, relaxation:{
          method:'OpenMM fixed-scaffold Sage relaxation', iterations:0,
          accepted:false, reason:'skipped because pharmacophore capture was infeasible',
        } };
        const relaxedPositions = relaxed.conformers.slice(relaxedIndex * stride,
          (relaxedIndex + 1) * stride);
        const before = scorePositions(entry.positions), after = scorePositions(relaxedPositions);
        const accepted = Number(after.feasible) > Number(before.feasible)
          || after.feasible === before.feasible
            && after.objectiveKcalMol < before.objectiveKcalMol;
        return { ...entry, positions:accepted ? relaxedPositions : entry.positions,
          relaxation:{ method:'OpenMM fixed-scaffold Sage relaxation',
            engine:relaxed.backend, forcefield:relaxed.forcefield,
            iterations:relaxed.iterations, fixedAtomCount:relaxed.fixedAtomCount,
            movableAtomCount:relaxed.movableAtomCount, accepted,
            stepScale:relaxed.stepScale,
            maximumDisplacementAngstromPerIteration:relaxed.maximumDisplacementAngstrom,
            initialInternalEnergyKcalMol:relaxed.initialEnergies[relaxedIndex],
            finalInternalEnergyKcalMol:relaxed.finalEnergies[relaxedIndex],
            objectiveBeforeKcalMol:before.objectiveKcalMol,
            objectiveAfterKcalMol:after.objectiveKcalMol,
            feasibleBefore:before.feasible, feasibleAfter:after.feasible,
            reason:accepted ? 'complete constrained objective improved'
              : 'retained torsion-search pose to protect feasibility or ranking objective',
          } };
      });
    };
    const run = await workflow.runConstrainedDocking({
      referencePositions:reference.ligand.positions,
      candidateConformers:valid.map((entry) => entry.positions),
      coreAtomPairs:coreMap.atomPairs,
      hydrogenBondConstraints:mappedHydrogenBonds.constraints,
      capturedLigandHydrogenRestoration:posePropagation,
      protocol:activeProtocol,
      ...(posePropagation
        ? { refineBatch:refinePropagatedBatch }
        : { refinePose:({ positions, conformerIndex }) =>
          runPoseGeneration(positions, conformerIndex) }),
      physicalScore:({ positions }) => {
        const scored = scorePositions(positions);
        return { ...scored.physical, feasible:scored.chemicalValidity.valid,
          chemicalValidity:scored.chemicalValidity };
      },
      yieldControl:yieldDuringDocking,
      afterRefinement:async (candidates) => {
        refinementAudit = candidates.map((pose) => ({
          conformerIndex:pose.conformerIndex,
          method:pose.refinement?.method || null,
          seed:pose.refinement?.seed ?? null,
          rotatableBondCount:pose.refinement?.rotatableBondCount || 0,
          ringCrankshaftMoveCount:pose.refinement?.ringCrankshaftMoveCount || 0,
          internalCoordinateMoveCount:pose.refinement?.moveCount
            ?? pose.refinement?.rotatableBondCount ?? 0,
          proposals:pose.refinement?.proposals || 0,
          lineEvaluations:pose.refinement?.lineEvaluations || 0,
          accepted:pose.refinement?.accepted || 0,
          uphillAccepted:pose.refinement?.uphillAccepted || 0,
          improved:pose.refinement?.improved || 0,
          acceptanceRate:pose.refinement?.acceptanceRate || 0,
          objectiveStage:pose.refinement?.objectiveStage || null,
          startObjectiveKcalMol:pose.refinement?.startObjectiveKcalMol ?? null,
          bestObjectiveKcalMol:pose.refinement?.bestObjectiveKcalMol ?? null,
          selectedFeasible:Boolean(pose.refinement?.selectedFeasible),
          stageOutcome:pose.refinement?.stageOutcome || null,
          captureFeasible:Boolean(pose.refinement?.captureFeasible),
          physicalRefinementAttempted:Boolean(pose.refinement?.physicalRefinementAttempted),
          capture:pose.refinement?.capture || null,
          physicalRefinement:pose.refinement?.physicalRefinement || null,
          relaxation:pose.refinement?.relaxation || null,
          moves:pose.refinement?.moves || pose.refinement?.rotors || [],
        }));
        await labbookModule.appendLabbookEvent(labbook, { at:new Date().toISOString(),
          stage:posePropagation ? 'in-pocket-restraint-biased-generation'
            : 'in-pocket-torsion-search', status:'completed', details:{
            method:posePropagation ? biasedSearch.RESTRAINT_BIASED_SEARCH_DEFAULTS.method
              : torsionSearch.TORSION_SEARCH_DEFAULTS.method,
            conformers:refinementAudit.length,
            conformersWithFreeRotors:refinementAudit.filter((entry) => entry.rotatableBondCount > 0).length,
            conformersWithRingMoves:refinementAudit.filter((entry) =>
              entry.ringCrankshaftMoveCount > 0).length,
            totalRingCrankshaftMoves:refinementAudit.reduce((sum, entry) =>
              sum + entry.ringCrankshaftMoveCount, 0),
            totalProposals:refinementAudit.reduce((sum, entry) => sum + entry.proposals, 0),
            totalLineEvaluations:refinementAudit.reduce((sum, entry) =>
              sum + entry.lineEvaluations, 0),
            totalAccepted:refinementAudit.reduce((sum, entry) => sum + entry.accepted, 0),
            totalImprovements:refinementAudit.reduce((sum, entry) => sum + entry.improved, 0),
            fixedScaffoldRelaxations:refinementAudit.filter((entry) =>
              Number(entry.relaxation?.iterations || 0) > 0).length,
            skippedRelaxationsAfterFailedCapture:refinementAudit.filter((entry) =>
              entry.stageOutcome === 'capture-infeasible').length,
            acceptedFixedScaffoldRelaxations:refinementAudit.filter((entry) =>
              entry.relaxation?.accepted).length,
            restraintParticipation:posePropagation
              ? 'stage 1 generates against selected flat-bottom contact potentials under explicit strain/clash sanity gates; stage 2 starts only after valid capture and rejects every move that loses feasibility'
              : 'required-contact feasibility and penalty were evaluated after each torsion proposal',
            poseSearchExecution:structuredClone(poseSearchExecution),
            exactCoreMaximumRmsdAngstrom:Math.max(...candidates.map((pose) => pose.core.rmsdAngstrom)),
            perConformer:refinementAudit,
          } });
        if (posePropagation) await labbookModule.appendLabbookEvent(labbook, {
          at:new Date().toISOString(), stage:'fixed-scaffold-relaxation', status:'completed',
          details:{
            engine:'OpenMM WebAssembly', forcefield:ligandParameters.forcefield,
            fixedAtomCount:coreAtomIndices.length,
            requestedIterations:fixedRelaxIterations,
            attempted:refinementAudit.filter((entry) =>
              Number(entry.relaxation?.iterations || 0) > 0).length,
            skippedAfterFailedCapture:refinementAudit.filter((entry) =>
              entry.stageOutcome === 'capture-infeasible').length,
            accepted:refinementAudit.filter((entry) => entry.relaxation?.accepted).length,
            invariant:'all inherited heavy-atom coordinates remain bit-for-bit equal to the reference',
            safeguard:'a relaxed pose is retained only when feasibility is preserved and the complete objective improves',
            perConformer:refinementAudit.map((entry) => ({ conformerIndex:entry.conformerIndex,
              relaxation:entry.relaxation })),
          },
        });
      },
      // The labbook origin predates provenance hashing and method events. The
      // workflow event begins here, after those records have been appended.
      labbook, startedAt:new Date().toISOString(),
    });
    const distinctPoseEntries = distinctDockingPoseEntries(run.candidates, plan.molecule.atoms);
    const distinctFeasibleCount = distinctPoseEntries
      .filter((entry) => entry.pose.feasible).length;
    await labbookModule.completeLabbook(labbook, { completedAt:new Date().toISOString(), outcome:{
      workflowMode:posePropagation ? 'reference-pose propagation' : 'selected-core constrained search',
      inheritedHeavyAtoms:coreMap.atomPairs.length,
      addedHeavyAtoms:posePropagation ? coreMap.addedAtomIds.length : null,
      removedHeavyAtoms:posePropagation ? coreMap.removedAtomIds.length : null,
      generatedConformers:allConformers.length,
      scoredConformers:run.candidates.length,
      feasiblePoses:run.feasibleCount,
      searchChains:run.candidates.length,
      poseSearchExecution:structuredClone(poseSearchExecution),
      distinctPoses:distinctPoseEntries.length,
      distinctFeasiblePoses:distinctFeasibleCount,
      selectedRank:run.selected.rank,
      selectedScoreKcalMol:run.selected.totalScoreKcalMol,
      selectedPhysicalKcalMol:run.selected.physicalEnergyKcalMol,
      selectedConstraintPenaltyKcalMol:run.selected.constraintPenaltyKcalMol,
      selectedCoreRmsdAngstrom:run.selected.core.rmsdAngstrom,
      selectedRefinement:refinementAudit.find((entry) => entry.conformerIndex === run.selected.conformerIndex),
      selectedPhysicalComponents:run.selected.physicalDetails ? {
        lennardJonesKcalMol:run.selected.physicalDetails.lennardJonesKcalMol,
        coulombKcalMol:run.selected.physicalDetails.coulombKcalMol,
        ligandStrainKcalMol:run.selected.physicalDetails.ligandStrainKcalMol,
        interactionKcalMol:run.selected.physicalDetails.interactionKcalMol,
        interactionReferenceKcalMol:run.selected.physicalDetails.interactionReferenceKcalMol,
        relativeInteractionKcalMol:run.selected.physicalDetails.relativeInteractionKcalMol,
        receptorLigandPairs:run.selected.physicalDetails.pairCount,
        stericClashes:run.selected.physicalDetails.stericClashes,
      } : null,
      selectedHydrogenBonds:run.selected.hydrogenBonds.map((entry) => ({ id:entry.id,
        required:entry.required, satisfied:entry.satisfied,
        selectedAlternativeId:entry.selectedAlternativeId || null,
        alternativeCount:entry.alternativeCount || 1,
        alternatives:(entry.alternatives || []).map((alternative) => ({
          id:alternative.id, matchKind:alternative.matchKind || null,
          satisfied:alternative.satisfied,
          donorAcceptorDistanceAngstrom:alternative.donorAcceptorDistanceAngstrom,
          hydrogenAcceptorDistanceAngstrom:alternative.hydrogenAcceptorDistanceAngstrom,
          dhaAngleDegrees:alternative.dhaAngleDegrees,
          penaltyKcalMol:alternative.penaltyKcalMol,
        })),
        donorAcceptorDistanceAngstrom:entry.donorAcceptorDistanceAngstrom,
        hydrogenAcceptorDistanceAngstrom:entry.hydrogenAcceptorDistanceAngstrom,
        dhaAngleDegrees:entry.dhaAngleDegrees, penaltyKcalMol:entry.penaltyKcalMol,
      })),
      requiredHydrogenBonds: mappedHydrogenBonds.constraints.length,
      omittedHydrogenBonds,
      ligandFeatureRemaps:[...state.dockingContactRemaps.values()]
        .map((entry) => structuredClone(entry.audit)),
      scoreInterpretation:'reference-subtracted pose-ranking score; not a binding free energy',
      topPoses:run.candidates.slice(0, 5).map((pose) => ({ rank:pose.rank,
        feasible:pose.feasible, totalScoreKcalMol:pose.totalScoreKcalMol,
        physicalEnergyKcalMol:pose.physicalEnergyKcalMol,
        constraintPenaltyKcalMol:pose.constraintPenaltyKcalMol,
        coreRmsdAngstrom:pose.core.rmsdAngstrom,
        requiredHydrogenBondsSatisfied:pose.requiredHydrogenBondsSatisfied })),
    } });
    const liveIndices = currentIndicesForDockingPlan(plan);
    const receptorAfter = receptorScore.receptorSiteIntegrity(reference.receptorSite, state.molecule);
    if (!liveIndices.length || !receptorAfter.valid
      || adapter.dockingInputText(state.molecule, liveIndices) !== currentLigandInputText)
      throw new Error('The complex changed during docking; the stale result was discarded.');
    state.dockingResult = { run, labbook, plan, seed, requestedConformers,
      poseSearchExecution:structuredClone(poseSearchExecution),
      distinctPoseEntries, distinctFeasibleCount,
      featureGuidedSeeding:featureSeedResult ? {
        method:featureSeedResult.method,
        requestedCount:featureSeedResult.requestedCount,
        uniqueSeedCount:featureSeedResult.uniqueSeedCount,
        targetVariantCount:featureSeedResult.targetVariantCount,
        spatialFeatureMapCount:featureSeedResult.spatialFeatureMapCount,
        untargetedRotorCount:featureSeedResult.untargetedRotorCount,
        affectedRotorCount:featureSeedResult.affectedRotorCount,
        releasedCoreAtomIndices:[...featureSeedResult.releasedCoreAtomIndices],
        affectedRotors:structuredClone(featureSeedResult.affectedRotors),
        editRegionAnglesDegrees:featureSeedResult.editRegionAnglesDegrees,
        coverage:structuredClone(featureSeedResult.coverage),
        seedAudits:valid.map((entry, index) => ({ conformerIndex:index,
          ...structuredClone(entry.featureSeedAudit) })),
      } : null,
      mode:posePropagation ? 'pose-propagation' : 'selected-core',
      ligandTopologyText:currentLigandTopologyText,
      ligandForcefield:ligandParameters.forcefield, ligandChargeModel:ligandParameters.chargeModel,
      validationNumericSystem:{
        atomIds:plan.molecule.atoms.map((atom) => atom.designAtomId),
        forcefield:ligandParameters.forcefield,
        chargeModel:ligandParameters.chargeModel,
        sourceSha256:ligandParameters.sourceSha256,
        system:structuredClone(ligandParameters.system),
      },
      conformerForcefields:[...new Set(valid.map((entry) => entry.forcefield).filter(Boolean))],
      ligandStrainModel:'vacuum OpenFF Sage 2.1 intramolecular energy', torsionSteps };
    state.dockingPoseIndex = 0;
    renderDockingResults();
    showToast(`${posePropagation ? 'Pose refinement' : 'Docking'} complete · ${distinctPoseEntries.length} distinct pose${distinctPoseEntries.length === 1 ? '' : 's'}`);
    return state.dockingResult;
  } finally {
    state.dockingRunning = false;
    updateDockingUi();
  }
}

function distinctDockingPoseEntries(candidates, atoms, thresholdAngstrom = 0.35) {
  const heavyAtomIndices = atoms.flatMap((atom, index) => atom.element === 'H' ? [] : [index]);
  const atomIndices = heavyAtomIndices.length ? heavyAtomIndices : atoms.map((_, index) => index);
  const rmsd = (first, second) => {
    const sumSquared = atomIndices.reduce((sum, atomIndex) => {
      const offset = atomIndex * 3;
      const dx = first[offset] - second[offset];
      const dy = first[offset + 1] - second[offset + 1];
      const dz = first[offset + 2] - second[offset + 2];
      return sum + dx * dx + dy * dy + dz * dz;
    }, 0);
    return Math.sqrt(sumSquared / atomIndices.length);
  };
  const distinct = [];
  (candidates || []).forEach((pose, candidateIndex) => {
    const nearest = distinct.reduce((minimum, entry) =>
      Math.min(minimum, rmsd(pose.positions, entry.pose.positions)), Number.POSITIVE_INFINITY);
    if (nearest > thresholdAngstrom)
      distinct.push({ pose, candidateIndex, nearestPriorRmsdAngstrom:Number.isFinite(nearest) ? nearest : null });
  });
  return distinct;
}

function renderDockingResults() {
  const result = state.dockingResult;
  const card = document.querySelector('#docking-results');
  if (!card) return;
  card.classList.toggle('hidden', !result || state.mode !== 'build');
  if (!result) return;
  const entries = result.distinctPoseEntries
    || distinctDockingPoseEntries(result.run.candidates, result.plan.molecule.atoms);
  const feasible = entries.filter((entry) => entry.pose.feasible).length;
  const execution = result.poseSearchExecution;
  const ensembleSummary = Number(execution?.workerCount) > 1
    ? ` · ${execution.workerCount} workers · ${(Number(execution.elapsedMs) / 1000).toFixed(1)} s`
    : '';
  setText('#docking-result-summary', `${entries.length} distinct · ${feasible} feasible${ensembleSummary}`);
  const list = document.querySelector('#docking-pose-list'); list.replaceChildren();
  entries.slice(0, 5).forEach(({ pose, candidateIndex }) => {
    const button = document.createElement('button'); button.type = 'button';
    button.className = `docking-pose${candidateIndex === state.dockingPoseIndex ? ' active' : ''}`;
    const rank = document.createElement('b'); rank.textContent = `#${pose.rank}`;
    const score = document.createElement('span');
    const missedContacts = pose.hydrogenBonds.filter((entry) =>
      entry.required !== false && !entry.satisfied).length;
    const validity = pose.physicalDetails?.chemicalValidity;
    const addedClashes = Number(validity?.additionalStericClashes || 0);
    score.textContent = pose.feasible
      ? `Δ score ${pose.totalScoreKcalMol.toFixed(2)}`
      : [missedContacts ? `${missedContacts} contact${missedContacts === 1 ? '' : 's'} missed` : '',
        addedClashes ? `+${addedClashes} clash${addedClashes === 1 ? '' : 'es'}` : '']
        .filter(Boolean).join(' · ') || 'physical gate failed';
    const status = document.createElement('small'); status.textContent = pose.feasible ? 'feasible' : 'not feasible';
    button.title = `Reference-subtracted physical ${pose.physicalEnergyKcalMol.toFixed(2)} kcal/mol; restraint ${pose.constraintPenaltyKcalMol.toFixed(2)} kcal/mol`;
    button.append(rank, score, status);
    button.addEventListener('click', () => { state.dockingPoseIndex = candidateIndex; renderDockingResults(); });
    list.append(button);
  });
  const selected = result.run.candidates[state.dockingPoseIndex] || entries[0]?.pose;
  const applyButton = document.querySelector('#apply-docking-pose');
  if (applyButton) {
    applyButton.disabled = !selected?.feasible;
    applyButton.title = selected && !selected.feasible
      ? 'This pose failed the required-contact or physical-feasibility gate.' : '';
  }
  const selectedValidity = selected?.physicalDetails?.chemicalValidity;
  const scoreBreakdown = selected
    ? `Δphysical ${selected.physicalEnergyKcalMol.toFixed(2)} · restraints ${selected.constraintPenaltyKcalMol.toFixed(2)} kcal/mol`
      + (selectedValidity ? ` · ${selectedValidity.stericClashes} clashes (start ${selectedValidity.minimumFixedCoreStartStericClashes})` : '')
    : '';
  const throughput = Number(execution?.workerCount) > 1
    && Number.isFinite(Number(execution?.chainsPerSecond))
    ? ` · ${Number(execution.chainsPerSecond).toFixed(1)} chains/s` : '';
  setText('#docking-score-note', (scoreBreakdown || (result.mode === 'pose-propagation'
    ? 'Inherited scaffold · torsion search · fixed Sage relax'
    : 'Selected core · torsion search · rigid 8 Å site')) + throughput);
}

async function applySelectedDockingPose({ allowInfeasible = false } = {}) {
  const result = state.dockingResult;
  const pose = result?.run.candidates[state.dockingPoseIndex];
  if (!result || !pose) throw new Error('Select a docking pose first.');
  if (!pose.feasible && !allowInfeasible)
    throw new Error('The selected docking pose is infeasible; pass allowInfeasible:true to apply it explicitly.');
  const adapter = await import('./docking/browser-adapter.mjs');
  const liveIndices = currentIndicesForDockingPlan(result.plan);
  if (!liveIndices.length || adapter.dockingTopologyText(state.molecule, liveIndices) !== result.ligandTopologyText)
    throw new Error('The ligand chemistry changed after docking; run docking again.');
  const { receptorSiteIntegrity } = await import('./docking/receptor-score.mjs');
  if (!receptorSiteIntegrity(state.dockingReference.receptorSite, state.molecule).valid)
    throw new Error('The receptor changed after docking; reset the reference and run again.');
  pushBuildHistory();
  adapter.applyLigandPositions(state.molecule, liveIndices, pose.positions);
  state.molecule.source = { ...(state.molecule.source || {}), docking:{
    protocol:result.labbook.protocol.id, runId:result.labbook.runId, rank:pose.rank,
    feasible:pose.feasible, scoreKcalMol:pose.totalScoreKcalMol,
  } };
  clearCalculationResult(); updateStoredBondDistances(); updateInfo(); updateHistoryButtons(); draw();
  showToast(`Docking pose ${pose.rank} applied`);
  return pose;
}

async function downloadDockingLabbook(format = 'json') {
  const labbook = state.dockingResult?.labbook;
  if (!labbook) throw new Error('Run constrained docking first.');
  const module = await import('./docking/labbook.mjs');
  const verification = await module.verifyLabbook(labbook);
  if (!verification.valid) throw new Error(`Labbook verification failed: ${verification.reason}`);
  const filename = `${slug(state.molecule?.name || 'complex')}-${labbook.runId}-labbook`;
  if (format === 'markdown') downloadBlob(module.renderLabbookMarkdown(labbook), `${filename}.md`, 'text/markdown');
  else downloadBlob(`${JSON.stringify(labbook, null, 2)}\n`, `${filename}.json`, 'application/json');
  showToast('Verified docking labbook downloaded');
}

function drawNonCovalentInteractions(context, projectedByIndex, interactions) {
  if (!state.showInteractions) return;
  context.save();
  context.lineCap = 'round';
  const dashedLine = (first, second, color, dash, width) => {
    context.setLineDash(dash);
    context.beginPath(); context.moveTo(first.x, first.y); context.lineTo(second.x, second.y);
    context.strokeStyle = 'rgba(255,255,255,.94)'; context.lineWidth = width + 3; context.stroke();
    context.beginPath(); context.moveTo(first.x, first.y); context.lineTo(second.x, second.y);
    context.strokeStyle = color; context.lineWidth = width; context.stroke();
  };
  interactions.hydrogenBonds.forEach((bond) => {
    const first = projectedByIndex.get(bond.hydrogen) || projectedByIndex.get(bond.donor);
    const second = projectedByIndex.get(bond.acceptor);
    if (!first || !second) return;
    dashedLine({ x:first.sx, y:first.sy }, { x:second.sx, y:second.sy }, '#009fc0', [3, 4], 2.2);
  });
  interactions.piStacks.forEach((stack) => {
    const centroid = (cycle) => {
      const points = cycle.map((index) => projectedByIndex.get(index));
      if (points.some((point) => !point)) return null;
      return points.reduce((sum, point) => ({ x:sum.x + point.sx / points.length,
        y:sum.y + point.sy / points.length }), { x:0, y:0 });
    };
    const first = centroid(stack.first), second = centroid(stack.second);
    if (!first || !second) return;
    dashedLine(first, second, '#8b5bd2', [7, 5], 2.4);
  });
  context.restore();
}

function drawManualDockingContactOverlays(context, projectedByIndex) {
  if (!state.showInteractions || !state.dockingReference || !manualHydrogenBondModule) return;
  const indexById = new Map(state.molecule.atoms.map((atom, index) =>
    [atom.designAtomId, index]));
  const definitions = state.dockingReference.hydrogenBonds.filter((definition) =>
    definition.origin && state.dockingSelectedHbondIds.has(definition.id));
  context.save(); context.lineCap = 'round'; context.setLineDash([4, 5]);
  definitions.forEach((rawDefinition) => {
    const definition = effectiveDockingHydrogenBondDefinition(rawDefinition);
    const descriptorIndex = (descriptor) => indexById.get(descriptor?.designAtomId);
    const firstIndex = descriptorIndex(definition.hydrogen) ?? descriptorIndex(definition.donor);
    const secondIndex = descriptorIndex(definition.acceptor);
    const first = projectedByIndex.get(firstIndex), second = projectedByIndex.get(secondIndex);
    if (!first || !second) return;
    const value = manualHydrogenBondModule.manualHydrogenBondGeometry(state.molecule, definition);
    context.beginPath(); context.moveTo(first.sx, first.sy); context.lineTo(second.sx, second.sy);
    context.strokeStyle = 'rgba(255,255,255,.95)'; context.lineWidth = 5.2; context.stroke();
    context.beginPath(); context.moveTo(first.sx, first.sy); context.lineTo(second.sx, second.sy);
    context.strokeStyle = value?.satisfied ? '#2f8f68' : '#d39a28';
    context.lineWidth = 2.2; context.stroke();
  });
  const draft = state.dockingContactDraft;
  if (Number.isInteger(draft?.ligandAtomIndex) && Number.isInteger(draft?.receptorAtomIndex)) {
    const first = projectedByIndex.get(draft.ligandAtomIndex);
    const second = projectedByIndex.get(draft.receptorAtomIndex);
    if (first && second) {
      context.beginPath(); context.moveTo(first.sx, first.sy); context.lineTo(second.sx, second.sy);
      context.strokeStyle = '#d39a28'; context.lineWidth = 2.2; context.stroke();
    }
  }
  context.restore();
}

function drawBondLane(context, a, b, offset, outerWidth, innerWidth, miniature) {
  const dx = b.sx - a.sx, dy = b.sy - a.sy;
  const length = Math.hypot(dx, dy) || 1;
  const ox = -dy / length * offset, oy = dx / length * offset;
  const x1 = a.sx + ox, y1 = a.sy + oy, x2 = b.sx + ox, y2 = b.sy + oy;
  context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2);
  context.strokeStyle = '#080b0d'; context.lineWidth = outerWidth; context.lineCap = 'round'; context.stroke();
  if (!miniature && innerWidth > 0) {
    context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2);
    const gradient = context.createLinearGradient(x1, y1, x2, y2);
    gradient.addColorStop(0, atomRenderStyle(a).base);
    gradient.addColorStop(1, atomRenderStyle(b).base);
    context.strokeStyle = gradient; context.lineWidth = innerWidth; context.lineCap = 'round'; context.stroke();
  }
}

function confidenceColor(value) {
  if (state.proteinPrediction?.kind === 'parameterized-reference' || state.proteinPrediction?.kind === 'pdb-import') return '#64748b';
  if (value >= 90) return '#3155cf';
  if (value >= 70) return '#2db9d1';
  if (value >= 50) return '#e9c948';
  return '#e9564c';
}

function catmullRom(first, second, third, fourth, t, field) {
  const p0 = first[field], p1 = second[field], p2 = third[field], p3 = fourth[field];
  const t2 = t * t, t3 = t2 * t;
  return .5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function vector3(first, second) {
  return { x: second.x - first.x, y: second.y - first.y, z: second.z - first.z };
}

function dot3(first, second) { return first.x * second.x + first.y * second.y + first.z * second.z; }
function cross3(first, second) {
  return { x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z, z: first.x * second.y - first.y * second.x };
}

function coordinateTorsionDegrees(first, second, third, fourth) {
  const b0 = vector3(second, first), b1 = vector3(second, third), b2 = vector3(third, fourth);
  const axis = normaliseVector(b1);
  const v = { x: b0.x - dot3(b0, axis) * axis.x, y: b0.y - dot3(b0, axis) * axis.y, z: b0.z - dot3(b0, axis) * axis.z };
  const w = { x: b2.x - dot3(b2, axis) * axis.x, y: b2.y - dot3(b2, axis) * axis.y, z: b2.z - dot3(b2, axis) * axis.z };
  return Math.atan2(dot3(cross3(axis, v), w), dot3(v, w)) * 180 / Math.PI;
}

function proteinSecondaryAssignments(molecule) {
  const residues = proteinResidues(molecule);
  const assignments = new Map(residues.map((residue) => [residue.key, 'coil']));
  const annotations = molecule.source?.secondaryStructure;
  const applyRanges = (ranges, kind) => ranges?.forEach((range) => residues.forEach((residue) => {
    if (residue.chain === range.chain && range.chain === range.endChain
      && residue.residueIndex >= range.start && residue.residueIndex <= range.end) assignments.set(residue.key, kind);
  }));
  applyRanges(annotations?.sheets, 'sheet');
  applyRanges(annotations?.helices, 'helix');
  if ((annotations?.helices?.length || 0) + (annotations?.sheets?.length || 0)) return assignments;

  const byName = new Map();
  residues.forEach((residue) => residue.atoms.forEach((index) => byName.set(`${residue.key}:${molecule.atoms[index].atomName}`, molecule.atoms[index])));
  const raw = residues.map((residue, index) => {
    const previous = residues[index - 1], next = residues[index + 1];
    if (!previous || !next || previous.chain !== residue.chain || next.chain !== residue.chain) return 'coil';
    const cPrevious = byName.get(`${previous.key}:C`), n = byName.get(`${residue.key}:N`);
    const ca = byName.get(`${residue.key}:CA`), c = byName.get(`${residue.key}:C`), nNext = byName.get(`${next.key}:N`);
    if (!cPrevious || !n || !ca || !c || !nNext) return 'coil';
    const phi = coordinateTorsionDegrees(cPrevious, n, ca, c), psi = coordinateTorsionDegrees(n, ca, c, nNext);
    if (phi >= -105 && phi <= -30 && psi >= -85 && psi <= 5) return 'helix';
    if (phi <= -80 && (psi >= 65 || psi <= -125)) return 'sheet';
    return 'coil';
  });
  for (let start = 0; start < raw.length;) {
    let end = start + 1;
    while (end < raw.length && raw[end] === raw[start] && residues[end].chain === residues[start].chain
      && residues[end].residueIndex === residues[end - 1].residueIndex + 1) end += 1;
    const minimum = raw[start] === 'helix' ? 3 : raw[start] === 'sheet' ? 2 : 1;
    if (end - start >= minimum) for (let index = start; index < end; index++) assignments.set(residues[index].key, raw[start]);
    start = end;
  }
  return assignments;
}

function proteinCartoonSamples(projected, molecule) {
  const secondary = proteinSecondaryAssignments(molecule);
  const controls = projected.filter((atom) => atom.atomName === 'CA' && isProteinAtom(atom))
    .sort((a, b) => (a.chain || 'A').localeCompare(b.chain || 'A') || a.residueIndex - b.residueIndex);
  const samples = [];
  let segment = 0;
  for (let index = 0; index < controls.length - 1; index++) {
    const second = controls[index], third = controls[index + 1];
    const contiguous = (second.chain || 'A') === (third.chain || 'A') && third.residueIndex === second.residueIndex + 1;
    if (!contiguous) { segment += 1; continue; }
    const first = index > 0 && controls[index - 1].chain === second.chain
      && controls[index - 1].residueIndex === second.residueIndex - 1 ? controls[index - 1] : second;
    const fourth = index + 2 < controls.length && controls[index + 2].chain === third.chain
      && controls[index + 2].residueIndex === third.residueIndex + 1 ? controls[index + 2] : third;
    const residueKey = `${second.chain || 'A'}:${second.residueIndex}:${second.insertionCode || ''}`;
    const component = state.structureComponents.find((entry) => entry.id === state.atomComponentIds[second.index]);
    for (let step = 0; step < 8; step++) {
      const t = step / 8;
      samples.push({
        sx: catmullRom(first, second, third, fourth, t, 'sx'), sy: catmullRom(first, second, third, fourth, t, 'sy'),
        rz: catmullRom(first, second, third, fourth, t, 'rz'), perspective: catmullRom(first, second, third, fourth, t, 'perspective'),
        plddt: Number(second.plddt || 0) + (Number(third.plddt || 0) - Number(second.plddt || 0)) * t,
        residueIndex: second.residueIndex, chain: second.chain || 'A', segment,
        secondary: secondary.get(residueKey) || 'coil', chainColor: component?.color || '#64748b',
      });
    }
  }
  return samples;
}

function cartoonRuns(samples) {
  const runs = [];
  for (const sample of samples) {
    const previous = runs.at(-1);
    if (!previous || previous.segment !== sample.segment || previous.secondary !== sample.secondary) {
      runs.push({ segment: sample.segment, secondary: sample.secondary, chain: sample.chain,
        color: sample.chainColor, points: [sample] });
    } else previous.points.push(sample);
  }
  return runs.filter((run) => run.points.length > 1).map((run) => ({ ...run,
    depth: run.points.reduce((sum, point) => sum + point.rz, 0) / run.points.length,
    confidence: run.points.reduce((sum, point) => sum + point.plddt, 0) / run.points.length }));
}

function traceCartoonPath(context, points) {
  context.beginPath(); context.moveTo(points[0].sx, points[0].sy);
  points.slice(1).forEach((point) => context.lineTo(point.sx, point.sy));
}

function drawCartoonStroke(context, run, miniature, color) {
  const inner = miniature ? (run.secondary === 'helix' ? 4.8 : 2.6) : (run.secondary === 'helix' ? 14 : 5.5);
  const storyTheme = Boolean(DESIGN_DISPLAY_THEMES[state.displayColorTheme]);
  traceCartoonPath(context, run.points); context.strokeStyle = storyTheme
    ? 'rgba(71,100,104,.24)' : 'rgba(15,23,42,.70)';
  context.lineWidth = inner + (miniature ? 1.4 : 3); context.lineCap = 'round'; context.lineJoin = 'round'; context.stroke();
  traceCartoonPath(context, run.points); context.strokeStyle = color; context.lineWidth = inner;
  context.lineCap = 'round'; context.lineJoin = 'round'; context.stroke();
  if (!miniature && run.secondary === 'helix') {
    traceCartoonPath(context, run.points); context.strokeStyle = storyTheme
      ? 'rgba(255,255,255,.48)' : 'rgba(255,255,255,.35)';
    context.lineWidth = 2.2; context.stroke();
  }
}

function drawCartoonArrow(context, run, miniature, color) {
  const points = run.points;
  if (points.length < 4) return drawCartoonStroke(context, run, miniature, color);
  const width = miniature ? 4.2 : 12;
  const left = [], right = [];
  points.forEach((point, index) => {
    const before = points[Math.max(0, index - 1)], after = points[Math.min(points.length - 1, index + 1)];
    const dx = after.sx - before.sx, dy = after.sy - before.sy, length = Math.hypot(dx, dy) || 1;
    const arrowBase = points.length - Math.max(4, Math.floor(points.length * .18));
    const factor = index === points.length - 1 ? 0 : index >= arrowBase ? 1.65 : 1;
    const nx = -dy / length * width * factor / 2, ny = dx / length * width * factor / 2;
    left.push({ x: point.sx + nx, y: point.sy + ny }); right.push({ x: point.sx - nx, y: point.sy - ny });
  });
  context.beginPath(); context.moveTo(left[0].x, left[0].y);
  left.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  [...right].reverse().forEach((point) => context.lineTo(point.x, point.y));
  context.closePath(); context.fillStyle = color; context.fill();
  const storyTheme = Boolean(DESIGN_DISPLAY_THEMES[state.displayColorTheme]);
  context.strokeStyle = storyTheme ? 'rgba(71,100,104,.28)' : 'rgba(15,23,42,.72)';
  context.lineWidth = miniature ? .8 : 1.6; context.lineJoin = 'round'; context.stroke();
  if (!miniature) {
    traceCartoonPath(context, points); context.strokeStyle = 'rgba(255,255,255,.32)'; context.lineWidth = 1.2; context.stroke();
  }
}

function drawProteinCartoon(context, projected, molecule, miniature) {
  const runs = cartoonRuns(proteinCartoonSamples(projected, molecule)).sort((first, second) => first.depth - second.depth);
  for (const run of runs) {
    const predictedConfidence = state.proteinPrediction?.kind !== 'pdb-import'
      && state.proteinPrediction?.kind !== 'parameterized-reference';
    const color = DESIGN_DISPLAY_THEMES[state.displayColorTheme] ? STORY_CARTOON_COLOR
      : predictedConfidence ? confidenceColor(run.confidence)
        : run.secondary === 'helix' ? '#d96262' : run.secondary === 'sheet' ? '#d5a936' : run.color;
    if (run.secondary === 'sheet') drawCartoonArrow(context, run, miniature, color);
    else drawCartoonStroke(context, run, miniature, color);
  }
}

function ligandProteinSevereClashes(molecule, byIndex) {
  if (!state.showStericClashes || !molecule) return [];
  const componentKinds = new Map(state.structureComponents.map((component) =>
    [component.id, component.kind]));
  const ligand = [], protein = [];
  for (const [index, projected] of byIndex) {
    const atom = molecule.atoms[index];
    if (!atom || atom.element === 'H') continue;
    const kind = componentKinds.get(state.atomComponentIds[index]);
    if (kind === 'ligand') ligand.push({ index, atom, projected });
    else if (kind === 'protein') protein.push({ index, atom, projected });
  }
  const clashes = [];
  for (const first of ligand) for (const second of protein) {
    const distance = Math.hypot(first.atom.x - second.atom.x,
      first.atom.y - second.atom.y, first.atom.z - second.atom.z);
    const threshold = .62 * ((DISPLAY_VDW_RADII[first.atom.element] || 1.75)
      + (DISPLAY_VDW_RADII[second.atom.element] || 1.75));
    if (distance < threshold) clashes.push({ first, second, distance, threshold });
  }
  return clashes.sort((first, second) => first.distance / first.threshold
    - second.distance / second.threshold);
}

function updateStericClashDisplayLabel(count = state.visibleStericClashCount) {
  const label = document.querySelector('#steric-clash-toggle-text');
  if (!label) return;
  label.textContent = `Show severe clashes${state.showStericClashes ? ` · ${count}` : ''}`;
}

function drawStericClashMarkers(context, clashes) {
  context.save();
  for (const { first, second } of clashes) {
    const x = (first.projected.sx + second.projected.sx) / 2;
    const y = (first.projected.sy + second.projected.sy) / 2;
    context.beginPath(); context.moveTo(first.projected.sx, first.projected.sy);
    context.lineTo(second.projected.sx, second.projected.sy);
    context.setLineDash([3, 4]); context.strokeStyle = 'rgba(192,38,132,.58)';
    context.lineWidth = 1.5; context.stroke(); context.setLineDash([]);
    context.beginPath(); context.arc(x, y, 4.2, 0, Math.PI * 2);
    context.fillStyle = 'rgba(219,39,119,.88)'; context.fill();
    context.strokeStyle = 'rgba(255,255,255,.94)'; context.lineWidth = 1.2; context.stroke();
  }
  context.restore();
}

function drawChangedAtomMarkers(context, atoms) {
  if (!atoms.length || state.changeMarkerStyle === 'none') return;
  if (atoms.length > 4) {
    const padding = 15;
    const left = Math.min(...atoms.map((atom) => atom.sx - atom.screenRadius)) - padding;
    const right = Math.max(...atoms.map((atom) => atom.sx + atom.screenRadius)) + padding;
    const top = Math.min(...atoms.map((atom) => atom.sy - atom.screenRadius)) - padding;
    const bottom = Math.max(...atoms.map((atom) => atom.sy + atom.screenRadius)) + padding;
    context.save(); context.beginPath();
    context.roundRect(left, top, right - left, bottom - top, 18);
    context.fillStyle = 'rgba(14,165,193,.055)'; context.fill();
    context.strokeStyle = 'rgba(8,145,178,.55)'; context.lineWidth = 2;
    context.shadowColor = 'rgba(34,211,238,.34)'; context.shadowBlur = 13; context.stroke();
    context.restore();
    return;
  }
  for (const atom of atoms) {
    const halo = state.changeMarkerStyle === 'halo';
    context.save(); context.beginPath();
    context.arc(atom.sx, atom.sy, atom.screenRadius + (halo ? 7 : 9), 0, Math.PI * 2);
    context.fillStyle = halo ? 'rgba(14,165,193,.06)' : 'rgba(220,38,38,.14)';
    context.fill(); context.strokeStyle = halo ? 'rgba(8,145,178,.62)' : '#dc2626';
    context.lineWidth = halo ? 2 : 3.5;
    if (halo) { context.shadowColor = 'rgba(34,211,238,.40)'; context.shadowBlur = 10; }
    context.stroke(); context.restore();
  }
}

function drawMolecule(context, projected, molecule, miniature) {
  let atomProjection = projected;
  let renderedIndices = null;
  const proteinCartoon = Boolean(molecule.prediction) && state.representation !== 'ball-stick';
  if (proteinCartoon) {
    drawProteinCartoon(context, projected, molecule, miniature);
    if (state.representation !== 'both') {
      const selection = cartoonAtomSelection(molecule);
      renderedIndices = selection.allowedIndices;
      atomProjection = projected.filter((atom) => renderedIndices.has(atom.index));
    }
  }
  if (proteinCartoon && !atomProjection.length) {
    if (!miniature) {
      state.visibleStericClashCount = 0; updateStericClashDisplayLabel(0);
    }
    const alphaCarbons = projected.filter((atom) => atom.atomName === 'CA');
    alphaCarbons.forEach((atom) => { atom.screenRadius = miniature ? 3 : 9; });
    state.projected = miniature ? state.projected : alphaCarbons;
    return;
  }
  const byIndex = new Map(atomProjection.map((atom) => [atom.index, atom]));
  const cycles = findRingCycles(molecule, 12, renderedIndices);
  const aromaticDoubles = aromaticDoubleBonds(molecule, cycles);
  if (!miniature) drawRingHulls(context, byIndex, cycles);
  const interactions = !miniature && state.showInteractions
    ? nonCovalentInteractions(molecule, cycles, renderedIndices) : null;
  const bonds = molecule.bonds
    .map((bond) => ({ bond, a: byIndex.get(bond.a), b: byIndex.get(bond.b) }))
    .filter((item) => item.a && item.b)
    .sort((a, b) => ((a.a.rz + a.b.rz) / 2) - ((b.a.rz + b.b.rz) / 2));

  for (const { bond, a, b } of bonds) {
    const baseWidth = miniature ? 2.2 : Math.max(5, 8.5 * ((a.perspective + b.perspective) / 2));
    let lanes = bond.order >= 2.8 ? 3 : bond.order >= 1.8 ? 2 : 1;
    if (bond.order === 1.5 && aromaticDoubles.has(pairKey(bond.a, bond.b))) lanes = 2;
    const laneWidth = lanes === 1 ? baseWidth : baseWidth * (lanes === 2 ? 0.54 : 0.42);
    const separation = lanes === 1 ? 0 : baseWidth * (lanes === 2 ? 0.36 : 0.48);
    const offsets = lanes === 1 ? [0] : lanes === 2 ? [-separation, separation] : [-separation, 0, separation];
    offsets.forEach((offset) => drawBondLane(context, a, b, offset, laneWidth, laneWidth * 0.42, miniature));
  }

  if (interactions) {
    drawNonCovalentInteractions(context, byIndex, interactions);
    updateChemistryDisplayControls(interactions);
  }
  if (!miniature) drawManualDockingContactOverlays(context, byIndex);

  const emphasizedIds = miniature ? new Set() : new Set(state.emphasizedAtomIds);
  atomProjection.sort((a, b) => a.rz - b.rz);
  atomProjection.forEach((atom) => {
    const base = ELEMENTS[atom.element].radius * (state.vdw ? 1.75 : 1);
    atom.screenRadius = miniature ? Math.max(2.6, base * 5.8)
      : Math.max(7, base * atom.scale * .46 * atom.perspective);
  });
  if (!miniature) {
    const clashes = ligandProteinSevereClashes(molecule, byIndex);
    state.visibleStericClashCount = clashes.length;
    updateStericClashDisplayLabel(clashes.length);
    drawStericClashMarkers(context, clashes);
    drawChangedAtomMarkers(context, atomProjection.filter((atom) =>
      emphasizedIds.has(atom.designAtomId)));
  }
  for (const atom of atomProjection) {
    const radius = atom.screenRadius;
    const selectedOrder = miniature ? -1 : state.selectedAtoms.indexOf(atom.index);
    if (selectedOrder >= 0) {
      context.beginPath(); context.arc(atom.sx, atom.sy, radius + 5, 0, Math.PI * 2);
      context.strokeStyle = state.designerMoveReplaying ? '#dc2626' : '#2563eb';
      context.lineWidth = 3; context.stroke();
    }
    const style = atomRenderStyle(atom);
    const gradient = context.createRadialGradient(atom.sx - radius * .35, atom.sy - radius * .40, radius * .08, atom.sx, atom.sy, radius);
    gradient.addColorStop(0, style.highlight);
    gradient.addColorStop(.42, style.base);
    gradient.addColorStop(1, style.shade);
    context.beginPath(); context.arc(atom.sx, atom.sy, radius, 0, Math.PI * 2);
    context.fillStyle = gradient; context.fill();
    context.strokeStyle = '#070a0c'; context.lineWidth = miniature ? 0.8 : Math.max(1.5, radius * .105); context.stroke();
    if (!miniature && (state.hoverAtom === atom.index || state.selectedAtom === atom.index
      || state.selectedAtoms.includes(atom.index)
      || state.mode === 'build' && !state.designerMoveReplaying) && atom.element !== 'H') {
      context.fillStyle = atom.element === 'C' ? 'white' : 'rgba(255,255,255,.92)';
      context.font = `600 ${Math.max(8, radius * .62)}px Inter, sans-serif`;
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(atom.element, atom.sx, atom.sy + .5);
    }
    const formalCharge = atomFormalCharge(atom);
    if (!miniature && formalCharge) {
      context.fillStyle = atom.element === 'C' ? '#111827' : style.shade;
      context.font = `700 ${Math.max(8, radius * .48)}px Inter, sans-serif`;
      context.textAlign = 'center'; context.textBaseline = 'middle';
      const magnitude = Math.abs(formalCharge) === 1 ? '' : String(Math.abs(formalCharge));
      context.fillText(`${magnitude}${formalCharge > 0 ? '+' : '−'}`, atom.sx - radius * .72, atom.sy - radius * .72);
    }
    if (selectedOrder >= 0) {
      const badgeRadius = 8;
      const badgeX = atom.sx + radius * .72, badgeY = atom.sy - radius * .72;
      context.beginPath(); context.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
      context.fillStyle = '#2563eb'; context.fill();
      context.strokeStyle = 'white'; context.lineWidth = 1.5; context.stroke();
      context.fillStyle = 'white'; context.font = '700 10px Inter, sans-serif';
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(String(selectedOrder + 1), badgeX, badgeY + .5);
    }
  }
  if (!miniature && state.focusedAtomResidueLabels.length)
    drawFocusedAtomResidueLabels(context, atomProjection);
  state.projected = miniature ? state.projected : (proteinCartoon
    ? [...projected.filter((atom) => atom.atomName === 'CA'), ...atomProjection] : atomProjection);
}

function drawFocusedAtomResidueLabels(context, projected) {
  const width = context.canvas.clientWidth || context.canvas.width;
  const height = context.canvas.clientHeight || context.canvas.height;
  for (const spec of state.focusedAtomResidueLabels) {
    const atoms = projected.filter((atom) => isProteinAtom(atom)
      && String(atom.chain || 'A') === String(spec.chain || 'A')
      && String(atom.residueIndex) === String(spec.residueIndex)
      && String(atom.insertionCode || '') === String(spec.insertionCode || ''));
    if (!atoms.length) continue;
    const anchor = atoms.reduce((sum, atom) => ({ x:sum.x + atom.sx, y:sum.y + atom.sy }),
      { x:0, y:0 });
    anchor.x /= atoms.length; anchor.y /= atoms.length;
    const text = String(spec.label || `${atoms[0].residueName || ''}${spec.residueIndex}`);
    const tone = RESIDUE_LABEL_TONES[spec.tone] || RESIDUE_LABEL_TONES.blue;
    context.save();
    context.font = '700 13px Inter, sans-serif';
    const boxWidth = Math.ceil(context.measureText(text).width) + 20;
    const boxHeight = 28;
    const direction = anchor.x < width / 2 ? -1 : 1;
    const boxX = Math.max(8, Math.min(width - boxWidth - 8,
      anchor.x + direction * (boxWidth / 2 + 34) - boxWidth / 2));
    const boxY = Math.max(8, Math.min(height - boxHeight - 8, anchor.y - 38));
    const endX = direction < 0 ? boxX + boxWidth : boxX;
    const endY = boxY + boxHeight / 2;
    context.beginPath(); context.moveTo(anchor.x, anchor.y); context.lineTo(endX, endY);
    context.strokeStyle = tone.line; context.lineWidth = 2; context.stroke();
    context.beginPath(); context.roundRect(boxX, boxY, boxWidth, boxHeight, 7);
    context.fillStyle = 'rgba(255,255,255,.94)'; context.fill();
    context.strokeStyle = tone.line; context.lineWidth = 1.5; context.stroke();
    context.fillStyle = tone.text; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(text, boxX + boxWidth / 2, boxY + boxHeight / 2 + .5);
    context.restore();
  }
}

function showToast(message) {
  const toast = document.querySelector('#toast'); toast.textContent = message; toast.classList.add('visible');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

function showNotice(message) {
  const notice = document.querySelector('#notice'); notice.textContent = message; notice.classList.remove('hidden');
  setTimeout(() => notice.classList.add('hidden'), 4000);
}

async function runChemistUiAction(action, args = {}, { reportError = true } = {}) {
  try {
    const api = await window.MolariumChemistActionsReady;
    const response = await api.execute({ action, args });
    return response.result;
  } catch (error) {
    if (reportError) showNotice(error.message);
    throw error;
  }
}

function setMode(mode) {
  if (mode !== 'build' && state.chemistryTransaction) {
    showNotice('Finish or discard the pending chemistry changes before leaving Design.');
    return false;
  }
  state.mode = mode;
  document.querySelectorAll('.mode-bar button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  ['build-left-panel', 'build-right-panel', 'design-history-panel',
    'run-left-panel', 'run-right-panel'].forEach((id) => document.querySelector(`#${id}`).classList.add('hidden'));
  document.querySelector('#display-options').classList.toggle('hidden', mode !== 'view');
  document.querySelector('.protein-fold-card').classList.toggle('hidden', mode !== 'view');
  document.querySelector('#molecule-info').classList.toggle('hidden', !state.molecule);
  document.querySelector('.scene-card').classList.toggle('hidden', mode !== 'view');
  document.querySelector('#build-left-panel').classList.toggle('hidden', mode !== 'build');
  document.querySelector('#build-right-panel').classList.toggle('hidden', mode !== 'build');
  document.querySelector('#design-history-panel').classList.toggle('hidden', mode !== 'build');
  document.querySelector('#run-left-panel').classList.toggle('hidden', mode !== 'run');
  document.querySelector('#run-right-panel').classList.toggle('hidden', mode !== 'run');
  canvas.classList.toggle('build-cursor', mode === 'build' && state.buildTool === 'add');
  updateChemistryEditor();
  updateBuildStatus();
  update2DEditorUi();
  updateDockingUi();
  renderDockingResults();
  if (mode === 'build') {
    requestAnimationFrame(drawFragmentPreviews);
    ensureLiveCampaignPersistence();
    updateLiveCampaignUi();
  }
  draw();
  return true;
}

function elementFragment(element) {
  return { id: `element-${element}`, label: element, name: ELEMENTS[element].name, smiles: element, attach: 0 };
}

function hydrogenParent(molecule, atomIndex) {
  if (molecule.atoms[atomIndex]?.element !== 'H') return atomIndex;
  const bond = molecule.bonds.find((entry) => entry.a === atomIndex || entry.b === atomIndex);
  return bond ? (bond.a === atomIndex ? bond.b : bond.a) : null;
}

function elementAttachmentTarget(clientX, clientY) {
  if (!state.molecule?.atoms.length) return null;
  const direct = hitTest(clientX, clientY);
  if (direct) return hydrogenParent(state.molecule, direct.index);
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  const selectedRadius = ELEMENTS[state.selectedElement].covalent;
  let best = null;
  for (const projected of state.projected || []) {
    const targetIndex = hydrogenParent(state.molecule, projected.index);
    if (targetIndex == null) continue;
    const target = state.molecule.atoms[targetIndex];
    const distance = Math.hypot(x - projected.sx, y - projected.sy);
    const bondPixels = (ELEMENTS[target.element].covalent + selectedRadius) * (state.projection?.scale || 52);
    const reach = Math.max(34, Math.min(150, bondPixels * 1.35));
    if (distance <= reach && (!best || distance < best.distance)) best = { index: targetIndex, distance };
  }
  return best?.index ?? null;
}

function appendDisconnectedMolecule(baseMolecule, incoming, targetPoint) {
  const anchor = incoming.atoms[0];
  translateMolecule(incoming, {
    x: targetPoint.x - anchor.x,
    y: targetPoint.y - anchor.y,
    z: targetPoint.z - anchor.z,
  });
  if (!baseMolecule?.atoms.length) return incoming;
  delete baseMolecule.parameterization;
  const offset = baseMolecule.atoms.length;
  baseMolecule.atoms.push(...incoming.atoms);
  baseMolecule.bonds.push(...incoming.bonds.map((bond) => ({ ...bond, a: bond.a + offset, b: bond.b + offset })));
  baseMolecule.name = 'Built molecule';
  baseMolecule.smiles = `${baseMolecule.smiles}.${incoming.smiles}`;
  return baseMolecule;
}

function addElementToMolecule(baseMolecule, element, targetIndex = null, targetPoint = null) {
  const fragment = elementFragment(element);
  if (targetIndex != null)
    return mergeFragmentIntoMolecule(baseMolecule, fragment, targetIndex, targetPoint);
  const incoming = parseSMILES(fragment.smiles, fragment.name);
  return appendDisconnectedMolecule(baseMolecule, incoming, targetPoint || { x: 0, y: 0, z: 0 });
}

function addAtomAtScreen(clientX, clientY) {
  clearCalculationResult();
  const point = screenToMolecule(clientX, clientY);
  const targetIndex = elementAttachmentTarget(clientX, clientY);
  if (targetIndex != null && analogueDesignCaptureNeeded([targetIndex])) {
    return ensureAnalogueDesignReferenceBeforeChemistry([targetIndex]).then((accepted) => {
      if (accepted) return addAtomAtScreen(clientX, clientY);
      return null;
    });
  }
  const existingAtoms = new Set(state.molecule?.atoms || []);
  const targetAtom = targetIndex == null ? null : state.molecule.atoms[targetIndex];
  pushBuildHistory();
  try {
    state.molecule = addElementToMolecule(state.molecule, state.selectedElement, targetIndex, point);
  } catch (error) {
    if (state.buildHistory.length) state.buildHistory.pop();
    updateHistoryButtons(); showNotice(error.message); return;
  }
  refreshStructureComponents();
  state.selectedAtoms = []; state.selectedAtom = null; updateGeometryControl();
  document.querySelector('#viewer-hint').classList.remove('visible');
  updateInfo(); updateHistoryButtons(); draw();
  const changedAtomIndices = state.molecule.atoms.flatMap((atom, index) =>
    !existingAtoms.has(atom) || atom === targetAtom ? [index] : []);
  scheduleSmallMoleculePolish(changedAtomIndices);
  return Promise.resolve();
}

function pairKey(a, b) { return a < b ? `${a}:${b}` : `${b}:${a}`; }

function hitTest(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  return [...(state.projected || [])].reverse().find((atom) => Math.hypot(x - atom.sx, y - atom.sy) <= Math.max(9, atom.screenRadius || 8)) || null;
}

function screenToMolecule(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const projection = state.projection || { center:{ x:0, y:0, z:0 }, scale:52,
    rotation:state.rotation, pan:{ x:0, y:0 } };
  const pan = projection.pan || { x:0, y:0 };
  const cameraPoint = {
    x: (clientX - rect.left - rect.width / 2 - pan.x) / projection.scale,
    y: -(clientY - rect.top - rect.height / 2 - pan.y) / projection.scale,
    z: 0,
  };
  const inverse = { w: projection.rotation.w, x: -projection.rotation.x, y: -projection.rotation.y, z: -projection.rotation.z };
  const modelPoint = rotateVectorByQuaternion(cameraPoint, inverse);
  return {
    x: modelPoint.x + projection.center.x,
    y: modelPoint.y + projection.center.y,
    z: modelPoint.z + projection.center.z,
  };
}

function arcballVector(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const diameter = Math.max(1, Math.min(rect.width, rect.height));
  let x = (clientX - rect.left - rect.width / 2) * 2 / diameter;
  let y = -(clientY - rect.top - rect.height / 2) * 2 / diameter;
  const lengthSquared = x * x + y * y;
  if (lengthSquared <= 1) return { x, y, z: Math.sqrt(1 - lengthSquared) };
  const length = Math.sqrt(lengthSquared);
  x /= length; y /= length;
  return { x, y, z: 0 };
}

function pushBuildHistory() {
  if (!state.molecule) return;
  pushBuildSnapshot(state.molecule);
}

function captureDockingContactState() {
  return {
    remaps:[...state.dockingContactRemaps.entries()].map(([id, value]) =>
      [id, structuredClone(value)]),
    proposals:[...state.dockingContactRemapProposals.entries()].map(([id, value]) =>
      [id, structuredClone(value)]),
    selectedHbondIds:[...state.dockingSelectedHbondIds],
  };
}

function restoreDockingContactState(snapshot = {}) {
  state.dockingContactRemaps = new Map(structuredClone(snapshot.remaps || []));
  state.dockingContactRemapProposals = new Map(structuredClone(snapshot.proposals || []));
  state.dockingSelectedHbondIds = new Set(snapshot.selectedHbondIds || []);
}

function buildHistoryEntry(molecule, dockingContactState = captureDockingContactState()) {
  return {
    schema:'molarium.build-history/v2',
    molecule:structuredClone(molecule),
    dockingContactState:structuredClone(dockingContactState),
  };
}

function pushBuildSnapshot(snapshot, dockingContactState = captureDockingContactState()) {
  if (!snapshot) return;
  const entry = snapshot.schema === 'molarium.build-history/v2'
    ? structuredClone(snapshot) : buildHistoryEntry(snapshot, dockingContactState);
  state.buildHistory.push(entry);
  if (state.buildHistory.length > 30) state.buildHistory.shift();
  state.redoHistory = [];
  updateHistoryButtons();
}

function restoreMolecule(snapshot) {
  const entry = snapshot?.schema === 'molarium.build-history/v2'
    ? snapshot : buildHistoryEntry(snapshot, { remaps:[], proposals:[],
      selectedHbondIds:[...state.dockingSelectedHbondIds] });
  chemistryValidationSequence += 1;
  smallMoleculePolishSequence += 1;
  state.chemistryTransaction = null;
  state.chemistryEditFinishing = false;
  state.molecule = structuredClone(entry.molecule);
  restoreDockingContactState(entry.dockingContactState);
  state.dockingResult = null;
  state.sidechainRotamerEnsemble = null;
  refreshStructureComponents();
  state.selectedAtom = null;
  state.selectedAtoms = [];
  updateGeometryControl(); updateInfo(); updateDockingUi(); updateOptimizerControls();
  updateHistoryButtons(); draw(); schedule2DDepiction(0);
}

function updateHistoryButtons() {
  const pendingChemistry = Boolean(state.chemistryTransaction);
  document.querySelector('#undo-atom').disabled = pendingChemistry || !state.buildHistory.length;
  document.querySelector('#redo-atom').disabled = pendingChemistry || !state.redoHistory.length;
}

function removeAtomAt(molecule, atomIndex) {
  molecule.atoms.splice(atomIndex, 1);
  molecule.bonds = molecule.bonds
    .filter((bond) => bond.a !== atomIndex && bond.b !== atomIndex)
    .map((bond) => ({ ...bond, a: bond.a > atomIndex ? bond.a - 1 : bond.a, b: bond.b > atomIndex ? bond.b - 1 : bond.b }));
}

function atomFormalCharge(atom) {
  const charge = Number(atom?.formalCharge ?? atom?.charge ?? 0);
  return Number.isFinite(charge) ? Math.trunc(charge) : 0;
}

function chemistryTargetValence(atom, heavyValence = 0) {
  const charge = atomFormalCharge(atom);
  if (atom.element === 'H') return 1;
  if (atom.element === 'B') return charge < 0 ? 4 : 3;
  if (atom.element === 'C') return charge ? 3 : 4;
  if (atom.element === 'N') return charge > 0 ? 4 : charge < 0 ? 2 : 3;
  if (atom.element === 'O') return charge > 0 ? 3 : charge < 0 ? 1 : 2;
  if (['F', 'Cl', 'Br', 'I'].includes(atom.element)) return charge > 0 ? 2 : 1;
  if (atom.element === 'P') return charge > 0 ? 4 : heavyValence > 3 ? 5 : 3;
  if (atom.element === 'S') return heavyValence > 4 ? 6 : heavyValence > 2 ? 4 : charge < 0 ? 1 : 2;
  if (atom.element === 'Si') return 4;
  return null;
}

function attachedBondEntries(molecule, atomIndex) {
  return molecule.bonds.flatMap((bond) => bond.a === atomIndex
    ? [{ bond, other:bond.b }] : bond.b === atomIndex ? [{ bond, other:bond.a }] : []);
}

function attachedHydrogenIndices(molecule, atomIndex) {
  return attachedBondEntries(molecule, atomIndex)
    .filter(({ other }) => molecule.atoms[other]?.element === 'H')
    .map(({ other }) => other);
}

function reseedAttachedHydrogenGeometry(molecule, atomIndex, targetCount = null) {
  const hydrogens = attachedHydrogenIndices(molecule, atomIndex);
  const count = Math.max(hydrogens.length, Number(targetCount) || 0);
  hydrogens.forEach((hydrogenIndex, ordinal) => {
    const position = proteinHydrogenPosition(molecule, atomIndex, ordinal, count);
    Object.assign(molecule.atoms[hydrogenIndex], position);
    const bond = bondBetween(molecule, atomIndex, hydrogenIndex);
    if (bond) bond.distance = Math.hypot(
      molecule.atoms[atomIndex].x - position.x,
      molecule.atoms[atomIndex].y - position.y,
      molecule.atoms[atomIndex].z - position.z);
  });
  return hydrogens;
}

function appendHydrogenAt(molecule, atomIndex, targetCount = null) {
  const parent = molecule.atoms[atomIndex];
  if (!parent || parent.element === 'H') throw new Error('Select a non-hydrogen atom first.');
  const existing = attachedHydrogenIndices(molecule, atomIndex).length;
  const total = Math.max(existing + 1, Number(targetCount) || 0);
  const position = proteinHydrogenPosition(molecule, atomIndex, existing, total);
  const hydrogenIndex = molecule.atoms.length;
  molecule.atoms.push({
    element:'H', aromatic:false, bracketed:false, explicitHydrogens:0, charge:0,
    ...position, prepared:true, builderHydrogen:true,
    ...(parent.record ? { record:parent.record, residueName:parent.residueName,
      residueIndex:parent.residueIndex, insertionCode:parent.insertionCode,
      chain:parent.chain, atomName:`H${String(parent.atomName || parent.element).slice(0, 2)}${existing + 1}`,
      occupancy:0 } : {}),
  });
  molecule.bonds.push({ a:atomIndex, b:hydrogenIndex, order:1,
    distance:Math.hypot(parent.x - position.x, parent.y - position.y, parent.z - position.z),
    topology:'builder' });
  reseedAttachedHydrogenGeometry(molecule, atomIndex, total);
  return molecule.atoms[hydrogenIndex];
}

function reconcileAtomHydrogens(molecule, atomReferences) {
  const changed = [];
  for (const atom of [...new Set(atomReferences)]) {
    let atomIndex = molecule.atoms.indexOf(atom);
    if (atomIndex < 0 || atom.element === 'H') continue;
    // Aromatic heteroatom hydrogen states ([nH], [n+], and related cases)
    // are not safely inferable from a generic valence count. Preserve them
    // and let RDKit sanitization validate the explicit state.
    if (atom.aromatic && atom.element !== 'C') continue;
    const heavyValence = attachedBondEntries(molecule, atomIndex)
      .filter(({ other }) => molecule.atoms[other]?.element !== 'H')
      .reduce((sum, { bond }) => sum + Number(bond.order || 1), 0);
    const target = chemistryTargetValence(atom, heavyValence);
    if (target == null) continue;
    if (heavyValence > target + 0.05)
      throw new Error(`${atom.element} atom ${atomIndex + 1} has heavy-atom valence ${heavyValence}; target ${target} for formal charge ${atomFormalCharge(atom)}.`);
    const desired = Math.max(0, Math.round(target - heavyValence));
    let hydrogens = attachedHydrogenIndices(molecule, atomIndex);
    while (hydrogens.length > desired) {
      removeAtomAt(molecule, hydrogens.at(-1));
      atomIndex = molecule.atoms.indexOf(atom);
      hydrogens = attachedHydrogenIndices(molecule, atomIndex);
    }
    while (hydrogens.length < desired) {
      changed.push(appendHydrogenAt(molecule, atomIndex, desired));
      hydrogens = attachedHydrogenIndices(molecule, atomIndex);
    }
    reseedAttachedHydrogenGeometry(molecule, atomIndex, desired);
    if (['O', 'S'].includes(atom.element)) relaxPreparationPolarHydrogens(molecule,
      attachedHydrogenIndices(molecule, atomIndex).filter((index) => molecule.atoms[index].builderHydrogen));
    changed.push(atom);
  }
  return changed;
}

function invalidateEditedChemistry(molecule) {
  delete molecule.parameterization;
  molecule.charge = molecule.atoms.reduce((sum, atom) => sum + atomFormalCharge(atom), 0);
  molecule.smiles = 'Custom structure';
  molecule.source = { ...(molecule.source || {}), chemistryEdited:true };
  delete molecule.source.initialGeometryPolish;
  delete molecule.source.lastInteractivePolish;
  delete molecule.source.lastInteractivePolishError;
  if (molecule.preparation) molecule.preparation = { ...molecule.preparation,
    status:'modified-after-preparation', parameterized:false, auditInvalidatedByBuilder:true };
}

function moleculeComponents(molecule) {
  const adjacency = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond) => { adjacency[bond.a].push(bond.b); adjacency[bond.b].push(bond.a); });
  const components = [];
  const seen = new Set();
  molecule.atoms.forEach((_, root) => {
    if (seen.has(root)) return;
    const component = []; const queue = [root]; seen.add(root);
    while (queue.length) {
      const atom = queue.shift(); component.push(atom);
      adjacency[atom].forEach((neighbor) => { if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); } });
    }
    components.push(component);
  });
  return components;
}

function positionComponentsForNewBond(molecule, first, second, order) {
  const components = moleculeComponents(molecule);
  const moving = components.find((component) => component.includes(second));
  if (!moving || moving.includes(first)) return;
  const atomA = molecule.atoms[first], atomB = molecule.atoms[second];
  const current = subtractVectors(atomB, atomA);
  const direction = normaliseVector(current);
  const target = equilibriumBondLength(atomA, atomB, order);
  const destination = { x:atomA.x + direction.x * target,
    y:atomA.y + direction.y * target, z:atomA.z + direction.z * target };
  const displacement = { x:destination.x - atomB.x,
    y:destination.y - atomB.y, z:destination.z - atomB.z };
  moving.forEach((index) => {
    molecule.atoms[index].x += displacement.x;
    molecule.atoms[index].y += displacement.y;
    molecule.atoms[index].z += displacement.z;
  });
}

function ringContainingBond(molecule, first, second) {
  return findRingCycles(molecule).find((cycle) => cycle.some((atom, position) =>
    (atom === first && cycle[(position + 1) % cycle.length] === second)
    || (atom === second && cycle[(position + 1) % cycle.length] === first))) || null;
}

function ringEdgeKeys(cycle) {
  return new Set(cycle.map((atom, position) => pairKey(atom, cycle[(position + 1) % cycle.length])));
}

function aromatizeRingForBond(molecule, first, second) {
  const ring = ringContainingBond(molecule, first, second);
  if (!ring) throw new Error('Aromatic order applies to a complete ring; create or select a ring bond first.');
  const edges = ringEdgeKeys(ring);
  ring.forEach((index) => { molecule.atoms[index].aromatic = true; });
  molecule.bonds.forEach((bond) => { if (edges.has(pairKey(bond.a, bond.b))) bond.order = 1.5; });
  return ring.map((index) => molecule.atoms[index]);
}

function kekulizeSimpleRingForBond(molecule, first, second, selectedOrder = 2) {
  const ring = ringContainingBond(molecule, first, second);
  if (!ring || ring.length % 2) throw new Error('This aromatic system cannot be safely edited as one alternating ring.');
  const edges = ringEdgeKeys(ring);
  const fused = molecule.bonds.some((bond) => Number(bond.order) === 1.5
    && (ring.includes(bond.a) || ring.includes(bond.b)) && !edges.has(pairKey(bond.a, bond.b)));
  if (fused) throw new Error('Editing one bond in a fused aromatic system is not yet supported; keep it aromatic.');
  const selectedPosition = ring.findIndex((atom, position) => pairKey(atom, ring[(position + 1) % ring.length]) === pairKey(first, second));
  const firstOrder = selectedOrder === 1 ? 1 : 2;
  for (let offset = 0; offset < ring.length; offset++) {
    const position = (selectedPosition + offset) % ring.length;
    const bond = bondBetween(molecule, ring[position], ring[(position + 1) % ring.length]);
    bond.order = offset % 2 ? (firstOrder === 1 ? 2 : 1) : firstOrder;
  }
  ring.forEach((index) => { molecule.atoms[index].aromatic = false; });
  return ring.map((index) => molecule.atoms[index]);
}

function normaliseVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  return length > 1e-7
    ? { x: vector.x / length, y: vector.y / length, z: vector.z / length }
    : { ...fallback };
}

function subtractVectors(first, second) {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z };
}

function dotVectors(first, second) {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function crossVectors(first, second) {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}

function bondBetween(molecule, first, second) {
  return molecule.bonds.find((bond) =>
    (bond.a === first && bond.b === second) || (bond.a === second && bond.b === first));
}

function bondDistance(molecule, first, second) {
  const vector = subtractVectors(molecule.atoms[second], molecule.atoms[first]);
  return Math.hypot(vector.x, vector.y, vector.z);
}

function bondAngleDegrees(molecule, first, center, last) {
  const fromCenter = normaliseVector(subtractVectors(molecule.atoms[first], molecule.atoms[center]));
  const toLast = normaliseVector(subtractVectors(molecule.atoms[last], molecule.atoms[center]));
  return Math.acos(Math.max(-1, Math.min(1, dotVectors(fromCenter, toLast)))) * 180 / Math.PI;
}

function torsionDegrees(molecule, first, second, third, last) {
  const axis = normaliseVector(subtractVectors(molecule.atoms[third], molecule.atoms[second]));
  const firstVector = subtractVectors(molecule.atoms[first], molecule.atoms[second]);
  const lastVector = subtractVectors(molecule.atoms[last], molecule.atoms[third]);
  const firstPlane = subtractVectors(firstVector, {
    x: axis.x * dotVectors(firstVector, axis),
    y: axis.y * dotVectors(firstVector, axis),
    z: axis.z * dotVectors(firstVector, axis),
  });
  const lastPlane = subtractVectors(lastVector, {
    x: axis.x * dotVectors(lastVector, axis),
    y: axis.y * dotVectors(lastVector, axis),
    z: axis.z * dotVectors(lastVector, axis),
  });
  const firstLength = Math.hypot(firstPlane.x, firstPlane.y, firstPlane.z);
  const lastLength = Math.hypot(lastPlane.x, lastPlane.y, lastPlane.z);
  if (firstLength < 1e-8 || lastLength < 1e-8) return 0;
  const v = normaliseVector(firstPlane), w = normaliseVector(lastPlane);
  return Math.atan2(dotVectors(crossVectors(axis, v), w), dotVectors(v, w)) * 180 / Math.PI;
}

function geometrySelection() {
  const selected = state.selectedAtoms;
  if (!state.molecule || selected.length < 2) return null;
  if (selected.length > 4) return {
    error: `${selected.length} atoms selected for a docking core; geometry editing supports up to 4.`,
  };
  const sequential = selected.slice(1).every((atom, index) => bondBetween(state.molecule, selected[index], atom));
  if (!sequential) return { error: 'Selections must follow directly bonded atoms.' };
  if (selected.length === 2) return {
    kind: 'bond', name: 'Bond length', value: bondDistance(state.molecule, selected[0], selected[1]),
    min: 0.5, max: 3, step: 0.01, decimals: 2, unit: 'Å',
  };
  if (selected.length === 3) return {
    kind: 'angle', name: 'Bond angle', value: bondAngleDegrees(state.molecule, ...selected),
    min: 30, max: 180, step: 1, decimals: 1, unit: '°',
  };
  return {
    kind: 'torsion', name: 'Torsion', value: torsionDegrees(state.molecule, ...selected),
    min: -180, max: 180, step: 1, decimals: 1, unit: '°',
  };
}

function selectionDescription() {
  return state.selectedAtoms.flatMap((index) => {
    const atom = state.molecule?.atoms?.[index];
    return atom ? [`${atom.element}${index + 1}`] : [];
  }).join('–');
}

function updateGeometryControl() {
  // Atom deletion and hydrogen reconciliation can shift array indices. Never
  // let a transient stale selection break the editor while the graph is being
  // committed.
  state.selectedAtoms = state.selectedAtoms.filter((index) =>
    Number.isInteger(index) && Boolean(state.molecule?.atoms?.[index]));
  state.selectedAtom = state.selectedAtoms.at(-1) ?? null;
  updateSidechainRotamerControls();
  const slider = document.querySelector('#geometry-slider');
  const input = document.querySelector('#geometry-value');
  const unit = document.querySelector('#geometry-unit');
  const help = document.querySelector('#geometry-selection-help');
  if (!slider || !input || !help) { updateChemistryEditor(); return; }
  const selection = geometrySelection();
  const ready = selection && !selection.error;
  slider.disabled = !ready; input.disabled = !ready;
  if (!ready) {
    unit.textContent = '—'; input.value = ''; slider.value = '50';
    help.textContent = selection?.error || (state.selectedAtoms.length
      ? `Selected ${selectionDescription()}. ${state.selectedAtoms.length === 1 ? 'Pick any second atom to create or edit a bond; continue along bonded atoms for an angle or torsion.' : 'Continue along bonded atoms for an angle or torsion.'}`
      : 'Choose Select, then pick 2 atoms for a bond, 3 for an angle, or 4 for a torsion.');
    updateChemistryEditor();
    return;
  }
  slider.min = String(selection.min); slider.max = String(selection.max); slider.step = String(selection.step);
  input.min = String(selection.min); input.max = String(selection.max); input.step = String(selection.step);
  slider.value = String(selection.value);
  if (document.activeElement !== input) input.value = selection.value.toFixed(selection.decimals);
  unit.textContent = selection.unit;
  help.textContent = `${selection.name} ${selectionDescription()} · ${selection.value.toFixed(selection.decimals)} ${selection.unit}`;
  updateChemistryEditor();
}

function connectedSide(molecule, start, blocked, cutFirst, cutSecond) {
  const adjacency = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond) => { adjacency[bond.a].push(bond.b); adjacency[bond.b].push(bond.a); });
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const atom = queue.shift();
    for (const neighbor of adjacency[atom]) {
      if ((atom === cutFirst && neighbor === cutSecond) || (atom === cutSecond && neighbor === cutFirst)) continue;
      if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
    }
  }
  return { atoms: [...seen], cyclic: seen.has(blocked) };
}

function geometryMovingAtoms(selection) {
  const selected = state.selectedAtoms;
  if (!document.querySelector('#move-connected').checked) {
    return { atoms: [selection.kind === 'torsion' ? selected[3] : selected.at(-1)], cyclic: false };
  }
  if (selection.kind === 'bond') return connectedSide(state.molecule, selected[1], selected[0], selected[0], selected[1]);
  return connectedSide(state.molecule, selected[2], selected[1], selected[1], selected[2]);
}

function rotateAtomsAroundAxis(indices, origin, axis, radians) {
  const quaternion = quaternionFromAxisAngle(axis, radians);
  indices.forEach((index) => {
    const atom = state.molecule.atoms[index];
    const rotated = rotateVectorByQuaternion(subtractVectors(atom, origin), quaternion);
    atom.x = origin.x + rotated.x; atom.y = origin.y + rotated.y; atom.z = origin.z + rotated.z;
  });
}

function updateStoredBondDistances() {
  state.molecule.bonds.forEach((bond) => {
    bond.distance = bondDistance(state.molecule, bond.a, bond.b);
  });
}

function applyGeometryValue(rawValue) {
  const selection = geometrySelection();
  if (!selection || selection.error) return false;
  const value = Math.max(selection.min, Math.min(selection.max, Number(rawValue)));
  if (!Number.isFinite(value)) return false;
  const moving = geometryMovingAtoms(selection);
  if (moving.cyclic) {
    showNotice(`Move connected atoms is unavailable across this ring ${selection.kind}. Uncheck it to move only the selected endpoint.`);
    updateGeometryControl(); return false;
  }
  const selected = state.selectedAtoms;
  if (selection.kind === 'bond') {
    const first = state.molecule.atoms[selected[0]], second = state.molecule.atoms[selected[1]];
    const axis = normaliseVector(subtractVectors(second, first));
    const delta = value - selection.value;
    moving.atoms.forEach((index) => {
      const atom = state.molecule.atoms[index];
      atom.x += axis.x * delta; atom.y += axis.y * delta; atom.z += axis.z * delta;
    });
  } else if (selection.kind === 'angle') {
    const center = state.molecule.atoms[selected[1]];
    const firstVector = subtractVectors(state.molecule.atoms[selected[0]], center);
    const lastVector = subtractVectors(state.molecule.atoms[selected[2]], center);
    let axis = crossVectors(firstVector, lastVector);
    if (Math.hypot(axis.x, axis.y, axis.z) < 1e-8) {
      const unit = normaliseVector(firstVector);
      axis = Math.abs(unit.z) < 0.8 ? crossVectors(unit, { x: 0, y: 0, z: 1 }) : crossVectors(unit, { x: 0, y: 1, z: 0 });
    }
    rotateAtomsAroundAxis(moving.atoms, center, axis, (value - selection.value) * Math.PI / 180);
  } else {
    const second = state.molecule.atoms[selected[1]], third = state.molecule.atoms[selected[2]];
    const axis = subtractVectors(third, second);
    let delta = value - selection.value;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    rotateAtomsAroundAxis(moving.atoms, second, axis, delta * Math.PI / 180);
  }
  clearCalculationResult(); updateStoredBondDistances(); updateInfo(); updateGeometryControl(); draw();
  return true;
}

function beginGeometryEdit() {
  if (state.geometryEditActive || !geometrySelection() || geometrySelection().error) return;
  pushBuildHistory(); state.geometryEditActive = true;
}

function finishGeometryEdit() {
  state.geometryEditActive = false;
}

function selectGeometryAtom(index) {
  if (state.dockingContactDraft) {
    selectManualDockingContactAtom(index).catch((error) => showNotice(error.message));
    return;
  }
  const existing = state.selectedAtoms.indexOf(index);
  if (existing >= 0) state.selectedAtoms = state.selectedAtoms.slice(0, existing);
  else {
    const connected = !state.selectedAtoms.length
      || state.selectedAtoms.some((selectedIndex) => bondBetween(state.molecule, selectedIndex, index));
    if (!connected) {
      showNotice('Each new atom must bond to the connected selection.'); return;
    }
    state.selectedAtoms.push(index);
  }
  state.selectedAtom = state.selectedAtoms.at(-1) ?? null;
  updateGeometryControl(); updateBuildStatus(); updateDockingUi(); draw(); schedule2DDepiction(0);
}

let chemistryValidationSequence = 0;

function setChemistryValidation(status, message) {
  const node = document.querySelector('#chemistry-validation');
  if (!node) return;
  node.className = `chemistry-validation${status ? ` ${status}` : ''}`;
  node.textContent = message;
}

function selectedProteinChemistryLocked(indices = state.selectedAtoms) {
  return indices.some((index) => state.molecule?.atoms[index]?.record === 'ATOM');
}

function chemistryImmediateRefinementEnabled() {
  return state.chemistryEditPolicy === 'immediate-refine';
}

function beginChemistryTransaction() {
  if (!state.chemistryTransaction) {
    state.chemistryTransaction = {
      snapshot:structuredClone(state.molecule), changedAtoms:new Set(), editCount:0,
      editId:`chem-edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      startedAt:performance.now(),
      dockingContactState:captureDockingContactState(),
      depictionTemplateMolBlock:state.depictionTemplateMolBlock,
      depictionOrientationAnchor:null,
    };
  }
  return state.chemistryTransaction;
}

function updateChemistryTransactionUi() {
  const transaction = state.chemistryTransaction;
  const pending = Boolean(transaction);
  const panel = document.querySelector('#chemistry-pending');
  const immediate = document.querySelector('#chemistry-immediate-refine');
  if (!panel || !immediate) return;
  immediate.checked = state.chemistryEditPolicy === 'immediate-refine';
  panel.classList.toggle('hidden', !pending);
  immediate.disabled = pending || state.chemistryEditFinishing;
  document.querySelector('#finish-chemistry-changes').disabled = !pending || state.chemistryEditFinishing;
  document.querySelector('#discard-chemistry-changes').disabled = !pending || state.chemistryEditFinishing;
  if (pending) {
    const count = transaction.editCount;
    document.querySelector('#chemistry-pending-summary').textContent = state.chemistryEditFinishing
      ? 'Finishing chemistry…' : `${count} pending change${count === 1 ? '' : 's'}`;
  }
  const viewerToolbar = document.querySelector('.viewer-toolbar');
  viewerToolbar?.classList.toggle('chemistry-pending', pending);
  document.querySelectorAll('.viewer-standard-action').forEach((button) =>
    button.classList.toggle('hidden', pending));
  const viewerFinish = document.querySelector('#viewer-finish-chemistry');
  const viewerDiscard = document.querySelector('#viewer-discard-chemistry');
  viewerFinish?.classList.toggle('hidden', !pending);
  viewerDiscard?.classList.toggle('hidden', !pending);
  if (viewerFinish) {
    viewerFinish.disabled = !pending || state.chemistryEditFinishing;
    viewerFinish.textContent = state.chemistryEditFinishing ? 'Finishing chemistry…' : 'Finish chemistry';
  }
  if (viewerDiscard) viewerDiscard.disabled = !pending || state.chemistryEditFinishing;
  update2DEditorUi();
  updateDockingUi();
  updateOptimizerControls();
}

function updateChemistryEditor() {
  const element = document.querySelector('#chemistry-element');
  if (!element) return;
  const charge = document.querySelector('#chemistry-formal-charge');
  const applyAtom = document.querySelector('#apply-atom-chemistry');
  const order = document.querySelector('#chemistry-bond-order');
  const applyBond = document.querySelector('#apply-bond-chemistry');
  const deleteBond = document.querySelector('#delete-bond-chemistry');
  const addHydrogen = document.querySelector('#add-explicit-hydrogen');
  const removeHydrogen = document.querySelector('#remove-explicit-hydrogen');
  const deleteAtom = document.querySelector('#delete-selected-atom');
  const help = document.querySelector('#chemistry-selection-help');
  const selected = state.selectedAtoms;
  const one = selected.length === 1;
  const pair = selected.length === 2;
  const locked = selectedProteinChemistryLocked();
  const busy = state.chemistryEditFinishing;
  element.disabled = !one || locked || busy; charge.disabled = !one || locked || busy;
  applyAtom.disabled = !one || locked || busy;
  addHydrogen.disabled = !one || locked || busy || state.molecule?.atoms[selected[0]]?.element === 'H';
  removeHydrogen.disabled = !one || locked || busy || !attachedHydrogenIndices(state.molecule, selected[0]).length;
  deleteAtom.disabled = !one || locked || busy;
  order.disabled = !pair || locked || busy;
  applyBond.disabled = !pair || locked || busy;
  const bond = pair ? bondBetween(state.molecule, selected[0], selected[1]) : null;
  deleteBond.disabled = !pair || locked || busy || !bond;
  applyBond.textContent = bond ? 'Update bond' : 'Create bond';
  if (one) {
    const atom = state.molecule.atoms[selected[0]];
    element.value = atom.element;
    if (document.activeElement !== charge) charge.value = String(atomFormalCharge(atom));
    help.textContent = locked
      ? 'Canonical protein atoms are edited through Protein Preparation; ligand and small-molecule atoms remain editable.'
      : `${atom.element}${selected[0] + 1} · formal charge ${atomFormalCharge(atom) >= 0 ? '+' : ''}${atomFormalCharge(atom)} · ${attachedHydrogenIndices(state.molecule, selected[0]).length} explicit H`;
  } else if (pair) {
    if (bond) order.value = String(Number(bond.order || 1));
    help.textContent = locked
      ? 'Canonical protein bonds are protected; use Protein Preparation.'
      : `${selectionDescription()} · ${bond ? `${order.options[order.selectedIndex].text} bond selected` : 'no bond; choose an order to connect the atoms'}`;
  } else {
    help.textContent = selected.length > 2
      ? 'Chemistry editing uses one atom or one atom pair; the current path remains available for geometry editing.'
      : 'Choose Select, then pick one atom or a pair of atoms.';
  }
  updateChemistryTransactionUi();
  const validation = state.molecule?.source?.chemistryValidation;
  if (state.chemistryTransaction) setChemistryValidation(
    state.chemistryTransaction.validationError ? 'invalid' : 'pending',
    state.chemistryEditFinishing
      ? 'Reconciling hydrogens, validating the complete structure, and refining the edited region…'
      : state.chemistryTransaction.validationError
        ? state.chemistryTransaction.validationError
        : 'Changes are staged. Hydrogens and coordinates will update together when you finish.');
  else if (validation?.status === 'invalid') setChemistryValidation('invalid', validation.message);
  else if (validation?.status === 'valid') setChemistryValidation('valid', `RDKit sanitized · ${validation.canonicalSmiles || 'valid explicit structure'}`);
  else if (validation?.status === 'pending') setChemistryValidation('pending', 'Checking valence and aromaticity with RDKit…');
  else setChemistryValidation('', 'Formal charge is editable; force-field partial charges remain derived.');
}

function chemistryValidationSubset(molecule, changedAtoms) {
  const seeds = [...new Set(changedAtoms || [])]
    .map((atom) => molecule.atoms.indexOf(atom)).filter((index) => index >= 0);
  if (!seeds.length) return molecule;
  const adjacency = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond) => {
    adjacency[bond.a].push(bond.b); adjacency[bond.b].push(bond.a);
  });
  const included = new Set(seeds), queue = [...seeds];
  while (queue.length) {
    const atom = queue.shift();
    adjacency[atom].forEach((neighbor) => {
      if (!included.has(neighbor)) { included.add(neighbor); queue.push(neighbor); }
    });
  }
  const indices = [...included].sort((first, second) => first - second);
  const remap = new Map(indices.map((index, localIndex) => [index, localIndex]));
  const atoms = indices.map((index) => ({ ...molecule.atoms[index] }));
  const bonds = molecule.bonds.flatMap((bond) => remap.has(bond.a) && remap.has(bond.b)
    ? [{ ...bond, a:remap.get(bond.a), b:remap.get(bond.b) }] : []);
  return {
    name:`${molecule.name || 'Molecule'} · edited component`, atoms, bonds,
    charge:atoms.reduce((sum, atom) => sum + atomFormalCharge(atom), 0),
    source:{ format:'builder-validation-subset' },
  };
}

async function validateEditedChemistry(molecule, changedAtoms, { schedulePolish = true } = {}) {
  const token = ++chemistryValidationSequence;
  const validationMolecule = chemistryValidationSubset(molecule, changedAtoms);
  const diagnostics = moleculeDiagnostics(validationMolecule);
  if (diagnostics.valenceViolations.length) {
    const first = diagnostics.valenceViolations[0];
    const message = `Open valence at ${first.element}${first.index + 1}; add a bond or hydrogen, or change its formal charge.`;
    molecule.source.chemistryValidation = { status:'invalid', message };
    updateChemistryEditor(); showNotice(message);
    return { valid:false, diagnostics };
  }
  molecule.source.chemistryValidation = { status:'pending' };
  updateChemistryEditor();
  try {
    const result = await runRDKitJob('sanitize', validationMolecule, () => {});
    if (token !== chemistryValidationSequence || state.molecule !== molecule) return { valid:false, stale:true };
    molecule.source.chemistryValidation = { status:'valid', canonicalSmiles:result.canonicalSmiles };
    updateChemistryEditor();
    const indices = [...new Set(changedAtoms)].map((atom) => molecule.atoms.indexOf(atom)).filter((index) => index >= 0);
    if (schedulePolish) scheduleSmallMoleculePolish(indices);
    return { valid:true, diagnostics, canonicalSmiles:result.canonicalSmiles };
  } catch (error) {
    if (token !== chemistryValidationSequence || state.molecule !== molecule) return { valid:false, stale:true };
    const message = `RDKit rejected this chemical state: ${error.message}`;
    molecule.source.chemistryValidation = { status:'invalid', message };
    updateChemistryEditor(); showNotice(message);
    return { valid:false, diagnostics, error:error.message };
  }
}

async function applyChemistryMutation(mutator) {
  if (!state.molecule?.atoms.length) throw new Error('Load or build a molecule first.');
  if (selectedProteinChemistryLocked()) throw new Error('Canonical protein chemistry is protected; use Protein Preparation.');
  if (analogueDesignCaptureNeeded()
    && !await ensureAnalogueDesignReferenceBeforeChemistry()) return null;
  // A docking edit uses stable graph identities for contact lineage and
  // topology hashes. Assign them before taking the transaction snapshot, and
  // again immediately after mutation so staged consumers never see an
  // anonymous newly created atom.
  // Chemist Actions promise persistent graph identities even when no docking
  // reference has been captured yet. Assign identities for every chemistry
  // mutation; a docking reference merely contributes additional reserved IDs.
  const referenceCore = await import('./docking/reference-core.mjs');
  const identityNamespace = `design-${state.molecule.source?.pdbId || 'complex'}`;
  referenceCore.ensureStableAtomIds(state.molecule,
    identityNamespace, state.dockingReference?.ligand?.atomIds || []);
  const staged = !chemistryImmediateRefinementEnabled();
  const transaction = staged ? beginChemistryTransaction() : null;
  const snapshot = structuredClone(state.molecule);
  const dockingContactState = captureDockingContactState();
  if (!staged) pushBuildSnapshot(snapshot);
  try {
    const outcome = mutator(state.molecule, { staged }) || {};
    referenceCore.ensureStableAtomIds(state.molecule,
      identityNamespace, [
        ...(state.dockingReference?.ligand?.atomIds || []),
        ...snapshot.atoms.map((atom) => atom.designAtomId),
      ].filter(Boolean));
    invalidateEditedChemistry(state.molecule);
    refreshStructureComponents();
    clearCalculationResult(); updateStoredBondDistances();
    const selection = outcome.selection || [];
    state.selectedAtoms = selection.map((atom) => state.molecule.atoms.indexOf(atom)).filter((index) => index >= 0);
    state.selectedAtom = state.selectedAtoms.at(-1) ?? null;
    updateInfo(); updateGeometryControl(); updateHistoryButtons(); draw(); schedule2DDepiction(0);
    if (staged) {
      transaction.validationError = null;
      (outcome.changedAtoms || selection).forEach((atom) => {
        if (state.molecule.atoms.includes(atom)) transaction.changedAtoms.add(atom);
      });
      transaction.editCount += 1;
      state.molecule.source.chemistryValidation = { status:'pending', staged:true,
        editCount:transaction.editCount };
      updateChemistryEditor(); updateHistoryButtons();
      return { ...moleculeDiagnostics(state.molecule),
        validation:{ valid:false, pending:true, editCount:transaction.editCount },
        molecule:structuredClone(state.molecule) };
    }
    const changedAtoms = (outcome.changedAtoms || selection)
      .filter((atom) => state.molecule.atoms.includes(atom));
    const validation = await validateEditedChemistry(state.molecule, changedAtoms,
      { schedulePolish:false });
    const changedAtomIndices = changedAtoms.map((atom) => state.molecule.atoms.indexOf(atom))
      .filter((index) => index >= 0);
    const immediateEditId = `chem-edit-immediate-${Date.now().toString(36)}`;
    const polish = validation.valid
      ? await polishCommittedChemistry(state.molecule, changedAtomIndices,
        { beforeMolecule:snapshot, editId:immediateEditId }) : null;
    const contactFeatureRemaps = validation.valid
      ? await reconcileDockingContactFeaturesAfterChemistry(
        { snapshot, dockingContactState,
          editId:immediateEditId }, changedAtomIndices) : [];
    updateInfo(); updateDockingUi(); updateOptimizerControls(); draw(); schedule2DDepiction(0);
    return { ...moleculeDiagnostics(state.molecule), validation, polish, contactFeatureRemaps,
      molecule:structuredClone(state.molecule) };
  } catch (error) {
    if (!staged) state.buildHistory.pop();
    const restore = staged ? transaction.snapshot : snapshot;
    state.chemistryTransaction = null;
    state.chemistryEditFinishing = false;
    state.molecule = structuredClone(restore);
    refreshStructureComponents();
    state.selectedAtoms = []; state.selectedAtom = null;
    updateInfo(); updateGeometryControl(); updateHistoryButtons(); draw();
    showNotice(staged ? `${error.message} Pending chemistry changes were discarded.` : error.message);
    throw error;
  }
}

async function polishCommittedChemistry(molecule, changedAtomIndices,
  { beforeMolecule = null, editId = null } = {}) {
  let transformedRegion = null;
  if (beforeMolecule && state.dockingReference?.mode === 'pose-propagation') {
    const module = await import('./docking/transformed-ring-region.mjs');
    transformedRegion = module.transformedRingRegion(beforeMolecule, molecule);
    module.recordTransformedRingRegion(molecule, transformedRegion, { editId });
  }
  const plan = localEditPolishPlan(molecule, changedAtomIndices, 1, {
    releasedAtomIds:transformedRegion?.releasedHeavyAtomIds || [],
  });
  if (!plan) return null;
  const movable = new Set(plan.movableGlobalAtomIndices);
  const fixedAtomIndices = plan.globalAtomIndices.flatMap((globalIndex, localIndex) =>
    movable.has(globalIndex) ? [] : [localIndex]);
  const token = ++smallMoleculePolishSequence;
  try {
    updateBuildStatus(`Refining ${plan.scope}…`);
    const result = await runRDKitJob('geometry', plan.molecule, () => {}, {
      maxIterations:60, snapshotFrequency:60, fixedAtomIndices,
    });
    if (token !== smallMoleculePolishSequence || state.molecule !== molecule) return null;
    applyMappedCalculationPositions(molecule, result.positions, plan.globalAtomIndices);
    recordInteractivePolish(molecule, {
      engine:result.forcefield, fallback:Boolean(result.fallback), elapsedMs:result.elapsedMs,
      movableAtomCount:result.movableAtomCount, fixedAtomCount:result.fixedAtomCount,
      proteinFixedAtomCount:molecule.atoms.length - plan.globalAtomIndices.length,
      scope:plan.scope, bondRadius:1, stagedChemistry:true,
      cleanupMode:plan.cleanupMode,
      fixedInheritedHeavyAtomCount:plan.fixedInheritedHeavyAtomCount,
      transformedRegion:transformedRegion ? structuredClone(transformedRegion) : null,
    });
    return result;
  } catch (error) {
    molecule.source = { ...(molecule.source || {}),
      lastInteractivePolishError:String(error?.message || error) };
    return { error:String(error?.message || error) };
  } finally {
    if (token === smallMoleculePolishSequence) updateBuildStatus();
  }
}

async function finishChemistryTransaction() {
  const transaction = state.chemistryTransaction;
  const molecule = state.molecule;
  if (!transaction || !molecule) return null;
  if (state.chemistryEditFinishing) return null;
  state.chemistryEditFinishing = true;
  transaction.validationError = null;
  updateChemistryEditor();
  try {
    const selectedAtomObjects = state.selectedAtoms
      .map((index) => molecule.atoms[index]).filter(Boolean);
    const affected = [...transaction.changedAtoms].filter((atom) => molecule.atoms.includes(atom));
    const reconciled = reconcileAtomHydrogens(molecule, affected);
    reconciled.forEach((atom) => {
      if (molecule.atoms.includes(atom)) transaction.changedAtoms.add(atom);
    });
    // Hydrogen reconciliation is part of the committed graph. Assign stable
    // identities after it, before provenance hashing and transformed-ring
    // analysis, so an edit cannot sanitize successfully yet fail its audit
    // merely because Finish created a new H atom.
    if (state.dockingReference) {
      const { ensureStableAtomIds } = await import('./docking/reference-core.mjs');
      ensureStableAtomIds(molecule,
        `design-${molecule.source?.pdbId || 'complex'}`,
        [ ...(state.dockingReference.ligand?.atomIds || []),
          ...transaction.snapshot.atoms.map((atom) => atom.designAtomId) ].filter(Boolean));
    }
    invalidateEditedChemistry(molecule);
    refreshStructureComponents();
    state.selectedAtoms = selectedAtomObjects.map((atom) => molecule.atoms.indexOf(atom))
      .filter((index) => index >= 0);
    state.selectedAtom = state.selectedAtoms.at(-1) ?? null;
    updateStoredBondDistances(); updateInfo(); draw();
    const changedAtoms = [...transaction.changedAtoms].filter((atom) => molecule.atoms.includes(atom));
    const validation = await validateEditedChemistry(molecule, changedAtoms, { schedulePolish:false });
    if (!validation.valid) {
      transaction.validationError = molecule.source?.chemistryValidation?.message
        || 'The complete chemical state is not valid yet. Continue editing or discard the batch.';
      showNotice(transaction.validationError);
      return { ...moleculeDiagnostics(molecule), validation,
        pending:true, molecule:structuredClone(molecule) };
    }
    const changedAtomIndices = changedAtoms.map((atom) => molecule.atoms.indexOf(atom))
      .filter((index) => index >= 0);
    const polish = await polishCommittedChemistry(molecule, changedAtomIndices,
      { beforeMolecule:transaction.snapshot, editId:transaction.editId });
    if (state.chemistryTransaction !== transaction || state.molecule !== molecule) return null;
    const contactFeatureRemaps = await reconcileDockingContactFeaturesAfterChemistry(
      transaction, changedAtomIndices);
    if (state.chemistryTransaction !== transaction || state.molecule !== molecule) return null;
    pushBuildSnapshot(transaction.snapshot, transaction.dockingContactState);
    state.chemistryTransaction = null;
    state.chemistryEditFinishing = false;
    updateInfo(); updateGeometryControl(); updateChemistryEditor(); updateHistoryButtons(); draw(); schedule2DDepiction(0);
    showToast(`Chemistry finished · ${transaction.editCount} change${transaction.editCount === 1 ? '' : 's'}`);
    return { ...moleculeDiagnostics(molecule), validation, polish, contactFeatureRemaps,
      pending:false, molecule:structuredClone(molecule) };
  } catch (error) {
    restoreDockingContactState(transaction.dockingContactState);
    transaction.validationError = error.message || String(error);
    showNotice(transaction.validationError);
    return { ...moleculeDiagnostics(molecule),
      validation:{ valid:false, error:transaction.validationError }, pending:true,
      molecule:structuredClone(molecule) };
  } finally {
    if (state.chemistryTransaction === transaction) {
      state.chemistryEditFinishing = false;
      updateChemistryEditor(); updateHistoryButtons(); draw();
    }
  }
}

function discardChemistryTransaction() {
  const transaction = state.chemistryTransaction;
  if (!transaction || state.chemistryEditFinishing) return false;
  chemistryValidationSequence += 1;
  smallMoleculePolishSequence += 1;
  state.chemistryTransaction = null;
  state.chemistryEditFinishing = false;
  restoreMolecule(buildHistoryEntry(transaction.snapshot, transaction.dockingContactState));
  showToast('Pending chemistry changes discarded');
  return true;
}

async function applySelectedAtomChemistry(element, formalCharge) {
  const selectedIndex = state.selectedAtoms[0];
  if (state.selectedAtoms.length !== 1) throw new Error('Select exactly one atom.');
  const nextCharge = Number(formalCharge);
  if (!ELEMENTS[element] || !Number.isInteger(nextCharge) || nextCharge < -4 || nextCharge > 4)
    throw new Error('Choose a supported element and an integer formal charge from −4 to +4.');
  return applyChemistryMutation((molecule, { staged }) => {
    const atom = molecule.atoms[selectedIndex];
    if (atom.aromatic && (atom.element !== element || atomFormalCharge(atom) !== nextCharge))
      throw new Error('Change an aromatic atom by first kekulizing its ring bond; aromatic heteroatom states are not guessed.');
    atom.element = element; atom.charge = nextCharge; atom.formalCharge = nextCharge;
    if (element === 'H') atom.aromatic = false;
    const changedAtoms = staged ? [atom] : reconcileAtomHydrogens(molecule, [atom]);
    return { selection:[atom], changedAtoms };
  });
}

async function applySelectedBondChemistry(rawOrder) {
  if (state.selectedAtoms.length !== 2) throw new Error('Select exactly two atoms.');
  const [firstIndex, secondIndex] = state.selectedAtoms;
  const nextOrder = Number(rawOrder);
  if (![1, 1.5, 2, 3].includes(nextOrder)) throw new Error('Choose a supported bond order.');
  return applyChemistryMutation((molecule, { staged }) => {
    const first = molecule.atoms[firstIndex], second = molecule.atoms[secondIndex];
    let bond = bondBetween(molecule, firstIndex, secondIndex);
    if (!bond) {
      positionComponentsForNewBond(molecule, firstIndex, secondIndex, nextOrder);
      bond = { a:firstIndex, b:secondIndex, order:nextOrder === 1.5 ? 1 : nextOrder, topology:'builder' };
      molecule.bonds.push(bond);
    }
    let affected = [first, second];
    if (nextOrder === 1.5) affected = aromatizeRingForBond(molecule, firstIndex, secondIndex);
    else if (Number(bond.order) === 1.5 || first.aromatic || second.aromatic) {
      if (nextOrder === 3) throw new Error('A triple bond cannot replace one edge of an aromatic ring.');
      affected = kekulizeSimpleRingForBond(molecule, firstIndex, secondIndex, nextOrder);
    } else {
      bond.order = nextOrder; bond.topology = 'builder';
    }
    const changedAtoms = staged ? affected : [...affected, ...reconcileAtomHydrogens(molecule, affected)];
    return { selection:[first, second], changedAtoms };
  });
}

async function deleteSelectedBondChemistry() {
  if (state.selectedAtoms.length !== 2) throw new Error('Select exactly two bonded atoms.');
  const [firstIndex, secondIndex] = state.selectedAtoms;
  return applyChemistryMutation((molecule, { staged }) => {
    const first = molecule.atoms[firstIndex], second = molecule.atoms[secondIndex];
    let bond = bondBetween(molecule, firstIndex, secondIndex);
    if (!bond) throw new Error('The selected atoms are not bonded.');
    let affected = [first, second];
    if (Number(bond.order) === 1.5 || first.aromatic || second.aromatic)
      affected = kekulizeSimpleRingForBond(molecule, firstIndex, secondIndex, 1);
    bond = bondBetween(molecule, firstIndex, secondIndex);
    molecule.bonds.splice(molecule.bonds.indexOf(bond), 1);
    const changedAtoms = staged ? affected : [...affected, ...reconcileAtomHydrogens(molecule, affected)];
    return { selection:[first, second], changedAtoms };
  });
}

async function addSelectedHydrogenChemistry() {
  if (state.selectedAtoms.length !== 1) throw new Error('Select exactly one atom.');
  const selectedIndex = state.selectedAtoms[0];
  return applyChemistryMutation((molecule, { staged }) => {
    const atom = molecule.atoms[selectedIndex];
    const used = attachedBondEntries(molecule, selectedIndex).reduce((sum, { bond }) => sum + Number(bond.order || 1), 0);
    const target = chemistryTargetValence(atom, used - attachedHydrogenIndices(molecule, selectedIndex).length);
    if (target != null && used >= target - 0.05) throw new Error(`${atom.element}${selectedIndex + 1} has no open valence for another hydrogen.`);
    const hydrogen = appendHydrogenAt(molecule, selectedIndex);
    if (!staged && ['O', 'S'].includes(atom.element))
      relaxPreparationPolarHydrogens(molecule, [molecule.atoms.indexOf(hydrogen)]);
    return { selection:[atom], changedAtoms:[atom, hydrogen] };
  });
}

async function removeSelectedHydrogenChemistry() {
  if (state.selectedAtoms.length !== 1) throw new Error('Select exactly one atom.');
  const selectedIndex = state.selectedAtoms[0];
  return applyChemistryMutation((molecule) => {
    const atom = molecule.atoms[selectedIndex];
    const hydrogenIndex = attachedHydrogenIndices(molecule, selectedIndex).at(-1);
    if (hydrogenIndex == null) throw new Error(`${atom.element}${selectedIndex + 1} has no explicit hydrogen to remove.`);
    removeAtomAt(molecule, hydrogenIndex);
    return { selection:[atom], changedAtoms:[atom] };
  });
}

async function deleteSelectedAtomChemistry() {
  if (state.selectedAtoms.length !== 1) throw new Error('Select exactly one atom.');
  const selectedIndex = state.selectedAtoms[0];
  return applyChemistryMutation((molecule, { staged }) => {
    const atom = molecule.atoms[selectedIndex];
    if (atom.aromatic) throw new Error('Deleting one aromatic atom is ambiguous; kekulize or open the ring first.');
    const neighbors = attachedBondEntries(molecule, selectedIndex)
      .map(({ other }) => molecule.atoms[other]).filter((neighbor) => neighbor?.element !== 'H');
    const attachedHydrogens = atom.element === 'H' ? [] : attachedHydrogenIndices(molecule, selectedIndex);
    [...attachedHydrogens, selectedIndex].sort((first, second) => second - first)
      .forEach((index) => removeAtomAt(molecule, index));
    const changedAtoms = atom.element === 'H' || staged
      ? neighbors : [...neighbors, ...reconcileAtomHydrogens(molecule, neighbors)];
    return { selection:neighbors.slice(0, 1), changedAtoms };
  });
}

function attachmentDirection(molecule, atomIndex) {
  const anchor = molecule.atoms[atomIndex];
  const neighbors = molecule.bonds.flatMap((bond) => bond.a === atomIndex ? [bond.b] : bond.b === atomIndex ? [bond.a] : []);
  if (!neighbors.length) return { x: 1, y: 0, z: 0 };
  const directions = neighbors.map((index) => normaliseVector({
    x:molecule.atoms[index].x - anchor.x,
    y:molecule.atoms[index].y - anchor.y,
    z:molecule.atoms[index].z - anchor.z,
  }));
  if (directions.length === 1) return {
    x:-directions[0].x, y:-directions[0].y, z:-directions[0].z,
  };
  const cross = (first, second) => ({
    x:first.y * second.z - first.z * second.y,
    y:first.z * second.x - first.x * second.z,
    z:first.x * second.y - first.y * second.x,
  });
  const length = (vector) => Math.hypot(vector.x, vector.y, vector.z);
  const candidates = [];
  const sum = directions.reduce((total, direction) => ({
    x:total.x + direction.x, y:total.y + direction.y, z:total.z + direction.z,
  }), { x:0, y:0, z:0 });
  if (length(sum) > 1e-6) candidates.push(normaliseVector({ x:-sum.x, y:-sum.y, z:-sum.z }));
  for (let first = 0; first < directions.length; first += 1) {
    candidates.push({ x:-directions[first].x, y:-directions[first].y, z:-directions[first].z });
    for (let second = first + 1; second < directions.length; second += 1) {
      const normal = cross(directions[first], directions[second]);
      if (length(normal) <= 1e-6) continue;
      const unit = normaliseVector(normal);
      candidates.push(unit, { x:-unit.x, y:-unit.y, z:-unit.z });
    }
  }
  // Deterministic tetrahedral-like fallbacks for collinear or symmetric
  // neighbourhoods.  Select the direction with the greatest angular
  // separation from every existing substituent; no force field is run until
  // the complete chemistry transaction is finished.
  candidates.push(
    { x:1, y:0, z:0 }, { x:-1, y:0, z:0 },
    { x:0, y:1, z:0 }, { x:0, y:-1, z:0 },
    { x:0, y:0,z:1 }, { x:0, y:0,z:-1 });
  const score = (candidate) => Math.max(...directions.map((direction) =>
    candidate.x * direction.x + candidate.y * direction.y + candidate.z * direction.z));
  return candidates.reduce((best, candidate) => score(candidate) < score(best) - 1e-12
    ? candidate : best, candidates[0]);
}

function removeAttachmentHydrogen(molecule, atomIndex, preferredDirection = null) {
  const candidates = molecule.bonds.filter((entry) => {
    const other = entry.a === atomIndex ? entry.b : entry.b === atomIndex ? entry.a : null;
    return other != null && molecule.atoms[other]?.element === 'H';
  });
  let bond = candidates[0];
  if (preferredDirection && candidates.length > 1) {
    const anchor = molecule.atoms[atomIndex];
    bond = [...candidates].sort((first, second) => {
      const score = (entry) => {
        const hydrogenIndex = entry.a === atomIndex ? entry.b : entry.a;
        const hydrogen = molecule.atoms[hydrogenIndex];
        const direction = normaliseVector({ x: hydrogen.x - anchor.x, y: hydrogen.y - anchor.y, z: hydrogen.z - anchor.z });
        return direction.x * preferredDirection.x + direction.y * preferredDirection.y + direction.z * preferredDirection.z;
      };
      return score(second) - score(first);
    })[0];
  }
  if (!bond) return { atomIndex, vacancy: attachmentDirection(molecule, atomIndex) };
  const hydrogenIndex = bond.a === atomIndex ? bond.b : bond.a;
  const anchor = molecule.atoms[atomIndex], hydrogen = molecule.atoms[hydrogenIndex];
  const vacancy = normaliseVector({ x: hydrogen.x - anchor.x, y: hydrogen.y - anchor.y, z: hydrogen.z - anchor.z });
  removeAtomAt(molecule, hydrogenIndex);
  return { atomIndex: atomIndex > hydrogenIndex ? atomIndex - 1 : atomIndex, vacancy };
}

function assertAvailableAttachmentValence(molecule, atomIndex) {
  const atom = molecule.atoms[atomIndex];
  const bonds = molecule.bonds.filter((bond) => bond.a === atomIndex || bond.b === atomIndex);
  const hasHydrogen = bonds.some((bond) => {
    const other = bond.a === atomIndex ? bond.b : bond.a;
    return molecule.atoms[other].element === 'H';
  });
  if (hasHydrogen) return;
  const usedValence = bonds.reduce((sum, bond) => sum + (bond.order || 1), 0);
  // Evaluate the prospective bond rather than the atom's current valence.
  // This preserves ordinary octet limits while allowing common expanded-
  // valence P/S construction one chemically complete edit at a time (for
  // example, adding the second oxygen to S(=O) before assigning S=O).
  const targetValence = chemistryTargetValence(atom, usedValence + 1);
  if (targetValence == null) return;
  if (usedValence + 1 > targetValence + 0.05)
    throw new Error(`${atom.element} atom ${atomIndex + 1} has no available valence for another bond.`);
}

function rotateMoleculeToVector(molecule, anchorIndex, fromVector, toVector) {
  const from = normaliseVector(fromVector), to = normaliseVector(toVector);
  let axis = {
    x: from.y * to.z - from.z * to.y,
    y: from.z * to.x - from.x * to.z,
    z: from.x * to.y - from.y * to.x,
  };
  let sine = Math.hypot(axis.x, axis.y, axis.z);
  const cosine = Math.max(-1, Math.min(1, from.x * to.x + from.y * to.y + from.z * to.z));
  if (sine < 1e-7) {
    if (cosine > 0) return;
    axis = Math.abs(from.x) < 0.8
      ? normaliseVector({ x: 0, y: -from.z, z: from.y })
      : normaliseVector({ x: -from.y, y: from.x, z: 0 });
    sine = 0;
  } else {
    axis = { x: axis.x / sine, y: axis.y / sine, z: axis.z / sine };
  }
  const anchor = molecule.atoms[anchorIndex];
  molecule.atoms.forEach((atom) => {
    const vector = { x: atom.x - anchor.x, y: atom.y - anchor.y, z: atom.z - anchor.z };
    const cross = {
      x: axis.y * vector.z - axis.z * vector.y,
      y: axis.z * vector.x - axis.x * vector.z,
      z: axis.x * vector.y - axis.y * vector.x,
    };
    const dot = axis.x * vector.x + axis.y * vector.y + axis.z * vector.z;
    atom.x = anchor.x + vector.x * cosine + cross.x * sine + axis.x * dot * (1 - cosine);
    atom.y = anchor.y + vector.y * cosine + cross.y * sine + axis.y * dot * (1 - cosine);
    atom.z = anchor.z + vector.z * cosine + cross.z * sine + axis.z * dot * (1 - cosine);
  });
}

function translateMolecule(molecule, displacement) {
  molecule.atoms.forEach((atom) => {
    atom.x += displacement.x;
    atom.y += displacement.y;
    atom.z += displacement.z;
  });
}

function mergeFragmentIntoMolecule(baseMolecule, fragment, targetIndex = null, targetPoint = null) {
  let incoming = parseSMILES(fragment.smiles, fragment.name);
  let connection = fragment.attach ?? 0;
  const attachmentComponent = targetIndex != null
    && baseMolecule?.atoms?.[targetIndex]?.record === 'HETATM'
    ? baseMolecule.atoms[targetIndex] : null;

  if (!baseMolecule || !baseMolecule.atoms.length) {
    const anchor = incoming.atoms[connection];
    const point = targetPoint || { x: 0, y: 0, z: 0 };
    translateMolecule(incoming, { x: point.x - anchor.x, y: point.y - anchor.y, z: point.z - anchor.z });
    incoming.name = fragment.name; incoming.smiles = fragment.smiles;
    return incoming;
  }

  // Numeric force-field Systems are valid only for the exact atom ordering and
  // topology they were generated from. Any builder edit must invalidate them.
  delete baseMolecule.parameterization;

  if (targetIndex != null) {
    assertAvailableAttachmentValence(baseMolecule, targetIndex);
    const targetBefore = baseMolecule.atoms[targetIndex];
    const hintedVector = targetPoint ? {
      x: targetPoint.x - targetBefore.x,
      y: targetPoint.y - targetBefore.y,
      z: targetPoint.z - targetBefore.z,
    } : null;
    const preferredDirection = hintedVector && Math.hypot(hintedVector.x, hintedVector.y, hintedVector.z) > 0.2
      ? normaliseVector(hintedVector) : null;
    const incomingSite = removeAttachmentHydrogen(incoming, connection);
    connection = incomingSite.atomIndex;
    const targetSite = removeAttachmentHydrogen(baseMolecule, targetIndex, preferredDirection);
    targetIndex = targetSite.atomIndex;
    const target = baseMolecule.atoms[targetIndex];
    const direction = targetSite.vacancy;
    const anchor = incoming.atoms[connection];
    rotateMoleculeToVector(incoming, connection, incomingSite.vacancy, { x: -direction.x, y: -direction.y, z: -direction.z });
    const bondLength = ELEMENTS[target.element].covalent + ELEMENTS[anchor.element].covalent;
    const destination = { x: target.x + direction.x * bondLength, y: target.y + direction.y * bondLength, z: target.z + direction.z * bondLength };
    translateMolecule(incoming, { x: destination.x - anchor.x, y: destination.y - anchor.y, z: destination.z - anchor.z });
  } else {
    const anchor = incoming.atoms[connection];
    const point = targetPoint || { x: 0, y: 0, z: 0 };
    translateMolecule(incoming, { x: point.x - anchor.x, y: point.y - anchor.y, z: point.z - anchor.z });
  }

  // Atoms covalently attached to a PDB ligand remain part of that ligand.
  // Without this metadata they form a synthetic `molecule:main` display
  // component even though the bond graph is connected, so the 2D inset can
  // accidentally depict only the newly added atom or fragment.
  if (attachmentComponent) incoming.atoms.forEach((atom) => {
    atom.record = 'HETATM';
    atom.residueName = attachmentComponent.residueName;
    atom.chain = attachmentComponent.chain;
    atom.residueIndex = attachmentComponent.residueIndex;
    atom.insertionCode = attachmentComponent.insertionCode || '';
    atom.occupancy = 0;
  });

  const offset = baseMolecule.atoms.length;
  baseMolecule.atoms.push(...incoming.atoms);
  baseMolecule.bonds.push(...incoming.bonds.map((bond) => ({ ...bond, a: bond.a + offset, b: bond.b + offset })));
  if (targetIndex != null) baseMolecule.bonds.push({ a: targetIndex, b: offset + connection, order: 1 });
  baseMolecule.name = 'Built molecule';
  baseMolecule.smiles = targetIndex == null ? `${baseMolecule.smiles}.${fragment.smiles}` : `${baseMolecule.smiles} + ${fragment.label}`;
  baseMolecule.charge = (baseMolecule.charge || 0) + (incoming.charge || 0);
  return baseMolecule;
}

function addFragmentAtScreen(fragment, clientX, clientY) {
  clearCalculationResult();
  const targetHit = hitTest(clientX, clientY);
  const targetPoint = screenToMolecule(clientX, clientY);
  let targetIndex = targetHit?.index ?? null;
  if (targetIndex != null && state.molecule?.atoms[targetIndex]?.element === 'H') {
    const hydrogenBond = state.molecule.bonds.find((bond) => bond.a === targetIndex || bond.b === targetIndex);
    targetIndex = hydrogenBond ? (hydrogenBond.a === targetIndex ? hydrogenBond.b : hydrogenBond.a) : null;
  }
  if (targetIndex != null && analogueDesignCaptureNeeded([targetIndex])) {
    return ensureAnalogueDesignReferenceBeforeChemistry([targetIndex]).then((accepted) => {
      if (accepted) return addFragmentAtScreen(fragment, clientX, clientY);
      return null;
    });
  }
  pushBuildHistory();
  const existingAtoms = new Set(state.molecule?.atoms || []);
  const targetAtom = targetIndex == null ? null : state.molecule.atoms[targetIndex];
  try {
    state.molecule = mergeFragmentIntoMolecule(state.molecule, fragment, targetIndex, targetPoint);
  } catch (error) {
    if (state.buildHistory.length) state.buildHistory.pop();
    updateHistoryButtons(); showNotice(error.message); return;
  }
  refreshStructureComponents();
  state.selectedAtoms = []; state.selectedAtom = null; updateGeometryControl();
  document.querySelector('#viewer-hint').classList.remove('visible');
  updateInfo(); updateHistoryButtons(); draw();
  const changedAtomIndices = state.molecule.atoms.flatMap((atom, index) =>
    !existingAtoms.has(atom) || atom === targetAtom ? [index] : []);
  scheduleSmallMoleculePolish(changedAtomIndices);
  return Promise.resolve();
}

function updateBuildStatus(extra = '') {
  let status = document.querySelector('#build-status');
  if (!status) {
    status = document.createElement('div'); status.id = 'build-status'; status.className = 'build-status hidden';
    document.querySelector('#viewer-container').appendChild(status);
  }
  if (state.mode !== 'build') { status.classList.add('hidden'); return; }
  status.classList.remove('hidden');
  if (extra) { status.innerHTML = extra; return; }
  if (state.buildTool === 'add' && state.stagedFragment) status.textContent = `⊕ ${state.stagedFragment.name}: click an atom to attach · click space to add`;
  else if (state.buildTool === 'add') status.textContent = `⊕ Add ${state.selectedElement}: click near an atom to bond · click open space for a separate molecule`;
  else if (state.buildTool === 'select') status.textContent = state.selectedAtoms.length
    ? `⌖ Select: ${state.selectedAtoms.length} atom${state.selectedAtoms.length === 1 ? '' : 's'} selected · continue along bonds or click a selected atom to trim`
    : '⌖ Select: pick one atom to edit it, or any pair to create or edit a bond';
  else status.textContent = '✣ Manipulate: drag an atom to move it · drag empty space to rotate';
}

function stageFragment(fragment) {
  try {
    fragment.preview ??= parseSMILES(fragment.smiles, fragment.name);
    state.stagedFragment = fragment;
    state.buildTool = 'add';
    document.querySelectorAll('#build-tool-tabs [data-tool]').forEach((button) => button.classList.toggle('selected', button.dataset.tool === 'add'));
    document.querySelectorAll('.fragment-card').forEach((card) => card.classList.toggle('selected', card.dataset.fragment === fragment.id));
    canvas.classList.add('build-cursor'); updateBuildStatus(); showToast(`${fragment.name} staged`);
  } catch (error) { showNotice(error.message); }
}

function renderFragmentLibrary(query = '') {
  const grid = document.querySelector('#fragment-grid'); grid.innerHTML = '';
  const filtered = FRAGMENTS.filter((fragment) => `${fragment.name} ${fragment.label} ${fragment.smiles}`.toLowerCase().includes(query.toLowerCase()));
  for (const fragment of filtered) {
    const button = document.createElement('button');
    button.className = 'fragment-card'; button.dataset.fragment = fragment.id;
    button.innerHTML = `<canvas aria-hidden="true"></canvas><strong>${fragment.label}</strong><span>${fragment.name}</span>`;
    button.addEventListener('click', () => {
      runChemistUiAction('fragment.stage', { fragmentId:fragment.id }).catch(() => {});
    });
    grid.appendChild(button);
  }
  requestAnimationFrame(drawFragmentPreviews);
}

function drawFragmentPreviews() {
  document.querySelectorAll('.fragment-card').forEach((button) => {
    const fragment = FRAGMENTS.find((item) => item.id === button.dataset.fragment);
    const previewCanvas = button.querySelector('canvas');
    if (!fragment || previewCanvas.getBoundingClientRect().width < 2) return;
    fragment.preview ??= parseSMILES(fragment.smiles, fragment.name);
    const previewCtx = previewCanvas.getContext('2d');
    const size = resizeCanvas(previewCanvas, previewCtx); previewCtx.clearRect(0, 0, size.width, size.height);
    drawMolecule(previewCtx, projectAtoms(size.width, size.height, fragment.preview, true), fragment.preview, true);
  });
}

function equilibriumBondLength(atomA, atomB, order = 1) {
  const base = ELEMENTS[atomA.element].covalent + ELEMENTS[atomB.element].covalent;
  if (order >= 3) return base * 0.78;
  if (order >= 2) return base * 0.88;
  if (order === 1.5) return base * 0.92;
  return base;
}

function buildAngleTerms(molecule) {
  const adjacency = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond) => {
    adjacency[bond.a].push({ index: bond.b, order: bond.order || 1 });
    adjacency[bond.b].push({ index: bond.a, order: bond.order || 1 });
  });
  const terms = [];
  adjacency.forEach((neighbors, center) => {
    if (neighbors.length < 2 || molecule.atoms[center].element === 'H') return;
    for (let a = 0; a < neighbors.length; a++) {
      for (let b = a + 1; b < neighbors.length; b++) {
        let degrees = 109.47;
        const centerAtom = molecule.atoms[center];
        const multipleBond = neighbors.some((entry) => entry.order > 1.1);
        if (centerAtom.aromatic || neighbors.length === 3) degrees = 120;
        else if (neighbors.length === 2 && multipleBond) degrees = neighbors.some((entry) => entry.order >= 2.8) ? 180 : 120;
        else if (neighbors.length === 2 && centerAtom.element === 'O') degrees = 104.5;
        else if (neighbors.length === 2 && centerAtom.element === 'N') degrees = 107;
        terms.push({ a: neighbors[a].index, b: center, c: neighbors[b].index, target: degrees * Math.PI / 180 });
      }
    }
  });
  return { adjacency, terms };
}

async function minimizeMolecule() {
  if (!state.molecule?.atoms.length) return showToast('Load or build a molecule first');
  if (state.chemistryTransaction) {
    showNotice('Finish or discard the pending chemistry changes before optimizing.');
    return null;
  }
  if (state.minimizing) return;
  pushBuildHistory();
  state.minimizing = true;
  const button = document.querySelector('#optimize-button'); button.disabled = true;
  const molecule = state.molecule;
  const velocities = molecule.atoms.map(() => ({ x: 0, y: 0, z: 0 }));
  const { adjacency, terms: angles } = buildAngleTerms(molecule);
  const excluded = new Set(molecule.bonds.map((bond) => pairKey(bond.a, bond.b)));
  adjacency.forEach((neighbors) => {
    for (let a = 0; a < neighbors.length; a++) for (let b = a + 1; b < neighbors.length; b++) excluded.add(pairKey(neighbors[a].index, neighbors[b].index));
  });
  const iterations = 520;
  let iteration = 0;
  let initialEnergy = null;
  let finalEnergy = 0;
  let finalRmsForce = Infinity;
  const frames = [];
  const sampleInterval = Math.ceil(iterations / 8);
  let nextSample = sampleInterval;
  const snapshot = (step, energy) => ({
    step,
    energy,
    positions: Float64Array.from(molecule.atoms.flatMap((atom) => [atom.x, atom.y, atom.z])),
  });

  const runBatch = () => new Promise((resolve) => {
    const batchEnd = Math.min(iterations, iteration + 8);
    for (; iteration < batchEnd; iteration++) {
      const forces = molecule.atoms.map(() => ({ x: 0, y: 0, z: 0 }));
      let energy = 0;

      for (const bond of molecule.bonds) {
        const atomA = molecule.atoms[bond.a], atomB = molecule.atoms[bond.b];
        let dx = atomB.x - atomA.x, dy = atomB.y - atomA.y, dz = atomB.z - atomA.z;
        const distance = Math.hypot(dx, dy, dz) || 0.0001;
        const target = equilibriumBondLength(atomA, atomB, bond.order || 1);
        const delta = distance - target;
        const stiffness = atomA.element === 'H' || atomB.element === 'H' ? 0.72 : 0.92;
        const magnitude = stiffness * delta;
        energy += 0.5 * stiffness * delta * delta;
        dx /= distance; dy /= distance; dz /= distance;
        forces[bond.a].x += dx * magnitude; forces[bond.a].y += dy * magnitude; forces[bond.a].z += dz * magnitude;
        forces[bond.b].x -= dx * magnitude; forces[bond.b].y -= dy * magnitude; forces[bond.b].z -= dz * magnitude;
      }

      for (const angle of angles) {
        const a = molecule.atoms[angle.a], b = molecule.atoms[angle.b], c = molecule.atoms[angle.c];
        let ux = a.x - b.x, uy = a.y - b.y, uz = a.z - b.z;
        let vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
        const ru = Math.hypot(ux, uy, uz) || 0.0001, rv = Math.hypot(vx, vy, vz) || 0.0001;
        ux /= ru; uy /= ru; uz /= ru; vx /= rv; vy /= rv; vz /= rv;
        const cosine = Math.max(-0.9999, Math.min(0.9999, ux * vx + uy * vy + uz * vz));
        const theta = Math.acos(cosine), sine = Math.max(0.014, Math.sqrt(1 - cosine * cosine));
        const delta = theta - angle.target;
        const stiffness = 0.13;
        energy += 0.5 * stiffness * delta * delta;
        const scaleA = stiffness * delta / (ru * sine), scaleC = stiffness * delta / (rv * sine);
        const fax = scaleA * (vx - cosine * ux), fay = scaleA * (vy - cosine * uy), faz = scaleA * (vz - cosine * uz);
        const fcx = scaleC * (ux - cosine * vx), fcy = scaleC * (uy - cosine * vy), fcz = scaleC * (uz - cosine * vz);
        forces[angle.a].x += fax; forces[angle.a].y += fay; forces[angle.a].z += faz;
        forces[angle.c].x += fcx; forces[angle.c].y += fcy; forces[angle.c].z += fcz;
        forces[angle.b].x -= fax + fcx; forces[angle.b].y -= fay + fcy; forces[angle.b].z -= faz + fcz;
      }

      for (let a = 0; a < molecule.atoms.length; a++) {
        for (let b = a + 1; b < molecule.atoms.length; b++) {
          if (excluded.has(pairKey(a, b))) continue;
          const atomA = molecule.atoms[a], atomB = molecule.atoms[b];
          let dx = atomB.x - atomA.x, dy = atomB.y - atomA.y, dz = atomB.z - atomA.z;
          const distance = Math.hypot(dx, dy, dz) || 0.0001;
          const contact = (ELEMENTS[atomA.element].radius + ELEMENTS[atomB.element].radius) * 1.34;
          if (distance >= contact) continue;
          const overlap = contact - distance;
          const magnitude = 0.34 * overlap * overlap;
          energy += 0.115 * overlap * overlap * overlap;
          dx /= distance; dy /= distance; dz /= distance;
          forces[a].x -= dx * magnitude; forces[a].y -= dy * magnitude; forces[a].z -= dz * magnitude;
          forces[b].x += dx * magnitude; forces[b].y += dy * magnitude; forces[b].z += dz * magnitude;
        }
      }

      const averageForce = forces.reduce((sum, force) => ({ x: sum.x + force.x, y: sum.y + force.y, z: sum.z + force.z }), { x: 0, y: 0, z: 0 });
      averageForce.x /= forces.length; averageForce.y /= forces.length; averageForce.z /= forces.length;
      finalRmsForce = Math.sqrt(forces.reduce((sum, force) => {
        const x = force.x - averageForce.x, y = force.y - averageForce.y, z = force.z - averageForce.z;
        return sum + x * x + y * y + z * z;
      }, 0) / forces.length);
      if (initialEnergy == null) {
        initialEnergy = energy;
        frames.push(snapshot(0, energy));
      }
      molecule.atoms.forEach((atom, index) => {
        const force = forces[index], velocity = velocities[index];
        velocity.x = (velocity.x + (force.x - averageForce.x) * 0.038) * 0.84;
        velocity.y = (velocity.y + (force.y - averageForce.y) * 0.038) * 0.84;
        velocity.z = (velocity.z + (force.z - averageForce.z) * 0.038) * 0.84;
        const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
        const limiter = speed > 0.045 ? 0.045 / speed : 1;
        atom.x += velocity.x * limiter; atom.y += velocity.y * limiter; atom.z += velocity.z * limiter;
      });
      finalEnergy = energy;
    }
    if (iteration >= nextSample || iteration === iterations) {
      frames.push(snapshot(iteration, finalEnergy));
      while (nextSample <= iteration) nextSample += sampleInterval;
    }
    const progress = Math.round(iteration / iterations * 100);
    button.textContent = `⚡ Optimizing ${progress}%`;
    updateBuildStatus(`Force-field relaxation · ${progress}%<div class="minimize-progress"><i style="width:${progress}%"></i></div>`);
    draw(); requestAnimationFrame(resolve);
  });

  while (iteration < iterations) await runBatch();
  state.minimizing = false; button.disabled = false; button.textContent = '⚡ Optimize';
  updateBuildStatus(); updateHistoryButtons(); draw();
  showToast(`Geometry relaxed · E ${finalEnergy.toFixed(3)}`);
  return { initialEnergy, finalEnergy, rmsForce: finalRmsForce, iterations: iteration, frames };
}

function moleculeDiagnostics(molecule) {
  const data = composition(molecule.atoms);
  const formulaAscii = ['C', 'H', ...Object.keys(data.counts).filter((key) => key !== 'C' && key !== 'H').sort()]
    .filter((key) => data.counts[key])
    .map((key) => `${key}${data.counts[key] > 1 ? data.counts[key] : ''}`)
    .join('');
  const bondOrders = molecule.atoms.map(() => 0);
  let maxBondError = 0;
  let finite = true;
  molecule.atoms.forEach((atom) => { finite &&= Number.isFinite(atom.x) && Number.isFinite(atom.y) && Number.isFinite(atom.z); });
  molecule.bonds.forEach((bond) => {
    const atomA = molecule.atoms[bond.a], atomB = molecule.atoms[bond.b];
    bondOrders[bond.a] += bond.order || 1; bondOrders[bond.b] += bond.order || 1;
    const distance = Math.hypot(atomA.x - atomB.x, atomA.y - atomB.y, atomA.z - atomB.z);
    const target = equilibriumBondLength(atomA, atomB, bond.order || 1);
    maxBondError = Math.max(maxBondError, Math.abs(distance - target));
  });
  const valenceTargets = { H: 1, B: 3, C: 4, N: 3, O: 2, F: 1, Si: 4, P: 3, S: 2, Cl: 1, Br: 1, I: 1 };
  const valenceViolations = [];
  molecule.atoms.forEach((atom, index) => {
    // Canonical protein chemistry is protected and audited by residue
    // templates. This generic small-molecule check does not model peptide
    // resonance, charged termini, or protonated side-chain templates.
    if (isProteinAtom(atom)) return;
    if (atom.aromatic) {
      const coordination = molecule.bonds.filter((bond) => bond.a === index || bond.b === index).length;
      if (coordination < 2 || coordination > 3) valenceViolations.push({ index, element: atom.element, coordination, expected: '2–3 aromatic neighbors' });
      return;
    }
    const heavyValence = molecule.bonds.flatMap((bond) => bond.a === index
      ? [{ bond, other:bond.b }] : bond.b === index ? [{ bond, other:bond.a }] : [])
      .filter(({ other }) => molecule.atoms[other].element !== 'H')
      .reduce((sum, { bond }) => sum + Number(bond.order || 1), 0);
    const target = chemistryTargetValence(atom, heavyValence) ?? valenceTargets[atom.element];
    if (target != null && Math.abs(bondOrders[index] - target) > 0.08) valenceViolations.push({ index, element: atom.element, valence: bondOrders[index], expected: target });
  });
  const adjacency = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond) => { adjacency[bond.a].push(bond.b); adjacency[bond.b].push(bond.a); });
  const seen = new Set(); let components = 0;
  molecule.atoms.forEach((_, root) => {
    if (seen.has(root)) return; components += 1; const queue = [root]; seen.add(root);
    while (queue.length) for (const neighbor of adjacency[queue.shift()]) if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
  });
  return { formula: formulaAscii, atoms: molecule.atoms.length, bonds: molecule.bonds.length, charge: molecule.charge || 0, components, finite, maxBondError, valenceViolations };
}

async function runImmediateChemistryTestEdit(callback) {
  const control = document.querySelector('#chemistry-immediate-refine');
  const previous = state.chemistryEditPolicy;
  state.chemistryEditPolicy = 'immediate-refine';
  control.checked = true;
  try { return await callback(); }
  finally {
    state.chemistryEditPolicy = previous;
    control.checked = previous === 'immediate-refine';
    updateChemistryEditor();
  }
}

const SIDECHAIN_ROTAMER_RESIDUES = new Set([
  'ARG','ASN','ASP','CYS','GLN','GLU','HIS','ILE','LEU','LYS','MET','PHE','SER',
  'THR','TPO','TRP','TYR','VAL',
]);

function chemistActionCoordinateArray(molecule = state.molecule) {
  const result = new Float64Array((molecule?.atoms?.length || 0) * 3);
  molecule?.atoms?.forEach((atom, index) => {
    result[index * 3] = Number(atom.x);
    result[index * 3 + 1] = Number(atom.y);
    result[index * 3 + 2] = Number(atom.z);
  });
  return result;
}

function chemistActionCoordinateSnapshot(molecule = state.molecule) {
  return new Map((molecule?.atoms || []).flatMap((atom) =>
    atom.designAtomId && atom.element !== 'H'
      ? [[atom.designAtomId, [Number(atom.x), Number(atom.y), Number(atom.z)]]] : []));
}

function chemistActionCoordinateChanges(before, molecule = state.molecule,
  { thresholdAngstrom = 0.08, maximumAtoms = 24 } = {}) {
  const changes = (molecule?.atoms || []).flatMap((atom) => {
    const prior = atom.designAtomId ? before.get(atom.designAtomId) : null;
    if (!prior || atom.element === 'H') return [];
    const displacementAngstrom = Math.hypot(
      Number(atom.x) - prior[0], Number(atom.y) - prior[1], Number(atom.z) - prior[2]);
    return displacementAngstrom >= thresholdAngstrom
      ? [{ atomId:atom.designAtomId, displacementAngstrom }] : [];
  }).sort((first, second) => second.displacementAngstrom - first.displacementAngstrom);
  return { changedAtomIds:changes.slice(0, maximumAtoms).map((entry) => entry.atomId),
    movedHeavyAtomCount:changes.length,
    maximumDisplacementAngstrom:Number((changes[0]?.displacementAngstrom || 0).toFixed(4)),
    detectionThresholdAngstrom:thresholdAngstrom };
}

async function moleculeCoordinateSha256(molecule = state.molecule) {
  return sha256Hex(chemistActionCoordinateArray(molecule).buffer);
}

async function coordinateArraySha256(coordinates) {
  if (!ArrayBuffer.isView(coordinates) && !Array.isArray(coordinates))
    throw new Error('Coordinate result is not a numeric array');
  const normalized = Float64Array.from(coordinates, Number);
  if (!normalized.length || normalized.some((value) => !Number.isFinite(value)))
    throw new Error('Coordinate result contains no finite coordinate set');
  return sha256Hex(normalized.buffer);
}

function expectedCoordinateSha256(args, key) {
  if (!Object.hasOwn(args, key)) return null;
  if (typeof args[key] !== 'string' || !/^[a-f0-9]{64}$/.test(args[key]))
    throw new Error(`${key} must be a lowercase SHA-256 hex digest`);
  return args[key];
}

function expectedMolecularStateSha256(args, key) {
  if (!Object.hasOwn(args, key)) return null;
  if (typeof args[key] !== 'string' || !/^[a-f0-9]{64}$/.test(args[key]))
    throw new Error(`${key} must be a lowercase SHA-256 hex digest`);
  return args[key];
}

async function assertCurrentCoordinateSha256(expected, key = 'expectedInputCoordinateSha256') {
  const actual = await moleculeCoordinateSha256();
  if (expected != null && actual !== expected)
    throw new Error(`Current coordinates do not match ${key}`);
  return actual;
}

async function currentMolecularStateSha256(expected = null,
  key = 'expectedInputStateSha256') {
  const actual = await molecularStateSha256(state.molecule);
  if (expected != null && actual !== expected)
    throw new Error(`Current molecular state does not match ${key}`);
  return actual;
}

async function dockingPoseStateSha256(result, pose) {
  const molecule = structuredClone(state.molecule);
  const indices = currentIndicesForDockingPlan(result.plan);
  if (pose.positions.length !== indices.length * 3)
    throw new Error('Selected refined pose has the wrong coordinate count');
  indices.forEach((atomIndex, positionIndex) => {
    const atom = molecule.atoms[atomIndex];
    atom.x = pose.positions[positionIndex * 3];
    atom.y = pose.positions[positionIndex * 3 + 1];
    atom.z = pose.positions[positionIndex * 3 + 2];
  });
  return molecularStateSha256(molecule);
}

function sidechainRotamerPublicResult(ensemble) {
  return {
    schema:ensemble.schema,
    method:ensemble.method,
    inputCoordinateSha256:ensemble.inputCoordinateSha256,
    receptorAtomId:ensemble.receptorAtomId,
    residue:structuredClone(ensemble.residue),
    axes:structuredClone(ensemble.axes),
    inputChiDegrees:structuredClone(ensemble.inputChiDegrees),
    generatedCandidateCount:ensemble.generatedCandidateCount,
    candidates:ensemble.candidates.map(({ positions, ...candidate }) => structuredClone(candidate)),
  };
}

function sidechainRotamerResidueLabel(residue) {
  return `${residue.residueName} ${residue.chain}${residue.residueIndex}${residue.insertionCode || ''}`;
}

function updateSidechainRotamerControls() {
  const panel = document.querySelector('#sidechain-rotamer-tools');
  if (!panel) return;
  const hasProtein = Boolean(state.molecule?.atoms?.some((atom) => isProteinAtom(atom)));
  panel.classList.toggle('hidden', !hasProtein);
  if (!hasProtein) return;
  const status = document.querySelector('#sidechain-rotamer-status');
  const enumerateButton = document.querySelector('#enumerate-sidechain-rotamers');
  const results = document.querySelector('#sidechain-rotamer-results');
  const select = document.querySelector('#sidechain-rotamer-select');
  const selectedIndex = state.selectedAtoms.length === 1 ? state.selectedAtoms[0] : null;
  const selected = Number.isInteger(selectedIndex) ? state.molecule.atoms[selectedIndex] : null;
  const eligible = Boolean(selected && isProteinAtom(selected)
    && SIDECHAIN_ROTAMER_RESIDUES.has(selected.residueName));
  enumerateButton.disabled = !eligible || Boolean(state.chemistryTransaction);
  const ensemble = state.sidechainRotamerEnsemble;
  results.classList.toggle('hidden', !ensemble);
  if (ensemble) {
    const selectedValue = select.value;
    select.replaceChildren(...ensemble.candidates.map((candidate) => {
      const option = document.createElement('option'); option.value = String(candidate.index);
      const chis = candidate.chiDegrees.map((value, index) => `χ${index + 1} ${Math.round(value)}°`).join(' · ');
      option.textContent = `#${candidate.rank} · ${chis} · ${candidate.severeClashes} hard clash${candidate.severeClashes === 1 ? '' : 'es'}`;
      return option;
    }));
    if ([...select.options].some((option) => option.value === selectedValue)) select.value = selectedValue;
    status.textContent = `${sidechainRotamerResidueLabel(ensemble.residue)} · ${ensemble.candidates.length} ranked branches. Apply one, then physically refine it.`;
  } else if (eligible) {
    status.textContent = `${selected.residueName} ${selected.chain || 'A'}${selected.residueIndex}${selected.insertionCode || ''} selected · enumerate discrete chi-angle branches before minimization.`;
  } else if (selected && isProteinAtom(selected)) {
    status.textContent = `${selected.residueName || 'Residue'} has no safe independent rotamer move.`;
  } else {
    status.textContent = 'Choose Select, then pick one atom in a protein side chain.';
  }
}

async function enumerateCurrentSidechainRotamers(residueAtomIndex, maximumCandidates = 32) {
  if (state.mode !== 'build') throw new Error('Enter Design mode before enumerating side-chain rotamers.');
  if (state.chemistryTransaction)
    throw new Error('Finish or discard pending chemistry before enumerating side-chain rotamers.');
  if (!Number.isInteger(maximumCandidates) || maximumCandidates < 1 || maximumCandidates > 64)
    throw new Error('maximumCandidates must be an integer from 1 to 64');
  await ensureChemistActionAtomIds();
  const selected = state.molecule?.atoms?.[residueAtomIndex];
  if (!selected || !isProteinAtom(selected))
    throw new Error('receptorAtomId must identify an atom in a protein residue');
  const module = await import('./docking/sidechain-rotamers.mjs');
  const result = module.enumerateSidechainRotamers({ molecule:state.molecule,
    residueAtomIndex, ligandAtomIndices:currentDockingLigandAtomIndices(), maximumCandidates });
  const inputCoordinates = chemistActionCoordinateArray();
  result.inputCoordinateSha256 = await sha256Hex(inputCoordinates.buffer);
  result.receptorAtomId = selected.designAtomId;
  for (const candidate of result.candidates) {
    const coordinates = inputCoordinates.slice();
    candidate.positions.forEach((position) => {
      coordinates[position.atomIndex * 3] = position.x;
      coordinates[position.atomIndex * 3 + 1] = position.y;
      coordinates[position.atomIndex * 3 + 2] = position.z;
    });
    candidate.coordinateSha256 = await sha256Hex(coordinates.buffer);
  }
  state.sidechainRotamerEnsemble = result;
  updateSidechainRotamerControls();
  return sidechainRotamerPublicResult(result);
}

async function applyCurrentSidechainRotamer(selector, {
  expectedInputCoordinateSha256 = null, expectedSelectedCoordinateSha256 = null,
} = {}) {
  if (state.mode !== 'build') throw new Error('Enter Design mode before applying a side-chain rotamer.');
  if (state.chemistryTransaction)
    throw new Error('Finish or discard pending chemistry before applying a side-chain rotamer.');
  const ensemble = state.sidechainRotamerEnsemble;
  if (!ensemble) throw new Error('Enumerate a side-chain rotamer ensemble first');
  const currentCoordinateSha256 = await moleculeCoordinateSha256();
  const module = await import('./docking/sidechain-rotamers.mjs');
  const candidate = module.selectSidechainRotamerCandidate(ensemble, selector);
  const index = ensemble.candidates.indexOf(candidate);
  if (index < 0) throw new Error('The selected side-chain rotamer is absent from the active ensemble');
  module.assertSidechainRotamerCoordinateGuards({ ensemble, candidate, currentCoordinateSha256,
    expectedInputCoordinateSha256, expectedSelectedCoordinateSha256 });
  pushBuildHistory();
  const startingPositions = new Map(candidate.positions.map((position) => {
    const atom = state.molecule.atoms[position.atomIndex];
    return [position.atomIndex, { x:atom.x, y:atom.y, z:atom.z }];
  }));
  module.applySidechainRotamer(state.molecule, ensemble, index);
  if (state.designerMoveReplaying && candidate.positions.length) {
    // A rotamer choice is a scientific state change that is otherwise a hard
    // cut. Replay it at human speed so the chemist can see the causal motion.
    // Only display coordinates are interpolated; the audited action still
    // finishes at the exact hash-pinned candidate coordinates.
    const frameCount = 24;
    for (let frame = 0; frame <= frameCount; frame++) {
      const linear = frame / frameCount;
      const amount = linear * linear * (3 - 2 * linear);
      candidate.positions.forEach((position) => {
        const atom = state.molecule.atoms[position.atomIndex];
        const start = startingPositions.get(position.atomIndex);
        atom.x = frame === frameCount ? position.x
          : start.x + (position.x - start.x) * amount;
        atom.y = frame === frameCount ? position.y
          : start.y + (position.y - start.y) * amount;
        atom.z = frame === frameCount ? position.z
          : start.z + (position.z - start.z) * amount;
      });
      draw();
      if (frame < frameCount)
        await new Promise((resolveFrame) => setTimeout(resolveFrame, 70));
    }
    updateStoredBondDistances();
  }
  const appliedCoordinateSha256 = await moleculeCoordinateSha256();
  if (appliedCoordinateSha256 !== candidate.coordinateSha256) {
    restoreMolecule(state.buildHistory.pop());
    throw new Error('Applied side-chain coordinates did not match the enumerated branch hash');
  }
  if (expectedSelectedCoordinateSha256 != null
    && appliedCoordinateSha256 !== expectedSelectedCoordinateSha256) {
    restoreMolecule(state.buildHistory.pop());
    throw new Error('Applied side-chain coordinates did not match expectedSelectedCoordinateSha256');
  }
  const application = {
    schema:'molarium.sidechain-rotamer-application/v1',
    method:ensemble.method,
    residue:structuredClone(ensemble.residue), receptorAtomId:ensemble.receptorAtomId,
    inputCoordinateSha256:ensemble.inputCoordinateSha256,
    selectedCoordinateSha256:candidate.coordinateSha256,
    selectedBy:Object.keys(selector)[0],
    candidateIndex:candidate.index, candidateRank:candidate.rank, source:candidate.source,
    chiDegrees:structuredClone(candidate.chiDegrees), score:candidate.score,
    stericPenalty:candidate.stericPenalty,
    ligandStericPenalty:candidate.ligandStericPenalty,
    severeClashes:candidate.severeClashes,
    generatedCandidateCount:ensemble.generatedCandidateCount,
    retainedCandidateCount:ensemble.candidates.length,
    coordinateInputClass:state.molecule.source?.designRoute?.coordinateInputClass || 'current-visible-complex',
  };
  const previous = state.molecule.source?.sidechainRotamerApplications || [];
  state.molecule.source = { ...(state.molecule.source || {}),
    sidechainRotamerApplications:[...previous, application].slice(-50) };
  state.sidechainRotamerEnsemble = null;
  state.dockingResult = null; state.dockingPoseIndex = 0;
  clearCalculationResult(); updateStoredBondDistances(); updateInfo(); updateHistoryButtons();
  updateDockingUi(); updateSidechainRotamerControls(); draw();
  showToast(`${sidechainRotamerResidueLabel(application.residue)} rotamer #${candidate.rank} applied`);
  return structuredClone(application);
}

let designerMoveReplayResume = null;

const DESIGNER_MOVE_CHECKPOINT_STATE_KEYS = Object.freeze([
  'rotation', 'viewProjectionCenter', 'viewProjectionRadius', 'viewPan', 'zoom',
  'autoRotate', 'showHydrogens', 'showHulls', 'showInteractions', 'showPocketAtoms',
  'pocketAtomMode', 'displayColorTheme', 'changeMarkerStyle', 'showStericClashes',
  'vdw', 'representation',
  'mode', 'selectedElement', 'buildTool',
  'stagedFragment', 'selectedAtom', 'selectedAtoms', 'chemistryTransaction',
  'chemistryEditPolicy',
  'designRoute', 'designRouteStepId', 'geometryEditActive', 'lastCalculation',
  'calculationFrames', 'calculationRawFrames', 'calculationProjectionRadius',
  'calculationEnsemble', 'conformerAnalysis', 'conformerDisplayAlignment',
  'trajectoryDisplayAlignment', 'calculationReplicaIndex', 'replicaMosaicLayout',
  'calculationFrameIndex', 'calculationUnit', 'calculationJob', 'calculationTimestepFs',
  'calculationConstraintMode', 'proteinPrediction', 'pdbPreparationPreview',
  'ligandProtonation', 'dockingReference', 'dockingResult', 'dockingSelectedHbondIds',
  'dockingContactRemaps', 'dockingContactRemapProposals', 'dockingContactDraft',
  'dockingPoseIndex', 'sidechainRotamerEnsemble', 'structureComponents',
  'atomComponentIds', 'componentVisibility', 'focusedComponentId', 'focusedComponentCenter',
  'focusedComponentRadius', 'focusedResidueKey', 'focusedResidueRadius',
  'focusedAtomIds', 'focusedAtomCenter', 'focusedAtomRadius', 'focusedAtomContextRadius',
  'focusedAtomContextIds', 'focusedAtomResidueLabels', 'emphasizedAtomIds',
  'depictionPinnedLigand', 'depictionOrientationAnchor',
  'depictionTemplateMolBlock', 'depictionTool', 'depictionBondStart',
  'depictionBondOrder',
]);

function cloneDesignerMoveCheckpointMolecule(molecule) {
  if (!molecule) return null;
  const source = { ...(molecule.source || {}) };
  // The Agent/API ledger is append-only and belongs to the live execution
  // frontier, not to a presentation checkpoint.
  delete source.chemistActionAudit;
  const parameterization = molecule.parameterization || null;
  const clone = structuredClone({ ...molecule, source, parameterization:null });
  // Parameter tables are immutable after assignment and can be shared across
  // checkpoints without duplicating the largest prepared-system payload.
  if (parameterization) clone.parameterization = parameterization;
  else delete clone.parameterization;
  return clone;
}

function captureDesignerMoveDomCheckpoint() {
  return [...document.querySelectorAll('[id]')].map((element) => ({
    id:element.id,
    className:element.getAttribute('class'),
    style:element.getAttribute('style'),
    text:element.children.length === 0 && !['CANVAS','SVG'].includes(element.tagName)
      ? element.textContent : null,
    value:'value' in element && element.type !== 'file' ? element.value : null,
    checked:'checked' in element ? Boolean(element.checked) : null,
    disabled:'disabled' in element ? Boolean(element.disabled) : null,
    ariaExpanded:element.getAttribute('aria-expanded'),
  }));
}

function restoreDesignerMoveDomCheckpoint(records) {
  for (const record of records || []) {
    const element = document.getElementById(record.id);
    if (!element) continue;
    if (record.className == null) element.removeAttribute('class');
    else element.setAttribute('class', record.className);
    if (record.style == null) element.removeAttribute('style');
    else element.setAttribute('style', record.style);
    if (record.text != null && element.children.length === 0) element.textContent = record.text;
    if (record.value != null && 'value' in element && element.type !== 'file')
      element.value = record.value;
    if (record.checked != null && 'checked' in element) element.checked = record.checked;
    if (record.disabled != null && 'disabled' in element) element.disabled = record.disabled;
    if (record.ariaExpanded == null) element.removeAttribute('aria-expanded');
    else element.setAttribute('aria-expanded', record.ariaExpanded);
  }
}

const CHEMIST_ACTION_GUARD_EXTRA_STATE_KEYS = Object.freeze([
  'buildHistory', 'redoHistory', 'chemistryEditFinishing', 'minimizing', 'preparing',
  'calculating', 'calculationPlaying', 'calculationPlaybackTime', 'dockingRunning',
  'protonatingLigand', 'ligandProtonationSequence',
]);

function captureChemistActionGuardCheckpoint() {
  const keys = [...new Set([
    ...DESIGNER_MOVE_CHECKPOINT_STATE_KEYS, ...CHEMIST_ACTION_GUARD_EXTRA_STATE_KEYS,
  ])];
  return { molecule:cloneDesignerMoveCheckpointMolecule(state.molecule),
    values:Object.fromEntries(keys.map((key) => [key, structuredClone(state[key])])),
    dom:captureDesignerMoveDomCheckpoint() };
}

function restoreChemistActionGuardCheckpoint(checkpoint) {
  if (!checkpoint) return;
  const liveAudit = state.chemistActionAudit;
  Object.entries(checkpoint.values).forEach(([key, value]) => {
    state[key] = structuredClone(value);
  });
  state.molecule = cloneDesignerMoveCheckpointMolecule(checkpoint.molecule);
  state.chemistActionAudit = liveAudit;
  state.depictionSequence += 1; state.depictionKey = null;
  state.depictionGlobalAtomIndices = []; state.depictionGlobalBondPairs = [];
  state.depictionAtomObjects = []; state.depictionComponentId = null;
  if (state.molecule) state.molecule.source = { ...(state.molecule.source || {}),
    chemistActionAudit:structuredClone(liveAudit) };
  if (state.molecule) {
    updatePdbPreparationUi(); updateLigandProtonationUi();
    updateStructureComponentsUi(); updatePreparationInspectorUi();
    updateInfo(); updateGeometryControl(); updateOptimizerControls();
    updateDockingUi(); renderDockingResults(); updateSidechainRotamerControls();
    updateHistoryButtons(); setMode(state.mode);
    if (state.calculationFrames.length) {
      updateEnergyChart(state.calculationFrames);
      updateCalculationFrameUI();
    }
    schedule2DDepiction(0);
  } else setMode(state.mode);
  restoreDesignerMoveDomCheckpoint(checkpoint.dom);
  draw();
}

function captureDesignerMoveCheckpoint(index, step = null) {
  const values = Object.fromEntries(DESIGNER_MOVE_CHECKPOINT_STATE_KEYS
    .map((key) => [key, structuredClone(state[key])]));
  state.designerMoveReplayCheckpoints[index] = {
    index,
    molecule:cloneDesignerMoveCheckpointMolecule(state.molecule),
    values,
    dom:captureDesignerMoveDomCheckpoint(),
    step:step ? structuredClone(step) : null,
  };
  state.designerMoveReplayCheckpoints.length = index + 1;
  state.designerMoveReplayFrontier = Math.max(state.designerMoveReplayFrontier, index);
}

function restoreDesignerMoveCheckpoint(index) {
  const checkpoint = state.designerMoveReplayCheckpoints[index];
  if (!checkpoint) throw new Error(`Story checkpoint ${index} is unavailable`);
  const liveAudit = state.chemistActionAudit;
  clearDesignerMoveCueElements();
  clearScene();
  Object.entries(checkpoint.values).forEach(([key, value]) => {
    state[key] = structuredClone(value);
  });
  state.molecule = cloneDesignerMoveCheckpointMolecule(checkpoint.molecule);
  state.chemistActionAudit = liveAudit;
  // A checkpoint restores molecular state, not a previously rendered SVG.
  // Force the inset to rebuild its atom map against the restored molecule.
  state.depictionKey = null; state.depictionGlobalAtomIndices = [];
  state.depictionGlobalBondPairs = []; state.depictionAtomObjects = [];
  state.depictionComponentId = null;
  if (state.molecule) state.molecule.source = { ...(state.molecule.source || {}),
    chemistActionAudit:structuredClone(liveAudit) };
  state.calculating = false; state.minimizing = false; state.preparing = false;
  state.dockingRunning = false; state.calculationPlaying = false;
  state.calculationPlaybackRaf = 0; state.calculationPlaybackTime = 0;
  if (state.molecule) {
    const representationSelect = document.querySelector('#representation-select');
    representationSelect.disabled = !state.proteinPrediction;
    representationSelect.value = state.representation;
    document.querySelector('#display-theme-select').value = state.displayColorTheme;
    document.querySelector('#change-marker-select').value = state.changeMarkerStyle;
    document.querySelector('#steric-clash-toggle').checked = state.showStericClashes;
    updatePdbPreparationUi(); updateLigandProtonationUi();
    updateStructureComponentsUi(); updatePreparationInspectorUi();
    updateInfo(); updateGeometryControl(); updateOptimizerControls();
    updateDockingUi(); renderDockingResults(); updateSidechainRotamerControls();
    updateHistoryButtons(); setMode(state.mode);
    if (state.calculationFrames.length) {
      updateEnergyChart(state.calculationFrames);
      updateCalculationFrameUI();
    }
    schedule2DDepiction(0);
  } else setMode(state.mode);
  restoreDesignerMoveDomCheckpoint(checkpoint.dom);
  designerMoveCueElements = [...document.querySelectorAll('.designer-move-cue')];
  state.designerMoveReplayIndex = index;
  draw();
  return checkpoint;
}

function designerMoveCaption(index = state.designerMoveReplayIndex) {
  const actions = state.designerMoveScript?.actions || [];
  if (!actions.length) return 'Load a story to begin.';
  if (index >= actions.length) return 'Story complete.';
  const step = actions[Math.max(0, index)];
  return step.caption || step.action;
}

function resetDesignerMovePlayback() {
  state.designerMoveReplay = null;
  state.designerMoveReplayPaused = false;
  state.designerMoveReplayIndex = 0;
  state.designerMoveReplayFrontier = 0;
  state.designerMoveReplayPhase = null;
  state.designerMoveReplayStep = null;
  state.designerMoveReplayActionRunning = false;
  state.designerMovePresentationStep = null;
  state.designerMoveReplayCheckpoints = [];
  designerMoveReplayResume?.();
  designerMoveReplayResume = null;
}

function setDesignerMoveReplayPaused(paused) {
  if (!state.designerMoveReplaying) return;
  state.designerMoveReplayPaused = Boolean(paused);
  if (!state.designerMoveReplayPaused) {
    designerMoveReplayResume?.();
    designerMoveReplayResume = null;
  }
  updateDesignerMoveControls();
}

function currentDesignerReplayReviewState() {
  return designerReplayReviewState({
    replaying:state.designerMoveReplaying,
    paused:state.designerMoveReplayPaused,
    actionRunning:state.designerMoveReplayActionRunning,
    replayStatus:state.designerMoveReplay?.status || null,
    index:state.designerMoveReplayIndex,
    frontier:state.designerMoveReplayFrontier,
    checkpointCount:state.designerMoveReplayCheckpoints.filter(Boolean).length,
  });
}

function reviewDesignerMoveCheckpoint(direction) {
  const review = currentDesignerReplayReviewState();
  if (!review.available) return;
  const target = designerReplayReviewTarget(review, direction);
  if (target === state.designerMoveReplayIndex) return;
  const checkpoint = restoreDesignerMoveCheckpoint(target);
  const completed = checkpoint.step;
  const atFinal = target === state.designerMoveReplayFrontier;
  const caption = target === 0 ? 'Blank canvas before the first story move'
    : atFinal && review.completed ? 'Story complete'
      : completed?.caption || completed?.action || 'Completed story state';
  updateDesignerMoveControls(`${review.completed ? 'Review' : 'Paused'} · cached checkpoint ${target} of ${state.designerMoveReplayFrontier}`,
    caption, target === 0
      ? 'Reviewing the untouched starting canvas.'
      : atFinal && review.completed
        ? 'Returned to the final computed story state. Replay story starts a new execution.'
        : `Reviewing move ${target} of ${state.designerMoveReplayFrontier}; no calculation is rerun.`);
}

function resumeDesignerMoveReplay() {
  if (!state.designerMoveReplaying || !state.designerMoveReplayPaused) return;
  if (state.designerMoveReplayIndex !== state.designerMoveReplayFrontier)
    restoreDesignerMoveCheckpoint(state.designerMoveReplayFrontier);
  const step = state.designerMoveReplayStep;
  if (step && state.designerMoveReplayPhase === 'before') showDesignerMoveCue(step);
  else if (step && state.designerMoveReplayPhase === 'after') showDesignerMoveResultCue(step);
  setDesignerMoveReplayPaused(false);
}

async function waitForDesignerMoveReplay() {
  while (state.designerMoveReplayPaused)
    await new Promise((resolve) => { designerMoveReplayResume = resolve; });
}

const DESIGNER_MOVE_RESULT_HOLDS_MS = Object.freeze({
  'designRoute.load':1500,
  'protein.prepare':1400,
  'pose.captureReference':1400,
  'designRoute.applyStep':2800,
  'pose.refine':3200,
  'pose.apply':2800,
  'pose.enumerateSidechainRotamers':3200,
  'pose.applySidechainRotamer':3400,
  'optimization.run':2800,
  'view.setDisplay':1600,
  'view.focusComponent':1400,
  'view.focusAtoms':3000,
  'view.highlightAtoms':2600,
  'view.setMode':900,
  'build.setTool':900,
  'protein.parameterize':1800,
  'pose.updateReceptorReference':1800,
});

function designerMoveHoldMs(step, phase, moviePaced = false) {
  if (phase === 'before') return moviePaced ? 900 : 700;
  const base = DESIGNER_MOVE_RESULT_HOLDS_MS[step.action]
    ?? (step.action?.startsWith('chemistry.') ? 1800
      : step.action?.startsWith('selection.') ? 1100 : 900);
  return moviePaced ? Math.max(base, 1200) : base;
}

async function holdDesignerMoveReplay(milliseconds) {
  let remaining = Math.max(0, Number(milliseconds) || 0);
  while (remaining > 0) {
    await waitForDesignerMoveReplay();
    const duration = Math.min(100, remaining);
    const startedAt = performance.now();
    await new Promise((resolve) => setTimeout(resolve, duration));
    if (!state.designerMoveReplayPaused)
      remaining -= Math.max(1, performance.now() - startedAt);
  }
}

function updateDesignerMoveControls(message = null, captionOverride = null,
  detailOverride = null) {
  const status = document.querySelector('#designer-move-status');
  if (!status) return;
  const tools = document.querySelector('#designer-move-tools');
  if (tools) tools.dataset.replayStatus = state.designerMoveReplaying
    ? 'running' : state.designerMoveReplayScheduled
      ? 'scheduled' : state.designerMoveReplay?.status || 'idle';
  const script = state.designerMoveScript;
  const actionCount = script?.actions.length || 0;
  const completedApiMoves = state.chemistActionAudit.filter((entry) =>
    entry?.status === 'completed').length;
  const replayButton = document.querySelector('#replay-designer-moves');
  const review = currentDesignerReplayReviewState();
  replayButton.disabled = !script
    || state.designerMoveReplayScheduled && !state.designerMoveReplaying;
  replayButton.textContent = state.designerMoveReplayScheduled && !state.designerMoveReplaying
    ? 'Starting story…' : state.designerMoveReplaying
    ? (state.designerMoveReplayPaused
      ? (state.designerMoveReplayIndex < state.designerMoveReplayFrontier
        ? '▶ Return & continue' : '▶ Continue') : '❚❚ Pause')
    : (review.completed && review.reviewing ? '▶ Return to final'
      : state.designerMoveReplayIndex >= actionCount && actionCount ? '↻ Replay story' : '▶ Play story');
  const checkpointNavigation = review.available;
  document.querySelector('#previous-designer-move').disabled =
    !checkpointNavigation || state.designerMoveReplayIndex <= 0;
  document.querySelector('#next-designer-move').disabled =
    !checkpointNavigation || state.designerMoveReplayIndex >= state.designerMoveReplayFrontier;
  document.querySelector('#restart-designer-moves').disabled =
    !script || state.designerMoveReplaying;
  document.querySelector('#export-designer-moves').disabled =
    !completedApiMoves || state.designerMoveReplaying;
  document.querySelector('#export-designer-replay').disabled =
    !state.designerMoveReplay || state.designerMoveReplaying;
  const progress = document.querySelector('#designer-move-progress');
  progress.max = Math.max(1, actionCount); progress.value = Math.min(actionCount,
    state.designerMoveReplayIndex);
  document.querySelector('#designer-move-progress-label').textContent =
    `${Math.min(actionCount, state.designerMoveReplayIndex)} / ${actionCount}`;
  const activeStepCaption = state.designerMoveReplayStep?.caption
    || state.designerMoveReplayStep?.action;
  const storyCaption = captionOverride
    || (state.designerMoveReplaying && activeStepCaption
      ? activeStepCaption : designerMoveCaption());
  document.querySelector('#designer-move-caption').textContent = storyCaption;
  const detail = document.querySelector('#designer-move-detail');
  if (detail) detail.textContent = detailOverride ?? (review.completed && review.reviewing
    ? `Reviewing move ${state.designerMoveReplayIndex} of ${state.designerMoveReplayFrontier}; no calculation is rerun.`
    : state.designerMoveReplayPaused
    ? state.designerMoveReplayActionRunning
      ? `Pause requested; move ${Math.min(actionCount, state.designerMoveReplayIndex + 1)} will finish first.`
      : state.designerMoveReplayIndex < state.designerMoveReplayFrontier
        ? `Reviewing move ${state.designerMoveReplayIndex}; live replay is paused at move ${state.designerMoveReplayFrontier}.`
        : `Paused before move ${Math.min(actionCount, state.designerMoveReplayIndex + 1)} of ${actionCount}.`
    : state.designerMoveReplayActionRunning
      ? `Running move ${Math.min(actionCount, state.designerMoveReplayIndex + 1)} of ${actionCount}…`
      : '');
  if (message) status.textContent = message;
  else if (script) status.textContent = `${script.label || 'Imported action script'} · ${script.actions.length} replayable move${script.actions.length === 1 ? '' : 's'} · ${script.schema}`;
  else status.textContent = completedApiMoves
    ? `${completedApiMoves} Agent/API move${completedApiMoves === 1 ? '' : 's'} recorded for this molecule. Export them as replayable JSON.`
    : 'Import a Chemist Actions JSON script, or export the Agent/API moves recorded for this molecule.';
}

async function importDesignerMoveScript(file) {
  if (!file) return;
  if (file.size > 2_000_000) throw new Error('Designer-move JSON must be smaller than 2 MB');
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch { throw new Error('Designer-move file is not valid JSON'); }
  await runChemistUiAction('designerScript.load', { script:parsed }, { reportError:false });
  showToast(`${parsed.actions.length} designer moves imported`);
}

async function installDesignerMoveScript(parsed) {
  const module = await import('./design-history/replay.mjs');
  module.validateActionScript(parsed);
  clearScene();
  document.querySelector('#designer-story-dock')?.classList.remove('hidden');
  state.designerMoveScript = structuredClone(parsed);
  state.designerMoveRegisteredStory = null;
  resetDesignerMovePlayback();
  updateDesignerMoveControls();
}

let designerMoveCueElements = [];

function clearDesignerMoveCueElements() {
  designerMoveCueElements.forEach((element) =>
    element.classList.remove('designer-move-cue', 'designer-move-press', 'designer-move-change'));
  designerMoveCueElements = [];
}

function clearDesignerMoveDemoLayout() {
  document.body.classList.remove('designer-move-demo-active');
  document.querySelectorAll('.designer-move-demo-minimized, .designer-move-demo-transport-only, .designer-move-demo-reveal')
    .forEach((element) => element.classList.remove('designer-move-demo-minimized',
      'designer-move-demo-transport-only', 'designer-move-demo-reveal'));
}

function applyDesignerMoveDemoLayout(step, activeElement) {
  clearDesignerMoveDemoLayout();
  document.body.classList.add('designer-move-demo-active');
  const transport = document.querySelector('#designer-move-tools');
  const transportCard = transport?.closest('.card');
  const activeCard = activeElement?.closest('.card') || null;
  document.querySelectorAll('.panel > .card, .panel-scroll-stack > .card').forEach((card) => {
    if (card.classList.contains('hidden') && card !== activeCard) return;
    const isActive = card === activeCard;
    const isTransport = card === transportCard;
    // Playback controls and the scientific caption are the story's stable
    // frame of reference. Never auto-collapse that card while other controls
    // are being cued or while a checkpoint is under review.
    if (isTransport) card.classList.remove('designer-move-demo-transport-only', 'collapsed');
    card.classList.toggle('designer-move-demo-minimized', !isActive && !isTransport);
  });
  const depiction = document.querySelector('#structure-2d-panel');
  depiction?.classList.toggle('designer-move-demo-minimized',
    !depiction.classList.contains('hidden') && !depiction.contains(activeElement));
  if (step.action === 'view.setDisplay' && activeElement?.classList.contains('hidden'))
    activeElement.classList.add('designer-move-demo-reveal');
}

function showDesignerMoveCue(step = null, { preserveLayout = false } = {}) {
  clearDesignerMoveCueElements();
  if (!step) {
    if (!preserveLayout) clearDesignerMoveDemoLayout();
    return;
  }
  const actionSelectors = {
    'protein.prepare':'#prepare-pdb',
    'history.undo':'#undo-atom', 'history.redo':'#redo-atom',
    'chemistry.setAtom':'#apply-atom-chemistry',
    'chemistry.setBond':'#apply-bond-chemistry',
    'chemistry.setEditPolicy':'#chemistry-immediate-refine',
    'chemistry.deleteAtom':'#delete-selected-atom',
    'chemistry.deleteBond':'#delete-bond-chemistry',
    'chemistry.addHydrogen':'#add-explicit-hydrogen',
    'chemistry.finish':'#finish-chemistry-changes',
    'chemistry.discard':'#discard-chemistry-changes',
    'pose.captureReference':'#capture-docking-reference',
    'pose.updateReceptorReference':'#update-docking-receptor',
    'pose.refine':'#run-constrained-docking', 'pose.apply':'#apply-docking-pose',
    'pose.enumerateSidechainRotamers':'#enumerate-sidechain-rotamers',
    'pose.applySidechainRotamer':'#apply-sidechain-rotamer',
    'optimization.run':'#optimize-button',
  };
  let selector = actionSelectors[step.action];
  if (step.action === 'view.setMode')
    selector = `.mode-bar button[data-mode="${CSS.escape(String(step.args?.mode || ''))}"]`;
  else if (step.action === 'view.focusComponent') selector = '#structure-components';
  else if (step.action === 'view.focusAtoms' || step.action === 'view.highlightAtoms')
    selector = '.viewer-stage';
  else if (step.action === 'view.setDisplay') selector = '#display-options';
  else if (step.action === 'build.setTool') {
    const tool = step.args?.tool === 'move' ? 'manipulate' : step.args?.tool;
    selector = `#build-tool-tabs [data-tool="${CSS.escape(String(tool || ''))}"]`;
  } else if (step.action?.startsWith('designRoute.')) selector = '#designer-move-tools';
  else if (step.action?.startsWith('selection.') || step.action === 'session.inspect')
    selector = '.viewer-stage';
  const element = selector ? document.querySelector(selector) : null;
  applyDesignerMoveDemoLayout(step, element);
  if (!element) return;
  const changedControls = step.action === 'view.setDisplay' ? [
    step.args?.representation != null && '#representation-select',
    step.args?.showHydrogens != null && '#hydrogen-toggle',
    step.args?.showInteractions != null && '#interaction-toggle',
    step.args?.showPocketAtoms != null && '#pocket-toggle',
    step.args?.showHulls != null && '#hull-toggle',
    step.args?.showStericClashes != null && '#steric-clash-toggle',
    step.args?.colorTheme != null && '#display-theme-select',
    step.args?.changeMarkers != null && '#change-marker-select',
  ].filter(Boolean).map((controlSelector) => document.querySelector(controlSelector)).filter(Boolean) : [];
  designerMoveCueElements = [element, ...changedControls];
  element.classList.add('designer-move-cue', 'designer-move-press');
  changedControls.forEach((control) => control.classList.add('designer-move-change'));
  const scrollContainer = element.closest('.panel-scroll-stack') || element.closest('.panel');
  if (scrollContainer) {
    const panelRect = scrollContainer.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    scrollContainer.scrollTop += elementRect.top - panelRect.top
      - Math.max(0, (scrollContainer.clientHeight - elementRect.height) / 2);
  } else element.scrollIntoView?.({ block:'center', inline:'nearest', behavior:'auto' });
}

function designerMoveResultCaption(step) {
  if (step.status === 'failed') return `${step.action} failed; no result was applied.`;
  if (step.action === 'pose.refine') {
    const count = Number(step.result?.refinement?.candidates || 0);
    const execution = step.result?.refinement?.poseSearchExecution;
    const ensemble = Number(execution?.workerCount) > 1
      ? ` · ${execution.workerCount} workers · ${(Number(execution.elapsedMs) / 1000).toFixed(1)} s · ${Number(execution.chainsPerSecond).toFixed(1)} chains/s`
      : '';
    return `${count} pose candidate${count === 1 ? '' : 's'} ready${ensemble} · coordinates intentionally remain unchanged until Apply pose.`;
  }
  if (step.action === 'pose.enumerateSidechainRotamers') {
    const count = Number(step.result?.sidechainRotamers?.candidates?.length || 0);
    return `${count} rotamer candidate${count === 1 ? '' : 's'} ready · the receptor remains unchanged until Apply branch.`;
  }
  if (step.action === 'protein.parameterize')
    return 'Parameters assigned · this action intentionally does not move any atom.';
  if (step.action === 'pose.captureReference')
    return 'Reference pose captured · coordinates intentionally remain unchanged.';
  if (step.action === 'pose.updateReceptorReference')
    return 'The applied receptor branch is now the reference · no additional coordinates moved.';
  if (step.action === 'view.focusAtoms') {
    const count = Number(step.result?.focusedAtoms?.atomCount || 0);
    return count
      ? `${count} changed atom${count === 1 ? '' : 's'} centered in local pocket context and marked for review.`
      : 'No heavy-atom movement crossed the display threshold; the previous camera is retained.';
  }
  if (step.action === 'view.highlightAtoms') {
    const count = Number(step.result?.highlightedAtoms?.atomCount || 0);
    return count
      ? `${count} changed atom${count === 1 ? '' : 's'} marked for review; camera and pocket context retained for direct comparison.`
      : 'No heavy-atom movement crossed the display threshold; camera and pocket context retained.';
  }
  if (step.action === 'designRoute.applyStep') {
    const count = Number(step.result?.designStep?.changedAtomIds?.length || 0);
    return `Graph edit staged · ${count} changed heavy atom${count === 1 ? '' : 's'} reported for local inspection.`;
  }
  if (step.action === 'pose.apply' || step.action === 'pose.applySidechainRotamer'
    || step.action === 'optimization.run') {
    const result = step.action === 'pose.apply' ? step.result?.appliedPose
      : step.action === 'pose.applySidechainRotamer' ? step.result?.sidechainRotamer
        : step.result?.optimization;
    const moved = Number(result?.movedHeavyAtomCount || 0);
    return `${moved} heavy atom${moved === 1 ? '' : 's'} moved beyond the display threshold.`;
  }
  return 'Move completed.';
}

function showDesignerMoveResultCue(step) {
  clearDesignerMoveCueElements();
  const resultSelectors = {
    'pose.refine':'#docking-results',
    'pose.enumerateSidechainRotamers':'#sidechain-rotamer-results',
    'designRoute.applyStep':'.viewer-stage',
    'pose.apply':'.viewer-stage',
    'pose.applySidechainRotamer':'.viewer-stage',
    'optimization.run':'.viewer-stage',
    'view.focusComponent':'.viewer-stage',
    'view.focusAtoms':'.viewer-stage',
    'view.highlightAtoms':'.viewer-stage',
  };
  const selector = resultSelectors[step.action];
  const element = selector ? document.querySelector(selector) : null;
  if (!element) return;
  applyDesignerMoveDemoLayout(step, element);
  designerMoveCueElements = [element];
  element.classList.add('designer-move-cue', 'designer-move-change');
  const scrollContainer = element.closest('.panel-scroll-stack') || element.closest('.panel');
  if (scrollContainer) {
    const panelRect = scrollContainer.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    scrollContainer.scrollTop += elementRect.top - panelRect.top
      - Math.max(0, (scrollContainer.clientHeight - elementRect.height) / 2);
  }
}

function presentDesignerMoveStep(index, phase) {
  const script = state.designerMoveScript;
  if (!script) throw new Error('Load a designer-move script first');
  if (!Number.isInteger(index) || index < 0 || index >= script.actions.length)
    throw new Error('index must identify an installed designer-move step');
  if (!['before','after','clear'].includes(phase))
    throw new Error('phase must be one of: before, after, clear');
  const pending = state.designerMovePresentationStep;
  const source = script.actions[index];
  const step = pending?.index === index && pending?.action === source.action
    ? structuredClone(pending) : { ...structuredClone(source), index,
      status:phase === 'after' ? 'completed' : 'running' };
  if (phase === 'clear') {
    showDesignerMoveCue();
    return { index, phase, action:source.action, cleared:true };
  }
  state.designerMoveReplayPhase = phase;
  state.designerMoveReplayStep = structuredClone(step);
  if (phase === 'before') {
    state.designerMoveReplayIndex = index;
    showDesignerMoveCue(step);
    updateDesignerMoveControls(
      `Move ${index + 1} of ${script.actions.length} · ${step.caption || step.action}`);
  } else {
    state.designerMoveReplayActionRunning = false;
    state.designerMoveReplayIndex = index + 1;
    showDesignerMoveResultCue(step);
    const message = `Completed move ${index + 1} of ${script.actions.length} · ${step.caption || step.action}`;
    updateDesignerMoveControls(message, step.caption || step.action,
      designerMoveResultCaption(step));
    captureDesignerMoveCheckpoint(index + 1, step);
    updateDesignerMoveControls(message, step.caption || step.action,
      designerMoveResultCaption(step));
  }
  return { index, phase, action:source.action,
    checkpointIndex:phase === 'after' ? index + 1 : null };
}

async function replayDesignerMoveScript() {
  const script = state.designerMoveScript;
  if (!script) throw new Error('Import a designer-move JSON script first');
  if (state.designerMoveReplaying) {
    if (state.designerMoveReplayPaused) resumeDesignerMoveReplay();
    else setDesignerMoveReplayPaused(true);
    return null;
  }
  if (state.designerMoveReplayIndex >= script.actions.length) {
    clearScene();
    resetDesignerMovePlayback();
  }
  const [api, module] = await Promise.all([
    window.MolariumChemistActionsReady,
    import('./design-history/replay.mjs'),
  ]);
  state.designerMoveReplaying = true;
  state.designerMoveReplay = null;
  state.designerMoveReplayPaused = false;
  state.designerMoveReplayIndex = 0;
  state.designerMoveReplayFrontier = 0;
  state.designerMoveReplayPhase = null;
  state.designerMoveReplayStep = null;
  state.designerMoveReplayActionRunning = false;
  state.designerMoveReplayCheckpoints = [];
  captureDesignerMoveCheckpoint(0);
  const moviePacedReplay = new URLSearchParams(window.location.search)
    .has('designer-moves-movie');
  updateDesignerMoveControls(`Starting ${script.actions.length} recorded designer moves…`);
  try {
    const replay = await module.replayActionScript(api, script, {
      onStep:async ({ phase, step }) => {
        if (phase === 'before') {
          await waitForDesignerMoveReplay();
          state.designerMoveReplayActionRunning = true;
          state.designerMovePresentationStep = structuredClone(step);
          await api.execute({ action:'interface.presentDesignerStep',
            args:{ index:step.index, phase:'before' } });
          await holdDesignerMoveReplay(designerMoveHoldMs(step, phase, moviePacedReplay));
        } else {
          state.designerMovePresentationStep = structuredClone(step);
          await api.execute({ action:'interface.presentDesignerStep',
            args:{ index:step.index, phase:'after' } });
          await holdDesignerMoveReplay(designerMoveHoldMs(step, phase, moviePacedReplay));
          await api.execute({ action:'interface.presentDesignerStep',
            args:{ index:step.index, phase:'clear' } });
        }
      },
    });
    state.designerMoveReplay = replay;
    if (replay.status !== 'completed') {
      const failed = replay.steps.find((step) => step.status === 'failed');
      throw new Error(`Replay stopped at move ${(failed?.index ?? 0) + 1}: ${failed?.error || 'unknown error'}`);
    }
    // The ordinary per-step checkpoint is captured while its result cue is
    // visible. Replace the terminal checkpoint after the final clear phase so
    // returning to the end of a completed story restores the actual clean UI.
    captureDesignerMoveCheckpoint(script.actions.length,
      replay.steps.at(-1) || script.actions.at(-1));
    showToast(`${script.actions.length} designer moves replayed through the public Agent API`);
  } finally {
    if (script.actions.length && (designerMoveCueElements.length
      || document.body.classList.contains('designer-move-demo-active'))) {
      try { await api.execute({ action:'interface.presentDesignerStep', args:{
        index:Math.min(script.actions.length - 1,
          Math.max(0, state.designerMoveReplayIndex - 1)), phase:'clear' } }); }
      catch { showDesignerMoveCue(); }
    } else showDesignerMoveCue();
    state.designerMoveReplaying = false;
    state.designerMoveReplayPaused = false;
    state.designerMoveReplayActionRunning = false;
    state.designerMoveReplayPhase = null;
    state.designerMoveReplayStep = null;
    state.designerMovePresentationStep = null;
    designerMoveReplayResume?.(); designerMoveReplayResume = null;
    updateDesignerMoveControls();
  }
}

async function createDesignerScriptExport(kind) {
  let value, filename;
  if (kind === 'recorded-actions') {
    const module = await import('./design-history/replay.mjs');
    value = module.actionScriptFromAudit(state.chemistActionAudit, {
      label:`${state.molecule?.name || 'Molarium'} designer moves`,
    });
    filename = `${slug(state.molecule?.name || 'molarium')}-designer-moves.json`;
  } else if (kind === 'execution-log') {
    if (!state.designerMoveReplay) throw new Error('Replay a designer-move script first');
    value = state.designerMoveReplay;
    filename = `${slug(state.designerMoveScript?.label
      || state.molecule?.name || 'molarium')}-replay-log.json`;
  } else if (kind === 'installed-script') {
    if (!state.designerMoveScript) throw new Error('Load a designer-move script first');
    value = state.designerMoveScript;
    filename = `${slug(state.designerMoveScript.label || 'molarium')}-action-script.json`;
  } else throw new Error('kind must be one of: recorded-actions, execution-log, installed-script');
  return { kind, filename, serialized:`${JSON.stringify(value, null, 2)}\n` };
}

async function downloadDesignerScriptExport(kind) {
  const result = await runChemistUiAction('designerScript.export', { kind },
    { reportError:false });
  const exported = result.designerScriptExport;
  downloadBlob(exported.serialized, exported.filename, 'application/json');
  if (kind === 'recorded-actions') {
    const actionCount = JSON.parse(exported.serialized).actions.length;
    updateDesignerMoveControls(`${actionCount} recorded Agent/API moves exported as replayable JSON.`);
  }
}

function chemistActionKeys(args, allowed = []) {
  const unexpected = Object.keys(args || {}).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`Unexpected argument${unexpected.length === 1 ? '' : 's'}: ${unexpected.join(', ')}`);
}

function chemistActionEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  return value;
}

function chemistActionSummary(extra = {}) {
  const molecule = state.molecule;
  return { molecule:molecule ? { name:molecule.name || 'Molecule', atoms:molecule.atoms.length,
    bonds:molecule.bonds.length, chemistryValidation:structuredClone(
      molecule.source?.chemistryValidation || null) } : null,
  mode:state.mode, chemistryEditPolicy:state.chemistryEditPolicy,
  selectedAtomIds:(state.selectedAtoms || [])
    .map((index) => molecule?.atoms?.[index]?.designAtomId).filter(Boolean),
  pendingChemistry:state.chemistryTransaction ? {
    editCount:state.chemistryTransaction.editCount,
    finishing:Boolean(state.chemistryEditFinishing),
  } : null, ...extra };
}

function persistChemistActionAudit(record) {
  if (!state.molecule) return;
  const entry = { schema:'molarium.chemist-action-audit/v1', ...structuredClone(record),
    outcomeState:{ moleculeName:state.molecule.name || 'Molecule',
      atomCount:state.molecule.atoms.length, bondCount:state.molecule.bonds.length,
      mode:state.mode, chemistryEditPolicy:state.chemistryEditPolicy,
      pendingChemistry:Boolean(state.chemistryTransaction),
      selectedAtomIds:(state.selectedAtoms || []).map((index) =>
        state.molecule.atoms[index]?.designAtomId).filter(Boolean) } };
  state.chemistActionAudit = [...state.chemistActionAudit, entry].slice(-500);
  state.molecule.source = { ...(state.molecule.source || {}),
    chemistActionAudit:structuredClone(state.chemistActionAudit) };
  // Presentation and replay-controller routes update this card inside their
  // own handler.  Re-rendering it here would immediately replace a visible
  // "Move"/"Completed move" checkpoint with the generic script summary.
  const ownsDesignerMoveStatus = entry.action === 'interface.presentDesignerStep'
    || entry.action.startsWith('designerScript.');
  if (!ownsDesignerMoveStatus) updateDesignerMoveControls();
}

let liveCampaignModulePromise = null;
let liveCampaignStoreModulePromise = null;
let liveCampaignStorePromise = null;
let liveCampaignRestorePromise = null;
let liveCampaignUiBusy = false;

function getLiveCampaignModule() {
  liveCampaignModulePromise ||= import('./design-history/live-campaign.mjs');
  return liveCampaignModulePromise;
}

function getLiveCampaignStoreModule() {
  liveCampaignStoreModulePromise ||= import('./design-history/live-campaign-store.mjs');
  return liveCampaignStoreModulePromise;
}

function getLiveCampaignStore() {
  liveCampaignStorePromise ||= getLiveCampaignStoreModule()
    .then((module) => module.createLiveCampaignStore());
  return liveCampaignStorePromise;
}

function liveCampaignActorId(campaign = state.liveCampaign) {
  return campaign?.actors?.find((actor) => actor.type === 'human')?.id
    || campaign?.actors?.[0]?.id || 'chemist.local';
}

function liveCampaignHead(campaign = state.liveCampaign,
  branch = state.liveCampaignBranch) {
  return campaign?.branches?.[branch] || null;
}

function updateLiveCampaignUi(message = '', status = '') {
  const campaign = state.liveCampaign;
  const createControls = document.querySelector('#campaign-create-controls');
  const activeControls = document.querySelector('#campaign-active-controls');
  const statusElement = document.querySelector('#campaign-status');
  if (!createControls || !activeControls || !statusElement) return;
  createControls.classList.toggle('hidden', Boolean(campaign));
  activeControls.classList.toggle('hidden', !campaign);
  document.querySelector('#campaign-export').disabled = !campaign || liveCampaignUiBusy;
  document.querySelector('#campaign-verify').disabled = !campaign || liveCampaignUiBusy;
  document.querySelector('#campaign-close').disabled = !campaign || liveCampaignUiBusy;
  document.querySelector('#campaign-import').disabled = liveCampaignUiBusy;
  document.querySelector('#campaign-create').disabled = liveCampaignUiBusy;
  document.querySelectorAll('#campaign-active-controls button, #campaign-active-controls input, #campaign-active-controls textarea, #campaign-active-controls select')
    .forEach((control) => { control.disabled = !campaign || liveCampaignUiBusy
      || Boolean(campaign?.campaignSha256); });
  statusElement.classList.toggle('success', status === 'success');
  statusElement.classList.toggle('failure', status === 'failure');
  statusElement.textContent = message || (campaign
    ? `${campaign.title} · ${state.liveCampaignBranch}`
    : 'No active campaign · history stays on this device.');
  if (!campaign) return;

  const commits = Object.keys(campaign.objects?.commits || {}).length;
  const decisions = (campaign.events || []).filter((event) =>
    event.kind === 'decision.recorded').length;
  const summary = document.querySelector('#campaign-summary');
  summary.replaceChildren();
  for (const [label, value] of [['Branch', state.liveCampaignBranch],
    ['Commits', commits], ['Decisions', decisions]]) {
    const item = document.createElement('span');
    const strong = document.createElement('strong');
    item.append(document.createTextNode(label)); strong.textContent = String(value); item.append(strong);
    summary.append(item);
  }
  const branches = Object.keys(campaign.branches || {}).sort();
  const branchSelect = document.querySelector('#campaign-branch');
  branchSelect.replaceChildren(...branches.map((branch) => {
    const option = document.createElement('option'); option.value = branch; option.textContent = branch;
    return option;
  }));
  branchSelect.value = state.liveCampaignBranch;
  const mergeSelect = document.querySelector('#campaign-merge-source');
  const mergeBranches = branches.filter((branch) => branch !== state.liveCampaignBranch
    && campaign.branches[branch]);
  mergeSelect.replaceChildren(...mergeBranches.map((branch) => {
    const option = document.createElement('option'); option.value = branch; option.textContent = branch;
    return option;
  }));
  mergeSelect.disabled = liveCampaignUiBusy || Boolean(campaign.campaignSha256)
    || !mergeBranches.length;
  document.querySelector('#campaign-merge').disabled = liveCampaignUiBusy
    || Boolean(campaign.campaignSha256) || !mergeBranches.length || !liveCampaignHead();
  document.querySelector('#campaign-record-decision').disabled = liveCampaignUiBusy
    || Boolean(campaign.campaignSha256) || !liveCampaignHead();
}

async function saveLiveCampaign(campaign, activeBranch = state.liveCampaignBranch) {
  const store = await getLiveCampaignStore();
  await store.save(campaign, { activeBranch });
}

function currentChemistActionSequence() {
  return Math.max(0, ...state.chemistActionAudit.map((record) =>
    Number.isInteger(record?.sequence) ? record.sequence : 0));
}

async function loadLiveCampaignBranchMolecule(campaign, branch) {
  const prepared = await prepareLiveCampaignBranchMolecule(campaign, branch);
  if (!prepared.commitId) return null;
  applyLiveCampaignBranchMolecule(prepared.molecule);
  return prepared.commitId;
}

async function prepareLiveCampaignBranchMolecule(campaign, branch, { required = false } = {}) {
  const commitId = campaign?.branches?.[branch];
  if (!commitId) {
    if (required) throw new Error(`Campaign branch ${branch} has no molecular commit to restore`);
    return { commitId:null, molecule:null };
  }
  const live = await getLiveCampaignModule();
  return { commitId, molecule:live.moleculeFromCampaignCommit(campaign, commitId) };
}

function applyLiveCampaignBranchMolecule(molecule) {
  const audit = structuredClone(state.chemistActionAudit);
  loadMolecule(molecule);
  state.chemistActionAudit = audit;
  state.molecule.source = { ...(state.molecule.source || {}),
    chemistActionAudit:structuredClone(audit) };
  updateDesignerMoveControls();
}

async function initializeLiveCampaignPersistence() {
  try {
    const [store, module] = await Promise.all([getLiveCampaignStore(), getLiveCampaignModule()]);
    const workspace = await store.loadActive();
    if (!workspace?.campaign) return updateLiveCampaignUi();
    const { campaign } = workspace;
    const verification = await module.verifyLiveCampaign(campaign);
    if (!verification.valid) throw new Error(`Stored campaign is invalid: ${verification.reason}`);
    const branch = Object.hasOwn(campaign.branches || {}, workspace.activeBranch)
      ? workspace.activeBranch : 'main';
    const checkout = await prepareLiveCampaignBranchMolecule(campaign, branch, { required:true });
    state.liveCampaign = campaign;
    state.liveCampaignBranch = branch;
    // Chemist Actions sequence numbers are scoped to this page/API instance.
    // A persisted campaign's historical sequence must not suppress new-session actions.
    state.liveCampaignCommittedThroughSequence = 0;
    applyLiveCampaignBranchMolecule(checkout.molecule);
    updateLiveCampaignUi('Restored the most recent local campaign.', 'success');
  } catch (error) {
    updateLiveCampaignUi(`Local campaign storage unavailable: ${error.message}`, 'failure');
  }
}

function ensureLiveCampaignPersistence() {
  liveCampaignRestorePromise ||= initializeLiveCampaignPersistence();
  return liveCampaignRestorePromise;
}

function liveCampaignInspection() {
  const campaign = state.liveCampaign;
  if (!campaign) return { active:false, campaign:null,
    currentBranch:null, currentCommitId:null, uncommittedActionCount:0 };
  const committedThrough = Number(state.liveCampaignCommittedThroughSequence || 0);
  return { active:true, campaign:{ campaignId:campaign.campaignId, title:campaign.title,
    description:campaign.description, createdAt:campaign.createdAt,
    finalizedAt:campaign.finalizedAt || null,
    actors:structuredClone(campaign.actors || []),
    commits:Object.keys(campaign.objects?.commits || {}).length,
    events:campaign.events?.length || 0,
    decisions:(campaign.events || []).filter((event) => event.kind === 'decision.recorded').length,
    branches:structuredClone(campaign.branches || {}),
    campaignSha256:campaign.campaignSha256 || null },
  currentBranch:state.liveCampaignBranch,
  currentCommitId:liveCampaignHead(),
  committedThroughSequence:committedThrough,
  uncommittedActionCount:state.chemistActionAudit.filter((record) =>
    record.status === 'completed' && Number(record.sequence || 0) > committedThrough
      && !String(record.action || '').startsWith('campaign.')).length };
}

async function runCampaignUiAction(action, args, successMessage) {
  if (liveCampaignUiBusy) return;
  liveCampaignUiBusy = true; updateLiveCampaignUi('Updating design history…');
  let finalMessage = '', finalStatus = '';
  try {
    const api = await window.MolariumChemistActionsReady;
    const response = await api.execute({ action, args });
    finalMessage = successMessage(response.result); finalStatus = 'success';
    return response.result;
  } catch (error) {
    finalMessage = error.message; finalStatus = 'failure';
    showNotice(error.message);
    return null;
  } finally {
    liveCampaignUiBusy = false; updateLiveCampaignUi(finalMessage, finalStatus);
  }
}

async function ensureChemistActionAtomIds() {
  if (!state.molecule?.atoms?.length) throw new Error('Load a molecule before using Chemist Actions.');
  const { ensureStableAtomIds } = await import('./docking/reference-core.mjs');
  ensureStableAtomIds(state.molecule, `chemist-${state.molecule.source?.pdbId || 'molecule'}`,
    state.dockingReference?.ligand?.atomIds || []);
  const byId = new Map();
  state.molecule.atoms.forEach((atom, index) => {
    if (!atom.designAtomId || byId.has(atom.designAtomId))
      throw new Error('The current molecule does not have unique persistent atom identities.');
    byId.set(atom.designAtomId, index);
  });
  return byId;
}

async function inspectChemistActionState({ scope = 'ligand', includeCoordinates = false,
  maximumAtoms = 100 } = {}) {
  chemistActionEnum(scope, ['ligand','selection','pocket','all'], 'scope');
  if (typeof includeCoordinates !== 'boolean') throw new Error('includeCoordinates must be boolean');
  const limit = Number(maximumAtoms);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new Error('maximumAtoms must be an integer from 1 to 500');
  await ensureChemistActionAtomIds();
  let indices;
  if (scope === 'selection') indices = [...state.selectedAtoms];
  else if (scope === 'ligand') indices = dockingLigandComponent()?.atomIndices.slice()
    || state.structureComponents.find((component) => component.kind === 'ligand')?.atomIndices.slice()
    || state.molecule.atoms.map((_, index) => index);
  else if (scope === 'pocket') {
    if (!state.dockingReference) throw new Error('Capture a reference pose before inspecting the pocket');
    const byId = new Map(state.molecule.atoms.map((atom, index) => [atom.designAtomId, index]));
    const contactParticipants = state.dockingReference.hydrogenBonds.flatMap((definition) =>
      [definition.donor, definition.hydrogen, definition.acceptor]
        .map((descriptor) => byId.get(descriptor?.designAtomId)).filter(Number.isInteger));
    const ligandIndices = currentDockingLigandAtomIndices();
    const siteIndices = state.dockingReference.receptorSite.atoms
      .map((atom) => byId.get(atom.designAtomId)).filter(Number.isInteger);
    indices = [...new Set([...contactParticipants, ...ligandIndices, ...siteIndices])];
  }
  else indices = state.molecule.atoms.map((_, index) => index);
  const totalAtomCount = indices.length;
  indices = indices.slice(0, limit);
  const included = new Set(indices);
  const atoms = indices.map((index) => {
    const atom = state.molecule.atoms[index];
    return { atomId:atom.designAtomId, element:atom.element,
      formalCharge:atomFormalCharge(atom), aromatic:Boolean(atom.aromatic),
      atomName:atom.atomName || null, residueName:atom.residueName || null,
      chain:atom.chain || null, residueIndex:atom.residueIndex ?? null,
      insertionCode:atom.insertionCode || '',
      ...(includeCoordinates ? { coordinatesAngstrom:[Number(atom.x),Number(atom.y),Number(atom.z)] } : {}) };
  });
  const bonds = state.molecule.bonds.flatMap((bond) => included.has(bond.a) && included.has(bond.b)
    ? [{ atomIds:[state.molecule.atoms[bond.a].designAtomId,
      state.molecule.atoms[bond.b].designAtomId], order:Number(bond.order || 1),
      aromatic:Boolean(bond.aromatic || Number(bond.order) === 1.5) }] : []);
  const currentPoseHydrogenBonds = new Map((state.dockingResult?.run?.candidates
    ?.[state.dockingPoseIndex]?.hydrogenBonds || []).map((entry) => [entry.id, entry]));
  const participant = (descriptor) => {
    if (!descriptor) return null;
    if (descriptor.scope === 'receptor') return {
      scope:'receptor', atomId:descriptor.designAtomId || null,
      element:descriptor.element || null,
      ...(includeCoordinates && descriptor.point ? { coordinatesAngstrom:[
        Number(descriptor.point.x), Number(descriptor.point.y), Number(descriptor.point.z),
      ] } : {}),
    };
    const atom = state.molecule.atoms.find((entry) =>
      entry.designAtomId === descriptor.designAtomId);
    return {
      scope:'ligand', atomId:descriptor.designAtomId || null,
      element:atom?.element || descriptor.element || null,
      ...(includeCoordinates && atom ? { coordinatesAngstrom:[
        Number(atom.x), Number(atom.y), Number(atom.z),
      ] } : {}),
    };
  };
  const contacts = (state.dockingReference?.hydrogenBonds || []).map((definition) => {
    let effective = effectiveDockingHydrogenBondDefinition(definition);
    const proposal = state.dockingContactRemapProposals.get(definition.id);
    const poseContact = currentPoseHydrogenBonds.get(definition.id);
    const selectedAlternative = poseContact?.selectedAlternativeId && proposal?.candidates
      ?.find((candidate) => candidate.id === poseContact.selectedAlternativeId);
    if (selectedAlternative?.replacement) {
      effective = structuredClone(proposal.priorEffectiveDefinition || definition);
      if (selectedAlternative.role === 'acceptor')
        effective.acceptor = structuredClone(selectedAlternative.replacement.acceptor);
      else {
        effective.donor = structuredClone(selectedAlternative.replacement.donor);
        effective.hydrogen = structuredClone(selectedAlternative.replacement.hydrogen);
      }
    }
    return { contactId:definition.id, label:definition.label,
      origin:structuredClone(definition.origin || null),
      required:state.dockingSelectedHbondIds.has(definition.id),
      available:(!proposal || Boolean(selectedAlternative)) && dockingContactAvailable(effective),
      remapStatus:proposal?.status || (state.dockingContactRemaps.has(definition.id) ? 'mapped' : 'original'),
      hydrogenBond:{ receptorRole:effective.receptorRole,
        selectedAlternativeId:poseContact?.selectedAlternativeId || null,
        satisfied:poseContact?.satisfied ?? null,
        donorAcceptorDistanceAngstrom:poseContact?.donorAcceptorDistanceAngstrom ?? null,
        hydrogenAcceptorDistanceAngstrom:poseContact?.hydrogenAcceptorDistanceAngstrom ?? null,
        dhaAngleDegrees:poseContact?.dhaAngleDegrees ?? null,
        participants:{ donor:participant(effective.donor),
          hydrogen:participant(effective.hydrogen),
          acceptor:participant(effective.acceptor) } } };
  });
  return chemistActionSummary({ scope, truncated:totalAtomCount > atoms.length,
    totalAtomCount, atoms, bonds, contacts,
    poseReference:state.dockingReference ? { mode:state.dockingReference.mode,
      capturedAt:state.dockingReference.capturedAt,
      resultPoseCount:state.dockingResult?.run?.candidates?.length || 0 } : null,
    transformedRingRegions:structuredClone(
      state.molecule.source?.posePropagationEditRegions || []),
    chemistActionAuditCount:state.chemistActionAudit.length });
}

const REGISTERED_DESIGN_ROUTES = Object.freeze({
  'bclxl-hit-only':'./design-history/structures/generated/bclxl-prospective-campaign.json',
  'cdk2-hit-only':'./design-history/structures/generated/cdk2-prospective-campaign.json',
  'cdk2-designer-intent':'./design-history/structures/generated/cdk2-designer-campaign.json',
  'sos1-hit-only':'./design-history/structures/generated/sos1-prospective-campaign.json',
});

async function fetchPinnedText(path, expectedSha256) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Registered campaign asset could not be loaded (${response.status})`);
  const bytes = await response.arrayBuffer();
  const actualSha256 = await sha256Hex(bytes);
  if (actualSha256 !== expectedSha256)
    throw new Error(`Registered campaign asset hash mismatch: ${path}`);
  return new TextDecoder().decode(bytes);
}

async function loadRegisteredDesignRoute(routeId) {
  const route = await fetchRegisteredDesignRoute(routeId);
  const [protein, ligand] = await Promise.all([
    fetchPinnedText(route.hit.proteinAsset, route.hit.proteinSha256),
    fetchPinnedText(route.hit.ligandAsset, route.hit.ligandSha256),
  ]);
  const coordinateMolecule = parsePDB(`${protein.replace(/\nEND\s*$/m, '')}\n${ligand}`, {
    pdbId:route.hit.pdbId, name:`${route.hit.pdbId} · registered hit`,
  });
  const registeredGraph = applyRegisteredLigandDefinition(coordinateMolecule, {
    residueName:route.hit.ligand, definition:route.hit.ligandDefinition,
  });
  const molecule = registeredGraph.molecule;
  state.buildHistory = []; state.redoHistory = [];
  loadMolecule(molecule); updateHistoryButtons();
  state.designRoute = structuredClone(route);
  state.designRouteStepId = route.hit.stateId;
  state.molecule.source = { ...(state.molecule.source || {}), designRoute:{
    routeId:route.id, hitPdbId:route.hit.pdbId,
    stateId:route.hit.stateId, coordinateInputClass:'registered-hit-only',
  } };
  return { routeId:route.id, title:route.title,
    hit:{ pdbId:route.hit.pdbId, ligand:route.hit.ligand,
      stateId:route.hit.stateId, graph:{ heavyAtomCount:registeredGraph.heavyAtomCount,
        bondCount:registeredGraph.bondCount, connected:registeredGraph.connected,
        coordinateMaximumDisplacement:registeredGraph.coordinateMaximumDisplacement } },
    coordinateInputs:structuredClone(route.protocolBoundary.coordinateInputs),
    availableSteps:route.steps.map((step) => step.id) };
}

async function fetchRegisteredDesignRoute(routeId) {
  const path = REGISTERED_DESIGN_ROUTES[routeId];
  if (!path) throw new Error(`Unknown registered design route: ${routeId}`);
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Registered design route could not be loaded (${response.status})`);
  const route = await response.json();
  validateRegisteredDesignRoute(route, { expectedId:routeId });
  if (route.evaluation?.status !== 'locked-until-predictions-frozen'
    || route.evaluation?.holdouts?.length)
    throw new Error('A hit-only route cannot expose evaluation holdouts before prediction freeze');
  const coordinateFilesRead = route.generator?.coordinateFilesRead || [];
  const hitCoordinateToken = String(route.hit?.pdbId || '').toLowerCase();
  if (!hitCoordinateToken || !coordinateFilesRead.length
    || coordinateFilesRead.some((entry) => !String(entry).toLowerCase().includes(hitCoordinateToken)))
    throw new Error('Registered design route has a non-hit coordinate dependency');
  return route;
}

function installChemistActionsApi(module) {
  const empty = (args) => chemistActionKeys(args);
  const summarizeMutation = async (operation, target = {}) => {
    const result = await operation();
    return chemistActionSummary({ ...target, chemistryEditPolicy:state.chemistryEditPolicy,
      validation:structuredClone(result?.validation || null),
      polish:result?.polish ? { cleanupMode:result.polish.cleanupMode || null,
        initialEnergy:result.polish.initialEnergy ?? null,
        finalEnergy:result.polish.finalEnergy ?? null } : null,
      contactFeatureRemaps:structuredClone(result?.contactFeatureRemaps || []) });
  };
  const chemistryTargetAtomIds = async (args, count) => {
    const key = count === 1 ? 'atomId' : 'atomIds';
    const byId = await ensureChemistActionAtomIds();
    let atomIds;
    if (Object.hasOwn(args, key)) atomIds = count === 1 ? [args.atomId] : args.atomIds;
    else {
      if (state.designerMoveReplaying)
        throw new Error(`${key} is required in a saved publication replay`);
      atomIds = state.selectedAtoms.map((index) => state.molecule?.atoms?.[index]?.designAtomId);
    }
    if (!Array.isArray(atomIds) || atomIds.length !== count
      || atomIds.some((id) => typeof id !== 'string' || !id)
      || new Set(atomIds).size !== atomIds.length)
      throw new Error(count === 1
        ? 'atomId must be one persistent atom ID'
        : 'atomIds must contain two different persistent atom IDs');
    const indices = atomIds.map((id) => {
      if (!byId.has(id)) throw new Error(`Unknown persistent atom ID: ${id}`);
      return byId.get(id);
    });
    setDepictionSelection(indices);
    return count === 1 ? { atomId:atomIds[0] } : { atomIds:[...atomIds] };
  };
  const routes = {
    'session.inspect':async (args) => { chemistActionKeys(args,
      ['scope','includeCoordinates','maximumAtoms']); return inspectChemistActionState(args); },
    'session.loadStructure':async (args) => { chemistActionKeys(args,
      ['content','format','name','polish']);
      if (typeof args.content !== 'string' || !args.content.trim())
        throw new Error('content must be non-empty structure text');
      const format = chemistActionEnum(args.format ?? 'auto',
        ['auto','pdb','xyz','mol','smiles'], 'format');
      if (args.name != null && (typeof args.name !== 'string' || !args.name.trim()
        || args.name.length > 160)) throw new Error('name must be a non-empty string up to 160 characters');
      if (args.polish != null && typeof args.polish !== 'boolean')
        throw new Error('polish must be boolean');
      const content = args.content.trim();
      const detected = format !== 'auto' ? format
        : /^(?:HEADER|TITLE |MODEL |ATOM  |HETATM)/m.test(content) ? 'pdb'
          : /(?:V2000|V3000)/m.test(content) ? 'mol'
            : /^\s*\d+\s*(?:\r?\n)/.test(content) ? 'xyz' : 'smiles';
      let molecule, polish = null;
      if (detected === 'smiles') {
        const embedded = await createRdkitSmilesMolecule(content, args.name || 'SMILES structure');
        molecule = embedded.molecule;
        polish = embedded.result;
      } else {
        molecule = detected === 'pdb' ? parsePDB(content, { name:args.name })
          : detected === 'mol' ? parseMolBlock(content, { name:args.name })
            : parseXYZ(content, { name:args.name });
        loadMolecule(molecule);
        if (args.polish !== false && smallMoleculePolishEligible(molecule))
          polish = await polishSmallMoleculeCoordinates(molecule);
      }
      if (state.molecule !== molecule) loadMolecule(molecule);
      state.buildHistory = []; state.redoHistory = []; updateHistoryButtons();
      return chemistActionSummary({ load:{ format:detected,
        polished:Boolean(polish), name:molecule.name || args.name || null } }); },
    'session.loadIdentifier':async (args) => { chemistActionKeys(args, ['value','kind']);
      if (typeof args.value !== 'string' || !args.value.trim() || args.value.length > 4096)
        throw new Error('value must be a non-empty identifier');
      const requestedKind = chemistActionEnum(args.kind ?? 'auto',
        ['auto','library','smiles','pdb'], 'kind');
      const raw = args.value.trim(), lookup = raw.toLowerCase();
      const libraryKey = Object.keys(LIBRARY).find((name) =>
        lookup === name || lookup === LIBRARY[name].smiles.toLowerCase());
      const pdbCandidate = /^(?:PDB\s*[:#-]?\s*)?[0-9][A-Za-z0-9]{3}$/i.test(raw);
      const kind = requestedKind === 'auto' ? libraryKey ? 'library'
        : pdbCandidate ? 'pdb' : 'smiles' : requestedKind;
      if (kind === 'pdb') {
        const molecule = await loadPdbIdentifier(raw);
        return chemistActionSummary({ load:{ kind, pdbId:molecule.source?.pdbId || null } });
      }
      if (kind === 'library' && !libraryKey)
        throw new Error(`Unknown built-in molecule: ${raw}`);
      const smiles = kind === 'library' ? LIBRARY[libraryKey].smiles : raw;
      const name = kind === 'library' ? LIBRARY[libraryKey].name : 'SMILES structure';
      const embedded = await createRdkitSmilesMolecule(smiles, name);
      loadMolecule(embedded.molecule);
      const protonation = await enumerateLigandProtonation(smiles);
      return chemistActionSummary({ load:{ kind, libraryId:libraryKey || null,
        smiles, conformerCount:embedded.result?.conformerCount ?? null,
        protonationStateCount:protonation?.states?.length ?? 0 } }); },
    'session.loadFixture':async (args) => { chemistActionKeys(args, ['fixtureId']);
      const fixtureId = chemistActionEnum(args.fixtureId, ['trp-cage','ubiquitin'], 'fixtureId');
      const summary = fixtureId === 'trp-cage' ? await loadRosemaryProteinExample()
        : await loadPreparedProteinFixture('./openff/rosemary-ubiquitin.json');
      return chemistActionSummary({ fixture:{ fixtureId, ...structuredClone(summary) } }); },
    'session.clear':async (args) => { empty(args); clearScene();
      return chemistActionSummary({ cleared:true }); },
    'session.share':async (args) => { empty(args);
      const storyId = new URLSearchParams(location.search).get('story');
      const url = storyId && DESIGNER_STORY_LINKS[storyId]
        ? `${location.origin}/${storyId}` : location.href;
      return chemistActionSummary({ share:{ url } }); },
    'interface.setPanelOpen':async (args) => { chemistActionKeys(args, ['panelId','open']);
      if (typeof args.panelId !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(args.panelId))
        throw new Error('panelId must be a public panel ID');
      if (typeof args.open !== 'boolean') throw new Error('open must be boolean');
      const panel = document.querySelector(`#${CSS.escape(args.panelId)}`);
      if (!panel) throw new Error(`Unknown interface panel: ${args.panelId}`);
      let toggle = panel.matches('.disclosure') ? panel
        : panel.querySelector(':scope > .card-heading.disclosure');
      let body = toggle?.getAttribute('aria-controls')
        ? document.getElementById(toggle.getAttribute('aria-controls')) : null;
      if (toggle && !body && toggle.id.endsWith('-toggle'))
        body = document.getElementById(toggle.id.replace(/-toggle$/, '-body'));
      if (!toggle && args.panelId.endsWith('-body')) {
        body = panel;
        toggle = document.querySelector(`[aria-controls="${CSS.escape(args.panelId)}"]`)
          || document.getElementById(args.panelId.replace(/-body$/, '-toggle'));
      }
      if (!toggle || !body) throw new Error(`${args.panelId} is not a collapsible public panel`);
      const card = toggle.closest('.card') || panel;
      body.classList.toggle('hidden', !args.open);
      card.classList.toggle('side-card-collapsed', !args.open);
      toggle.setAttribute('aria-expanded', String(args.open));
      toggle.querySelector('.chevron')?.classList.toggle('open', args.open);
      return chemistActionSummary({ panel:{ panelId:args.panelId, open:args.open } }); },
    'interface.openProjectInfo':async (args) => { chemistActionKeys(args, ['panel']);
      const panel = chemistActionEnum(args.panel,
        ['methods','validation','credits','privacy','closed'], 'panel');
      if (panel === 'closed') projectInfoDialog.close();
      else openProjectInfoPanel(panel);
      return chemistActionSummary({ projectInfo:{ panel,
        open:panel !== 'closed' } }); },
    'interface.presentDesignerStep':async (args) => { chemistActionKeys(args,
      ['index','phase']);
      const index = Number(args.index);
      if (!Number.isInteger(index) || index < 0)
        throw new Error('index must be a non-negative integer');
      const phase = chemistActionEnum(args.phase, ['before','after','clear'], 'phase');
      return chemistActionSummary({ designerPresentation:
        presentDesignerMoveStep(index, phase) }); },
    'view.setMode':async (args) => { chemistActionKeys(args, ['mode']);
      const mode = chemistActionEnum(args.mode, ['view','build','run'], 'mode');
      if (!setMode(mode)) throw new Error(`Molarium could not enter ${mode} mode`);
      return chemistActionSummary(); },
    'view.focusComponent':async (args) => { chemistActionKeys(args,
      ['kind','ordinal','isolate']);
      const kind = chemistActionEnum(args.kind,
        ['ligand','protein','water','ion','molecule'], 'kind');
      const ordinal = Number(args.ordinal ?? 0);
      if (!Number.isInteger(ordinal) || ordinal < 0)
        throw new Error('ordinal must be a non-negative integer');
      if (args.isolate != null && typeof args.isolate !== 'boolean')
        throw new Error('isolate must be boolean');
      const component = state.structureComponents.filter((entry) => entry.kind === kind)[ordinal];
      if (!component) throw new Error(`${kind} component ${ordinal} does not exist`);
      focusStructureComponent(component.id, Boolean(args.isolate));
      return chemistActionSummary({ focusedComponent:{ kind, ordinal,
        componentId:component.id, label:component.label, isolate:Boolean(args.isolate),
        atomCount:component.atomIndices.length } }); },
    'view.focusAtoms':async (args) => { chemistActionKeys(args,
      ['atomIds','contextRadiusAngstrom','highlight','residueLabels']);
      if (!Array.isArray(args.atomIds) || args.atomIds.length > 64
        || args.atomIds.some((id) => typeof id !== 'string' || !id))
        throw new Error('atomIds must be an array of 0 to 64 persistent atom IDs');
      const atomIds = [...new Set(args.atomIds)];
      const contextRadiusAngstrom = Number(args.contextRadiusAngstrom ?? 4.5);
      if (!Number.isFinite(contextRadiusAngstrom)
        || contextRadiusAngstrom < 2 || contextRadiusAngstrom > 8)
        throw new Error('contextRadiusAngstrom must be a number from 2 to 8');
      if (args.highlight != null && typeof args.highlight !== 'boolean')
        throw new Error('highlight must be boolean');
      const residueLabels = args.residueLabels ?? [];
      if (!Array.isArray(residueLabels) || residueLabels.length > 8
        || residueLabels.some((entry) => !entry || typeof entry !== 'object'
          || Array.isArray(entry) || !Number.isInteger(Number(entry.residueIndex))
          || entry.chain != null && (typeof entry.chain !== 'string' || !entry.chain.length
            || entry.chain.length > 4)
          || entry.insertionCode != null && (typeof entry.insertionCode !== 'string'
            || entry.insertionCode.length > 2)
          || entry.label != null && (typeof entry.label !== 'string' || !entry.label.length
            || entry.label.length > 32)
          || entry.tone != null && !['gold','blue','slate'].includes(entry.tone)))
        throw new Error('residueLabels must contain 0 to 8 valid residue callouts');
      residueLabels.forEach((entry) => chemistActionKeys(entry,
        ['chain','residueIndex','insertionCode','label','tone']));
      const byId = await ensureChemistActionAtomIds();
      const missing = atomIds.filter((id) => !byId.has(id));
      if (missing.length) throw new Error(`Unknown persistent atom ID: ${missing[0]}`);
      const targets = focusStructureAtoms(atomIds, contextRadiusAngstrom,
        args.highlight !== false, residueLabels);
      return chemistActionSummary({ focusedAtoms:{ atomIds,
        atomCount:targets.length, contextRadiusAngstrom,
        highlighted:args.highlight !== false,
        residueLabels:structuredClone(residueLabels) } }); },
    'view.highlightAtoms':async (args) => { chemistActionKeys(args, ['atomIds','residueLabels']);
      if (!Array.isArray(args.atomIds) || args.atomIds.length > 64
        || args.atomIds.some((id) => typeof id !== 'string' || !id))
        throw new Error('atomIds must be an array of 0 to 64 persistent atom IDs');
      const atomIds = [...new Set(args.atomIds)];
      const residueLabels = args.residueLabels;
      if (residueLabels != null && (!Array.isArray(residueLabels) || residueLabels.length > 8
        || residueLabels.some((entry) => !entry || typeof entry !== 'object'
          || Array.isArray(entry) || !Number.isInteger(Number(entry.residueIndex))
          || entry.chain != null && (typeof entry.chain !== 'string' || !entry.chain.length
            || entry.chain.length > 4)
          || entry.insertionCode != null && (typeof entry.insertionCode !== 'string'
            || entry.insertionCode.length > 2)
          || entry.label != null && (typeof entry.label !== 'string' || !entry.label.length
            || entry.label.length > 32)
          || entry.tone != null && !['gold','blue','slate'].includes(entry.tone))))
        throw new Error('residueLabels must contain 0 to 8 valid residue callouts');
      residueLabels?.forEach((entry) => chemistActionKeys(entry,
        ['chain','residueIndex','insertionCode','label','tone']));
      const byId = await ensureChemistActionAtomIds();
      const missing = atomIds.filter((id) => !byId.has(id));
      if (missing.length) throw new Error(`Unknown persistent atom ID: ${missing[0]}`);
      const cameraBefore = JSON.stringify({ rotation:state.rotation,
        viewProjectionCenter:state.viewProjectionCenter,
        viewProjectionRadius:state.viewProjectionRadius, viewPan:state.viewPan,
        zoom:state.zoom });
      const displayBefore = JSON.stringify({ focusedAtomIds:state.focusedAtomIds,
        focusedAtomCenter:state.focusedAtomCenter,
        focusedAtomRadius:state.focusedAtomRadius,
        focusedAtomContextIds:state.focusedAtomContextIds,
        focusedAtomContextRadius:state.focusedAtomContextRadius,
        focusedComponentId:state.focusedComponentId,
        focusedResidueKey:state.focusedResidueKey,
        representation:state.representation, showHydrogens:state.showHydrogens,
        showInteractions:state.showInteractions, showPocketAtoms:state.showPocketAtoms,
        showHulls:state.showHulls,
        componentVisibility:[...state.componentVisibility.entries()] });
      const targets = setHighlightedStructureAtoms(atomIds, residueLabels);
      const cameraAfter = JSON.stringify({ rotation:state.rotation,
        viewProjectionCenter:state.viewProjectionCenter,
        viewProjectionRadius:state.viewProjectionRadius, viewPan:state.viewPan,
        zoom:state.zoom });
      const displayAfter = JSON.stringify({ focusedAtomIds:state.focusedAtomIds,
        focusedAtomCenter:state.focusedAtomCenter,
        focusedAtomRadius:state.focusedAtomRadius,
        focusedAtomContextIds:state.focusedAtomContextIds,
        focusedAtomContextRadius:state.focusedAtomContextRadius,
        focusedComponentId:state.focusedComponentId,
        focusedResidueKey:state.focusedResidueKey,
        representation:state.representation, showHydrogens:state.showHydrogens,
        showInteractions:state.showInteractions, showPocketAtoms:state.showPocketAtoms,
        showHulls:state.showHulls,
        componentVisibility:[...state.componentVisibility.entries()] });
      return chemistActionSummary({ highlightedAtoms:{ atomIds,
        atomCount:targets.length, cameraPreserved:cameraAfter === cameraBefore,
        displayContextPreserved:displayAfter === displayBefore,
        residueLabels:structuredClone(state.focusedAtomResidueLabels) } }); },
    'view.setDisplay':async (args) => {
      chemistActionKeys(args,
        ['representation','showHydrogens','showInteractions','showPocketAtoms','showHulls',
          'showVdw','showStericClashes','pocketMode','colorTheme','changeMarkers',
          'autoRotate','playing']);
      if (!Object.keys(args).length) throw new Error('At least one display option is required');
      const booleanOption = (value, label, fallback) => {
        if (value == null) return fallback;
        if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
        return value;
      };
      let representation = state.representation;
      if (args.representation != null) {
        representation = chemistActionEnum(args.representation,
          ['ball-stick','cartoon','both'], 'representation');
        const select = document.querySelector('#representation-select');
        if (select.disabled) throw new Error('Representation controls require a protein structure');
      }
      const showHydrogens = booleanOption(args.showHydrogens,
        'showHydrogens', state.showHydrogens);
      const showInteractions = booleanOption(args.showInteractions,
        'showInteractions', state.showInteractions);
      const showPocketAtoms = booleanOption(args.showPocketAtoms,
        'showPocketAtoms', state.showPocketAtoms);
      const showHulls = booleanOption(args.showHulls, 'showHulls', state.showHulls);
      const showVdw = booleanOption(args.showVdw, 'showVdw', state.vdw);
      const showStericClashes = booleanOption(args.showStericClashes,
        'showStericClashes', state.showStericClashes);
      const playing = booleanOption(args.playing, 'playing', state.playing);
      const pocketMode = args.pocketMode == null ? state.pocketAtomMode
        : chemistActionEnum(args.pocketMode, ['radius','contacts'], 'pocketMode');
      const autoRotate = args.autoRotate == null ? state.autoRotate
        : chemistActionEnum(args.autoRotate, ['none','vertical','diagonal'], 'autoRotate');
      const colorTheme = args.colorTheme == null ? state.displayColorTheme
        : chemistActionEnum(args.colorTheme,
          ['standard','design-hit','design-prediction','design-validation'], 'colorTheme');
      const changeMarkers = args.changeMarkers == null ? state.changeMarkerStyle
        : chemistActionEnum(args.changeMarkers, ['rings','halo','none'], 'changeMarkers');

      // This is one public chemist action, so apply it as one UI transaction.
      // Dispatching a separate change event for every option forced several
      // full redraws of prepared protein complexes and could stall replay.
      state.representation = representation;
      state.showHydrogens = showHydrogens;
      state.showInteractions = showInteractions;
      state.showPocketAtoms = showPocketAtoms;
      state.showHulls = showHulls;
      state.vdw = showVdw;
      state.showStericClashes = showStericClashes;
      state.pocketAtomMode = pocketMode;
      state.displayColorTheme = colorTheme;
      state.changeMarkerStyle = changeMarkers;
      state.autoRotate = autoRotate;
      state.playing = playing;
      document.querySelector('#representation-select').value = representation;
      document.querySelector('#hydrogen-toggle').checked = showHydrogens;
      document.querySelector('#interaction-toggle').checked = showInteractions;
      document.querySelector('#pocket-toggle').checked = showPocketAtoms;
      document.querySelector('#hull-toggle').checked = showHulls;
      document.querySelector('#vdw-toggle').checked = showVdw;
      document.querySelector('#steric-clash-toggle').checked = showStericClashes;
      document.querySelector('#display-theme-select').value = colorTheme;
      document.querySelector('#change-marker-select').value = changeMarkers;
      document.querySelector('#rotate-select').value = autoRotate;
      document.querySelector('#play-button').textContent = playing ? 'Pause' : 'Play';
      updateInfo();
      draw();
      return chemistActionSummary({ display:{ representation:state.representation,
        showHydrogens:state.showHydrogens, showInteractions:state.showInteractions,
        showPocketAtoms:state.showPocketAtoms, showHulls:state.showHulls,
        showVdw:state.vdw, showStericClashes:state.showStericClashes,
        visibleStericClashCount:state.visibleStericClashCount,
        pocketMode:state.pocketAtomMode, colorTheme:state.displayColorTheme,
        changeMarkers:state.changeMarkerStyle,
        autoRotate:state.autoRotate, playing:state.playing } });
    },
    'view.setComponentVisibility':async (args) => { chemistActionKeys(args,
      ['kind','ordinal','visible']);
      const kind = chemistActionEnum(args.kind,
        ['ligand','protein','water','ion','molecule'], 'kind');
      const ordinal = Number(args.ordinal ?? 0);
      if (!Number.isInteger(ordinal) || ordinal < 0)
        throw new Error('ordinal must be a non-negative integer');
      if (typeof args.visible !== 'boolean') throw new Error('visible must be boolean');
      const component = state.structureComponents.filter((entry) => entry.kind === kind)[ordinal];
      if (!component) throw new Error(`${kind} component ${ordinal} does not exist`);
      state.componentVisibility.set(component.id, args.visible);
      if (!args.visible && state.focusedComponentId === component.id) {
        state.focusedComponentId = null; state.focusedComponentCenter = null;
        state.focusedComponentRadius = null;
      }
      updateStructureComponentsUi(); updateInfo(); draw();
      return chemistActionSummary({ component:{ kind, ordinal,
        componentId:component.id, visible:args.visible } }); },
    'view.showAllComponents':async (args) => { empty(args);
      state.structureComponents.forEach((component) =>
        state.componentVisibility.set(component.id, true));
      state.focusedComponentId = null; state.focusedComponentCenter = null;
      state.focusedComponentRadius = null;
      clearFocusedAtomRegion(); state.zoom = 1; state.viewPan = { x:0, y:0 };
      updateStructureComponentsUi(); updateInfo(); draw();
      return chemistActionSummary({ visibleComponents:state.structureComponents.length }); },
    'view.reset':async (args) => { empty(args);
      state.structureComponents.forEach((component) =>
        state.componentVisibility.set(component.id, component.kind !== 'water'));
      state.focusedComponentId = null; state.focusedComponentCenter = null;
      state.focusedComponentRadius = null;
      state.focusedResidueKey = null; state.focusedResidueRadius = null;
      clearFocusedAtomRegion(); state.viewProjectionCenter = null;
      state.viewProjectionRadius = null; state.rotation = defaultViewRotation();
      state.zoom = 1; state.viewPan = { x:0, y:0 };
      updateResidueFollowChip(); updateStructureComponentsUi(); updateInfo(); draw();
      return chemistActionSummary({ viewReset:true }); },
    'view.focusResidue':async (args) => { chemistActionKeys(args,
      ['chain','residueIndex','insertionCode','clear']);
      if (args.clear != null && typeof args.clear !== 'boolean')
        throw new Error('clear must be boolean');
      if (args.clear) {
        state.focusedResidueKey = null; state.focusedResidueRadius = null;
        updateResidueFollowChip(); draw();
        return chemistActionSummary({ focusedResidue:null });
      }
      if (typeof args.chain !== 'string' || !args.chain.length || args.chain.length > 4)
        throw new Error('chain must be a chain identifier');
      const residueIndex = Number(args.residueIndex);
      if (!Number.isInteger(residueIndex)) throw new Error('residueIndex must be an integer');
      if (args.insertionCode != null && (typeof args.insertionCode !== 'string'
        || args.insertionCode.length > 2)) throw new Error('insertionCode must be at most two characters');
      const atomIndex = state.molecule?.atoms.findIndex((atom) =>
        String(atom.chain || '') === args.chain && Number(atom.residueIndex) === residueIndex
        && String(atom.insertionCode || '') === String(args.insertionCode || '')) ?? -1;
      if (atomIndex < 0) throw new Error(`Residue ${args.chain}${residueIndex}${args.insertionCode || ''} does not exist`);
      // setFocusedResidue toggles an already focused residue, so clear first to
      // make this public setter idempotent.
      state.focusedResidueKey = null; state.focusedResidueRadius = null;
      setFocusedResidue(atomIndex);
      return chemistActionSummary({ focusedResidue:{ chain:args.chain,
        residueIndex, insertionCode:args.insertionCode || '' } }); },
    'view.clearFocus':async (args) => { chemistActionKeys(args, ['kind']);
      const kind = chemistActionEnum(args.kind,
        ['atoms','residue','component','all'], 'kind');
      if (kind === 'atoms' || kind === 'all') clearFocusedAtomRegion();
      if (kind === 'residue' || kind === 'all') {
        state.focusedResidueKey = null; state.focusedResidueRadius = null;
      }
      if (kind === 'component' || kind === 'all') {
        state.focusedComponentId = null; state.focusedComponentCenter = null;
        state.focusedComponentRadius = null;
      }
      updateResidueFollowChip(); updateChangedRegionChip();
      updateStructureComponentsUi(); updateInfo(); draw();
      return chemistActionSummary({ clearedFocus:kind }); },
    'view.setCamera':async (args) => { chemistActionKeys(args, ['rotation','pan','zoom']);
      if (!Object.keys(args).length) throw new Error('At least one camera property is required');
      const finiteObject = (value, keys, label) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error(`${label} must be an object`);
        chemistActionKeys(value, keys);
        const result = Object.fromEntries(keys.map((key) => [key, Number(value[key])]));
        if (Object.values(result).some((entry) => !Number.isFinite(entry)))
          throw new Error(`${label} values must be finite numbers`);
        return result;
      };
      if (args.rotation != null) state.rotation = normaliseQuaternion(
        finiteObject(args.rotation, ['x','y','z','w'], 'rotation'));
      if (args.pan != null) {
        const pan = finiteObject(args.pan, ['x','y'], 'pan');
        if (Math.abs(pan.x) > 5000 || Math.abs(pan.y) > 5000)
          throw new Error('pan values must be between -5000 and 5000');
        state.viewPan = pan;
      }
      if (args.zoom != null) {
        const zoom = Number(args.zoom);
        if (!Number.isFinite(zoom) || zoom < .45 || zoom > 2.6)
          throw new Error('zoom must be between 0.45 and 2.6');
        state.zoom = zoom;
      }
      draw();
      return chemistActionSummary({ camera:{ rotation:structuredClone(state.rotation),
        pan:structuredClone(state.viewPan), zoom:state.zoom } }); },
    'build.setTool':async (args) => { chemistActionKeys(args, ['tool']);
      const tool = chemistActionEnum(args.tool, ['add','select','move'], 'tool');
      if (state.mode !== 'build') throw new Error('Enter Design mode before choosing a design tool.');
      const internalTool = tool === 'move' ? 'manipulate' : tool;
      const button = document.querySelector(`#build-tool-tabs [data-tool="${internalTool}"]`);
      if (!button) throw new Error(`The ${tool} tool is unavailable`);
      state.buildTool = internalTool;
      document.querySelectorAll('#build-tool-tabs [data-tool]').forEach((item) =>
        item.classList.toggle('selected', item === button));
      canvas.classList.toggle('build-cursor', state.buildTool === 'add');
      updateBuildStatus(); draw();
      return chemistActionSummary({ buildTool:tool }); },
    'protein.prepare':async (args) => { chemistActionKeys(args,
      ['pH','histidine','repairMissingHeavy','ligandPolicy','waterPolicy','gapPolicy']);
      const options = normalizePdbPreparationOptions(args);
      document.querySelector('#preparation-ph').value = options.pH.toFixed(1);
      document.querySelector('#preparation-histidine').value = options.histidine;
      document.querySelector('#preparation-repair-heavy').checked = options.repairMissingHeavy;
      document.querySelector('#preparation-ligands').value = options.ligandPolicy;
      document.querySelector('#preparation-waters').value = options.waterPolicy;
      document.querySelector('#preparation-gaps').value = options.gapPolicy;
      state.pdbPreparationPreview = null;
      const localLigandDefinitions = state.designRoute?.hit?.ligandDefinition
        ? { [state.designRoute.hit.ligand]:structuredClone(
          state.designRoute.hit.ligandDefinition) } : null;
      const result = await prepareCurrentPdb(options, localLigandDefinitions);
      if (!result) throw new Error('Protein preparation did not complete');
      return chemistActionSummary({ preparation:{ atoms:result.atoms, bonds:result.bonds,
        hydrogensAdded:result.hydrogensAdded, heavyAtomsAdded:result.heavyAtomsAdded,
        ligandsPrepared:result.ligandsPrepared, forcefield:result.forcefield,
        chargeModel:result.chargeModel,
        parameterCounts:structuredClone(result.parameterCounts) } }); },
    'protein.parameterize':async (args) => { empty(args);
      if (!state.molecule?.atoms?.length) throw new Error('Load a molecular complex first');
      const before = state.molecule.atoms.map((atom) => [atom.x, atom.y, atom.z]);
      const parameters = await runOpenMMJob('parameters', state.molecule, () => {});
      state.molecule.parameterization = {
        forcefield:parameters.forcefield, chargeModel:parameters.chargeModel,
        sourceSha256:parameters.sourceSha256, system:parameters.system,
        labels:parameters.labels,
      };
      state.molecule.preparation = { ...(state.molecule.preparation || {}),
        status:'parameterized-experimental', parameterized:true };
      const maximumCoordinateDisplacement = Math.max(...state.molecule.atoms.map((atom, index) =>
        Math.hypot(atom.x - before[index][0], atom.y - before[index][1], atom.z - before[index][2])));
      updateOptimizerControls(); updateDockingUi(); updateInfo();
      return chemistActionSummary({ parameterization:{
        forcefield:parameters.forcefield, chargeModel:parameters.chargeModel,
        sourceSha256:parameters.sourceSha256,
        parameterCounts:structuredClone(parameters.parameterCounts),
        maximumCoordinateDisplacementAngstrom:maximumCoordinateDisplacement,
      } }); },
    'protein.predict':async (args) => { chemistActionKeys(args, ['sequence','msaEndpoint']);
      if (typeof args.sequence !== 'string' || !args.sequence.trim())
        throw new Error('sequence must be a non-empty amino-acid sequence or FASTA');
      if (args.sequence.length > 20000) throw new Error('sequence input is too long');
      if (typeof args.msaEndpoint !== 'string' || !args.msaEndpoint.trim())
        throw new Error('msaEndpoint must be an HTTPS endpoint');
      let endpoint;
      try { endpoint = new URL(args.msaEndpoint); }
      catch { throw new Error('msaEndpoint must be a valid HTTPS URL'); }
      if (endpoint.protocol !== 'https:') throw new Error('msaEndpoint must use HTTPS');
      document.querySelector('#protein-sequence').value = args.sequence;
      document.querySelector('#msa-endpoint').value = endpoint.href.replace(/\/$/, '');
      const result = await runProteinFold({ rethrow:true });
      return chemistActionSummary({ prediction:result }); },
    'protein.cancelPrediction':async (args) => { empty(args);
      const active = Boolean(state.foldAbortController);
      state.foldAbortController?.abort();
      return chemistActionSummary({ predictionCancellation:{ requested:active } }); },
    'ligand.installRegisteredGraph':async (args) => { chemistActionKeys(args,
      ['locator','graphSha256','definition']);
      if (!state.molecule?.atoms?.length)
        throw new Error('Load a coordinate-bearing molecule before installing a ligand graph');
      if (!args.locator || typeof args.locator !== 'object' || Array.isArray(args.locator))
        throw new Error('locator must be an object');
      chemistActionKeys(args.locator,
        ['residueName','chain','residueIndex','insertionCode']);
      const locator = {
        residueName:String(args.locator.residueName || '').trim().toUpperCase(),
        chain:String(args.locator.chain || ''), residueIndex:Number(args.locator.residueIndex),
        insertionCode:String(args.locator.insertionCode || ''),
      };
      if (!locator.residueName || !locator.chain || !Number.isInteger(locator.residueIndex))
        throw new Error('locator requires residueName, chain, and integer residueIndex');
      if (typeof args.graphSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(args.graphSha256))
        throw new Error('graphSha256 must be a lowercase SHA-256 digest');
      if (!args.definition || typeof args.definition !== 'object'
        || Array.isArray(args.definition)) throw new Error('definition must be an object');
      const serializedGraph = serializeRegisteredLigandDefinition(args.definition);
      const actualGraphSha256 = await sha256Hex(new TextEncoder().encode(serializedGraph));
      if (actualGraphSha256 !== args.graphSha256
        || args.definition.graphSha256 != null
          && args.definition.graphSha256 !== args.graphSha256)
        throw new Error('Registered ligand graph hash mismatch');
      await ensureChemistActionAtomIds();
      const inputStateSha256 = await molecularStateSha256(state.molecule);
      const installed = applyRegisteredLigandDefinition(state.molecule, {
        residueName:locator.residueName, locator, definition:args.definition,
      });
      if (installed.coordinateMaximumDisplacement !== 0)
        throw new Error('Registered ligand graph installation moved coordinate-bearing atoms');
      installed.molecule.source = { ...(installed.molecule.source || {}),
        registeredLigandGraph:{
          ...(installed.molecule.source?.registeredLigandGraph || {}),
          graphSha256:actualGraphSha256,
          definition:structuredClone(args.definition),
        } };
      delete installed.molecule.parameterization;
      if (installed.molecule.preparation) installed.molecule.preparation = {
        ...installed.molecule.preparation, status:'topology-updated', parameterized:false,
      };
      pushBuildHistory();
      loadMolecule(installed.molecule, false); updateHistoryButtons();
      const outputStateSha256 = await molecularStateSha256(state.molecule);
      return chemistActionSummary({ registeredLigandGraph:{ locator:installed.locator,
        definitionId:String(args.definition.id || locator.residueName),
        graphSha256:actualGraphSha256, atomCount:installed.atomCount,
        heavyAtomCount:installed.heavyAtomCount, bondCount:installed.bondCount,
        connected:installed.connected,
        coordinateMaximumDisplacementAngstrom:installed.coordinateMaximumDisplacement,
        stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
        inputStateSha256, outputStateSha256,
      } }); },
    'ligand.enumerateProtonation':async (args) => { chemistActionKeys(args,
      ['pH','smiles','pHSpread','precision','maximumStates']);
      const pH = Number(args.pH ?? 7.4), pHSpread = Number(args.pHSpread ?? .5);
      const precision = Number(args.precision ?? 1);
      const maximumStates = Number(args.maximumStates ?? 16);
      if (!Number.isFinite(pH) || pH < 0 || pH > 14)
        throw new Error('pH must be between 0 and 14');
      if (!Number.isFinite(pHSpread) || pHSpread < 0 || pHSpread > 7)
        throw new Error('pHSpread must be between 0 and 7');
      if (!Number.isFinite(precision) || precision <= 0 || precision > 10)
        throw new Error('precision must be greater than 0 and at most 10');
      if (!Number.isInteger(maximumStates) || maximumStates < 1 || maximumStates > 64)
        throw new Error('maximumStates must be an integer from 1 to 64');
      if (args.smiles != null && (typeof args.smiles !== 'string' || !args.smiles.trim()))
        throw new Error('smiles must be a non-empty string');
      const result = await enumerateLigandProtonation(args.smiles, {
        ph:pH, pHSpread, precision, maxStates:maximumStates });
      if (!result) throw new Error('Protonation enumeration was superseded');
      return chemistActionSummary({ protonation:{ targetPh:result.targetPh,
        stateCount:result.states.length, variantsTruncated:Boolean(result.variantsTruncated),
        sitesTruncated:Boolean(result.sitesTruncated) } }); },
    'ligand.applyProtonation':async (args) => { chemistActionKeys(args, ['index']);
      const index = Number(args.index);
      if (!Number.isInteger(index) || index < 0
        || index >= (state.ligandProtonation?.states?.length || 0))
        throw new Error('index must identify an enumerated protonation state');
      const select = document.querySelector('#ligand-protonation-state');
      select.value = String(index); updateLigandProtonationMeta();
      const embedded = await applySelectedLigandProtonation();
      return chemistActionSummary({ protonation:{ index,
        selected:structuredClone(state.molecule.source?.protonation || null),
        forcefield:embedded.result?.forcefield || null } }); },
    'geometry.setInternalCoordinate':async (args) => { chemistActionKeys(args,
      ['atomIds','value','moveConnected']);
      if (state.mode !== 'build')
        throw new Error('Enter Design mode before changing internal coordinates');
      if (!Array.isArray(args.atomIds) || args.atomIds.length < 2 || args.atomIds.length > 4
        || args.atomIds.some((id) => typeof id !== 'string' || !id)
        || new Set(args.atomIds).size !== args.atomIds.length)
        throw new Error('atomIds must contain 2 to 4 distinct persistent atom IDs');
      const value = Number(args.value);
      if (!Number.isFinite(value)) throw new Error('value must be a finite number');
      if (args.moveConnected != null && typeof args.moveConnected !== 'boolean')
        throw new Error('moveConnected must be boolean');
      const byId = await ensureChemistActionAtomIds();
      const indices = args.atomIds.map((id) => {
        if (!byId.has(id)) throw new Error(`Unknown persistent atom ID: ${id}`);
        return byId.get(id);
      });
      state.selectedAtoms = indices; state.selectedAtom = indices.at(-1);
      document.querySelector('#move-connected').checked = args.moveConnected !== false;
      updateGeometryControl();
      const before = geometrySelection();
      if (!before || before.error) throw new Error(before?.error || 'Invalid geometry selection');
      beginGeometryEdit();
      try {
        if (!applyGeometryValue(value)) throw new Error('Internal-coordinate edit failed');
      } finally { finishGeometryEdit(); }
      const after = geometrySelection();
      return chemistActionSummary({ internalCoordinate:{ kind:after.kind,
        value:after.value, unit:after.unit, moveConnected:args.moveConnected !== false } }); },
    'geometry.translateAtoms':async (args) => { chemistActionKeys(args,
      ['atomIds','deltaAngstrom']);
      if (state.mode !== 'build') throw new Error('Enter Design mode before moving atoms');
      if (!Array.isArray(args.atomIds) || !args.atomIds.length || args.atomIds.length > 256
        || args.atomIds.some((id) => typeof id !== 'string' || !id))
        throw new Error('atomIds must contain 1 to 256 persistent atom IDs');
      if (!args.deltaAngstrom || typeof args.deltaAngstrom !== 'object'
        || Array.isArray(args.deltaAngstrom))
        throw new Error('deltaAngstrom must be an {x,y,z} object');
      chemistActionKeys(args.deltaAngstrom, ['x','y','z']);
      const delta = Object.fromEntries(['x','y','z'].map((axis) =>
        [axis, Number(args.deltaAngstrom[axis])]));
      if (Object.values(delta).some((value) => !Number.isFinite(value)
        || value < -20 || value > 20))
        throw new Error('deltaAngstrom components must be between -20 and 20');
      const byId = await ensureChemistActionAtomIds();
      const indices = [...new Set(args.atomIds)].map((id) => {
        if (!byId.has(id)) throw new Error(`Unknown persistent atom ID: ${id}`);
        return byId.get(id);
      });
      pushBuildHistory(); clearCalculationResult();
      indices.forEach((index) => {
        const atom = state.molecule.atoms[index];
        atom.x += delta.x; atom.y += delta.y; atom.z += delta.z;
      });
      updateStoredBondDistances(); updateInfo(); updateGeometryControl();
      updateHistoryButtons(); draw();
      return chemistActionSummary({ translation:{ atomCount:indices.length,
        deltaAngstrom:delta } }); },
    'fragment.stage':async (args) => { chemistActionKeys(args,
      ['fragmentId','smiles','name','attachmentIndex']);
      if (state.mode !== 'build') throw new Error('Enter Design mode before staging a fragment');
      if ((args.fragmentId == null) === (args.smiles == null))
        throw new Error('Provide exactly one of fragmentId or smiles');
      let fragment;
      if (args.fragmentId != null) {
        if (typeof args.fragmentId !== 'string' || !args.fragmentId)
          throw new Error('fragmentId must be a built-in fragment ID');
        fragment = FRAGMENTS.find((entry) => entry.id === args.fragmentId);
        if (!fragment) throw new Error(`Unknown fragment: ${args.fragmentId}`);
      } else {
        if (typeof args.smiles !== 'string' || !args.smiles.trim()
          || args.smiles.length > 1000) throw new Error('smiles must be a non-empty string');
        const attachmentIndex = Number(args.attachmentIndex ?? 0);
        if (!Number.isInteger(attachmentIndex) || attachmentIndex < 0)
          throw new Error('attachmentIndex must be a non-negative integer');
        const preview = parseSMILES(args.smiles, args.name || 'Custom fragment');
        if (attachmentIndex >= preview.atoms.length)
          throw new Error('attachmentIndex does not exist in the custom fragment');
        fragment = { id:`custom-api-${Date.now()}`, label:args.smiles,
          name:String(args.name || 'Custom fragment').slice(0, 160),
          smiles:args.smiles, attach:attachmentIndex, preview };
      }
      stageFragment(fragment);
      return chemistActionSummary({ stagedFragment:{ id:fragment.id, name:fragment.name,
        smiles:fragment.smiles, attachmentIndex:fragment.attach ?? 0 } }); },
    'fragment.attach':async (args) => { chemistActionKeys(args,
      ['attachedToAtomId','positionAngstrom']);
      if (state.mode !== 'build') throw new Error('Enter Design mode before attaching a fragment');
      if (!state.stagedFragment) throw new Error('Stage a fragment before attaching it');
      if (args.attachedToAtomId == null && args.positionAngstrom == null)
        throw new Error('Provide attachedToAtomId or positionAngstrom');
      let targetIndex = null;
      if (args.attachedToAtomId != null) {
        if (typeof args.attachedToAtomId !== 'string' || !args.attachedToAtomId)
          throw new Error('attachedToAtomId must be a persistent atom ID');
        const byId = await ensureChemistActionAtomIds();
        if (!byId.has(args.attachedToAtomId))
          throw new Error(`Unknown persistent atom ID: ${args.attachedToAtomId}`);
        targetIndex = byId.get(args.attachedToAtomId);
      }
      let point = null;
      if (args.positionAngstrom != null) {
        if (!args.positionAngstrom || typeof args.positionAngstrom !== 'object'
          || Array.isArray(args.positionAngstrom))
          throw new Error('positionAngstrom must be an {x,y,z} object');
        chemistActionKeys(args.positionAngstrom, ['x','y','z']);
        point = Object.fromEntries(['x','y','z'].map((axis) =>
          [axis, Number(args.positionAngstrom[axis])]));
        if (Object.values(point).some((value) => !Number.isFinite(value)
          || Math.abs(value) > 100000))
          throw new Error('positionAngstrom values must be finite and bounded');
      }
      pushBuildHistory(); clearCalculationResult();
      const beforeIds = new Set(state.molecule?.atoms?.map((atom) => atom.designAtomId) || []);
      try {
        state.molecule = mergeFragmentIntoMolecule(state.molecule,
          state.stagedFragment, targetIndex, point);
      } catch (error) {
        if (state.buildHistory.length) state.buildHistory.pop();
        updateHistoryButtons(); throw error;
      }
      refreshStructureComponents(); state.selectedAtoms = []; state.selectedAtom = null;
      await ensureChemistActionAtomIds();
      const addedAtomIds = state.molecule.atoms.map((atom) => atom.designAtomId)
        .filter((id) => id && !beforeIds.has(id));
      updateGeometryControl(); updateInfo(); updateHistoryButtons(); draw();
      const changedAtomIndices = state.molecule.atoms.flatMap((atom, index) =>
        addedAtomIds.includes(atom.designAtomId) || index === targetIndex ? [index] : []);
      scheduleSmallMoleculePolish(changedAtomIndices);
      return chemistActionSummary({ attachedFragment:{ id:state.stagedFragment.id,
        attachedToAtomId:args.attachedToAtomId || null, addedAtomIds } }); },
    'selection.replace':async (args) => { chemistActionKeys(args, ['atomIds']);
      if (!Array.isArray(args.atomIds) || !args.atomIds.length || args.atomIds.length > 256
        || args.atomIds.some((id) => typeof id !== 'string' || !id))
        throw new Error('atomIds must contain 1 to 256 persistent atom IDs');
      if (new Set(args.atomIds).size !== args.atomIds.length)
        throw new Error('atomIds must not contain duplicates');
      const byId = await ensureChemistActionAtomIds();
      const indices = args.atomIds.map((id) => {
        if (!byId.has(id)) throw new Error(`Unknown persistent atom ID: ${id}`);
        return byId.get(id);
      });
      const prior = [...state.selectedAtoms];
      state.selectedAtoms = []; state.selectedAtom = null;
      try {
        indices.forEach((index, ordinal) => {
          selectGeometryAtom(index);
          if (state.selectedAtoms[ordinal] !== index)
            throw new Error(`Atom ${args.atomIds[ordinal]} is not bonded to the connected selection path`);
        });
      } catch (error) {
        state.selectedAtoms = prior.filter((index) => state.molecule.atoms[index]);
        state.selectedAtom = state.selectedAtoms.at(-1) ?? null;
        updateGeometryControl(); updateBuildStatus(); updateDockingUi(); draw();
        throw error;
      }
      return chemistActionSummary(); },
    'selection.clear':async (args) => { empty(args); state.selectedAtoms = [];
      state.selectedAtom = null; updateGeometryControl(); updateBuildStatus(); updateDockingUi();
      draw(); schedule2DDepiction(0); return chemistActionSummary(); },
    'chemistry.setEditPolicy':async (args) => { chemistActionKeys(args, ['mode']);
      if (state.chemistryTransaction)
        throw new Error('Finish or discard pending chemistry before changing the edit policy.');
      const mode = chemistActionEnum(args.mode, ['staged','immediate-refine'], 'mode');
      state.chemistryEditPolicy = mode;
      updateChemistryEditor();
      return chemistActionSummary({ chemistryEditPolicy:mode }); },
    'chemistry.setAtom':async (args) => { chemistActionKeys(args,
      ['atomId','element','formalCharge']);
      const target = await chemistryTargetAtomIds(args, 1);
      return summarizeMutation(() => applySelectedAtomChemistry(args.element,
        args.formalCharge ?? 0), target); },
    'chemistry.setBond':async (args) => { chemistActionKeys(args, ['atomIds','order']);
      const target = await chemistryTargetAtomIds(args, 2);
      return summarizeMutation(() => applySelectedBondChemistry(args.order), target); },
    'chemistry.addAtom':async (args) => { chemistActionKeys(args,
      ['attachedToAtomId','positionAngstrom','element']);
      if (state.mode !== 'build') throw new Error('Enter Design mode before adding an atom.');
      if (!ELEMENTS[args.element])
        throw new Error('element must be a supported element symbol');
      if (args.attachedToAtomId == null) {
        if (!args.positionAngstrom || typeof args.positionAngstrom !== 'object'
          || Array.isArray(args.positionAngstrom))
          throw new Error('positionAngstrom is required when attachedToAtomId is omitted');
        chemistActionKeys(args.positionAngstrom, ['x','y','z']);
        const position = Object.fromEntries(['x','y','z'].map((axis) =>
          [axis, Number(args.positionAngstrom[axis])]));
        if (Object.values(position).some((value) => !Number.isFinite(value)
          || Math.abs(value) > 100000))
          throw new Error('positionAngstrom values must be finite and bounded');
        if (state.molecule?.atoms?.length) pushBuildHistory();
        const priorIds = new Set(state.molecule?.atoms?.map((atom) => atom.designAtomId) || []);
        state.molecule = addElementToMolecule(state.molecule, args.element, null, position);
        refreshStructureComponents(); state.selectedAtoms = []; state.selectedAtom = null;
        document.querySelector('#viewer-hint').classList.remove('visible');
        await ensureChemistActionAtomIds();
        const addedAtomIds = state.molecule.atoms.map((atom) => atom.designAtomId)
          .filter((id) => id && !priorIds.has(id));
        updateGeometryControl(); updateInfo(); updateHistoryButtons(); draw();
        scheduleSmallMoleculePolish(state.molecule.atoms.flatMap((atom, index) =>
          addedAtomIds.includes(atom.designAtomId) ? [index] : []));
        return chemistActionSummary({ addedAtomId:addedAtomIds.find((id) =>
          state.molecule.atoms.find((atom) => atom.designAtomId === id)?.element !== 'H') || null,
        addedAtomIds, disconnected:true });
      }
      if (typeof args.attachedToAtomId !== 'string' || !args.attachedToAtomId)
        throw new Error('attachedToAtomId must be a persistent atom ID');
      if (args.element === 'H')
        throw new Error('Use chemistry.addHydrogen to attach a hydrogen atom');
      if (args.positionAngstrom != null)
        throw new Error('positionAngstrom is only accepted for a disconnected atom');
      const byId = await ensureChemistActionAtomIds();
      if (!byId.has(args.attachedToAtomId))
        throw new Error(`Unknown persistent atom ID: ${args.attachedToAtomId}`);
      const before = new Set(state.molecule.atoms.map((atom) => atom.designAtomId));
      const result = await addDepictionAtom(byId.get(args.attachedToAtomId), args.element);
      const addedAtomIds = state.molecule.atoms.map((atom) => atom.designAtomId)
        .filter((id) => id && !before.has(id));
      const addedHeavyAtomId = addedAtomIds.find((id) =>
        state.molecule.atoms.find((atom) => atom.designAtomId === id)?.element !== 'H') || null;
      return chemistActionSummary({ addedAtomId:addedHeavyAtomId, addedAtomIds,
        validation:structuredClone(result?.validation || null) }); },
    'chemistry.createBond':async (args) => { chemistActionKeys(args, ['atomIds','order']);
      if (state.mode !== 'build') throw new Error('Enter Design mode before creating a bond.');
      if (!Array.isArray(args.atomIds) || args.atomIds.length !== 2
        || args.atomIds.some((id) => typeof id !== 'string' || !id)
        || args.atomIds[0] === args.atomIds[1])
        throw new Error('atomIds must contain two different persistent atom IDs');
      const byId = await ensureChemistActionAtomIds();
      const indices = args.atomIds.map((id) => {
        if (!byId.has(id)) throw new Error(`Unknown persistent atom ID: ${id}`);
        return byId.get(id);
      });
      setDepictionSelection(indices);
      return summarizeMutation(() => applySelectedBondChemistry(args.order)); },
    'chemistry.deleteAtom':async (args) => { chemistActionKeys(args, ['atomId']);
      const target = await chemistryTargetAtomIds(args, 1);
      return summarizeMutation(() => deleteSelectedAtomChemistry(), target); },
    'chemistry.deleteBond':async (args) => { chemistActionKeys(args, ['atomIds']);
      const target = await chemistryTargetAtomIds(args, 2);
      return summarizeMutation(() => deleteSelectedBondChemistry(), target); },
    'chemistry.addHydrogen':async (args) => { chemistActionKeys(args, ['atomId']);
      const target = await chemistryTargetAtomIds(args, 1);
      return summarizeMutation(() => addSelectedHydrogenChemistry(), target); },
    'chemistry.removeHydrogen':async (args) => { chemistActionKeys(args, ['atomId']);
      const target = await chemistryTargetAtomIds(args, 1);
      return summarizeMutation(() => removeSelectedHydrogenChemistry(), target); },
    'chemistry.finish':async (args) => { empty(args);
      if (!state.chemistryTransaction) throw new Error('There are no pending chemistry changes to finish.');
      const result = await finishChemistryTransaction();
      if (!result?.validation?.valid || result.pending)
        throw new Error(result?.validation?.error
          || state.chemistryTransaction?.validationError
          || 'The complete chemical state is not valid yet.');
      return chemistActionSummary({ validation:structuredClone(result.validation),
        polish:result.polish ? { cleanupMode:result.polish.cleanupMode || null,
          initialEnergy:result.polish.initialEnergy ?? null,
          finalEnergy:result.polish.finalEnergy ?? null } : null,
        contactFeatureRemaps:structuredClone(result.contactFeatureRemaps || []) }); },
    'chemistry.discard':async (args) => { empty(args);
      if (!discardChemistryTransaction()) throw new Error('There are no pending chemistry changes to discard.');
      return chemistActionSummary(); },
    'history.undo':async (args) => { empty(args);
      if (state.chemistryTransaction) throw new Error('Finish or discard pending chemistry before undo.');
      if (!state.buildHistory.length) throw new Error('There is no committed action to undo.');
      state.redoHistory.push(buildHistoryEntry(state.molecule));
      restoreMolecule(state.buildHistory.pop()); return chemistActionSummary(); },
    'history.redo':async (args) => { empty(args);
      if (state.chemistryTransaction) throw new Error('Finish or discard pending chemistry before redo.');
      if (!state.redoHistory.length) throw new Error('There is no committed action to redo.');
      state.buildHistory.push(buildHistoryEntry(state.molecule));
      restoreMolecule(state.redoHistory.pop()); return chemistActionSummary(); },
    'pose.captureReference':async (args) => { chemistActionKeys(args, ['mode']);
      if (state.mode !== 'build') throw new Error('Enter Design mode before capturing a reference pose.');
      const mode = chemistActionEnum(args.mode, ['propagate','selected-core'], 'mode');
      document.querySelector('#docking-mode').value = mode === 'selected-core'
        ? 'selected-core' : 'propagate'; updateDockingUi();
      const reference = await captureCurrentDockingReference();
      return chemistActionSummary({ poseReference:{ mode:reference.mode,
        coreAtomCount:reference.ligand.coreAtomIds.length,
        contactCount:reference.hydrogenBonds.length } }); },
    'pose.updateReceptorReference':async (args) => { empty(args);
      return chemistActionSummary({ receptorReference:
        await updateCurrentDockingReceptorReference() }); },
    'pose.setContact':async (args) => { chemistActionKeys(args, ['contactId','required']);
      if (typeof args.contactId !== 'string' || !args.contactId)
        throw new Error('contactId must be a captured contact ID');
      if (typeof args.required !== 'boolean') throw new Error('required must be boolean');
      const definition = state.dockingReference?.hydrogenBonds?.find((entry) => entry.id === args.contactId);
      if (!definition) throw new Error(`Unknown captured contact: ${args.contactId}`);
      const proposal = state.dockingContactRemapProposals.get(definition.id);
      if (args.required && (proposal || !dockingContactAvailable(
        effectiveDockingHydrogenBondDefinition(definition))))
        throw new Error(`Contact ${args.contactId} is not currently available; finish or reconcile the chemistry first.`);
      if (args.required) state.dockingSelectedHbondIds.add(args.contactId);
      else state.dockingSelectedHbondIds.delete(args.contactId);
      updateDockingUi(); return chemistActionSummary({ contactId:args.contactId,
        required:args.required }); },
    'pose.addContact':async (args) => { chemistActionKeys(args,
      ['ligandAtomId','receptorAtomId','ligandRole']);
      if (typeof args.ligandAtomId !== 'string' || !args.ligandAtomId
        || typeof args.receptorAtomId !== 'string' || !args.receptorAtomId)
        throw new Error('ligandAtomId and receptorAtomId must be persistent atom IDs');
      const ligandRole = chemistActionEnum(args.ligandRole ?? 'auto',
        ['auto','acceptor','donor'], 'ligandRole');
      const byId = await ensureChemistActionAtomIds();
      if (!byId.has(args.ligandAtomId)) throw new Error(`Unknown persistent atom ID: ${args.ligandAtomId}`);
      if (!byId.has(args.receptorAtomId)) throw new Error(`Unknown persistent atom ID: ${args.receptorAtomId}`);
      const definition = await addManualDockingContactByIndices(byId.get(args.ligandAtomId),
        byId.get(args.receptorAtomId), ligandRole, 'chemist-actions-two-atom-selection');
      return chemistActionSummary({ contact:{ contactId:definition.id,
        label:definition.label, required:true, origin:structuredClone(definition.origin) } }); },
    'pose.forgetContact':async (args) => { chemistActionKeys(args, ['contactId']);
      if (typeof args.contactId !== 'string' || !args.contactId)
        throw new Error('contactId must be a contact ID');
      const definition = await forgetDockingContact(args.contactId,
        'chemist-actions-forget-contact');
      return chemistActionSummary({ forgottenContact:{ contactId:definition.id,
        label:definition.label } }); },
    'pose.setEditCleanup':async (args) => { chemistActionKeys(args, ['mode']);
      const mode = chemistActionEnum(args.mode,
        ['preserve-reference','free-local'], 'mode');
      if (!state.dockingReference)
        throw new Error('Capture a reference pose before setting edit cleanup');
      document.querySelector('#docking-edit-cleanup').value = mode;
      updateDockingUi(); updateOptimizerControls();
      return chemistActionSummary({ poseEditCleanup:{ mode } }); },
    'pose.clearReference':async (args) => { empty(args);
      if (!state.dockingReference) throw new Error('There is no captured pose reference');
      clearDockingReference();
      return chemistActionSummary({ poseReferenceCleared:true }); },
    'pose.remapContact':async (args) => { chemistActionKeys(args,
      ['contactId','candidateId']);
      if (typeof args.contactId !== 'string' || !args.contactId)
        throw new Error('contactId must be a contact ID');
      if (typeof args.candidateId !== 'string' || !args.candidateId)
        throw new Error('candidateId must be a remapping candidate ID');
      const remap = await chooseDockingContactRemap(args.contactId,
        args.candidateId, 'chemist-actions-role-compatible');
      return chemistActionSummary({ contactRemap:structuredClone(remap) }); },
    'pose.refine':async (args) => { chemistActionKeys(args,
      ['searchChains','execution','featureSeedingProtocol',
        'expectedInputCoordinateSha256','expectedSelectedCoordinateSha256',
        'expectedInputStateSha256','expectedSelectedStateSha256']);
      const expectedInput = expectedCoordinateSha256(args, 'expectedInputCoordinateSha256');
      const expectedSelected = expectedCoordinateSha256(args,
        'expectedSelectedCoordinateSha256');
      const expectedInputState = expectedMolecularStateSha256(args,
        'expectedInputStateSha256');
      const expectedSelectedState = expectedMolecularStateSha256(args,
        'expectedSelectedStateSha256');
      await ensureChemistActionAtomIds();
      const inputCoordinateSha256 = await assertCurrentCoordinateSha256(expectedInput);
      const inputStateSha256 = await currentMolecularStateSha256(expectedInputState);
      const searchChains = Number(args.searchChains ?? 16);
      if (![8,16,32,64].includes(searchChains))
        throw new Error('searchChains must be 8, 16, 32, or 64');
      const execution = chemistActionEnum(args.execution ?? 'auto', ['auto','serial'], 'execution');
      const featureSeedingProtocol = chemistActionEnum(args.featureSeedingProtocol ?? 'v5',
        ['v3','v4','v5'], 'featureSeedingProtocol');
      const rollback = expectedSelected == null && expectedSelectedState == null
        ? null : captureChemistActionGuardCheckpoint();
      const select = document.querySelector('#docking-conformer-count');
      select.value = String(searchChains); updateDockingUi();
      const result = await runBrowserConstrainedDocking({
        poseSearchWorkers:execution === 'serial' ? 1 : null,
        featureSeedingProtocol,
      });
      const selected = result.run.selected;
      const selectedCoordinateSha256 = await coordinateArraySha256(selected.positions);
      const selectedStateSha256 = await dockingPoseStateSha256(result, selected);
      if ((expectedSelected != null && selectedCoordinateSha256 !== expectedSelected)
        || (expectedSelectedState != null && selectedStateSha256 !== expectedSelectedState)) {
        restoreChemistActionGuardCheckpoint(rollback);
        throw new Error(expectedSelectedState != null && selectedStateSha256 !== expectedSelectedState
          ? 'Selected refined pose does not match expectedSelectedStateSha256'
          : 'Selected refined-pose coordinates do not match expectedSelectedCoordinateSha256');
      }
      return chemistActionSummary({ refinement:{ candidates:result.run.candidates.length,
        feasible:result.run.feasibleCount, selectedRank:selected.rank,
        stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
        inputCoordinateSha256, selectedCoordinateSha256,
        inputStateSha256, selectedStateSha256,
        coverageComplete:result.featureGuidedSeeding?.coverage?.allRequiredStrataCovered ?? true,
        coverage:structuredClone(result.featureGuidedSeeding?.coverage || {
          policy:'not-applicable', allRequiredStrataCovered:true,
          requiredStrataCount:0, coveredRequiredStrataCount:0 }),
        poseSearchExecution:structuredClone(result.poseSearchExecution || null),
        selectedFeasible:selected.feasible,
        selectedScoreKcalMol:selected.totalScoreKcalMol,
        selectedPhysicalKcalMol:selected.physicalEnergyKcalMol,
        selectedConstraintPenaltyKcalMol:selected.constraintPenaltyKcalMol,
        selectedCore:structuredClone(selected.core || null),
        selectedPhysicalComponents:selected.physicalDetails ? {
          lennardJonesKcalMol:selected.physicalDetails.lennardJonesKcalMol,
          coulombKcalMol:selected.physicalDetails.coulombKcalMol,
          ligandStrainKcalMol:selected.physicalDetails.ligandStrainKcalMol,
          interactionKcalMol:selected.physicalDetails.interactionKcalMol,
          interactionReferenceKcalMol:selected.physicalDetails.interactionReferenceKcalMol,
          relativeInteractionKcalMol:selected.physicalDetails.relativeInteractionKcalMol,
          stericClashes:selected.physicalDetails.stericClashes,
        } : null,
        selectedChemicalValidity:structuredClone(selected.physicalDetails?.chemicalValidity || null),
        selectedHydrogenBonds:structuredClone(selected.hydrogenBonds),
        selectedSpatialFeatures:structuredClone(selected.spatialFeatures || []),
        requiredSpatialFeatureCount:(selected.spatialFeatures || [])
          .filter((feature) => feature.required === true).length,
        featureGuidedSeeding:result.featureGuidedSeeding ? {
          method:result.featureGuidedSeeding.method,
          requestedCount:result.featureGuidedSeeding.requestedCount,
          uniqueSeedCount:result.featureGuidedSeeding.uniqueSeedCount,
          targetVariantCount:result.featureGuidedSeeding.targetVariantCount,
          spatialFeatureMapCount:result.featureGuidedSeeding.spatialFeatureMapCount,
          untargetedRotorCount:result.featureGuidedSeeding.untargetedRotorCount,
          affectedRotorCount:result.featureGuidedSeeding.affectedRotorCount,
          releasedCoreAtomIndices:structuredClone(
            result.featureGuidedSeeding.releasedCoreAtomIndices),
          affectedRotors:structuredClone(result.featureGuidedSeeding.affectedRotors),
          editRegionAnglesDegrees:result.featureGuidedSeeding.editRegionAnglesDegrees,
          coverage:structuredClone(result.featureGuidedSeeding.coverage),
          selectedSeedAudit:structuredClone(result.featureGuidedSeeding.seedAudits
            .find((entry) => entry.conformerIndex === selected.conformerIndex) || null),
        } : null } }); },
    'pose.apply':async (args) => { chemistActionKeys(args,
      ['index','allowInfeasible','expectedInputCoordinateSha256',
        'expectedSelectedCoordinateSha256','expectedOutputCoordinateSha256',
        'expectedInputStateSha256','expectedSelectedStateSha256','expectedOutputStateSha256']);
      const expectedInput = expectedCoordinateSha256(args, 'expectedInputCoordinateSha256');
      const expectedSelected = expectedCoordinateSha256(args,
        'expectedSelectedCoordinateSha256');
      const expectedOutput = expectedCoordinateSha256(args, 'expectedOutputCoordinateSha256');
      const expectedInputState = expectedMolecularStateSha256(args, 'expectedInputStateSha256');
      const expectedSelectedState = expectedMolecularStateSha256(args,
        'expectedSelectedStateSha256');
      const expectedOutputState = expectedMolecularStateSha256(args, 'expectedOutputStateSha256');
      const index = Number(args.index ?? 0);
      if (!Number.isInteger(index) || index < 0) throw new Error('index must be a non-negative integer');
      if (args.allowInfeasible != null && typeof args.allowInfeasible !== 'boolean')
        throw new Error('allowInfeasible must be a boolean');
      const selectedPose = state.dockingResult?.run?.candidates?.[index];
      if (!selectedPose) throw new Error(`Refined pose ${index} does not exist`);
      const allowInfeasible = args.allowInfeasible === true;
      if (!selectedPose.feasible && !allowInfeasible)
        throw new Error('The selected docking pose is infeasible; pass allowInfeasible:true to apply it explicitly.');
      await ensureChemistActionAtomIds();
      const inputCoordinateSha256 = await assertCurrentCoordinateSha256(expectedInput);
      const inputStateSha256 = await currentMolecularStateSha256(expectedInputState);
      const selectedCoordinateSha256 = await coordinateArraySha256(selectedPose.positions);
      if (expectedSelected != null && selectedCoordinateSha256 !== expectedSelected)
        throw new Error('Selected refined-pose coordinates do not match expectedSelectedCoordinateSha256');
      const selectedStateSha256 = await dockingPoseStateSha256(state.dockingResult, selectedPose);
      if (expectedSelectedState != null && selectedStateSha256 !== expectedSelectedState)
        throw new Error('Selected refined pose does not match expectedSelectedStateSha256');
      const before = chemistActionCoordinateSnapshot();
      const rollback = expectedOutput == null && expectedOutputState == null
        ? null : captureChemistActionGuardCheckpoint();
      state.dockingPoseIndex = index;
      const pose = await applySelectedDockingPose({ allowInfeasible });
      const outputCoordinateSha256 = await moleculeCoordinateSha256();
      const outputStateSha256 = await molecularStateSha256(state.molecule);
      if ((expectedOutput != null && outputCoordinateSha256 !== expectedOutput)
        || (expectedOutputState != null && outputStateSha256 !== expectedOutputState)) {
        restoreChemistActionGuardCheckpoint(rollback);
        throw new Error(expectedOutputState != null && outputStateSha256 !== expectedOutputState
          ? 'Applied refined pose does not match expectedOutputStateSha256'
          : 'Applied refined-pose coordinates do not match expectedOutputCoordinateSha256');
      }
      const coordinateChanges = chemistActionCoordinateChanges(before);
      return chemistActionSummary({ appliedPose:{ index, rank:pose.rank,
        feasible:pose.feasible, infeasibleOverride:!pose.feasible && allowInfeasible,
        scoreKcalMol:pose.totalScoreKcalMol,
        stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
        inputCoordinateSha256, selectedCoordinateSha256, outputCoordinateSha256,
        inputStateSha256, selectedStateSha256, outputStateSha256,
        ...coordinateChanges } }); },
    'pose.enumerateSidechainRotamers':async (args) => { chemistActionKeys(args,
      ['receptorAtomId','maximumCandidates']);
      if (typeof args.receptorAtomId !== 'string' || !args.receptorAtomId)
        throw new Error('receptorAtomId must be a persistent receptor atom ID');
      const maximumCandidates = Number(args.maximumCandidates ?? 32);
      if (!Number.isInteger(maximumCandidates) || maximumCandidates < 1 || maximumCandidates > 64)
        throw new Error('maximumCandidates must be an integer from 1 to 64');
      const byId = await ensureChemistActionAtomIds();
      const residueAtomIndex = byId.get(args.receptorAtomId);
      if (!Number.isInteger(residueAtomIndex))
        throw new Error(`Unknown persistent atom ID: ${args.receptorAtomId}`);
      const sidechainRotamers = await enumerateCurrentSidechainRotamers(
        residueAtomIndex, maximumCandidates);
      return chemistActionSummary({ sidechainRotamers }); },
    'pose.applySidechainRotamer':async (args) => { chemistActionKeys(args,
      ['index','chiDegrees','coordinateSha256','expectedInputCoordinateSha256',
        'expectedSelectedCoordinateSha256']);
      const selectorKeys = ['index','chiDegrees','coordinateSha256']
        .filter((key) => Object.hasOwn(args, key));
      if (selectorKeys.length !== 1)
        throw new Error('Specify exactly one side-chain rotamer selector: index, chiDegrees, or coordinateSha256');
      const selectorKey = selectorKeys[0];
      if (selectorKey === 'index' && (!Number.isInteger(args.index) || args.index < 0))
        throw new Error('index must be a non-negative integer');
      const selector = { [selectorKey]:structuredClone(args[selectorKey]) };
      const digestKeys = ['expectedInputCoordinateSha256','expectedSelectedCoordinateSha256'];
      for (const key of digestKeys) if (Object.hasOwn(args, key)
        && (typeof args[key] !== 'string' || !/^[a-f0-9]{64}$/.test(args[key])))
          throw new Error(`${key} must be a lowercase SHA-256 hex digest`);
      await ensureChemistActionAtomIds();
      const before = chemistActionCoordinateSnapshot();
      const sidechainRotamer = await applyCurrentSidechainRotamer(selector, {
        expectedInputCoordinateSha256:args.expectedInputCoordinateSha256 ?? null,
        expectedSelectedCoordinateSha256:args.expectedSelectedCoordinateSha256 ?? null,
      });
      Object.assign(sidechainRotamer, chemistActionCoordinateChanges(before));
      return chemistActionSummary({ sidechainRotamer }); },
    'optimization.run':async (args) => { chemistActionKeys(args,
      ['method','expectedInputCoordinateSha256','expectedOutputCoordinateSha256',
        'expectedInputStateSha256','expectedOutputStateSha256']);
      const expectedInput = expectedCoordinateSha256(args, 'expectedInputCoordinateSha256');
      const expectedOutput = expectedCoordinateSha256(args, 'expectedOutputCoordinateSha256');
      const expectedInputState = expectedMolecularStateSha256(args, 'expectedInputStateSha256');
      const expectedOutputState = expectedMolecularStateSha256(args, 'expectedOutputStateSha256');
      const method = chemistActionEnum(args.method,
        ['ligand-rdkit','pocket-webgpu','induced-fit-webgpu','webgpu','rdkit','ani2x'], 'method');
      if (state.mode !== 'build') throw new Error('Enter Design mode before optimizing.');
      const option = document.querySelector(`#build-optimizer-select option[value="${method}"]`);
      if (!option || option.disabled) throw new Error(`Optimization method ${method} is unavailable for this molecule`);
      await ensureChemistActionAtomIds();
      const inputCoordinateSha256 = await assertCurrentCoordinateSha256(expectedInput);
      const inputStateSha256 = await currentMolecularStateSha256(expectedInputState);
      const rollback = expectedOutput == null && expectedOutputState == null
        ? null : captureChemistActionGuardCheckpoint();
      const select = document.querySelector('#build-optimizer-select');
      select.value = method; select.dataset.userSelected = 'true'; updateOptimizerControls();
      const before = chemistActionCoordinateSnapshot();
      const result = await runSelectedBuildOptimization();
      if (!result) throw new Error(`${method} optimization did not complete`);
      const outputCoordinateSha256 = await moleculeCoordinateSha256();
      const outputStateSha256 = await molecularStateSha256(state.molecule);
      if ((expectedOutput != null && outputCoordinateSha256 !== expectedOutput)
        || (expectedOutputState != null && outputStateSha256 !== expectedOutputState)) {
        restoreChemistActionGuardCheckpoint(rollback);
        throw new Error(expectedOutputState != null && outputStateSha256 !== expectedOutputState
          ? 'Optimized molecular state does not match expectedOutputStateSha256'
          : 'Optimized coordinates do not match expectedOutputCoordinateSha256');
      }
      return chemistActionSummary({ optimization:{ method,
        accepted:(method !== 'induced-fit-webgpu'
          || result.valenceSafeguard?.accepted === true
            && result.valenceSafeguard?.complete === true
            && result.valenceSafeguard?.checkedHeavyBonds > 0)
          && (result.registeredPoseRetention?.accepted ?? true),
        valenceSafeguard:structuredClone(result.valenceSafeguard || null),
        registeredPoseRetention:structuredClone(result.registeredPoseRetention || null),
        initialEnergy:result.initialEnergy ?? null, finalEnergy:result.finalEnergy ?? null,
        iterations:result.iterations ?? null, converged:result.converged ?? null,
        elapsedMs:result.elapsedMs ?? null,
        stateHashSchema:MOLECULAR_STATE_HASH_SCHEMA,
        inputCoordinateSha256, outputCoordinateSha256,
        inputStateSha256, outputStateSha256,
        ...chemistActionCoordinateChanges(before) } }); },
    'calculation.run':async (args) => { chemistActionKeys(args,
      ['job','method','options']);
      const job = chemistActionEnum(args.job,
        ['geometry','energy','dynamics','conformers'], 'job');
      const method = chemistActionEnum(args.method,
        ['openmm','webgpu','stormm','rdkit','ani2x'], 'method');
      if (args.options != null && (!args.options || typeof args.options !== 'object'
        || Array.isArray(args.options))) throw new Error('options must be a plain object');
      const options = structuredClone(args.options || {});
      // Worker-specific modules perform their own scientific bounds checking;
      // this public boundary additionally rejects pathologically large scalar
      // settings before any model or GPU asset is loaded.
      for (const [key, value] of Object.entries(options)) {
        if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 10_000_000))
          throw new Error(`options.${key} is outside the public calculation bound`);
        if (typeof value === 'string' && value.length > 200)
          throw new Error(`options.${key} is too long`);
        if (Array.isArray(value) && value.length > 4096)
          throw new Error(`options.${key} contains too many entries`);
      }
      const before = state.molecule?.atoms?.length
        ? (await ensureChemistActionAtomIds(), chemistActionCoordinateSnapshot()) : null;
      const result = await runCalculation({ job, method, options });
      if (!result) throw new Error(`${method} ${job} calculation did not complete`);
      return chemistActionSummary({ calculation:{ job, method,
        initialEnergy:result.initialEnergy ?? null, finalEnergy:result.finalEnergy ?? null,
        unit:result.unit || null, frameCount:state.calculationFrames.length,
        replicaCount:result.replicaCount || 1, elapsedMs:result.elapsedMs ?? null,
        ...(before ? chemistActionCoordinateChanges(before) : {}) } }); },
    'calculation.tuneReplicas':async (args) => { empty(args);
      const result = await tuneStormmReplicas();
      if (!result) throw new Error('Replica tuning did not complete');
      return chemistActionSummary({ replicaTuning:{
        recommendedReplicaCount:result.recommendedReplicaCount,
        peakAggregateReplicaStepsPerSecond:result.peakAggregateReplicaStepsPerSecond,
        elapsedMs:result.elapsedMs, samples:structuredClone(result.samples || []) } }); },
    'calculation.selectFrame':async (args) => { chemistActionKeys(args, ['index']);
      const index = Number(args.index);
      if (!Number.isInteger(index) || index < 0 || index >= state.calculationFrames.length)
        throw new Error('index must identify a saved calculation frame');
      selectCalculationFrame(index);
      return chemistActionSummary({ calculationFrame:{ index,
        step:state.calculationFrames[index].step,
        energy:state.calculationFrames[index].energy } }); },
    'calculation.selectReplica':async (args) => { chemistActionKeys(args, ['index']);
      const index = Number(args.index), count = Number(state.calculationEnsemble?.replicaCount || 0);
      if (!Number.isInteger(index) || index < 0 || index >= count)
        throw new Error('index must identify an ensemble replica');
      selectCalculationReplica(index);
      return chemistActionSummary({ calculationReplica:{ index,
        frameCount:state.calculationFrames.length } }); },
    'calculation.selectConformer':async (args) => { chemistActionKeys(args, ['rank']);
      const rank = Number(args.rank);
      const order = state.conformerAnalysis
        ? activeConformerPlotOrder(state.conformerAnalysis) : [];
      if (!Number.isInteger(rank) || rank < 0 || rank >= order.length)
        throw new Error('rank must identify a conformer in the active filtered order');
      selectConformerRank(rank);
      return chemistActionSummary({ conformer:{ rank,
        replicaIndex:state.calculationReplicaIndex } }); },
    'calculation.setPlayback':async (args) => { chemistActionKeys(args, ['playing']);
      if (typeof args.playing !== 'boolean') throw new Error('playing must be boolean');
      if (args.playing && state.calculationFrames.length < 2)
        throw new Error('At least two saved frames are required for playback');
      if (args.playing !== state.calculationPlaying) toggleCalculationPlayback();
      return chemistActionSummary({ trajectoryPlayback:{
        playing:state.calculationPlaying, frameIndex:state.calculationFrameIndex,
        frameCount:state.calculationFrames.length } }); },
    'calculation.setConformerView':async (args) => { chemistActionKeys(args,
      ['x','y','filter','sort']);
      if (!state.conformerAnalysis) throw new Error('Run a conformer search first');
      if (!Object.keys(args).length) throw new Error('At least one conformer-view option is required');
      const controls = { x:'#result-conformer-cv', y:'#result-conformer-y',
        filter:'#result-conformer-filter', sort:'#result-conformer-sort' };
      for (const [key, selector] of Object.entries(controls)) {
        if (args[key] == null) continue;
        if (typeof args[key] !== 'string') throw new Error(`${key} must be an option ID`);
        const select = document.querySelector(selector);
        if (![...select.options].some((option) => option.value === args[key] && !option.disabled))
          throw new Error(`Unsupported ${key} option: ${args[key]}`);
        select.value = args[key];
      }
      updateConformerPlotControls();
      return chemistActionSummary({ conformerView:Object.fromEntries(
        Object.entries(controls).map(([key, selector]) =>
          [key, document.querySelector(selector).value])) }); },
    'campaign.create':async (args) => { chemistActionKeys(args,
      ['campaignId','title','description','actorId','actorName','initialCommitMessage']);
      await ensureLiveCampaignPersistence();
      if (state.liveCampaign) throw new Error('A design campaign is already active');
      if (!state.molecule?.atoms?.length) throw new Error('Load a molecule before starting a campaign');
      const campaignId = String(args.campaignId || '');
      const title = String(args.title || '');
      if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(campaignId))
        throw new Error('campaignId must be a stable identifier');
      if (!title.trim()) throw new Error('title must not be empty');
      const actorId = String(args.actorId || 'chemist.local');
      const actorName = String(args.actorName || 'Local chemist');
      if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(actorId))
        throw new Error('actorId must be a stable identifier');
      if (!actorName.trim()) throw new Error('actorName must not be empty');
      const initialCommitMessage = args.initialCommitMessage == null
        ? 'Capture starting molecule' : String(args.initialCommitMessage).trim();
      if (args.initialCommitMessage != null && !initialCommitMessage)
        throw new Error('initialCommitMessage must be a non-empty string');
      if (state.chemistryTransaction)
        throw new Error('Finish pending chemistry before committing the initial state');
      const live = await getLiveCampaignModule();
      let campaign = await live.createLiveCampaign({ campaignId, title,
        description:String(args.description || ''), actorId, actorDisplayName:actorName,
        createdAt:new Date().toISOString(), application:{
          name:'Molarium', chemistActionsSchema:module.CHEMIST_ACTIONS_SCHEMA,
        } });
      await ensureChemistActionAtomIds();
      const result = await live.commitLiveMolecule(campaign, {
        molecule:state.molecule, audit:state.chemistActionAudit, branch:'main',
        message:initialCommitMessage, actorId, occurredAt:new Date().toISOString(),
        lastAuditSequence:0,
      });
      campaign = result.campaign;
      const committedThroughSequence = result.committedThroughSequence;
      const campaignCommit = { commitId:result.commitId, snapshotId:result.snapshotId,
        actionScriptId:result.actionScriptId, branch:'main', committedThroughSequence };
      await saveLiveCampaign(campaign, 'main');
      state.liveCampaign = campaign;
      state.liveCampaignBranch = 'main';
      state.liveCampaignCommittedThroughSequence = committedThroughSequence;
      updateLiveCampaignUi();
      return chemistActionSummary({ campaign:liveCampaignInspection(), campaignCommit }); },
    'campaign.inspect':async (args) => { empty(args);
      await ensureLiveCampaignPersistence();
      return chemistActionSummary({ campaign:liveCampaignInspection() }); },
    'campaign.commitCurrent':async (args) => { chemistActionKeys(args,
      ['message','label','tags']);
      await ensureLiveCampaignPersistence();
      if (!state.liveCampaign) throw new Error('Start or import a design campaign first');
      if (!state.molecule?.atoms?.length) throw new Error('Load a molecule before committing it');
      if (state.chemistryTransaction) throw new Error('Finish pending chemistry before committing');
      const message = String(args.message || '').trim();
      if (!message) throw new Error('message must not be empty');
      if (args.label != null && (typeof args.label !== 'string' || !args.label.trim()))
        throw new Error('label must be a non-empty string');
      const tags = args.tags ?? [];
      if (!Array.isArray(tags) || tags.length > 32
        || tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 80))
        throw new Error('tags must contain up to 32 non-empty strings');
      await ensureChemistActionAtomIds();
      const live = await getLiveCampaignModule();
      const result = await live.commitLiveMolecule(state.liveCampaign, {
        molecule:state.molecule, audit:state.chemistActionAudit,
        branch:state.liveCampaignBranch, message, label:args.label,
        tags:structuredClone(tags), actorId:liveCampaignActorId(),
        occurredAt:new Date().toISOString(),
        lastAuditSequence:state.liveCampaignCommittedThroughSequence,
      });
      await saveLiveCampaign(result.campaign, state.liveCampaignBranch);
      state.liveCampaign = result.campaign;
      state.liveCampaignCommittedThroughSequence = result.committedThroughSequence;
      updateLiveCampaignUi();
      return chemistActionSummary({ campaignCommit:{ commitId:result.commitId,
        snapshotId:result.snapshotId, actionScriptId:result.actionScriptId,
        branch:state.liveCampaignBranch,
        committedThroughSequence:result.committedThroughSequence } }); },
    'campaign.createBranch':async (args) => { chemistActionKeys(args,
      ['branch','fromCommitId']);
      await ensureLiveCampaignPersistence();
      if (!state.liveCampaign) throw new Error('Start or import a design campaign first');
      const branch = String(args.branch || '');
      if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(branch))
        throw new Error('branch must be a stable identifier');
      if (args.fromCommitId != null && (typeof args.fromCommitId !== 'string'
        || !args.fromCommitId)) throw new Error('fromCommitId must be a commit ID');
      const live = await getLiveCampaignModule();
      const currentHead = liveCampaignHead();
      if (currentHead && state.molecule) {
        await ensureChemistActionAtomIds();
        const currentSnapshot = state.liveCampaign.objects.snapshots[
          state.liveCampaign.objects.commits[currentHead].snapshotId];
        if (!await live.moleculeMatchesSnapshot(state.molecule, currentSnapshot))
          throw new Error('Commit the current molecular changes before creating a branch');
      }
      const result = await live.createLiveBranch(state.liveCampaign, { branch,
        fromCommitId:args.fromCommitId ?? liveCampaignHead(),
        actorId:liveCampaignActorId(), occurredAt:new Date().toISOString() });
      const checkout = await prepareLiveCampaignBranchMolecule(result.campaign, result.branch);
      await saveLiveCampaign(result.campaign, result.branch);
      state.liveCampaign = result.campaign;
      state.liveCampaignBranch = result.branch;
      if (checkout.molecule) applyLiveCampaignBranchMolecule(checkout.molecule);
      state.liveCampaignCommittedThroughSequence = currentChemistActionSequence();
      updateLiveCampaignUi();
      return chemistActionSummary({ campaignBranch:{ branch:result.branch,
        head:result.head, eventId:result.event?.eventId || null } }); },
    'campaign.switchBranch':async (args) => { chemistActionKeys(args, ['branch']);
      await ensureLiveCampaignPersistence();
      if (!state.liveCampaign) throw new Error('Start or import a design campaign first');
      const branch = String(args.branch || '');
      if (!Object.hasOwn(state.liveCampaign.branches || {}, branch))
        throw new Error(`Unknown branch: ${branch}`);
      if (branch === state.liveCampaignBranch)
        return chemistActionSummary({ campaignBranch:{ branch,
          head:liveCampaignHead(), restored:false } });
      const live = await getLiveCampaignModule();
      const currentHead = liveCampaignHead();
      if (currentHead && state.molecule) {
        await ensureChemistActionAtomIds();
        const currentSnapshot = state.liveCampaign.objects.snapshots[
          state.liveCampaign.objects.commits[currentHead].snapshotId];
        if (!await live.moleculeMatchesSnapshot(state.molecule, currentSnapshot))
          throw new Error('Commit the current molecular changes before switching branches');
      }
      const checkout = await prepareLiveCampaignBranchMolecule(state.liveCampaign, branch);
      await saveLiveCampaign(state.liveCampaign, branch);
      state.liveCampaignBranch = branch;
      if (checkout.molecule) applyLiveCampaignBranchMolecule(checkout.molecule);
      state.liveCampaignCommittedThroughSequence = currentChemistActionSequence();
      updateLiveCampaignUi();
      return chemistActionSummary({ campaignBranch:{ branch,
        head:liveCampaignHead(), restored:Boolean(checkout.commitId) } }); },
    'campaign.mergeBranch':async (args) => { chemistActionKeys(args,
      ['sourceBranch','targetBranch','message']);
      await ensureLiveCampaignPersistence();
      if (!state.liveCampaign) throw new Error('Start or import a design campaign first');
      if (!state.molecule?.atoms?.length) throw new Error('Load a molecule before merging');
      if (state.chemistryTransaction) throw new Error('Finish pending chemistry before merging');
      const sourceBranch = String(args.sourceBranch || '');
      const targetBranch = String(args.targetBranch || state.liveCampaignBranch);
      for (const [label, branch] of [['sourceBranch', sourceBranch], ['targetBranch', targetBranch]])
        if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(branch))
          throw new Error(`${label} must be a stable branch name`);
      if (!Object.hasOwn(state.liveCampaign.branches || {}, sourceBranch))
        throw new Error(`Unknown source branch: ${sourceBranch}`);
      if (!Object.hasOwn(state.liveCampaign.branches || {}, targetBranch))
        throw new Error(`Unknown target branch: ${targetBranch}`);
      if (sourceBranch === targetBranch) throw new Error('Source and target branches must differ');
      if (targetBranch !== state.liveCampaignBranch)
        throw new Error('Switch to the target branch before merging into it');
      await ensureChemistActionAtomIds();
      const live = await getLiveCampaignModule();
      const result = await live.mergeCurrentMolecule(state.liveCampaign, {
        sourceBranch, targetBranch, molecule:state.molecule,
        audit:state.chemistActionAudit,
        message:String(args.message || `Merge ${sourceBranch} into ${targetBranch}`),
        actorId:liveCampaignActorId(), occurredAt:new Date().toISOString(),
        lastAuditSequence:state.liveCampaignCommittedThroughSequence,
      });
      await saveLiveCampaign(result.campaign, targetBranch);
      state.liveCampaign = result.campaign;
      state.liveCampaignBranch = targetBranch;
      state.liveCampaignCommittedThroughSequence = result.committedThroughSequence;
      updateLiveCampaignUi();
      return chemistActionSummary({ campaignMerge:{ commitId:result.commitId,
        snapshotId:result.snapshotId, actionScriptId:result.actionScriptId,
        sourceBranch, targetBranch,
        committedThroughSequence:result.committedThroughSequence } }); },
    'campaign.recordDecision':async (args) => { chemistActionKeys(args,
      ['targetCommitId','disposition','reasonCodes','rationale','evidenceIds']);
      await ensureLiveCampaignPersistence();
      if (!state.liveCampaign) throw new Error('Start or import a design campaign first');
      const targetCommitId = args.targetCommitId ?? liveCampaignHead();
      if (typeof targetCommitId !== 'string' || !targetCommitId)
        throw new Error('Commit the current branch before recording a decision');
      const disposition = chemistActionEnum(args.disposition,
        ['progressed','not-progressed','deferred','failed','duplicate','superseded','archived'],
        'disposition');
      const reasonCodes = args.reasonCodes ?? [];
      const evidenceIds = args.evidenceIds ?? [];
      for (const [label, values, maximum] of [['reasonCodes', reasonCodes, 32],
        ['evidenceIds', evidenceIds, 128]])
        if (!Array.isArray(values) || values.length > maximum
          || values.some((value) => typeof value !== 'string' || !value))
          throw new Error(`${label} must contain up to ${maximum} non-empty strings`);
      const rationale = String(args.rationale || '');
      const live = await getLiveCampaignModule();
      const result = await live.recordLiveCampaignDecision(state.liveCampaign, {
        targetCommitId, disposition, reasonCodes:structuredClone(reasonCodes),
        rationale, evidenceIds:structuredClone(evidenceIds),
        branch:state.liveCampaignBranch, actorId:liveCampaignActorId(),
        occurredAt:new Date().toISOString(),
      });
      await saveLiveCampaign(result.campaign, state.liveCampaignBranch);
      state.liveCampaign = result.campaign;
      updateLiveCampaignUi();
      return chemistActionSummary({ campaignDecision:{ eventId:result.event.eventId,
        targetCommitId, disposition, reasonCodes:structuredClone(reasonCodes) } }); },
    'campaign.verify':async (args) => { empty(args);
      await ensureLiveCampaignPersistence();
      if (!state.liveCampaign) throw new Error('Start or import a design campaign first');
      const live = await getLiveCampaignModule();
      return chemistActionSummary({ campaignVerification:
        await live.verifyLiveCampaign(state.liveCampaign) }); },
    'campaign.close':async (args) => { empty(args);
      await ensureLiveCampaignPersistence();
      if (!state.liveCampaign) throw new Error('No design campaign is active');
      const closedCampaignId = state.liveCampaign.campaignId;
      const store = await getLiveCampaignStore();
      await store.closeActive();
      state.liveCampaign = null;
      state.liveCampaignBranch = 'main';
      state.liveCampaignCommittedThroughSequence = 0;
      state.chemistActionAudit = [];
      if (state.molecule) state.molecule.source = { ...(state.molecule.source || {}),
        chemistActionAudit:[] };
      updateLiveCampaignUi('Campaign closed; its commits remain stored locally.', 'success');
      return chemistActionSummary({ campaignClosed:{ campaignId:closedCampaignId,
        persisted:true } }); },
    'campaign.import':async (args) => { chemistActionKeys(args, ['serialized']);
      if (typeof args.serialized !== 'string' || !args.serialized.trim())
        throw new Error('serialized must be canonical campaign JSON');
      await ensureLiveCampaignPersistence();
      const [live, storeModule] = await Promise.all([
        getLiveCampaignModule(), getLiveCampaignStoreModule(),
      ]);
      const campaign = storeModule.deserializeCampaign(args.serialized);
      const canonical = storeModule.serializeCampaign(campaign);
      if (`${args.serialized.trim()}\n` !== canonical)
        throw new Error('Campaign JSON must use the canonical serialized representation');
      const verification = await live.verifyLiveCampaign(campaign);
      if (!verification.valid) throw new Error(`Campaign is invalid: ${verification.reason}`);
      const branch = Object.hasOwn(campaign.branches || {}, 'main') ? 'main'
        : Object.keys(campaign.branches || {})[0];
      if (!branch) throw new Error('Campaign has no branch to restore');
      const checkout = await prepareLiveCampaignBranchMolecule(campaign, branch,
        { required:true });
      await saveLiveCampaign(campaign, branch);
      state.chemistActionAudit = [];
      state.liveCampaign = campaign; state.liveCampaignBranch = branch;
      state.liveCampaignCommittedThroughSequence = 0;
      applyLiveCampaignBranchMolecule(checkout.molecule);
      updateLiveCampaignUi();
      return chemistActionSummary({ campaignImport:{ campaignId:campaign.campaignId,
        title:campaign.title, branch, commitId:checkout.commitId,
        verification:structuredClone(verification) } }); },
    'campaign.export':async (args) => { empty(args);
      await ensureLiveCampaignPersistence();
      if (!state.liveCampaign) throw new Error('No design campaign is active');
      const storeModule = await getLiveCampaignStoreModule();
      const serialized = storeModule.serializeCampaign(state.liveCampaign);
      return chemistActionSummary({ campaignExport:{ campaignId:state.liveCampaign.campaignId,
        branch:state.liveCampaignBranch, serialized } }); },
    'designerScript.load':async (args) => { chemistActionKeys(args, ['script']);
      if (!args.script || typeof args.script !== 'object' || Array.isArray(args.script))
        throw new Error('script must be a Chemist Actions script object');
      await installDesignerMoveScript(args.script);
      return chemistActionSummary({ designerScript:{
        schema:state.designerMoveScript.schema,
        label:state.designerMoveScript.label || null,
        actionCount:state.designerMoveScript.actions.length } }); },
    'designerScript.loadRegistered':async (args) => { chemistActionKeys(args, ['storyId']);
      if (typeof args.storyId !== 'string' || !args.storyId)
        throw new Error('storyId must be a registered Designer Moves story ID');
      return chemistActionSummary({ registeredDesignerScript:
        await loadRegisteredDesignerScript(args.storyId) }); },
    'designerScript.play':async (args) => { chemistActionKeys(args, ['playing']);
      if (typeof args.playing !== 'boolean') throw new Error('playing must be boolean');
      if (!state.designerMoveScript) throw new Error('Load a designer-move script first');
      const alreadyScheduled = args.playing && state.designerMoveReplayScheduled
        && !state.designerMoveReplaying;
      let startAccepted = false;
      if (!args.playing) {
        if (state.designerMoveReplaying && !state.designerMoveReplayPaused)
          setDesignerMoveReplayPaused(true);
      } else if (state.designerMoveReplaying) {
        if (state.designerMoveReplayPaused) resumeDesignerMoveReplay();
      } else if (currentDesignerReplayReviewState().reviewing) {
        throw new Error('Return to the final completed checkpoint before replaying the story');
      } else if (!state.designerMoveReplayScheduled) {
        // replayDesignerMoveScript executes the constituent actions through this
        // same serialized API.  Start it only after the play route returns, or
        // the outer queued action would wait on its own queue.
        state.designerMoveReplayScheduled = true;
        startAccepted = true;
        updateDesignerMoveControls();
        setTimeout(async () => {
          try { await replayDesignerMoveScript(); }
          catch (error) {
            if (!state.designerMoveReplay || state.designerMoveReplay.status === 'running')
              state.designerMoveReplay = { status:'failed', error:String(error?.message || error) };
            showNotice(error.message);
          } finally {
            state.designerMoveReplayScheduled = false;
            updateDesignerMoveControls();
          }
        }, 0);
      }
      return chemistActionSummary({ designerPlayback:{
        scheduled:state.designerMoveReplayScheduled,
        startAccepted, alreadyScheduled,
        playing:args.playing, paused:!args.playing,
        index:state.designerMoveReplayIndex,
        actionCount:state.designerMoveScript.actions.length } }); },
    'designerScript.step':async (args) => { chemistActionKeys(args, ['direction']);
      const direction = chemistActionEnum(args.direction,
        DESIGNER_REVIEW_DIRECTIONS, 'direction');
      const review = currentDesignerReplayReviewState();
      if (!review.available)
        throw new Error('Pause an active replay or complete it before reviewing checkpoints');
      const before = state.designerMoveReplayIndex;
      reviewDesignerMoveCheckpoint(direction);
      if (state.designerMoveReplayIndex === before)
        throw new Error(`No ${direction} completed replay checkpoint is available`);
      return chemistActionSummary({ designerCheckpoint:{
        index:state.designerMoveReplayIndex,
        frontier:state.designerMoveReplayFrontier,
        completedReplay:review.completed,
        atFinal:state.designerMoveReplayIndex === state.designerMoveReplayFrontier } }); },
    'designerScript.restart':async (args) => { empty(args);
      if (!state.designerMoveScript) throw new Error('Load a designer-move script first');
      if (state.designerMoveReplaying)
        throw new Error('Pause and finish the active replay before restarting');
      clearScene(); resetDesignerMovePlayback(); updateDesignerMoveControls();
      return chemistActionSummary({ designerRestarted:true }); },
    'designerScript.inspect':async (args) => { empty(args);
      const script = state.designerMoveScript;
      return chemistActionSummary({ designerScript:script ? {
        schema:script.schema, label:script.label || null,
        actionCount:script.actions.length,
        index:state.designerMoveReplayIndex,
        frontier:state.designerMoveReplayFrontier,
        replaying:state.designerMoveReplaying,
        scheduled:state.designerMoveReplayScheduled,
        paused:state.designerMoveReplayPaused,
        review:currentDesignerReplayReviewState(),
        phase:state.designerMoveReplayPhase,
        activeAction:state.designerMoveReplayStep?.action || null,
        registeredStory:structuredClone(state.designerMoveRegisteredStory),
      } : null }); },
    'designerScript.export':async (args) => { chemistActionKeys(args, ['kind']);
      const kind = chemistActionEnum(args.kind,
        ['recorded-actions','execution-log','installed-script'], 'kind');
      return chemistActionSummary({ designerScriptExport:
        await createDesignerScriptExport(kind) }); },
    'designRoute.load':async (args) => { chemistActionKeys(args, ['routeId']);
      if (typeof args.routeId !== 'string' || !args.routeId)
        throw new Error('routeId must be a registered design-route ID');
      return chemistActionSummary({ designRoute:await loadRegisteredDesignRoute(args.routeId) }); },
    'designRoute.resume':async (args) => { chemistActionKeys(args, ['routeId','stateId']);
      if (typeof args.routeId !== 'string' || !args.routeId
        || typeof args.stateId !== 'string' || !args.stateId)
        throw new Error('routeId and stateId must be registered identifiers');
      if (!state.molecule?.atoms?.length)
        throw new Error('Restore a campaign snapshot before resuming its design route');
      const route = await fetchRegisteredDesignRoute(args.routeId);
      const registeredStep = route.steps.find((step) => step.stateId === args.stateId);
      if (args.stateId !== route.hit.stateId && !registeredStep)
        throw new Error(`State ${args.stateId} is not registered by route ${args.routeId}`);
      const source = state.molecule.source || {};
      const sourceRoute = source.designRoute || source;
      if (sourceRoute.routeId !== args.routeId || sourceRoute.stateId !== args.stateId)
        throw new Error('The restored snapshot provenance does not match the requested route state');
      const component = dockingLigandComponent();
      if (!component) throw new Error('The restored route snapshot has no ligand component');
      const expectedNames = registeredStep
        ? registeredStep.productAtomNames
        : route.hit.ligandDefinition.atoms.filter((atom) => atom.element !== 'H')
          .map((atom) => atom.id);
      const actualNames = component.atomIndices.flatMap((atomIndex) => {
        const atom = state.molecule.atoms[atomIndex];
        return atom.element === 'H' ? [] : [atom.atomName];
      });
      if (actualNames.length !== expectedNames.length
        || new Set(actualNames).size !== actualNames.length
        || expectedNames.some((name) => !actualNames.includes(name)))
        throw new Error('The restored ligand graph identities do not match the registered route state');
      clearDockingReference();
      state.designRoute = structuredClone(route);
      state.designRouteStepId = args.stateId;
      state.molecule.source = { ...source, designRoute:{
        routeId:route.id, hitPdbId:route.hit.pdbId, stateId:args.stateId,
        ...(registeredStep ? { stepId:registeredStep.id } : {}),
        coordinateInputClass:'registered-hit-only', resumedFromCampaign:true,
      } };
      updateDockingUi();
      return chemistActionSummary({ designRoute:{ routeId:route.id,
        currentStateId:args.stateId, resumed:true,
        nextSteps:route.steps.filter((step) => step.referenceStateId === args.stateId)
          .map((step) => step.id) } }); },
    'designRoute.applyStep':async (args) => { chemistActionKeys(args,
      ['stepId','attachmentAtomId']);
      if (!state.designRoute) throw new Error('Load a registered design route first');
      if (typeof args.stepId !== 'string' || !args.stepId)
        throw new Error('stepId must be a registered design-step ID');
      if (!state.dockingReference || state.dockingReference.mode !== 'pose-propagation')
        throw new Error('Capture the hit with pose.captureReference before applying a design step');
      const step = state.designRoute.steps.find((entry) => entry.id === args.stepId);
      if (!step) throw new Error(`Unknown registered design step: ${args.stepId}`);
      if (step.referenceStateId && step.referenceStateId !== state.designRouteStepId)
        throw new Error(`Design step ${step.id} requires state ${step.referenceStateId}; current state is ${state.designRouteStepId}`);
      let spatialIntent = null;
      if (step.spatialIntent) {
        if (step.spatialIntent.method !== 'selected-exit-vector'
          || typeof step.spatialIntent.attachmentReferenceAtomName !== 'string')
          throw new Error(`Design step ${step.id} has an invalid spatial intent`);
        if (typeof args.attachmentAtomId !== 'string' || !args.attachmentAtomId)
          throw new Error(`Design step ${step.id} requires attachmentAtomId`);
        const byId = await ensureChemistActionAtomIds();
        const attachmentIndex = byId.get(args.attachmentAtomId);
        const component = dockingLigandComponent();
        if (!Number.isInteger(attachmentIndex)
          || !component?.atomIndices?.includes(attachmentIndex))
          throw new Error('attachmentAtomId must identify an atom in the current ligand');
        const attachmentAtom = state.molecule.atoms[attachmentIndex];
        if (attachmentAtom.atomName !== step.spatialIntent.attachmentReferenceAtomName)
          throw new Error(`Design step ${step.id} grows from ${step.spatialIntent.attachmentReferenceAtomName}, not ${attachmentAtom.atomName || 'an unnamed atom'}`);
        const productBoundaryIndices = new Set((step.posePropagationMap?.productBoundary || [])
          .map((entry) => entry.commonProductAtomIndex));
        const registeredAttachment = (step.posePropagationMap?.commonAtoms || []).find((entry) =>
          entry.referenceAtomName === attachmentAtom.atomName
          && productBoundaryIndices.has(entry.productAtomIndex));
        if (!registeredAttachment)
          throw new Error(`Design step ${step.id} atom map does not grow from selected ${attachmentAtom.atomName}`);
        spatialIntent = { method:step.spatialIntent.method,
          attachmentAtomId:args.attachmentAtomId,
          attachmentReferenceAtomName:attachmentAtom.atomName };
      } else if (args.attachmentAtomId != null) {
        throw new Error(`Design step ${step.id} does not register a designer-directed attachment`);
      }
      const hitContacts = state.dockingReference.hydrogenBonds.map((definition) => ({
        kind:'hydrogen-bond', capturedId:definition.id, label:definition.label,
      }));
      const staged = await stageRegisteredDesignRouteProduct({
        caseId:`${state.designRoute.id}:${step.id}`,
        productSmiles:step.productSmiles,
        posePropagationMap:step.posePropagationMap,
        posePropagationPolicy:state.designRoute.posePropagationPolicy,
        productAtomNames:step.productAtomNames || null,
        productComponentId:step.productComponentId || null,
        interactionHypotheses:hitContacts,
      });
      state.molecule.name = step.compound
        ? `${state.designRoute.title} · compound ${step.compound} (${step.stateId})`
        : `${state.designRoute.title} · ${step.stateId}`;
      delete state.molecule.source.dockingBenchmark;
      state.molecule.source.designRoute = {
        routeId:state.designRoute.id, hitPdbId:state.designRoute.hit.pdbId,
        stateId:step.stateId, stepId:step.id, inputKind:step.inputKind,
        coordinateInputClass:'registered-hit-only',
      };
      state.designRouteStepId = step.stateId;
      const changedAtomIds = [...new Set([
        ...(staged.registeredEditRegion.addedHeavyAtomIds || []),
        ...(staged.registeredEditRegion.affectedCoreAtomIds || []),
      ])];
      return chemistActionSummary({ designStep:{ id:step.id, stateId:step.stateId,
        referenceStateId:step.referenceStateId || null,
        inputKind:step.inputKind, productHeavyAtoms:staged.productHeavyAtoms,
        productHeavyGraph:structuredClone(staged.productHeavyGraph),
        commonHitHeavyAtoms:staged.commonHeavyAtoms,
        addedHeavyAtomIds:[...(staged.registeredEditRegion.addedHeavyAtomIds || [])],
        changedAtomIds,
        poseTransferPlan:structuredClone(staged.poseTransferPlan),
        spatialIntent,
        embedding:structuredClone(staged.embedding) } }); },
    'designRoute.inspect':async (args) => { empty(args);
      if (!state.designRoute) throw new Error('No registered design route is loaded');
      return chemistActionSummary({ designRoute:{ id:state.designRoute.id,
        hit:structuredClone(state.designRoute.hit),
        protocolBoundary:structuredClone(state.designRoute.protocolBoundary),
        posePropagationPolicy:structuredClone(state.designRoute.posePropagationPolicy),
        currentStateId:state.designRouteStepId,
        evaluationStatus:state.designRoute.evaluation.status,
        availableSteps:state.designRoute.steps.map((step) => step.id) } }); },
  };
  const api = module.createChemistActionsApi({ routes,
    enabledActions:module.CHEMIST_ACTION_SCOPES.application,
    recordAudit:persistChemistActionAudit });
  Object.defineProperty(window, 'MolariumChemistActions', { value:api,
    enumerable:true, configurable:false, writable:false });
  return api;
}

const molariumTestApiBase = {
  parsePdb(text) {
    const molecule = parsePDB(text);
    return { ...moleculeDiagnostics(molecule), source: structuredClone(molecule.source),
      preparation: proteinPreparationReport(molecule), molecule: structuredClone(molecule) };
  },
  loadPdb(text, meta = {}) {
    state.buildHistory = []; state.redoHistory = [];
    loadMolecule(parsePDB(text, meta)); updateHistoryButtons();
    return { ...moleculeDiagnostics(state.molecule), source: structuredClone(state.molecule.source),
      preparation: proteinPreparationReport(state.molecule) };
  },
  addPdbHydrogens() {
    const result = addStandardProteinHydrogens(state.molecule);
    pushBuildSnapshot(state.molecule);
    loadMolecule(result.molecule, false); updateHistoryButtons();
    return { ...moleculeDiagnostics(state.molecule), preparation: result.report };
  },
  repairPdbHeavyAtoms() {
    const result = repairCanonicalHeavyAtoms(state.molecule);
    pushBuildSnapshot(state.molecule);
    loadMolecule(result.molecule, false); updateHistoryButtons();
    return { ...moleculeDiagnostics(state.molecule), repaired: result.repaired,
      unresolved: result.unresolved, preparation: proteinPreparationReport(state.molecule),
      molecule: structuredClone(state.molecule) };
  },
  parseCcd(text, id = '') { return parseCcdDefinition(text, id); },
  prepareLigandsWithCcd(definitions) {
    const result = prepareLigandsFromCcdDefinitions(state.molecule, definitions);
    pushBuildSnapshot(state.molecule);
    loadMolecule(result.molecule, false); updateHistoryButtons();
    return { ...moleculeDiagnostics(state.molecule), prepared: result.prepared,
      preparation: proteinPreparationReport(state.molecule) };
  },
  async previewPdbPreparation(options = {}, definitions = null) {
    return createPdbPreparationPreview(state.molecule, options, definitions);
  },
  async parameterizePdbPreview(preview) {
    if (!preview?.molecule?.atoms?.length) throw new Error('A prepared PDB preview is required');
    if (preview.audit?.blockers?.length)
      throw new Error(`Preparation stopped: ${preview.audit.blockers.join('; ')}`);
    const prepared = structuredClone(preview.molecule);
    const parameters = await runOpenMMJob('parameters', prepared, () => {});
    prepared.parameterization = {
      forcefield:parameters.forcefield, chargeModel:parameters.chargeModel,
      sourceSha256:parameters.sourceSha256, system:parameters.system, labels:parameters.labels,
    };
    prepared.preparation = { ...(prepared.preparation || {}), status:'parameterized-experimental',
      parameterized:true, audit:{ ...structuredClone(preview.audit), parameterization:{
        forcefield:parameters.forcefield, chargeModel:parameters.chargeModel,
        sourceSha256:parameters.sourceSha256, parameterCounts:parameters.parameterCounts,
      } } };
    state.buildHistory = []; state.redoHistory = [];
    loadMolecule(prepared); updateHistoryButtons();
    return { atoms:prepared.atoms.length, forcefield:parameters.forcefield,
      chargeModel:parameters.chargeModel, sourceSha256:parameters.sourceSha256,
      parameterCounts:structuredClone(parameters.parameterCounts) };
  },
  async captureLigandReferenceForStagingTest() {
    const [adapter, referenceCore] = await Promise.all([
      import('./docking/browser-adapter.mjs'), import('./docking/reference-core.mjs'),
    ]);
    const component = dockingLigandComponent();
    if (!component) throw new Error('A ligand component is required for the staging test');
    const plan = adapter.createLigandPlan(state.molecule, component.atomIndices,
      'isolated-staging-reference');
    const ligand = referenceCore.captureReferenceLigand(state.molecule,
      component.atomIndices, null, 'isolated-staging-reference');
    state.dockingReference = {
      schema:'molarium.docking.browser-reference/v1', mode:'pose-propagation',
      capturedAt:new Date().toISOString(), moleculeName:state.molecule.name || 'ligand',
      ligandComponentId:component.id, ligand,
      receptorSite:{ schema:'molarium.docking.receptor-site/v1', radiusAngstrom:8,
        sourceForcefield:null, sourceChargeModel:null, atoms:[] },
      hydrogenBonds:[], contactAmendments:[], receptorProvenanceAtomCount:0,
      receptorInputText:'', referenceLigandInputText:adapter.dockingInputText(
        state.molecule, plan.globalAtomIndices),
      forcefield:null, chargeModel:null, sourceSha256:null,
    };
    return { mode:'pose-propagation', coreAtomCount:ligand.coreAtomIds.length };
  },
};

async function stageRegisteredDesignRouteProduct({ caseId, productSmiles, posePropagationMap,
    posePropagationPolicy = null,
    productAtomNames = null,
    productComponentId = null,
    interactionHypotheses = [] } = {}) {
    if (!state.dockingReference || state.dockingReference.mode !== 'pose-propagation')
      throw new Error('Capture a pose-propagation reference before staging a benchmark product');
    if (!productSmiles || !posePropagationMap?.commonAtoms?.length)
      throw new Error('A product graph and exact pose-propagation map are required');
    const [adapter, referenceCore, constraints, remap, featureSeeding,
      registeredGraphEdit] = await Promise.all([
      import('./docking/browser-adapter.mjs'), import('./docking/reference-core.mjs'),
      import('./docking/constraints.mjs'), import('./docking/contact-remap.mjs'),
      import('./docking/feature-seeding.mjs'),
      import('./docking/registered-graph-edit.mjs'),
    ]);
    const poseTransferPlan = registeredGraphEdit.buildRegisteredPoseTransferPlan(
      posePropagationMap, posePropagationPolicy
        || registeredGraphEdit.EXACT_REGISTERED_POSE_PROPAGATION_POLICY);
    const reference = state.dockingReference;
    const component = dockingLigandComponent();
    if (!component) throw new Error('The captured reference ligand component is missing');
    const beforePlan = adapter.createLigandPlan(state.molecule, component.atomIndices,
      `benchmark-reference-${caseId || 'case'}`);
    const beforeLigand = structuredClone(beforePlan.molecule);
    const beforeByAtomName = new Map(beforePlan.molecule.atoms
      .map((atom, localIndex) => [atom.atomName, { atom, localIndex }]).filter(([name]) => name));
    const referenceIndexById = new Map(reference.ligand.atomIds.map((id, index) => [id, index]));
    const embedded = await createRdkitSmilesMolecule(productSmiles,
      `${caseId || 'benchmark'} product`);
    const product = embedded.molecule;
    const productHeavyIndices = product.atoms.flatMap((atom, index) =>
      atom.element === 'H' ? [] : [index]);
    const productHeavyOrdinal = new Map(productHeavyIndices.map((atomIndex, ordinal) =>
      [atomIndex, ordinal]));
    if (productHeavyIndices.length !== posePropagationMap.productHeavyAtoms)
      throw new Error(`Product heavy-atom count changed (${productHeavyIndices.length} != ${posePropagationMap.productHeavyAtoms})`);
    if (productAtomNames != null) {
      if (!Array.isArray(productAtomNames)
        || productAtomNames.length !== productHeavyIndices.length
        || productAtomNames.some((name) => typeof name !== 'string'
          || !/^[A-Za-z][A-Za-z0-9]{0,7}$/.test(name))
        || new Set(productAtomNames).size !== productAtomNames.length)
        throw new Error('Registered product atom names must uniquely cover every heavy atom');
    }
    if (productComponentId != null
      && (typeof productComponentId !== 'string'
        || !/^[A-Za-z0-9]{1,3}$/.test(productComponentId)))
      throw new Error('Registered product component ID must contain one to three alphanumeric characters');
    const template = state.molecule.atoms[component.atomIndices[0]];
    const identityPairByReferenceName = new Map();
    for (const mapping of poseTransferPlan.mappedAtomPairs) {
      const before = beforeByAtomName.get(mapping.referenceAtomName);
      const productIndex = productHeavyIndices[mapping.productAtomIndex];
      if (!before || !Number.isInteger(productIndex))
        throw new Error(`Atom-map identity is unavailable for ${mapping.referenceAtomName}`);
      const productAtom = product.atoms[productIndex];
      if (productAtom.element !== mapping.element || before.atom.element !== mapping.element)
        throw new Error(`Atom-map element changed for ${mapping.referenceAtomName}`);
      productAtom.designAtomId = before.atom.designAtomId;
      productAtom.atomName = mapping.referenceAtomName;
      identityPairByReferenceName.set(mapping.referenceAtomName,
        [referenceIndexById.get(before.atom.designAtomId), productIndex]);
    }
    const mappedPairs = poseTransferPlan.exactAtomPairs.map((mapping) =>
      identityPairByReferenceName.get(mapping.referenceAtomName));
    if (mappedPairs.some((pair) => !pair || !Number.isInteger(pair[0])))
      throw new Error('A mapped reference atom is absent from the captured pose');
    const spatialFeatureMappings = poseTransferPlan.featureCorrespondences
      .filter((feature) => feature.kind === 'conserved-fragment-rmsd')
      .map((feature) => ({ ...feature,
        mappingVariants:feature.mappingVariants.map((variant) => ({
          atomPairs:variant.referenceAtomNames.map((referenceAtomName, pairIndex) => {
            const before = beforeByAtomName.get(referenceAtomName);
            const productIndex = productHeavyIndices[variant.productAtomIndices[pairIndex]];
            if (!before || !Number.isInteger(productIndex))
              throw new Error(`Spatial feature ${feature.id} atom map is unavailable`);
            const referenceIndex = referenceIndexById.get(before.atom.designAtomId);
            const productAtom = product.atoms[productIndex];
            if (!Number.isInteger(referenceIndex)
              || productAtom.element !== before.atom.element)
              throw new Error(`Spatial feature ${feature.id} changed exact atom chemistry`);
            return [referenceIndex, productIndex];
          }),
          referenceAtomNames:[...variant.referenceAtomNames],
          productAtomIndices:[...variant.productAtomIndices],
        })) }));
    const initialPositions = Float64Array.from(product.atoms.flatMap((atom) =>
      [atom.x, atom.y, atom.z]));
    const globallyAlignedPositions = constraints.applyCoreTransform(initialPositions,
      constraints.fittedCoreTransform(reference.ligand.positions, initialPositions,
        mappedPairs));
    const attachedPlacement = featureSeeding.attachNonCoreRegionsToSnappedCore({
      molecule:product, alignedPositions:globallyAlignedPositions,
      referencePositions:reference.ligand.positions, coreAtomPairs:mappedPairs,
    });
    const seedOnlyPlacement = featureSeeding.placeSeedOnlyFragments({
      molecule:product, initialPositions:attachedPlacement.positions,
      referencePositions:reference.ligand.positions, hardCoreAtomPairs:mappedPairs,
      features:spatialFeatureMappings.filter((feature) => feature.treatment === 'seed-only'),
    });
    let alignedPositions = new Float64Array(seedOnlyPlacement.positions);
    const seedOnlyFeatures = spatialFeatureMappings.filter((feature) =>
      feature.treatment === 'seed-only');
    const fixedSeedAtomIndices = new Set(mappedPairs.map(([, productIndex]) => productIndex));
    seedOnlyFeatures.forEach((feature, featureIndex) => {
      const selectedVariantIndex = seedOnlyPlacement.features[featureIndex]
        ?.selectedVariantIndex ?? 0;
      const selectedVariant = feature.mappingVariants[selectedVariantIndex];
      if (!selectedVariant)
        throw new Error(`Seed-only feature ${feature.id} has no selected mapping variant`);
      selectedVariant.atomPairs.forEach(([referenceIndex, productIndex]) => {
        fixedSeedAtomIndices.add(productIndex);
        for (let axis = 0; axis < 3; axis++)
          alignedPositions[productIndex * 3 + axis]
            = reference.ligand.positions[referenceIndex * 3 + axis];
      });
    });
    let seedConnectorRepair = null;
    if (seedOnlyFeatures.length) {
      product.atoms.forEach((atom, index) => {
        atom.x = alignedPositions[index * 3]; atom.y = alignedPositions[index * 3 + 1];
        atom.z = alignedPositions[index * 3 + 2];
      });
      const repaired = await runRDKitJob('geometry', product, () => {}, {
        maxIterations:120, snapshotFrequency:120,
        fixedAtomIndices:[...fixedSeedAtomIndices].sort((first, second) => first - second),
      });
      alignedPositions = new Float64Array(repaired.positions);
      seedConnectorRepair = { method:'RDKit fixed-island connector repair/v1',
        forcefield:repaired.forcefield, fallback:Boolean(repaired.fallback),
        converged:Boolean(repaired.converged), elapsedMs:repaired.elapsedMs,
        fixedAtomCount:repaired.fixedAtomCount,
        movableAtomCount:repaired.movableAtomCount };
      seedOnlyPlacement.features.forEach((entry) => {
        entry.finalSeedRmsdAngstrom = 0;
        entry.coordinatePolicy = 'predecessor seed fixed only during connector repair; released for pose search';
      });
    }
    const protectedDisplacements = mappedPairs.map(([referenceIndex, productIndex]) => {
      const dx = alignedPositions[productIndex * 3] - reference.ligand.positions[referenceIndex * 3];
      const dy = alignedPositions[productIndex * 3 + 1] - reference.ligand.positions[referenceIndex * 3 + 1];
      const dz = alignedPositions[productIndex * 3 + 2] - reference.ligand.positions[referenceIndex * 3 + 2];
      return Math.hypot(dx, dy, dz);
    });
    const protectedReferenceMaxDisplacementAngstrom = Math.max(...protectedDisplacements, 0);
    if (protectedReferenceMaxDisplacementAngstrom > 1e-9)
      throw new Error(`Protected reference anchor moved by ${protectedReferenceMaxDisplacementAngstrom.toExponential(3)} Å during staging`);
    if (productAtomNames) productHeavyIndices.forEach((atomIndex, productAtomIndex) => {
      product.atoms[atomIndex].atomName = productAtomNames[productAtomIndex];
    });
    product.atoms.forEach((atom, index) => {
      atom.x = alignedPositions[index * 3]; atom.y = alignedPositions[index * 3 + 1];
      atom.z = alignedPositions[index * 3 + 2];
      atom.record = 'HETATM'; atom.residueName = productComponentId || template.residueName;
      atom.chain = template.chain; atom.residueIndex = template.residueIndex;
      atom.insertionCode = template.insertionCode || '';
      if (!atom.atomName) atom.atomName = atom.element === 'H'
        ? `HNEW${index + 1}` : `${atom.element}NEW${index + 1}`;
      atom.benchmarkProductAtomIndex = productHeavyOrdinal.get(index) ?? null;
    });
    product.bonds.forEach((bond) => {
      bond.distance = bondDistance(product, bond.a, bond.b);
    });
    product.source = { ...(product.source || {}), format:'molarium-benchmark-product',
      caseId:caseId || null, inputSmiles:productSmiles,
      atomMapSource:posePropagationMap.source || 'atom-maps.v0.1.json' };
    referenceCore.ensureStableAtomIds(product, `benchmark-product-${caseId || 'case'}`,
      state.molecule.source?.designAtomIdLedger || reference.ligand.atomIds);
    const releasedMappedHeavyIds = poseTransferPlan.releasedMappedAtomPairs.map((mapping) => {
      const productIndex = productHeavyIndices[mapping.productAtomIndex];
      return product.atoms[productIndex]?.designAtomId;
    }).filter(Boolean);
    const spatialFeatureDefinitions = spatialFeatureMappings.map((feature) => ({
      id:feature.id, kind:feature.kind, treatment:feature.treatment,
      required:Boolean(feature.required), source:feature.source,
      registeredIntentId:feature.registeredIntentId || null,
      restraint:structuredClone(feature.restraint),
      mappingVariants:feature.mappingVariants.map((variant) => ({
        referenceAtomIds:variant.atomPairs.map(([referenceIndex]) =>
          reference.ligand.atomIds[referenceIndex]),
        productAtomIds:variant.atomPairs.map(([, productIndex]) =>
          product.atoms[productIndex].designAtomId),
      })),
    }));

    const removed = new Set(component.atomIndices);
    const retainedIndices = state.molecule.atoms.flatMap((_, index) => removed.has(index) ? [] : [index]);
    const retainedMap = new Map(retainedIndices.map((oldIndex, newIndex) => [oldIndex, newIndex]));
    const atoms = retainedIndices.map((index) => ({ ...state.molecule.atoms[index] }));
    const productOffset = atoms.length;
    atoms.push(...product.atoms.map((atom) => ({ ...atom })));
    const bonds = state.molecule.bonds.flatMap((bond) =>
      retainedMap.has(bond.a) && retainedMap.has(bond.b) ? [{ ...bond,
        a:retainedMap.get(bond.a), b:retainedMap.get(bond.b) }] : []);
    bonds.push(...product.bonds.map((bond) => ({ ...bond,
      a:bond.a + productOffset, b:bond.b + productOffset })));
    const priorEditRegions = Array.from(state.molecule.source?.posePropagationEditRegions || []);
    const releasedMappedRegion = releasedMappedHeavyIds.length ? [{
      schema:'molarium.docking.registered-coordinate-release/v1',
      editId:caseId || null,
      reason:'attachment-migration-within-mapped-biconnected-ring',
      releasedHeavyAtomIds:[...releasedMappedHeavyIds].sort(),
      source:'registered graph topology; no product or holdout coordinates',
    }] : [];
    const next = { ...state.molecule, atoms, bonds,
      smiles:`${state.molecule.source?.pdbId || 'PDB'} + ${productSmiles}`,
      source:{ ...(state.molecule.source || {}), dockingBenchmark:{ caseId:caseId || null,
        productSmiles, atomMapSource:posePropagationMap.source || 'atom-maps.v0.1.json' },
        posePropagationSpatialFeatures:spatialFeatureDefinitions,
        posePropagationEditRegions:[...priorEditRegions, ...releasedMappedRegion].slice(-64) } };
    delete next.parameterization;
    state.molecule = next;
    state.dockingResult = null; state.dockingPoseIndex = 0;
    state.selectedAtom = null; state.selectedAtoms = [];
    refreshStructureComponents();
    const currentLigandIndices = currentDockingLigandAtomIndices(reference);
    const currentPlan = adapter.createLigandPlan(state.molecule, currentLigandIndices,
      `benchmark-product-${caseId || 'case'}`);
    const referenceAtomIds = new Set(reference.ligand.atomIds);
    const removedBenchmarkAtomIds = posePropagationMap.deletedReferenceAtoms.flatMap((entry) => {
      const atom = beforeByAtomName.get(entry.referenceAtomName)?.atom;
      return atom?.designAtomId ? [atom.designAtomId] : [];
    });
    const addedBenchmarkHeavyIds = posePropagationMap.addedProductAtoms.map((entry) => {
      const productIndex = productHeavyIndices[entry.productAtomIndex];
      return product.atoms[productIndex]?.designAtomId;
    }).filter(Boolean);
    const commonProductOrdinalByReferenceName = new Map(
      posePropagationMap.commonAtoms.map((entry) =>
        [entry.referenceAtomName, entry.productAtomIndex]));
    const affectedProductOrdinals = new Set([
      ...Array.from(posePropagationMap.productBoundary || [])
        .map((entry) => entry.commonProductAtomIndex),
      ...Array.from(posePropagationMap.referenceBoundary || [])
        .map((entry) => commonProductOrdinalByReferenceName.get(entry.commonAtomName)),
    ].filter(Number.isInteger));
    const affectedBenchmarkCoreIds = [...affectedProductOrdinals].map((ordinal) => {
      const productIndex = productHeavyIndices[ordinal];
      return product.atoms[productIndex]?.designAtomId;
    }).filter(Boolean);
    state.molecule.source = { ...(state.molecule.source || {}),
      posePropagationGraphEdit:{
        schema:'molarium.pose-propagation-graph-edit/v1', caseId:caseId || null,
        addedAtomIds:[...addedBenchmarkHeavyIds],
        removedAtomIds:[...removedBenchmarkAtomIds],
        affectedCoreAtomIds:[...new Set(affectedBenchmarkCoreIds)].sort(),
        source:'registered reference/product graph boundaries; no product coordinates',
      } };
    const addedHeavyIdSet = new Set(addedBenchmarkHeavyIds);
    const addedBenchmarkAtomIds = currentPlan.molecule.atoms.flatMap((atom, atomIndex) => {
      if (addedHeavyIdSet.has(atom.designAtomId)) return [atom.designAtomId];
      if (atom.element !== 'H' || referenceAtomIds.has(atom.designAtomId)) return [];
      const attachedToAddedHeavy = currentPlan.molecule.bonds.some((bond) => {
        const neighbor = bond.a === atomIndex ? bond.b : bond.b === atomIndex ? bond.a : null;
        return neighbor != null && addedHeavyIdSet.has(
          currentPlan.molecule.atoms[neighbor]?.designAtomId);
      });
      return attachedToAddedHeavy ? [atom.designAtomId] : [];
    });
    const addedBenchmarkIdSet = new Set(addedBenchmarkAtomIds);
    const benchmarkEligibleAtomIndices = currentPlan.molecule.atoms.flatMap((atom, index) =>
      addedBenchmarkIdSet.has(atom.designAtomId) ? [index] : []);
    const proposals = remap.proposeLigandHydrogenBondFeatureRemaps(reference.hydrogenBonds,
      currentPlan.molecule, currentPlan.molecule.atoms.map((_, index) => index), {
        eligibleAtomIndices:benchmarkEligibleAtomIndices,
        beforeMolecule:beforeLigand,
        editRegionsOverride:{ removedAtomIds:removedBenchmarkAtomIds,
          addedAtomIds:addedBenchmarkAtomIds, changedAtomIds:[] },
      });
    const hypotheses = new Map(interactionHypotheses
      .filter((entry) => entry.kind === 'hydrogen-bond').map((entry) => [entry.capturedId, entry]));
    for (const definition of reference.hydrogenBonds) {
      const hypothesis = hypotheses.get(definition.id);
      if (!hypothesis || hypothesis.label !== definition.label)
        throw new Error(`Captured contact ${definition.id} differs from the pre-registered input`);
    }
    state.dockingContactRemaps = new Map();
    state.dockingContactRemapProposals = new Map(proposals
      .filter((proposal) => proposal.status !== 'available')
      .map((proposal) => [proposal.id, { ...proposal,
        priorEffectiveDefinition:structuredClone(reference.hydrogenBonds
          .find((definition) => definition.id === proposal.id)),
        editLineage:[{
          method:posePropagationMap.protectedReferenceAnchor?.method
            || 'pre-registered-reference-product-MCS',
          caseId:caseId || null,
          commonHeavyAtoms:posePropagationMap.commonHeavyAtoms,
          referenceBoundary:structuredClone(posePropagationMap.referenceBoundary),
          productBoundary:structuredClone(posePropagationMap.productBoundary) }],
      }]));
    const selected = new Set();
    const unavailableTargets = [], remappedTargets = [];
    for (const definition of reference.hydrogenBonds) {
      const hypothesis = hypotheses.get(definition.id);
      const proposal = proposals.find((entry) => entry.id === definition.id);
      if (proposal?.status === 'available') selected.add(definition.id);
      else if (hypothesis?.targetFeature && proposal?.candidates?.length) {
        selected.add(definition.id); remappedTargets.push({ id:definition.id,
          status:proposal.status, candidates:proposal.candidates.map((candidate) => ({
            id:candidate.id, role:candidate.role, type:candidate.type,
            matchKind:candidate.matchKind,
          })) });
      } else if (hypothesis?.targetFeature) unavailableTargets.push({ id:definition.id,
        expectedTransfer:hypothesis.expectedTransfer, status:proposal?.status || 'unavailable' });
    }
    state.dockingSelectedHbondIds = selected;
    poseTransferPlan.featureCorrespondences = [
      ...poseTransferPlan.featureCorrespondences,
      ...remappedTargets.flatMap((target) => target.candidates.map((candidate) => ({
        kind:'hydrogen-bond-role', capturedContactId:target.id,
        productFeatureId:candidate.id, role:candidate.role, type:candidate.type,
        matchKind:candidate.matchKind,
        treatment:'soft-restraint',
      }))),
    ];
    const productHeavyGraph = {
      atomCount:productHeavyIndices.length,
      bondCount:product.bonds.filter((bond) =>
        product.atoms[bond.a]?.element !== 'H'
          && product.atoms[bond.b]?.element !== 'H').length,
      atoms:productHeavyIndices.map((atomIndex) => {
        const atom = product.atoms[atomIndex];
        return { atomName:atom.atomName, element:atom.element,
          formalCharge:atomFormalCharge(atom), aromatic:Boolean(atom.aromatic) };
      }).sort((first, second) => first.atomName.localeCompare(second.atomName)),
      bonds:product.bonds.flatMap((bond) => {
        const first = product.atoms[bond.a], second = product.atoms[bond.b];
        if (!first || !second || first.element === 'H' || second.element === 'H') return [];
        return [{ atomNames:[first.atomName, second.atomName].sort(),
          order:Number(bond.order || 1),
          aromatic:Boolean(bond.aromatic || Number(bond.order) === 1.5) }];
      }).sort((first, second) => first.atomNames.join('\0').localeCompare(
        second.atomNames.join('\0'))),
    };
    updateInfo(); updateDockingUi(); updateOptimizerControls(); draw();
    return { caseId:caseId || null, productAtoms:currentPlan.molecule.atoms.length,
      productHeavyAtoms:productHeavyIndices.length,
      productHeavyGraph,
      commonHeavyAtoms:poseTransferPlan.mappedAtomPairs.length,
      selectedContactIds:[...selected], unavailableTargets, remappedTargets,
      poseTransferPlan:structuredClone(poseTransferPlan),
      proposals:proposals.map((proposal) => ({ id:proposal.id, status:proposal.status,
        ligandRole:proposal.ligandRole, candidateCount:proposal.candidates.length,
        candidateTypes:proposal.candidates.map((candidate) => candidate.type) })),
      registeredEditRegion:{ removedAtomIds:removedBenchmarkAtomIds,
        addedHeavyAtomIds:addedBenchmarkHeavyIds,
        addedAtomIds:addedBenchmarkAtomIds,
        releasedMappedAtomIds:releasedMappedHeavyIds,
        affectedCoreAtomIds:[...new Set(affectedBenchmarkCoreIds)].sort() },
      embedding:{ rdkitVersion:embedded.result.rdkitVersion,
        forcefield:embedded.result.forcefield, conformerCount:embedded.result.conformerCount,
        seed:embedded.result.conformerSeed,
        protectedReference:{
          method:posePropagationMap.protectedReferenceAnchor?.method || 'mapped-common-atoms',
          label:posePropagationMap.protectedReferenceAnchor?.label || 'registered common atoms',
          atomCount:mappedPairs.length,
          atomNames:poseTransferPlan.exactAtomPairs.map((entry) => entry.referenceAtomName),
          maxDisplacementAngstrom:protectedReferenceMaxDisplacementAngstrom,
        },
        attachedPlacement:{ method:attachedPlacement.method,
          regions:structuredClone(attachedPlacement.regions) },
        seedOnlyPlacement:{ method:seedOnlyPlacement.method,
          features:structuredClone(seedOnlyPlacement.features),
          connectorRepair:structuredClone(seedConnectorRepair) },
        spatialFeatures:spatialFeatureMappings.map((feature) => ({
          id:feature.id, kind:feature.kind,
          treatment:feature.treatment, source:feature.source,
          registeredIntentId:feature.registeredIntentId || null,
          required:Boolean(feature.required),
          restraint:structuredClone(feature.restraint),
          atomCount:feature.mappingVariants[0]?.atomPairs.length || 0,
          candidateMaps:feature.mappingVariants.length,
          seedMaxDisplacementAngstrom:Math.max(0,
            ...(feature.mappingVariants[0]?.atomPairs || []).map(
              ([referenceIndex, productIndex]) => Math.hypot(
                alignedPositions[productIndex * 3]
                  - reference.ligand.positions[referenceIndex * 3],
                alignedPositions[productIndex * 3 + 1]
                  - reference.ligand.positions[referenceIndex * 3 + 1],
                alignedPositions[productIndex * 3 + 2]
                  - reference.ligand.positions[referenceIndex * 3 + 2]))),
        })) },
    };
}

const molariumTestApi = Object.freeze({
  ...molariumTestApiBase,
  // Benchmark harness compatibility: production route actions and benchmark
  // tests share the same neutral staging implementation.
  stageBenchmarkPoseProduct:stageRegisteredDesignRouteProduct,
  benchmarkCurrentLigand() {
    const indices = currentDockingLigandAtomIndices();
    return {
      atoms:indices.map((globalAtomIndex, productAtomIndex) => {
        const atom = state.molecule.atoms[globalAtomIndex];
        return { productAtomIndex, globalAtomIndex, designAtomId:atom.designAtomId,
          benchmarkProductAtomIndex:Number.isInteger(atom.benchmarkProductAtomIndex)
            ? atom.benchmarkProductAtomIndex : null,
          atomName:atom.atomName || null, element:atom.element,
          x:Number(atom.x), y:Number(atom.y), z:Number(atom.z) };
      }),
      bonds:state.molecule.bonds.flatMap((bond) => {
        const first = indices.indexOf(bond.a), second = indices.indexOf(bond.b);
        return first >= 0 && second >= 0 ? [{ a:first, b:second, order:Number(bond.order || 1) }] : [];
      }),
    };
  },
  relaxPolarHydrogens(inputMolecule = null) {
    const molecule = structuredClone(inputMolecule || state.molecule);
    const heavyBefore = molecule.atoms.map((atom) => atom.element === 'H' ? null : [atom.x, atom.y, atom.z]);
    const relaxation = relaxPreparationPolarHydrogens(molecule);
    const heavyAtomMaximumDisplacement = molecule.atoms.reduce((maximum, atom, index) => {
      if (atom.element === 'H') return maximum;
      const before = heavyBefore[index];
      return Math.max(maximum, Math.hypot(atom.x - before[0], atom.y - before[1], atom.z - before[2]));
    }, 0);
    if (!inputMolecule) {
      pushBuildSnapshot(state.molecule);
      loadMolecule(molecule, false); updateHistoryButtons();
    }
    return { ...relaxation, heavyAtomMaximumDisplacement,
      diagnostics:polarHydrogenDiagnostics(molecule), molecule };
  },
  polarHydrogenDiagnostics() { return structuredClone(polarHydrogenDiagnostics(state.molecule)); },
  structureComponents() {
    return { summary: structureComponentSummary(), focusedComponentId:state.focusedComponentId,
      focusedComponentCenter:structuredClone(state.focusedComponentCenter),
      focusedComponentRadius:state.focusedComponentRadius,
      components: state.structureComponents.map((component) => ({
      id: component.id, kind: component.kind, label: component.label, atomCount: component.atomIndices.length,
      residueCount: component.residueCount, visible: state.componentVisibility.get(component.id) !== false,
    })) };
  },
  async waitFor2DDepiction(timeoutMs = 10000) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      const panel = document.querySelector('#structure-2d-panel');
      const svg = document.querySelector('#structure-2d-drawing svg');
      if (!panel.classList.contains('hidden') && !panel.dataset.pending && svg) return this.twoDDepiction();
      if (panel.dataset.error) throw new Error(`${panel.dataset.error} [${state.molecule?.name || 'no molecule'}; `
        + `${state.molecule?.atoms?.length || 0} atoms; ${state.molecule?.bonds?.length || 0} bonds; `
        + `${state.chemistryTransaction?.editCount || 0} pending edits]`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Timed out waiting for the 2D depiction');
  },
  twoDDepiction() {
    const panel = document.querySelector('#structure-2d-panel');
    const svg = document.querySelector('#structure-2d-drawing svg');
    return { visible:!panel.classList.contains('hidden'), label:document.querySelector('#structure-2d-label').textContent,
      atomIndices:state.depictionGlobalAtomIndices.slice(), bondPairs:structuredClone(state.depictionGlobalBondPairs),
      heavyAtomCount:state.depictionGlobalAtomIndices.length,
      bondCount:state.depictionGlobalBondPairs.length,
      componentId:state.depictionComponentId,
      pinnedLigand:structuredClone(state.depictionPinnedLigand),
      error:panel.dataset.error || null,
      selectedAtoms:state.selectedAtoms.slice(), tool:state.depictionTool, mode:state.mode,
      pendingChanges:state.chemistryTransaction?.editCount || 0,
      hasSvg:Boolean(svg), atomClasses:svg?.querySelectorAll('[class*="atom-"]').length || 0,
      rdkitVersion:panel.dataset.rdkitVersion || null,
      alignedAtoms:Number(panel.dataset.alignedAtoms || 0),
      alignmentBackend:panel.dataset.alignmentBackend || null };
  },
  select2DAtom(localIndex) { selectDepictionAtom(Number(localIndex)); return this.twoDDepiction(); },
  set2DTool(tool) {
    if (!['select', 'atom', 'bond', 'erase'].includes(tool)) throw new Error(`Unknown 2D tool ${tool}`);
    if (tool !== 'select') setMode('build');
    state.depictionTool = tool; state.depictionBondStart = null; update2DEditorUi();
    return this.twoDDepiction();
  },
  async draw2DAtom(localIndex, element = 'C') {
    setMode('build'); state.depictionTool = 'atom'; state.selectedElement = element;
    const globalIndex = state.depictionGlobalAtomIndices[Number(localIndex)];
    const result = await runDepictionEdit(() => addDepictionAtom(globalIndex, element));
    return { result, depiction:this.twoDDepiction(), current:this.current() };
  },
  async set2DBond(firstLocalIndex, secondLocalIndex, order = 1) {
    setMode('build'); state.depictionTool = 'bond'; state.depictionBondOrder = Number(order);
    const first = state.depictionGlobalAtomIndices[Number(firstLocalIndex)];
    const second = state.depictionGlobalAtomIndices[Number(secondLocalIndex)];
    const result = await runDepictionEdit(() => applyDepictionBond(first, second, Number(order)));
    return { result, depiction:this.twoDDepiction(), current:this.current() };
  },
  currentPreparationReport() { return structuredClone(proteinPreparationReport(state.molecule)); },
  async prepareCurrentPdb() { return prepareCurrentPdb(); },
  parse(smiles) {
    const molecule = parseSMILES(smiles);
    return { ...moleculeDiagnostics(molecule), molecule: structuredClone(molecule) };
  },
  attach(baseSmiles, fragmentId, targetIndex = 0) {
    const fragment = FRAGMENTS.find((item) => item.id === fragmentId);
    if (!fragment) throw new Error(`Unknown fragment ${fragmentId}`);
    const molecule = mergeFragmentIntoMolecule(parseSMILES(baseSmiles), fragment, targetIndex);
    return { ...moleculeDiagnostics(molecule), molecule: structuredClone(molecule) };
  },
  addElement(baseSmiles, element, targetIndex = 0) {
    if (!ELEMENTS[element]) throw new Error(`Unknown element ${element}`);
    const molecule = addElementToMolecule(parseSMILES(baseSmiles), element, targetIndex);
    return { ...moleculeDiagnostics(molecule), molecule: structuredClone(molecule) };
  },
  load(smiles) {
    state.buildHistory = []; state.redoHistory = [];
    loadMolecule(parseSMILES(smiles)); updateHistoryButtons();
    return moleculeDiagnostics(state.molecule);
  },
  async loadSmilesWithRdkit(smiles, name = 'SMILES structure') {
    const { molecule, result } = await createRdkitSmilesMolecule(smiles, name);
    state.buildHistory = []; state.redoHistory = [];
    loadMolecule(molecule); updateHistoryButtons();
    return { ...moleculeDiagnostics(state.molecule), finalEnergy:result.finalEnergy,
      forcefield:result.forcefield, fallback:result.fallback, conformerCount:result.conformerCount,
      bestIndex:result.bestIndex, source:structuredClone(state.molecule.source) };
  },
  async enumerateProtonation(smiles, options = {}) {
    const result = await enumerateLigandProtonation(smiles, options);
    return structuredClone(result);
  },
  async applyProtonationState(index = 0) {
    const select = document.querySelector('#ligand-protonation-state');
    select.value = String(index); updateLigandProtonationMeta();
    const { molecule } = await applySelectedLigandProtonation();
    return { ...moleculeDiagnostics(molecule), molecule:structuredClone(molecule),
      protonation:structuredClone(molecule.source?.protonation) };
  },
  loadObject(molecule) {
    state.buildHistory = []; state.redoHistory = [];
    loadMolecule(structuredClone(molecule)); updateHistoryButtons();
    return moleculeDiagnostics(state.molecule);
  },
  async loadRosemaryExample() { return loadRosemaryProteinExample(); },
  async loadPreparedFixture(url) { return loadPreparedProteinFixture(url); },
  attachCurrent(fragmentId, targetIndex = 0) {
    const fragment = FRAGMENTS.find((item) => item.id === fragmentId);
    if (!fragment) throw new Error(`Unknown fragment ${fragmentId}`);
    pushBuildHistory(); state.molecule = mergeFragmentIntoMolecule(state.molecule, fragment, targetIndex);
    refreshStructureComponents();
    updateInfo(); updateHistoryButtons(); draw();
    return moleculeDiagnostics(state.molecule);
  },
  addElementCurrent(element, targetIndex = 0) {
    if (!ELEMENTS[element]) throw new Error(`Unknown element ${element}`);
    pushBuildHistory(); state.molecule = addElementToMolecule(state.molecule, element, targetIndex);
    refreshStructureComponents();
    updateInfo(); updateHistoryButtons(); draw();
    return moleculeDiagnostics(state.molecule);
  },
  setInternalCoordinate(indices, value, moveConnected = true) {
    if (!Array.isArray(indices) || indices.length < 2 || indices.length > 4)
      throw new Error('Internal coordinates require 2 to 4 atom indices');
    state.selectedAtoms = indices.slice(); state.selectedAtom = indices.at(-1);
    document.querySelector('#move-connected').checked = Boolean(moveConnected);
    updateGeometryControl();
    const before = geometrySelection();
    if (!before || before.error) throw new Error(before?.error || 'Invalid geometry selection');
    beginGeometryEdit();
    if (!applyGeometryValue(value)) { finishGeometryEdit(); throw new Error('Internal-coordinate edit failed'); }
    finishGeometryEdit();
    const after = geometrySelection();
    return { kind: after.kind, value: after.value, unit: after.unit, ...moleculeDiagnostics(state.molecule) };
  },
  internalCoordinate(indices) {
    state.selectedAtoms = indices.slice(); state.selectedAtom = indices.at(-1);
    updateGeometryControl();
    const coordinate = geometrySelection();
    if (!coordinate || coordinate.error) throw new Error(coordinate?.error || 'Invalid geometry selection');
    return { kind: coordinate.kind, value: coordinate.value, unit: coordinate.unit };
  },
  async minimiseCurrent() {
    const optimization = await minimizeMolecule();
    return { ...moleculeDiagnostics(state.molecule), optimization };
  },
  async optimizeSelectedBuildCurrent() {
    const optimization = await runSelectedBuildOptimization();
    return { ...moleculeDiagnostics(state.molecule), optimization,
      source:structuredClone(state.molecule?.source || {}) };
  },
  async polishCurrentSmallMolecule() {
    const result = await polishSmallMoleculeCoordinates(state.molecule);
    if (!result) throw new Error('The current structure is not eligible for RDKit geometry polishing');
    return { ...moleculeDiagnostics(state.molecule), initialEnergy:result.initialEnergy,
      finalEnergy:result.finalEnergy, forcefield:result.forcefield, fallback:result.fallback,
      elapsedMs:result.elapsedMs, source:structuredClone(state.molecule.source) };
  },
  async editAtomCurrent(index, element, formalCharge = 0) {
    state.selectedAtoms = [index]; state.selectedAtom = index; updateGeometryControl();
    return runImmediateChemistryTestEdit(() => applySelectedAtomChemistry(element, formalCharge));
  },
  async editBondCurrent(first, second, order = 1) {
    state.selectedAtoms = [first, second]; state.selectedAtom = second; updateGeometryControl();
    return runImmediateChemistryTestEdit(() => applySelectedBondChemistry(order));
  },
  async deleteBondCurrent(first, second) {
    state.selectedAtoms = [first, second]; state.selectedAtom = second; updateGeometryControl();
    return runImmediateChemistryTestEdit(() => deleteSelectedBondChemistry());
  },
  async deleteAtomCurrent(index) {
    state.selectedAtoms = [index]; state.selectedAtom = index; updateGeometryControl();
    return runImmediateChemistryTestEdit(() => deleteSelectedAtomChemistry());
  },
  async addHydrogenCurrent(index) {
    state.selectedAtoms = [index]; state.selectedAtom = index; updateGeometryControl();
    return runImmediateChemistryTestEdit(() => addSelectedHydrogenChemistry());
  },
  async removeHydrogenCurrent(index) {
    state.selectedAtoms = [index]; state.selectedAtom = index; updateGeometryControl();
    return runImmediateChemistryTestEdit(() => removeSelectedHydrogenChemistry());
  },
  async stageBondCurrent(first, second, order = 1) {
    state.chemistryEditPolicy = 'staged';
    document.querySelector('#chemistry-immediate-refine').checked = false;
    state.selectedAtoms = [first, second]; state.selectedAtom = second; updateGeometryControl();
    return applySelectedBondChemistry(order);
  },
  async stageAtomCurrent(index, element, formalCharge = 0) {
    state.chemistryEditPolicy = 'staged';
    document.querySelector('#chemistry-immediate-refine').checked = false;
    state.selectedAtoms = [index]; state.selectedAtom = index; updateGeometryControl();
    return applySelectedAtomChemistry(element, formalCharge);
  },
  async stageDeleteAtomCurrent(index) {
    state.chemistryEditPolicy = 'staged';
    document.querySelector('#chemistry-immediate-refine').checked = false;
    state.selectedAtoms = [index]; state.selectedAtom = index; updateGeometryControl();
    return deleteSelectedAtomChemistry();
  },
  async stageAddElementCurrent(element, targetIndex) {
    if (!ELEMENTS[element]) throw new Error(`Unknown element ${element}`);
    state.chemistryEditPolicy = 'staged';
    document.querySelector('#chemistry-immediate-refine').checked = false;
    state.selectedAtoms = [targetIndex]; state.selectedAtom = targetIndex; updateGeometryControl();
    return applyChemistryMutation((molecule) => {
      const existingAtoms = new Set(molecule.atoms);
      const target = molecule.atoms[targetIndex];
      addElementToMolecule(molecule, element, targetIndex);
      const added = molecule.atoms.filter((atom) => !existingAtoms.has(atom));
      return { selection:added.length ? [added[0]] : [target], changedAtoms:[target, ...added] };
    });
  },
  async finishChemistryCurrent() { return finishChemistryTransaction(); },
  discardChemistryCurrent() { return discardChemistryTransaction(); },
  chemistryTransaction() {
    return state.chemistryTransaction ? {
      editCount:state.chemistryTransaction.editCount,
      changedAtomCount:[...state.chemistryTransaction.changedAtoms]
        .filter((atom) => state.molecule?.atoms.includes(atom)).length,
      finishing:state.chemistryEditFinishing,
    } : null;
  },
  dockingContactResolutions() {
    return {
      remaps:[...state.dockingContactRemaps.values()].map((entry) => structuredClone(entry.audit)),
      remapChains:[...state.dockingContactRemaps.entries()].map(([contactId, entry]) => ({
        contactId, chain:structuredClone(entry.chain || [entry.audit]),
      })),
      proposals:[...state.dockingContactRemapProposals.values()].map((entry) => ({
        id:entry.id, status:entry.status, ligandRole:entry.ligandRole,
        boundaryAnchorIds:[...(entry.boundaryAnchorIds || [])],
        cumulativeEditRegionAtomIds:[...(entry.cumulativeEditRegionAtomIds || [])],
        editLineage:structuredClone(entry.editLineage || []),
        candidates:entry.candidates.map((candidate) => ({ id:candidate.id, label:candidate.label,
          atomIds:[...candidate.atomIds],
          boundaryAnchorIds:[...(candidate.boundaryAnchorIds || [])] })),
      })),
      selectedIds:[...state.dockingSelectedHbondIds],
    };
  },
  localPolishSelection(changedAtomIndices, bondRadius = 2) {
    const plan = localEditPolishPlan(state.molecule, changedAtomIndices, bondRadius);
    const movableAtomIndices = plan?.movableGlobalAtomIndices
      || localPolishMovableAtomIndices(state.molecule, changedAtomIndices, bondRadius);
    const movable = new Set(movableAtomIndices);
    return { movableAtomIndices,
      fixedAtomIndices:state.molecule.atoms.flatMap((_, index) => movable.has(index) ? [] : [index]),
      cleanupMode:plan?.cleanupMode || 'free-local',
      fixedInheritedHeavyAtomCount:plan?.fixedInheritedHeavyAtomCount || 0,
      scope:plan?.scope || 'molecule' };
  },
  async calculateCurrent(job = 'energy', method = 'webgpu', options = {}) {
    document.querySelector('#job-select').value = job;
    document.querySelector('#method-select').value = method;
    updateOptimizerControls();
    document.querySelector('#job-select').value = job;
    const result = await runCalculation({ job, method, options });
    if (!result) throw new Error(`Could not start ${method}/${job}; calculating=${state.calculating}, molecule=${Boolean(state.molecule)}`);
    return {
      job: result.job,
      initialEnergy: result.initialEnergy,
      finalEnergy: result.finalEnergy,
      rdkitVersion: result.rdkitVersion,
      openmmVersion: result.openmmVersion,
      chargeModel: result.chargeModel,
      sourceSha256: result.sourceSha256,
      openmmWasmSha256: result.openmmWasmSha256,
      numericSystemSha256: result.numericSystemSha256,
      parameterizedSystemSha256: result.parameterizedSystemSha256,
      inputPositionsJsonSha256: result.inputPositionsJsonSha256,
      parameterCounts: result.parameterCounts,
      forcefield: result.forcefield,
      model: result.model,
      modelLevel: result.modelLevel,
      modelSourceSha256: result.modelSourceSha256,
      modelEvaluations: result.modelEvaluations,
      inferenceBatches: result.inferenceBatches,
      inferenceBatchSize: result.inferenceBatchSize,
      aevBuildMs: result.aevBuildMs,
      networkMs: result.networkMs,
      forceContractionMs: result.forceContractionMs,
      descriptorBackend: result.descriptorBackend,
      initialEnsembleStdDev: result.initialEnsembleStdDev,
      finalEnsembleStdDev: result.finalEnsembleStdDev,
      rmsForce: result.rmsForce,
      maximumForce: result.maximumForce,
      convergenceReason: result.convergenceReason,
      iterations: result.iterations,
      implicitSolvent: result.implicitSolvent || null,
      fallback: result.fallback,
      converged: result.converged,
      platform: result.platform,
      backend: result.backend,
      elapsedMs: result.elapsedMs,
      unit: result.unit,
      timestepFs: result.timestepFs,
      constraintMode: result.constraintMode || 'none',
      constraintCount: result.constraintCount || 0,
      constraintError: result.constraintError,
      constraintIterations: result.constraintIterations,
      constraintsConverged: result.constraintsConverged,
      cutoffNm: result.cutoffNm,
      neighborRadiusNm: result.neighborRadiusNm,
      movableAtomCount:result.movableAtomCount || state.molecule?.atoms.length || 0,
      fixedAtomCount:result.fixedAtomCount || 0,
      method,
      frameCount: state.calculationFrames.length,
      replicaCount: result.replicaCount || 1,
      replicaIndex: state.calculationReplicaIndex,
      stormmSystem: result.stormmSystem || null,
      frameEnergies: state.calculationFrames.map((frame) => frame.energy),
      forces: result.forces ? Array.from(result.forces) : null,
      conformerCount: result.conformerAnalysis?.count || null,
      conformerClusterCount: result.conformerAnalysis?.clusterCount || null,
      conformerBestIndex: result.conformerAnalysis?.bestIndex ?? null,
      conformerEnergyOffsets: result.conformerAnalysis
        ? Array.from(result.conformerAnalysis.energyOffsets) : null,
      conformerRmsds: result.conformerAnalysis
        ? Array.from(result.conformerAnalysis.rmsdsToBest) : null,
      conformerTorsionDistances: result.conformerAnalysis
        ? Array.from(result.conformerAnalysis.torsionDistances) : null,
      conformerRadiiOfGyration: result.conformerAnalysis
        ? Array.from(result.conformerAnalysis.radiiOfGyration) : null,
      conformerTorsionCount: result.conformerAnalysis?.torsionCount || 0,
      conformerSeedWorkerCount: result.conformerSeedWorkerCount || null,
      conformerSeedGeneratedCount: result.conformerSeedGeneratedCount || null,
      conformerSeedElapsedMs: result.seedElapsedMs || null,
      ani2xModelEvaluations: result.ani2xModelEvaluations || null,
      ani2xInferenceBatches: result.ani2xInferenceBatches || null,
      ani2xBatchSize: result.ani2xBatchSize || null,
      ani2xRescoreMs: result.ani2xRescoreMs || null,
      ani2xRescoreModelEvaluations: result.ani2xRescoreModelEvaluations || null,
      ani2xRescoreInferenceBatches: result.ani2xRescoreInferenceBatches || null,
      ani2xRescoreLaneMaximumDifference: result.ani2xRescoreLaneMaximumDifference,
      ani2xAevBuildMs: result.ani2xAevBuildMs || null,
      ani2xNetworkMs: result.ani2xNetworkMs || null,
      ani2xForceContractionMs: result.ani2xForceContractionMs || null,
      ani2xDescriptorBackend: result.ani2xDescriptorBackend || null,
      conformerArenaSeedCount: result.arenaSeedCount || null,
      conformerArena: result.arena ? {
        judge: result.arena.judge,
        clusterCount: result.arena.clusterCount,
        lowEnergyClusterCount: result.arena.lowEnergyClusterCount,
        stormmRescoreConsistency: structuredClone(result.arena.stormmRescoreConsistency),
        environments: structuredClone(result.arena.environments),
        ani2xIncluded: result.arena.ani2xIncluded,
        ani2xModelEvaluations: result.arena.ani2xModelEvaluations,
        ani2xInferenceBatches: result.arena.ani2xInferenceBatches,
        ani2xBatchSize: result.arena.ani2xBatchSize,
        ani2xRescoreAvailable: result.arena.ani2xRescoreAvailable,
        ani2xRescoreUnavailableReason: result.arena.ani2xRescoreUnavailableReason,
        ani2xRescoreMs: result.arena.ani2xRescoreMs,
        ani2xRescoreModelEvaluations: result.arena.ani2xRescoreModelEvaluations,
        ani2xRescoreInferenceBatches: result.arena.ani2xRescoreInferenceBatches,
        ani2xRescoreLaneMaximumDifference: result.arena.ani2xRescoreLaneMaximumDifference,
        ani2xAevBuildMs: result.arena.ani2xAevBuildMs,
        ani2xNetworkMs: result.arena.ani2xNetworkMs,
        ani2xForceContractionMs: result.arena.ani2xForceContractionMs,
        ani2xDescriptorBackend: result.arena.ani2xDescriptorBackend,
        skippedMethods: result.arena.skippedMethods.map((entry) => ({ ...entry })),
        methods: result.arena.methods.map((entry) => ({ ...entry })),
      } : null,
    };
  },
  async parameterizeCurrent() {
    return runOpenMMJob('parameters', state.molecule, () => {});
  },
  setDockingSelection(indices) {
    state.selectedAtoms = Array.from(indices || [], Number);
    state.selectedAtom = state.selectedAtoms.at(-1) ?? null;
    updateGeometryControl(); updateDockingUi(); draw();
    return { selected:[...state.selectedAtoms], status:document.querySelector('#docking-status').textContent,
      captureDisabled:document.querySelector('#capture-docking-reference').disabled };
  },
  setDockingMode(mode) {
    document.querySelector('#docking-mode').value = mode === 'selected-core'
      ? 'selected-core' : 'propagate';
    updateDockingUi();
    return { mode:selectedDockingMode(), status:document.querySelector('#docking-status').textContent,
      captureDisabled:document.querySelector('#capture-docking-reference').disabled };
  },
  setDockingEditCleanup(mode) {
    document.querySelector('#docking-edit-cleanup').value = mode === 'free-local'
      ? 'free-local' : 'preserve-reference';
    updateDockingUi(); updateOptimizerControls();
    return { mode:selectedDockingEditCleanup(),
      visible:!document.querySelector('#docking-cleanup-field').classList.contains('hidden') };
  },
  async captureDockingReference() {
    const reference = await captureCurrentDockingReference();
    return { mode:reference.mode, coreAtomIds:[...reference.ligand.coreAtomIds],
      ligandAtomCount:reference.ligand.atomIds.length,
      receptorAtomCount:reference.receptorSite.atoms.length,
      hydrogenBonds:reference.hydrogenBonds.map((entry) => ({
        id:entry.id, label:entry.label, receptorRole:entry.receptorRole,
        referenceGeometry:structuredClone(entry.referenceGeometry || null),
        participants:Object.fromEntries(['donor', 'hydrogen', 'acceptor'].map((role) => {
          const participant = entry[role];
          return [role, participant?.scope === 'receptor'
            ? { scope:'receptor', point:structuredClone(participant.point) }
            : { scope:'ligand', designAtomId:participant?.designAtomId,
              referencePoint:structuredClone(participant?.referencePoint || null) }];
        })),
      })) };
  },
  async runConstrainedDocking(options = {}) {
    const result = await runBrowserConstrainedDocking(options);
    const { verifyLabbook, sha256Object } = await import('./docking/labbook.mjs');
    return { mode:result.mode, candidates:result.run.candidates.length, feasible:result.run.feasibleCount,
      distinctPoses:result.distinctPoseEntries?.length || 0,
      distinctFeasible:result.distinctFeasibleCount || 0,
      topPoses:result.run.candidates.slice(0, 5).map((pose) => ({
        rank:pose.rank, feasible:pose.feasible,
        atoms:result.plan.molecule.atoms.flatMap((atom, atomIndex) =>
          Number.isInteger(atom.benchmarkProductAtomIndex) ? [{
            productAtomIndex:atom.benchmarkProductAtomIndex,
            element:atom.element,
            x:Number(pose.positions[atomIndex * 3]),
            y:Number(pose.positions[atomIndex * 3 + 1]),
            z:Number(pose.positions[atomIndex * 3 + 2]),
          }] : []),
      })),
      selected:{ rank:result.run.selected.rank, feasible:result.run.selected.feasible,
        scoreKcalMol:result.run.selected.totalScoreKcalMol,
        physicalKcalMol:result.run.selected.physicalEnergyKcalMol,
        constraintPenaltyKcalMol:result.run.selected.constraintPenaltyKcalMol,
        physicalComponents:result.run.selected.physicalDetails ? {
          lennardJonesKcalMol:result.run.selected.physicalDetails.lennardJonesKcalMol,
          coulombKcalMol:result.run.selected.physicalDetails.coulombKcalMol,
          ligandStrainKcalMol:result.run.selected.physicalDetails.ligandStrainKcalMol,
          interactionKcalMol:result.run.selected.physicalDetails.interactionKcalMol,
          interactionReferenceKcalMol:
            result.run.selected.physicalDetails.interactionReferenceKcalMol,
          relativeInteractionKcalMol:result.run.selected.physicalDetails.relativeInteractionKcalMol,
          stericClashes:result.run.selected.physicalDetails.stericClashes,
          chemicalValidity:structuredClone(
            result.run.selected.physicalDetails.chemicalValidity || null),
        } : null,
        coreRmsdAngstrom:result.run.selected.core.rmsdAngstrom,
        hydrogenBonds:structuredClone(result.run.selected.hydrogenBonds),
        refinement:{ method:result.run.selected.refinement?.method || null,
          rotatableBondCount:result.run.selected.refinement?.rotatableBondCount || 0,
          ringCrankshaftMoveCount:result.run.selected.refinement?.ringCrankshaftMoveCount || 0,
          proposals:result.run.selected.refinement?.proposals || 0,
          accepted:result.run.selected.refinement?.accepted || 0,
          improved:result.run.selected.refinement?.improved || 0,
          stageOutcome:result.run.selected.refinement?.stageOutcome || null,
          captureFeasible:Boolean(result.run.selected.refinement?.captureFeasible),
          physicalRefinementAttempted:Boolean(
            result.run.selected.refinement?.physicalRefinementAttempted),
          capture:structuredClone(result.run.selected.refinement?.capture || null),
          physicalRefinement:structuredClone(
            result.run.selected.refinement?.physicalRefinement || null),
          relaxation:structuredClone(result.run.selected.refinement?.relaxation || null) } },
      labbook:await verifyLabbook(result.labbook),
      selectedCoordinatesSha256:await sha256Object(Array.from(result.run.selected.positions)),
      coordinatePayloadIncluded:result.labbook.inputs.coordinatePayloadIncluded,
      ligandForcefield:result.ligandForcefield,
      conformerForcefields:[...result.conformerForcefields],
    };
  },
  async applyDockingPose(index = 0) {
    state.dockingPoseIndex = Number(index); const pose = await applySelectedDockingPose();
    return { rank:pose.rank, feasible:pose.feasible,
      scoreKcalMol:pose.totalScoreKcalMol, molecule:structuredClone(state.molecule) };
  },
  dockingLabbook() { return state.dockingResult ? structuredClone(state.dockingResult.labbook) : null; },
  dockingValidationNumericSystem() {
    return state.dockingResult?.validationNumericSystem
      ? structuredClone(state.dockingResult.validationNumericSystem) : null;
  },
  async scoreDockingLigandForValidation() {
    const prepared = dockingValidationLigandMolecule();
    if (!prepared) throw new Error('The exact docking ligand validation System is unavailable.');
    const summarize = (result, forceUnit) => ({
      job:result.job, finalEnergy:Number(result.finalEnergy), unit:result.unit,
      forces:Array.from(result.forces || [], Number), forceUnit,
      forcefield:result.forcefield || null,
      chargeModel:result.chargeModel || null, sourceSha256:result.sourceSha256 || null,
      model:result.model || null, modelLevel:result.modelLevel || null,
      modelSourceSha256:result.modelSourceSha256 || null,
      platform:result.platform || null, backend:result.backend || null,
      openmmVersion:result.openmmVersion || null,
      descriptorBackend:result.descriptorBackend || null,
      ensembleStdDevKcalMol:result.finalEnsembleStdDev ?? null,
    });
    const sageReference = await runOpenMMJob('energy', prepared.molecule, () => {});
    const sage = await runWebGPUJob('energy', prepared.molecule, () => {});
    const ani2x = await runAni2xJob('energy', prepared.unparameterizedMolecule, () => {});
    return {
      atomIds:[...prepared.atomIds],
      sageReference:summarize(sageReference, 'kJ/mol/nm'),
      sage:summarize(sage, 'kJ/mol/nm'),
      ani2x:summarize(ani2x, 'kcal/mol/angstrom'),
    };
  },
  async tuneStormmReplicas(options = {}) {
    const result = await tuneStormmReplicas(options);
    return result ? structuredClone(result) : null;
  },
  stormmReplicaOptions() {
    return {
      selected:Number(document.querySelector('#stormm-replica-count').value),
      options:[...document.querySelector('#stormm-replica-count').options].map((option) => ({
        count:Number(option.value), disabled:option.disabled, label:option.textContent,
      })),
      status:document.querySelector('#stormm-tuning-status').textContent,
    };
  },
  async foldProteinWithA3m(sequence, documents, recycles = 1) {
    const [{ foldProtein, BrowserOpenFoldBackend }, { ProvidedMsaProvider }] = await Promise.all([
      import('./openfold/predictor.js'), import('./openfold/msa-client.js'),
    ]);
    const result = await foldProtein({ sequence, msaProvider: new ProvidedMsaProvider(documents),
      backend: new BrowserOpenFoldBackend({ recycles }) });
    applyProteinPrediction(result);
    return { sequence: result.sequence, provider: result.provider, recycles: result.recycles,
      bucketResidues: result.bucketResidues,
      msaDepth: result.msaDepth, meanPlddt: result.meanPlddt, ptm: result.ptm,
      atomCount: result.atoms.length, elapsedMs: result.elapsedMs };
  },
  lastCalculation() { return state.lastCalculation ? { ...state.lastCalculation } : null; },
  calculationFrames() {
    const replicaRmsds = state.calculationEnsemble
      ? Array.from(ensembleReplicaRmsds(state.calculationEnsemble)) : null;
    const diagnostics = analyzeTrajectoryFrames(
      state.calculationRawFrames.length ? state.calculationRawFrames : state.calculationFrames,
      state.molecule,
      state.calculationConstraintMode,
    );
    return {
      count: state.calculationFrames.length,
      index: state.calculationFrameIndex,
      energies: state.calculationFrames.map((frame) => frame.energy),
      steps: state.calculationFrames.map((frame) => frame.step),
      job: state.calculationJob,
      timestepFs: state.calculationTimestepFs,
      playing: state.calculationPlaying,
      replicaCount: state.calculationEnsemble?.replicaCount || 1,
      replicaIndex: state.calculationReplicaIndex,
      replicaRmsd: replicaRmsds?.[state.calculationReplicaIndex] ?? null,
      replicaRmsds,
      alignment: state.conformerDisplayAlignment ? {
        mode:'symmetry-aware heavy-atom rigid fit',
        referenceReplica:state.conformerDisplayAlignment.referenceReplica,
        heavyAtomCount:state.conformerDisplayAlignment.symmetry.heavyAtoms.length,
        symmetryMappingCount:state.conformerDisplayAlignment.symmetry.mappings.length,
        symmetryTruncated:state.conformerDisplayAlignment.symmetry.truncated,
      } : state.trajectoryDisplayAlignment ? {
        mode:'fixed-identity heavy-atom rigid fit',
        referenceFrame:state.trajectoryDisplayAlignment.referenceFrame,
        referenceGeometry:state.trajectoryDisplayAlignment.referenceGeometry,
        sharedAcrossReplicas:state.trajectoryDisplayAlignment.sharedAcrossReplicas,
        heavyAtomCount:state.trajectoryDisplayAlignment.atomIndices.length,
        displayOnly:true,
      } : null,
      diagnostics,
      conformerAnalysis: state.conformerAnalysis ? {
        count: state.conformerAnalysis.count,
        bestIndex: state.conformerAnalysis.bestIndex,
        clusterCount: state.conformerAnalysis.clusterCount,
        clusterIds: Array.from(state.conformerAnalysis.clusterIds),
        energyOffsets: Array.from(state.conformerAnalysis.energyOffsets),
        rmsdsToBest: Array.from(state.conformerAnalysis.rmsdsToBest),
        torsionDistances: Array.from(state.conformerAnalysis.torsionDistances),
        radiiOfGyration: Array.from(state.conformerAnalysis.radiiOfGyration),
        torsionCount: state.conformerAnalysis.torsionCount,
        representativeIndices: [...state.conformerAnalysis.representativeIndices],
        methodIds: state.conformerAnalysis.methodIds?.slice() || null,
        seedIndices: state.conformerAnalysis.seedIndices
          ? Array.from(state.conformerAnalysis.seedIndices) : null,
        energies: Array.from(state.conformerAnalysis.energies),
        scoreSeries: Object.fromEntries(Object.entries(state.conformerAnalysis.nativeScoreSeries || {})
          .map(([key, series]) => [key, {
            label:series.label, provenance:series.provenance,
            energies:Array.from(series.energies), offsets:Array.from(series.offsets),
          }])),
      } : null,
    };
  },
  trajectoryDiagnostics() {
    return analyzeTrajectoryFrames(
      state.calculationRawFrames.length ? state.calculationRawFrames : state.calculationFrames,
      state.molecule,
      state.calculationConstraintMode,
    );
  },
  fittedRmsd(reference, candidate, atomIndices) {
    return fittedRmsd(Float64Array.from(reference), Float64Array.from(candidate), atomIndices);
  },
  alignedPositions(reference, candidate, atomIndices) {
    return Array.from(applyRigidFit(Float64Array.from(candidate), fittedRigidTransform(
      Float64Array.from(reference), Float64Array.from(candidate), atomIndices,
    )));
  },
  selectCalculationFrame(index) { selectCalculationFrame(index); return this.calculationFrames(); },
  selectCalculationReplica(index) { selectCalculationReplica(index); return this.calculationFrames(); },
  viewerState() {
    return {
      rotation:{ ...state.rotation }, scale:state.projection?.scale || null, zoom:state.zoom,
      center:state.projection?.center ? { ...state.projection.center } : null,
      pan:{ ...state.viewPan },
      atoms: (state.projected || []).map((atom) => ({ index: atom.index, sx: atom.sx, sy: atom.sy })),
    };
  },
  atomStyle(index) {
    const atom = state.molecule?.atoms?.[index];
    if (!atom) return null;
    return { ...atomRenderStyle({ ...atom, index }) };
  },
  panViewer(deltaX, deltaY) {
    state.viewPan.x += Number(deltaX || 0); state.viewPan.y += Number(deltaY || 0);
    draw();
    return { ...state.viewPan };
  },
  rotateViewer(from, to) {
    const start = normaliseVector(from, { x: 0, y: 0, z: 1 });
    const end = normaliseVector(to, { x: 0, y: 0, z: 1 });
    state.rotation = normaliseQuaternion(multiplyQuaternions(quaternionFromUnitVectors(start, end), state.rotation));
    draw();
    return { rotation: { ...state.rotation }, scale: state.projection?.scale || null, zoom: state.zoom };
  },
  setRepresentation(value) {
    if (!['cartoon', 'both', 'ball-stick'].includes(value)) throw new Error(`Unknown representation ${value}`);
    state.representation = value;
    document.querySelector('#representation-select').value = value;
    updateInfo(); draw();
    return value;
  },
  setPocketAtoms(value) {
    state.showPocketAtoms = Boolean(value);
    document.querySelector('#pocket-toggle').checked = state.showPocketAtoms;
    updateInfo(); draw();
    return this.pocketDiagnostics();
  },
  setPocketAtomMode(value) {
    if (!['radius', 'contacts'].includes(value)) throw new Error(`Unknown pocket atom mode ${value}`);
    state.pocketAtomMode = value;
    updateInfo(); draw();
    return this.pocketDiagnostics();
  },
  benchmarkViewer(iterations = 3) {
    const count = Math.max(1, Math.min(20, Math.round(Number(iterations) || 1)));
    const started = performance.now();
    for (let index = 0; index < count; index++) draw();
    const elapsedMs = performance.now() - started;
    return { iterations: count, elapsedMs, meanMs: elapsedMs / count,
      representation: state.representation, projectedAtoms: state.projected?.length || 0 };
  },
  focusResidue(atomIndex = null) {
    setFocusedResidue(atomIndex);
    return { key:state.focusedResidueKey, radius:state.focusedResidueRadius,
      center:{ ...state.projection?.center }, scale:state.projection?.scale || null };
  },
  renderDiagnostics() {
    const cycles = state.molecule ? findRingCycles(state.molecule) : [];
    const interactions = state.molecule ? nonCovalentInteractions(state.molecule, cycles)
      : { hydrogenBonds:[], piStacks:[] };
    return {
      ringCount: cycles.length,
      aromaticDoubleBonds: state.molecule ? aromaticDoubleBonds(state.molecule, cycles).size : 0,
      showHulls: state.showHulls,
      showInteractions:state.showInteractions,
      hydrogenBonds:interactions.hydrogenBonds.map((bond) => ({ ...bond })),
      piStacks:interactions.piStacks.map((stack) => ({ ...stack,
        first:[...stack.first], second:[...stack.second] })),
      focusedResidueKey:state.focusedResidueKey,
    };
  },
  pocketDiagnostics() {
    if (!state.molecule) return { radius:LIGAND_POCKET_RADIUS_ANGSTROM, ligandAtomCount:0,
      residueKeys:[], pocketAtomCount:0, hydrogenBonds:[], piStacks:[] };
    const selection = cartoonAtomSelection(state.molecule);
    const cycles = findRingCycles(state.molecule, 12, selection.allowedIndices);
    const interactions = nonCovalentInteractions(state.molecule, cycles, selection.allowedIndices);
    const counts = interactionCounts(interactions);
    return {
      radius:selection.radius,
      mode:state.pocketAtomMode,
      radiusResidueCount:selection.radiusResidueCount ?? selection.pocketResidueKeys.size,
      ligandAtomCount:selection.ligandIndices.size,
      residueKeys:[...selection.pocketResidueKeys].sort(),
      pocketAtomCount:selection.pocketAtomIndices.size,
      renderedChemistryAtomCount:selection.allowedIndices.size,
      ligandHydrogenBondCount:counts.ligandHydrogenBonds,
      ligandPiStackCount:counts.ligandPiStacks,
      hydrogenBonds:interactions.hydrogenBonds.map((bond) => ({ ...bond })),
      piStacks:interactions.piStacks.map((stack) => ({ ...stack,
        first:[...stack.first], second:[...stack.second] })),
    };
  },
  interactivePocketMovableAtoms() { return interactivePocketMovableAtomIndices(); },
  current() { return { ...moleculeDiagnostics(state.molecule), molecule: structuredClone(state.molecule) }; },
  fragmentIds() { return FRAGMENTS.map((fragment) => fragment.id); },
});
if (MOLARIUM_NETWORK_POLICY.testApi === true)
  Object.defineProperty(window, 'molariumTest', { value:molariumTestApi,
    enumerable:false, configurable:false, writable:false });

function exportXYZ() {
  if (!state.molecule) return showToast('Load a molecule first');
  const rows = state.molecule.atoms.map((a) => `${a.element.padEnd(2)} ${a.x.toFixed(6).padStart(11)} ${a.y.toFixed(6).padStart(11)} ${a.z.toFixed(6).padStart(11)}`);
  downloadBlob(`${state.molecule.atoms.length}\n${state.molecule.name}\n${rows.join('\n')}`, `${slug(state.molecule.name)}.xyz`, 'chemical/x-xyz');
  showToast('XYZ file exported');
}

function sdfField(value, width) {
  const text = String(value);
  if (text.length > width) throw new Error(`SDF field ${text} exceeds V2000 limits`);
  return text.padStart(width, ' ');
}

function conformerSdfRecord(molecule, positions, properties) {
  if (molecule.atoms.length > 999 || molecule.bonds.length > 999)
    throw new Error('Clustered SDF export currently supports V2000-sized molecules');
  const lines = [
    String(molecule.name || 'Molarium conformer').slice(0, 80),
    '  Molarium ETKDGv3/Sage WebGPU', '',
    `${sdfField(molecule.atoms.length, 3)}${sdfField(molecule.bonds.length, 3)}  0  0  0  0            999 V2000`,
  ];
  molecule.atoms.forEach((atom, index) => {
    const coordinate = (axis) => Number(positions[index * 3 + axis]).toFixed(4).padStart(10);
    lines.push(`${coordinate(0)}${coordinate(1)}${coordinate(2)} ${atom.element.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  });
  molecule.bonds.forEach((bond) => {
    const order = Math.abs(Number(bond.order || 1) - 1.5) < 0.1 ? 4
      : Math.max(1, Math.min(3, Math.round(Number(bond.order || 1))));
    lines.push(`${sdfField(bond.a + 1, 3)}${sdfField(bond.b + 1, 3)}${sdfField(order, 3)}  0  0  0  0`);
  });
  const charges = molecule.atoms.map((atom, index) => ({ index: index + 1, charge: Math.trunc(Number(atom.charge || 0)) }))
    .filter(({ charge }) => charge);
  for (let offset = 0; offset < charges.length; offset += 8) {
    const group = charges.slice(offset, offset + 8);
    lines.push(`M  CHG${sdfField(group.length, 3)}${group.map(({ index, charge }) => `${sdfField(index, 4)}${sdfField(charge, 4)}`).join('')}`);
  }
  lines.push('M  END');
  Object.entries(properties).forEach(([name, value]) => {
    lines.push(`>  <${name}>`, String(value), '');
  });
  lines.push('$$$$');
  return lines.join('\n');
}

function exportClusteredConformers() {
  const result = state.calculationEnsemble;
  const analysis = state.conformerAnalysis;
  if (!result || !analysis) return showToast('Run a conformer search first');
  const records = analysis.representativeIndices.map((replica) => {
    const arenaMethod = analysis.arena?.methods.find((method) =>
      method.id === analysis.methodIds?.[replica]);
    return conformerSdfRecord(result.molecule, ensembleFinalPositions(result, replica), {
      MOLARIUM_CONFORMER: replica + 1,
      ENERGY_KCAL_MOL: analysis.energies[replica].toFixed(8),
      RELATIVE_ENERGY_KCAL_MOL: analysis.energyOffsets[replica].toFixed(8),
      RMSD_TO_GLOBAL_MINIMUM_ANGSTROM: analysis.rmsdsToBest[replica].toFixed(8),
      CLUSTER: analysis.clusterIds[replica] + 1,
      FORCEFIELD: result.forcefield,
      SEARCH: arenaMethod?.label || `${result.conformerMethod} / WebGPU annealing`,
      ...(arenaMethod ? { SHARED_SEED: analysis.seedIndices[replica] + 1,
        JUDGE: analysis.arena.judge } : {}),
    });
  });
  downloadBlob(records.join('\n'), `${slug(result.molecule.name)}-conformers.sdf`, 'chemical/x-mdl-sdfile');
  showToast(`${records.length} clustered conformers exported`);
}

function downloadBlob(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function setFoldStatus(message) {
  document.querySelector('#fold-status').textContent = message;
}

function applyProteinPrediction(result) {
  const molecule = {
    atoms: result.atoms.map((atom) => ({ ...atom })),
    bonds: proteinCovalentBonds(result.atoms),
    name: `OpenFold prediction · ${result.sequence.length} residues`,
    smiles: `Protein sequence · ${result.sequence.length} aa`,
    charge: 0,
    multiplicity: 1,
    prediction: result,
  };
  loadMolecule(molecule);
  state.proteinPrediction = result;
  setText('#protein-result-title', 'OpenFold Prediction');
  setText('#protein-plddt', result.meanPlddt.toFixed(1));
  setText('#protein-ptm', result.ptm.toFixed(3));
  setText('#protein-msa-depth', result.msaDepth);
  setText('#protein-backend', result.provider.toUpperCase());
  setText('#protein-result-meta', `${result.recycles} recycles · ${(result.elapsedMs / 1000).toFixed(1)} s local inference · ${result.model}`);
  document.querySelector('#protein-confidence-bar').style.width = `${Math.max(0, Math.min(100, result.meanPlddt))}%`;
  document.querySelector('#protein-result-card').classList.remove('hidden');
  draw();
}

async function runProteinFold({ rethrow = false } = {}) {
  requireExternalNetwork('MSA search');
  if (state.foldAbortController) return;
  const button = document.querySelector('#fold-protein');
  const cancel = document.querySelector('#cancel-fold');
  const sequence = document.querySelector('#protein-sequence').value;
  const endpoint = document.querySelector('#msa-endpoint').value;
  const controller = new AbortController();
  state.foldAbortController = controller;
  button.disabled = true;
  cancel.classList.remove('hidden');
  try {
    const [{ foldProtein }, { ColabFoldMsaProvider }] = await Promise.all([
      import('./openfold/predictor.js'), import('./openfold/msa-client.js'),
    ]);
    const providerKey = endpoint.trim().replace(/\/$/, '');
    if (!proteinMsaProviders.has(providerKey))
      proteinMsaProviders.set(providerKey, new ColabFoldMsaProvider({ endpoint: providerKey }));
    const result = await foldProtein({
      sequence,
      msaProvider: proteinMsaProviders.get(providerKey),
      signal: controller.signal,
      onProgress: ({ message }) => setFoldStatus(message),
    });
    applyProteinPrediction(result);
    setFoldStatus(`Complete · mean pLDDT ${result.meanPlddt.toFixed(1)} · pTM ${result.ptm.toFixed(3)}`);
    showToast('Protein folded locally');
    return { residues:result.sequence.length, meanPlddt:result.meanPlddt,
      ptm:result.ptm, msaDepth:result.msaDepth, provider:result.provider,
      model:result.model, elapsedMs:result.elapsedMs };
  } catch (error) {
    const aborted = error?.name === 'AbortError' || controller.signal.aborted;
    setFoldStatus(aborted ? 'Fold cancelled.' : `Fold failed · ${error.message}`);
    if (!aborted) showNotice(error.message);
    if (rethrow) throw error;
    return null;
  } finally {
    if (state.foldAbortController === controller) state.foldAbortController = null;
    button.disabled = false;
    cancel.classList.add('hidden');
  }
}

function slug(value) { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'molecule'; }

const calculationWorkers = new Map();
const rdkitConformerWorkers = [];
const proteinMsaProviders = new Map();
let calculationSequence = 0;
let rdkitAssetsPromise;
let openmmAssetsPromise;
let webgpuAssetsPromise;
let stormmAssetsPromise;
let ani2xAssetsPromise;
let rosemaryExamplePromise;
const preparedProteinFixturePromises = new Map();
const pendingCalculations = new Map();

function proteinMoleculeToPdb(molecule) {
  const lines = molecule.atoms.map((atom, index) => {
    const serial = String(index + 1).padStart(5);
    const rawName = String(atom.atomName || atom.element || 'X').slice(0, 4);
    const atomName = (rawName.length < 4 && String(atom.element || '').length === 1
      ? ` ${rawName}` : rawName).padEnd(4);
    const residue = String(atom.residueName || 'UNK').slice(0, 3).padStart(3);
    const chain = String(atom.chain || 'A').slice(0, 1);
    const residueIndex = String(atom.residueIndex || 1).padStart(4);
    const coordinate = (value) => Number(value).toFixed(3).padStart(8);
    const element = String(atom.element || '').slice(0, 2).padStart(2);
    return `ATOM  ${serial} ${atomName} ${residue} ${chain}${residueIndex}    ${coordinate(atom.x)}${coordinate(atom.y)}${coordinate(atom.z)}  1.00  0.00          ${element}`;
  });
  return `${lines.join('\n')}\nTER\nEND\n`;
}

async function loadRosemaryProteinExample() {
  rosemaryExamplePromise ??= fetch('./openff/rosemary-trp-cage.json').then(async (response) => {
    if (!response.ok) throw new Error(`Rosemary reference could not be loaded (HTTP ${response.status})`);
    const payload = await response.json();
    const molecule = payload?.molecule;
    const system = molecule?.parameterization?.system;
    if (payload?.schema !== 1 || !Array.isArray(molecule?.atoms) || molecule.atoms.length !== 304
      || !Array.isArray(molecule?.bonds) || !Array.isArray(system?.particles)
      || system.particles.length !== molecule.atoms.length)
      throw new Error('The Rosemary protein reference has an unsupported or incomplete schema');
    return payload;
  }).catch((error) => {
    rosemaryExamplePromise = null;
    throw error;
  });
  const payload = await rosemaryExamplePromise;
  return activatePreparedProteinFixture(payload, {
    title: 'Rosemary α Protein',
    meta: 'OpenFF Rosemary 3.0.0-alpha0 · experimental 1L2Y coordinates · exact preparameterized System',
    status: 'Loaded Rosemary alpha Trp-cage reference · ready for OpenMM or experimental WebGPU',
  });
}

async function loadPreparedProteinFixture(url) {
  if (typeof url !== 'string' || !url.trim()) throw new Error('A prepared fixture URL is required');
  const normalizedUrl = new URL(url, location.href).href;
  let fixturePromise = preparedProteinFixturePromises.get(normalizedUrl);
  if (!fixturePromise) {
    fixturePromise = fetch(normalizedUrl).then(async (response) => {
      if (!response.ok) throw new Error(`Prepared fixture could not be loaded (HTTP ${response.status})`);
      const payload = await response.json();
      const molecule = payload?.molecule;
      const system = molecule?.parameterization?.system;
      const supportedTerms = ['particles', 'constraints', 'bonds', 'angles', 'torsions', 'nonbonded', 'exceptions'];
      const validTerms = supportedTerms.every((name) => Array.isArray(system?.[name]));
      const finiteCoordinates = molecule?.atoms?.every((atom) =>
        Number.isFinite(atom.x) && Number.isFinite(atom.y) && Number.isFinite(atom.z));
      if (payload?.schema !== 1 || !Array.isArray(molecule?.atoms) || !molecule.atoms.length
        || !Array.isArray(molecule?.bonds) || !validTerms || !finiteCoordinates
        || system.particles.length !== molecule.atoms.length
        || system.nonbonded.length !== molecule.atoms.length)
        throw new Error('The prepared protein fixture has an unsupported or incomplete schema');
      return payload;
    }).catch((error) => {
      preparedProteinFixturePromises.delete(normalizedUrl);
      throw error;
    });
    preparedProteinFixturePromises.set(normalizedUrl, fixturePromise);
  }
  const payload = await fixturePromise;
  const sourceLabel = payload.source?.pdb || payload.molecule?.prediction?.model || 'prepared structure';
  return activatePreparedProteinFixture(payload, {
    title: 'Prepared Protein',
    meta: `${payload.molecule.parameterization.forcefield} · ${sourceLabel} · exact preparameterized System`,
    status: `Loaded ${payload.molecule.name || sourceLabel} · ready for OpenMM or experimental WebGPU`,
  });
}

function activatePreparedProteinFixture(payload, labels) {
  const molecule = structuredClone(payload.molecule);
  molecule.prediction = {
    ...molecule.prediction,
    kind: 'parameterized-reference',
    pdb: proteinMoleculeToPdb(molecule),
  };
  state.buildHistory = [];
  state.redoHistory = [];
  loadMolecule(molecule);
  updateHistoryButtons();
  setText('#protein-result-title', labels.title);
  setText('#protein-plddt', 'PDB');
  setText('#protein-ptm', '—');
  setText('#protein-msa-depth', '—');
  setText('#protein-backend', 'NAGL');
  setText('#protein-result-meta', labels.meta);
  document.querySelector('#protein-confidence-bar').style.width = '0%';
  document.querySelector('#protein-result-card').classList.remove('hidden');
  setFoldStatus(labels.status);
  draw();
  return {
    atoms: molecule.atoms.length,
    bonds: molecule.bonds.length,
    residues: new Set(molecule.atoms.map((atom) => `${atom.chain}:${atom.residueIndex}`)).size,
    forcefield: molecule.parameterization.forcefield,
    chargeModel: molecule.parameterization.chargeModel,
    sourceSha256: molecule.parameterization.sourceSha256,
    parameterCounts: Object.fromEntries(Object.entries(molecule.parameterization.system)
      .map(([name, terms]) => [name, terms.length])),
  };
}

async function prepareCurrentPdb(optionsOverride = null, suppliedCcdDefinitions = null) {
  if (state.preparing) return null;
  if (state.molecule?.source?.format !== 'pdb') throw new Error('Load a PDB structure first');
  const button = document.querySelector('#prepare-pdb');
  const status = document.querySelector('#pdb-preparation-status');
  const original = state.molecule;
  const options = optionsOverride
    ? normalizePdbPreparationOptions(optionsOverride) : pdbPreparationOptionsFromUi();
  let preview = state.pdbPreparationPreview;
  state.preparing = true;
  button.disabled = true;
  try {
    const fingerprint = pdbPreparationFingerprint(original, options);
    if (!preview || preview.fingerprint !== fingerprint) {
      status.textContent = 'Preparing…';
      preview = await createPdbPreparationPreview(original, options, suppliedCcdDefinitions);
      state.pdbPreparationPreview = preview;
      updatePreparationInspectorUi();
    }
    if (preview.audit.blockers.length) {
      openPreparationInspector();
      throw new Error(`Preparation stopped: ${preview.audit.blockers.join('; ')}`);
    }
    const prepared = structuredClone(preview.molecule);
    status.textContent = 'Assigning force-field terms…';

    const parameters = await runOpenMMJob('parameters', prepared, ({ phase }) => {
      if (phase) status.textContent = phase;
    });
    prepared.parameterization = {
      forcefield: parameters.forcefield, chargeModel: parameters.chargeModel,
      sourceSha256: parameters.sourceSha256, system: parameters.system, labels: parameters.labels,
    };
    prepared.preparation = { ...(prepared.preparation || {}), status: 'parameterized-experimental', parameterized: true,
      audit: { ...preview.audit, parameterization: { forcefield: parameters.forcefield,
        chargeModel: parameters.chargeModel, sourceSha256: parameters.sourceSha256,
        parameterCounts: parameters.parameterCounts } } };
    prepared.prediction = prepared.prediction ? { ...prepared.prediction, pdb: proteinMoleculeToPdb(prepared) } : null;
    pushBuildSnapshot(original);
    loadMolecule(prepared, false);
    setPreparationInspectorOpen(false);
    updateHistoryButtons();
    const relaxation = preview.audit.actions.find((action) => action.action === 'relax-polar-hydrogens');
    showToast(`Preparation applied · ${prepared.atoms.length} atoms${relaxation
      ? ` · ${relaxation.rotatableHydrogens} polar H relaxed` : ''}`);
    return {
      atoms: prepared.atoms.length, bonds: prepared.bonds.length,
      hydrogensAdded: preview.audit.actions.find((action) => action.action === 'rebuild-protein-hydrogens')?.added || 0,
      heavyAtomsAdded: preview.audit.actions.find((action) => action.action === 'repair-heavy-atoms')?.added || 0,
      ligandsPrepared: preview.audit.actions.find((action) =>
        ['prepare-ligands-from-ccd', 'prepare-ligands-from-registered-graph'].includes(action.action))
        ?.components?.length || 0,
      forcefield: parameters.forcefield, chargeModel: parameters.chargeModel,
      parameterCounts: parameters.parameterCounts, audit: prepared.preparation.audit,
    };
  } finally {
    state.preparing = false;
    updatePdbPreparationUi();
  }
}

function rejectPendingCalculations(error, method) {
  pendingCalculations.forEach((pending, id) => {
    if (!method || pending.method === method) {
      pending.reject(error);
      pendingCalculations.delete(id);
    }
  });
}

async function verifyRDKitAssets() {
  if (rdkitAssetsPromise) return rdkitAssetsPromise;
  rdkitAssetsPromise = (async () => {
    const workerUrl = document.querySelector('link[data-rdkit-worker]').href;
    const siteDataUrl = new URL('./rdkit/dimorphite-sites.js', workerUrl).href;
    const scriptUrl = new URL('./rdkit/dist/RDKit_minimal.js', workerUrl).href;
    const wasmUrl = new URL('./rdkit/dist/RDKit_minimal.wasm', workerUrl).href;
    const [workerResponse, siteDataResponse, scriptResponse, wasmResponse] = await Promise.all([
      fetch(workerUrl), fetch(siteDataUrl), fetch(scriptUrl), fetch(wasmUrl),
    ]);
    if (!workerResponse.ok) throw new Error(`RDKit worker could not be loaded (HTTP ${workerResponse.status})`);
    if (!siteDataResponse.ok) throw new Error(`Protonation site data could not be loaded (HTTP ${siteDataResponse.status})`);
    if (!scriptResponse.ok) throw new Error(`RDKit JavaScript could not be loaded (HTTP ${scriptResponse.status})`);
    if (!wasmResponse.ok) throw new Error(`RDKit WebAssembly could not be loaded (HTTP ${wasmResponse.status})`);
    const bytes = await wasmResponse.arrayBuffer();
    if (!WebAssembly.validate(bytes)) throw new Error('The RDKit WebAssembly download is invalid');
    return { workerUrl, wasmUrl };
  })().catch((error) => {
    rdkitAssetsPromise = null;
    throw error;
  });
  return rdkitAssetsPromise;
}

async function verifyOpenMMAssets() {
  if (openmmAssetsPromise) return openmmAssetsPromise;
  openmmAssetsPromise = (async () => {
    const workerUrl = new URL('./openmm-worker.js', self.location.href).href;
    const assets = [
      workerUrl,
      new URL('./openmm/molarium-openmm.js', workerUrl).href,
      new URL('./openmm/molarium-openmm.wasm', workerUrl).href,
      new URL('./openff/sage-2.1.0.json', workerUrl).href,
      new URL('./openff/sage-parameterizer.js', workerUrl).href,
      new URL('./rdkit/dist/RDKit_minimal.js', workerUrl).href,
      new URL('./rdkit/dist/RDKit_minimal.wasm', workerUrl).href,
    ];
    const responses = await Promise.all(assets.map((url) => fetch(url)));
    const failed = responses.find((response) => !response.ok);
    if (failed) throw new Error(`OpenMM/Sage asset could not be loaded (HTTP ${failed.status})`);
    const openmmBytes = await responses[2].arrayBuffer();
    const rdkitBytes = await responses[6].arrayBuffer();
    if (!WebAssembly.validate(openmmBytes) || !WebAssembly.validate(rdkitBytes))
      throw new Error('An OpenMM/Sage WebAssembly download is invalid');
    return { workerUrl };
  })().catch((error) => {
    openmmAssetsPromise = null;
    throw error;
  });
  return openmmAssetsPromise;
}

async function verifyWebGPUAssets() {
  if (webgpuAssetsPromise) return webgpuAssetsPromise;
  webgpuAssetsPromise = (async () => {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');
    const workerUrl = document.querySelector('link[data-webgpu-worker]').href;
    const assets = [
      workerUrl,
      new URL('./webgpu/molarium-webgpu.wgsl', workerUrl).href,
      new URL('./openff/sage-2.1.0.json', workerUrl).href,
      new URL('./openff/sage-parameterizer.js', workerUrl).href,
      new URL('./rdkit/dist/RDKit_minimal.js', workerUrl).href,
      new URL('./rdkit/dist/RDKit_minimal.wasm', workerUrl).href,
    ];
    const responses = await Promise.all(assets.map((url) => fetch(url)));
    const failed = responses.find((response) => !response.ok);
    if (failed) throw new Error(`Sage WebGPU asset could not be loaded (HTTP ${failed.status})`);
    const rdkitBytes = await responses[5].arrayBuffer();
    if (!WebAssembly.validate(rdkitBytes)) throw new Error('The Sage WebGPU RDKit download is invalid');
    return { workerUrl };
  })().catch((error) => {
    webgpuAssetsPromise = null;
    throw error;
  });
  return webgpuAssetsPromise;
}

async function verifyStormmAssets() {
  if (stormmAssetsPromise) return stormmAssetsPromise;
  stormmAssetsPromise = (async () => {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');
    const workerUrl = document.querySelector('link[data-stormm-worker]').href;
    const assets = [
      workerUrl,
      new URL('./stormm/core.mjs', workerUrl).href,
      new URL('./stormm/engine.mjs', workerUrl).href,
    ];
    const responses = await Promise.all(assets.map((url) => fetch(url)));
    const failed = responses.find((response) => !response.ok);
    if (failed) throw new Error(`STORMM WebGPU asset could not be loaded (HTTP ${failed.status})`);
    return { workerUrl };
  })().catch((error) => {
    stormmAssetsPromise = null;
    throw error;
  });
  return stormmAssetsPromise;
}

async function verifyAni2xAssets() {
  if (ani2xAssetsPromise) return ani2xAssetsPromise;
  ani2xAssetsPromise = (async () => {
    const workerUrl = document.querySelector('link[data-ani2x-worker]').href;
    const assets = [
      workerUrl,
      new URL('./mlip/ani2x.js', workerUrl).href,
      molariumAssetUrl('mlip/models/ani2x-manifest.json',
        new URL('./mlip/models/ani2x-manifest.json', workerUrl).href),
      new URL('./vendor/onnxruntime-web/ort.webgpu.bundle.min.mjs', workerUrl).href,
    ];
    const responses = await Promise.all(assets.map((url) => fetch(url)));
    const failed = responses.find((response) => !response.ok);
    if (failed) throw new Error(`ANI-2x browser asset could not be loaded (HTTP ${failed.status})`);
    const modelManifest = await responses[2].json();
    if (modelManifest?.model !== 'ANI-2x' || modelManifest?.ensembleSize !== 8)
      throw new Error('The ANI-2x browser manifest is invalid');
    return { workerUrl };
  })().catch((error) => {
    ani2xAssetsPromise = null;
    throw error;
  });
  return ani2xAssetsPromise;
}

function calculationEngineName(method) {
  const forcefield = state.molecule?.parameterization?.forcefield;
  if (method === 'openmm') return forcefield?.includes('Rosemary') ? 'OpenMM/Rosemary' : 'OpenMM/Sage';
  if (method === 'webgpu') return forcefield?.includes('Rosemary') ? 'Rosemary WebGPU' : 'Sage WebGPU';
  if (method === 'stormm') return 'STORMM WebGPU ensemble';
  if (method === 'rdkit') return 'RDKit';
  if (method === 'ani2x') return 'ANI-2x MLIP';
  return 'Unknown engine';
}

async function getCalculationWorker(method) {
  if (calculationWorkers.has(method)) return calculationWorkers.get(method);
  if (!['rdkit', 'openmm', 'webgpu', 'stormm', 'ani2x'].includes(method)) throw new Error('That calculation worker is not installed');
  const { workerUrl } = method === 'rdkit' ? await verifyRDKitAssets()
    : method === 'webgpu' ? await verifyWebGPUAssets()
      : method === 'stormm' ? await verifyStormmAssets()
        : method === 'ani2x' ? await verifyAni2xAssets() : await verifyOpenMMAssets();
  if (calculationWorkers.has(method)) return calculationWorkers.get(method);
  const calculationWorkerUrl = method === 'ani2x' && MOLARIUM_ASSET_BASE
    ? (() => { const url = new URL(workerUrl); url.searchParams.set('assetBase', MOLARIUM_ASSET_BASE); return url.href; })()
    : workerUrl;
  const worker = new Worker(calculationWorkerUrl,
    method === 'stormm' || method === 'ani2x' ? { type: 'module' } : undefined);
  calculationWorkers.set(method, worker);
  worker.addEventListener('message', (event) => {
    const message = event.data;
    const pending = pendingCalculations.get(message?.id);
    if (!pending) return;
    if (message.type === 'progress') {
      pending.onProgress(message);
      return;
    }
    pendingCalculations.delete(message.id);
    if (message.type === 'result') pending.resolve(message);
    else pending.reject(new Error(`${method}/${pending.job || 'calculation'}: `
      + (message.message || `${calculationEngineName(method)} calculation failed`)));
  });
  worker.addEventListener('error', (event) => {
    const details = [event.message, event.filename && `${event.filename}:${event.lineno || 0}`].filter(Boolean).join(' · ');
    rejectPendingCalculations(new Error(details || `The ${calculationEngineName(method)} worker crashed after loading.`), method);
    worker.terminate();
    calculationWorkers.delete(method);
  });
  worker.addEventListener('messageerror', () => {
    rejectPendingCalculations(new Error(`The ${calculationEngineName(method)} worker returned unreadable data.`), method);
    worker.terminate();
    calculationWorkers.delete(method);
  });
  return worker;
}

async function runRDKitJob(job, molecule, onProgress, options = {}) {
  if (job === 'conformers')
    return runRDKitConformerPool(molecule, onProgress, options);
  return runWorkerJob('rdkit', job, molecule, onProgress, options);
}

async function runOpenMMJob(job, molecule, onProgress, options = {}) {
  return runWorkerJob('openmm', job, molecule, onProgress, options);
}

async function runWebGPUJob(job, molecule, onProgress, options = {}) {
  return runWorkerJob('webgpu', job, molecule, onProgress, options);
}

async function runStormmJob(job, molecule, onProgress, options = {}) {
  return runWorkerJob('stormm', job, molecule, onProgress, options);
}

async function runAni2xJob(job, molecule, onProgress, options = {}) {
  return runWorkerJob('ani2x', job, molecule, onProgress, options);
}

let smallMoleculePolishSequence = 0;

function smallMoleculePolishEligible(molecule) {
  return Boolean(molecule?.atoms?.length && molecule.atoms.length <= 256
    && molecule.source?.format !== 'pdb' && !molecule.prediction
    && molecule.atoms.every((atom) => ELEMENTS[atom.element]));
}

function mappedMoleculeSubset(molecule, globalAtomIndices, label = 'component') {
  const indices = [...new Set(globalAtomIndices)].map(Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < molecule.atoms.length)
    .sort((first, second) => first - second);
  if (!indices.length) return null;
  const remap = new Map(indices.map((index, localIndex) => [index, localIndex]));
  const atoms = indices.map((index) => ({ ...molecule.atoms[index] }));
  const bonds = molecule.bonds.flatMap((bond) => remap.has(bond.a) && remap.has(bond.b)
    ? [{ ...bond, a:remap.get(bond.a), b:remap.get(bond.b) }] : []);
  return {
    molecule:{
      name:`${molecule.name || 'Molecule'} · ${label}`, atoms, bonds,
      charge:atoms.reduce((sum, atom) => sum + atomFormalCharge(atom), 0),
      multiplicity:molecule.multiplicity || 1,
      source:{ format:'builder-component-subset' },
    },
    globalAtomIndices:indices,
    globalToLocal:remap,
  };
}

function dockingValidationLigandMolecule() {
  const numeric = state.dockingResult?.validationNumericSystem;
  if (!numeric?.atomIds?.length || !numeric.system || !state.molecule?.atoms?.length) return null;
  const globalById = new Map(state.molecule.atoms.flatMap((atom, index) =>
    atom.designAtomId ? [[atom.designAtomId, index]] : []));
  const globalIndices = numeric.atomIds.map((atomId) => globalById.get(atomId));
  if (globalIndices.some((index) => !Number.isInteger(index))
    || new Set(globalIndices).size !== globalIndices.length) return null;
  const localByGlobal = new Map(globalIndices.map((globalIndex, localIndex) =>
    [globalIndex, localIndex]));
  const atoms = globalIndices.map((globalIndex) => ({ ...state.molecule.atoms[globalIndex] }));
  const bonds = state.molecule.bonds.flatMap((bond) => {
    if (!localByGlobal.has(bond.a) || !localByGlobal.has(bond.b)) return [];
    return [{ ...bond, a:localByGlobal.get(bond.a), b:localByGlobal.get(bond.b) }];
  });
  const base = {
    name:`${state.molecule.name || 'Molecule'} · validation ligand`, atoms, bonds,
    charge:atoms.reduce((sum, atom) => sum + atomFormalCharge(atom), 0),
    multiplicity:state.molecule.multiplicity || 1,
    source:{ format:'validation-ligand-subset' },
  };
  return {
    atomIds:[...numeric.atomIds],
    unparameterizedMolecule:base,
    molecule:{ ...base, atoms:atoms.map((atom) => ({ ...atom })),
      bonds:bonds.map((bond) => ({ ...bond })),
      parameterization:{ forcefield:numeric.forcefield, chargeModel:numeric.chargeModel,
        sourceSha256:numeric.sourceSha256, system:structuredClone(numeric.system) } },
  };
}

function editableLigandComponentPlan(molecule = state.molecule, preferredAtomIndices = []) {
  if (!molecule?.atoms?.length) return null;
  const preferred = new Set(Array.from(preferredAtomIndices || [], Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < molecule.atoms.length
      && !isProteinAtom(molecule.atoms[index]) && !isWaterAtom(molecule.atoms[index])));
  connectedLigandAtomIndexSet(molecule).forEach((index) => preferred.add(index));
  const candidates = moleculeComponents(molecule).filter((component) =>
    component.some((index) => preferred.has(index))
      && component.every((index) => !isProteinAtom(molecule.atoms[index]) && !isWaterAtom(molecule.atoms[index]))
      && component.some((index) => molecule.atoms[index].element !== 'H'));
  const selected = candidates.sort((first, second) => {
    const heavy = (component) => component.reduce((count, index) =>
      count + Number(molecule.atoms[index].element !== 'H'), 0);
    return heavy(second) - heavy(first);
  })[0];
  if (!selected || selected.length > 256) return null;
  const mapped = mappedMoleculeSubset(molecule, selected, 'editable ligand');
  return mapped && smallMoleculePolishEligible(mapped.molecule) ? mapped : null;
}

function referencePreservingPolishSelection(molecule, globalAtomIndices,
  releasedAtomIds = []) {
  const reference = molecule === state.molecule ? state.dockingReference : null;
  if (reference?.mode !== 'pose-propagation'
    || selectedDockingEditCleanup() !== 'preserve-reference') return null;
  const referenceElementById = new Map(reference.ligand.atomIds.map((id, index) =>
    [id, reference.ligand.elements[index]]));
  const released = new Set([
    ...Array.from(molecule.source?.posePropagationEditRegions || [])
      .flatMap((entry) => entry.releasedHeavyAtomIds || []),
    ...Array.from(releasedAtomIds || []),
  ]);
  const fixed = globalAtomIndices.filter((globalIndex) => {
    const atom = molecule.atoms[globalIndex];
    return atom.element !== 'H' && !released.has(atom.designAtomId)
      && referenceElementById.get(atom.designAtomId) === atom.element;
  });
  const fixedSet = new Set(fixed);
  return {
    cleanupMode:'preserve-reference',
    fixedInheritedHeavyAtomCount:fixed.length,
    releasedInheritedHeavyAtomCount:released.size,
    movableGlobalAtomIndices:globalAtomIndices.filter((index) => !fixedSet.has(index)),
  };
}

function localEditPolishPlan(molecule, changedAtomIndices, bondRadius = 2,
  { releasedAtomIds = [] } = {}) {
  const changed = Array.from(changedAtomIndices || [], Number);
  const mapped = editableLigandComponentPlan(molecule, changed);
  const useMappedLigand = Boolean(mapped && (state.dockingReference
    || molecule.atoms.some((atom) => isProteinAtom(atom) || isWaterAtom(atom))));
  if (!useMappedLigand && smallMoleculePolishEligible(molecule)) {
    const globalAtomIndices = molecule.atoms.map((_, index) => index);
    return { molecule, globalAtomIndices,
      movableGlobalAtomIndices:localPolishMovableAtomIndices(molecule, changed, bondRadius),
      scope:'molecule', cleanupMode:'free-local', fixedInheritedHeavyAtomCount:0 };
  }
  if (!mapped || !changed.some((index) => mapped.globalToLocal.has(index))) return null;
  const preserving = referencePreservingPolishSelection(molecule, mapped.globalAtomIndices,
    releasedAtomIds);
  if (preserving) return { ...mapped, ...preserving, scope:'ligand component' };
  const component = new Set(mapped.globalAtomIndices);
  return { ...mapped,
    movableGlobalAtomIndices:localPolishMovableAtomIndices(molecule, changed, bondRadius)
      .filter((index) => component.has(index)),
    scope:'ligand component', cleanupMode:'free-local', fixedInheritedHeavyAtomCount:0 };
}

function applyMappedCalculationPositions(molecule, positions, globalAtomIndices) {
  if (!(positions instanceof Float64Array) || positions.length !== globalAtomIndices.length * 3)
    throw new Error('The ligand optimizer returned an invalid coordinate array');
  globalAtomIndices.forEach((globalIndex, localIndex) => {
    const atom = molecule.atoms[globalIndex];
    atom.x = positions[localIndex * 3];
    atom.y = positions[localIndex * 3 + 1];
    atom.z = positions[localIndex * 3 + 2];
  });
  molecule.bonds.forEach((bond) => { bond.distance = bondDistance(molecule, bond.a, bond.b); });
  updateInfo(); draw();
}

async function createRdkitSmilesMolecule(smiles, name = 'SMILES structure') {
  const input = String(smiles || '').trim();
  if (!input) throw new Error('Enter a SMILES string first.');
  const result = await runRDKitJob('smiles-embed', null, () => {}, {
    smiles:input, conformerCount:8, conformerSeed:20260817,
    conformerPruneRms:0.35, conformerMinimizeIterations:100,
  });
  const molecule = parseMolBlock(result.molBlock, {
    name, smiles:input, canonicalSmiles:result.canonicalSmiles,
    source:{ initialGeometryPolish:{
      engine:result.forcefield, fallback:Boolean(result.fallback), elapsedMs:result.elapsedMs,
      initialEnergy:null, finalEnergy:result.finalEnergy, embedding:result.conformerMethod,
      requestedConformers:result.requestedCount, embeddedConformers:result.embeddedCount,
      selectedConformer:result.bestIndex + 1, randomSeed:result.conformerSeed,
    } },
  });
  return { molecule, result };
}

function ligandProtonationInput(molecule = state.molecule) {
  if (!molecule || molecule.source?.format !== 'smiles' || molecule.prediction) return '';
  return String(molecule.source?.protonation?.inputSmiles
    || molecule.source?.input || molecule.smiles || '').trim();
}

function selectedLigandProtonationState() {
  const result = state.ligandProtonation;
  if (!result?.states?.length) return null;
  const selected = Number(document.querySelector('#ligand-protonation-state').value || 0);
  return result.states[Math.max(0, Math.min(result.states.length - 1, selected))];
}

function updateLigandProtonationMeta() {
  const result = state.ligandProtonation;
  const selected = selectedLigandProtonationState();
  const meta = document.querySelector('#ligand-protonation-meta');
  if (!result || !selected) { meta.textContent = ''; return; }
  const population = Number.isFinite(selected.estimatedPopulation)
    ? `~${Math.max(0.1, selected.estimatedPopulation * 100).toFixed(selected.estimatedPopulation >= 0.1 ? 0 : 1)}%`
    : 'unranked';
  const siteSummary = result.sites.length
    ? result.sites.slice(0, 2).map((site) => `${site.name.replace(/^\*/, '')} pKa ${site.meanPka.toFixed(1)} ± ${site.pkaStdDev.toFixed(1)}`).join(' · ')
    : 'no empirical ionizable site found';
  meta.textContent = `Charge ${selected.formalCharge >= 0 ? '+' : ''}${selected.formalCharge} · ${population} independent-site estimate · ${siteSummary}`;
}

function updateLigandProtonationUi() {
  const panel = document.querySelector('#ligand-protonation');
  const input = ligandProtonationInput();
  const visible = Boolean(input && state.molecule?.atoms?.length <= 256);
  panel.classList.toggle('hidden', !visible);
  if (!visible) return;
  const result = state.ligandProtonation?.inputSmiles === input ? state.ligandProtonation : null;
  if (!result && !state.protonatingLigand) state.ligandProtonation = null;
  const badge = document.querySelector('#ligand-protonation-badge');
  const runButton = document.querySelector('#ligand-protonation-run');
  const resultPanel = document.querySelector('#ligand-protonation-result');
  panel.classList.toggle('ready', Boolean(result));
  panel.classList.toggle('warning', Boolean(result?.variantsTruncated || result?.sitesTruncated));
  runButton.disabled = state.protonatingLigand;
  runButton.textContent = state.protonatingLigand ? 'Enumerating…' : 'Enumerate';
  badge.textContent = state.protonatingLigand ? 'Analyzing' : result
    ? `${result.states.length} state${result.states.length === 1 ? '' : 's'}` : 'Input state';
  resultPanel.classList.toggle('hidden', !result);
  if (!result) return;
  const select = document.querySelector('#ligand-protonation-state');
  const previousSmiles = select.options[select.selectedIndex]?.dataset.smiles;
  select.replaceChildren(...result.states.map((variant, index) => {
    const option = document.createElement('option');
    const population = Number.isFinite(variant.estimatedPopulation)
      ? `${Math.round(variant.estimatedPopulation * 100)}%` : 'unranked';
    option.value = String(index);
    option.dataset.smiles = variant.smiles;
    option.textContent = `${index + 1}. charge ${variant.formalCharge >= 0 ? '+' : ''}${variant.formalCharge} · ${population}${variant.recommended ? ' · recommended' : ''}`;
    return option;
  }));
  const previousIndex = result.states.findIndex((variant) => variant.smiles === previousSmiles);
  select.value = String(previousIndex >= 0 ? previousIndex : 0);
  updateLigandProtonationMeta();
}

async function enumerateLigandProtonation(smiles = ligandProtonationInput(), options = {}) {
  const input = String(smiles || '').trim();
  if (!input) throw new Error('Load a small molecule first');
  const phInput = document.querySelector('#ligand-protonation-ph');
  const ph = Number(options.ph ?? phInput.value ?? 7.4);
  if (!Number.isFinite(ph) || ph < 0 || ph > 14) throw new Error('Target pH must be between 0 and 14');
  phInput.value = ph.toFixed(1);
  const sequence = ++state.ligandProtonationSequence;
  state.protonatingLigand = true;
  updateLigandProtonationUi();
  try {
    const result = await runRDKitJob('protonation', null, () => {}, {
      smiles:input, ph, phSpread:Number(options.phSpread ?? 0.5),
      precision:Number(options.precision ?? 1), maxStates:Number(options.maxStates ?? 16),
    });
    if (sequence !== state.ligandProtonationSequence) return null;
    state.ligandProtonation = { ...result, inputSmiles:input };
    return state.ligandProtonation;
  } finally {
    if (sequence === state.ligandProtonationSequence) {
      state.protonatingLigand = false;
      updateLigandProtonationUi();
    }
  }
}

async function applySelectedLigandProtonation() {
  const enumeration = state.ligandProtonation;
  const selected = selectedLigandProtonationState();
  if (!enumeration || !selected) throw new Error('Enumerate protonation states first');
  const button = document.querySelector('#ligand-protonation-apply');
  const name = state.molecule?.name || 'SMILES structure';
  button.disabled = true; button.textContent = 'Building…';
  try {
    const embedded = await createRdkitSmilesMolecule(selected.smiles, name);
    embedded.molecule.source = { ...embedded.molecule.source, protonation: {
      inputSmiles:enumeration.inputSmiles, selectedSmiles:selected.smiles,
      targetPh:enumeration.targetPh, formalCharge:selected.formalCharge,
      estimatedPopulation:selected.estimatedPopulation, source:enumeration.source,
      populationModel:enumeration.populationModel,
    } };
    state.ligandProtonation = enumeration;
    loadMolecule(embedded.molecule);
    showToast(`Protonation state applied · charge ${selected.formalCharge >= 0 ? '+' : ''}${selected.formalCharge} · ETKDGv3 rebuilt`);
    return embedded;
  } finally {
    button.disabled = false; button.textContent = 'Use state';
  }
}

async function polishSmallMoleculeCoordinates(molecule, { announce = false } = {}) {
  if (!smallMoleculePolishEligible(molecule)) return null;
  const token = ++smallMoleculePolishSequence;
  const embed = molecule.source?.format === 'smiles';
  const result = await runRDKitJob(embed ? 'embed' : 'geometry', molecule, () => {}, embed ? {
    conformerCount:8, conformerSeed:20260817, conformerPruneRms:0.35,
    conformerMinimizeIterations:100,
  } : { maxIterations:80, snapshotFrequency:80 });
  if (token !== smallMoleculePolishSequence || state.molecule !== molecule) return null;
  applyCalculationPositions(result.positions, false);
  molecule.source = { ...(molecule.source || {}), initialGeometryPolish: {
    engine:result.forcefield, fallback:Boolean(result.fallback), elapsedMs:result.elapsedMs,
    initialEnergy:result.initialEnergy ?? null, finalEnergy:result.finalEnergy,
    embedding:embed ? result.conformerMethod : null,
    requestedConformers:embed ? result.requestedCount : null,
    embeddedConformers:embed ? result.embeddedCount : null,
    selectedConformer:embed ? result.bestIndex + 1 : null,
    randomSeed:embed ? result.conformerSeed : null,
  } };
  if (announce) showToast(`${embed ? 'ETKDGv3 · ' : ''}${result.forcefield}${result.fallback ? ' fallback' : ''} geometry prepared · ${(result.elapsedMs / 1000).toFixed(2)} s`);
  return result;
}

function localPolishMovableAtomIndices(molecule, changedAtomIndices, bondRadius = 2) {
  const roots = new Set(Array.from(changedAtomIndices || [], Number)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < molecule.atoms.length));
  if (!roots.size) return molecule.atoms.map((_, index) => index);
  const adjacency = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond) => {
    adjacency[bond.a].push(bond.b);
    adjacency[bond.b].push(bond.a);
  });
  const movable = new Set(roots);
  const queue = [...roots].map((index) => [index, 0]);
  while (queue.length) {
    const [atom, distance] = queue.shift();
    if (distance >= bondRadius) continue;
    adjacency[atom].forEach((neighbor) => {
      if (movable.has(neighbor)) return;
      movable.add(neighbor);
      queue.push([neighbor, distance + 1]);
    });
  }
  // A partially fixed ring can be distorted at its frozen boundary. Expand
  // every touched fused ring system as a unit, then include its hydrogens.
  let expanded = true;
  const rings = findRingCycles(molecule);
  while (expanded) {
    expanded = false;
    rings.forEach((ring) => {
      if (!ring.some((index) => movable.has(index))) return;
      ring.forEach((index) => {
        if (!movable.has(index)) { movable.add(index); expanded = true; }
      });
    });
  }
  [...movable].forEach((index) => {
    if (molecule.atoms[index].element === 'H') return;
    adjacency[index].forEach((neighbor) => {
      if (molecule.atoms[neighbor].element === 'H') movable.add(neighbor);
    });
  });
  return [...movable].sort((first, second) => first - second);
}

function recordInteractivePolish(molecule, entry) {
  const record = { at:new Date().toISOString(), ...entry };
  const previous = Array.isArray(molecule.source?.interactivePolishHistory)
    ? molecule.source.interactivePolishHistory : [];
  molecule.source = { ...(molecule.source || {}), lastInteractivePolish:record,
    interactivePolishHistory:[...previous, record].slice(-64) };
  return record;
}

function scheduleSmallMoleculePolish(changedAtomIndices, delay = 160) {
  const molecule = state.molecule;
  const plan = localEditPolishPlan(molecule, changedAtomIndices);
  if (!plan) return;
  const movable = new Set(plan.movableGlobalAtomIndices);
  const fixedAtomIndices = plan.globalAtomIndices.flatMap((globalIndex, localIndex) =>
    movable.has(globalIndex) ? [] : [localIndex]);
  const token = ++smallMoleculePolishSequence;
  setTimeout(async () => {
    if (token !== smallMoleculePolishSequence || state.molecule !== molecule
      || state.calculating || state.minimizing) return;
    try {
      updateBuildStatus(`RDKit ${plan.scope} polish…`);
      const result = await runRDKitJob('geometry', plan.molecule, () => {}, {
        maxIterations:60, snapshotFrequency:60, fixedAtomIndices,
      });
      if (token !== smallMoleculePolishSequence || state.molecule !== molecule) return;
      applyMappedCalculationPositions(molecule, result.positions, plan.globalAtomIndices);
      recordInteractivePolish(molecule, {
        engine:result.forcefield, fallback:Boolean(result.fallback), elapsedMs:result.elapsedMs,
        movableAtomCount:result.movableAtomCount, fixedAtomCount:result.fixedAtomCount,
        proteinFixedAtomCount:molecule.atoms.length - plan.globalAtomIndices.length,
        scope:plan.scope, bondRadius:2,
        cleanupMode:plan.cleanupMode,
        fixedInheritedHeavyAtomCount:plan.fixedInheritedHeavyAtomCount,
      });
    } catch (error) {
      // Retain the deterministic chemically seeded geometry, but keep the
      // failure visible to diagnostics instead of silently losing provenance.
      molecule.source = { ...(molecule.source || {}),
        lastInteractivePolishError:String(error?.message || error) };
    }
    finally { if (token === smallMoleculePolishSequence) updateBuildStatus(); }
  }, delay);
}

const BUILD_OPTIMIZATION_FRAME_COUNT = 26;

function expandSubsetCalculationTrajectory(result, molecule, globalAtomIndices) {
  const frameCount = Number(result.frameCount || 0);
  const subsetStride = globalAtomIndices.length * 3;
  const fullStride = molecule.atoms.length * 3;
  if (!frameCount || !(result.trajectory instanceof Float64Array)
    || result.trajectory.length !== frameCount * subsetStride
    || !(result.frameEnergies instanceof Float64Array)
    || !(result.frameSteps instanceof Int32Array))
    throw new Error('The ligand optimizer returned an invalid trajectory');
  const base = new Float64Array(fullStride);
  molecule.atoms.forEach((atom, index) => base.set([atom.x, atom.y, atom.z], index * 3));
  const trajectory = new Float64Array(frameCount * fullStride);
  for (let frame = 0; frame < frameCount; frame++) {
    const fullOffset = frame * fullStride;
    const subsetOffset = frame * subsetStride;
    trajectory.set(base, fullOffset);
    globalAtomIndices.forEach((globalIndex, localIndex) => {
      trajectory.set(result.trajectory.subarray(subsetOffset + localIndex * 3,
        subsetOffset + localIndex * 3 + 3), fullOffset + globalIndex * 3);
    });
  }
  return {
    ...result,
    trajectory,
    positions:trajectory.slice(trajectory.length - fullStride),
    movableAtomCount:globalAtomIndices.length,
    fixedAtomCount:molecule.atoms.length - globalAtomIndices.length,
  };
}

function showBuildOptimizationTrajectory(result, { method, title, energyLabel, meta }) {
  state.lastCalculation = {
    job:'geometry', initialEnergy:result.initialEnergy, finalEnergy:result.finalEnergy,
    forcefield:result.forcefield, fallback:result.fallback, converged:result.converged,
    platform:result.platform, backend:result.backend, elapsedMs:result.elapsedMs,
    method, frameCount:Number(result.frameCount || 0), replicaCount:1,
  };
  setCalculationFrames(result);
  state.lastCalculation.frameCount = state.calculationFrames.length;
  setText('#result-title', title);
  setText('#result-energy-label', energyLabel);
  setDisplayedEnergy(result.finalEnergy, result.unit);
  setText('#result-meta', meta);
  document.querySelector('#result-performance').classList.add('hidden');
  document.querySelector('#result-card').classList.remove('hidden');
  document.body.dataset.calculationState = 'complete';
  updateCalculationFrameUI();
  setMode('view');
  showToast(`Optimization path ready · ${state.calculationFrames.length} snapshots`);
}

async function optimizeEditableLigand() {
  const preferred = state.selectedAtom == null ? [] : [state.selectedAtom];
  const molecule = state.molecule;
  const plan = editableLigandComponentPlan(molecule, preferred);
  if (!plan) throw new Error('Select an editable ligand atom in a protein–ligand complex first.');
  const preserving = referencePreservingPolishSelection(molecule, plan.globalAtomIndices);
  const movable = new Set(preserving?.movableGlobalAtomIndices || plan.globalAtomIndices);
  const fixedAtomIndices = plan.globalAtomIndices.flatMap((globalIndex, localIndex) =>
    movable.has(globalIndex) ? [] : [localIndex]);
  updateBuildStatus(preserving
    ? 'MMFF94/UFF reference-preserving cleanup…'
    : 'MMFF94/UFF ligand-only optimization…');
  const result = await runRDKitJob('geometry', plan.molecule, ({ phase }) => {
    if (phase) updateBuildStatus(phase.replace('Optimizing', 'Optimizing ligand'));
  }, {
    maxIterations:300,
    snapshotFrequency:Math.max(1, Math.floor(300 / (BUILD_OPTIMIZATION_FRAME_COUNT - 1))),
    fixedAtomIndices,
  });
  if (state.molecule !== molecule) return null;
  const expandedResult = expandSubsetCalculationTrajectory(result, molecule, plan.globalAtomIndices);
  pushBuildHistory();
  applyCalculationPositions(expandedResult.positions, false);
  molecule.source = { ...(molecule.source || {}), lastLigandOptimization: {
    engine:result.forcefield, fallback:Boolean(result.fallback), elapsedMs:result.elapsedMs,
    atomCount:plan.globalAtomIndices.length,
    proteinFixedAtomCount:molecule.atoms.length - plan.globalAtomIndices.length,
    cleanupMode:preserving?.cleanupMode || 'free-local',
    fixedInheritedHeavyAtomCount:preserving?.fixedInheritedHeavyAtomCount || 0,
    initialEnergy:result.initialEnergy, finalEnergy:result.finalEnergy,
    environment:preserving
      ? 'isolated ligand; inherited reference heavy atoms and protein fixed; no protein–ligand nonbonded terms'
      : 'isolated ligand; protein coordinates fixed; no protein–ligand nonbonded terms',
  } };
  showBuildOptimizationTrajectory(expandedResult, {
    method:'ligand-rdkit', title:preserving ? 'Reference-preserving cleanup' : 'Ligand Optimization',
    energyLabel:'Final isolated-ligand potential energy',
    meta:`${result.forcefield}${result.fallback ? ' fallback' : ''} · ${preserving ? `${preserving.fixedInheritedHeavyAtomCount} inherited heavy atoms fixed` : 'isolated ligand'} · protein fixed · RDKit ${result.rdkitVersion} · ${(result.elapsedMs / 1000).toFixed(2)} s`,
  });
  updateBuildStatus(); updateHistoryButtons();
  return expandedResult;
}

function dedicatedWorkerCall(worker, job, molecule, options = {}, onProgress = () => {}) {
  const id = ++calculationSequence;
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = event.data;
      if (message?.id !== id) return;
      if (message.type === 'progress') { onProgress(message); return; }
      cleanup();
      if (message.type === 'result') resolve(message);
      else reject(new Error(message.message || 'Conformer worker failed'));
    };
    const onError = (event) => {
      cleanup();
      reject(new Error(event.message || 'Conformer worker crashed'));
    };
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({
      type: 'run', id, job, molecule: structuredClone(molecule),
      options: structuredClone(options),
    });
  });
}

function pruneConformerSeedStack(molecule, stack, threshold) {
  const stride = molecule.atoms.length * 3;
  const count = stack.length / stride;
  if (!Number.isInteger(count) || count < 1)
    throw new Error('RDKit worker pool returned an invalid conformer stack');
  if (!(threshold > 0) || count === 1) return Float32Array.from(stack);
  const symmetry = heavyAtomAutomorphisms(molecule);
  const kept = [];
  for (let index = 0; index < count; index++) {
    const candidate = stack.subarray(index * stride, (index + 1) * stride);
    const duplicate = kept.some((representative) =>
      symmetryAwareRmsd(representative, candidate, symmetry) < threshold);
    if (!duplicate) kept.push(candidate);
  }
  const pruned = new Float32Array(kept.length * stride);
  kept.forEach((positions, index) => pruned.set(positions, index * stride));
  return pruned;
}

function automaticRDKitConformerWorkerCount(conformerCount) {
  if (conformerCount < 32) return 1;
  const available = Math.max(1, Number(navigator.hardwareConcurrency || 2) - 1);
  return Math.min(4, available, Math.ceil(conformerCount / 16));
}

async function getRDKitConformerWorkerPool(count) {
  const primary = await getCalculationWorker('rdkit');
  const { workerUrl } = await verifyRDKitAssets();
  for (let index = rdkitConformerWorkers.length - 1; index >= 0; index--) {
    if (!rdkitConformerWorkers[index].failed) continue;
    rdkitConformerWorkers[index].worker.terminate();
    rdkitConformerWorkers.splice(index, 1);
  }
  while (rdkitConformerWorkers.length < count - 1) {
    const record = { worker:new Worker(workerUrl), failed:false };
    record.worker.addEventListener('error', () => { record.failed = true; });
    rdkitConformerWorkers.push(record);
  }
  return [primary, ...rdkitConformerWorkers.slice(0, count - 1).map(({ worker }) => worker)];
}

async function runRDKitConformerPool(molecule, onProgress, options = {}) {
  const requestedCount = Math.max(1, Math.min(256,
    Math.round(Number(options.conformerCount ?? 64))));
  const baseSeed = Math.round(Number(options.conformerSeed ?? 20260817));
  const pruneRmsThreshold = Math.max(0, Number(options.conformerPruneRms ?? 0.35));
  const requestedWorkers = options.conformerWorkerCount == null
    ? automaticRDKitConformerWorkerCount(requestedCount)
    : Math.round(Number(options.conformerWorkerCount));
  const workerCount = Math.max(1, Math.min(4, requestedCount,
    Number.isFinite(requestedWorkers) ? requestedWorkers : 1));
  if (workerCount === 1) {
    const result = await runWorkerJob('rdkit', 'conformers', molecule, onProgress, {
      ...options, conformerCount:requestedCount, conformerSeed:baseSeed,
      conformerPruneRms:pruneRmsThreshold,
    });
    return { ...result, workerCount:1, workerElapsedMs:[result.elapsedMs],
      poolGeneratedCount:result.conformerCount };
  }

  const started = performance.now();
  const workers = await getRDKitConformerWorkerPool(workerCount);
  const progress = Array.from({ length:workerCount }, () => ({ model:0, calculation:0 }));
  const base = Math.floor(requestedCount / workerCount);
  const remainder = requestedCount % workerCount;
  const jobs = workers.map((worker, index) => {
    const count = base + (index < remainder ? 1 : 0);
    return dedicatedWorkerCall(worker, 'conformers', molecule, {
      ...options,
      conformerCount:count,
      conformerSeed:baseSeed + index * 1000003,
      conformerPruneRms:pruneRmsThreshold,
    }, (message) => {
      progress[index] = {
        model:Number(message.model || 0), calculation:Number(message.calculation || 0),
      };
      const mean = (key) => progress.reduce((sum, item) => sum + item[key], 0) / workerCount;
      onProgress({
        phase:`RDKit workers ${index + 1}/${workerCount} · ${message.phase}`,
        model:mean('model'), calculation:mean('calculation'),
      });
    });
  });

  let results;
  try {
    results = await Promise.all(jobs);
  } catch (error) {
    rdkitConformerWorkers.forEach(({ worker }) => worker.terminate());
    rdkitConformerWorkers.length = 0;
    throw error;
  }
  const stride = molecule.atoms.length * 3;
  const generatedCount = results.reduce((sum, result) => sum + result.conformerCount, 0);
  const merged = new Float32Array(generatedCount * stride);
  let offset = 0;
  results.forEach((result) => {
    merged.set(result.conformers, offset);
    offset += result.conformers.length;
  });
  const conformers = pruneConformerSeedStack(molecule, merged, pruneRmsThreshold);
  const conformerCount = conformers.length / stride;
  if (!conformerCount) throw new Error('RDKit worker pool returned no distinct conformers');
  const forcefields = results.map((result) => result.preparationForcefield).filter(Boolean);
  const preparationForcefield = forcefields.includes('UFF') ? 'UFF'
    : forcefields[0] || 'ETKDGv3';
  onProgress({ phase:`Generated ${conformerCount} distinct conformers with ${workerCount} RDKit workers…`,
    model:1, calculation:0.96 });
  return {
    type:'result', job:'conformers', conformerCount, conformers,
    requestedCount,
    embeddedCount:results.reduce((sum, result) => sum + Number(result.embeddedCount || 0), 0),
    minimizedCount:results.reduce((sum, result) => sum + Number(result.minimizedCount || 0), 0),
    preparationForcefield,
    conformerMethod:results[0].conformerMethod || 'ETKDGv3',
    conformerSeed:baseSeed,
    pruneRmsThreshold,
    elapsedMs:performance.now() - started,
    workerElapsedMs:results.map((result) => result.elapsedMs),
    workerCount,
    poolGeneratedCount:generatedCount,
    platform:'WebAssembly workers',
    backend:`RDKit ETKDGv3 · ${workerCount} workers`,
  };
}

const CONFORMER_SAGE_RUNTIME_OPTIONS = Object.freeze({
  implicitSolvent:'obc2',
  constraintMode:'hbonds',
  nonbondedCutoffNm:0,
});

function compareStormmRescoreEnergies(packed, stormm, judgeEnergies) {
  if (!(stormm?.ensembleEnergies instanceof Float64Array)
      || !(judgeEnergies instanceof Float64Array)
      || stormm.frameCount !== packed.frameCount
      || stormm.replicaCount !== packed.seedCount
      || judgeEnergies.length !== packed.frameCount * packed.replicaCount)
    throw new Error('STORMM rescore check received incompatible energy arrays');
  const absoluteToleranceKcalMol = 2e-4;
  const relativeTolerance = 3e-4;
  let sum = 0, sumSquares = 0, maximumAbsolute = 0, maximumRelative = 0;
  let sampleCount = 0, passed = true;
  for (let frame = 0; frame < packed.frameCount; frame++) {
    packed.methodIds.forEach((methodId, replica) => {
      if (methodId !== 'stormm-webgpu') return;
      const seed = packed.seedIndices[replica];
      const webgpu = stormm.ensembleEnergies[frame * stormm.replicaCount + seed];
      const reference = judgeEnergies[frame * packed.replicaCount + replica];
      if (!Number.isFinite(webgpu) || !Number.isFinite(reference))
        throw new Error('STORMM rescore check encountered a non-finite energy');
      const difference = webgpu - reference;
      const absolute = Math.abs(difference);
      const relative = absolute / Math.max(1, Math.abs(reference));
      sum += difference;
      sumSquares += difference * difference;
      maximumAbsolute = Math.max(maximumAbsolute, absolute);
      maximumRelative = Math.max(maximumRelative, relative);
      passed &&= absolute <= absoluteToleranceKcalMol || relative <= relativeTolerance;
      sampleCount++;
    });
  }
  if (!sampleCount) throw new Error('STORMM rescore check found no STORMM candidates');
  return {
    sampleCount,
    maximumAbsoluteKcalMol:maximumAbsolute,
    rmsKcalMol:Math.sqrt(sumSquares / sampleCount),
    meanSignedKcalMol:sum / sampleCount,
    maximumRelative,
    absoluteToleranceKcalMol,
    relativeTolerance,
    passed,
    settings:{ ...CONFORMER_SAGE_RUNTIME_OPTIONS },
  };
}

async function runStormmScoreBatch(molecule, coordinateStack, onProgress, options) {
  const atomStride = molecule.atoms.length * 3;
  if (!ArrayBuffer.isView(coordinateStack) || !coordinateStack.length
      || coordinateStack.length % atomStride)
    throw new Error('The common Sage judge received an invalid coordinate stack');
  const coordinateCount = coordinateStack.length / atomStride;
  const pairLimitedBatch = Math.max(1,
    Math.floor(2_100_000 / Math.max(1, molecule.atoms.length * molecule.atoms.length)));
  const batchSize = Math.min(1024, coordinateCount, pairLimitedBatch);
  const energies = new Float64Array(coordinateCount);
  let elapsedMs = 0;
  let firstResult = null;
  let batchCount = 0;
  for (let start = 0; start < coordinateCount; start += batchSize) {
    const end = Math.min(coordinateCount, start + batchSize);
    const coordinates = coordinateStack.slice(start * atomStride, end * atomStride);
    const result = await runStormmJob('score-batch', molecule, (message) => {
      const local = Number(message.calculation || 0);
      onProgress({ ...message,
        phase:`Common Sage WebGPU score · ${end}/${coordinateCount} structures…`,
        calculation:0.88 + 0.08 * ((start + local * (end - start)) / coordinateCount),
      });
    }, { ...options, stormmSystem:'current', coordinateStack:coordinates });
    if (!(result.ensembleEnergies instanceof Float64Array)
        || result.ensembleEnergies.length !== end - start)
      throw new Error('The common Sage WebGPU judge returned an incomplete energy batch');
    energies.set(result.ensembleEnergies, start);
    elapsedMs += Number(result.elapsedMs || 0);
    firstResult ||= result;
    batchCount += 1;
  }
  return {
    ...firstResult, energies, coordinateCount, elapsedMs, scoreMs:elapsedMs,
    batchCount, batchSize, platform:'WebGPU', backend:'STORMM WebGPU batched Sage judge',
  };
}

async function runConformerArena(molecule, seeds, options, onProgress, parameterizationMs = 0) {
  const {
    implicitSolvent:_mdImplicitSolvent,
    constraintMode:_mdConstraintMode,
    nonbondedCutoffNm:_mdNonbondedCutoffNm,
    ...sharedOptions
  } = options;
  const sageOptions = { ...sharedOptions, ...CONFORMER_SAGE_RUNTIME_OPTIONS };
  const aniOptions = { ...sharedOptions, modelEnvironment:'vacuum' };
  const started = performance.now();
  const initialConformers = seeds.conformers;
  const [{ buildConformerArenaEnsemble, analyzeConformerArena },
    { conformerSearchProtocol }] = await Promise.all([
    import('./openff/conformer-arena.js'), import('./openff/conformer-protocol.js'),
  ]);
  const protocol = conformerSearchProtocol(sageOptions);
  const runLane = async (worker, label) => {
    onProgress({ phase: `Conformer Arena · ${label}…`, model: 1, calculation: 0.2 });
    try {
      return await dedicatedWorkerCall(worker, 'conformers', molecule,
        { ...sageOptions, stormmSystem: 'current', initialConformers }, onProgress);
    } finally {
      worker.terminate();
    }
  };
  const stormm = await runLane(
    new Worker('./stormm-worker.js', { type: 'module' }), 'STORMM WebGPU · Sage/OBC2');
  const lanes = [{ methodId: 'stormm-webgpu', result: stormm }];
  const timings = {
    'etkdg-mmff': { searchMs: seeds.elapsedMs, endToEndMs: seeds.elapsedMs },
    'stormm-webgpu': {
      searchMs: stormm.searchMs,
      endToEndMs: seeds.elapsedMs + parameterizationMs + stormm.elapsedMs,
    },
  };
  const aniCompatibility = ani2xUiCompatibility(molecule);
  let ani2x = null;
  if (sharedOptions.conformerAni2x !== false && aniCompatibility.supported) {
    onProgress({ phase: 'Conformer Arena · ANI-2x MLIP…', model: 1, calculation: 0.2 });
    ani2x = await runAni2xJob('conformers', molecule, onProgress, {
      ...aniOptions, initialConformers,
    });
    lanes.push({ methodId: 'ani2x', result: ani2x });
    timings.ani2x = {
      searchMs: ani2x.searchMs,
      endToEndMs: seeds.elapsedMs + ani2x.elapsedMs,
    };
  }
  const packed = buildConformerArenaEnsemble({
    molecule, seeds: initialConformers, lanes,
  });
  const finalCoordinateOffset = (packed.frameCount - 1) * packed.replicaCount * packed.atomStride;
  const finalCoordinates = packed.ensembleTrajectory.slice(
    finalCoordinateOffset, finalCoordinateOffset + packed.replicaCount * packed.atomStride);
  onProgress({ phase: `Common Sage + ANI scores · ${packed.replicaCount} candidates…`,
    model: 1, calculation: 0.88 });
  const judgePromise = runStormmScoreBatch(molecule, packed.ensembleTrajectory, onProgress, {
    ...sageOptions, coordinateStack: packed.ensembleTrajectory,
  });
  const aniRescorePromise = ani2x
    ? runAni2xJob('score-batch', molecule, onProgress, {
      ...aniOptions, coordinateStack:finalCoordinates,
    }).then((rescore) => ({ rescore, error:null }))
      .catch((error) => ({ rescore:null,
        error:error instanceof Error ? error.message : String(error) }))
    : Promise.resolve({ rescore:null, error:aniCompatibility.reason });
  const [judge, aniRescoreOutcome] = await Promise.all([judgePromise, aniRescorePromise]);
  const aniRescore = aniRescoreOutcome.rescore;
  if (judge.energies.length !== packed.frameCount * packed.replicaCount)
    throw new Error('Conformer Arena judge returned an incomplete energy stack');
  if (aniRescore && (!(aniRescore.energies instanceof Float64Array)
      || aniRescore.energies.length !== packed.replicaCount
      || ![...aniRescore.energies].every(Number.isFinite)))
    throw new Error('ANI-2x common rescore returned an incomplete energy stack');
  let ani2xRescoreLaneMaximumDifference = null;
  if (aniRescore && ani2x) {
    const laneFinalOffset = (ani2x.frameCount - 1) * ani2x.replicaCount;
    ani2xRescoreLaneMaximumDifference = packed.methodIds.reduce((maximum, methodId, replica) => {
      if (methodId !== 'ani2x') return maximum;
      const seed = packed.seedIndices[replica];
      return Math.max(maximum,
        Math.abs(aniRescore.energies[replica] - ani2x.ensembleEnergies[laneFinalOffset + seed]));
    }, 0);
    if (ani2xRescoreLaneMaximumDifference > 0.02)
      throw new Error(`ANI-2x common rescore disagrees with its refinement lane by ${ani2xRescoreLaneMaximumDifference.toFixed(4)} kcal/mol`);
  }
  const stormmRescoreConsistency = compareStormmRescoreEnergies(packed, stormm, judge.energies);
  if (!stormmRescoreConsistency.passed)
    throw new Error(`STORMM same-coordinate rescore failed: maximum |ΔE| ${stormmRescoreConsistency.maximumAbsoluteKcalMol.toFixed(4)} kcal/mol`);
  const result = {
    type: 'result', job: 'conformers', molecule,
    positions: packed.ensembleTrajectory.slice(0, packed.atomStride),
    initialEnergy: judge.energies[0], finalEnergy: judge.energies.at(-1),
    elapsedMs: performance.now() - started + seeds.elapsedMs + parameterizationMs,
    searchMs: lanes.reduce((sum, lane) => sum + Number(lane.result.searchMs || 0), 0),
    seedElapsedMs: seeds.elapsedMs, parameterizationMs, judgeElapsedMs: judge.elapsedMs,
    ani2xModelEvaluations: ani2x?.modelEvaluations || 0,
    ani2xInferenceBatches: ani2x?.inferenceBatches || 0,
    ani2xBatchSize: ani2x?.inferenceBatchSize || 0,
    ani2xRescoreMs: aniRescore?.scoreMs || 0,
    ani2xRescoreModelEvaluations: aniRescore?.modelEvaluations || 0,
    ani2xRescoreInferenceBatches: aniRescore?.inferenceBatches || 0,
    ani2xRescoreLaneMaximumDifference,
    ani2xAevBuildMs: ani2x?.aevBuildMs || 0,
    ani2xNetworkMs: ani2x?.networkMs || 0,
    ani2xForceContractionMs: ani2x?.forceContractionMs || 0,
    ani2xDescriptorBackend: ani2x?.descriptorBackend || null,
    forcefield: judge.forcefield, chargeModel: judge.chargeModel,
    sourceSha256: judge.sourceSha256,
    platform: 'WebGPU + WebAssembly + ONNX Runtime', backend: 'Molarium Conformer Arena',
    unit: 'kcal/mol', timestepFs: stormm.timestepFs,
    frameCount: packed.frameCount,
    frameSteps: Int32Array.from(stormm.frameSteps),
    replicaCount: packed.replicaCount,
    ensembleEnergies: judge.energies,
    ensembleTrajectory: packed.ensembleTrajectory,
    ensembleLayout: 'frame-replica-xyz', homogeneous: true,
    implicitSolvent: judge.implicitSolvent,
    constraintMode: judge.constraintMode,
    constraintCount: judge.constraintCount,
    constraintError: Math.max(...lanes.map((lane) => Number(lane.result.constraintError || 0))),
    conformerSearchSteps: protocol.searchSteps,
    conformerMinimizationIterations: protocol.minimizationIterations,
    conformerStageLabels: protocol.stages.map((stage) => stage.label),
    conformerMethod: seeds.conformerMethod,
    conformerPreparationForcefield: seeds.preparationForcefield,
    conformerPruneRms: seeds.pruneRmsThreshold,
    arenaMethodIds: packed.methodIds,
    arenaSeedIndices: packed.seedIndices,
    arenaSeedCount: packed.seedCount,
  };
  const analysis = analyzeConformerSearch(result, Number(options.conformerClusterRms ?? 0.5));
  result.arena = analyzeConformerArena({
    analysis,
    methodIds: packed.methodIds,
    timings,
  });
  result.arena.ani2xIncluded = Boolean(ani2x);
  result.arena.environments = {
    'etkdg-mmff':'vacuum',
    'stormm-webgpu':'OBC2/ACE implicit water',
    judge:'OBC2/ACE implicit water',
    ani2x:ani2x?.modelEnvironment || null,
  };
  result.arena.stormmRescoreConsistency = stormmRescoreConsistency;
  result.arena.ani2xModelEvaluations = ani2x?.modelEvaluations || 0;
  result.arena.ani2xInferenceBatches = ani2x?.inferenceBatches || 0;
  result.arena.ani2xBatchSize = ani2x?.inferenceBatchSize || 0;
  result.arena.ani2xRescoreAvailable = Boolean(aniRescore);
  result.arena.ani2xRescoreUnavailableReason = aniRescore
    ? null : aniRescoreOutcome.error || 'ANI-2x common rescore was unavailable';
  result.arena.ani2xRescoreMs = aniRescore?.scoreMs || 0;
  result.arena.ani2xRescoreModelEvaluations = aniRescore?.modelEvaluations || 0;
  result.arena.ani2xRescoreInferenceBatches = aniRescore?.inferenceBatches || 0;
  result.arena.ani2xRescoreLaneMaximumDifference = ani2xRescoreLaneMaximumDifference;
  result.arena.ani2xAevBuildMs = ani2x?.aevBuildMs || 0;
  result.arena.ani2xNetworkMs = ani2x?.networkMs || 0;
  result.arena.ani2xForceContractionMs = ani2x?.forceContractionMs || 0;
  result.arena.ani2xDescriptorBackend = ani2x?.descriptorBackend || null;
  result.arena.skippedMethods = ani2x ? [] : [{
    id: 'ani2x', label: 'ANI-2x MLIP', reason: aniCompatibility.reason,
  }];
  analysis.arena = result.arena;
  analysis.methodIds = packed.methodIds.slice();
  analysis.seedIndices = Int32Array.from(packed.seedIndices);
  analysis.nativeScoreSeries = {};
  if (aniRescore) {
    const minimum = Math.min(...aniRescore.energies);
    analysis.nativeScoreSeries.ani2x = {
      key:'ani2x', label:'ANI-2x', shortLabel:'ANI-2x',
      provenance:'Vacuum ANI-2x single-point rescore of every final Arena candidate; no implicit-solvent term',
      environment:aniRescore.modelEnvironment || 'vacuum',
      energies:aniRescore.energies,
      offsets:Float64Array.from(aniRescore.energies, (energy) => energy - minimum),
    };
  }
  return result;
}

async function runWorkerJob(method, job, molecule, onProgress, options = {}) {
  const worker = await getCalculationWorker(method);
  const id = ++calculationSequence;
  return new Promise((resolve, reject) => {
    pendingCalculations.set(id, { resolve, reject, onProgress, method, job });
    worker.postMessage({
      type: 'run', id, job, molecule: structuredClone(molecule),
      options: {
        tolerance: 5, maxIterations: 750, snapshotFrequency: 25,
        steps: Number(document.querySelector('#simulation-step-count').value), temperature: 300,
        savedFrameCount: Number(document.querySelector('#trajectory-frame-count').value),
        implicitSolvent: document.querySelector('#solvent-select')?.value || 'vacuum',
        constraintMode: document.querySelector('#constraint-select')?.value || 'none',
        // The current all-pairs neighbor-list builder makes the optional 1 nm
        // path slower for the protein fixtures we benchmarked.  Keep the
        // validated kernel available to direct test/API calls, but production
        // UI jobs deliberately use the complete nonbonded range.
        nonbondedCutoffNm: 0,
        stormmSystem: document.querySelector('#stormm-system').value,
        replicaCount: Number(document.querySelector('#stormm-replica-count').value),
        conformerCount: Number(document.querySelector('#conformer-count')?.value || 64),
        conformerEffort: document.querySelector('#conformer-effort')?.value || 'balanced',
        conformerClusterRms: Number(document.querySelector('#conformer-cluster-rms')?.value || 0.5),
        conformerPruneRms: 0.35,
        conformerSeed: 20260817,
        conformerMinimizeIterations: 100,
        ...options,
      },
    });
  });
}

function setCalculationProgress({ phase, model, calculation }) {
  setText('#run-status', phase);
  document.querySelector('#progress-model').style.width = `${Math.round(model * 100)}%`;
  document.querySelector('#progress-calc').style.width = `${Math.round(calculation * 100)}%`;
}

function formatEnergy(energy, unit = 'kcal/mol') {
  const absolute = Math.abs(energy);
  const value = absolute > 0 && (absolute < 0.001 || absolute >= 100000)
    ? energy.toExponential(4)
    : energy.toFixed(4);
  return `${value.replace('-', '−')} ${unit}`;
}

function setDisplayedEnergy(energy, unit = 'kcal/mol') {
  setText('#result-energy', formatEnergy(energy, unit));
}

function updateEnergyChart(frames) {
  const energies = frames.map((frame) => frame.energy);
  const low = Math.min(...energies);
  const high = Math.max(...energies);
  const range = high - low;
  const yFor = (energy) => range < 1e-10 ? 52 : 18 + ((high - energy) / range) * 66;
  const points = frames.map((frame, index) => ({
    x: frames.length === 1 ? 135 : 25 + index / (frames.length - 1) * 220,
    y: yFor(frame.energy),
  }));
  document.querySelector('#energy-curve').setAttribute('d', points.map((point, index) =>
    `${index ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' '));
  const group = document.querySelector('#energy-points');
  group.replaceChildren();
  points.forEach((point, index) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', point.x.toFixed(2)); circle.setAttribute('cy', point.y.toFixed(2)); circle.setAttribute('r', '3');
    circle.dataset.frameIndex = String(index); circle.setAttribute('tabindex', '0'); circle.setAttribute('role', 'button');
    const frameName = state.calculationJob === 'dynamics' ? 'MD frame'
      : state.calculationJob === 'geometry' ? 'minimization frame'
        : state.calculationJob === 'conformers' ? 'search stage' : 'calculation frame';
    circle.setAttribute('aria-label', `Show ${frameName} ${index + 1}`);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${frameName[0].toUpperCase()}${frameName.slice(1)} ${index + 1} · ${formatEnergy(frames[index].energy, state.calculationUnit)}`;
    circle.append(title);
    circle.addEventListener('click', () => {
      runChemistUiAction('calculation.selectFrame', { index }).catch(() => {});
    });
    circle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        runChemistUiAction('calculation.selectFrame', { index }).catch(() => {});
      }
    });
    group.append(circle);
  });
}

function applyCalculationPositions(positions, recordHistory = true) {
  if (!(positions instanceof Float64Array) || positions.length !== state.molecule.atoms.length * 3)
    throw new Error('The calculation engine returned an invalid coordinate array');
  if (recordHistory) pushBuildHistory();
  state.molecule.atoms.forEach((atom, index) => {
    atom.x = positions[index * 3];
    atom.y = positions[index * 3 + 1];
    atom.z = positions[index * 3 + 2];
  });
  state.molecule.bonds.forEach((bond) => {
    const atomA = state.molecule.atoms[bond.a], atomB = state.molecule.atoms[bond.b];
    bond.distance = Math.hypot(atomA.x - atomB.x, atomA.y - atomB.y, atomA.z - atomB.z);
  });
  updateInfo();
  draw();
}

function unpackCalculationFrames(result) {
  if (Array.isArray(result.frames)) return result.frames.map((frame) => ({
    step: frame.step,
    energy: frame.energy,
    positions: frame.positions instanceof Float64Array ? frame.positions : Float64Array.from(frame.positions),
  }));
  const count = Number(result.frameCount || 0);
  const stride = state.molecule.atoms.length * 3;
  if (!count || !(result.frameEnergies instanceof Float64Array)
    || !(result.frameSteps instanceof Int32Array) || !(result.trajectory instanceof Float64Array)
    || result.trajectory.length !== count * stride) return [];
  return Array.from({ length: count }, (_, index) => ({
    step: result.frameSteps[index],
    energy: result.frameEnergies[index],
    positions: result.trajectory.slice(index * stride, (index + 1) * stride),
  }));
}

function unpackEnsembleReplica(result, replica) {
  const frameCount = Number(result.frameCount || 0);
  const replicaCount = Number(result.replicaCount || 0);
  const atomStride = state.molecule?.atoms.length * 3;
  const frameStride = replicaCount * atomStride;
  if (!frameCount || !Number.isInteger(replicaCount) || replica < 0 || replica >= replicaCount
    || !(result.frameSteps instanceof Int32Array)
    || !(result.ensembleEnergies instanceof Float64Array)
    || !(result.ensembleTrajectory instanceof Float32Array)
    || result.frameSteps.length !== frameCount
    || result.ensembleEnergies.length !== frameCount * replicaCount
    || result.ensembleTrajectory.length !== frameCount * frameStride
    || result.ensembleLayout !== 'frame-replica-xyz') return [];
  return Array.from({ length: frameCount }, (_, frame) => {
    const offset = frame * frameStride + replica * atomStride;
    return {
      step: result.frameSteps[frame],
      energy: result.ensembleEnergies[frame * replicaCount + replica],
      positions: Float64Array.from(result.ensembleTrajectory.subarray(offset, offset + atomStride)),
    };
  });
}

function trajectoryProjectionRadius(frames, atomCount) {
  if (!frames.length || atomCount < 1) return null;
  let maximum = 0;
  for (const frame of frames) {
    if (!(frame.positions instanceof Float64Array) || frame.positions.length !== atomCount * 3)
      continue;
    const center = [0, 0, 0];
    for (let atom = 0; atom < atomCount; atom++) for (let axis = 0; axis < 3; axis++)
      center[axis] += frame.positions[atom * 3 + axis] / atomCount;
    for (let atom = 0; atom < atomCount; atom++) {
      maximum = Math.max(maximum, Math.hypot(
        frame.positions[atom * 3] - center[0],
        frame.positions[atom * 3 + 1] - center[1],
        frame.positions[atom * 3 + 2] - center[2],
      ));
    }
  }
  return maximum > 0 && Number.isFinite(maximum) ? maximum : null;
}

function updateEnsembleHeading() {
  const ensemble = state.calculationEnsemble;
  if (!ensemble) return;
  const replica = state.calculationReplicaIndex;
  const frameCount = Number(ensemble.frameCount);
  const replicaCount = Number(ensemble.replicaCount);
  if (state.conformerAnalysis) {
    const analysis = state.conformerAnalysis;
    const plotOrder = activeConformerPlotOrder(analysis);
    const rank = plotOrder.indexOf(replica) + 1;
    const arenaMethod = analysis.arena?.methods.find((method) =>
      method.id === analysis.methodIds?.[replica]);
    const commonRank = analysis.order.indexOf(replica) + 1;
    setText('#result-conformer-label', commonRank
      ? `Selected #${commonRank}` : `Not ranked`);
    setText('#result-frame-heading', `${arenaMethod ? arenaMethod.shortLabel : `Conformer ${replica + 1}`} · ${frameCount} search stages`);
    document.querySelector('#result-conformer-select').value = String(replica);
    document.querySelector('#result-conformer-best').disabled = rank === 1 || !plotOrder.length;
    document.querySelector('#result-conformer-previous').disabled = rank <= 1;
    document.querySelector('#result-conformer-next').disabled = !rank || rank >= plotOrder.length;
    const cluster = analysis.clusterIds[replica] + 1;
    const xMetric = conformerCvDefinition(analysis);
    const yMetric = conformerYAxisDefinition(analysis);
    const axisValues = [xMetric, yMetric]
      .filter((metric, index, array) => Number.isFinite(metric.values[replica])
        && array.findIndex((candidate) => candidate.key === metric.key) === index)
      .map((metric) => `${metric.shortLabel} ${formatConformerMetricValue(metric.values[replica], metric)}`)
      .join(' · ');
    const clusterText = analysis.clusterCount === analysis.count
      ? `unique at ${analysis.clusterCutoff.toFixed(2)} Å cutoff`
      : `cluster ${cluster}/${analysis.clusterCount}${analysis.representativeIndices.includes(replica) ? ' · representative' : ''}`;
    setText('#result-conformer-summary', `${arenaMethod ? `${arenaMethod.label} candidate · ` : ''}${axisValues}${axisValues ? ' · ' : ''}${clusterText} · viewer symmetry-aligned to the judged minimum.`);
    document.querySelectorAll('#result-conformer-shortlist tr').forEach((row) => {
      const active = Number(row.dataset.replicaIndex) === replica;
      row.classList.toggle('active', active);
      row.setAttribute('aria-selected', String(active));
    });
    drawConformerScatter();
    return;
  }
  setText('#result-replica-label', `Replica ${replica + 1}/${replicaCount}`);
  setText('#result-frame-heading', `${state.trajectoryDisplayAlignment ? 'Aligned trajectory' : 'Trajectory'} ${replica + 1} · ${frameCount} snapshots`);
  document.querySelector('#result-replica-select').value = String(replica);
  const initial = ensemble.ensembleEnergies[replica];
  const final = ensemble.ensembleEnergies[(frameCount - 1) * replicaCount + replica];
  const drift = final - initial;
  const rmsd = ensembleReplicaRmsds(ensemble)[replica];
  setText('#result-replica-summary', `Final ${formatEnergy(final, ensemble.unit)} · Δ ${formatEnergy(drift, ensemble.unit)} · heavy-atom RMSD ${rmsd.toFixed(3)} Å.`);
}

function fittedRigidTransform(reference, candidate, referenceAtomIndices,
  candidateAtomIndices = referenceAtomIndices) {
  if (!referenceAtomIndices.length || candidateAtomIndices.length !== referenceAtomIndices.length) {
    return {
      referenceCenter:[0, 0, 0], candidateCenter:[0, 0, 0],
      rotation:[[1, 0, 0], [0, 1, 0], [0, 0, 1]], rmsd:0,
    };
  }
  const referenceCenter = [0, 0, 0], candidateCenter = [0, 0, 0];
  for (let index = 0; index < referenceAtomIndices.length; index++) {
    const referenceAtom = referenceAtomIndices[index];
    const candidateAtom = candidateAtomIndices[index];
    for (let axis = 0; axis < 3; axis++) {
      referenceCenter[axis] += reference[referenceAtom * 3 + axis];
      candidateCenter[axis] += candidate[candidateAtom * 3 + axis];
    }
  }
  for (let axis = 0; axis < 3; axis++) {
    referenceCenter[axis] /= referenceAtomIndices.length;
    candidateCenter[axis] /= referenceAtomIndices.length;
  }
  const covariance = Array.from({ length: 3 }, () => [0, 0, 0]);
  let referenceNorm = 0, candidateNorm = 0;
  for (let index = 0; index < referenceAtomIndices.length; index++) {
    const referenceAtom = referenceAtomIndices[index];
    const candidateAtom = candidateAtomIndices[index];
    const p = [0, 1, 2].map((axis) =>
      reference[referenceAtom * 3 + axis] - referenceCenter[axis]);
    const q = [0, 1, 2].map((axis) =>
      candidate[candidateAtom * 3 + axis] - candidateCenter[axis]);
    referenceNorm += p[0] ** 2 + p[1] ** 2 + p[2] ** 2;
    candidateNorm += q[0] ** 2 + q[1] ** 2 + q[2] ** 2;
    for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++)
      covariance[row][column] += p[row] * q[column];
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = covariance;
  const horn = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  const shift = Math.max(...horn.map((row) => row.reduce((sum, value) => sum + Math.abs(value), 0)));
  let vector = [0.5, 0.5, 0.5, 0.5];
  for (let iteration = 0; iteration < 48 && shift > 0; iteration++) {
    const next = horn.map((row, index) => row.reduce((sum, value, column) =>
      sum + value * vector[column], shift * vector[index]));
    const norm = Math.hypot(...next) || 1;
    vector = next.map((value) => value / norm);
  }
  const maximumTrace = vector.reduce((sum, value, row) => sum + value * horn[row]
    .reduce((inner, matrixValue, column) => inner + matrixValue * vector[column], 0), 0);
  const meanSquared = Math.max(0,
    (referenceNorm + candidateNorm - 2 * maximumTrace) / referenceAtomIndices.length);
  const [w, x, y, z] = vector;
  return {
    referenceCenter,
    candidateCenter,
    // This matrix follows Horn's covariance convention above. applyRigidFit()
    // uses its transpose to map the candidate onto the reference.
    rotation:[
      [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ],
    rmsd:Math.sqrt(meanSquared),
  };
}

function applyRigidFit(candidate, fit) {
  const transformed = new Float64Array(candidate.length);
  for (let atom = 0; atom < candidate.length / 3; atom++) {
    const centered = [0, 1, 2].map((axis) =>
      candidate[atom * 3 + axis] - fit.candidateCenter[axis]);
    for (let axis = 0; axis < 3; axis++) {
      transformed[atom * 3 + axis] = fit.referenceCenter[axis]
        + fit.rotation[0][axis] * centered[0]
        + fit.rotation[1][axis] * centered[1]
        + fit.rotation[2][axis] * centered[2];
    }
  }
  return transformed;
}

function fittedRmsd(reference, candidate, atomIndices) {
  return fittedRigidTransform(reference, candidate, atomIndices).rmsd;
}

function analyzeTrajectoryFrames(frames, molecule, constraintMode = 'none') {
  const atomCount = molecule?.atoms?.length || 0;
  if (!frames?.length || atomCount < 1) return null;
  const system = molecule.parameterization?.system;
  const masses = Array.from({ length: atomCount }, (_, atom) => {
    const mass = Number(system?.particles?.[atom]?.mass_amu);
    return mass > 0 && Number.isFinite(mass) ? mass : 1;
  });
  const totalMass = masses.reduce((sum, mass) => sum + mass, 0);
  const heavyAtoms = molecule.atoms.map((atom, index) => atom.element === 'H' ? -1 : index)
    .filter((index) => index >= 0);
  const rmsdAtoms = heavyAtoms.length ? heavyAtoms : Array.from({ length: atomCount }, (_, index) => index);
  const constraints = new Map();
  const addConstraint = (first, second, distanceNm) => {
    const i = Number(first), j = Number(second), target = Number(distanceNm) * 10;
    if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0
        || i >= atomCount || j >= atomCount || i === j || !(target > 0) || !Number.isFinite(target)) return;
    const key = i < j ? `${i}:${j}` : `${j}:${i}`;
    constraints.set(key, { i, j, target });
  };
  for (const term of system?.constraints || []) addConstraint(term.i, term.j, term.distance_nm);
  if (constraintMode === 'hbonds') for (const term of system?.bonds || []) {
    const firstHydrogen = molecule.atoms[term.i]?.element === 'H';
    const secondHydrogen = molecule.atoms[term.j]?.element === 'H';
    if (firstHydrogen !== secondHydrogen) addConstraint(term.i, term.j, term.r0_nm);
  }

  const initial = frames[0].positions;
  const initialCom = [0, 0, 0];
  for (let atom = 0; atom < atomCount; atom++) for (let axis = 0; axis < 3; axis++)
    initialCom[axis] += initial[atom * 3 + axis] * masses[atom] / totalMass;
  const perFrame = [];
  for (const frame of frames) {
    const positions = frame.positions;
    if (!(positions instanceof Float64Array) || positions.length !== atomCount * 3) continue;
    const com = [0, 0, 0], center = [0, 0, 0];
    for (let atom = 0; atom < atomCount; atom++) for (let axis = 0; axis < 3; axis++) {
      const coordinate = positions[atom * 3 + axis];
      com[axis] += coordinate * masses[atom] / totalMass;
      center[axis] += coordinate / atomCount;
    }
    let gyration2 = 0, maximumRadius = 0, maximumConstraintError = 0;
    for (let atom = 0; atom < atomCount; atom++) {
      const dx = positions[atom * 3] - com[0];
      const dy = positions[atom * 3 + 1] - com[1];
      const dz = positions[atom * 3 + 2] - com[2];
      gyration2 += masses[atom] * (dx * dx + dy * dy + dz * dz) / totalMass;
      maximumRadius = Math.max(maximumRadius, Math.hypot(
        positions[atom * 3] - center[0],
        positions[atom * 3 + 1] - center[1],
        positions[atom * 3 + 2] - center[2],
      ));
    }
    for (const { i, j, target } of constraints.values()) {
      const distance = Math.hypot(
        positions[i * 3] - positions[j * 3],
        positions[i * 3 + 1] - positions[j * 3 + 1],
        positions[i * 3 + 2] - positions[j * 3 + 2],
      );
      maximumConstraintError = Math.max(maximumConstraintError, Math.abs(distance / target - 1));
    }
    perFrame.push({
      step: Number(frame.step) || 0,
      energy: Number(frame.energy),
      radiusOfGyrationAngstrom: Math.sqrt(gyration2),
      maximumRadiusAngstrom: maximumRadius,
      centerOfMassDriftAngstrom: Math.hypot(
        com[0] - initialCom[0], com[1] - initialCom[1], com[2] - initialCom[2]),
      heavyAtomRmsdAngstrom: fittedRmsd(initial, positions, rmsdAtoms),
      maximumConstraintRelativeError: maximumConstraintError,
    });
  }
  if (!perFrame.length) return null;
  const summary = (name) => {
    const values = perFrame.map((frame) => frame[name]);
    const minimum = Math.min(...values), maximum = Math.max(...values);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return { minimum, maximum, mean, relativeSpan: (maximum - minimum) / Math.max(Math.abs(mean), 1e-12) };
  };
  return {
    frameCount: perFrame.length,
    constraintCount: constraints.size,
    maximumConstraintRelativeError: Math.max(...perFrame.map((frame) => frame.maximumConstraintRelativeError)),
    radiusOfGyrationAngstrom: summary('radiusOfGyrationAngstrom'),
    maximumRadiusAngstrom: summary('maximumRadiusAngstrom'),
    maximumCenterOfMassDriftAngstrom: Math.max(...perFrame.map((frame) => frame.centerOfMassDriftAngstrom)),
    maximumHeavyAtomRmsdAngstrom: Math.max(...perFrame.map((frame) => frame.heavyAtomRmsdAngstrom)),
    finalHeavyAtomRmsdAngstrom: perFrame.at(-1).heavyAtomRmsdAngstrom,
    perFrame,
  };
}

function heavyAtomAutomorphisms(molecule, maximum = 512) {
  const heavyAtoms = molecule.atoms.map((atom, index) => atom.element === 'H' ? -1 : index)
    .filter((index) => index >= 0);
  if (!heavyAtoms.length) {
    const allAtoms = molecule.atoms.map((_, index) => index);
    return { heavyAtoms: allAtoms, mappings: [Int32Array.from(allAtoms)], truncated: false };
  }
  const heavySet = new Set(heavyAtoms);
  const adjacency = new Map(heavyAtoms.map((index) => [index, new Map()]));
  const allNeighbors = molecule.atoms.map(() => []);
  const bondToken = (bond) => Number(bond.order || 1).toFixed(2);
  molecule.bonds.forEach((bond) => {
    const token = bondToken(bond);
    allNeighbors[bond.a].push(`${token}:${molecule.atoms[bond.b].element}`);
    allNeighbors[bond.b].push(`${token}:${molecule.atoms[bond.a].element}`);
    if (heavySet.has(bond.a) && heavySet.has(bond.b)) {
      adjacency.get(bond.a).set(bond.b, token);
      adjacency.get(bond.b).set(bond.a, token);
    }
  });
  let colors = new Map(heavyAtoms.map((index) => [index, [
    molecule.atoms[index].element,
    Number(molecule.atoms[index].charge || 0),
    molecule.atoms[index].aromatic ? 1 : 0,
    allNeighbors[index].slice().sort().join(','),
  ].join('|')]));
  for (let pass = 0; pass < heavyAtoms.length; pass++) {
    const signatures = new Map(heavyAtoms.map((index) => [index,
      `${colors.get(index)}[${[...adjacency.get(index)].map(([neighbor, token]) =>
        `${token}:${colors.get(neighbor)}`).sort().join(',')}]`]));
    const palette = new Map([...new Set(signatures.values())].sort()
      .map((signature, index) => [signature, String(index)]));
    const next = new Map(heavyAtoms.map((index) => [index, palette.get(signatures.get(index))]));
    if (heavyAtoms.every((index) => next.get(index) === colors.get(index))) break;
    colors = next;
  }
  const candidates = new Map(heavyAtoms.map((source) => [source,
    heavyAtoms.filter((target) => colors.get(target) === colors.get(source))]));
  const order = heavyAtoms.slice().sort((a, b) => candidates.get(a).length - candidates.get(b).length
    || adjacency.get(b).size - adjacency.get(a).size || a - b);
  const identity = Int32Array.from(heavyAtoms);
  const mappings = [identity];
  const assigned = new Map(), used = new Set();
  let truncated = false;
  const visit = (depth) => {
    if (mappings.length >= maximum) { truncated = true; return; }
    if (depth === order.length) {
      const mapping = Int32Array.from(heavyAtoms, (atom) => assigned.get(atom));
      if (!mapping.every((target, index) => target === identity[index])) mappings.push(mapping);
      return;
    }
    const source = order[depth];
    for (const target of candidates.get(source)) {
      if (used.has(target)) continue;
      let compatible = true;
      for (const [otherSource, otherTarget] of assigned) {
        const sourceBond = adjacency.get(source).get(otherSource) || '';
        const targetBond = adjacency.get(target).get(otherTarget) || '';
        if (sourceBond !== targetBond) { compatible = false; break; }
      }
      if (!compatible) continue;
      assigned.set(source, target); used.add(target);
      visit(depth + 1);
      used.delete(target); assigned.delete(source);
      if (truncated) return;
    }
  };
  visit(0);
  return { heavyAtoms, mappings, truncated };
}

function symmetryAwareRmsd(reference, candidate, symmetry) {
  let minimum = Infinity;
  const remapped = new Float64Array(candidate.length);
  for (const mapping of symmetry.mappings) {
    for (let index = 0; index < symmetry.heavyAtoms.length; index++) {
      const source = symmetry.heavyAtoms[index], target = mapping[index];
      remapped[source * 3] = candidate[target * 3];
      remapped[source * 3 + 1] = candidate[target * 3 + 1];
      remapped[source * 3 + 2] = candidate[target * 3 + 2];
    }
    minimum = Math.min(minimum, fittedRmsd(reference, remapped, symmetry.heavyAtoms));
  }
  return minimum;
}

function symmetryAlignedPositions(reference, candidate, symmetry) {
  let bestFit = null;
  for (const mapping of symmetry.mappings) {
    const fit = fittedRigidTransform(reference, candidate, symmetry.heavyAtoms, mapping);
    if (!bestFit || fit.rmsd < bestFit.rmsd) bestFit = fit;
  }
  return applyRigidFit(candidate, bestFit || fittedRigidTransform(
    reference, candidate, symmetry.heavyAtoms,
  ));
}

function conformerDisplayAlignment(result, analysis) {
  if (!result?.molecule || !analysis || !Number.isInteger(analysis.bestIndex)) return null;
  return {
    referenceReplica:analysis.bestIndex,
    referencePositions:ensembleFinalPositions(result, analysis.bestIndex),
    symmetry:heavyAtomAutomorphisms(result.molecule),
  };
}

function alignConformerDisplayFrames(frames, alignment) {
  if (!alignment) return frames;
  return frames.map((frame) => ({
    ...frame,
    positions:symmetryAlignedPositions(
      alignment.referencePositions, frame.positions, alignment.symmetry,
    ),
  }));
}

function moleculeCoordinateArray(molecule) {
  if (!molecule?.atoms?.length) return null;
  const positions = Float64Array.from(
    molecule.atoms.flatMap((atom) => [atom.x, atom.y, atom.z]));
  return positions.every(Number.isFinite) ? positions : null;
}

function createTrajectoryDisplayAlignment(frames, molecule, sharedReference = null) {
  if (!frames.length || !molecule?.atoms?.length) return null;
  const heavyAtoms = molecule.atoms.map((atom, index) => atom.element === 'H' ? -1 : index)
    .filter((index) => index >= 0);
  const atomIndices = heavyAtoms.length
    ? heavyAtoms : molecule.atoms.map((_, index) => index);
  const sharedAcrossReplicas = sharedReference instanceof Float64Array
    && sharedReference.length === molecule.atoms.length * 3
    && sharedReference.every(Number.isFinite);
  return {
    referenceFrame:sharedAcrossReplicas ? null : 0,
    referenceGeometry:sharedAcrossReplicas ? 'input coordinates' : 'first trajectory frame',
    sharedAcrossReplicas,
    referencePositions:sharedAcrossReplicas
      ? sharedReference.slice() : frames[0].positions.slice(),
    atomIndices,
  };
}

function alignTrajectoryDisplayFrames(frames, alignment) {
  if (!alignment) return frames;
  return frames.map((frame) => ({
    ...frame,
    positions:applyRigidFit(frame.positions, fittedRigidTransform(
      alignment.referencePositions, frame.positions, alignment.atomIndices,
    )),
  }));
}

function ensembleFinalPositions(result, replica) {
  const atomStride = result.molecule.atoms.length * 3;
  const frameStride = result.replicaCount * atomStride;
  const offset = (result.frameCount - 1) * frameStride + replica * atomStride;
  return Float64Array.from(result.ensembleTrajectory.subarray(offset, offset + atomStride));
}

const CONFORMER_ATOMIC_MASSES = Object.freeze({
  H: 1.008, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998,
  Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Br: 79.904, I: 126.904,
});

function heavyAtomRadiusOfGyration(molecule, positions) {
  const atoms = molecule.atoms.map((atom, index) => ({ atom, index }))
    .filter(({ atom }) => atom.element !== 'H');
  const selected = atoms.length ? atoms : molecule.atoms.map((atom, index) => ({ atom, index }));
  const center = [0, 0, 0];
  let totalMass = 0;
  selected.forEach(({ atom, index }) => {
    const mass = CONFORMER_ATOMIC_MASSES[atom.element] || 12;
    totalMass += mass;
    for (let axis = 0; axis < 3; axis++) center[axis] += mass * positions[index * 3 + axis];
  });
  if (!totalMass) return 0;
  center.forEach((_, axis) => { center[axis] /= totalMass; });
  let moment = 0;
  selected.forEach(({ atom, index }) => {
    const mass = CONFORMER_ATOMIC_MASSES[atom.element] || 12;
    const dx = positions[index * 3] - center[0];
    const dy = positions[index * 3 + 1] - center[1];
    const dz = positions[index * 3 + 2] - center[2];
    moment += mass * (dx * dx + dy * dy + dz * dz);
  });
  return Math.sqrt(moment / totalMass);
}

function conformerRotatableTorsions(molecule) {
  const ringEdges = new Set();
  findRingCycles(molecule).forEach((cycle) => cycle.forEach((atom, index) =>
    ringEdges.add(pairKey(atom, cycle[(index + 1) % cycle.length]))));
  const adjacency = Array.from({ length: molecule.atoms.length }, () => []);
  molecule.bonds.forEach((bond) => {
    adjacency[bond.a].push(bond.b);
    adjacency[bond.b].push(bond.a);
  });
  const heavyNeighbors = (atom, excluded) => adjacency[atom]
    .filter((neighbor) => neighbor !== excluded && molecule.atoms[neighbor].element !== 'H')
    .sort((a, b) => a - b);
  return molecule.bonds.flatMap((bond) => {
    if (Math.abs(Number(bond.order || 1) - 1) > 0.1
      || molecule.atoms[bond.a].element === 'H' || molecule.atoms[bond.b].element === 'H'
      || ringEdges.has(pairKey(bond.a, bond.b))) return [];
    const left = heavyNeighbors(bond.a, bond.b), right = heavyNeighbors(bond.b, bond.a);
    return left.length && right.length ? [[left[0], bond.a, bond.b, right[0]]] : [];
  });
}

function conformerDihedral(positions, [a, b, c, d]) {
  const vector = (from, to) => [0, 1, 2].map((axis) => positions[to * 3 + axis] - positions[from * 3 + axis]);
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const scale = (u, value) => u.map((component) => component * value);
  const b0 = vector(b, a), b1 = vector(b, c), b2 = vector(c, d);
  const length = Math.hypot(...b1);
  if (length < 1e-10) return 0;
  const axis = scale(b1, 1 / length);
  const v = b0.map((component, index) => component - dot(b0, axis) * axis[index]);
  const w = b2.map((component, index) => component - dot(b2, axis) * axis[index]);
  return Math.atan2(dot(cross(axis, v), w), dot(v, w));
}

function conformerTorsionDistance(reference, candidate, torsions) {
  if (!torsions.length) return 0;
  const meanSquare = torsions.reduce((sum, torsion) => {
    const delta = conformerDihedral(candidate, torsion) - conformerDihedral(reference, torsion);
    const wrapped = Math.atan2(Math.sin(delta), Math.cos(delta));
    return sum + wrapped * wrapped;
  }, 0) / torsions.length;
  return Math.sqrt(meanSquare) * 180 / Math.PI;
}

function analyzeConformerSearch(result, clusterCutoff = 0.5) {
  const count = Number(result.replicaCount);
  const lastFrame = Number(result.frameCount) - 1;
  const energies = Float64Array.from({ length: count }, (_, replica) =>
    result.ensembleEnergies[lastFrame * count + replica]);
  const order = Array.from({ length: count }, (_, index) => index)
    .filter((index) => Number.isFinite(energies[index]))
    .sort((a, b) => energies[a] - energies[b] || a - b);
  if (!order.length) throw new Error('Conformer search returned no finite final energies');
  const finalPositions = Array.from({ length: count }, (_, index) => ensembleFinalPositions(result, index));
  const symmetry = heavyAtomAutomorphisms(result.molecule);
  const bestIndex = order[0], bestEnergy = energies[bestIndex];
  const energyOffsets = Float64Array.from(energies, (energy) => energy - bestEnergy);
  const rmsdsToBest = Float64Array.from(finalPositions, (positions) =>
    symmetryAwareRmsd(finalPositions[bestIndex], positions, symmetry));
  const rotatableTorsions = conformerRotatableTorsions(result.molecule);
  const torsionDistances = Float64Array.from(finalPositions, (positions) =>
    conformerTorsionDistance(finalPositions[bestIndex], positions, rotatableTorsions));
  const radiiOfGyration = Float64Array.from(finalPositions, (positions) =>
    heavyAtomRadiusOfGyration(result.molecule, positions));
  const clusterIds = new Int32Array(count).fill(-1);
  const representativeIndices = [];
  const pairCache = new Map();
  const pairRmsd = (a, b) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!pairCache.has(key)) pairCache.set(key,
      symmetryAwareRmsd(finalPositions[a], finalPositions[b], symmetry));
    return pairCache.get(key);
  };
  order.forEach((candidate) => {
    let cluster = representativeIndices.findIndex((representative) =>
      pairRmsd(candidate, representative) < clusterCutoff);
    if (cluster < 0) { cluster = representativeIndices.length; representativeIndices.push(candidate); }
    clusterIds[candidate] = cluster;
  });
  const analysis = {
    count, energies, energyOffsets, rmsdsToBest, torsionDistances, radiiOfGyration, clusterIds,
    clusterCount: representativeIndices.length, representativeIndices,
    bestIndex, order, clusterCutoff, symmetryCount: symmetry.mappings.length,
    symmetryTruncated: symmetry.truncated, torsionCount: rotatableTorsions.length,
  };
  result.conformerAnalysis = analysis;
  result.positions = finalPositions[bestIndex];
  result.finalEnergy = bestEnergy;
  result.initialEnergy = result.ensembleEnergies[bestIndex];
  return analysis;
}

function ensembleReplicaRmsds(ensemble) {
  if (ensemble.replicaRmsds instanceof Float64Array) return ensemble.replicaRmsds;
  const atomCount = Number(ensemble.molecule?.atoms?.length || 0);
  const replicaCount = Number(ensemble.replicaCount || 0);
  const frameCount = Number(ensemble.frameCount || 0);
  const atomStride = atomCount * 3;
  const frameStride = replicaCount * atomStride;
  const heavyAtoms = ensemble.molecule?.atoms
    ?.map((atom, index) => atom.element === 'H' ? -1 : index).filter((index) => index >= 0) || [];
  const atomIndices = heavyAtoms.length ? heavyAtoms : Array.from({ length: atomCount }, (_, index) => index);
  const rmsds = new Float64Array(replicaCount);
  for (let replica = 0; replica < replicaCount; replica++) {
    const initialOffset = replica * atomStride;
    const finalOffset = (frameCount - 1) * frameStride + replica * atomStride;
    const initial = ensemble.ensembleTrajectory.subarray(initialOffset, initialOffset + atomStride);
    const final = ensemble.ensembleTrajectory.subarray(finalOffset, finalOffset + atomStride);
    rmsds[replica] = fittedRmsd(initial, final, atomIndices);
  }
  ensemble.replicaRmsds = rmsds;
  return rmsds;
}

function replicaRmsdColor(value, low, high) {
  if (!Number.isFinite(value)) return '#ef4444';
  const t = high - low < 1e-12 ? 0.5 : Math.max(0, Math.min(1, (value - low) / (high - low)));
  const first = [49, 85, 207], second = [233, 86, 76];
  const channels = first.map((channel, index) => Math.round(channel + (second[index] - channel) * t));
  return `rgb(${channels.join(',')})`;
}

function drawReplicaMosaic() {
  const canvas = document.querySelector('#result-replica-mosaic');
  const ensemble = state.calculationEnsemble;
  if (!canvas || !ensemble || document.querySelector('#result-ensemble').classList.contains('hidden')) return;
  const count = Number(ensemble.replicaCount);
  const width = Math.max(180, canvas.clientWidth || 236);
  const targetHeight = 82;
  const columns = Math.min(count, Math.max(1, Math.ceil(Math.sqrt(count * width / targetHeight))));
  const rows = Math.ceil(count / columns);
  const gap = count > 256 ? 0.8 : 1.2;
  const cell = Math.min(12, (width - gap * (columns - 1)) / columns);
  const height = Math.max(12, rows * cell + (rows - 1) * gap);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.height = `${height}px`;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const finalRmsds = ensembleReplicaRmsds(ensemble);
  const finite = [...finalRmsds].filter(Number.isFinite);
  const low = finite.length ? Math.min(...finite) : 0;
  const high = finite.length ? Math.max(...finite) : 1;
  setText('#replica-rmsd-low', `${low.toFixed(3)} Å`);
  setText('#replica-rmsd-high', `${high.toFixed(3)} Å`);
  for (let replica = 0; replica < count; replica++) {
    const column = replica % columns;
    const row = Math.floor(replica / columns);
    const x = column * (cell + gap), y = row * (cell + gap);
    context.fillStyle = replicaRmsdColor(finalRmsds[replica], low, high);
    context.fillRect(x, y, cell, cell);
    if (replica === state.calculationReplicaIndex) {
      context.strokeStyle = '#0f172a';
      context.lineWidth = Math.min(2, Math.max(1, cell * 0.24));
      context.strokeRect(x + 0.5, y + 0.5, Math.max(0, cell - 1), Math.max(0, cell - 1));
    }
  }
  state.replicaMosaicLayout = { columns, rows, cell, gap, width, height };
}

function conformerEnergyColor(value, high) {
  const t = high < 1e-12 ? 0 : Math.max(0, Math.min(1, value / high));
  const stops = t <= 0.5
    ? [[49, 85, 207], [45, 157, 114], t * 2]
    : [[45, 157, 114], [233, 86, 76], (t - 0.5) * 2];
  const channels = stops[0].map((channel, index) =>
    Math.round(channel + (stops[1][index] - channel) * stops[2]));
  return `rgb(${channels.join(',')})`;
}

function conformerRankValues(values) {
  const ranks = new Float64Array(values.length).fill(Number.NaN);
  const order = Array.from({ length:values.length }, (_, index) => index)
    .filter((index) => Number.isFinite(values[index]))
    .sort((a, b) => values[a] - values[b] || a - b);
  for (let start = 0; start < order.length;) {
    let end = start + 1;
    while (end < order.length && values[order[end]] === values[order[start]]) end += 1;
    const midrank = ((start + 1) + end) / 2;
    for (let cursor = start; cursor < end; cursor += 1) ranks[order[cursor]] = midrank;
    start = end;
  }
  return ranks;
}

function conformerMetricDefinitions(analysis) {
  const definitions = [{
    key: 'rmsd', values: analysis.rmsdsToBest,
    label: 'Symmetry-aware RMSD to Sage/OBC2 minimum (Å)', shortLabel: 'symmetry-aware RMSD',
    unit: 'Å', startsAtZero: true, provenance: 'Coordinates; graph-automorphism-aware fit',
  }, {
    key: 'torsion', values: analysis.torsionDistances,
    label: `Rotatable-torsion distance (° RMS; ${analysis.torsionCount} torsion${analysis.torsionCount === 1 ? '' : 's'})`,
    shortLabel: 'torsion distance', unit: '°', startsAtZero: true,
    provenance: 'Coordinates; rotatable torsions relative to the Sage/OBC2 minimum',
    disabled: analysis.torsionCount < 1,
  }, {
    key: 'gyration', values: analysis.radiiOfGyration,
    label: 'Heavy-atom radius of gyration (Å)', shortLabel: 'heavy-atom Rg', unit: 'Å',
    startsAtZero: false, provenance: 'Coordinates; heavy atoms',
  }, {
    key: 'sage-delta', values: analysis.energyOffsets,
    label: 'Common Sage/OBC2 judged ΔE (kcal/mol)', shortLabel: 'common Sage/OBC2 ΔE', unit: 'kcal/mol',
    startsAtZero: true, provenance: analysis.arena?.judge || 'Sage search energy',
  }, {
    key: 'sage-rank', values: conformerRankValues(analysis.energies),
    label: 'Common Sage/OBC2 rank (1 = lowest)', shortLabel: 'common Sage/OBC2 rank', unit: 'rank',
    startsAtZero: false,
    provenance: 'Rank among all final Arena candidates by the common Sage/OBC2 judge; rank 1 is lowest',
  }];
  Object.values(analysis.nativeScoreSeries || {}).forEach((series) => {
    definitions.push({
      key: `${series.key}-delta`, values: series.offsets,
      label: `${series.label} native ΔE (kcal/mol)`, shortLabel: `${series.shortLabel} native ΔE`,
      unit: 'kcal/mol', startsAtZero: true, provenance: series.provenance,
    }, {
      key: `${series.key}-energy`, values: series.energies,
      label: `${series.label} native energy (kcal/mol)`, shortLabel: `${series.shortLabel} native energy`,
      unit: 'kcal/mol', startsAtZero: false, provenance: series.provenance,
    }, {
      key: `${series.key}-rank`, values: conformerRankValues(series.energies),
      label: `${series.label} rank (1 = lowest)`, shortLabel: `${series.shortLabel} rank`,
      unit: 'rank', startsAtZero: false,
      provenance: `Rank among all final Arena candidates by ${series.label}; rank 1 is lowest. ${series.provenance}`,
    });
  });
  return definitions;
}

function conformerMetricDefinition(analysis, selector, fallback) {
  const definitions = conformerMetricDefinitions(analysis);
  const selected = document.querySelector(selector)?.value || fallback;
  return definitions.find((definition) => definition.key === selected && !definition.disabled)
    || definitions.find((definition) => definition.key === fallback)
    || definitions[0];
}

function conformerCvDefinition(analysis) {
  return conformerMetricDefinition(analysis, '#result-conformer-cv', 'rmsd');
}

function conformerYAxisDefinition(analysis) {
  return conformerMetricDefinition(analysis, '#result-conformer-y', 'sage-delta');
}

function conformerSortDefinition(analysis) {
  const selected = document.querySelector('#result-conformer-sort')?.value || 'sage';
  if (selected === 'x') return conformerCvDefinition(analysis);
  if (selected === 'y') return conformerYAxisDefinition(analysis);
  return conformerMetricDefinitions(analysis).find((definition) => definition.key === 'sage-delta');
}

function conformerPlotOrder(analysis) {
  const xMetric = conformerCvDefinition(analysis);
  const yMetric = conformerYAxisDefinition(analysis);
  const sortMetric = conformerSortDefinition(analysis);
  return Array.from({ length: analysis.count }, (_, index) => index)
    .filter((index) => Number.isFinite(xMetric.values[index])
      && Number.isFinite(yMetric.values[index]) && Number.isFinite(sortMetric.values[index]))
    .sort((a, b) => sortMetric.values[a] - sortMetric.values[b]
      || analysis.energyOffsets[a] - analysis.energyOffsets[b] || a - b);
}

function activeConformerPlotOrder(analysis) {
  const order = conformerPlotOrder(analysis);
  const filter = document.querySelector('#result-conformer-filter')?.value || 'rank25';
  if (!filter.startsWith('generator:')) return order;
  const generator = filter.slice('generator:'.length);
  return order.filter((replica) => analysis.methodIds?.[replica] === generator);
}

function visibleConformerIndices(analysis) {
  const filter = document.querySelector('#result-conformer-filter')?.value || 'rank25';
  const generator = filter.startsWith('generator:') ? filter.slice('generator:'.length) : null;
  const order = activeConformerPlotOrder(analysis);
  let base;
  if (generator || filter === 'all') base = order.slice();
  else if (filter === 'rank50') base = order.slice(0, 50);
  else if (filter === 'energy1') base = order.filter((replica) => analysis.energyOffsets[replica] <= 1);
  else if (filter === 'energy3') base = order.filter((replica) => analysis.energyOffsets[replica] <= 3);
  else base = order.slice(0, 25);
  const selectedExtra = order.includes(state.calculationReplicaIndex)
    && !base.includes(state.calculationReplicaIndex);
  const indices = selectedExtra ? [...base, state.calculationReplicaIndex] : base;
  return { indices, baseCount: base.length, selectedExtra, eligibleCount: order.length, order };
}

function appendConformerAxisLabel(group, x, y, text, anchor = 'middle') {
  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  label.setAttribute('x', String(x)); label.setAttribute('y', String(y));
  label.setAttribute('text-anchor', anchor); label.textContent = text;
  group.append(label);
}

function conformerMetricBounds(metric, indices) {
  const finite = indices.map((index) => metric.values[index]).filter(Number.isFinite);
  let minimum = finite.length ? Math.min(...finite) : 0;
  let maximum = finite.length ? Math.max(...finite) : 1;
  if (metric.startsAtZero && minimum >= -1e-9) minimum = 0;
  const minimumSpan = metric.unit === '°' ? 1 : metric.unit === 'kcal/mol' ? 0.05 : 0.02;
  if (maximum - minimum < minimumSpan) {
    if (metric.startsAtZero) maximum = minimum + minimumSpan;
    else { minimum -= minimumSpan / 2; maximum += minimumSpan / 2; }
  }
  return { minimum, maximum, span:maximum - minimum };
}

function formatConformerMetricValue(value, metric, axis = false) {
  if (!Number.isFinite(value)) return '—';
  if (metric.unit === 'rank') {
    const number = Number.isInteger(value) ? String(value) : value.toFixed(1);
    return `${number}${axis ? '' : ' rank'}`;
  }
  const absolute = Math.abs(value);
  const number = absolute >= 10000 || (absolute > 0 && absolute < 0.001)
    ? value.toExponential(axis ? 1 : 3)
    : value.toFixed(metric.unit === '°' ? (axis ? 0 : 1) : axis ? 2 : 3);
  return `${number}${axis ? '' : ` ${metric.unit}`}`;
}

function rebuildConformerJumpOptions(analysis, order = conformerPlotOrder(analysis)) {
  const select = document.querySelector('#result-conformer-select');
  const sortMetric = conformerSortDefinition(analysis);
  select.replaceChildren(...order.map((replica, rank) => {
    const option = document.createElement('option');
    option.value = String(replica);
    const arenaMethod = analysis.arena?.methods.find((method) =>
      method.id === analysis.methodIds?.[replica]);
    option.textContent = `#${rank + 1} · ${arenaMethod ? `${arenaMethod.shortLabel} · ` : ''}candidate ${replica + 1} · ${formatConformerMetricValue(sortMetric.values[replica], sortMetric)}`;
    return option;
  }));
  select.value = String(state.calculationReplicaIndex);
}

function renderConformerShortlist(analysis) {
  const body = document.querySelector('#result-conformer-shortlist');
  if (!body) return;
  const aniRanks = analysis.nativeScoreSeries?.ani2x
    ? conformerRankValues(analysis.nativeScoreSeries.ani2x.energies) : null;
  body.replaceChildren(...analysis.order.slice(0, 5).map((replica, rank) => {
    const method = analysis.arena?.methods.find((entry) =>
      entry.id === analysis.methodIds?.[replica]);
    const row = document.createElement('tr');
    row.tabIndex = 0;
    row.dataset.replicaIndex = String(replica);
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Show ranked conformer ${rank + 1}`);
    const values = [
      String(rank + 1),
      method?.shortLabel || `Candidate ${replica + 1}`,
      analysis.energyOffsets[replica].toFixed(2),
      Number.isFinite(aniRanks?.[replica]) ? String(Math.round(aniRanks[replica])) : '—',
    ];
    values.forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    const activate = () => {
      const rank = activeConformerPlotOrder(analysis).indexOf(replica);
      runChemistUiAction('calculation.selectConformer', { rank }).catch(() => {});
    };
    row.addEventListener('click', activate);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); activate();
      }
    });
    return row;
  }));
}

function drawConformerScatter() {
  const analysis = state.conformerAnalysis;
  const group = document.querySelector('#result-conformer-points');
  if (!analysis || !group) return;
  group.replaceChildren();
  const { indices, baseCount, selectedExtra, eligibleCount, order } = visibleConformerIndices(analysis);
  const xMetric = conformerCvDefinition(analysis);
  const yMetric = conformerYAxisDefinition(analysis);
  const xBounds = conformerMetricBounds(xMetric, indices);
  const yBounds = conformerMetricBounds(yMetric, indices);
  const representatives = new Set(analysis.representativeIndices);
  const arenaMethods = analysis.arena?.methods || null;
  const legendLabel = document.querySelector('#result-conformer-legend-label');
  const legendScale = document.querySelector('#result-conformer-legend-scale');
  if (arenaMethods) {
    const visibleMethodIds = [...new Set(indices.map((replica) => analysis.methodIds?.[replica]))];
    const visibleMethods = visibleMethodIds.map((methodId) =>
      arenaMethods.find((method) => method.id === methodId)).filter(Boolean);
    setText('#result-conformer-legend-label', visibleMethods.length === 1
      ? visibleMethods[0].shortLabel : 'Generator');
    legendScale.className = 'conformer-method-legend';
    legendScale.replaceChildren(...visibleMethods.map((method) => {
      const item = document.createElement('span');
      const dot = document.createElement('b');
      dot.style.setProperty('--method-color', method.color);
      item.append(dot, method.shortLabel);
      return item;
    }));
  } else {
    legendLabel.textContent = 'Color: Sage ΔE';
    legendScale.className = '';
    const low = document.createElement('small'); low.textContent = 'low';
    const gradient = document.createElement('i');
    const high = document.createElement('small'); high.textContent = 'high';
    legendScale.replaceChildren(low, gradient, high);
  }
  setText('#result-conformer-visible', selectedExtra
    ? `${baseCount} plotted + selected`
    : `${indices.length} plotted`);
  const excluded = analysis.count - eligibleCount;
  const missingNote = excluded ? ` ${excluded} candidate${excluded === 1 ? '' : 's'} without both selected values ${excluded === 1 ? 'is' : 'are'} hidden.` : '';
  const mmffNote = analysis.arena && !analysis.nativeScoreSeries?.['etkdg-mmff']
    ? ' MMFF seed energies were not retained, so no MMFF native axis is offered.' : '';
  const aniUnavailableNote = analysis.arena?.ani2xIncluded
      && !analysis.arena?.ani2xRescoreAvailable
    ? ` ANI-2x common rescore unavailable: ${analysis.arena.ani2xRescoreUnavailableReason}.` : '';
  setText('#result-conformer-axis-note', `X: ${xMetric.provenance}. Y: ${yMetric.provenance}.${missingNote}${mmffNote}${aniUnavailableNote}`);
  setText('#result-conformer-x-label', xMetric.label);
  setText('#result-conformer-y-label', yMetric.label);
  const scatter = document.querySelector('#result-conformer-scatter');
  scatter.dataset.xMetric = xMetric.key;
  scatter.dataset.yMetric = yMetric.key;
  scatter.dataset.excludedCount = String(excluded);
  const axisLabels = document.querySelector('#result-conformer-axis-labels');
  axisLabels.replaceChildren();
  appendConformerAxisLabel(axisLabels, 34, 124,
    formatConformerMetricValue(xBounds.minimum, xMetric, true), 'start');
  appendConformerAxisLabel(axisLabels, 141, 124,
    formatConformerMetricValue((xBounds.minimum + xBounds.maximum) / 2, xMetric, true));
  appendConformerAxisLabel(axisLabels, 248, 124,
    formatConformerMetricValue(xBounds.maximum, xMetric, true), 'end');
  appendConformerAxisLabel(axisLabels, 30, 115,
    formatConformerMetricValue(yBounds.minimum, yMetric, true), 'end');
  appendConformerAxisLabel(axisLabels, 30, 66,
    formatConformerMetricValue((yBounds.minimum + yBounds.maximum) / 2, yMetric, true), 'end');
  appendConformerAxisLabel(axisLabels, 30, 15,
    formatConformerMetricValue(yBounds.maximum, yMetric, true), 'end');
  rebuildConformerJumpOptions(analysis, order);
  indices.slice().reverse().forEach((replica) => {
    const x = 34 + Math.max(0, Math.min(1,
      (xMetric.values[replica] - xBounds.minimum) / xBounds.span)) * 214;
    const y = 114 - Math.max(0, Math.min(1,
      (yMetric.values[replica] - yBounds.minimum) / yBounds.span)) * 102;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x.toFixed(2)); circle.setAttribute('cy', y.toFixed(2));
    circle.setAttribute('r', representatives.has(replica) ? '4.6' : '3.7');
    const arenaMethod = arenaMethods?.find((method) => method.id === analysis.methodIds?.[replica]);
    circle.setAttribute('fill', arenaMethod?.color
      || conformerEnergyColor(analysis.energyOffsets[replica],
        Math.max(0.5, ...indices.map((index) => analysis.energyOffsets[index]))));
    circle.dataset.replicaIndex = String(replica);
    circle.dataset.generator = analysis.methodIds?.[replica] || 'single-search';
    circle.dataset.xValue = String(xMetric.values[replica]);
    circle.dataset.yValue = String(yMetric.values[replica]);
    circle.classList.toggle('representative', representatives.has(replica));
    circle.classList.toggle('active', replica === state.calculationReplicaIndex);
    circle.setAttribute('tabindex', '0'); circle.setAttribute('role', 'button');
    circle.setAttribute('aria-label', `Show conformer ${replica + 1}`);
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${arenaMethod ? `${arenaMethod.label} candidate · ` : ''}conformer ${replica + 1} · ${xMetric.shortLabel} ${formatConformerMetricValue(xMetric.values[replica], xMetric)} · ${yMetric.shortLabel} ${formatConformerMetricValue(yMetric.values[replica], yMetric)} · common Sage rank ${analysis.order.indexOf(replica) + 1} · cluster ${analysis.clusterIds[replica] + 1}`;
    circle.append(title);
    const activate = () => {
      const rank = activeConformerPlotOrder(analysis).indexOf(replica);
      runChemistUiAction('calculation.selectConformer', { rank }).catch(() => {});
    };
    circle.addEventListener('click', activate);
    circle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); }
    });
    group.append(circle);
  });
}

function configureResultConformers(result) {
  const analysis = result.conformerAnalysis;
  document.querySelector('#result-ensemble').classList.add('hidden');
  document.querySelector('#result-conformers').classList.remove('hidden');
  const filterSelect = document.querySelector('#result-conformer-filter');
  filterSelect.querySelectorAll('option[data-generator-filter]').forEach((option) => option.remove());
  (analysis.arena?.methods || []).forEach((method) => {
    if (!analysis.methodIds?.includes(method.id)) return;
    const option = document.createElement('option');
    option.value = `generator:${method.id}`;
    option.textContent = `Only ${method.shortLabel} candidates`;
    option.dataset.generatorFilter = method.id;
    filterSelect.append(option);
  });
  filterSelect.value = analysis.count > 25 ? 'rank25' : 'all';
  document.querySelector('#result-conformer-sort').value = 'sage';
  const definitions = conformerMetricDefinitions(analysis);
  const createOption = (definition) => {
    const option = document.createElement('option');
    option.value = definition.key;
    option.textContent = definition.disabled ? `${definition.label} (unavailable)` : definition.label;
    option.disabled = Boolean(definition.disabled);
    option.dataset.provenance = definition.provenance;
    return option;
  };
  const xSelect = document.querySelector('#result-conformer-cv');
  const ySelect = document.querySelector('#result-conformer-y');
  xSelect.replaceChildren(...definitions.map(createOption));
  ySelect.replaceChildren(...definitions.map(createOption));
  const compareRanks = Boolean(analysis.arena && analysis.nativeScoreSeries?.ani2x);
  xSelect.value = compareRanks ? 'sage-rank' : 'rmsd';
  ySelect.value = compareRanks ? 'ani2x-rank' : 'sage-delta';
  document.querySelector('#result-conformer-map-details').open = !analysis.arena;
  document.querySelector('.conformer-selection-details').open = false;
  renderConformerShortlist(analysis);
  setText('#export-conformer-sdf', 'Export SDF');
  updateEnsembleHeading();
}

function configureResultArena(arena) {
  const panel = document.querySelector('#result-arena');
  if (!arena) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  const judge = document.querySelector('#result-arena-judge');
  judge.textContent = 'Sage/OBC2 judge';
  judge.title = arena.judge;
  document.querySelector('#result-arena-details').open = false;
  const grid = document.querySelector('#result-arena-methods');
  grid.replaceChildren(...arena.methods.map((method) => {
    const card = document.createElement('div');
    card.className = 'arena-method';
    card.style.setProperty('--arena-color', method.color);
    const heading = document.createElement('strong'); heading.textContent = method.shortLabel;
    const regret = document.createElement('span');
    regret.textContent = `${method.regret < 0.005 ? 'best' : `+${method.regret.toFixed(2)}`} · ${(method.lowEnergyRecall * 100).toFixed(0)}% recall`;
    card.append(heading, regret);
    return card;
  }));
  const aniRescoreNote = arena.ani2xIncluded && !arena.ani2xRescoreAvailable
    ? ` ANI score axes unavailable: ${arena.ani2xRescoreUnavailableReason}.` : '';
  setText('#result-arena-summary', `${arena.lowEnergyClusterCount} cluster${arena.lowEnergyClusterCount === 1 ? '' : 's'} lie within ${arena.lowEnergyWindowKcalMol} kcal/mol of the best common Sage/OBC2 score. Low-E recall asks whether each generator found those clusters.${aniRescoreNote}`);
  const parity = arena.stormmRescoreConsistency;
  const parityNode = document.querySelector('#result-arena-parity');
  parityNode.classList.toggle('failed', !parity?.passed);
  setText('#result-arena-parity', parity
    ? `WebGPU rescore consistent · ${parity.sampleCount} identical-coordinate energies · max |ΔE| ${parity.maximumAbsoluteKcalMol.toExponential(2)} · RMS ${parity.rmsKcalMol.toExponential(2)} kcal/mol.`
    : 'WebGPU rescore consistency was not reported.');
}

function configureResultEnsemble(result) {
  const panel = document.querySelector('#result-ensemble');
  const select = document.querySelector('#result-replica-select');
  panel.classList.remove('hidden');
  document.querySelector('#result-conformers').classList.add('hidden');
  document.querySelector('#result-arena').classList.add('hidden');
  select.replaceChildren(...Array.from({ length: result.replicaCount }, (_, replica) => {
    const option = document.createElement('option');
    option.value = String(replica);
    option.textContent = `Replica ${replica + 1}`;
    return option;
  }));
  updateEnsembleHeading();
  requestAnimationFrame(drawReplicaMosaic);
}

function setCalculationFrames(result) {
  stopCalculationPlayback();
  state.calculationRawFrames = [];
  state.calculationEnsemble = null;
  state.conformerAnalysis = null;
  state.conformerDisplayAlignment = null;
  state.trajectoryDisplayAlignment = null;
  state.calculationReplicaIndex = 0;
  let frames = [];
  if (Number(result.replicaCount) > 1 || result.job === 'conformers') {
    state.conformerAnalysis = result.conformerAnalysis || null;
    state.calculationReplicaIndex = state.conformerAnalysis?.bestIndex || 0;
    frames = unpackEnsembleReplica(result, state.calculationReplicaIndex);
    if (!frames.length) throw new Error('The STORMM worker returned an invalid ensemble trajectory');
    state.calculationEnsemble = result;
    if (state.conformerAnalysis) {
      state.conformerDisplayAlignment = conformerDisplayAlignment(result, state.conformerAnalysis);
      frames = alignConformerDisplayFrames(frames, state.conformerDisplayAlignment);
      configureResultConformers(result);
      configureResultArena(result.arena);
      if (result.arena) frames = frames.slice(-1);
    }
    else {
      if (result.job === 'dynamics') {
        state.calculationRawFrames = frames;
        state.trajectoryDisplayAlignment = createTrajectoryDisplayAlignment(
          frames, result.molecule, moleculeCoordinateArray(result.molecule));
        frames = alignTrajectoryDisplayFrames(frames, state.trajectoryDisplayAlignment);
      }
      configureResultEnsemble(result);
    }
  } else {
    document.querySelector('#result-ensemble').classList.add('hidden');
    document.querySelector('#result-conformers').classList.add('hidden');
    document.querySelector('#result-arena').classList.add('hidden');
    frames = unpackCalculationFrames(result);
    if (result.job === 'dynamics') {
      state.calculationRawFrames = frames;
      state.trajectoryDisplayAlignment = createTrajectoryDisplayAlignment(frames, state.molecule);
      frames = alignTrajectoryDisplayFrames(frames, state.trajectoryDisplayAlignment);
    }
  }
  if (!frames.length && result.positions instanceof Float64Array) frames = [{
    step: 0, energy: result.finalEnergy, positions: result.positions.slice(),
  }];
  if (result.job === 'dynamics' && !state.calculationRawFrames.length)
    state.calculationRawFrames = frames;
  state.calculationFrames = frames;
  state.calculationProjectionRadius = trajectoryProjectionRadius(frames, state.molecule?.atoms?.length || 0);
  state.calculationUnit = result.unit;
  state.calculationJob = result.job;
  state.calculationTimestepFs = Number.isFinite(result.timestepFs) ? result.timestepFs : null;
  state.calculationConstraintMode = result.constraintMode || 'none';
  state.calculationFrameIndex = Math.max(0, frames.length - 1);
  updateEnergyChart(frames.length ? frames : [{ step: 0, energy: result.finalEnergy, positions: new Float64Array() }]);
  document.querySelector('#result-energy-chart').classList.toggle('hidden', Boolean(result.arena));
  const controls = document.querySelector('#result-frames');
  controls.classList.toggle('hidden', Boolean(result.arena) || frames.length < 2);
  const slider = document.querySelector('#result-frame-slider');
  slider.max = String(Math.max(0, frames.length - 1));
  slider.value = String(state.calculationFrameIndex);
  const heading = state.conformerAnalysis ? `Conformer ${state.calculationReplicaIndex + 1} · ${frames.length} search stages`
    : state.calculationEnsemble ? `Aligned trajectory 1 · ${frames.length} snapshots`
    : result.job === 'dynamics' ? `Aligned MD trajectory · ${frames.length} snapshots`
    : result.job === 'geometry' ? `Minimization path · ${frames.length} snapshots`
      : 'Single-point geometry';
  setText('#result-frame-heading', heading);
  slider.setAttribute('aria-label', result.job === 'dynamics' ? 'MD trajectory frame' : 'Calculation frame');
  setText('#result-final-frame', result.job === 'dynamics' ? 'Show final MD frame'
    : result.job === 'geometry' ? 'Show optimized geometry' : 'Show final');
  updateCalculationFrameUI();
  draw();
}

function clearCalculationResult() {
  stopCalculationPlayback();
  state.calculationFrames = [];
  state.calculationRawFrames = [];
  state.calculationProjectionRadius = null;
  state.calculationEnsemble = null;
  state.conformerAnalysis = null;
  state.conformerDisplayAlignment = null;
  state.trajectoryDisplayAlignment = null;
  state.calculationReplicaIndex = 0;
  state.replicaMosaicLayout = null;
  state.calculationFrameIndex = 0;
  state.calculationTimestepFs = null;
  state.calculationConstraintMode = 'none';
  document.querySelector('#result-card')?.classList.add('hidden');
  document.querySelector('#result-frames')?.classList.add('hidden');
  document.querySelector('#result-ensemble')?.classList.add('hidden');
  document.querySelector('#result-conformers')?.classList.add('hidden');
  document.querySelector('#result-arena')?.classList.add('hidden');
  document.querySelector('#result-performance')?.classList.add('hidden');
  document.querySelector('#energy-points')?.replaceChildren();
}

function updateCalculationFrameUI() {
  const frames = state.calculationFrames;
  if (!frames.length) return;
  const index = state.calculationFrameIndex;
  const frame = frames[index];
  document.querySelectorAll('#energy-points circle').forEach((circle) =>
    circle.classList.toggle('active', Number(circle.dataset.frameIndex) === index));
  document.querySelector('#result-frame-slider').value = String(index);
  const frameName = state.calculationJob === 'dynamics' ? 'MD frame'
    : state.calculationJob === 'geometry' ? 'Min frame'
      : state.calculationJob === 'conformers' ? 'Stage' : 'Frame';
  const time = state.calculationJob === 'dynamics' && state.calculationTimestepFs
    ? ` · ${(frame.step * state.calculationTimestepFs / 1000).toFixed(3)} ps`
    : '';
  setText('#result-frame-label', `${frameName} ${index + 1}/${frames.length} · step ${frame.step}${time}`);
  const ani2xEnergy = state.lastCalculation?.method === 'ani2x';
  const isolatedLigandEnergy = state.lastCalculation?.method === 'ligand-rdkit';
  setText('#result-energy-label', isolatedLigandEnergy
    ? index === frames.length - 1 ? 'Final isolated-ligand potential energy' : 'Isolated-ligand potential energy'
    : ani2xEnergy
    ? index === frames.length - 1 ? 'Final ANI-2x electronic energy' : 'ANI-2x electronic energy'
    : state.calculationJob === 'energy'
    ? 'Potential energy'
    : state.conformerAnalysis
      ? index === frames.length - 1 ? 'Conformer final potential energy' : 'Conformer stage potential energy'
    : state.calculationEnsemble
      ? index === frames.length - 1 ? 'Replica final potential energy' : 'Replica frame potential energy'
      : index === frames.length - 1 ? 'Final potential energy' : 'Frame potential energy');
  setDisplayedEnergy(frame.energy, state.calculationUnit);
  if (state.calculationEnsemble) {
    updateEnsembleHeading();
    drawReplicaMosaic();
  }
  updateCalculationPlaybackButton();
}

function updateCalculationPlaybackButton() {
  const button = document.querySelector('#result-play-trajectory');
  if (!button) return;
  if (state.calculationPlaying) button.textContent = '❚❚ Pause';
  else if (state.calculationFrameIndex >= state.calculationFrames.length - 1) button.textContent = '↻ Replay trajectory';
  else button.textContent = '▶ Play trajectory';
}

function stopCalculationPlayback() {
  state.calculationPlaying = false;
  state.calculationPlaybackTime = 0;
  if (state.calculationPlaybackRaf) cancelAnimationFrame(state.calculationPlaybackRaf);
  state.calculationPlaybackRaf = 0;
  updateCalculationPlaybackButton();
}

function calculationPlaybackTick(time) {
  if (!state.calculationPlaying) return;
  const interval = Math.max(40, Math.min(250, 5000 / Math.max(1, state.calculationFrames.length - 1)));
  if (!state.calculationPlaybackTime) state.calculationPlaybackTime = time;
  if (time - state.calculationPlaybackTime >= interval) {
    const next = state.calculationFrameIndex + 1;
    if (next >= state.calculationFrames.length) { stopCalculationPlayback(); return; }
    selectCalculationFrame(next, true);
    state.calculationPlaybackTime = time;
    if (next === state.calculationFrames.length - 1) { stopCalculationPlayback(); return; }
  }
  state.calculationPlaybackRaf = requestAnimationFrame(calculationPlaybackTick);
}

function toggleCalculationPlayback() {
  if (state.calculationFrames.length < 2) return;
  if (state.calculationPlaying) { stopCalculationPlayback(); return; }
  if (state.calculationFrameIndex >= state.calculationFrames.length - 1) selectCalculationFrame(0, true);
  state.calculationPlaying = true;
  state.calculationPlaybackTime = 0;
  updateCalculationPlaybackButton();
  state.calculationPlaybackRaf = requestAnimationFrame(calculationPlaybackTick);
}

function selectCalculationFrame(index, fromPlayback = false) {
  if (!fromPlayback) stopCalculationPlayback();
  const frame = state.calculationFrames[index];
  if (!frame || !state.molecule || frame.positions.length !== state.molecule.atoms.length * 3) return;
  state.calculationFrameIndex = index;
  applyCalculationPositions(frame.positions, false);
  updateCalculationFrameUI();
}

function selectCalculationReplica(replica) {
  const ensemble = state.calculationEnsemble;
  const next = Number(replica);
  if (!ensemble || !Number.isInteger(next) || next < 0 || next >= ensemble.replicaCount) return;
  stopCalculationPlayback();
  let frames = unpackEnsembleReplica(ensemble, next);
  state.calculationRawFrames = [];
  if (state.conformerDisplayAlignment) {
    frames = alignConformerDisplayFrames(frames, state.conformerDisplayAlignment);
  } else if (state.calculationJob === 'dynamics') {
    state.calculationRawFrames = frames;
    if (!state.trajectoryDisplayAlignment) {
      state.trajectoryDisplayAlignment = createTrajectoryDisplayAlignment(
        frames, ensemble.molecule, moleculeCoordinateArray(ensemble.molecule));
    }
    frames = alignTrajectoryDisplayFrames(frames, state.trajectoryDisplayAlignment);
  }
  if (!frames.length) return;
  if (state.conformerAnalysis?.arena) frames = frames.slice(-1);
  state.calculationReplicaIndex = next;
  state.calculationFrames = frames;
  state.calculationProjectionRadius = trajectoryProjectionRadius(frames, state.molecule?.atoms?.length || 0);
  state.calculationFrameIndex = Math.min(state.calculationFrameIndex, frames.length - 1);
  updateEnergyChart(frames);
  const slider = document.querySelector('#result-frame-slider');
  slider.max = String(frames.length - 1);
  slider.value = String(state.calculationFrameIndex);
  selectCalculationFrame(state.calculationFrameIndex, true);
  updateEnsembleHeading();
  drawReplicaMosaic();
}

function moveConformerRank(delta) {
  const analysis = state.conformerAnalysis;
  if (!analysis) return;
  const order = activeConformerPlotOrder(analysis);
  if (!order.length) return;
  const currentRank = order.indexOf(state.calculationReplicaIndex);
  const nextRank = Math.max(0, Math.min(order.length - 1,
    (currentRank < 0 ? 0 : currentRank) + delta));
  selectCalculationReplica(order[nextRank]);
}

function selectConformerRank(rank) {
  const analysis = state.conformerAnalysis;
  if (!analysis) return;
  const order = activeConformerPlotOrder(analysis);
  if (!order.length) return;
  const nextRank = Math.max(0, Math.min(order.length - 1, rank));
  selectCalculationReplica(order[nextRank]);
}

function updateConformerPlotControls() {
  const analysis = state.conformerAnalysis;
  if (!analysis) return;
  const order = activeConformerPlotOrder(analysis);
  if (order.length && !order.includes(state.calculationReplicaIndex))
    selectCalculationReplica(order[0]);
  else updateEnsembleHeading();
}

async function runCalculation(overrides = {}) {
  const method = overrides.method || document.querySelector('#method-select').value;
  const job = overrides.job || document.querySelector('#job-select').value;
  const conformerArena = job === 'conformers' && Boolean(
    overrides.options?.conformerArena ?? document.querySelector('#conformer-arena')?.checked);
  const stormmSystem = job === 'conformers' ? 'current'
    : overrides.options?.stormmSystem || document.querySelector('#stormm-system').value;
  if (!state.molecule && (method !== 'stormm' || stormmSystem === 'current')) { showToast('Load a molecule first'); return null; }
  if (state.chemistryTransaction) {
    const message = 'Finish or discard the pending chemistry changes before running a calculation.';
    showNotice(message); throw new Error(message);
  }
  if (state.calculating) { showToast('A calculation is already running'); return null; }
  stopCalculationPlayback();

  const preparedForcefield = state.molecule?.parameterization?.forcefield;
  if (method === 'stormm' && job !== 'dynamics' && job !== 'conformers')
    throw new Error('The WebGPU ensemble supports molecular dynamics and conformer search only.');
  if (method === 'ani2x' && !['geometry', 'energy'].includes(job))
    throw new Error('ANI-2x currently supports geometry optimization and single-point energy only.');
  if (job === 'conformers' && method !== 'stormm')
    throw new Error('Conformer search requires the WebGPU ensemble method.');
  if (!['openmm', 'webgpu', 'stormm', 'rdkit', 'ani2x'].includes(method)) throw new Error('That calculation engine is not installed');
  const engineName = calculationEngineName(method);
  const overlay = document.querySelector('#run-overlay');
  const queue = document.querySelector('#queue-state');
  const button = document.querySelector('#run-calculation');
  state.calculating = true;
  state.lastCalculation = null;
  document.body.dataset.calculationState = 'running';
  button.disabled = true;
  overlay.classList.remove('hidden');
  document.querySelector('#result-card').classList.add('hidden');
  queue.classList.add('running');
  queue.lastChild.textContent = ` ${engineName} calculation in progress`;
  setCalculationProgress({
    phase: method === 'openmm' ? `Checking OpenMM and ${preparedForcefield || 'Sage'} assets…`
      : method === 'webgpu' ? `Checking WebGPU and ${preparedForcefield || 'Sage'} assets…`
        : method === 'stormm' ? 'Checking STORMM WebGPU ensemble assets…'
          : method === 'rdkit' ? 'Checking RDKit assets…'
            : 'Checking ANI-2x ensemble assets…',
    model: 0, calculation: 0,
  });

  try {
    let result;
    if (method === 'openmm') {
      result = await runOpenMMJob(job, state.molecule, setCalculationProgress, overrides.options);
      if (job !== 'energy') applyCalculationPositions(result.positions);
    } else if (method === 'webgpu') {
      result = await runWebGPUJob(job, state.molecule, setCalculationProgress, overrides.options);
      if (job !== 'energy') applyCalculationPositions(result.positions);
    } else if (method === 'stormm') {
      let stormmMolecule = state.molecule;
      let parameterizationMs = 0;
      if (stormmSystem === 'current') {
        const parameterStarted = performance.now();
        if (!stormmMolecule?.parameterization?.system) {
          const parameters = await runWebGPUJob('parameters', stormmMolecule, setCalculationProgress);
          stormmMolecule.parameterization = {
            forcefield: parameters.forcefield,
            chargeModel: parameters.chargeModel,
            sourceSha256: parameters.sourceSha256,
            system: parameters.system,
            labels: parameters.labels,
          };
        }
        parameterizationMs = performance.now() - parameterStarted;
        updateOptimizerControls();
      }
      let conformerSeeds = null;
      if (job === 'conformers') {
        conformerSeeds = await runRDKitJob('conformers', stormmMolecule, setCalculationProgress, {
          ...overrides.options,
          conformerCount: overrides.options?.conformerCount
            ?? Number(document.querySelector('#conformer-count').value),
        });
      }
      const calculationOptions = {
        ...overrides.options,
        stormmSystem,
        initialConformers: conformerSeeds?.conformers,
        conformerMethod: conformerSeeds?.conformerMethod,
        conformerPreparationForcefield: conformerSeeds?.preparationForcefield,
        conformerPruneRms: conformerSeeds?.pruneRmsThreshold,
        ...(job === 'conformers' && !conformerArena ? CONFORMER_SAGE_RUNTIME_OPTIONS : {}),
      };
      result = conformerArena
        ? await runConformerArena(stormmMolecule, conformerSeeds, calculationOptions,
          setCalculationProgress, parameterizationMs)
        : await runStormmJob(job, stormmMolecule, setCalculationProgress, calculationOptions);
      if (job === 'conformers') {
        result.conformerSeedWorkerCount = conformerSeeds.workerCount || 1;
        result.conformerSeedGeneratedCount = conformerSeeds.poolGeneratedCount
          || conformerSeeds.conformerCount;
      }
      if (job === 'conformers' && !conformerArena) {
        result.seedElapsedMs = conformerSeeds.elapsedMs;
        result.elapsedMs += conformerSeeds.elapsedMs;
        analyzeConformerSearch(result,
          Number(overrides.options?.conformerClusterRms
            ?? document.querySelector('#conformer-cluster-rms').value));
      }
      loadMolecule(result.molecule);
      applyCalculationPositions(result.positions);
    } else if (method === 'rdkit') {
      result = await runRDKitJob(job, state.molecule, setCalculationProgress, overrides.options);
      if (job !== 'energy') applyCalculationPositions(result.positions);
    } else if (method === 'ani2x') {
      result = await runAni2xJob(job, state.molecule, setCalculationProgress, overrides.options);
      if (job !== 'energy') applyCalculationPositions(result.positions);
    }
    setCalculationFrames(result);
    state.lastCalculation = {
      job: result.job,
      initialEnergy: result.initialEnergy,
      finalEnergy: result.finalEnergy,
      rdkitVersion: result.rdkitVersion,
      openmmVersion: result.openmmVersion,
      chargeModel: result.chargeModel,
      forcefield: result.forcefield,
      model: result.model,
      modelLevel: result.modelLevel,
      modelSourceSha256: result.modelSourceSha256,
      initialEnsembleStdDev: result.initialEnsembleStdDev,
      finalEnsembleStdDev: result.finalEnsembleStdDev,
      implicitSolvent: result.implicitSolvent || null,
      constraintMode: result.constraintMode || 'none',
      constraintCount: result.constraintCount || 0,
      constraintError: result.constraintError,
      cutoffNm: result.cutoffNm,
      fallback: result.fallback,
      converged: result.converged,
      platform: result.platform,
      backend: result.backend,
      elapsedMs: result.elapsedMs,
      timestepFs: result.timestepFs,
      method,
      frameCount: state.calculationFrames.length,
      replicaCount: result.replicaCount || 1,
      stormmSystem: result.stormmSystem,
      homogeneous: result.homogeneous,
      conformerCount: result.conformerAnalysis?.count || null,
      conformerClusterCount: result.conformerAnalysis?.clusterCount || null,
      conformerArena: result.arena || null,
    };
    setCalculationProgress({ phase: 'Calculation complete', model: 1, calculation: 1 });
    setText('#result-title', result.arena ? 'Conformer Arena'
      : job === 'conformers' ? 'Conformer Landscape'
      : method === 'stormm' ? 'STORMM Ensemble'
      : method === 'ani2x' ? 'ANI-2x MLIP Energy'
      : job === 'geometry' ? 'Optimization Energy' : job === 'dynamics' ? 'Dynamics Energy' : 'Single Point Energy');
    setText('#result-energy-label', job === 'conformers' ? 'Global minimum potential energy'
      : method === 'stormm' ? 'Replica final potential energy'
      : method === 'ani2x' ? job === 'geometry' ? 'Final ANI-2x electronic energy' : 'ANI-2x electronic energy'
      : job === 'geometry' ? 'Final potential energy' : 'Potential energy');
    setDisplayedEnergy(result.finalEnergy, result.unit);
    const performancePanel = document.querySelector('#result-performance');
    if (job === 'dynamics' && result.elapsedMs > 0 && result.timestepFs > 0) {
      const completedSteps = Math.max(0, ...state.calculationFrames.map((frame) => Number(frame.step) || 0));
      const seconds = result.elapsedMs / 1000;
      const stepsPerSecond = completedSteps / seconds;
      const nanosecondsPerDay = stepsPerSecond * result.timestepFs * 86400 / 1e6;
      const replicaCount = Math.max(1, Number(result.replicaCount) || 1);
      const ensemble = replicaCount > 1;
      setText('#result-runtime', `${completedSteps.toLocaleString()} steps${ensemble ? ` × ${replicaCount} replicas` : ''} · ${seconds.toFixed(2)} s`);
      setText('#result-throughput-label', ensemble ? 'Per trajectory' : 'Trajectory rate');
      setText('#result-throughput', `${stepsPerSecond.toFixed(1)} steps/s · ${nanosecondsPerDay.toFixed(2)} ns/day`);
      const aggregatePanel = document.querySelector('#result-aggregate-performance');
      if (ensemble) {
        setText('#result-aggregate-throughput', `${(stepsPerSecond * replicaCount).toFixed(1)} replica-steps/s · ${(nanosecondsPerDay * replicaCount).toFixed(2)} aggregate ns/day`);
        aggregatePanel.classList.remove('hidden');
      } else {
        aggregatePanel.classList.add('hidden');
      }
      performancePanel.classList.remove('hidden');
    } else if (job === 'conformers' && result.elapsedMs > 0 && !result.arena) {
      const seconds = result.elapsedMs / 1000;
      const count = result.conformerAnalysis.count;
      setText('#result-runtime', `${count} conformers · ${result.conformerSearchSteps.toLocaleString()} MD + ${result.conformerMinimizationIterations} min steps · ${seconds.toFixed(2)} s`);
      setText('#result-throughput-label', 'Completed conformers');
      setText('#result-throughput', `${(count / seconds).toFixed(1)} conformers/s`);
      const workPerConformer = result.conformerSearchSteps + result.conformerMinimizationIterations;
      const diversity = result.conformerAnalysis.clusterCount === count
        ? `${count} unique conformers` : `${result.conformerAnalysis.clusterCount} clusters`;
      setText('#result-aggregate-throughput', `${(count * workPerConformer / seconds).toFixed(0)} conformer-steps/s · ${diversity}`);
      document.querySelector('#result-aggregate-performance').classList.remove('hidden');
      performancePanel.classList.remove('hidden');
    } else {
      performancePanel.classList.add('hidden');
    }
    const convergenceNote = job === 'geometry' && !result.converged ? ' · best finite frame' : '';
    const solventNote = result.implicitSolvent ? ` · ${result.implicitSolvent} implicit water` : ' · vacuum';
    const constraintNote = result.constraintCount
      ? ` · ${result.constraintCount} X–H constraints · ${result.timestepFs || 2} fs`
      : result.timestepFs ? ` · flexible · ${result.timestepFs} fs` : '';
    const cutoffNote = result.cutoffNm ? ` · ${result.cutoffNm.toFixed(1)} nm Verlet cutoff` : ' · no cutoff';
    const activeNote = result.fixedAtomCount > 0
      ? ` · ${result.movableAtomCount} movable / ${result.fixedAtomCount} fixed atoms` : '';
    setText('#result-meta', method === 'openmm'
      ? `${result.forcefield} · ${result.chargeModel || 'charges not reported'}${solventNote}${constraintNote}${cutoffNote} · OpenMM ${result.openmmVersion} ${result.platform} · browser WebAssembly · ${(result.elapsedMs / 1000).toFixed(2)} s`
      : method === 'webgpu'
        ? `${result.forcefield} · ${result.chargeModel || 'charges not reported'}${solventNote}${constraintNote}${cutoffNote}${activeNote} · direct browser WebGPU f32 · experimental · ${(result.elapsedMs / 1000).toFixed(2)} s`
        : method === 'stormm'
          ? job === 'conformers'
            ? result.arena
              ? `${result.conformerAnalysis.count} candidates · ${result.conformerAnalysis.clusterCount} clusters · ${(result.elapsedMs / 1000).toFixed(2)} s · browser WebGPU`
              : `${result.conformerMethod} symmetry-pruned seeds · ${result.conformerPreparationForcefield || 'distance-geometry'} polish · ${result.forcefield}${solventNote}${constraintNote} · ${result.conformerAnalysis.symmetryCount} graph automorphisms · ${result.conformerAnalysis.clusterCount} clusters at ${result.conformerAnalysis.clusterCutoff.toFixed(2)} Å · browser WebGPU · ${(result.elapsedMs / 1000).toFixed(2)} s`
            : `${result.replicaCount} independent homogeneous replicas · ${result.forcefield}${solventNote}${constraintNote} · fixed-point accumulation · browser WebGPU · ${(result.elapsedMs / 1000).toFixed(2)} s`
          : method === 'rdkit'
            ? `${result.forcefield}${result.fallback ? ' fallback' : ''} · RDKit ${result.rdkitVersion} · browser WebAssembly${convergenceNote} · ${(result.elapsedMs / 1000).toFixed(2)} s`
          : `${result.model} · ${result.modelLevel} · total electronic energy · analytical AEV forces · ONNX Runtime Web ${result.platform} · ${result.modelEvaluations} evaluations · ensemble σ ${result.finalEnsembleStdDev.toFixed(3)} kcal/mol${convergenceNote} · ${(result.elapsedMs / 1000).toFixed(2)} s`);
    updateCalculationFrameUI();
    document.querySelector('#result-card').classList.remove('hidden');
    if (state.calculationEnsemble) requestAnimationFrame(drawReplicaMosaic);
    queue.lastChild.textContent = ' Calculation complete';
    document.body.dataset.calculationState = 'complete';
    showToast(`${result.arena ? 'Conformer Arena' : job === 'conformers' ? 'Conformer search' : engineName} complete · ${formatEnergy(result.finalEnergy, result.unit)}`);
    return result;
  } catch (error) {
    queue.lastChild.textContent = ' Calculation failed';
    document.body.dataset.calculationState = 'error';
    state.lastCalculation = { error: error.message };
    showNotice(`${engineName}: ${error.message}`);
    throw error;
  } finally {
    state.calculating = false;
    button.disabled = false;
    queue.classList.remove('running');
    overlay.classList.add('hidden');
  }
}

function stormmTuningKey() {
  const system = document.querySelector('#stormm-system').value;
  const molecule = state.molecule;
  const identity = system === 'current'
    ? molecule?.parameterization?.sourceSha256 || molecule?.smiles || molecule?.name || 'unloaded'
    : system;
  return [system, molecule?.atoms?.length || 0, identity,
    document.querySelector('#solvent-select').value,
    document.querySelector('#constraint-select').value].join('|');
}

function formatReplicaRate(value) {
  return `${Math.round(value).toLocaleString()} replica-steps/s`;
}

function updateStormmReplicaOptions() {
  const system = document.querySelector('#stormm-system').value;
  const select = document.querySelector('#stormm-replica-count');
  let maximum = system === 'water27' ? 256 : 1024;
  if (system === 'current' && state.molecule?.atoms.length) {
    const atoms = state.molecule.atoms.length;
    maximum = atoms > 512 ? 0 : Math.max(1, Math.floor(2_100_000 / (atoms * atoms)));
  }
  const tuning = state.stormmReplicaTuning.get(stormmTuningKey());
  const sampleByCount = new Map(tuning?.samples?.map((sample) => [sample.replicaCount, sample]) || []);
  [...select.options].forEach((option) => {
    const count = Number(option.value);
    option.disabled = count > maximum;
    const sample = sampleByCount.get(count);
    option.textContent = `${count.toLocaleString()} ${count === 1 ? 'trajectory' : 'trajectories'}`
      + (sample ? ` · ${formatReplicaRate(sample.aggregateReplicaStepsPerSecond)}` : '')
      + (count === tuning?.recommendedReplicaCount ? ' · recommended' : '');
  });
  if (Number(select.value) > maximum) {
    const available = [...select.options].filter((option) => !option.disabled);
    select.value = available.at(-1)?.value || '1';
  }
  const status = document.querySelector('#stormm-tuning-status');
  const button = document.querySelector('#stormm-autotune');
  button.disabled = state.tuningStormmReplicas || state.calculating || maximum < 1;
  button.textContent = state.tuningStormmReplicas ? 'Sweeping replica counts…' : 'Find best replica count';
  if (maximum < 1) status.textContent = 'This WebGPU ensemble path currently supports at most 512 atoms per replica.';
  else if (tuning) status.textContent = `Recommended ${tuning.recommendedReplicaCount.toLocaleString()} · ${formatReplicaRate(tuning.peakAggregateReplicaStepsPerSecond)} peak · ${tuning.elapsedMs.toFixed(0)} ms smoke test.`;
  else if (!state.tuningStormmReplicas) status.textContent = 'Run a short GPU sweep for this System before a long trajectory.';
}

async function tuneStormmReplicas(overrides = {}) {
  if (state.tuningStormmReplicas || state.calculating) return null;
  const system = overrides.stormmSystem || document.querySelector('#stormm-system').value;
  document.querySelector('#stormm-system').value = system;
  if (system === 'current' && !state.molecule) throw new Error('Load a molecule before tuning replicas');
  state.tuningStormmReplicas = true;
  updateStormmReplicaOptions();
  const status = document.querySelector('#stormm-tuning-status');
  const runButton = document.querySelector('#run-calculation');
  runButton.disabled = true;
  try {
    let molecule = state.molecule;
    if (system === 'current' && !molecule.parameterization?.system) {
      status.textContent = 'Parameterizing the System once…';
      const parameters = await runOpenMMJob('parameters', molecule, ({ phase }) => { status.textContent = phase; });
      molecule.parameterization = {
        forcefield:parameters.forcefield, chargeModel:parameters.chargeModel,
        sourceSha256:parameters.sourceSha256, system:parameters.system, labels:parameters.labels,
      };
    }
    const key = stormmTuningKey();
    const result = await runStormmJob('replica-smoke', molecule, ({ phase }) => { status.textContent = phase; }, {
      ...overrides,
      stormmSystem:system,
      implicitSolvent:overrides.implicitSolvent || document.querySelector('#solvent-select').value,
      constraintMode:overrides.constraintMode || document.querySelector('#constraint-select').value,
    });
    state.stormmReplicaTuning.set(key, result);
    document.querySelector('#stormm-replica-count').value = String(result.recommendedReplicaCount);
    updateStormmReplicaOptions();
    showToast(`Recommended ${result.recommendedReplicaCount.toLocaleString()} STORMM replicas`);
    return result;
  } catch (error) {
    status.textContent = `Replica sweep failed · ${error.message}`;
    showNotice(`STORMM replica sweep: ${error.message}`);
    throw error;
  } finally {
    state.tuningStormmReplicas = false;
    runButton.disabled = false;
    updateStormmReplicaOptions();
  }
}

function updateConformerCountOptions() {
  const select = document.querySelector('#conformer-count');
  const atoms = state.molecule?.atoms.length || 1;
  const arenaMaximum = document.querySelector('#conformer-arena')?.checked ? 64 : 256;
  const maximum = atoms > 512 ? 0 : Math.min(arenaMaximum, Math.floor(2_100_000 / (atoms * atoms)));
  [...select.options].forEach((option) => { option.disabled = Number(option.value) > maximum; });
  if (Number(select.value) > maximum) {
    const available = [...select.options].filter((option) => !option.disabled);
    if (available.length) select.value = available.at(-1).value;
  }
}

function ani2xUiCompatibility(molecule) {
  if (!molecule?.atoms?.length) return { supported: true, reason: 'Load a neutral H/C/N/O/F/S/Cl molecule.' };
  if (molecule.atoms.length > 96)
    return { supported: false, reason: 'ANI-2x browser minimization is currently limited to 96 atoms.' };
  const allowed = new Set(['H', 'C', 'N', 'O', 'S', 'F', 'Cl']);
  const unsupported = [...new Set(molecule.atoms.map((atom) => atom.element)
    .filter((element) => !allowed.has(element)))];
  if (unsupported.length)
    return { supported: false, reason: `ANI-2x does not support ${unsupported.join(', ')}.` };
  const charge = molecule.atoms.reduce((sum, atom) => {
    const value = Number(atom.formalCharge ?? atom.charge ?? 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  if (Math.abs(charge) > 1e-6)
    return { supported: false, reason: 'The ANI-2x lane is restricted to neutral molecules.' };
  if (Number(molecule.multiplicity ?? 1) !== 1)
    return { supported: false, reason: 'The ANI-2x lane is restricted to closed-shell singlets.' };
  if (!molecule.atoms.some((atom) => atom.element === 'H'))
    return { supported: false, reason: 'ANI-2x requires explicit hydrogens.' };
  const adjacency = molecule.atoms.map(() => []);
  for (const bond of molecule.bonds || []) {
    adjacency[bond.a]?.push(bond.b);
    adjacency[bond.b]?.push(bond.a);
  }
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const atom = queue.shift();
    for (const neighbor of adjacency[atom]) if (!seen.has(neighbor)) {
      seen.add(neighbor);
      queue.push(neighbor);
    }
  }
  if (seen.size !== molecule.atoms.length)
    return { supported: false, reason: 'ANI-2x minimization currently requires one connected molecule.' };
  return { supported: true, reason: 'Official eight-member ANI-2x ensemble.' };
}

function updateOptimizerControls() {
  const prepared = state.molecule?.parameterization;
  const forcefield = prepared?.forcefield || 'OpenFF Sage 2.1';
  const chargeModel = prepared?.chargeModel || 'deterministic RDKit Gasteiger charges';
  const webgpuRunOption = document.querySelector('#method-select option[value="webgpu"]');
  const stormmRunOption = document.querySelector('#method-select option[value="stormm"]');
  const webgpuBuildOption = document.querySelector('#build-optimizer-select option[value="webgpu"]');
  const pocketWebgpuBuildOption = document.querySelector('#build-optimizer-select option[value="pocket-webgpu"]');
  const inducedFitWebgpuBuildOption = document.querySelector('#build-optimizer-select option[value="induced-fit-webgpu"]');
  const ligandBuildOption = document.querySelector('#build-optimizer-select option[value="ligand-rdkit"]');
  const rdkitRunOption = document.querySelector('#method-select option[value="rdkit"]');
  const rdkitBuildOption = document.querySelector('#build-optimizer-select option[value="rdkit"]');
  const aniRunOption = document.querySelector('#method-select option[value="ani2x"]');
  const aniBuildOption = document.querySelector('#build-optimizer-select option[value="ani2x"]');
  const buildSelect = document.querySelector('#build-optimizer-select');
  const ligandPlan = editableLigandComponentPlan();
  const hasProtein = state.structureComponents.some((component) => component.kind === 'protein');
  const proteinLigandComplex = Boolean(hasProtein && ligandPlan);
  webgpuRunOption.textContent = `${forcefield} · WebGPU`;
  webgpuBuildOption.textContent = proteinLigandComplex
    ? `Full complex · ${forcefield} · WebGPU`
    : `${forcefield} · WebGPU`;
  ligandBuildOption.disabled = !ligandPlan;
  ligandBuildOption.hidden = !proteinLigandComplex;
  ligandBuildOption.textContent = ligandPlan
    ? `Ligand only · MMFF94/UFF · ${ligandPlan.globalAtomIndices.length} atoms`
    : 'Ligand only · MMFF94/UFF';
  const pocketMovableCount = interactivePocketMovableAtomIndices().length;
  pocketWebgpuBuildOption.textContent = pocketMovableCount
    ? `Pocket relax · WebGPU · ${pocketMovableCount} movable`
    : 'Pocket relax · WebGPU';
  pocketWebgpuBuildOption.disabled = !pocketMovableCount;
  pocketWebgpuBuildOption.hidden = !proteinLigandComplex;
  const inducedFitMovableCount = inducedFitPocketMovableAtomIndices().length;
  inducedFitWebgpuBuildOption.textContent = inducedFitMovableCount
    ? `Induced-fit pocket · WebGPU · ${inducedFitMovableCount} movable`
    : 'Induced-fit pocket · WebGPU';
  inducedFitWebgpuBuildOption.disabled = !inducedFitMovableCount;
  inducedFitWebgpuBuildOption.hidden = !proteinLigandComplex;
  webgpuBuildOption.hidden = proteinLigandComplex;
  rdkitRunOption.disabled = Boolean(prepared);
  rdkitBuildOption.disabled = Boolean(prepared || proteinLigandComplex);
  rdkitBuildOption.hidden = Boolean(prepared || proteinLigandComplex);
  const aniCompatibility = ani2xUiCompatibility(state.molecule);
  aniRunOption.disabled = !aniCompatibility.supported;
  aniBuildOption.disabled = !aniCompatibility.supported;
  aniBuildOption.hidden = !aniCompatibility.supported || proteinLigandComplex;
  aniRunOption.title = aniCompatibility.reason;
  aniBuildOption.title = aniCompatibility.reason;
  if (prepared && document.querySelector('#method-select').value === 'rdkit')
    document.querySelector('#method-select').value = 'webgpu';
  if (prepared && buildSelect.value === 'rdkit') buildSelect.value = proteinLigandComplex ? 'ligand-rdkit' : 'webgpu';
  if (!aniCompatibility.supported && document.querySelector('#method-select').value === 'ani2x')
    document.querySelector('#method-select').value = 'webgpu';
  if (!aniCompatibility.supported && buildSelect.value === 'ani2x')
    buildSelect.value = proteinLigandComplex ? 'ligand-rdkit' : 'webgpu';
  if (!pocketMovableCount && buildSelect.value === 'pocket-webgpu')
    buildSelect.value = proteinLigandComplex ? 'ligand-rdkit' : 'webgpu';
  if (!inducedFitMovableCount && buildSelect.value === 'induced-fit-webgpu')
    buildSelect.value = proteinLigandComplex ? 'ligand-rdkit' : 'webgpu';
  if (!ligandPlan && buildSelect.value === 'ligand-rdkit') buildSelect.value = prepared ? 'webgpu' : 'rdkit';
  if (proteinLigandComplex && !buildSelect.dataset.userSelected
    && ['rdkit', 'webgpu'].includes(buildSelect.value))
    buildSelect.value = 'ligand-rdkit';
  if (proteinLigandComplex && buildSelect.value === 'webgpu')
    buildSelect.value = 'ligand-rdkit';
  const visibleBuildMethods = [...buildSelect.options]
    .filter((option) => !option.hidden && !option.disabled);
  buildSelect.classList.toggle('hidden', visibleBuildMethods.length <= 1);
  buildSelect.parentElement.classList.toggle('single-action', visibleBuildMethods.length <= 1);
  const buildMethod = buildSelect.value;
  setText('#build-optimizer-help', buildMethod === 'webgpu'
      ? `The ${forcefield} numeric System runs directly on WebGPU. Independent OpenMM checks remain validation-only.`
      : buildMethod === 'pocket-webgpu'
        ? `Pocket-aware 5 Å relaxation moves the ligand and pocket side chains on WebGPU; ${state.molecule.atoms.length - pocketMovableCount} outer protein atoms remain fixed. A chemically edited complex is reparameterized first.`
      : buildMethod === 'induced-fit-webgpu'
        ? `Experimental hit-only induced-fit relaxation moves the ligand plus complete residues entering a 6 Å shell, including local backbone atoms; ${state.molecule.atoms.length - inducedFitMovableCount} outer atoms remain fixed.`
      : buildMethod === 'ligand-rdkit'
        ? state.dockingReference?.mode === 'pose-propagation'
          && selectedDockingEditCleanup() === 'preserve-reference'
          ? 'Cleans new atoms and hydrogens while inherited reference heavy atoms stay fixed.'
          : `Fast ligand-only MMFF94/UFF optimization. The complete protein stays fixed and is omitted from the energy, so use Pocket relax when protein–ligand contacts must respond.`
      : buildMethod === 'rdkit'
        ? 'RDKit runs established MMFF94 locally, with genuine UFF fallback when parameters are unavailable.'
        : buildMethod === 'ani2x'
          ? 'The official eight-member ANI-2x ML potential minimizes neutral H/C/N/O/F/S/Cl molecules with analytical forces in ONNX Runtime Web.'
        : 'Established MMFF94 with UFF fallback runs locally in RDKit WebAssembly.');

  const jobSelect = document.querySelector('#job-select');
  const methodSelect = document.querySelector('#method-select');
  const conformerSearch = jobSelect.value === 'conformers';
  const dynamics = jobSelect.value === 'dynamics';
  webgpuRunOption.hidden = conformerSearch;
  stormmRunOption.hidden = !dynamics && !conformerSearch;
  rdkitRunOption.hidden = Boolean(prepared) || !['geometry', 'energy'].includes(jobSelect.value);
  aniRunOption.hidden = !aniCompatibility.supported || !['geometry', 'energy'].includes(jobSelect.value);
  if (conformerSearch) {
    methodSelect.value = 'stormm';
    document.querySelector('#stormm-system').value = 'current';
  } else if (methodSelect.selectedOptions[0]?.hidden || methodSelect.selectedOptions[0]?.disabled) {
    methodSelect.value = 'webgpu';
  }
  const visibleRunMethods = [...methodSelect.options]
    .filter((option) => !option.hidden && !option.disabled);
  document.querySelector('#method-field').classList.toggle('hidden', visibleRunMethods.length <= 1);
  const method = methodSelect.value;
  const stormm = method === 'stormm';
  const conformerArena = conformerSearch && document.querySelector('#conformer-arena').checked;
  const arenaMethods = aniCompatibility.supported
    ? 'MMFF seeds · STORMM WebGPU · ANI-2x'
    : `MMFF seeds · STORMM WebGPU · ANI-2x unavailable (${aniCompatibility.reason})`;
  setText('#conformer-arena-methods', arenaMethods);
  const stormmCurrent = stormm && document.querySelector('#stormm-system').value === 'current';
  const supportsImplicitSolvent = !conformerSearch
    && (method === 'webgpu' || stormmCurrent);
  const supportsConstraints = dynamics && (method === 'webgpu' || stormmCurrent);
  document.querySelector('#solvent-field').classList.toggle('hidden', !supportsImplicitSolvent);
  document.querySelector('#constraint-field').classList.toggle('hidden', !supportsConstraints);
  const settings = document.querySelector('#simulation-settings');
  settings.classList.toggle('hidden', !supportsImplicitSolvent && !supportsConstraints);
  [...jobSelect.options].forEach((option) => { option.disabled = false; });
  document.querySelector('#stormm-fields').classList.toggle('hidden', !stormm || conformerSearch);
  document.querySelector('#conformer-fields').classList.toggle('hidden', !conformerSearch);
  updateStormmReplicaOptions();
  updateConformerCountOptions();
  const solvent = document.querySelector('#solvent-select').value;
  const constrained = document.querySelector('#constraint-select').value === 'hbonds';
  const settingsParts = [];
  if (supportsImplicitSolvent) settingsParts.push(solvent === 'obc2' ? 'implicit water' : 'vacuum');
  if (supportsConstraints) settingsParts.push(constrained ? 'X–H · 2 fs' : 'flexible · 1 fs');
  const recommendedSettings = (!supportsImplicitSolvent || solvent === 'obc2')
    && (!supportsConstraints || constrained);
  setText('#simulation-settings-summary', `${recommendedSettings ? 'Recommended' : 'Custom'} · ${settingsParts.join(' · ')}`);
  document.querySelector('#simulation-step-field').classList.toggle('hidden', !dynamics);
  document.querySelector('#trajectory-frame-field').classList.toggle('hidden', !dynamics);
  const timestepFs = method === 'rdkit' ? 0.1 : constrained && supportsConstraints ? 2 : 1;
  document.querySelectorAll('#simulation-step-count option').forEach((option) => {
    const steps = Number(option.value);
    option.disabled = method === 'webgpu' && steps > 5000;
    const simulatedPs = steps * timestepFs / 1000;
    const duration = simulatedPs >= 1000
      ? `${(simulatedPs / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} ns`
      : `${simulatedPs.toLocaleString(undefined, { maximumFractionDigits: 3 })} ps`;
    option.textContent = `${steps.toLocaleString()} steps · ${duration}`;
  });
  if (method === 'webgpu' && Number(document.querySelector('#simulation-step-count').value) > 5000)
    document.querySelector('#simulation-step-count').value = '5000';
  document.querySelector('#run-calculation').textContent = conformerArena ? 'Run Conformer Arena'
    : conformerSearch ? 'Search Conformers'
    : stormm ? 'Run STORMM Ensemble' : 'Run Calculation';
  const environmentInfo = !supportsImplicitSolvent
    ? 'This method does not use the environment setting.'
    : solvent === 'obc2'
      ? 'OBC2 generalized Born implicit water uses mbondi2 radii and the ACE surface term.'
      : 'Vacuum adds no solvent model.';
  const constraintInfo = !supportsConstraints
    ? 'This method does not use the dynamics-constraint setting.'
    : !constrained
      ? 'All bonds remain flexible. Dynamics use a 1 fs time step.'
      : method === 'stormm'
          ? 'Each replica constrains X–H bonds with fixed-point SHAKE and projects velocities with RATTLE. Dynamics use a 2 fs time step.'
          : 'WebGPU constrains X–H bonds with graph-colored SHAKE and projects velocities with RATTLE. Dynamics use a 2 fs time step.';
  setText('#environment-info', environmentInfo);
  setText('#constraint-info', constraintInfo);

  const engineInfo = method === 'webgpu'
      ? `${forcefield} runs directly on WebGPU in f32 with deterministic force accumulation; charges use ${chargeModel}.`
      : method === 'stormm'
        ? `The STORMM-style WebGPU engine copies one complete ${forcefield} numeric System across independent replicas. Replicas do not interact. Its advantage is batching; one replica has no ensemble-throughput gain over the direct WebGPU path.`
        : method === 'ani2x'
          ? 'The official eight-member ANI-2x vacuum neural potential runs in ONNX Runtime WebGPU with a WASM fallback. It has no implicit-solvent term and supports neutral, closed-shell, hydrogen-complete H/C/N/O/F/S/Cl molecules up to 96 atoms.'
          : 'Established MMFF94 parameters and analytical gradients run locally in RDKit WebAssembly. Unsupported chemistries fall back to genuine UFF.';
  const methodInfo = conformerSearch
    ? conformerArena
      ? `A bounded pool of RDKit WebAssembly workers makes one symmetry-pruned, vacuum-MMFF94/UFF-polished ETKDGv3 seed set. The Arena compares the seeds, STORMM Sage/WebGPU refinement, and batched ANI-2x refinement. A batched STORMM WebGPU pass gives every candidate the same Sage/OBC2 score. ANI-2x refinement and scoring use the model's native vacuum electronic energy with no OBC term. Molecular-dynamics settings do not alter these lane-specific protocols.${aniCompatibility.supported ? '' : ` ANI-2x is skipped: ${aniCompatibility.reason}`}`
      : `A bounded pool of RDKit WebAssembly workers makes ETKDGv3 seeds, polishes them with vacuum MMFF94 or UFF, then removes cross-worker duplicates by symmetry-aware heavy-atom RMSD. STORMM advances all remaining seeds together through Sage minimization, 600 K exploration, staged cooling, 300 K settling, and final minimization on WebGPU. This Sage workflow fixes OBC2 implicit water, X–H constraints, and no nonbonded cutoff. Final structures are clustered for SDF export.`
    : dynamics
      ? `${engineInfo} Thermostatted dynamics are stochastic. Saved frames show potential energy in kcal/mol, not total energy.${stormm ? ' Each replica retains its own trajectory; the selected curve follows one replica.' : ''}`
      : engineInfo;
  setText('#method-info', methodInfo);
  const conciseHelp = conformerSearch
    ? conformerArena
      ? aniCompatibility.supported
        ? 'Compare MMFF seeds, STORMM WebGPU and ANI-2x on one shared score.'
        : 'Compare MMFF seeds and STORMM WebGPU; ANI-2x is unavailable here.'
      : 'Search many conformers together on WebGPU, then cluster the best distinct structures.'
    : dynamics
      ? stormm ? 'Run independent trajectories together on WebGPU.'
        : 'Run thermostatted dynamics and save an interactive trajectory.'
      : jobSelect.value === 'geometry'
        ? 'Optimize the current molecular geometry.'
        : 'Evaluate the current structure without moving its atoms.';
  setText('#method-help', conciseHelp);
  const chemistryBlocked = Boolean(state.chemistryTransaction || state.chemistryEditFinishing);
  const optimizeButton = document.querySelector('#optimize-button');
  const calculationButton = document.querySelector('#run-calculation');
  if (optimizeButton)
    optimizeButton.disabled = chemistryBlocked || state.minimizing || state.preparing || state.calculating;
  if (calculationButton)
    calculationButton.disabled = chemistryBlocked || state.preparing || state.calculating;
  if (chemistryBlocked)
    setText('#build-optimizer-help', 'Finish or discard the pending chemistry before optimization.');
}

async function runSelectedBuildOptimization() {
  if (state.chemistryTransaction) {
    showNotice('Finish or discard the pending chemistry changes before optimizing.');
    return null;
  }
  const method = document.querySelector('#build-optimizer-select').value;
  if (method === 'ligand-rdkit') {
    const button = document.querySelector('#optimize-button');
    button.disabled = true; button.textContent = 'Ligand…';
    try { return await optimizeEditableLigand(); }
    catch (error) { showNotice(error.message); return null; }
    finally { button.disabled = false; button.textContent = '⚡ Optimize'; updateBuildStatus(); }
  }
  const pocketRelaxation = method === 'pocket-webgpu';
  const inducedFitRelaxation = method === 'induced-fit-webgpu';
  const flexiblePocketRelaxation = pocketRelaxation || inducedFitRelaxation;
  const workerMethod = flexiblePocketRelaxation ? 'webgpu' : method;
  const poseRetentionBefore = inducedFitRelaxation
    ? currentRegisteredPoseRetentionPlan() : null;
  if (poseRetentionBefore && !poseRetentionBefore.accepted)
    throw new Error('The selected pose does not satisfy its required registered retention feature');
  const movableAtomIndices = pocketRelaxation ? interactivePocketMovableAtomIndices()
    : inducedFitRelaxation ? inducedFitPocketMovableAtomIndices(
      state.molecule, poseRetentionBefore) : null;
  if (flexiblePocketRelaxation && !movableAtomIndices.length) {
    showNotice('Pocket relaxation needs a prepared protein–ligand complex.'); return null;
  }
  const button = document.querySelector('#optimize-button');
  const forcefield = state.molecule?.parameterization?.forcefield;
  const label = forcefield?.includes('Rosemary') ? 'Rosemary' : 'Sage';
  button.disabled = true; button.textContent = inducedFitRelaxation ? 'Induced fit…'
      : pocketRelaxation ? 'Pocket GPU…'
      : method === 'webgpu' ? `${label} GPU…`
      : method === 'ani2x' ? 'ANI-2x…' : 'MMFF94…';
  const valenceSnapshot = flexiblePocketRelaxation
    ? captureLigandValenceGeometry() : null;
  try {
    const result = await runCalculation({ method:workerMethod, job:'geometry', options:flexiblePocketRelaxation ? {
      movableAtomIndices, maxIterations:inducedFitRelaxation ? 240 : 120, nonbondedCutoffNm:1.0,
      maximumNeighbors:1024, minimizeRate:inducedFitRelaxation ? 0.0000002 : 0.00000035,
      maxDisplacement:inducedFitRelaxation ? 0.00075 : 0.001,
      savedFrameCount:BUILD_OPTIMIZATION_FRAME_COUNT,
    } : undefined });
    if (result && poseRetentionBefore) {
      const poseRetentionAfter = currentRegisteredPoseRetentionPlan();
      result.registeredPoseRetention = {
        before:structuredClone(poseRetentionBefore),
        after:structuredClone(poseRetentionAfter),
        accepted:poseRetentionAfter.accepted,
      };
    }
    if (result && valenceSnapshot) {
      const valenceSafeguard = validateLigandValenceGeometry(valenceSnapshot);
      if (!valenceSafeguard.accepted) {
        restoreValenceGeometrySnapshot(valenceSnapshot);
        clearCalculationResult(); state.lastCalculation = null;
        updateStoredBondDistances(); updateInfo(); draw();
        showToast(`Relaxation rejected · restored pre-relax pose · ${valenceSafeguard.violations.length} distorted ligand bonds`);
        return { ...result, valenceSafeguard };
      }
      result.valenceSafeguard = valenceSafeguard;
    }
    if (result?.registeredPoseRetention
      && !result.registeredPoseRetention.accepted) {
      restoreValenceGeometrySnapshot(valenceSnapshot);
      clearCalculationResult(); state.lastCalculation = null;
      updateStoredBondDistances(); updateInfo(); draw();
      showToast('Relaxation rejected · required registered pose feature moved outside tolerance');
      return result;
    }
    if (result && flexiblePocketRelaxation) setMode('view');
    return result;
  } catch (error) {
    showNotice(error.message);
    throw error;
  }
  finally { button.disabled = false; button.textContent = '⚡ Optimize'; }
}

function captureLigandValenceGeometry() {
  const molecule = state.molecule;
  const ligand = dockingLigandComponent()
    || state.structureComponents.find((component) => component.kind === 'ligand');
  if (!molecule || !ligand) return null;
  const ligandAtoms = new Set(ligand.atomIndices);
  const distance = (a, b) => Math.hypot(
    molecule.atoms[a].x - molecule.atoms[b].x,
    molecule.atoms[a].y - molecule.atoms[b].y,
    molecule.atoms[a].z - molecule.atoms[b].z);
  return {
    positions:molecule.atoms.map((atom) => [atom.x, atom.y, atom.z]),
    bonds:molecule.bonds.filter((bond) => ligandAtoms.has(bond.a) && ligandAtoms.has(bond.b)
      && molecule.atoms[bond.a].element !== 'H' && molecule.atoms[bond.b].element !== 'H')
      .map((bond) => ({ a:bond.a, b:bond.b, before:distance(bond.a, bond.b),
        target:equilibriumBondLength(molecule.atoms[bond.a], molecule.atoms[bond.b], bond.order || 1),
        atomNames:[molecule.atoms[bond.a].atomName || molecule.atoms[bond.a].designAtomId,
          molecule.atoms[bond.b].atomName || molecule.atoms[bond.b].designAtomId] })),
  };
}

function validateLigandValenceGeometry(snapshot) {
  if (!snapshot?.bonds?.length) return { schema:'molarium.ligand-valence-safeguard/v1',
    accepted:false, complete:false, checkedHeavyBonds:0, expectedHeavyBonds:0,
    bondMeasurements:[], violations:[{ failure:'no-heavy-bond-evidence' }] };
  const molecule = state.molecule;
  const bondMeasurements = snapshot.bonds.map((bond) => {
    const after = Math.hypot(
      molecule.atoms[bond.a].x - molecule.atoms[bond.b].x,
      molecule.atoms[bond.a].y - molecule.atoms[bond.b].y,
      molecule.atoms[bond.a].z - molecule.atoms[bond.b].z);
    const stretched = after > bond.before + 0.45 && after > bond.target * 1.25;
    const compressed = after < bond.before - 0.35 && after < bond.target * 0.75;
    return { atomNames:bond.atomNames,
      beforeAngstrom:Number(bond.before.toFixed(3)),
      afterAngstrom:Number(after.toFixed(3)),
      targetAngstrom:Number(bond.target.toFixed(3)),
      accepted:!stretched && !compressed,
      failure:stretched ? 'stretched' : compressed ? 'compressed' : null };
  });
  const violations = bondMeasurements.filter((entry) => !entry.accepted);
  return { schema:'molarium.ligand-valence-safeguard/v1',
    accepted:violations.length === 0, complete:true,
    checkedHeavyBonds:bondMeasurements.length,
    expectedHeavyBonds:snapshot.bonds.length,
    bondMeasurements, violations };
}

function restoreValenceGeometrySnapshot(snapshot) {
  snapshot.positions.forEach((position, index) => {
    if (!state.molecule?.atoms[index]) return;
    [state.molecule.atoms[index].x, state.molecule.atoms[index].y,
      state.molecule.atoms[index].z] = position;
  });
}

function setGeneratedCardOpen(card, body, toggle, open) {
  body.classList.toggle('hidden', !open);
  card.classList.toggle('side-card-collapsed', !open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.querySelector('.chevron').classList.toggle('open', open);
}

function installSideCardDisclosures() {
  const explicitTitles = { 'build-left-panel':'Design tools', 'build-right-panel':'Design workspace' };
  document.querySelectorAll('.panel > .card, .panel-scroll-stack > .card').forEach((card, index) => {
    if (card.classList.contains('story-transport-card')) return;
    if (card.querySelector(':scope > .card-heading.disclosure')) return;
    const sourceTitle = explicitTitles[card.id] ? null : card.querySelector(':scope > h2.compact-label');
    const title = explicitTitles[card.id] || sourceTitle?.textContent?.trim() || 'Panel';
    const titleId = sourceTitle?.id || '';
    sourceTitle?.remove();

    const body = document.createElement('div');
    body.className = 'collapsible-card-body';
    body.id = `${card.id || `side-card-${index}`}-body`;
    while (card.firstChild) body.append(card.firstChild);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'card-heading disclosure generated-card-heading';
    toggle.dataset.generatedCardDisclosure = '';
    toggle.setAttribute('aria-expanded', 'true');
    toggle.setAttribute('aria-controls', body.id);
    toggle.setAttribute('aria-label', `Collapse ${title}`);
    const label = document.createElement('span');
    label.className = 'compact-label collapsible-card-title';
    if (titleId) label.id = titleId;
    label.textContent = title;
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'chevron open');
    chevron.setAttribute('viewBox', '0 0 16 16');
    chevron.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm6 4 4 4-4 4');
    chevron.append(path);
    toggle.append(label, chevron);
    card.classList.add('generated-collapsible-card');
    card.append(toggle, body);
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      runChemistUiAction('interface.setPanelOpen', {
        panelId:card.id || body.id, open,
      }).then(() => {
        toggle.setAttribute('aria-label', `${open ? 'Collapse' : 'Expand'} ${label.textContent}`);
      }).catch(() => {});
    });
  });
}

installSideCardDisclosures();

document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab === button));
  document.querySelectorAll('.tab-content').forEach((panel) => panel.classList.add('hidden'));
  document.querySelector(`#tab-${button.dataset.tab}`).classList.remove('hidden');
}));

document.querySelector('#load-toggle').addEventListener('click', (event) => {
  const open = event.currentTarget.getAttribute('aria-expanded') !== 'true';
  runChemistUiAction('interface.setPanelOpen', { panelId:'load-toggle', open }).catch(() => {});
});

document.querySelector('#protein-fold-toggle').addEventListener('click', (event) => {
  const open = event.currentTarget.getAttribute('aria-expanded') !== 'true';
  runChemistUiAction('interface.setPanelOpen', { panelId:'protein-fold-toggle', open }).catch(() => {});
});

document.querySelector('#protein-sequence').addEventListener('input', (event) => {
  const value = event.target.value.split(/\r?\n/).filter((line) => !line.trim().startsWith('>')).join('').replace(/\s+/g, '');
  setText('#protein-length', `${value.length}/128`);
});

document.querySelector('#fold-protein').addEventListener('click', () => {
  runChemistUiAction('protein.predict', {
    sequence:document.querySelector('#protein-sequence').value,
    msaEndpoint:document.querySelector('#msa-endpoint').value,
  }).catch(() => {});
});
document.querySelector('#try-rosemary-protein').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Loading Rosemary α…';
  try {
    const summary = (await runChemistUiAction('session.loadFixture', {
      fixtureId:'trp-cage',
    }, { reportError:false })).fixture;
    showToast(`Rosemary alpha Trp-cage loaded · ${summary.atoms} atoms`);
  } catch (error) {
    setFoldStatus(`Rosemary reference failed · ${error.message}`);
    showNotice(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Trp-cage · 304 atoms';
  }
});
document.querySelector('#try-ubiquitin-protein').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Loading 1UBQ…';
  try {
    const summary = (await runChemistUiAction('session.loadFixture', {
      fixtureId:'ubiquitin',
    }, { reportError:false })).fixture;
    setText('#protein-result-title', 'Ubiquitin · 1UBQ');
    setText('#protein-result-meta', 'OpenFF Rosemary 3.0.0-alpha0 · experimental 1UBQ coordinates · exact preparameterized System');
    setFoldStatus('Loaded ubiquitin 1UBQ · ready for OpenMM or experimental WebGPU');
    showToast(`Ubiquitin 1UBQ loaded · ${summary.atoms} atoms`);
  } catch (error) {
    setFoldStatus(`Ubiquitin reference failed · ${error.message}`);
    showNotice(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Ubiquitin · 1,231 atoms';
  }
});
document.querySelector('#cancel-fold').addEventListener('click', () => {
  runChemistUiAction('protein.cancelPrediction').catch(() => {});
});
document.querySelector('#download-protein-pdb').addEventListener('click', () => {
  if (!state.proteinPrediction) return showToast('Load or fold a protein first');
  const prefix = state.proteinPrediction.kind === 'parameterized-reference' ? 'rosemary'
    : state.proteinPrediction.kind === 'pdb-import' ? 'pdb' : 'openfold';
  const identity = state.molecule?.source?.pdbId || state.proteinPrediction.sequence?.slice(0, 12) || state.molecule?.name || 'structure';
  downloadBlob(state.proteinPrediction.pdb, `${prefix}-${slug(identity)}.pdb`, 'chemical/x-pdb');
  showToast('PDB exported');
});

document.querySelector('#scene-toggle').addEventListener('click', (event) => {
  const open = event.currentTarget.getAttribute('aria-expanded') !== 'true';
  runChemistUiAction('interface.setPanelOpen', { panelId:'scene-toggle', open }).catch(() => {});
});

document.querySelector('#structure-2d-toggle').addEventListener('click', (event) => {
  const panel = document.querySelector('#structure-2d-panel');
  const collapsed = panel.classList.toggle('collapsed');
  event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
  event.currentTarget.querySelector('.chevron').classList.toggle('open', !collapsed);
});
document.querySelectorAll('[data-2d-tool]').forEach((button) => button.addEventListener('click', async () => {
  const tool = button.dataset['2dTool'];
  if (tool !== 'select' && state.mode !== 'build') {
    try { await runChemistUiAction('view.setMode', { mode:'build' }); }
    catch { return; }
  }
  state.depictionTool = tool; state.depictionBondStart = null; update2DEditorUi();
}));
document.querySelector('#structure-2d-element').addEventListener('change', async (event) => {
  state.selectedElement = event.target.value;
  document.querySelectorAll('#element-grid button').forEach((button) =>
    button.classList.toggle('selected', button.dataset.element === state.selectedElement));
  state.depictionTool = 'atom'; state.depictionBondStart = null;
  if (state.mode !== 'build') await runChemistUiAction('view.setMode', { mode:'build' });
  updateBuildStatus(); update2DEditorUi();
});
document.querySelector('#structure-2d-bond-order').addEventListener('change', async (event) => {
  state.depictionBondOrder = Number(event.target.value);
  state.depictionTool = 'bond'; state.depictionBondStart = null;
  if (state.mode !== 'build') await runChemistUiAction('view.setMode', { mode:'build' });
  update2DEditorUi();
});
document.querySelector('#structure-2d-finish').addEventListener('click', () => {
  runChemistUiAction('chemistry.finish').catch(() => {});
});
document.querySelector('#structure-2d-discard').addEventListener('click', () => {
  runChemistUiAction('chemistry.discard').then(() => {
    state.depictionBondStart = null; update2DEditorUi();
  }).catch(() => {});
});
async function selectDepictionAtomsThroughAction(indices) {
  if (!indices.length) return runChemistUiAction('selection.clear');
  await ensureChemistActionAtomIds();
  return runChemistUiAction('selection.replace', {
    atomIds:indices.map((index) => state.molecule?.atoms?.[index]?.designAtomId),
  });
}
document.querySelector('#structure-2d-drawing').addEventListener('click', async (event) => {
  const svg = event.currentTarget.querySelector('svg');
  if (!svg || state.depictionEditing) return;
  const hit = depictionProximityHit(event, svg);
  const localAtom = hit.atom?.localIndex ?? null;
  const localBond = hit.bond?.localIndex ?? null;
  const globalAtom = localAtom == null ? null : state.depictionGlobalAtomIndices[localAtom];
  const globalBond = hit.preferBond ? state.depictionGlobalBondPairs[localBond] : null;
  if (state.depictionTool === 'select') {
    if (globalBond) await selectDepictionAtomsThroughAction(globalBond).catch(() => {});
    else if (globalAtom != null) await selectDepictionAtomsThroughAction([globalAtom]).catch(() => {});
    return;
  }
  if (state.mode !== 'build') {
    try { await runChemistUiAction('view.setMode', { mode:'build' }); }
    catch { return; }
  }
  if (state.depictionTool === 'atom') {
    if (globalAtom != null) {
      await ensureChemistActionAtomIds();
      runChemistUiAction('chemistry.addAtom', {
        attachedToAtomId:state.molecule.atoms[globalAtom].designAtomId,
        element:state.selectedElement,
      }).catch(() => {});
    }
    return;
  }
  if (state.depictionTool === 'erase') {
    await ensureChemistActionAtomIds();
    if (globalBond) {
      runChemistUiAction('chemistry.deleteBond', {
        atomIds:globalBond.map((index) => state.molecule.atoms[index].designAtomId),
      }).catch(() => {});
    } else if (globalAtom != null) {
      runChemistUiAction('chemistry.deleteAtom', {
        atomId:state.molecule.atoms[globalAtom].designAtomId,
      }).catch(() => {});
    }
    return;
  }
  if (state.depictionTool === 'bond') {
    if (globalBond) {
      await ensureChemistActionAtomIds();
      runChemistUiAction('chemistry.setBond', {
        atomIds:globalBond.map((index) => state.molecule.atoms[index].designAtomId),
        order:state.depictionBondOrder,
      })
        .catch(() => {}); return;
    }
    if (globalAtom == null) return;
    if (state.depictionBondStart == null) {
      state.depictionBondStart = globalAtom;
      await selectDepictionAtomsThroughAction([globalAtom]).catch(() => {});
      update2DEditorUi(); return;
    }
    if (state.depictionBondStart === globalAtom) {
      state.depictionBondStart = null;
      await selectDepictionAtomsThroughAction([]).catch(() => {});
      update2DEditorUi(); return;
    }
    const first = state.depictionBondStart;
    await ensureChemistActionAtomIds();
    runChemistUiAction('chemistry.createBond', {
      atomIds:[first, globalAtom].map((index) => state.molecule.atoms[index].designAtomId),
      order:state.depictionBondOrder,
    }).catch(() => {});
  }
});

document.querySelector('#components-toggle').addEventListener('click', (event) => {
  const open = event.currentTarget.getAttribute('aria-expanded') !== 'true';
  runChemistUiAction('interface.setPanelOpen', { panelId:'components-toggle', open }).catch(() => {});
});
document.querySelector('#components-show-all').addEventListener('click', () => {
  runChemistUiAction('view.showAllComponents').catch(() => {});
});
document.querySelector('#components-reset').addEventListener('click', () => {
  runChemistUiAction('view.reset').catch(() => {});
});
document.querySelector('#preparation-inspector-toggle').addEventListener('click', (event) => {
  const open = event.currentTarget.getAttribute('aria-expanded') !== 'true';
  runChemistUiAction('interface.setPanelOpen', {
    panelId:'preparation-inspector-toggle', open,
  }).catch(() => {});
});

document.querySelector('#parse-button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  try {
    button.disabled = true; button.textContent = 'Loading structure…';
    const result = await runChemistUiAction('session.loadStructure', {
      content:document.querySelector('#structure-input').value, format:'auto', polish:true,
    }, { reportError:false });
    showToast(`${result.molecule?.name || 'Structure'} loaded · ${result.molecule?.atoms || 0} atoms`);
  }
  catch (error) { showNotice(error.message); }
  finally { button.disabled = false; button.textContent = 'Parse Input'; }
});

async function loadPdbIdentifier(identifier) {
  requireExternalNetwork('RCSB PDB retrieval');
  const pdbId = String(identifier || '').replace(/^PDB\s*[:#-]?\s*/i, '').trim().toUpperCase();
  if (!/^[0-9][A-Z0-9]{3}$/.test(pdbId)) throw new Error('A PDB ID has four characters and begins with a digit, for example 1UBQ');
  const response = await fetch(`https://files.rcsb.org/download/${pdbId}.pdb`);
  if (!response.ok) throw new Error(`PDB ${pdbId} could not be downloaded (HTTP ${response.status})`);
  const text = await response.text();
  const molecule = parsePDB(text, { pdbId, name: `PDB ${pdbId}` });
  loadMolecule(molecule);
  return molecule;
}

document.querySelector('#identifier-button').addEventListener('click', async (event) => {
  const raw = document.querySelector('#identifier-input').value.trim();
  const button = event.currentTarget;
  try {
    button.disabled = true; button.textContent = 'Loading…';
    const result = await runChemistUiAction('session.loadIdentifier', {
      value:raw, kind:'auto',
    }, { reportError:false });
    showToast(`${result.molecule?.name || 'Molecule'} loaded · ${result.molecule?.atoms || 0} atoms`);
  } catch (error) {
    showNotice(error.message);
  } finally {
    button.disabled = false; button.textContent = 'Load';
  }
});

document.querySelector('#ligand-protonation-run').addEventListener('click', () => {
  runChemistUiAction('ligand.enumerateProtonation', {
    pH:Number(document.querySelector('#ligand-protonation-ph').value),
  }).catch(() => {});
});
document.querySelector('#ligand-protonation-state').addEventListener('change', updateLigandProtonationMeta);
document.querySelector('#ligand-protonation-apply').addEventListener('click', () => {
  runChemistUiAction('ligand.applyProtonation', {
    index:Number(document.querySelector('#ligand-protonation-state').value),
  }).catch(() => {});
});

async function handleFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const result = await runChemistUiAction('session.loadStructure', {
      content:text, format:'auto', name:file.name.replace(/\.[^.]+$/, ''), polish:true,
    }, { reportError:false });
    showToast(`${file.name} loaded · ${result.molecule?.atoms || 0} atoms`);
  }
  catch (error) { showNotice(error.message); }
}

document.querySelector('#prepare-pdb').addEventListener('click', async () => {
  if (document.querySelector('#prepare-pdb').dataset.action === 'inspect') {
    openPreparationInspector(); return;
  }
  try { await runChemistUiAction('protein.prepare', {
    pH:Number(document.querySelector('#preparation-ph').value),
    histidine:document.querySelector('#preparation-histidine').value,
    repairMissingHeavy:document.querySelector('#preparation-repair-heavy').checked,
    ligandPolicy:document.querySelector('#preparation-ligands').value,
    waterPolicy:document.querySelector('#preparation-waters').value,
    gapPolicy:document.querySelector('#preparation-gaps').value,
  }, { reportError:false }); }
  catch (error) { showNotice(error.message); updatePdbPreparationUi(); }
});
document.querySelector('#download-preparation-report').addEventListener('click', downloadCurrentPreparationAudit);
['#preparation-ph', '#preparation-histidine', '#preparation-repair-heavy', '#preparation-ligands', '#preparation-waters', '#preparation-gaps']
  .forEach((selector) => document.querySelector(selector).addEventListener('change', () => {
    state.pdbPreparationPreview = null; updatePdbPreparationUi(); updatePreparationInspectorUi();
  }));

document.querySelector('#file-input').addEventListener('change', (event) => handleFile(event.target.files[0]));
const dropZone = document.querySelector('#upload-zone');
['dragenter', 'dragover'].forEach((type) => dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach((type) => dropZone.addEventListener(type, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', (event) => handleFile(event.dataTransfer.files[0]));

document.querySelector('#hydrogen-toggle').addEventListener('change', (event) => {
  runChemistUiAction('view.setDisplay', { showHydrogens:event.target.checked }).catch(() => {});
});
document.querySelector('#vdw-toggle').addEventListener('change', (event) => {
  runChemistUiAction('view.setDisplay', { showVdw:event.target.checked }).catch(() => {});
});
document.querySelector('#hull-toggle').addEventListener('change', (event) => {
  runChemistUiAction('view.setDisplay', { showHulls:event.target.checked }).catch(() => {});
});
document.querySelector('#pocket-toggle').addEventListener('change', (event) => {
  runChemistUiAction('view.setDisplay', { showPocketAtoms:event.target.checked }).catch(() => {});
});
document.querySelector('#pocket-mode-toggle').addEventListener('click', () => {
  runChemistUiAction('view.setDisplay', { pocketMode:
    state.pocketAtomMode === 'contacts' ? 'radius' : 'contacts' }).catch(() => {});
});
document.querySelector('#interaction-toggle').addEventListener('change', (event) => {
  runChemistUiAction('view.setDisplay', { showInteractions:event.target.checked }).catch(() => {});
});
document.querySelector('#steric-clash-toggle').addEventListener('change', (event) => {
  runChemistUiAction('view.setDisplay', { showStericClashes:event.target.checked }).catch(() => {});
});
document.querySelector('#residue-follow-chip').addEventListener('click', () => {
  runChemistUiAction('view.clearFocus', { kind:'residue' }).catch(() => {});
});
document.querySelector('#changed-region-chip').addEventListener('click', () =>
  runChemistUiAction('view.clearFocus', { kind:'atoms' }).catch(() => {}));
document.querySelector('#representation-select').addEventListener('change', (event) => {
  runChemistUiAction('view.setDisplay', { representation:event.target.value }).catch(() => {});
});
document.querySelector('#display-theme-select').addEventListener('change', (event) => {
  runChemistUiAction('view.setDisplay', { colorTheme:event.target.value }).catch(() => {});
});
document.querySelector('#change-marker-select').addEventListener('change', (event) => {
  runChemistUiAction('view.setDisplay', { changeMarkers:event.target.value }).catch(() => {});
});
document.querySelector('#rotate-select').addEventListener('change', (event) => {
  runChemistUiAction('view.setDisplay', { autoRotate:event.target.value,
    playing:event.target.value !== 'none' }).catch(() => {});
});
document.querySelector('#play-button').addEventListener('click', () => {
  runChemistUiAction('view.setDisplay', { playing:!state.playing,
    autoRotate:!state.playing && state.autoRotate === 'none' ? 'vertical' : state.autoRotate,
  }).catch(() => {});
});

document.querySelectorAll('.mode-bar button').forEach((button) => button.addEventListener('click', () => {
  runChemistUiAction('view.setMode', { mode:button.dataset.mode }).catch(() => {});
}));
document.querySelectorAll('#element-grid button').forEach((button) => button.addEventListener('click', () => {
  state.selectedElement = button.dataset.element; document.querySelectorAll('#element-grid button').forEach((item) => item.classList.toggle('selected', item === button));
  state.stagedFragment = null; document.querySelectorAll('.fragment-card').forEach((card) => card.classList.remove('selected'));
  updateBuildStatus(); update2DEditorUi();
}));

document.querySelectorAll('#build-tool-tabs [data-tool]').forEach((button) => button.addEventListener('click', () => {
  runChemistUiAction('build.setTool', {
    tool:button.dataset.tool === 'manipulate' ? 'move' : button.dataset.tool,
  }).catch(() => {});
}));

const geometrySlider = document.querySelector('#geometry-slider');
const geometryValue = document.querySelector('#geometry-value');
geometrySlider.addEventListener('input', (event) => {
  geometryValue.value = event.target.value;
});
async function runCurrentGeometryAction(value) {
  await ensureChemistActionAtomIds();
  return runChemistUiAction('geometry.setInternalCoordinate', {
    atomIds:state.selectedAtoms.map((index) => state.molecule.atoms[index]?.designAtomId),
    value:Number(value), moveConnected:document.querySelector('#move-connected').checked,
  });
}
geometrySlider.addEventListener('change', (event) => {
  runCurrentGeometryAction(event.target.value).catch(() => updateGeometryControl());
});
geometryValue.addEventListener('change', (event) => {
  runCurrentGeometryAction(event.target.value).catch(() => updateGeometryControl());
});

document.querySelector('#undo-atom').addEventListener('click', () => {
  runChemistUiAction('history.undo').catch(() => {});
});
document.querySelector('#redo-atom').addEventListener('click', () => {
  runChemistUiAction('history.redo').catch(() => {});
});
async function selectedChemistryTargetArgs(count) {
  if (state.selectedAtoms.length !== count)
    throw new Error(`Select exactly ${count === 1 ? 'one atom' : 'two atoms'}.`);
  await ensureChemistActionAtomIds();
  const atomIds = state.selectedAtoms.map((index) => state.molecule?.atoms?.[index]?.designAtomId);
  if (atomIds.some((id) => typeof id !== 'string' || !id))
    throw new Error('The selected atom does not have a persistent identity.');
  return count === 1 ? { atomId:atomIds[0] } : { atomIds };
}
document.querySelector('#apply-atom-chemistry').addEventListener('click', async () => {
  const target = await selectedChemistryTargetArgs(1).catch(() => null);
  if (!target) return;
  runChemistUiAction('chemistry.setAtom', {
    ...target,
    element:document.querySelector('#chemistry-element').value,
    formalCharge:Number(document.querySelector('#chemistry-formal-charge').value),
  }).catch(() => {});
});
document.querySelector('#apply-bond-chemistry').addEventListener('click', async () => {
  const target = await selectedChemistryTargetArgs(2).catch(() => null);
  if (!target) return;
  runChemistUiAction('chemistry.setBond', {
    ...target,
    order:Number(document.querySelector('#chemistry-bond-order').value),
  }).catch(() => {});
});
document.querySelector('#delete-bond-chemistry').addEventListener('click', async () => {
  const target = await selectedChemistryTargetArgs(2).catch(() => null);
  if (target) runChemistUiAction('chemistry.deleteBond', target).catch(() => {});
});
document.querySelector('#add-explicit-hydrogen').addEventListener('click', async () => {
  const target = await selectedChemistryTargetArgs(1).catch(() => null);
  if (target) runChemistUiAction('chemistry.addHydrogen', target).catch(() => {});
});
document.querySelector('#remove-explicit-hydrogen').addEventListener('click', async () => {
  const target = await selectedChemistryTargetArgs(1).catch(() => null);
  if (target) runChemistUiAction('chemistry.removeHydrogen', target).catch(() => {});
});
document.querySelector('#delete-selected-atom').addEventListener('click', async () => {
  const target = await selectedChemistryTargetArgs(1).catch(() => null);
  if (target) runChemistUiAction('chemistry.deleteAtom', target).catch(() => {});
});
document.querySelector('#finish-chemistry-changes').addEventListener('click', () => {
  runChemistUiAction('chemistry.finish').catch(() => {});
});
document.querySelector('#discard-chemistry-changes').addEventListener('click', () => {
  runChemistUiAction('chemistry.discard').catch(() => {});
});
document.querySelector('#viewer-finish-chemistry').addEventListener('click', () => {
  runChemistUiAction('chemistry.finish').catch(() => {});
});
document.querySelector('#viewer-discard-chemistry').addEventListener('click', () => {
  runChemistUiAction('chemistry.discard').catch(() => {});
});
document.querySelector('#chemistry-immediate-refine').addEventListener('change', (event) => {
  runChemistUiAction('chemistry.setEditPolicy', {
    mode:event.target.checked ? 'immediate-refine' : 'staged',
  }).catch(() => updateChemistryEditor());
});
document.querySelector('#docking-mode').addEventListener('change', updateDockingUi);
document.querySelector('#docking-edit-cleanup').addEventListener('change', () => {
  runChemistUiAction('pose.setEditCleanup', {
    mode:document.querySelector('#docking-edit-cleanup').value,
  }).catch(() => {});
});
document.querySelector('#capture-docking-reference').addEventListener('click', () => {
  runChemistUiAction('pose.captureReference', {
    mode:document.querySelector('#docking-mode').value,
  }).catch(() => {});
});
document.querySelector('#update-docking-receptor').addEventListener('click', () => {
  runChemistUiAction('pose.updateReceptorReference').catch(() => {});
});
document.querySelector('#confirm-analogue-design').addEventListener('click', () => {
  settleAnalogueDesignPrompt(true);
});
document.querySelector('#cancel-analogue-design').addEventListener('click', () => {
  settleAnalogueDesignPrompt(false);
});
document.querySelector('#analogue-design-dialog').addEventListener('cancel', (event) => {
  event.preventDefault(); settleAnalogueDesignPrompt(false);
});
document.querySelector('#clear-docking-reference').addEventListener('click', () => {
  runChemistUiAction('pose.clearReference').catch(() => {});
});
document.querySelector('#add-docking-contact').addEventListener('click', beginManualDockingContact);
document.querySelector('#cancel-docking-contact').addEventListener('click', cancelManualDockingContact);
document.querySelector('#run-constrained-docking').addEventListener('click', () => {
  runChemistUiAction('pose.refine', {
    searchChains:document.querySelector('#docking-conformer-count').value,
    execution:'auto',
  }).catch((error) => setDockingStatus(`Pose refinement failed · ${error.message}`));
});
document.querySelector('#apply-docking-pose').addEventListener('click', () => {
  runChemistUiAction('pose.apply', { index:state.dockingPoseIndex }).catch(() => {});
});
document.querySelector('#download-docking-labbook').addEventListener('click', () => {
  downloadDockingLabbook('markdown').catch((error) => showNotice(error.message));
});
document.querySelector('#download-docking-audit').addEventListener('click', () => {
  downloadDockingLabbook('json').catch((error) => showNotice(error.message));
});
document.querySelector('#chemistry-formal-charge').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') document.querySelector('#apply-atom-chemistry').click();
});
document.querySelector('#enumerate-sidechain-rotamers').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const residueAtomIndex = state.selectedAtoms.length === 1 ? state.selectedAtoms[0] : null;
  if (!Number.isInteger(residueAtomIndex)) return;
  button.disabled = true; button.textContent = 'Enumerating…';
  try {
    await ensureChemistActionAtomIds();
    await runChemistUiAction('pose.enumerateSidechainRotamers', {
      receptorAtomId:state.molecule.atoms[residueAtomIndex].designAtomId,
      maximumCandidates:32,
    }, { reportError:false });
  }
  catch (error) { showNotice(error.message); }
  finally { button.textContent = 'Enumerate rotamers'; updateSidechainRotamerControls(); }
});
document.querySelector('#apply-sidechain-rotamer').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true; button.textContent = 'Applying…';
  try { await runChemistUiAction('pose.applySidechainRotamer', { index:Number(
    document.querySelector('#sidechain-rotamer-select').value) }, { reportError:false }); }
  catch (error) { showNotice(error.message); }
  finally { button.disabled = false; button.textContent = 'Apply branch'; updateSidechainRotamerControls(); }
});
document.querySelector('#import-designer-moves').addEventListener('click', () => {
  document.querySelector('#designer-move-file').click();
});
document.querySelector('#designer-move-file').addEventListener('change', async (event) => {
  try { await importDesignerMoveScript(event.currentTarget.files?.[0]); }
  catch (error) { showNotice(error.message); }
  finally { event.currentTarget.value = ''; updateDesignerMoveControls(); }
});
document.querySelector('#replay-designer-moves').addEventListener('click', async (event) => {
  try {
    const review = currentDesignerReplayReviewState();
    if (review.completed && review.reviewing)
      await runChemistUiAction('designerScript.step', { direction:'final' }, { reportError:false });
    else await runChemistUiAction('designerScript.play', {
      playing:!state.designerMoveReplaying || state.designerMoveReplayPaused,
    }, { reportError:false });
  }
  catch (error) { showNotice(error.message); }
  finally { updateDesignerMoveControls(); }
});
document.querySelector('#previous-designer-move').addEventListener('click', () => {
  runChemistUiAction('designerScript.step', { direction:'previous' }).catch(() => {});
});
document.querySelector('#next-designer-move').addEventListener('click', () => {
  runChemistUiAction('designerScript.step', { direction:'next' }).catch(() => {});
});
document.querySelector('#restart-designer-moves').addEventListener('click', () => {
  runChemistUiAction('designerScript.restart').then(() =>
    showToast('Story returned to its blank starting canvas')).catch(() => {});
});
document.querySelector('#export-designer-moves').addEventListener('click', () => {
  downloadDesignerScriptExport('recorded-actions').catch((error) => showNotice(error.message));
});
document.querySelector('#export-designer-replay').addEventListener('click', () => {
  downloadDesignerScriptExport('execution-log').catch((error) => showNotice(error.message));
});
document.querySelector('#optimize-button').addEventListener('click', () => {
  runChemistUiAction('optimization.run', {
    method:document.querySelector('#build-optimizer-select').value,
  }).catch(() => {});
});
document.querySelector('#build-optimizer-select').addEventListener('change', (event) => {
  event.currentTarget.dataset.userSelected = 'true'; updateOptimizerControls();
});
document.querySelector('#method-select').addEventListener('change', updateOptimizerControls);
document.querySelector('#job-select').addEventListener('change', (event) => {
  if (event.target.value === 'conformers') {
    document.querySelector('#method-select').value = 'stormm';
    document.querySelector('#stormm-system').value = 'current';
  }
  updateOptimizerControls();
});
document.querySelector('#simulation-step-count').addEventListener('change', updateOptimizerControls);
document.querySelector('#solvent-select').addEventListener('change', updateOptimizerControls);
document.querySelector('#constraint-select').addEventListener('change', updateOptimizerControls);
document.querySelector('#stormm-system').addEventListener('change', updateOptimizerControls);
document.querySelector('#stormm-autotune').addEventListener('click', () => {
  runChemistUiAction('calculation.tuneReplicas').catch(() => {});
});
document.querySelector('#conformer-arena').addEventListener('change', updateOptimizerControls);
document.querySelector('#result-frame-slider').addEventListener('change', (event) => {
  runChemistUiAction('calculation.selectFrame', { index:Number(event.target.value) }).catch(() => {});
});
document.querySelector('#result-play-trajectory').addEventListener('click', () => {
  runChemistUiAction('calculation.setPlayback', { playing:!state.calculationPlaying }).catch(() => {});
});
document.querySelector('#result-final-frame').addEventListener('click', () => {
  runChemistUiAction('calculation.selectFrame', {
    index:state.calculationFrames.length - 1,
  }).catch(() => {});
});
document.querySelector('#result-replica-select').addEventListener('change', (event) => {
  runChemistUiAction('calculation.selectReplica', { index:Number(event.target.value) }).catch(() => {});
});
document.querySelector('#result-conformer-select').addEventListener('change', (event) => {
  const replica = Number(event.target.value);
  const rank = activeConformerPlotOrder(state.conformerAnalysis).indexOf(replica);
  runChemistUiAction('calculation.selectConformer', { rank }).catch(() => {});
});
function runConformerViewUiAction() {
  return runChemistUiAction('calculation.setConformerView', {
    x:document.querySelector('#result-conformer-cv').value,
    y:document.querySelector('#result-conformer-y').value,
    sort:document.querySelector('#result-conformer-sort').value,
    filter:document.querySelector('#result-conformer-filter').value,
  });
}
document.querySelector('#result-conformer-cv').addEventListener('change', () => {
  runConformerViewUiAction().catch(() => {});
});
document.querySelector('#result-conformer-y').addEventListener('change', () => {
  runConformerViewUiAction().catch(() => {});
});
document.querySelector('#result-conformer-sort').addEventListener('change', () => {
  runConformerViewUiAction().catch(() => {});
});
document.querySelector('#result-conformer-filter').addEventListener('change', () => {
  runConformerViewUiAction().catch(() => {});
});
document.querySelector('#result-conformer-best').addEventListener('click', () => {
  runChemistUiAction('calculation.selectConformer', { rank:0 }).catch(() => {});
});
document.querySelector('#result-conformer-previous').addEventListener('click', () => {
  const current = activeConformerPlotOrder(state.conformerAnalysis)
    .indexOf(state.calculationReplicaIndex);
  runChemistUiAction('calculation.selectConformer', {
    rank:Math.max(0, current - 1),
  }).catch(() => {});
});
document.querySelector('#result-conformer-next').addEventListener('click', () => {
  const order = activeConformerPlotOrder(state.conformerAnalysis);
  const current = order.indexOf(state.calculationReplicaIndex);
  runChemistUiAction('calculation.selectConformer', {
    rank:Math.min(order.length - 1, current + 1),
  }).catch(() => {});
});
document.querySelector('#result-conformer-scatter').addEventListener('keydown', (event) => {
  if (!state.conformerAnalysis) return;
  const order = activeConformerPlotOrder(state.conformerAnalysis);
  const current = order.indexOf(state.calculationReplicaIndex);
  let rank = null;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') rank = Math.max(0, current - 1);
  else if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
    rank = Math.min(order.length - 1, current + 1);
  else if (event.key === 'Home') rank = 0;
  else if (event.key === 'End') rank = order.length - 1;
  if (rank != null) {
    event.preventDefault();
    runChemistUiAction('calculation.selectConformer', { rank }).catch(() => {});
  }
});
document.querySelector('#export-conformer-sdf').addEventListener('click', exportClusteredConformers);
document.querySelector('#result-replica-mosaic').addEventListener('click', (event) => {
  const layout = state.replicaMosaicLayout;
  if (!layout || !state.calculationEnsemble) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  const column = Math.floor(x / (layout.cell + layout.gap));
  const row = Math.floor(y / (layout.cell + layout.gap));
  if (column < 0 || column >= layout.columns || row < 0 || row >= layout.rows
    || x - column * (layout.cell + layout.gap) > layout.cell
    || y - row * (layout.cell + layout.gap) > layout.cell) return;
  const replica = row * layout.columns + column;
  if (replica < state.calculationEnsemble.replicaCount)
    runChemistUiAction('calculation.selectReplica', { index:replica }).catch(() => {});
});
document.querySelector('#result-replica-mosaic').addEventListener('keydown', (event) => {
  const count = state.calculationEnsemble?.replicaCount;
  if (!count) return;
  const columns = state.replicaMosaicLayout?.columns || 1;
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
  let next = state.calculationReplicaIndex;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = count - 1;
  else if (event.key in moves) next += moves[event.key];
  else return;
  event.preventDefault();
  runChemistUiAction('calculation.selectReplica', {
    index:Math.max(0, Math.min(count - 1, next)),
  }).catch(() => {});
});
document.querySelector('#fragment-search').addEventListener('input', (event) => renderFragmentLibrary(event.target.value));
document.querySelector('#stage-custom-fragment').addEventListener('click', () => {
  const smiles = document.querySelector('#custom-fragment-smiles').value.trim();
  if (!smiles) return showNotice('Enter a custom fragment SMILES first.');
  runChemistUiAction('fragment.stage', {
    smiles, name:'Custom fragment', attachmentIndex:0,
  }).catch(() => {});
});

async function attachStagedFragmentFromViewer(clientX, clientY) {
  const targetHit = hitTest(clientX, clientY);
  const positionAngstrom = screenToMolecule(clientX, clientY);
  let targetIndex = targetHit?.index ?? null;
  if (targetIndex != null && state.molecule?.atoms[targetIndex]?.element === 'H') {
    const bond = state.molecule.bonds.find((entry) =>
      entry.a === targetIndex || entry.b === targetIndex);
    targetIndex = bond ? (bond.a === targetIndex ? bond.b : bond.a) : null;
  }
  let attachedToAtomId = null;
  if (targetIndex != null) {
    await ensureChemistActionAtomIds();
    attachedToAtomId = state.molecule.atoms[targetIndex]?.designAtomId || null;
  }
  return runChemistUiAction('fragment.attach', {
    ...(attachedToAtomId ? { attachedToAtomId } : {}), positionAngstrom,
  });
}

async function addElementFromViewerThroughAction(clientX, clientY) {
  const targetIndex = elementAttachmentTarget(clientX, clientY);
  // A click on genuinely empty space has no persistent target identity yet, so
  // the public action records its absolute molecular-space placement instead.
  if (targetIndex == null) return runChemistUiAction('chemistry.addAtom', {
    element:state.selectedElement, positionAngstrom:screenToMolecule(clientX, clientY),
  });
  await ensureChemistActionAtomIds();
  if (state.selectedElement === 'H') {
    return runChemistUiAction('chemistry.addHydrogen', {
      atomId:state.molecule.atoms[targetIndex].designAtomId,
    });
  }
  return runChemistUiAction('chemistry.addAtom', {
    attachedToAtomId:state.molecule.atoms[targetIndex].designAtomId,
    element:state.selectedElement,
  });
}

async function selectViewerAtomThroughChemistAction(index) {
  if (state.dockingContactDraft) return selectGeometryAtom(index);
  await ensureChemistActionAtomIds();
  const existing = state.selectedAtoms.indexOf(index);
  const next = existing >= 0 ? state.selectedAtoms.slice(0, existing)
    : [...state.selectedAtoms, index];
  if (!next.length) return runChemistUiAction('selection.clear');
  return runChemistUiAction('selection.replace', {
    atomIds:next.map((atomIndex) => state.molecule.atoms[atomIndex].designAtomId),
  });
}

canvas.addEventListener('pointerdown', (event) => {
  if (state.mode === 'build') {
    if (state.minimizing) return;
    const panInput = event.button === 2 || (event.button === 0 && (event.ctrlKey || event.metaKey));
    if (event.button !== 0 && !panInput) return;
    const hit = hitTest(event.clientX, event.clientY);
    if (state.buildTool === 'manipulate' && hit && !panInput) {
      state.selectedAtom = hit.index; draw(); state.dragAtom = hit.index;
      state.dragAtomOrigin = { index:hit.index,
        x:state.molecule.atoms[hit.index].x, y:state.molecule.atoms[hit.index].y,
        z:state.molecule.atoms[hit.index].z };
      state.dragStartPoint = screenToMolecule(event.clientX, event.clientY);
    } else {
      state.pendingBuildAction = !panInput ? { tool:state.buildTool } : null;
      state.panningView = panInput;
      state.arcballStart = panInput ? null : arcballVector(event.clientX, event.clientY);
      state.rotationStart = panInput ? null : { ...state.rotation };
    }
    state.dragging = true;
    state.pointerStart = { x:event.clientX, y:event.clientY };
    state.pointerDragged = false;
    state.pointer = { x:event.clientX, y:event.clientY };
    canvas.classList.add(panInput ? 'panning' : 'dragging');
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    return;
  }
  const panInput = event.button === 2 || (event.button === 0 && (event.ctrlKey || event.metaKey));
  state.dragging = true;
  state.pointerStart = { x:event.clientX, y:event.clientY };
  state.pointerDragged = false;
  state.pointer = { x: event.clientX, y: event.clientY };
  state.panningView = panInput;
  state.arcballStart = panInput ? null : arcballVector(event.clientX, event.clientY);
  state.rotationStart = panInput ? null : { ...state.rotation };
  canvas.classList.add(panInput ? 'panning' : 'dragging');
  try { canvas.setPointerCapture(event.pointerId); } catch {}
});
canvas.addEventListener('pointermove', (event) => {
  const rect = canvas.getBoundingClientRect();
  if (state.dragging) {
    if (state.pointerStart && Math.hypot(event.clientX - state.pointerStart.x,
      event.clientY - state.pointerStart.y) > 5) state.pointerDragged = true;
    if (state.mode === 'build' && state.pendingBuildAction && !state.pointerDragged) {
      state.pointer = { x:event.clientX, y:event.clientY }; return;
    }
    if (state.panningView) {
      state.viewPan.x += event.clientX - state.pointer.x;
      state.viewPan.y += event.clientY - state.pointer.y;
    } else if (state.dragAtom != null && state.molecule?.atoms[state.dragAtom]) {
      const point = screenToMolecule(event.clientX, event.clientY);
      const atom = state.molecule.atoms[state.dragAtom];
      atom.x += point.x - state.dragStartPoint.x; atom.y += point.y - state.dragStartPoint.y; atom.z += point.z - state.dragStartPoint.z;
      state.dragStartPoint = point;
      updateStoredBondDistances(); updateGeometryControl();
    } else if (state.arcballStart && state.rotationStart) {
      const current = arcballVector(event.clientX, event.clientY);
      const delta = quaternionFromUnitVectors(state.arcballStart, current);
      state.rotation = normaliseQuaternion(multiplyQuaternions(delta, state.rotationStart));
    } else {
      state.pointer = { x: event.clientX, y: event.clientY };
    }
    state.pointer = { x: event.clientX, y: event.clientY }; draw(); return;
  }
  const mx = event.clientX - rect.left, my = event.clientY - rect.top;
  const hit = [...(state.projected || [])].reverse().find((atom) => Math.hypot(mx - atom.sx, my - atom.sy) <= (atom.screenRadius || 8));
  state.hoverAtom = hit?.index ?? null; const tooltip = document.querySelector('#atom-tooltip');
  if (hit) {
    const atom = state.molecule?.atoms?.[hit.index];
    const residue = residueKey(atom)
      ? ` · click to follow ${atom.residueName} ${atom.chain || 'A'}${atom.residueIndex}${atom.insertionCode || ''}` : '';
    const formalCharge = atomFormalCharge(state.molecule.atoms[hit.index]);
    const charge = formalCharge ? ` · formal charge ${formalCharge > 0 ? '+' : ''}${formalCharge}` : '';
    tooltip.textContent = `${ELEMENTS[hit.element].name} · atom ${hit.index + 1}${charge}${residue}`;
    tooltip.style.left = `${mx}px`; tooltip.style.top = `${my}px`; tooltip.classList.remove('hidden');
  }
  else tooltip.classList.add('hidden');
  draw();
});
canvas.addEventListener('pointerup', (event) => {
  const pendingBuildAction = state.pendingBuildAction;
  const pointerDragged = state.pointerDragged;
  const dragOrigin = state.dragAtomOrigin;
  const draggedAtom = state.dragAtom != null ? state.molecule?.atoms[state.dragAtom] : null;
  const cameraGesture = pointerDragged && !draggedAtom
    && (state.panningView || Boolean(state.arcballStart));
  const finalCamera = cameraGesture ? { rotation:{ ...state.rotation },
    pan:{ ...state.viewPan }, zoom:state.zoom } : null;
  if (draggedAtom && dragOrigin) {
    const deltaAngstrom = { x:draggedAtom.x - dragOrigin.x,
      y:draggedAtom.y - dragOrigin.y, z:draggedAtom.z - dragOrigin.z };
    draggedAtom.x = dragOrigin.x; draggedAtom.y = dragOrigin.y; draggedAtom.z = dragOrigin.z;
    updateStoredBondDistances(); updateInfo(); updateGeometryControl(); draw();
    ensureChemistActionAtomIds().then(() => runChemistUiAction('geometry.translateAtoms', {
      atomIds:[state.molecule.atoms[dragOrigin.index].designAtomId], deltaAngstrom,
    })).catch(() => {});
  }
  state.dragging = false; state.dragAtom = null; state.panningView = false;
  state.dragAtomOrigin = null;
  state.arcballStart = null; state.rotationStart = null; canvas.classList.remove('dragging', 'panning');
  if (state.mode === 'build' && pendingBuildAction && event.button === 0
    && !event.ctrlKey && !event.metaKey && !pointerDragged) {
    const hit = hitTest(event.clientX, event.clientY);
    if (pendingBuildAction.tool === 'add') {
      const buildAction = state.stagedFragment
        ? attachStagedFragmentFromViewer(event.clientX, event.clientY)
        : addElementFromViewerThroughAction(event.clientX, event.clientY);
      buildAction.catch((error) => showNotice(error.message));
    } else if (pendingBuildAction.tool === 'select') {
      if (hit) selectViewerAtomThroughChemistAction(hit.index).catch(() => {});
      else runChemistUiAction('selection.clear').catch(() => {});
    }
  } else if (state.mode !== 'build' && event.button === 0 && !event.ctrlKey && !event.metaKey && !pointerDragged) {
    const hit = hitTest(event.clientX, event.clientY);
    const atom = hit ? state.molecule?.atoms?.[hit.index] : null;
    if (atom && residueKey(atom)) runChemistUiAction('view.focusResidue',
      residueKey(atom) === state.focusedResidueKey ? { clear:true } : {
        chain:String(atom.chain || ''), residueIndex:Number(atom.residueIndex),
        insertionCode:String(atom.insertionCode || ''),
      }).catch(() => {});
    else if (!hit && state.focusedResidueKey)
      runChemistUiAction('view.focusResidue', { clear:true }).catch(() => {});
  }
  if (finalCamera) runChemistUiAction('view.setCamera', finalCamera).catch(() => {});
  state.pendingBuildAction = null; state.pointerStart = null; state.pointerDragged = false;
});
canvas.addEventListener('pointercancel', () => {
  if (state.dragAtomOrigin && state.molecule?.atoms[state.dragAtomOrigin.index]) {
    Object.assign(state.molecule.atoms[state.dragAtomOrigin.index], {
      x:state.dragAtomOrigin.x, y:state.dragAtomOrigin.y, z:state.dragAtomOrigin.z,
    });
    updateStoredBondDistances(); updateInfo(); updateGeometryControl(); draw();
  }
  state.dragging = false; state.dragAtom = null; state.panningView = false;
  state.dragAtomOrigin = null;
  state.arcballStart = null; state.rotationStart = null;
  state.pendingBuildAction = null; state.pointerStart = null; state.pointerDragged = false; canvas.classList.remove('dragging', 'panning');
});
canvas.addEventListener('pointerleave', () => { if (!state.dragging) { state.hoverAtom = null; document.querySelector('#atom-tooltip').classList.add('hidden'); draw(); } });
canvas.addEventListener('contextmenu', (event) => { event.preventDefault(); });
let cameraWheelAuditTimer = null;
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  state.zoom = Math.max(.45, Math.min(2.6, state.zoom * Math.exp(-event.deltaY * .001)));
  draw(); clearTimeout(cameraWheelAuditTimer);
  cameraWheelAuditTimer = setTimeout(() => {
    runChemistUiAction('view.setCamera', { zoom:state.zoom }).catch(() => {});
  }, 160);
}, { passive: false });

document.querySelector('#export-button').addEventListener('click', exportXYZ);
function clearScene({ announce = false } = {}) {
  clearCalculationResult(); state.lastCalculation = null;
  state.molecule = null; state.selectedAtom = null; state.selectedAtoms = [];
  state.chemistryTransaction = null; state.chemistryEditPolicy = 'staged';
  state.chemistryEditFinishing = false;
  state.ligandProtonation = null; state.protonatingLigand = false; state.ligandProtonationSequence++;
  state.designRoute = null; state.designRouteStepId = null;
  state.chemistActionAudit = [];
  state.buildHistory = []; state.redoHistory = [];
  state.focusedComponentId = null; state.focusedComponentCenter = null;
  state.focusedComponentRadius = null;
  clearFocusedAtomRegion();
  state.dockingReference = null; state.dockingResult = null; state.dockingRunning = false;
  state.dockingSelectedHbondIds = new Set(); state.dockingPoseIndex = 0;
  state.dockingContactRemaps = new Map(); state.dockingContactRemapProposals = new Map();
  state.dockingContactDraft = null;
  state.focusedResidueKey = null; state.focusedResidueRadius = null; updateResidueFollowChip();
  state.displayColorTheme = 'standard'; state.changeMarkerStyle = 'rings';
  state.showStericClashes = false; state.visibleStericClashCount = 0;
  document.querySelector('#display-theme-select').value = state.displayColorTheme;
  document.querySelector('#change-marker-select').value = state.changeMarkerStyle;
  document.querySelector('#steric-clash-toggle').checked = false;
  document.querySelector('#chemistry-immediate-refine').checked = false;
  updateStericClashDisplayLabel(0);
  state.viewProjectionCenter = null; state.viewProjectionRadius = null; state.projection = null;
  state.structureComponents = []; state.atomComponentIds = [];
  state.componentVisibility = new Map(); state.pdbPreparationPreview = null;
  updateGeometryControl(); ctx.clearRect(0,0,canvas.width,canvas.height); document.querySelector('#viewer-hint').classList.add('visible');
  document.querySelector('#display-options').classList.add('hidden'); document.querySelector('#molecule-info').classList.add('hidden'); document.querySelector('.scene-card').classList.add('hidden');
  document.querySelector('#structure-components').classList.add('hidden'); document.querySelector('#preparation-inspector').classList.add('hidden');
  document.querySelector('#ligand-protonation').classList.add('hidden');
  state.depictionSequence += 1; state.depictionKey = null; state.depictionGlobalAtomIndices = [];
  state.depictionGlobalBondPairs = []; state.depictionAtomObjects = []; state.depictionComponentId = null;
  state.depictionPinnedLigand = null;
  state.depictionOrientationAnchor = null; state.depictionTemplateMolBlock = null;
  state.depictionBondStart = null;
  const depictionPanel = document.querySelector('#structure-2d-panel');
  depictionPanel.classList.add('hidden'); delete depictionPanel.dataset.pending;
  delete depictionPanel.dataset.error;
  document.querySelector('#structure-2d-drawing').replaceChildren();
  if (announce) showToast('Scene cleared');
  updateHistoryButtons(); updateOptimizerControls(); draw();
}

document.querySelector('#clear-button').addEventListener('click', () => {
  runChemistUiAction('session.clear').then(() => showToast('Scene cleared')).catch(() => {});
});
document.querySelector('#share-button').addEventListener('click', async () => {
  try {
    const result = await runChemistUiAction('session.share', {}, { reportError:false });
    try { await navigator.clipboard.writeText(result.share.url); showToast('Share link copied'); }
    catch { showToast(`Share link ready · ${result.share.url}`); }
  } catch (error) { showNotice(error.message); }
});
document.querySelector('#copy-smiles').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(state.molecule?.smiles || ''); showToast('SMILES copied'); } catch { showToast('SMILES ready to copy'); }
});
document.querySelector('#save-button').addEventListener('click', () => { const link = document.createElement('a'); link.download = `${slug(state.molecule?.name || 'molecule')}.png`; link.href = canvas.toDataURL('image/png'); link.click(); showToast('Image saved'); });
document.querySelector('#fullscreen-button').addEventListener('click', () => { const viewer = document.querySelector('#viewer-container'); if (!document.fullscreenElement) viewer.requestFullscreen?.(); else document.exitFullscreen?.(); });
function currentCalculationUiOptions() {
  return {
    steps:Number(document.querySelector('#simulation-step-count').value),
    savedFrameCount:Number(document.querySelector('#trajectory-frame-count').value),
    implicitSolvent:document.querySelector('#solvent-select').value,
    constraintMode:document.querySelector('#constraint-select').value,
    stormmSystem:document.querySelector('#stormm-system').value,
    replicaCount:Number(document.querySelector('#stormm-replica-count').value),
    conformerCount:Number(document.querySelector('#conformer-count').value),
    conformerEffort:document.querySelector('#conformer-effort').value,
    conformerClusterRms:Number(document.querySelector('#conformer-cluster-rms').value),
    conformerArena:document.querySelector('#conformer-arena').checked,
  };
}
document.querySelector('#run-calculation').addEventListener('click', () => {
  runChemistUiAction('calculation.run', {
    job:document.querySelector('#job-select').value,
    method:document.querySelector('#method-select').value,
    options:currentCalculationUiOptions(),
  }).catch(() => {});
});
document.querySelector('#menu-button').addEventListener('click', (event) => {
  const nav = document.querySelector('.app-header-links');
  const open = nav.classList.toggle('mobile-open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('.app-header-links a').forEach((link) => link.addEventListener('click', () => {
  document.querySelector('.app-header-links').classList.remove('mobile-open');
  document.querySelector('#menu-button').setAttribute('aria-expanded', 'false');
}));
const projectInfoDialog = document.querySelector('#project-info-dialog');
const projectInfoTitle = document.querySelector('#project-info-title');
let validationDashboardPromise = null;
function ensureValidationDashboard() {
  const root = document.querySelector('#validation-dashboard');
  if (!root || root.dataset.validationMounted === 'true') return;
  validationDashboardPromise ||= import('./validation/dashboard.mjs')
    .then(module => module.mountValidationDashboard(root))
    .catch(error => {
      root.innerHTML = `<p class="validation-dashboard-error">Validation ledger unavailable · ${String(error.message || error)}</p>`;
    });
}
function openProjectInfoPanel(panel) {
  document.querySelectorAll('[data-project-section]').forEach((section) => {
    section.classList.toggle('hidden', section.dataset.projectSection !== panel);
  });
  projectInfoDialog.classList.toggle('validation-open', panel === 'validation');
  projectInfoTitle.textContent = panel[0].toUpperCase() + panel.slice(1);
  if (panel === 'validation') ensureValidationDashboard();
  if (!projectInfoDialog.open) projectInfoDialog.showModal();
}
document.querySelectorAll('[data-project-panel]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  runChemistUiAction('interface.openProjectInfo', {
    panel:event.currentTarget.dataset.projectPanel,
  }).catch(() => {});
}));
document.querySelector('#network-policy-button').addEventListener('click', () => {
  runChemistUiAction('interface.openProjectInfo', { panel:'privacy' }).catch(() => {});
});
document.querySelector('#verify-local-build').addEventListener('click', verifyLoadedBuild);
document.querySelector('#campaign-create').addEventListener('click', async () => {
  const titleInput = document.querySelector('#campaign-title');
  const idInput = document.querySelector('#campaign-id');
  const title = titleInput.value.trim() || `${state.molecule?.name || 'Molecule'} design campaign`;
  const campaignId = idInput.value.trim() || `${slug(title)}-${Date.now().toString(36)}`;
  const result = await runCampaignUiAction('campaign.create', { campaignId, title,
    initialCommitMessage:`Start ${title}` },
  () => 'Current molecule committed as the start of a local campaign.');
  if (result) { titleInput.value = ''; idInput.value = ''; }
});
document.querySelector('#campaign-commit').addEventListener('click', async () => {
  const input = document.querySelector('#campaign-commit-message');
  const message = input.value.trim();
  const result = await runCampaignUiAction('campaign.commitCurrent', { message },
    (value) => `Committed ${String(value.campaignCommit?.commitId || '').slice(0, 15)}… on ${state.liveCampaignBranch}.`);
  if (result) input.value = '';
});
document.querySelector('#campaign-create-branch').addEventListener('click', async () => {
  const input = document.querySelector('#campaign-new-branch');
  const branch = input.value.trim();
  const result = await runCampaignUiAction('campaign.createBranch', { branch },
    () => `Created and switched to ${branch}.`);
  if (result) input.value = '';
});
document.querySelector('#campaign-branch').addEventListener('change', async (event) => {
  const branch = event.currentTarget.value;
  if (!state.liveCampaign || !Object.hasOwn(state.liveCampaign.branches || {}, branch)) return;
  await runCampaignUiAction('campaign.switchBranch', { branch }, (value) =>
    value.campaignBranch?.restored
      ? `Switched to ${branch} and restored its committed molecule.`
      : `Switched the working history to ${branch}.`);
});
document.querySelector('#campaign-merge').addEventListener('click', () => {
  const sourceBranch = document.querySelector('#campaign-merge-source').value;
  return runCampaignUiAction('campaign.mergeBranch', {
    sourceBranch, targetBranch:state.liveCampaignBranch,
    message:`Merge ${sourceBranch} into ${state.liveCampaignBranch}`,
  }, () => `Merged ${sourceBranch} into ${state.liveCampaignBranch}.`);
});
document.querySelector('#campaign-record-decision').addEventListener('click', async () => {
  const disposition = document.querySelector('#campaign-decision-disposition').value;
  const rationaleInput = document.querySelector('#campaign-decision-rationale');
  const rationale = rationaleInput.value.trim();
  const result = await runCampaignUiAction('campaign.recordDecision', { disposition, rationale },
    () => `Recorded a ${disposition.replace('-', ' ')} decision.`);
  if (result) rationaleInput.value = '';
});
document.querySelector('#campaign-verify').addEventListener('click', () =>
  runCampaignUiAction('campaign.verify', {}, (value) => {
    const verification = value.campaignVerification;
    return verification.valid
      ? `Verified ${verification.commits} commits and ${verification.events} chained events.`
      : `Verification failed: ${verification.reason}`;
  }));
document.querySelector('#campaign-close').addEventListener('click', () =>
  runCampaignUiAction('campaign.close', {}, () =>
    'Campaign closed; its commits remain stored locally.'));
document.querySelector('#campaign-export').addEventListener('click', async () => {
  if (!state.liveCampaign) return;
  try {
    const result = await runChemistUiAction('campaign.export', {}, { reportError:false });
    const exported = result.campaignExport;
    downloadBlob(exported.serialized, `${slug(exported.campaignId)}.campaign.json`, 'application/json');
    updateLiveCampaignUi('Canonical campaign JSON exported.', 'success');
  } catch (error) { updateLiveCampaignUi(error.message, 'failure'); showNotice(error.message); }
});
document.querySelector('#campaign-import').addEventListener('click', () =>
  document.querySelector('#campaign-file').click());
document.querySelector('#designer-story-import').addEventListener('click', () =>
  document.querySelector('#designer-move-file').click());
document.querySelector('#campaign-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  liveCampaignUiBusy = true; updateLiveCampaignUi('Importing campaign…');
  let finalMessage = '', finalStatus = '';
  try {
    const result = await runChemistUiAction('campaign.import', {
      serialized:await file.text(),
    }, { reportError:false });
    finalMessage = `Imported ${result.campaignImport.title} and saved it locally.`;
    finalStatus = 'success';
  } catch (error) {
    finalMessage = error.message; finalStatus = 'failure'; showNotice(error.message);
  } finally {
    liveCampaignUiBusy = false; updateLiveCampaignUi(finalMessage, finalStatus);
  }
});
document.querySelector('#close-project-info').addEventListener('click', () => {
  runChemistUiAction('interface.openProjectInfo', { panel:'closed' }).catch(() => {});
});
projectInfoDialog.addEventListener('click', (event) => {
  if (event.target === projectInfoDialog)
    runChemistUiAction('interface.openProjectInfo', { panel:'closed' }).catch(() => {});
});
window.addEventListener('resize', () => { draw(); drawReplicaMosaic(); drawConformerScatter(); });

function animate(time) {
  const delta = Math.min(50, time - state.lastFrame); state.lastFrame = time;
  if (state.playing && state.molecule) {
    const axis = state.autoRotate === 'diagonal' ? { x: 0.45, y: 1, z: 0.18 } : { x: 0, y: 1, z: 0 };
    state.rotation = normaliseQuaternion(multiplyQuaternions(
      quaternionFromAxisAngle(axis, delta * (state.autoRotate === 'diagonal' ? 0.00035 : 0.00045)),
      state.rotation,
    ));
    draw();
  }
  state.raf = requestAnimationFrame(animate);
}

async function loadLaunchMolecule() {
  try {
    const response = await fetch('./assets/lsd-launch.mol');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const molecule = parseMolBlock(await response.text(), {
      name:'LSD', smiles:LSD_SMILES, canonicalSmiles:LSD_SMILES,
      source:{ source:'PubChem CID 5761 3D conformer', pubchemCid:5761 },
    });
    if (!state.molecule) {
      loadMolecule(molecule);
      enumerateLigandProtonation(LSD_SMILES).catch(() => {});
    }
  } catch {
    if (!state.molecule) loadMolecule(parseXYZ(DEFAULT_XYZ, {
      name:'Molecular system', smiles:'Two-component molecular complex',
    }));
  }
}

const DESIGNER_STORY_LINKS = Object.freeze({
});

async function loadRegisteredDesignerScript(storyId) {
  const story = DESIGNER_STORY_LINKS[storyId];
  if (!story) throw new Error(`Unknown Molarium story: ${storyId}`);
  const response = await fetch(story.script, { cache:'no-store' });
  if (!response.ok) throw new Error(`Story JSON could not be loaded (${response.status})`);
  const sourceBytes = await response.arrayBuffer();
  const sourceFileSha256 = await sha256Hex(sourceBytes);
  if (sourceFileSha256 !== story.sourceSha256)
    throw new Error('Story JSON integrity check failed');
  const sourceScript = JSON.parse(new TextDecoder().decode(sourceBytes));
  const replayModule = await import('./design-history/replay.mjs');
  replayModule.validateActionScript(sourceScript);
  const sourceActionScriptSha256 = await replayModule.actionScriptSha256(sourceScript);
  const installedScript = story.presentation === 'chemist-pocket'
    ? (await import('./design-history/interface-story.mjs'))
      .buildPocketInterfaceStory(sourceScript, {
        sourcePath:story.sourcePath, sourceSha256:story.sourceSha256,
      })
    : sourceScript;
  const installedActionScriptSha256 = await replayModule.actionScriptSha256(installedScript);
  await installDesignerMoveScript(installedScript);
  if (!setMode('build')) throw new Error('Molarium could not enter Design mode');
  state.designerMoveRegisteredStory = { storyId, title:story.title,
    sourcePath:story.sourcePath, sourceFileSha256, sourceActionScriptSha256,
    installedActionScriptSha256, presentation:story.presentation || null };
  document.title = `${story.title} · Molarium`;
  updateDesignerMoveControls(`${story.title} is ready on a blank canvas. Press Play story to begin.`);
  return { storyId, title:story.title,
    source:{ path:story.sourcePath, fileSha256:sourceFileSha256,
      actionScriptSha256:sourceActionScriptSha256,
      actionCount:sourceScript.actions.length },
    installed:{ actionScriptSha256:installedActionScriptSha256,
      actionCount:installedScript.actions.length,
      presentation:story.presentation || null } };
}

async function initializeWorkspaceFromUrl() {
  const parameters = new URLSearchParams(window.location.search);
  const storyId = parameters.get('story');
  if (!storyId && parameters.has('blank')) {
    const api = await window.MolariumChemistActionsReady;
    await api.execute({ requestId:'url-blank-session', action:'session.clear', args:{} });
    return;
  }
  if (!storyId) return loadLaunchMolecule();
  try {
    const api = await window.MolariumChemistActionsReady;
    await api.execute({ requestId:`story-link-${storyId}-load-registered`,
      action:'designerScript.loadRegistered', args:{ storyId } });
  } catch (error) {
    updateDesignerMoveControls(`Could not load ${DESIGNER_STORY_LINKS[storyId]?.title || storyId}`);
    showNotice(error.message);
  }
}

initializeNetworkPolicyUi();
window.MolariumChemistActionsReady = import('./chemist-actions.mjs')
  .then((module) => installChemistActionsApi(module));
initializeWorkspaceFromUrl();
renderFragmentLibrary();
updateHistoryButtons();
updateOptimizerControls();
requestAnimationFrame(animate);
