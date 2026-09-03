import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = async (name) => {
  const bytes = await readFile(path.join(root, name));
  return { bytes, value:JSON.parse(bytes) };
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const curation = await read('curation.v0.1.json');
const curationValidation = await read('curation-validation.v0.1.json');
const fixtureValidation = await read('fixture-validation.v0.1.json');
const atomMaps = await read('atom-maps.v0.1.json');
const interactionScan = await read('interaction-scan.v0.1.json');
const plan = await read('study-plan.v0.1.json');

assert.equal(curationValidation.value.curationSha256, sha256(curation.bytes));
assert.equal(fixtureValidation.value.curationSha256, sha256(curation.bytes));
assert.equal(atomMaps.value.curationSha256, sha256(curation.bytes));
assert.equal(atomMaps.value.fixtureValidationSha256, sha256(fixtureValidation.bytes));
assert.equal(interactionScan.value.fixtureValidationSha256, sha256(fixtureValidation.bytes));

const fixtureByCase = new Map(fixtureValidation.value.cases.map((entry) => [entry.caseId, entry]));
const productByCase = new Map(curationValidation.value.products.map((entry) => [entry.caseId, entry]));
const atomMapByCase = new Map(atomMaps.value.cases.map((entry) => [entry.caseId, entry]));
const scanByCase = new Map(interactionScan.value.scans.flatMap((entry) =>
  entry.caseIds.map((caseId) => [caseId, entry])));

function ligandFeatureInLabel(label, reference, atomNames) {
  const prefix = `${reference.componentId} ${reference.selection.chain}`+
    `${reference.selection.residueNumber}${reference.selection.insertionCode}`;
  return atomNames.some((atomName) => label.includes(`${prefix} ${atomName}`));
}

function referenceRecord(reference) {
  return {
    pdbId:reference.pdbId,
    ligandComponentId:reference.componentId,
    ligandChain:reference.selection.chain,
    ligandResidueNumber:reference.selection.residueNumber,
    ligandInsertionCode:reference.selection.insertionCode,
    alternateLocation:reference.selection.alternateLocation,
    coordinateFile:reference.coordinateFile,
    coordinateSha256:reference.coordinateSha256,
    ccdFile:reference.ccdFile,
    ccdSha256:reference.ccdSha256,
    canonicalSmiles:reference.canonicalSmiles,
    waterPolicy:'retain',
    selectionRule:reference.selection.selectionRule,
  };
}

const cases = curation.value.cases.map((entry) => {
  const fixture = fixtureByCase.get(entry.id);
  const atomMap = atomMapByCase.get(entry.id);
  const scan = scanByCase.get(entry.id);
  assert.ok(fixture && atomMap && scan, `${entry.id}: fixture, atom map or scan missing`);
  const targetFeatures = entry.transformation.referenceFeatureAtomNames || [];
  const hydrogenBonds = scan.capturedHydrogenBonds.map((contact) => {
    const targetFeature = ligandFeatureInLabel(contact.label, fixture.reference, targetFeatures);
    return {
      kind:'hydrogen-bond',
      capturedId:contact.id,
      label:contact.label,
      receptorRole:contact.receptorRole,
      required:true,
      targetFeature,
      expectedTransfer:entry.tier === 'adversarial-negative' && targetFeature
        ? 'unavailable' : targetFeature ? 'role-compatible' : 'preserve-if-mapped',
    };
  });
  const interactionHypotheses = [{ kind:'fixed-common-core', required:true,
    expectedTransfer:'exact-atom-identity where graph is unchanged',
    commonHeavyAtoms:atomMap.commonHeavyAtoms,
    commonReferenceFraction:atomMap.commonReferenceFraction,
    commonProductFraction:atomMap.commonProductFraction }, ...hydrogenBonds];
  const productValidation = productByCase.get(entry.id);
  const product = entry.tier === 'paired-crystal' ? {
    source:'RCSB CCD graph; analogue crystal coordinates withheld from pose generation',
    componentId:fixture.analogue.componentId,
    canonicalSmiles:fixture.analogue.canonicalSmiles,
    ccdFile:fixture.analogue.ccdFile,
    ccdSha256:fixture.analogue.ccdSha256,
  } : {
    source:'pre-registered product SMILES',
    inputSmiles:entry.productSmiles,
    inputSmilesSha256:productValidation.inputSmilesSha256,
    canonicalSmiles:productValidation.canonicalSmiles,
    heavyAtoms:productValidation.heavyAtoms,
    hBondAcceptors:productValidation.hBondAcceptors,
    hBondDonors:productValidation.hBondDonors,
    formalCharge:productValidation.formalCharge,
  };
  const pairedScoringAtomMap = entry.tier === 'paired-crystal'
    ? [...atomMap.commonAtoms, ...atomMap.addedProductAtoms]
      .map(({ productAtomIndex, productAtomName }) => ({ productAtomIndex, analogueAtomName:productAtomName }))
      .sort((first, second) => first.productAtomIndex - second.productAtomIndex)
    : null;
  const groundTruth = entry.tier === 'paired-crystal' ? {
    analogueCrystalAvailable:true,
    accuracyMetricsAllowed:true,
    withheldFromRunInput:true,
    pdbId:fixture.analogue.pdbId,
    ligandComponentId:fixture.analogue.componentId,
    ligandChain:fixture.analogue.selection.chain,
    ligandResidueNumber:fixture.analogue.selection.residueNumber,
    ligandInsertionCode:fixture.analogue.selection.insertionCode,
    alternateLocation:fixture.analogue.selection.alternateLocation,
    coordinateFile:fixture.analogue.coordinateFile,
    coordinateSha256:fixture.analogue.coordinateSha256,
    atomMappingStatus:'frozen-product-index-to-analogue-ccd-atom-name',
    scoringAtomMap:pairedScoringAtomMap,
  } : { analogueCrystalAvailable:false, accuracyMetricsAllowed:false };
  return {
    id:entry.id,
    tier:entry.tier,
    proteinTarget:entry.proteinTarget,
    reference:referenceRecord(fixture.reference),
    product,
    transformation:{ ...entry.transformation, recordedEditRequired:true,
      description:`Pre-registered ${entry.transformation.name}; no result-dependent case editing is allowed.` },
    posePropagationMap:{
      source:'atom-maps.v0.1.json',
      commonHeavyAtoms:atomMap.commonHeavyAtoms,
      referenceHeavyAtoms:atomMap.referenceHeavyAtoms,
      productHeavyAtoms:atomMap.productHeavyAtoms,
      mcs:atomMap.mcs,
      mappedProductSmiles:atomMap.mappedProductSmiles,
      commonAtoms:atomMap.commonAtoms.map(({ productAtomName, ...common }) => common),
      deletedReferenceAtoms:atomMap.deletedReferenceAtoms,
      addedProductAtoms:atomMap.addedProductAtoms.map(({ productAtomName, ...added }) => added),
      referenceBoundary:atomMap.referenceBoundary,
      productBoundary:atomMap.productBoundary,
      targetFeatureDisposition:atomMap.targetFeatureDisposition,
    },
    interactionHypotheses,
    preparation:{ protocol:interactionScan.value.preparationProtocol,
      blockers:scan.preparationBlockers, warnings:scan.preparationWarnings,
      preparedAtomCount:scan.preparedAtoms,
      capturedHydrogenBondCount:scan.capturedHydrogenBonds.length,
      capturedPiStackCount:scan.ligandPiStacks.length },
    groundTruth,
    protocol:{ id:plan.value.protocol.id, version:plan.value.protocol.version,
      searchChains:plan.value.protocol.defaultSearchChains,
      seeds:plan.value.protocol.repeatSeeds },
    expectedOutcome:entry.expectedOutcome || null,
    status:scan.preparationBlockers.length ? 'preparation-blocked' : 'pre-registered',
    result:null,
  };
});

const runInput = {
  schemaVersion:1,
  datasetId:curation.value.datasetId,
  version:curation.value.version,
  purpose:'Pose-generation input. Hidden analogue coordinates and scoring selections are absent by construction.',
  protocol:plan.value.protocol,
  cases:cases.map(({ groundTruth, result, ...entry }) => entry),
};
const runInputText = `${JSON.stringify(runInput, null, 2)}\n`;
await writeFile(path.join(root, 'run-input.v0.1.json'), runInputText);

const manifest = {
  schemaVersion:1,
  datasetId:curation.value.datasetId,
  version:curation.value.version,
  status:plan.value.status,
  selectionFrozenBeforeDocking:true,
  studyPlan:'study-plan.v0.1.json',
  sourceHashes:{
    studyPlanSha256:sha256(plan.bytes),
    curationSha256:sha256(curation.bytes),
    curationValidationSha256:sha256(curationValidation.bytes),
    fixtureValidationSha256:sha256(fixtureValidation.bytes),
    atomMapsSha256:sha256(atomMaps.bytes),
    interactionScanSha256:sha256(interactionScan.bytes),
    runInputSha256:sha256(runInputText),
  },
  cases,
};
await writeFile(path.join(root, 'manifest.v0.1.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Bioisostere benchmark manifest: BUILT (${cases.length} cases; ${cases.filter((entry) => entry.status === 'preparation-blocked').length} preparation blockers retained)`);
