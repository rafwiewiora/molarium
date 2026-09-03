import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCoreTransform, fittedCoreTransform } from '../constraints.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null;
};
const inputName = valueAfter('--input') || 'benchmark-results.v0.1.json';
const outputName = valueAfter('--output') || inputName.replace(/\.json$/, '.scored.json');
const bytes = await readFile(path.join(root, inputName));
const results = JSON.parse(bytes);
const manifest = JSON.parse(await readFile(path.join(root, 'manifest.v0.1.json'), 'utf8'));
const manifestById = new Map(manifest.cases.map((entry) => [entry.id, entry]));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function pdbRows(text) {
  let model = 1;
  return text.split(/\r?\n/).flatMap((line) => {
    if (line.startsWith('MODEL ')) { model = Number(line.slice(10, 14).trim()) || model; return []; }
    if (model !== 1 || !line.startsWith('ATOM  ') && !line.startsWith('HETATM')) return [];
    const alternateLocation = line.slice(16, 17).trim();
    if (alternateLocation && alternateLocation !== 'A') return [];
    return [{ record:line.slice(0, 6).trim(), atomName:line.slice(12, 16).trim(),
      alternateLocation, residueName:line.slice(17, 20).trim(),
      chain:line.slice(21, 22).trim(), residueNumber:Number(line.slice(22, 26).trim()),
      insertionCode:line.slice(26, 27).trim(),
      x:Number(line.slice(30, 38)), y:Number(line.slice(38, 46)), z:Number(line.slice(46, 54)) }];
  });
}

const point = (atom) => [atom.x, atom.y, atom.z];
const flat = (points) => Float64Array.from(points.flat());
const coordinates = (positions, index) => Array.from(positions.slice(index * 3, index * 3 + 3));
const rmsd = (first, second, indices) => Math.sqrt(indices.reduce((sum, index) =>
  sum + first[index].reduce((inner, value, axis) => inner + (value - second[index][axis]) ** 2, 0), 0)
  / indices.length);
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
};

async function alignedCrystal(caseEntry) {
  const referenceRows = pdbRows(await readFile(path.join(root,
    caseEntry.reference.coordinateFile), 'utf8'));
  const analogueRows = pdbRows(await readFile(path.join(root,
    caseEntry.groundTruth.coordinateFile), 'utf8'));
  // Align the protein chain to which the deposited ligand is assigned.  Whole
  // asymmetric units can contain independently placed copies of the same
  // biological complex (for example CDK2 1H1Q/1H1R); fitting all copies at once
  // can therefore report assembly placement rather than binding-site agreement.
  const caKey = (atom) => `${atom.residueNumber}:${atom.insertionCode}:${atom.residueName}`;
  const referenceCa = new Map(referenceRows.filter((atom) => atom.record === 'ATOM'
    && atom.atomName === 'CA' && atom.chain === caseEntry.reference.ligandChain)
    .map((atom) => [caKey(atom), atom]));
  const analogueCa = new Map(analogueRows.filter((atom) => atom.record === 'ATOM'
    && atom.atomName === 'CA' && atom.chain === caseEntry.groundTruth.ligandChain)
    .map((atom) => [caKey(atom), atom]));
  const keys = [...referenceCa.keys()].filter((key) => analogueCa.has(key)).sort();
  assert.ok(keys.length >= 20, `${caseEntry.id}: insufficient receptor alignment atoms`);
  const referencePositions = flat(keys.map((key) => point(referenceCa.get(key))));
  const analoguePositions = flat(keys.map((key) => point(analogueCa.get(key))));
  const pairs = keys.map((_, index) => [index, index]);
  const transform = fittedCoreTransform(referencePositions, analoguePositions, pairs);
  const alignedCa = applyCoreTransform(analoguePositions, transform);
  const alignedCaPoints = keys.map((_, index) => coordinates(alignedCa, index));
  const receptorAlignmentRmsdAngstrom = rmsd(keys.map((key) => point(referenceCa.get(key))),
    alignedCaPoints, keys.map((_, index) => index));
  assert.ok(receptorAlignmentRmsdAngstrom < 5,
    `${caseEntry.id}: receptor-chain alignment is too poor for a pose-accuracy score`);
  const selection = caseEntry.groundTruth;
  const ligand = analogueRows.filter((atom) => atom.record === 'HETATM'
    && atom.residueName === selection.ligandComponentId
    && atom.chain === selection.ligandChain
    && atom.residueNumber === selection.ligandResidueNumber
    && atom.insertionCode === selection.ligandInsertionCode);
  const ligandByName = new Map(ligand.map((atom) => [atom.atomName, atom]));
  const raw = caseEntry.groundTruth.scoringAtomMap.map((entry) => {
    const atom = ligandByName.get(entry.analogueAtomName);
    assert.ok(atom, `${caseEntry.id}: hidden analogue atom ${entry.analogueAtomName} is missing`);
    return point(atom);
  });
  const aligned = applyCoreTransform(flat(raw), transform);
  return { receptorAlignmentScope:'ligand-assigned protein chain',
    referenceProteinChain:caseEntry.reference.ligandChain,
    analogueProteinChain:caseEntry.groundTruth.ligandChain,
    receptorAlignmentAtoms:keys.length, receptorAlignmentRmsdAngstrom,
    ligand:raw.map((_, index) => coordinates(aligned, index)) };
}

function predictedRaw(caseEntry, pose) {
  const byIndex = new Map(pose.atoms.map((atom) => [atom.productAtomIndex, atom]));
  assert.equal(byIndex.size, caseEntry.posePropagationMap.productHeavyAtoms,
    `${caseEntry.id}: predicted heavy-atom map is incomplete`);
  const offsets = caseEntry.posePropagationMap.commonAtoms.map((mapping) => {
    const atom = byIndex.get(mapping.productAtomIndex);
    assert.ok(atom, `${caseEntry.id}: predicted common atom ${mapping.productAtomIndex} is missing`);
    return [atom.x - mapping.referencePointAngstrom[0],
      atom.y - mapping.referencePointAngstrom[1], atom.z - mapping.referencePointAngstrom[2]];
  });
  const offset = [0, 1, 2].map((axis) => offsets.reduce((sum, value) => sum + value[axis], 0)
    / offsets.length);
  const maximumCommonResidualAngstrom = Math.max(...offsets.map((value) =>
    Math.hypot(...value.map((coordinate, axis) => coordinate - offset[axis]))));
  assert.ok(maximumCommonResidualAngstrom < 1e-5,
    `${caseEntry.id}: inherited heavy atoms are not exact in the reported pose`);
  return { points:Array.from({ length:caseEntry.posePropagationMap.productHeavyAtoms }, (_, index) => {
    const atom = byIndex.get(index); assert.ok(atom, `${caseEntry.id}: product atom ${index} is missing`);
    return [atom.x - offset[0], atom.y - offset[1], atom.z - offset[2]];
  }), referenceCenteringOffsetAngstrom:offset, maximumCommonResidualAngstrom };
}

async function scorePairedCase(record, caseEntry) {
  const hidden = await alignedCrystal(caseEntry);
  const common = new Set(caseEntry.posePropagationMap.commonAtoms.map((entry) => entry.productAtomIndex));
  const allIndices = Array.from({ length:caseEntry.posePropagationMap.productHeavyAtoms }, (_, index) => index);
  const commonIndices = allIndices.filter((index) => common.has(index));
  const editedIndices = allIndices.filter((index) => !common.has(index));
  const repeats = (record.repeats || []).flatMap((repeat) => {
    if (!repeat.run?.topPoses?.length) return [];
    const poses = repeat.run.topPoses.map((pose) => {
      const predicted = predictedRaw(caseEntry, pose);
      return { rank:pose.rank, feasible:pose.feasible,
        labelMappedHeavyAtomRmsdAngstrom:rmsd(predicted.points, hidden.ligand, allIndices),
        inheritedRegionRmsdAngstrom:rmsd(predicted.points, hidden.ligand, commonIndices),
        editedRegionRmsdAngstrom:editedIndices.length
          ? rmsd(predicted.points, hidden.ligand, editedIndices) : null,
        referenceCenteringOffsetAngstrom:predicted.referenceCenteringOffsetAngstrom,
        maximumInheritedCoordinateResidualAngstrom:predicted.maximumCommonResidualAngstrom };
    });
    return [{ seed:repeat.seed, top1:poses[0],
      top5MinimumHeavyAtomRmsdAngstrom:Math.min(...poses.map((pose) =>
        pose.labelMappedHeavyAtomRmsdAngstrom)), poses }];
  });
  return { scoringMethod:'protein-CA-aligned frozen product-index/CCD-atom-name mapping',
    symmetryCorrection:false,
    receptorAlignmentScope:hidden.receptorAlignmentScope,
    referenceProteinChain:hidden.referenceProteinChain,
    analogueProteinChain:hidden.analogueProteinChain,
    receptorAlignmentAtoms:hidden.receptorAlignmentAtoms,
    receptorAlignmentRmsdAngstrom:hidden.receptorAlignmentRmsdAngstrom,
    repeats,
    top1MedianHeavyAtomRmsdAngstrom:median(repeats
      .map((entry) => entry.top1.labelMappedHeavyAtomRmsdAngstrom)),
    top5MedianMinimumHeavyAtomRmsdAngstrom:median(repeats
      .map((entry) => entry.top5MinimumHeavyAtomRmsdAngstrom)),
    top5BestObservedHeavyAtomRmsdAngstrom:repeats.length
      ? Math.min(...repeats.map((entry) => entry.top5MinimumHeavyAtomRmsdAngstrom)) : null };
}

const scoredCases = [];
for (const record of results.results) {
  const caseEntry = manifestById.get(record.caseId);
  assert.ok(caseEntry, `${record.caseId}: result is absent from the frozen manifest`);
  scoredCases.push({ caseId:record.caseId, tier:caseEntry.tier,
    terminalOutcome:record.terminalOutcome,
    pairedCrystal:caseEntry.tier === 'paired-crystal'
      ? await scorePairedCase(record, caseEntry) : null });
}
const report = { schemaVersion:1, datasetId:manifest.datasetId, version:manifest.version,
  sourceResultFile:inputName, sourceResultSha256:sha256(bytes), generatedAt:new Date().toISOString(),
  accuracyDefinition:'Only paired-crystal cases receive pose-accuracy metrics. Prospective feasibility is not accuracy.',
  cases:scoredCases };
await writeFile(path.join(root, outputName), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Bioisostere benchmark scoring: COMPLETE (${scoredCases.length} cases)`);
