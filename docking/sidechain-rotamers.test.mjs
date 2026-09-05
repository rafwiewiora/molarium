import assert from 'node:assert/strict';
import { applySidechainRotamer, assertSidechainChiAnglesReproduced,
  assertSidechainRotamerCoordinateGuards,
  enumerateSidechainRotamers, evaluatePostRelaxedBranchObjective,
  evaluatePostRelaxedLigandPocket,
  measureInspectedSidechainChiAngles, selectSidechainRotamerCandidate,
  selectCoupledSidechainPoseBranch,
  SIDECHAIN_ROTAMER_SCHEMA, sidechainResponseAtomIndices,
  uniqueSidechainRotamerCandidates } from './sidechain-rotamers.mjs';

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
assert.deepEqual(sidechainResponseAtomIndices({ molecule,
  residue:{ residueName:'PHE', chain:'A', residueIndex:890, insertionCode:'' } })
  .map((index) => molecule.atoms[index].atomName).sort(),
['CG','CD1','CD2','CE1','CE2','CZ'].sort(),
'chi response permission excludes Phe CB and every backbone atom');
const inspectedResidue = (source = molecule.atoms.slice(0, 11)) => source.map((entry) => ({
  atomId:`test:${entry.atomName}`, atomName:entry.atomName, element:entry.element,
  residueName:entry.residueName, chain:entry.chain, residueIndex:entry.residueIndex,
  insertionCode:entry.insertionCode || '', coordinatesAngstrom:[entry.x, entry.y, entry.z],
}));

const ensemble = enumerateSidechainRotamers({ molecule, residueAtomIndex:6,
  ligandAtomIndices:[11], maximumCandidates:32 });
assert.equal(ensemble.schema, SIDECHAIN_ROTAMER_SCHEMA);
assert.equal(ensemble.method, 'canonical-chi-grid-steric-prerank-v1');
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
const freshInput = { index:12, source:'input', chiDegrees:[-75.1,-72.2],
  coordinateSha256:'8'.repeat(64) };
assert.equal(selectSidechainRotamerCandidate({ ...stableSelectionEnsemble,
  candidates:[...stableSelectionEnsemble.candidates, freshInput] }, { source:'input' }), freshInput,
'unchanged input selection follows the current enumeration, not old numerical angles');
assert.throws(() => selectSidechainRotamerCandidate(stableSelectionEnsemble,
  { source:'input' }), /exactly one candidate/);
assert.throws(() => selectSidechainRotamerCandidate({ ...stableSelectionEnsemble,
  candidates:[freshInput, { ...freshInput, index:13 }] }, { source:'input' }), /exactly one candidate/);
assert.throws(() => selectSidechainRotamerCandidate(stableSelectionEnsemble,
  { source:'canonical-library' }), /must be input/);
assert.throws(() => selectSidechainRotamerCandidate(stableSelectionEnsemble,
  { source:'input', chiDegrees:[-180,90] }), /exactly one side-chain rotamer selector/);
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

const inspected = (atoms) => ({ scope:'ligand', truncated:false,
  totalAtomCount:atoms.length, atoms });
const inspectedAtom = (atomId, atomName, coordinatesAngstrom, element = 'C') => ({
  atomId, atomName, element, coordinatesAngstrom,
});
const referenceInspection = inspected([
  inspectedAtom('hard-1', 'C1', [0,0,0]),
  inspectedAtom('hard-2', 'C2', [1,0,0]),
  inspectedAtom('hard-3', 'C3', [0,1,0]),
]);
const relaxedInspection = inspected([
  inspectedAtom('hard-1', 'C1', [0,0,0]),
  inspectedAtom('hard-2', 'C2', [1,0,0]),
  inspectedAtom('hard-3', 'C3', [0,1,0]),
  inspectedAtom('changed-1', 'C4', [10,0,0]),
]);
const engagedPocket = inspected([
  ...relaxedInspection.atoms,
  inspectedAtom('receptor-1', 'CG', [12.7,0,0]),
]);
const retainedEngagement = evaluatePostRelaxedBranchObjective({
  referenceLigand:referenceInspection, ligand:relaxedInspection, pocket:engagedPocket,
  hardAtomNames:['C1','C2','C3'], changedLigandAtomIds:['changed-1'],
});
assert.equal(retainedEngagement.feasible, true);
assert.equal(retainedEngagement.poseIntent.hardAnchorRmsdAngstrom, 0);
assert.equal(retainedEngagement.poseIntent.superpositionApplied, false);
assert.equal(retainedEngagement.changedRegionEngagement.engagedHeavyAtomFraction, 1);
assert(retainedEngagement.changedRegionEngagement.engagementScore > 0);
const penetratingObjective = evaluatePostRelaxedBranchObjective({
  referenceLigand:referenceInspection, ligand:relaxedInspection,
  pocket:inspected([...relaxedInspection.atoms,
    inspectedAtom('receptor-1', 'CG', [12.5,0,0])]),
  hardAtomNames:['C1','C2','C3'], changedLigandAtomIds:['changed-1'],
});
assert.equal(penetratingObjective.changedRegionEngagement.engagementScore, 0,
  'a pair inside the existing 0.78 van der Waals overlap boundary is not rewarded as engagement');
assert(penetratingObjective.receptorAware.score > 0);
const escapedInspection = inspected(relaxedInspection.atoms.map((entry) =>
  entry.atomId === 'changed-1' ? { ...entry, coordinatesAngstrom:[20,0,0] } : entry));
const escapedObjective = evaluatePostRelaxedBranchObjective({
  referenceLigand:referenceInspection, ligand:escapedInspection,
  pocket:inspected([...escapedInspection.atoms,
    inspectedAtom('receptor-1', 'CG', [12.7,0,0])]),
  hardAtomNames:['C1','C2','C3'], changedLigandAtomIds:['changed-1'],
});
assert.equal(escapedObjective.feasible, true,
  'absence of a clash alone does not prove changed-region pocket engagement');
assert.equal(escapedObjective.changedRegionEngagement.engagementScore, 0);
const translatedInspection = inspected(relaxedInspection.atoms.map((entry) =>
  ['hard-1','hard-2','hard-3'].includes(entry.atomId)
    ? { ...entry, coordinatesAngstrom:entry.coordinatesAngstrom.map((value, axis) =>
      axis === 0 ? value + 1 : value) } : entry));
const translatedObjective = evaluatePostRelaxedBranchObjective({
  referenceLigand:referenceInspection, ligand:translatedInspection,
  pocket:inspected([...translatedInspection.atoms,
    inspectedAtom('receptor-1', 'CG', [12.7,0,0])]),
  hardAtomNames:['C1','C2','C3'], changedLigandAtomIds:['changed-1'],
});
assert.equal(translatedObjective.feasible, false,
  'raw same-frame anchor displacement is not hidden by rigid superposition');
assert.equal(translatedObjective.poseIntent.hardAnchorCentroidDisplacementAngstrom, 1);
assert.throws(() => evaluatePostRelaxedBranchObjective({
  referenceLigand:{ ...referenceInspection, truncated:true },
  ligand:relaxedInspection, pocket:engagedPocket,
  hardAtomNames:['C1','C2','C3'], changedLigandAtomIds:['changed-1'],
}), /truncated:false/);
assert.throws(() => evaluatePostRelaxedBranchObjective({
  referenceLigand:referenceInspection,
  ligand:{ ...relaxedInspection, totalAtomCount:relaxedInspection.atoms.length + 1 },
  pocket:engagedPocket,
  hardAtomNames:['C1','C2','C3'], changedLigandAtomIds:['changed-1'],
}), /complete totalAtomCount coverage/);
assert.throws(() => evaluatePostRelaxedBranchObjective({
  referenceLigand:referenceInspection,
  ligand:inspected([...relaxedInspection.atoms,
    { ...relaxedInspection.atoms[0], atomName:'C5' }]),
  pocket:engagedPocket,
  hardAtomNames:['C1','C2','C3'], changedLigandAtomIds:['changed-1'],
}), /unique persistent atom IDs/);
assert.throws(() => evaluatePostRelaxedBranchObjective({
  referenceLigand:referenceInspection,
  ligand:inspected(relaxedInspection.atoms.map((entry) => entry.atomName === 'C1'
    ? { ...entry, atomId:'replacement-hard-1' } : entry)),
  pocket:engagedPocket,
  hardAtomNames:['C1','C2','C3'], changedLigandAtomIds:['changed-1'],
}), /changed persistent identity/);
const softOverlapObjective = evaluatePostRelaxedBranchObjective({
  referenceLigand:referenceInspection, ligand:relaxedInspection,
  pocket:inspected([...relaxedInspection.atoms,
    inspectedAtom('receptor-1', 'CG', [12.3,0,0])]),
  hardAtomNames:['C1','C2','C3'], changedLigandAtomIds:['changed-1'],
});
assert.equal(softOverlapObjective.changedRegionEngagement.engagementScore, 0,
  'the full 0.62-to-0.78 soft-overlap interval is penalized but never rewarded');
assert(softOverlapObjective.receptorAware.score > 0);

const branchObjective = (engagementScore = 0.5, feasible = true) => ({
  feasible,
  poseIntent:{ satisfied:feasible, hardAnchorRmsdAngstrom:0.1 },
  changedRegionEngagement:{ engagementScore, engagedHeavyAtomFraction:1,
    contactPairCount:2 },
});
const postRelaxation = (score, feasible = true, engagementScore = 0.5) => ({
  receptorAware:{ feasible, score },
  branchObjective:branchObjective(engagementScore, feasible),
  topPoseEvidence:{
    schema:'molarium.coordinate-evidence/v1',
    ligand:{ truncated:false, totalAtomCount:1,
      atoms:[{ atomId:'ligand-c', element:'C', coordinatesAngstrom:[0,0,0] }] },
    pocket:{ truncated:false, totalAtomCount:1,
      atoms:[{ atomId:'receptor-c', element:'C', coordinatesAngstrom:[4,0,0] }] },
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
  { candidateRank:1, refinement:{ selectedFeasible:true },
    postRelaxation:postRelaxation(0, true, 0),
    optimization:{ accepted:true, finalEnergy:-100 } },
  { candidateRank:2, refinement:{ selectedFeasible:true },
    postRelaxation:postRelaxation(0.75, true, 0.8),
    optimization:{ accepted:true, finalEnergy:-90 } },
]).candidateRank, 2,
'capped changed-region engagement outranks a zero-overlap branch that escaped the pocket');
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
    postRelaxation:postRelaxation(0, true),
    optimization:{ accepted:true, finalEnergy:-1000 } },
]), /preserved registered pose intent/,
'a post-relax branch cannot rescue a refinement that was already infeasible');
assert.throws(() => selectCoupledSidechainPoseBranch([
  { candidateRank:1, refinement:{ selectedFeasible:true, selectedScoreKcalMol:-100 },
    optimization:{ accepted:true, finalEnergy:-1000 } },
]), /preserved registered pose intent/,
'pre-relax scoring cannot silently stand in for missing current-state evidence');

console.log('Side-chain rotamer enumeration: PASS');
