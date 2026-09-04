import assert from 'node:assert/strict';
import { applySidechainRotamer, assertSidechainChiAnglesReproduced,
  assertSidechainRotamerCoordinateGuards,
  enumerateSidechainRotamers, evaluatePostRelaxedLigandPocket,
  measureInspectedSidechainChiAngles, selectSidechainRotamerCandidate,
  selectCoupledSidechainPoseBranch,
  SIDECHAIN_ROTAMER_SCHEMA, uniqueSidechainRotamerCandidates } from './sidechain-rotamers.mjs';

const atom = (atomName, x, y, z, extra = {}) => ({ record:'ATOM', residueName:'PHE',
  chain:'A', residueIndex:890, insertionCode:'', element:'C', atomName, x, y, z, ...extra });
const atoms = [
  atom('N', -1.1, 0, 0, { element:'N' }), atom('CA', 0, 0, 0),
  atom('C', 0, -1.4, 0), atom('O', 0, -2.5, 0, { element:'O' }),
  atom('CB', 1.1, .7, 0), atom('CG', 2.25, 0, .35),
  atom('CD1', 3.35, .68, .45), atom('CE1', 4.48, .06, .78),
  atom('CZ', 4.52, -1.25, 1.02), atom('CE2', 3.43, -1.94, .92),
  atom('CD2', 2.30, -1.32, .59),
  { record:'HETATM', residueName:'LIG', chain:'L', residueIndex:1, atomName:'C1',
    element:'C', x:3.30, y:.70, z:.47 },
];
const bonds = [[0,1],[1,2],[2,3],[1,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,5]]
  .map(([a,b]) => ({ a,b,order:1 }));
const molecule = { atoms:structuredClone(atoms), bonds:structuredClone(bonds) };
const inspectedResidue = (source = molecule.atoms.slice(0, 11)) => source.map((entry) => ({
  atomId:`test:${entry.atomName}`, atomName:entry.atomName, element:entry.element,
  residueName:entry.residueName, chain:entry.chain, residueIndex:entry.residueIndex,
  insertionCode:entry.insertionCode || '', coordinatesAngstrom:[entry.x, entry.y, entry.z],
}));

const ensemble = enumerateSidechainRotamers({ molecule, residueAtomIndex:6,
  ligandAtomIndices:[11], maximumCandidates:32 });
assert.equal(ensemble.schema, SIDECHAIN_ROTAMER_SCHEMA);
assert.equal(ensemble.residue.residueName, 'PHE');
assert.deepEqual(ensemble.axes.map((entry) => entry.chi), ['chi1','chi2']);
assert(ensemble.candidates.length >= 8);
assert(ensemble.candidates.some((entry) => Math.abs(Math.abs(entry.chiDegrees[0]) - 180) < 1));
assert(ensemble.candidates.some((entry) => Math.abs(entry.chiDegrees[1] - 90) < 1));
assert(ensemble.candidates[0].score <= ensemble.candidates.at(-1).score);
assert.deepEqual(measureInspectedSidechainChiAngles({ atoms:inspectedResidue(),
  residue:{ residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'' } }),
ensemble.inputChiDegrees, 'coordinate-bearing inspection reproduces the enumerated input chi angles');
const completeChiBranches = uniqueSidechainRotamerCandidates(ensemble.candidates);
assert.equal(completeChiBranches.length, ensemble.candidates.length,
  'the enumerator already returns unique complete chi-angle branches');
assert(completeChiBranches.some((first, firstIndex) => completeChiBranches.some((second, secondIndex) =>
  firstIndex !== secondIndex
  && Math.abs(first.chiDegrees[0] - second.chiDegrees[0]) < 1
  && Math.abs(first.chiDegrees[1] - second.chiDegrees[1]) > 1)),
'distinct chi2 branches sharing chi1 are retained for coupled search');
assert.deepEqual(uniqueSidechainRotamerCandidates([
  { rank:1, chiDegrees:[180,90] },
  { rank:2, chiDegrees:[-180,450] },
  { rank:3, chiDegrees:[180,-90] },
]), [{ rank:1, chiDegrees:[180,90] }, { rank:3, chiDegrees:[180,-90] }],
'only complete circularly equivalent chi vectors are deduplicated');

const originalBackbone = molecule.atoms.slice(0, 4).map(({ x,y,z }) => [x,y,z]);
const originalLigand = [molecule.atoms[11].x, molecule.atoms[11].y, molecule.atoms[11].z];
const applied = applySidechainRotamer(molecule, ensemble, 0);
assert.equal(applied.rank, 1);
assert.deepEqual(measureInspectedSidechainChiAngles({ atoms:inspectedResidue(),
  residue:{ residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'' } }),
applied.chiDegrees, 'relaxed-coordinate measurement is independent of the seed rotamer label');
assert.deepEqual(molecule.atoms.slice(0, 4).map(({ x,y,z }) => [x,y,z]), originalBackbone);
assert.deepEqual([molecule.atoms[11].x, molecule.atoms[11].y, molecule.atoms[11].z], originalLigand);
assert.throws(() => enumerateSidechainRotamers({ molecule, residueAtomIndex:11 }), /not in a protein/);
assert.throws(() => applySidechainRotamer(molecule, ensemble, 100), /does not exist/);
assert.throws(() => measureInspectedSidechainChiAngles({ atoms:inspectedResidue().filter((entry) =>
  entry.atomName !== 'CD1'), residue:{ residueName:'PHE', chain:'A', residueIndex:890 } }),
/missing CD1/);
assert.throws(() => measureInspectedSidechainChiAngles({ atoms:[...inspectedResidue(),
  inspectedResidue().find((entry) => entry.atomName === 'CG')],
residue:{ residueName:'PHE', chain:'A', residueIndex:890 } }), /multiple CG/);
assert.throws(() => measureInspectedSidechainChiAngles({ atoms:inspectedResidue(),
  residue:{ residueName:'PHE', chain:'A', residueIndex:891 } }), /missing N/);
assert.equal(assertSidechainChiAnglesReproduced([-180, 90], [180, 90]), true,
  'deterministic replay comparison treats the signed 180-degree boundary circularly');
assert.throws(() => assertSidechainChiAnglesReproduced([-60, 180], [-61, 180]),
  /chi1 changed during deterministic replay/);
assert.throws(() => assertSidechainChiAnglesReproduced([-60, 180], [-60]),
  /same number of finite angles/);

const stableSelectionEnsemble = { schema:SIDECHAIN_ROTAMER_SCHEMA,
  inputCoordinateSha256:'1'.repeat(64), axes:[{ chi:'chi1' }, { chi:'chi2' }], candidates:[
    { index:2, rank:1, chiDegrees:[-180, 90], coordinateSha256:'2'.repeat(64) },
    { index:7, rank:2, chiDegrees:[60, -90], coordinateSha256:'3'.repeat(64) },
  ] };
assert.equal(selectSidechainRotamerCandidate(stableSelectionEnsemble,
  { index:7 }).coordinateSha256, '3'.repeat(64));
assert.equal(selectSidechainRotamerCandidate(stableSelectionEnsemble,
  { chiDegrees:[180, 450] }).index, 2,
'chi selection is circularly normalized rather than tied to rank ordering');
assert.equal(selectSidechainRotamerCandidate(stableSelectionEnsemble,
  { coordinateSha256:'2'.repeat(64) }).index, 2);
assert.throws(() => selectSidechainRotamerCandidate(stableSelectionEnsemble, {}),
  /exactly one side-chain rotamer selector/);
assert.throws(() => selectSidechainRotamerCandidate(stableSelectionEnsemble,
  { index:2, chiDegrees:[-180,90] }), /exactly one side-chain rotamer selector/);
assert.throws(() => selectSidechainRotamerCandidate(stableSelectionEnsemble,
  { chiDegrees:[0,0] }), /No side-chain rotamer matches/);
assert.throws(() => selectSidechainRotamerCandidate(stableSelectionEnsemble,
  { coordinateSha256:null }), /lowercase SHA-256/);
assert.throws(() => selectSidechainRotamerCandidate({ ...stableSelectionEnsemble,
  candidates:[...stableSelectionEnsemble.candidates,
    { index:8, rank:3, chiDegrees:[180,90], coordinateSha256:'4'.repeat(64) }] },
{ chiDegrees:[-180,90] }), /ambiguously match/);
const guardedCandidate = stableSelectionEnsemble.candidates[0];
assert.equal(assertSidechainRotamerCoordinateGuards({ ensemble:stableSelectionEnsemble,
  candidate:guardedCandidate, currentCoordinateSha256:'1'.repeat(64),
  expectedInputCoordinateSha256:'1'.repeat(64),
  expectedSelectedCoordinateSha256:'2'.repeat(64) }), true);
assert.throws(() => assertSidechainRotamerCoordinateGuards({
  ensemble:stableSelectionEnsemble, candidate:guardedCandidate,
  currentCoordinateSha256:'5'.repeat(64) }), /coordinates changed/);
assert.throws(() => assertSidechainRotamerCoordinateGuards({
  ensemble:stableSelectionEnsemble, candidate:guardedCandidate,
  currentCoordinateSha256:'1'.repeat(64), expectedInputCoordinateSha256:'5'.repeat(64) }),
/expectedInputCoordinateSha256/);
assert.throws(() => assertSidechainRotamerCoordinateGuards({
  ensemble:stableSelectionEnsemble, candidate:guardedCandidate,
  currentCoordinateSha256:'1'.repeat(64), expectedSelectedCoordinateSha256:'5'.repeat(64) }),
/expectedSelectedCoordinateSha256/);

const alternateAdapterEnsemble = { ...stableSelectionEnsemble,
  inputCoordinateSha256:'6'.repeat(64), candidates:[
    { ...stableSelectionEnsemble.candidates[0], chiDegrees:[180,90],
      coordinateSha256:'7'.repeat(64) },
    stableSelectionEnsemble.candidates[1],
  ] };
const alternateAdapterCandidate = selectSidechainRotamerCandidate(alternateAdapterEnsemble,
  { chiDegrees:[-180,90] });
assert.equal(alternateAdapterCandidate.coordinateSha256, '7'.repeat(64),
'the same physical 180-degree branch survives backend-specific coordinate hashes and angle sign');
assert.equal(assertSidechainRotamerCoordinateGuards({ ensemble:alternateAdapterEnsemble,
  candidate:alternateAdapterCandidate,
  currentCoordinateSha256:alternateAdapterEnsemble.inputCoordinateSha256 }), true,
'same-execution coordinate integrity remains exact on the alternate backend');
assert.throws(() => assertSidechainRotamerCoordinateGuards({
  ensemble:alternateAdapterEnsemble, candidate:alternateAdapterCandidate,
  currentCoordinateSha256:stableSelectionEnsemble.inputCoordinateSha256 }), /coordinates changed/,
'coordinate hashes from different numerical executions cannot be cross-paired');

const separatedGeometry = evaluatePostRelaxedLigandPocket({
  ligandAtoms:[{ atomId:'ligand-c', element:'C', coordinatesAngstrom:[0,0,0] }],
  pocketAtoms:[
    { atomId:'ligand-c', element:'C', coordinatesAngstrom:[0,0,0] },
    { atomId:'receptor-c', element:'C', coordinatesAngstrom:[4,0,0] },
  ],
});
assert.equal(separatedGeometry.feasible, true);
assert.equal(separatedGeometry.severeClashes, 0);
assert.equal(separatedGeometry.ligandHeavyAtomCount, 1);
assert.equal(separatedGeometry.receptorHeavyAtomCount, 1,
  'the ligand copy included in pocket inspection is excluded from receptor scoring');
const clashingGeometry = evaluatePostRelaxedLigandPocket({
  ligandAtoms:[{ atomId:'ligand-c', element:'C', coordinatesAngstrom:[0,0,0] }],
  pocketAtoms:[{ atomId:'receptor-c', element:'C', coordinatesAngstrom:[1,0,0] }],
});
assert.equal(clashingGeometry.feasible, false);
assert.equal(clashingGeometry.severeClashes, 1);
assert(clashingGeometry.score > separatedGeometry.score);

const postRelaxation = (score, feasible = true) => ({
  receptorAware:{ feasible, score },
  topPoseEvidence:{
    schema:'molarium.coordinate-evidence/v1',
    ligand:{ atoms:[{ atomId:'ligand-c', element:'C', coordinatesAngstrom:[0,0,0] }] },
    pocket:{ atoms:[{ atomId:'receptor-c', element:'C', coordinatesAngstrom:[4,0,0] }] },
    ligandCoordinateSha256:'a'.repeat(64),
    pocketCoordinateSha256:'b'.repeat(64),
  },
});
const coupled = [
  { candidateRank:1, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-119,
    selectedChemicalValidity:{ additionalStericClashes:2 } },
    postRelaxation:postRelaxation(24),
    optimization:{ accepted:true, finalEnergy:-4082 } },
  { candidateRank:6, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-683,
    selectedChemicalValidity:{ additionalStericClashes:0 } },
    postRelaxation:postRelaxation(3),
    optimization:{ accepted:true, finalEnergy:-3987 } },
  { candidateRank:7, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-106,
    selectedChemicalValidity:{ additionalStericClashes:1 } },
    postRelaxation:postRelaxation(12),
    optimization:{ accepted:true, finalEnergy:-3757 } },
];
assert.equal(selectCoupledSidechainPoseBranch(coupled).candidateRank, 6,
  'absolute post-relaxation receptor geometry outranks baseline-relative pre-relax values');
assert.equal(selectCoupledSidechainPoseBranch([
  { candidateRank:6, refinement:{ selectedFeasible:true, selectedScoreKcalMol:40,
    selectedChemicalValidity:{ additionalStericClashes:0 } },
  postRelaxation:postRelaxation(30),
  optimization:{ accepted:true, finalEnergy:-3983 } },
  { candidateRank:7, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-87,
    selectedChemicalValidity:{ additionalStericClashes:2 } },
  postRelaxation:postRelaxation(2),
  optimization:{ accepted:true, finalEnergy:-3754 } },
]).candidateRank, 7,
'selection reverses when the post-relax receptor-aware ranking reverses, regardless of pre-relax clashes');
assert.equal(selectCoupledSidechainPoseBranch([
  { candidateRank:2, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-10,
    selectedChemicalValidity:{ additionalStericClashes:0 } },
    postRelaxation:postRelaxation(0),
    optimization:{ accepted:true, finalEnergy:-20 } },
  { candidateRank:1, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-10,
    selectedChemicalValidity:{ additionalStericClashes:0 } },
    postRelaxation:postRelaxation(0),
    optimization:{ accepted:true, finalEnergy:-30 } },
]).candidateRank, 1, 'final relaxed energy breaks exact pose-score ties');
assert.throws(() => selectCoupledSidechainPoseBranch([
  { refinement:{ selectedFeasible:false, selectedScoreKcalMol:-100,
    selectedChemicalValidity:{ additionalStericClashes:0 } },
    postRelaxation:postRelaxation(0, false),
    optimization:{ accepted:true, finalEnergy:-1000 } },
]), /post-relaxation receptor-aware evidence/);
assert.throws(() => selectCoupledSidechainPoseBranch([
  { candidateRank:1, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-100 },
    optimization:{ accepted:true, finalEnergy:-1000 } },
]), /post-relaxation receptor-aware evidence/,
'pre-relax scoring cannot silently stand in for missing current-state evidence');

console.log('Side-chain rotamer enumeration: PASS');
