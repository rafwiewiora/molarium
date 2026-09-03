import assert from 'node:assert/strict';
import { applySidechainRotamer, assertSidechainRotamerCoordinateGuards,
  enumerateSidechainRotamers, selectSidechainRotamerCandidate,
  selectCoupledSidechainPoseBranch, SIDECHAIN_ROTAMER_SCHEMA } from './sidechain-rotamers.mjs';

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

const ensemble = enumerateSidechainRotamers({ molecule, residueAtomIndex:6,
  ligandAtomIndices:[11], maximumCandidates:32 });
assert.equal(ensemble.schema, SIDECHAIN_ROTAMER_SCHEMA);
assert.equal(ensemble.residue.residueName, 'PHE');
assert.deepEqual(ensemble.axes.map((entry) => entry.chi), ['chi1','chi2']);
assert(ensemble.candidates.length >= 8);
assert(ensemble.candidates.some((entry) => Math.abs(Math.abs(entry.chiDegrees[0]) - 180) < 1));
assert(ensemble.candidates.some((entry) => Math.abs(entry.chiDegrees[1] - 90) < 1));
assert(ensemble.candidates[0].score <= ensemble.candidates.at(-1).score);

const originalBackbone = molecule.atoms.slice(0, 4).map(({ x,y,z }) => [x,y,z]);
const originalLigand = [molecule.atoms[11].x, molecule.atoms[11].y, molecule.atoms[11].z];
const applied = applySidechainRotamer(molecule, ensemble, 0);
assert.equal(applied.rank, 1);
assert.deepEqual(molecule.atoms.slice(0, 4).map(({ x,y,z }) => [x,y,z]), originalBackbone);
assert.deepEqual([molecule.atoms[11].x, molecule.atoms[11].y, molecule.atoms[11].z], originalLigand);
assert.throws(() => enumerateSidechainRotamers({ molecule, residueAtomIndex:11 }), /not in a protein/);
assert.throws(() => applySidechainRotamer(molecule, ensemble, 100), /does not exist/);

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

const coupled = [
  { candidateRank:1, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-119,
    selectedChemicalValidity:{ additionalStericClashes:2 } },
    optimization:{ finalEnergy:-4082 } },
  { candidateRank:6, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-683,
    selectedChemicalValidity:{ additionalStericClashes:0 } },
    optimization:{ finalEnergy:-3987 } },
  { candidateRank:7, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-106,
    selectedChemicalValidity:{ additionalStericClashes:1 } },
    optimization:{ finalEnergy:-3757 } },
];
assert.equal(selectCoupledSidechainPoseBranch(coupled).candidateRank, 6,
  'growth-induced clashes outrank non-comparable receptor baselines and vacuum minima');
assert.equal(selectCoupledSidechainPoseBranch([
  { candidateRank:6, refinement:{ selectedFeasible:true, selectedScoreKcalMol:40,
    selectedChemicalValidity:{ additionalStericClashes:0 } },
  optimization:{ finalEnergy:-3983 } },
  { candidateRank:7, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-87,
    selectedChemicalValidity:{ additionalStericClashes:2 } },
  optimization:{ finalEnergy:-3754 } },
]).candidateRank, 6, 'a separately normalized relative score cannot mask two new clashes');
assert.equal(selectCoupledSidechainPoseBranch([
  { candidateRank:2, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-10,
    selectedChemicalValidity:{ additionalStericClashes:0 } },
    optimization:{ finalEnergy:-20 } },
  { candidateRank:1, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-10,
    selectedChemicalValidity:{ additionalStericClashes:0 } },
    optimization:{ finalEnergy:-30 } },
]).candidateRank, 1, 'final relaxed energy breaks exact pose-score ties');
assert.throws(() => selectCoupledSidechainPoseBranch([
  { refinement:{ selectedFeasible:false, selectedScoreKcalMol:-100,
    selectedChemicalValidity:{ additionalStericClashes:0 } },
    optimization:{ finalEnergy:-1000 } },
]), /No side-chain branch/);

console.log('Side-chain rotamer enumeration: PASS');
