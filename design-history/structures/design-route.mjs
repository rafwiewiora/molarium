import { EXACT_REGISTERED_POSE_PROPAGATION_POLICY,
  validateRegisteredPosePropagationPolicy } from
  '../../docking/registered-graph-edit.mjs';

export const REGISTERED_DESIGN_ROUTE_SCHEMA = 'molarium.registered-design-route/v1';

const LEDGER_ONLY_FIELDS = Object.freeze([
  'campaignId', 'objects', 'branches', 'events', 'campaignSha256',
]);

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireStringArray(value, label) {
  if (!Array.isArray(value) || !value.length
    || value.some((entry) => typeof entry !== 'string' || !entry.trim()))
    throw new Error(`${label} must be a non-empty array of strings`);
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error(`${label} must be a SHA-256 digest`);
  return value;
}

function requireNonnegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${label} must be a nonnegative integer`);
  return value;
}

function exactIntegerPartition(indices, size, label) {
  if (indices.length !== size || new Set(indices).size !== size
    || indices.some((value) => !Number.isInteger(value) || value < 0 || value >= size))
    throw new Error(`${label} must exactly partition indices 0 through ${size - 1}`);
}

function validatePoseMap(poseMap, index) {
  const label = `steps[${index}].posePropagationMap`;
  const referenceHeavyAtoms = requireNonnegativeInteger(
    poseMap.referenceHeavyAtoms, `${label}.referenceHeavyAtoms`);
  const productHeavyAtoms = requireNonnegativeInteger(
    poseMap.productHeavyAtoms, `${label}.productHeavyAtoms`);
  const commonHeavyAtoms = requireNonnegativeInteger(
    poseMap.commonHeavyAtoms, `${label}.commonHeavyAtoms`);
  if (commonHeavyAtoms < 3)
    throw new Error(`${label} must retain at least three exact heavy atoms`);
  for (const field of ['commonAtoms', 'deletedReferenceAtoms', 'addedProductAtoms',
    'referenceBoundary', 'productBoundary']) {
    if (!Array.isArray(poseMap[field])) throw new Error(`${label}.${field} must be an array`);
  }
  if (poseMap.commonAtoms.length !== commonHeavyAtoms)
    throw new Error(`${label}.commonAtoms count changed`);
  const referenceNames = [], referenceIndices = [], productIndices = [];
  poseMap.commonAtoms.forEach((entry, atomIndex) => {
    requireRecord(entry, `${label}.commonAtoms[${atomIndex}]`);
    requireString(entry.referenceAtomName,
      `${label}.commonAtoms[${atomIndex}].referenceAtomName`);
    requireString(entry.element, `${label}.commonAtoms[${atomIndex}].element`);
    referenceNames.push(entry.referenceAtomName);
    referenceIndices.push(requireNonnegativeInteger(entry.referenceAtomIndex,
      `${label}.commonAtoms[${atomIndex}].referenceAtomIndex`));
    productIndices.push(requireNonnegativeInteger(entry.productAtomIndex,
      `${label}.commonAtoms[${atomIndex}].productAtomIndex`));
  });
  if (new Set(referenceNames).size !== referenceNames.length)
    throw new Error(`${label}.commonAtoms repeats a reference atom name`);
  if (new Set(referenceIndices).size !== referenceIndices.length
    || new Set(productIndices).size !== productIndices.length)
    throw new Error(`${label}.commonAtoms must be a one-to-one atom map`);
  const deletedIndices = poseMap.deletedReferenceAtoms.map((entry, atomIndex) => {
    requireRecord(entry, `${label}.deletedReferenceAtoms[${atomIndex}]`);
    requireString(entry.referenceAtomName,
      `${label}.deletedReferenceAtoms[${atomIndex}].referenceAtomName`);
    return requireNonnegativeInteger(entry.referenceAtomIndex,
      `${label}.deletedReferenceAtoms[${atomIndex}].referenceAtomIndex`);
  });
  const addedIndices = poseMap.addedProductAtoms.map((entry, atomIndex) => {
    requireRecord(entry, `${label}.addedProductAtoms[${atomIndex}]`);
    return requireNonnegativeInteger(entry.productAtomIndex,
      `${label}.addedProductAtoms[${atomIndex}].productAtomIndex`);
  });
  exactIntegerPartition([...referenceIndices, ...deletedIndices], referenceHeavyAtoms,
    `${label} reference atom map`);
  exactIntegerPartition([...productIndices, ...addedIndices], productHeavyAtoms,
    `${label} product atom map`);
  const commonNameSet = new Set(referenceNames), commonProductSet = new Set(productIndices);
  poseMap.referenceBoundary.forEach((entry, boundaryIndex) => {
    requireRecord(entry, `${label}.referenceBoundary[${boundaryIndex}]`);
    if (!commonNameSet.has(entry.commonAtomName))
      throw new Error(`${label}.referenceBoundary must identify a common atom`);
  });
  poseMap.productBoundary.forEach((entry, boundaryIndex) => {
    requireRecord(entry, `${label}.productBoundary[${boundaryIndex}]`);
    if (!commonProductSet.has(entry.commonProductAtomIndex))
      throw new Error(`${label}.productBoundary must identify a common product atom`);
  });
  const mcs = requireRecord(poseMap.mcs, `${label}.mcs`);
  requireString(mcs.smarts, `${label}.mcs.smarts`);
  if (mcs.atoms !== commonHeavyAtoms)
    throw new Error(`${label}.mcs atom count changed`);
  requireNonnegativeInteger(mcs.bonds, `${label}.mcs.bonds`);
  return { referenceNames };
}

/**
 * Validate a registered graph-edit route. This is deliberately not a design
 * campaign ledger: routes define allowed inputs and ordered graph steps;
 * ledgers record immutable snapshots, commits, branches, and decisions.
 */
export function validateRegisteredDesignRoute(route, { expectedId = null } = {}) {
  requireRecord(route, 'Registered design route');
  if (route.schema !== REGISTERED_DESIGN_ROUTE_SCHEMA)
    throw new Error(`Registered design route schema must be ${REGISTERED_DESIGN_ROUTE_SCHEMA}`);
  for (const field of LEDGER_ONLY_FIELDS) {
    if (Object.hasOwn(route, field))
      throw new Error(`Registered design route must not contain ledger field ${field}`);
  }

  requireString(route.id, 'Registered design route id');
  if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(route.id))
    throw new Error('Registered design route id must be a stable identifier');
  if (expectedId !== null && route.id !== expectedId)
    throw new Error(`Registered design route id ${route.id} does not match ${expectedId}`);
  requireString(route.title, 'Registered design route title');
  // v1 route artifacts were frozen before the transfer policy became an
  // explicit runtime object. Derive the only valid v1 policy after parsing so
  // their hash-pinned bytes remain unchanged. A supplied policy is still
  // validated strictly and cannot opt into element-agnostic hard matching.
  if (route.posePropagationPolicy == null)
    route.posePropagationPolicy = structuredClone(EXACT_REGISTERED_POSE_PROPAGATION_POLICY);
  else validateRegisteredPosePropagationPolicy(route.posePropagationPolicy);

  const boundary = requireRecord(route.protocolBoundary, 'protocolBoundary');
  requireStringArray(boundary.coordinateInputs, 'protocolBoundary.coordinateInputs');
  requireStringArray(boundary.allowedLaterInputs, 'protocolBoundary.allowedLaterInputs');
  requireStringArray(boundary.forbiddenBeforeFreeze, 'protocolBoundary.forbiddenBeforeFreeze');

  const hit = requireRecord(route.hit, 'hit');
  for (const field of ['pdbId', 'stateId', 'ligand', 'proteinAsset', 'ligandAsset'])
    requireString(hit[field], `hit.${field}`);
  requireSha256(hit.proteinSha256, 'hit.proteinSha256');
  requireSha256(hit.ligandSha256, 'hit.ligandSha256');
  requireRecord(hit.ligandDefinition, 'hit.ligandDefinition');

  if (!Array.isArray(route.steps) || !route.steps.length)
    throw new Error('Registered design route steps must be a non-empty array');
  const stepIds = new Set();
  for (const [index, step] of route.steps.entries()) {
    requireRecord(step, `steps[${index}]`);
    requireString(step.id, `steps[${index}].id`);
    if (stepIds.has(step.id)) throw new Error(`Duplicate registered design step: ${step.id}`);
    stepIds.add(step.id);
    requireString(step.stateId, `steps[${index}].stateId`);
    if (step.productComponentId != null) {
      requireString(step.productComponentId, `steps[${index}].productComponentId`);
      if (!/^[A-Za-z0-9]{1,3}$/.test(step.productComponentId))
        throw new Error(`steps[${index}].productComponentId must be a one-to-three character component ID`);
    }
    requireString(step.label, `steps[${index}].label`);
    requireString(step.inputKind, `steps[${index}].inputKind`);
    requireString(step.productSmiles, `steps[${index}].productSmiles`);
    const poseMap = requireRecord(step.posePropagationMap,
      `steps[${index}].posePropagationMap`);
    const { referenceNames:commonNames } = validatePoseMap(poseMap, index);
    const protectedAnchor = poseMap.protectedReferenceAnchor;
    if (protectedAnchor != null) {
      requireRecord(protectedAnchor,
        `steps[${index}].posePropagationMap.protectedReferenceAnchor`);
      requireString(protectedAnchor.method,
        `steps[${index}].posePropagationMap.protectedReferenceAnchor.method`);
      requireString(protectedAnchor.label,
        `steps[${index}].posePropagationMap.protectedReferenceAnchor.label`);
      const protectedNames = requireStringArray(protectedAnchor.referenceAtomNames,
        `steps[${index}].posePropagationMap.protectedReferenceAnchor.referenceAtomNames`);
      if (new Set(protectedNames).size !== protectedNames.length
        || protectedNames.length !== commonNames.length
        || protectedNames.some((name, atomIndex) => name !== commonNames[atomIndex]))
        throw new Error(`steps[${index}] protected anchor must exactly identify the fixed common atoms`);
      if (protectedAnchor.atoms !== protectedNames.length)
        throw new Error(`steps[${index}] protected anchor atom count changed`);
    }
  }

  const generator = requireRecord(route.generator, 'generator');
  requireString(generator.path, 'generator.path');
  requireStringArray(generator.coordinateFilesRead, 'generator.coordinateFilesRead');
  const evaluation = requireRecord(route.evaluation, 'evaluation');
  requireString(evaluation.status, 'evaluation.status');
  if (!Array.isArray(evaluation.holdouts))
    throw new Error('evaluation.holdouts must be an array');
  return route;
}
