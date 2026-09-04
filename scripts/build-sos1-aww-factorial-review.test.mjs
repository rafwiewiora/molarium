#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildSos1AwwFactorialReviewData, pdbFromInspectionAtoms,
} from './build-sos1-aww-factorial-review.mjs';
import { SOS1_AWW_REVIEW_CAPTURE_SCHEMA }
  from './sos1-aww-review-capture.mjs';

const digest = (character) => character.repeat(64);
const clone = (value) => JSON.parse(JSON.stringify(value));
const atom = ({ atomName, residueName, residueIndex, coordinatesAngstrom,
  element = atomName[0], chain = 'A' }) => ({
  atomId:`${residueName}:${chain}:${residueIndex}:${atomName}`,
  atomName, residueName, residueIndex, insertionCode:'', chain, element,
  coordinatesAngstrom,
});

const commonProtein = [
  atom({ atomName:'CA', residueName:'ASN', residueIndex:879,
    coordinatesAngstrom:[0,0,0] }),
  atom({ atomName:'OD1', residueName:'ASN', residueIndex:879, element:'O',
    coordinatesAngstrom:[-.4,.2,0] }),
  atom({ atomName:'CA', residueName:'TYR', residueIndex:884,
    coordinatesAngstrom:[2,0,0] }),
  atom({ atomName:'O', residueName:'TYR', residueIndex:884, element:'O',
    coordinatesAngstrom:[2,1,0] }),
  atom({ atomName:'CA', residueName:'PHE', residueIndex:890,
    coordinatesAngstrom:[0,2,0] }),
];

function branchArtifact(branch, pheState, offset) {
  const phe = [
    atom({ atomName:'CG', residueName:'PHE', residueIndex:890,
      coordinatesAngstrom:[offset,2.7,0] }),
    atom({ atomName:'CD1', residueName:'PHE', residueIndex:890,
      coordinatesAngstrom:[offset + .5,3.1,0] }),
  ];
  const ligand = [
    atom({ atomName:'OX3', residueName:'AWW', residueIndex:1104, element:'O',
      coordinatesAngstrom:[2,2 + offset,0] }),
    atom({ atomName:'C12', residueName:'AWW', residueIndex:1104,
      coordinatesAngstrom:[2.8,2 + offset,0] }),
  ];
  const atoms = [...commonProtein, ...phe, ...ligand];
  const eligible = false;
  return {
    schema:'molarium.sos1-aww-designer-contact-factorial/v2', branch, pheState,
    holdoutCoordinatesUsed:false, sourceStateId:'AWZ', predictedStateId:'AWW',
    eligible, prospectiveGates:{ selectedFeasible:false, coverageComplete:false,
      scoreFinite:true },
    reviewCoordinateCapture:{
      schema:SOS1_AWW_REVIEW_CAPTURE_SCHEMA, requested:true, diagnosticOnly:true,
      reviewModeRequested:false, disposition:'rejected-nonpromotable',
      promotable:false, branch, prospectiveEligible:eligible, eligibilityUnchanged:true,
      selectedFeasible:false,
      selectedRank:1, appliedPoseIndex:0, allowInfeasible:true, infeasibleOverride:true,
      selectedCoordinateSha256:digest('1'), selectedStateSha256:digest('2'),
      outputCoordinateSha256:digest('3'), outputStateSha256:digest('4'),
      pocketAtomCount:atoms.length, contactAnnotationCount:1,
      purpose:'Coordinate review only; never production selection or promotion evidence.',
    },
    pocket:{ scope:'pocket', truncated:false, totalAtomCount:atoms.length, atoms,
      bonds:[], contacts:[{
        contactId:`${branch}-ox3-tyr884`, label:'AWW A1104 OX3 → TYR A884 O',
        hydrogenBond:{ satisfied:false, donorAcceptorDistanceAngstrom:3.5 + offset,
          hydrogenAcceptorDistanceAngstrom:2.6 + offset, dhaAngleDegrees:140 - offset,
          participants:{
            donor:{ coordinatesAngstrom:[2,2 + offset,0] },
            hydrogen:{ coordinatesAngstrom:[2,1.7 + offset,0] },
            acceptor:{ coordinatesAngstrom:[2,1,0] },
          } },
      }] },
  };
}

const artifacts = [
  branchArtifact('phe-native','native',0),
  branchArtifact('phe-plus60','plus60',.1),
  branchArtifact('phe-out','out',.2),
];
const legacyArtifacts = clone(artifacts).map((artifact) => {
  const capture = artifact.reviewCoordinateCapture;
  capture.schema = 'molarium.sos1-aww-diagnostic-coordinate-review/v1';
  delete capture.reviewModeRequested;
  delete capture.disposition;
  delete capture.prospectiveEligible;
  capture.eligibilityUnchanged = artifact.eligible;
  capture.purpose = 'Coordinate review only; never production selection or promotion evidence.';
  return artifact;
});
const pdbText = pdbFromInspectionAtoms(commonProtein, {
  title:'synthetic 5OVE receptor', proteinRecords:true,
});
const input = {
  artifacts,
  artifactSha256:{ 'phe-native':digest('a'), 'phe-plus60':digest('b'),
    'phe-out':digest('c') },
  pdbText, pdbSha256:digest('d'),
};

const data = buildSos1AwwFactorialReviewData(input);
assert.equal(data.schema, 'molarium.structure-overlay-review/v1');
assert.equal(data.ligands.length, 3);
assert.deepEqual(data.ligands.map((entry) => entry.id),
  ['phe-native','phe-plus60','phe-out']);
assert.deepEqual(data.ligands.map((entry) => entry.defaultVisible), [true,false,false]);
assert(data.ligands.every((entry) => entry.coordinateClass
  === 'diagnostic-nonpromotable'));
assert(data.ligands.every((entry) => entry.review.promotable === false));
assert(data.ligands.every((entry) => entry.review.failedGates.includes('selectedFeasible')));
assert.match(data.ligands[0].designPoint,
  /Failed gates: coverageComplete, selectedFeasible.*D–A 3\.50 Å; H–A 2\.60 Å; D–H···A 140\.0°; contact unsatisfied/);
assert.equal(data.ligands[0].metricDisplay, '3.50 / 2.60 Å · 140.0°');
assert.equal(data.labels.firstOnlyButton, 'Native branch only');
assert.equal(data.labels.focusSnapshotsDefaultVisible, true);
assert.equal(data.labels.statusTone, 'reject');
assert.match(data.boundary, /DIAGNOSTIC REVIEW ONLY · NONPROMOTABLE/);
assert.match(data.boundary, /5OVH was not opened/);
assert(data.ligands[0].ligandPdb.includes('AWW'));
assert(data.ligands[0].focusPdb.includes('PHE A 890'));
assert(data.receptor.proteinPdb.includes('ATOM'));
assert.deepEqual(data.receptor.focusResidues, [884,890]);

const legacyData = buildSos1AwwFactorialReviewData({ ...input,
  artifacts:legacyArtifacts });
assert.equal(legacyData.ligands.length, 3);
assert(legacyData.ligands.every((entry) => entry.badge === 'rejected'
  && entry.coordinateClass === 'diagnostic-nonpromotable'
  && entry.review.promotable === false));

for (const [label, mutate, pattern] of [
  ['missing capture', (value) => { delete value.artifacts[0].reviewCoordinateCapture; },
    /explicit diagnostic coordinate capture is required/],
  ['promotable capture', (value) => { value.artifacts[0].reviewCoordinateCapture.promotable = true; },
    /true !== false/],
  ['eligible current capture', (value) => {
    value.artifacts[0].eligible = true;
    for (const gate of Object.keys(value.artifacts[0].prospectiveGates))
      value.artifacts[0].prospectiveGates[gate] = true;
    value.artifacts[0].reviewCoordinateCapture.prospectiveEligible = true;
  }, /this viewer accepts rejected branches only/],
  ['holdout contamination', (value) => { value.artifacts[0].holdoutCoordinatesUsed = true; },
    /holdout coordinates are forbidden/],
  ['missing contact point', (value) => {
    delete value.artifacts[0].pocket.contacts[0].hydrogenBond.participants.hydrogen
      .coordinatesAngstrom;
  }, /lacks hydrogen coordinates/],
]) {
  const broken = clone(input); mutate(broken);
  assert.throws(() => buildSos1AwwFactorialReviewData(broken), pattern, label);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewer = await readFile(path.join(root,
  'design-history/structure-review/index.html'), 'utf8');
assert.match(viewer, /firstOnlyButton/);
assert.match(viewer, /focusSnapshotsDefaultVisible/);
assert.match(viewer, /statusTone==='reject'/);

console.log('SOS1 AWW rejected-pose structure-review builder checks passed');
