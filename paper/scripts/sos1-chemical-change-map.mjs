// Reading-only, aromaticity-normalized review of the immutable SOS1 graphs.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const outputPath = new URL('paper/review/sos1-chemical-change-map.json', root);

// These are a structural correspondence for illustration, NOT atom lineage or
// a proposed reaction mechanism. Anchor the fused core to retained C1/C2 and
// match each methoxy branch by connectivity. No 3D fitting enters the map.
const reviewedPairs = {
  'aww-graph': [
    ['C4','CX10'], ['C9','CX8'], ['O13','OX2'], ['C17','CX9'],
    ['C10','CX7'], ['O14','OX1'], ['C18','CX6'], ['C5','CX17'],
  ],
  'finish-bay-293': [
    ['CX10','CX18'], ['CX8','CX16'], ['OX2','OX2'], ['CX9','CX17'],
    ['CX7','CX14'], ['OX1','OX1'], ['CX6','CX15'], ['CX17','CX13'],
    // Preserve the ortho-substituted benzyl ring and CH2; the thiophene
    // attachment migrates CX4 -> CX3 and alcohol OX3 is replaced by NX1.
    ['CX5','CX12'], ['CX11','CX11'], ['CX12','CX10'], ['CX13','CX9'],
    ['CX14','CX8'], ['CX15','CX7'], ['CX16','CX6'], ['OX3','NX1'],
  ],
};

export function normalizeRdkitJson(json) {
  const doc = typeof json === 'string' ? JSON.parse(json) : json;
  const mol = doc.molecules[0];
  const ext = mol.extensions.find(x => x.name === 'rdkitRepresentation');
  const aromaticAtoms = new Set(ext.aromaticAtoms || []);
  const aromaticBonds = new Set(ext.aromaticBonds || []);
  const cip = new Map(ext.cipCodes || []);
  return {
    atoms: mol.atoms.map((atom, i) => {
      const a = {...doc.defaults.atom, ...atom};
      return {element:a.z, charge:a.chg, hydrogens:a.impHs,
        isotope:a.isotope, radical:a.nRad, aromatic:aromaticAtoms.has(i),
        cip:cip.get(i) || null};
    }),
    bonds: mol.bonds.map((bond, i) => ({atoms:bond.atoms,
      order:aromaticBonds.has(i) ? 'aromatic' : (bond.bo ?? doc.defaults.bond.bo)})),
  };
}

export function compareGraphs(previous, current, pairs) {
  const correspondence = new Map(pairs);
  assert.equal(new Set(correspondence.values()).size, correspondence.size, 'injective mapping');
  const changed = new Set();
  const reasons = new Map();
  const mark = (i, reason) => { changed.add(i); reasons.set(i, [...(reasons.get(i)||[]), reason]); };
  const mappedTargets = new Set(correspondence.values());
  current.atoms.forEach((a,i) => { if (!mappedTargets.has(i)) mark(i,'added or replacement atom'); });
  for (const [i,j] of pairs) {
    if (JSON.stringify(previous.atoms[i]) !== JSON.stringify(current.atoms[j]))
      mark(j,'normalized atom properties changed (element, H count, aromaticity, charge, isotope or CIP)');
  }
  const key = (a,b) => [a,b].sort((x,y)=>x-y).join(':');
  const currentBonds = new Map(current.bonds.map(b=>[key(...b.atoms),b]));
  const retained = new Set();
  for (const bond of previous.bonds) {
    const [a,b] = bond.atoms.map(i=>correspondence.get(i));
    if (a === undefined || b === undefined) {
      if (a !== undefined) mark(a,'bond to removed atom');
      if (b !== undefined) mark(b,'bond to removed atom');
      continue;
    }
    const k = key(a,b), next = currentBonds.get(k);
    retained.add(k);
    if (!next || next.order !== bond.order) {
      mark(a, next ? 'normalized bond order changed' : 'bond removed');
      mark(b, next ? 'normalized bond order changed' : 'bond removed');
    }
  }
  for (const bond of current.bonds) if (!retained.has(key(...bond.atoms)))
    for (const i of bond.atoms) mark(i,'bond added');
  return {changed:[...changed].sort((a,b)=>a-b), reasons};
}

export async function buildChemicalChangeMap() {
  const require = createRequire(import.meta.url);
  const module = await require(new URL('rdkit/dist/RDKit_minimal.js',root).pathname)({
    locateFile:f=>new URL('rdkit/dist/'+f,root).pathname});
  const context = vm.createContext({self:{importScripts(){},addEventListener(){}}, URL, console});
  vm.runInContext(readFileSync(new URL('rdkit-worker.js',root),'utf8'),context);
  const releaseBytes = readFileSync(new URL('design-history/publications/sos1/designer-intent-2026-09-04/release.json',root));
  const release = JSON.parse(releaseBytes);
  const states = [];
  let previous, active;
  for (const entry of release.checkpoints) {
    const bytes = readFileSync(new URL(entry.path,root));
    assert.equal(sha(bytes),entry.sha256);
    const decoded = entry.encoding ? gunzipSync(bytes) : bytes;
    assert.equal(sha(decoded),entry.canonicalSha256);
    const campaign = JSON.parse(decoded), snapshot = campaign.objects.snapshots[entry.snapshotId];
    assert.equal(campaign.objects.commits[entry.commitId].snapshotId,entry.snapshotId);
    const ligand = snapshot.graph.atoms.filter(a=>a.record==='HETATM' && ['AXE','AWT','AWZ','AWW','AXH'].includes(a.residueName));
    const atoms = [...ligand.filter(a=>a.element!=='H'),...ligand.filter(a=>a.element==='H')];
    const indices = new Map(atoms.map((a,i)=>[a.atomId,i]));
    const coords = new Map(snapshot.coordinates.atomIds.map((id,i)=>[id,snapshot.coordinates.positions[i]]));
    const input = {atoms:atoms.map(a=>({element:a.element,charge:a.formalCharge||0,
      x:coords.get(a.atomId)[0],y:coords.get(a.atomId)[1],z:coords.get(a.atomId)[2]})),
      bonds:snapshot.graph.bonds.filter(b=>b.atomIds.every(id=>indices.has(id)))
        .map(b=>({a:indices.get(b.atomIds[0]),b:indices.get(b.atomIds[1]),order:b.order}))};
    const full = module.get_mol(context.moleculeToMolBlock(input),JSON.stringify({sanitize:true,removeHs:false}));
    assert.ok(full,entry.id+' full-H sanitization');
    const mol = module.get_mol(full.remove_hs(),JSON.stringify({sanitize:true,removeHs:false}));
    full.delete(); assert.ok(mol);
    const graph = normalizeRdkitJson(mol.get_json()), smiles=mol.get_smiles(); mol.delete();
    const heavy = atoms.filter(a=>a.element!=='H');
    assert.equal(graph.atoms.length,heavy.length);
    const current = {heavy,graph,smiles,stage:entry.id};
    const sameGraph = previous?.smiles === smiles;
    let pairs=[], comparison={changed:[],reasons:new Map()};
    if (previous && !sameGraph) {
      pairs = previous.heavy.flatMap((a,i)=> {
        const j=heavy.findIndex(b=>b.atomId===a.atomId); return j<0 ? [] : [[i,j]];
      });
      for (const [from,to] of reviewedPairs[entry.id] || []) {
        const i=previous.heavy.findIndex(a=>a.atomName===from), j=heavy.findIndex(a=>a.atomName===to);
        assert.ok(i>=0 && j>=0,entry.id+' explicit name pair '+from+' -> '+to);
        assert.ok(!pairs.some(([pi,pj])=>pi===i||pj===j),'review pair does not conflict with lineage');
        pairs.push([i,j]);
      }
      comparison=compareGraphs(previous.graph,graph,pairs);
      active=comparison.changed.map(i=>heavy[i].atomId);
    }
    active ||= [];
    const highlightedAtomIds=entry.id==='aww-phe890-response'?[]:active.slice();
    const highlightedAtomNames=heavy.filter(a=>highlightedAtomIds.includes(a.atomId)).map(a=>a.atomName);
    states.push({stage:entry.id,checkpointSha256:entry.sha256,snapshotId:entry.snapshotId,
      canonicalSmiles:smiles,highlightedAtomIds,highlightedAtomNames,
      comparisonStage:previous?.stage||null,
      correspondence:pairs.map(([i,j])=>({previousName:previous.heavy[i].atomName,
        currentName:heavy[j].atomName,previousAtomId:previous.heavy[i].atomId,currentAtomId:heavy[j].atomId,
        basis:previous.heavy[i].atomId===heavy[j].atomId?'registered lineage':'reviewed structural correspondence'})),
      changes:comparison.changed.map(i=>({atomName:heavy[i].atomName,atomId:heavy[i].atomId,reasons:comparison.reasons.get(i)})),
      rationale:entry.id==='aww-phe890-response'?'Receptor-only response: ligand highlights cleared.':sameGraph?
        'Identical ligand chemistry: retain preceding chemical-edit highlights during pose placement.':
        'Added/replacement atoms and endpoints of true normalized atom/bond changes; equivalent aromatic Kekule assignments and reallocated IDs alone are ignored.'});
    if (!sameGraph) previous=current;
  }
  return {schema:'molarium.sos1-chemical-change-map/v1',
    publicationStatus:'AUTHOR-RETAINED: describe existing PDB-derived frozen graphs; no corrected scientific rerun requested',
    authorDecision:'2026-09-07: author confirmed the PDB discrepancy, retained the existing graph and calculations, and requested removal of the restore-aromaticity description. Initial publication hold superseded; source discrepancy remains documented.',
    scientificDiscrepancy:'AWW in the frozen graph and RCSB CCD is 5,8-dihydro; Hillig et al. 2019 Figure 4B compound 21 has an aromatic quinazoline core. Do not publish this map as the intended design sequence. See SOS1-AWW-SOURCE-GRAPH-DISCREPANCY-2026-09-07.md.',
    rdkitVersion:module.version(),releaseSha256:sha(releaseBytes),
    policy:'Strict full-H sanitization, then H removal and RDKit aromaticity normalization. Retained atom lineage plus explicitly reviewed structural correspondence, not an MCS or synthetic reaction mechanism. Highlight current atoms with changed normalized properties or incident bonds; additions and surviving deletion endpoints are included. Methoxy groups are conserved throughout.',
    immutableInputs:'Only graph and saved coordinates read; no graph edits, optimization or crystal-coordinate substitution.',states};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report=await buildChemicalChangeMap();
  writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report.states.map(s=>({stage:s.stage,atoms:s.highlightedAtomNames})),null,2));
}
