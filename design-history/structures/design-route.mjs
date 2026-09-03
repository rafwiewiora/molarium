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
    if (!Array.isArray(poseMap.commonAtoms) || !poseMap.commonAtoms.length)
      throw new Error(`steps[${index}].posePropagationMap.commonAtoms must be non-empty`);
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
      const commonNames = poseMap.commonAtoms.map((entry) => entry.referenceAtomName);
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
