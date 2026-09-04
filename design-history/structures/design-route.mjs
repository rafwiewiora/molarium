import { EXACT_REGISTERED_POSE_PROPAGATION_POLICY,
  validateRegisteredPosePropagationPolicy } from
  '../../docking/registered-graph-edit.mjs';
import { validateRegisteredSoftSpatialFeatureRestraint } from
  '../../docking/registered-spatial-feature-restraint.mjs';

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

function validateRetainedFeatureIntents(value, index) {
  const label = `steps[${index}].retainedFeatureIntents`;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const byId = new Map();
  value.forEach((intent, intentIndex) => {
    const intentLabel = `${label}[${intentIndex}]`;
    requireRecord(intent, intentLabel);
    requireString(intent.id, `${intentLabel}.id`);
    const featureId = requireString(intent.featureId, `${intentLabel}.featureId`);
    if (byId.has(featureId)) throw new Error(`${label} repeats ${featureId}`);
    if (intent.kind !== 'conserved-fragment-rmsd'
      || intent.actorClass !== 'human'
      || intent.source !== 'registered-designer-intent'
      || intent.treatment !== 'soft-restraint'
      || intent.required !== true)
      throw new Error(`${intentLabel} is not an explicit required designer retention decision`);
    const restraint = validateRegisteredSoftSpatialFeatureRestraint(
      intent.restraint, `${intentLabel}.restraint`);
    requireString(intent.rationale, `${intentLabel}.rationale`);
    byId.set(featureId, intent);
  });
  return byId;
}

function validatePoseMap(poseMap, index, retainedFeatureIntents) {
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
  const referenceElementByName = new Map([
    ...poseMap.commonAtoms.map((entry) => [entry.referenceAtomName, entry.element]),
    ...poseMap.deletedReferenceAtoms.map((entry) => [entry.referenceAtomName, entry.element]),
  ]);
  const productElementByIndex = new Map([
    ...poseMap.commonAtoms.map((entry) => [entry.productAtomIndex, entry.element]),
    ...poseMap.addedProductAtoms.map((entry) => [entry.productAtomIndex, entry.element]),
  ]);
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
  const releasedMappedAtoms = poseMap.releasedMappedAtoms ?? [];
  if (!Array.isArray(releasedMappedAtoms))
    throw new Error(`${label}.releasedMappedAtoms must be an array`);
  const commonByReferenceName = new Map(poseMap.commonAtoms.map((entry) =>
    [entry.referenceAtomName, entry]));
  const releasedMappedNames = [];
  const releasedMappedProductIndices = [];
  releasedMappedAtoms.forEach((entry, releasedIndex) => {
    const releasedLabel = `${label}.releasedMappedAtoms[${releasedIndex}]`;
    requireRecord(entry, releasedLabel);
    requireString(entry.referenceAtomName, `${releasedLabel}.referenceAtomName`);
    requireString(entry.reason, `${releasedLabel}.reason`);
    const productAtomIndex = requireNonnegativeInteger(entry.productAtomIndex,
      `${releasedLabel}.productAtomIndex`);
    const commonEntry = commonByReferenceName.get(entry.referenceAtomName);
    if (!commonEntry || commonEntry.productAtomIndex !== productAtomIndex
      || commonEntry.referenceAtomIndex !== entry.referenceAtomIndex
      || commonEntry.element !== entry.element)
      throw new Error(`${releasedLabel} must exactly identify a mapped common atom`);
    releasedMappedNames.push(entry.referenceAtomName);
    releasedMappedProductIndices.push(productAtomIndex);
  });
  if (new Set(releasedMappedNames).size !== releasedMappedNames.length
    || new Set(releasedMappedProductIndices).size !== releasedMappedProductIndices.length)
    throw new Error(`${label}.releasedMappedAtoms must be one-to-one`);
  const migrations = poseMap.mappedRingAttachmentMigrations ?? [];
  if (!Array.isArray(migrations))
    throw new Error(`${label}.mappedRingAttachmentMigrations must be an array`);
  const migrationReleasedNames = [];
  migrations.forEach((migration, migrationIndex) => {
    const migrationLabel = `${label}.mappedRingAttachmentMigrations[${migrationIndex}]`;
    requireRecord(migration, migrationLabel);
    requireString(migration.id, `${migrationLabel}.id`);
    if (migration.reason !== 'attachment-migration-within-mapped-biconnected-ring')
      throw new Error(`${migrationLabel}.reason changed`);
    for (const field of ['referenceBlockAtomNames', 'referenceAttachmentAtomNames',
      'productAttachmentReferenceAtomNames', 'releasedReferenceAtomNames'])
      requireStringArray(migration[field], `${migrationLabel}.${field}`);
    if (!Array.isArray(migration.retainedJunctionReferenceAtomNames)
      || migration.retainedJunctionReferenceAtomNames.some((value) =>
        typeof value !== 'string' || !value.trim()))
      throw new Error(`${migrationLabel}.retainedJunctionReferenceAtomNames must be a string array`);
    if (!Array.isArray(migration.productBlockAtomIndices)
      || !Array.isArray(migration.releasedProductAtomIndices)
      || migration.productBlockAtomIndices.some((value) => !Number.isInteger(value))
      || migration.releasedProductAtomIndices.some((value) => !Number.isInteger(value)))
      throw new Error(`${migrationLabel} product atom indices must be integer arrays`);
    migrationReleasedNames.push(...migration.releasedReferenceAtomNames);
  });
  if (new Set(migrationReleasedNames).size !== migrationReleasedNames.length
    || migrationReleasedNames.length !== releasedMappedNames.length
    || releasedMappedNames.some((name) => !migrationReleasedNames.includes(name)))
    throw new Error(`${label} ring migrations must exactly explain released mapped atoms`);
  const releasedMappedHeavyAtoms = requireNonnegativeInteger(
    poseMap.releasedMappedHeavyAtoms ?? releasedMappedAtoms.length,
    `${label}.releasedMappedHeavyAtoms`);
  const hardCoordinateHeavyAtoms = requireNonnegativeInteger(
    poseMap.hardCoordinateHeavyAtoms ?? commonHeavyAtoms,
    `${label}.hardCoordinateHeavyAtoms`);
  if (releasedMappedHeavyAtoms !== releasedMappedAtoms.length
    || hardCoordinateHeavyAtoms + releasedMappedHeavyAtoms !== commonHeavyAtoms)
    throw new Error(`${label} hard and released mapped atom counts must partition the common map`);
  const spatialFeatures = poseMap.spatialFeatureCorrespondences ?? [];
  if (!Array.isArray(spatialFeatures))
    throw new Error(`${label}.spatialFeatureCorrespondences must be an array`);
  const hardReferenceNames = new Set(referenceNames);
  const hardProductIndices = new Set(productIndices);
  spatialFeatures.forEach((feature, featureIndex) => {
    const featureLabel = `${label}.spatialFeatureCorrespondences[${featureIndex}]`;
    requireRecord(feature, featureLabel);
    requireString(feature.id, `${featureLabel}.id`);
    if (feature.kind !== 'conserved-fragment-rmsd')
      throw new Error(`${featureLabel}.kind must be conserved-fragment-rmsd`);
    if (!['seed-only', 'soft-restraint'].includes(feature.treatment))
      throw new Error(`${featureLabel}.treatment must be seed-only or soft-restraint`);
    if (feature.treatment === 'seed-only') {
      if (feature.transferMode !== 'seed-only' || feature.required !== false)
        throw new Error(`${featureLabel} seed-only transfer must be explicitly non-required`);
      if (feature.restraint != null)
        throw new Error(`${featureLabel} seed-only transfer must not define a restraint`);
    } else if (feature.transferMode !== 'score-only') {
      throw new Error(`${featureLabel} soft restraint must use score-only transfer mode`);
    }
    if (!Array.isArray(feature.mappingVariants) || !feature.mappingVariants.length)
      throw new Error(`${featureLabel}.mappingVariants must be a non-empty array`);
    feature.mappingVariants.forEach((variant, variantIndex) => {
      const variantLabel = `${featureLabel}.mappingVariants[${variantIndex}]`;
      requireRecord(variant, variantLabel);
      if (!Array.isArray(variant.referenceAtomNames)
        || !Array.isArray(variant.productAtomIndices)
        || variant.referenceAtomNames.length < 3
        || variant.referenceAtomNames.length !== variant.productAtomIndices.length)
        throw new Error(`${variantLabel} must contain paired reference names and product indices`);
      variant.referenceAtomNames.forEach((name) => requireString(name,
        `${variantLabel}.referenceAtomNames`));
      variant.productAtomIndices.forEach((atomIndex) => {
        requireNonnegativeInteger(atomIndex, `${variantLabel}.productAtomIndices`);
        if (atomIndex >= productHeavyAtoms)
          throw new Error(`${variantLabel} product atom is outside the product graph`);
      });
      if (new Set(variant.referenceAtomNames).size !== variant.referenceAtomNames.length
        || new Set(variant.productAtomIndices).size !== variant.productAtomIndices.length)
        throw new Error(`${variantLabel} must be one-to-one`);
      if (variant.referenceAtomNames.some((name) => hardReferenceNames.has(name))
        || variant.productAtomIndices.some((atomIndex) => hardProductIndices.has(atomIndex)))
        throw new Error(`${variantLabel} overlaps the hard correspondence`);
      variant.referenceAtomNames.forEach((name, pairIndex) => {
        if (!referenceElementByName.has(name)
          || referenceElementByName.get(name)
            !== productElementByIndex.get(variant.productAtomIndices[pairIndex]))
          throw new Error(`${variantLabel} is not element-equivalent`);
      });
    });
    const productSets = feature.mappingVariants.map((variant) =>
      [...variant.productAtomIndices].sort((a, b) => a - b).join(','));
    if (new Set(productSets).size !== 1)
      throw new Error(`${featureLabel} variants must describe one product fragment`);
    const featureMcs = requireRecord(feature.mcs, `${featureLabel}.mcs`);
    if (featureMcs.atoms !== feature.mappingVariants[0].productAtomIndices.length
      || !Number.isInteger(featureMcs.bonds)
      || featureMcs.bonds < featureMcs.atoms - 1)
      throw new Error(`${featureLabel}.mcs does not describe a connected exact feature`);
    if (feature.treatment === 'soft-restraint') {
      const restraint = validateRegisteredSoftSpatialFeatureRestraint(
        feature.restraint, `${featureLabel}.restraint`);
      if (typeof feature.required !== 'boolean' || restraint.required !== feature.required)
        throw new Error(`${featureLabel} soft-restraint required flags must agree`);
      if (feature.required && feature.source !== 'registered-designer-intent')
        throw new Error(`${featureLabel} required soft restraint must be registered designer intent`);
      if (feature.required) {
        const intent = retainedFeatureIntents.get(feature.id);
        if (!intent || feature.registeredIntentId !== intent.id)
          throw new Error(`${featureLabel} lacks its registered route intent declaration`);
        if (feature.kind !== intent.kind || feature.treatment !== intent.treatment
          || feature.source !== intent.source
          || restraint.metric !== intent.restraint.metric
          || Number(restraint.toleranceAngstrom) !== Number(intent.restraint.toleranceAngstrom)
          || Number(restraint.weightKcalMolPerAngstrom2)
            !== Number(intent.restraint.weightKcalMolPerAngstrom2)
          || JSON.stringify(restraint.parameterDecision)
            !== JSON.stringify(intent.restraint.parameterDecision))
          throw new Error(`${featureLabel} does not match its registered route intent`);
      }
    }
  });
  for (const featureId of retainedFeatureIntents.keys()) {
    if (!spatialFeatures.some((feature) => feature.id === featureId && feature.required === true))
      throw new Error(`${label} did not realize retained feature intent ${featureId}`);
  }
  return { referenceNames, releasedMappedNames };
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
    const retainedFeatureIntents = validateRetainedFeatureIntents(
      step.retainedFeatureIntents ?? [], index);
    const poseMap = requireRecord(step.posePropagationMap,
      `steps[${index}].posePropagationMap`);
    const { referenceNames:commonNames, releasedMappedNames } = validatePoseMap(
      poseMap, index, retainedFeatureIntents);
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
      const releasedSet = new Set(releasedMappedNames);
      const expectedProtectedNames = commonNames.filter((name) => !releasedSet.has(name));
      if (new Set(protectedNames).size !== protectedNames.length
        || protectedNames.length !== expectedProtectedNames.length
        || protectedNames.some((name, atomIndex) => name !== expectedProtectedNames[atomIndex]))
        throw new Error(`steps[${index}] protected anchor must exactly identify the hard common atoms`);
      if (protectedAnchor.atoms !== protectedNames.length)
        throw new Error(`steps[${index}] protected anchor atom count changed`);
    } else if (releasedMappedNames.length) {
      throw new Error(`steps[${index}] released mapped atoms require a protected anchor`);
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
