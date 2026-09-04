#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = {
  prediction: 'design-history/publications/sos1/source-runs/sos1-a013-a018-complete-frozen/open-phe890-pocket-prediction.json',
  holdoutEvaluation: 'design-history/publications/sos1/source-runs/sos1-a013-a018-complete-frozen/open-phe890-pocket-holdout-evaluation.json',
  holdoutLigand: 'design-history/structures/generated/sos1-v7-aww-crystal-ligand.pdb',
  pheIn: 'design-history/structures/generated/sos1-v7-phe890-flip-peptide-00.pdb',
  phePlus60: 'design-history/structures/generated/sos1-v7-phe890-flip-peptide-05.pdb',
  pheOut: 'design-history/structures/generated/sos1-v7-phe890-flip-peptide-07.pdb',
};
const expectedInputSha256 = {
  prediction:'510154612002504393429956877e1be312fff6bb23450e62974ab0ffd1954c88',
  holdoutEvaluation:'8682bf21c417453b8d4ea3e2a48e7a4ebf1f2769dbd1985ffd91b0a0cbf8408e',
  holdoutLigand:'d19f5e6b7aa102a410fd2ff36257cf97c1e86b920916bee90064af10a575364e',
  pheIn:'5750c0432f43ff24423b2a5be4e0e4508e89e502aa605270c3f6d8a489bb84ed',
  phePlus60:'3e0c466ec8b5bb8422113bb4e2abdaefcb51ae530acf52a39ead7b64482daa97',
  pheOut:'9361ec4eebbb77914da4e22fa4676853529626be328490ffa5de2f1eb9474873',
};
const angles = Array.from({ length: 12 }, (_, index) => index * 30);
const radii = { C:1.70, N:1.55, O:1.52, S:1.80, P:1.80, F:1.47, CL:1.75 };
const severeFraction = 0.62;
const holdoutMap = {
  CX6:'C29', OX1:'O28', CX7:'C27', CX8:'C1', OX2:'O30', CX9:'C31', CX10:'C2',
  C1:'C3', C2:'C4', N6:'N5', C11:'C6', CX1:'C7', N8:'N8', C3:'C9', N7:'N10',
  C12:'C11', C16:'C12', C15:'C13', CX2:'C14', CX3:'C15', CX4:'C16', CX5:'C18',
  CX11:'C19', CX12:'C20', CX13:'C21', CX14:'C22', CX15:'C23', CX16:'C24',
  OX3:'O25', SX1:'S17', CX17:'C26',
};
const firstMoved = new Set(['C15','CX2','CX3','CX4','SX1','CX5','CX11','CX12','CX13',
  'CX14','CX15','CX16','OX3']);
const secondMoved = new Set(['CX5','CX11','CX12','CX13','CX14','CX15','CX16','OX3']);
const torsions = [
  { id:'thiophene-a', atoms:['N7','C12','C15','CX2'] },
  { id:'thiophene-b', atoms:['N7','C12','C15','SX1'] },
  { id:'biaryl', atoms:['CX3','CX4','CX5','CX11'] },
];

const round = (value, digits = 6) => Number(value.toFixed(digits));
const sub = (a, b) => a.map((value, index) => value - b[index]);
const add = (a, b) => a.map((value, index) => value + b[index]);
const scale = (a, value) => a.map((entry) => entry * value);
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = (a) => Math.hypot(...a);
const unit = (a) => scale(a, 1 / norm(a));
const distance = (a, b) => norm(sub(a, b));
const circularError = (a, b) => Math.abs((((a - b) + 540) % 360) - 180);

function dihedral(a, b, c, d) {
  const b0 = sub(a, b);
  const b1 = sub(c, b);
  const b2 = sub(d, c);
  const axis = unit(b1);
  const v = sub(b0, scale(axis, dot(b0, axis)));
  const w = sub(b2, scale(axis, dot(b2, axis)));
  return Math.atan2(dot(cross(axis, v), w), dot(v, w)) * 180 / Math.PI;
}

function rotate(point, origin, axisPoint, degrees) {
  const vector = sub(point, origin);
  const axis = unit(sub(axisPoint, origin));
  const radians = degrees * Math.PI / 180;
  return add(origin, add(scale(vector, Math.cos(radians)), add(
    scale(cross(axis, vector), Math.sin(radians)),
    scale(axis, dot(axis, vector) * (1 - Math.cos(radians))))));
}

function parsePdb(text) {
  return text.split(/\r?\n/).filter((line) => /^(ATOM  |HETATM)/.test(line)).map((line) => ({
    atomName:line.slice(12, 16).trim(), residueName:line.slice(17, 20).trim(),
    chain:line.slice(21, 22).trim(), residueIndex:Number(line.slice(22, 26)),
    element:(line.slice(76, 78).trim() || line.slice(12, 14).trim()[0]).toUpperCase(),
    xyz:[Number(line.slice(30, 38)), Number(line.slice(38, 46)), Number(line.slice(46, 54))],
  }));
}

function heavyByName(atoms) {
  return new Map(atoms.filter((atom) => atom.element !== 'H').map((atom) => [atom.atomName, atom]));
}

function rotateNamed(coordinates, moved, fixedName, axisName, degrees) {
  const result = new Map([...coordinates].map(([name, xyz]) => [name, [...xyz]]));
  const origin = result.get(fixedName);
  const axisPoint = result.get(axisName);
  for (const name of moved) result.set(name, rotate(result.get(name), origin, axisPoint, degrees));
  return result;
}

function severeClashes(ligand, receptor) {
  let count = 0;
  let minimumDistance = Infinity;
  for (const atom of ligand) for (const other of receptor) {
    const d = distance(atom.xyz, other.xyz);
    minimumDistance = Math.min(minimumDistance, d);
    if (d < severeFraction * ((radii[atom.element] || 1.7) + (radii[other.element] || 1.7))) count += 1;
  }
  return { count, minimumDistanceAngstrom:round(minimumDistance, 3) };
}

function rmsd(model, crystal) {
  const squared = [...model].reduce((sum, [name, xyz]) => {
    const target = crystal.get(holdoutMap[name]);
    assert(target, `missing holdout atom for ${name}`);
    return sum + distance(xyz, target.xyz) ** 2;
  }, 0);
  return Math.sqrt(squared / model.size);
}

function prospectiveOrder(a, b) {
  return a.totalSevere - b.totalSevere
    || a.pheSevere - b.pheSevere
    || a.nonPheSevere - b.nonPheSevere
    || a.waterSevere - b.waterSevere
    || a.firstAngleDegrees - b.firstAngleDegrees
    || a.secondAngleDegrees - b.secondAngleDegrees;
}

async function main() {
  const bytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) =>
    [key, await readFile(resolve(root, path))])));
  const inputSha256 = Object.fromEntries(Object.entries(bytes).map(([key, value]) =>
    [key, createHash('sha256').update(value).digest('hex')]));
  assert.deepEqual(inputSha256, expectedInputSha256, 'immutable source inputs changed');
  const prediction = JSON.parse(bytes.prediction);
  const evaluation = JSON.parse(bytes.holdoutEvaluation);
  assert.equal(prediction.predictedStateId, 'AWW');
  assert.equal(evaluation.holdout.pdbId, '5OVH');
  const modelAtoms = prediction.ligand.atoms.filter((atom) => atom.element !== 'H');
  const model = new Map(modelAtoms.map((atom) => [atom.atomName, atom.coordinatesAngstrom]));
  const crystal = heavyByName(parsePdb(bytes.holdoutLigand.toString('utf8')));
  const pocketHeavy = prediction.pocket.atoms.filter((atom) => atom.element !== 'H');
  const nonPhe = pocketHeavy.filter((atom) => atom.residueName !== 'AWW' && atom.residueName !== 'HOH'
    && !(atom.residueName === 'PHE' && atom.residueIndex === 890))
    .map((atom) => ({ element:atom.element, xyz:atom.coordinatesAngstrom }));
  const water = pocketHeavy.filter((atom) => atom.residueName === 'HOH' && atom.residueIndex === 1507)
    .map((atom) => ({ element:atom.element, xyz:atom.coordinatesAngstrom }));
  assert.equal(water.length, 1);
  const asnOd1 = pocketHeavy.find((atom) => atom.residueName === 'ASN' && atom.residueIndex === 879
    && atom.atomName === 'OD1');
  assert(asnOd1);
  const branches = [
    { id:'phe-in-native', source:'pheIn' },
    { id:'phe-plus60-control', source:'phePlus60' },
    { id:'phe-out', source:'pheOut' },
  ];
  const crystalTorsions = Object.fromEntries(torsions.map((entry) => [entry.id, dihedral(
    ...entry.atoms.map((name) => crystal.get(holdoutMap[name]).xyz))]));
  const cells = [];
  for (const branch of branches) {
    const phe = parsePdb(bytes[branch.source].toString('utf8')).filter((atom) => atom.residueName === 'PHE'
      && atom.residueIndex === 890 && atom.element !== 'H' && !['N','CA','C','O'].includes(atom.atomName));
    for (const firstAngleDegrees of angles) for (const secondAngleDegrees of angles) {
      let coordinates = rotateNamed(model, firstMoved, 'C12', 'C15', firstAngleDegrees);
      coordinates = rotateNamed(coordinates, secondMoved, 'CX4', 'CX5', secondAngleDegrees);
      const ligand = modelAtoms.map((atom) => ({ element:atom.element, xyz:coordinates.get(atom.atomName) }));
      const pheClash = severeClashes(ligand, phe);
      const nonPheClash = severeClashes(ligand, nonPhe);
      const waterClash = severeClashes(ligand, water);
      const modelTorsions = Object.fromEntries(torsions.map((entry) => [entry.id, dihedral(
        ...entry.atoms.map((name) => coordinates.get(name)))]));
      cells.push({ branch:branch.id, firstAngleDegrees, secondAngleDegrees,
        pheSevere:pheClash.count, nonPheSevere:nonPheClash.count, waterSevere:waterClash.count,
        dryTotalSevere:pheClash.count + nonPheClash.count,
        retainedWaterTotalSevere:pheClash.count + nonPheClash.count + waterClash.count,
        minimumPheDistanceAngstrom:pheClash.minimumDistanceAngstrom,
        n7ToAsn879Od1Angstrom:round(distance(coordinates.get('N7'), asnOd1.coordinatesAngstrom), 3),
        retrospective:{ wholeLigandRmsdAngstrom:round(rmsd(coordinates, crystal), 3),
          torsionErrorsDegrees:Object.fromEntries(torsions.map((entry) =>
            [entry.id, round(circularError(modelTorsions[entry.id], crystalTorsions[entry.id]), 1)])) },
      });
    }
  }
  const summaries = [];
  for (const branch of branches) for (const hydration of ['dry','retained-water-1507']) {
    const key = hydration === 'dry' ? 'dryTotalSevere' : 'retainedWaterTotalSevere';
    const subset = cells.filter((cell) => cell.branch === branch.id)
      .map((cell) => ({ ...cell, totalSevere:cell[key] }));
    const prospective = [...subset].sort(prospectiveOrder);
    const compatible = subset.filter((cell) => cell.retrospective.torsionErrorsDegrees['thiophene-a'] < 45
      && cell.retrospective.torsionErrorsDegrees['thiophene-b'] < 45
      && cell.retrospective.torsionErrorsDegrees.biaryl < 45)
      .sort((a, b) => a.retrospective.wholeLigandRmsdAngstrom - b.retrospective.wholeLigandRmsdAngstrom);
    const compatibleZeroSevere = compatible.filter((cell) => cell.totalSevere === 0);
    summaries.push({ branch:branch.id, hydration,
      prospective:{ zeroSevereCellCount:prospective.filter((cell) => cell.totalSevere === 0).length,
        minimumSevereClashes:prospective[0].totalSevere },
      retrospective:{ holdoutCompatibleCellCount:compatible.length,
        zeroSevereHoldoutCompatibleCellCount:compatibleZeroSevere.length,
        bestZeroSevereHoldoutCompatibleCell:compatibleZeroSevere[0] ? {
          firstAngleDegrees:compatibleZeroSevere[0].firstAngleDegrees,
          secondAngleDegrees:compatibleZeroSevere[0].secondAngleDegrees,
          wholeLigandRmsdAngstrom:compatibleZeroSevere[0].retrospective.wholeLigandRmsdAngstrom,
          torsionErrorsDegrees:compatibleZeroSevere[0].retrospective.torsionErrorsDegrees,
        } : null,
        bestHoldoutCompatibleCell:compatible[0] ? {
          firstAngleDegrees:compatible[0].firstAngleDegrees,
          secondAngleDegrees:compatible[0].secondAngleDegrees,
          totalSevereClashes:compatible[0].totalSevere,
          wholeLigandRmsdAngstrom:compatible[0].retrospective.wholeLigandRmsdAngstrom,
          torsionErrorsDegrees:compatible[0].retrospective.torsionErrorsDegrees,
        } : null },
    });
  }
  const highlights = cells.filter((cell) => cell.branch === 'phe-in-native'
    && [[120,240],[120,270],[150,240],[150,270]].some(([a,b]) =>
      cell.firstAngleDegrees === a && cell.secondAngleDegrees === b))
    .map((cell) => ({ firstAngleDegrees:cell.firstAngleDegrees,
      secondAngleDegrees:cell.secondAngleDegrees, pheSevere:cell.pheSevere,
      nonPheSevere:cell.nonPheSevere, waterSevere:cell.waterSevere,
      wholeLigandRmsdAngstrom:cell.retrospective.wholeLigandRmsdAngstrom,
      torsionErrorsDegrees:cell.retrospective.torsionErrorsDegrees }));
  const output = {
    schema:'molarium.sos1-aww-two-rotor-grid-provenance/v1',
    generatedBy:'scripts/sos1-aww-two-rotor-grid-provenance.mjs',
    status:'diagnostic-complete',
    purpose:'Fast geometry proxy for prospective AWW pose/Phe890 factorial design; not a production pose selector.',
    inputs:Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, { path, sha256:inputSha256[key] }])),
    grid:{ rotorDeltaDegrees:angles, ligandRotors:[
      { axis:['C12','C15'], movedAtomNames:[...firstMoved] },
      { axis:['CX4','CX5'], movedAtomNames:[...secondMoved] }],
      phe890Branches:branches.map(({ id, source }) => ({ id, input:source })),
      hydrationStates:['dry','retained-water-1507'], conceptualCellCount:angles.length ** 2 * branches.length * 2,
      severeClashDefinition:{ radiusFraction:severeFraction, hydrogenAtomsExcluded:true } },
    prospectiveBoundary:{ holdoutCoordinatesUsedForRanking:false,
      rankingStatus:'not-performed',
      statement:'The grid records prospective clash screens only. No cell or Phe890 branch is selected from 5OVH agreement.',
      availableWithoutHoldout:['Phe890 severe-clash count','other receptor severe-clash count',
        'retained HOH1507 severe-clash count','N7-to-Asn879-OD1 heavy-atom distance'],
      fixedN7ToAsn879Od1Angstrom:round(distance(model.get('N7'), asnOd1.coordinatesAngstrom), 3),
      missingForScientificSelection:['force-field energy','ligand strain','hydrogen geometry after local minimization',
        'post-relaxation contact satisfaction','water displacement free energy'] },
    prospectiveScreen:summaries.map(({ retrospective, ...entry }) => entry),
    retrospectiveHoldoutDiagnostics:{ evaluationOnly:true, holdoutPdbId:'5OVH',
      existingFrozenEvaluation:{ accepted:evaluation.accepted,
        wholeLigandRmsdAngstrom:evaluation.ligand.rmsdAngstrom,
        hardRegionRmsdAngstrom:evaluation.ligand.hardRegionRmsdAngstrom,
        phe890SidechainRmsdAngstrom:evaluation.phe890.sidechainRmsdAngstrom },
      torsionReferenceDegrees:Object.fromEntries(Object.entries(crystalTorsions).map(([key,value]) => [key,round(value,2)])),
      branchSummaries:summaries.map(({ prospective, ...entry }) => entry),
      pheInHighlightedCells:highlights,
      statement:'These values were computed after opening 5OVH and are diagnostic only; they must not select a production pose or receptor branch.' },
    conclusion:'A low-clash, holdout-compatible basin exists with native Phe890-in. Geometry alone does not establish which Phe890 branch wins; a prospective contact-aware coupled-energy selector is required.'
  };
  console.log(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
