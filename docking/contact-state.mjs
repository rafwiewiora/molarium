import { evaluateHydrogenBondConstraint } from './constraints.mjs';
import { MOLARIUM_CONSTRAINT_DOCK_PROTOCOL } from './protocol.mjs';
import { perceiveHydrogenBondFeature } from './contact-remap.mjs';

export function unresolvedContactMessage(contactIds, definitions) {
  const labels = new Map(definitions.map((entry) => [entry.id, entry.label]));
  const contacts = contactIds.map((id) => labels.get(id) ? `${labels.get(id)} [${id}]` : id);
  return `Required contact${contacts.length === 1 ? '' : 's'} ${contacts.join('; ')} `
    + `${contacts.length === 1 ? 'has' : 'have'} no role-compatible replacement feature. `
    + 'Explicitly revise the contact requirement or continue editing; no constraint was dropped.';
}

// A captured label identifies a historical hypothesis, even after its atom is
// removed. Never resolve by array position, fuzzy text, or current geometry.
export function resolveContactRequirement(definitions, args) {
  const byId = Object.hasOwn(args, 'contactId');
  const byLabel = Object.hasOwn(args, 'contactLabel');
  if (byId === byLabel) throw new Error('Provide exactly one contactId or contactLabel');
  const value = byId ? args.contactId : args.contactLabel;
  if (typeof value !== 'string' || !value.trim()) throw new Error('Contact selector must be a non-empty string');
  if (typeof args.required !== 'boolean') throw new Error('required must be boolean');
  if (args.ifAbsent != null && (args.ifAbsent !== 'record-omission' || byId || args.required))
    throw new Error('ifAbsent:record-omission requires contactLabel and required:false');
  const matches = definitions.filter((entry) => (byId ? entry.id : entry.label) === value);
  if (matches.length > 1) throw new Error(`Ambiguous captured contact: ${value}`);
  if (!matches.length && args.ifAbsent !== 'record-omission')
    throw new Error(`Unknown captured contact: ${value}`);
  return matches[0] || null;
}

// DV-01: graph availability is not permission to change a designer's intent.
export function requiredContactPolicy(definitions, priorRequiredIds, hypotheses = []) {
  const prior = new Set(priorRequiredIds);
  const authored = new Map();
  for (const hypothesis of hypotheses.filter((entry) => entry.kind === 'hydrogen-bond')) {
    if (authored.has(hypothesis.capturedId)) throw new Error('Duplicate captured contact hypothesis');
    if (hypothesis.required != null && typeof hypothesis.required !== 'boolean')
      throw new Error('An authored contact requirement must be boolean');
    authored.set(hypothesis.capturedId, hypothesis);
  }
  const decisions = definitions.map((definition) => {
    const hypothesis = authored.get(definition.id);
    if (!hypothesis || hypothesis.label !== definition.label)
      throw new Error(`Captured contact ${definition.id} differs from the pre-registered input`);
    return { contactId:definition.id, beforeRequired:prior.has(definition.id),
      required:hypothesis.required ?? prior.has(definition.id),
      decisionSource:typeof hypothesis.required === 'boolean'
        ? 'explicit-authored-requirement' : 'preserved-prior-requirement' };
  });
  return { schema:'molarium.docking.required-contact-policy/v1',
    availabilityChangesIntent:false, decisions,
    requiredContactIds:decisions.filter((entry) => entry.required).map((entry) => entry.contactId) };
}

// DV-02: this measures the displayed molecule, never candidate/captured points.
export function liveHydrogenBondState(molecule, definition, {
  available = true, includeCoordinates = false,
  atomsById = new Map(molecule.atoms.map((atom, index) => [atom.designAtomId, { atom, index }])),
  settings = MOLARIUM_CONSTRAINT_DOCK_PROTOCOL.hydrogenBondConstraint,
} = {}) {
  const missingAtomIds = [], incompatibleAtomIds = [], invalidCoordinateAtomIds = [];
  const points = {};
  const participants = Object.fromEntries(['donor','hydrogen','acceptor'].map((role) => {
    const descriptor = definition?.[role];
    if (!descriptor) return [role, null];
    const atom = atomsById.get(descriptor.designAtomId)?.atom;
    if (!atom) missingAtomIds.push(descriptor.designAtomId);
    else {
      if (descriptor.element && atom.element !== descriptor.element)
        incompatibleAtomIds.push(descriptor.designAtomId);
      if (['x','y','z'].every((axis) => Number.isFinite(atom[axis]))) points[role] = atom;
      else invalidCoordinateAtomIds.push(descriptor.designAtomId);
    }
    return [role, { scope:descriptor.scope, atomId:descriptor.designAtomId || null,
      element:atom?.element || descriptor.element || null,
      present:Boolean(atom),
      ...(includeCoordinates && points[role]
        ? { coordinatesAngstrom:[atom.x,atom.y,atom.z] } : {}) }];
  }));
  const donorIndex = atomsById.get(definition?.donor?.designAtomId)?.index;
  const hydrogenIndex = atomsById.get(definition?.hydrogen?.designAtomId)?.index;
  const acceptorIndex = atomsById.get(definition?.acceptor?.designAtomId)?.index;
  const donor = perceiveHydrogenBondFeature(molecule, donorIndex, 'donor');
  const acceptor = perceiveHydrogenBondFeature(molecule, acceptorIndex, 'acceptor');
  const roleCompatible = Boolean(donor?.hydrogenIndices.includes(hydrogenIndex) && acceptor);
  const measurable = Boolean(points.donor && points.hydrogen && points.acceptor);
  const geometry = measurable ? evaluateHydrogenBondConstraint(points, settings) : null;
  const contactAvailable = Boolean(available && !missingAtomIds.length
    && !incompatibleAtomIds.length && !invalidCoordinateAtomIds.length && roleCompatible);
  return { receptorRole:definition?.receptorRole || null,
    geometrySource:'current-molecule-coordinates', measurable,
    available:contactAvailable, roleCompatible,
    satisfied:contactAvailable && Boolean(geometry?.satisfied),
    donorAcceptorDistanceAngstrom:geometry?.donorAcceptorDistanceAngstrom ?? null,
    hydrogenAcceptorDistanceAngstrom:geometry?.hydrogenAcceptorDistanceAngstrom ?? null,
    dhaAngleDegrees:geometry?.dhaAngleDegrees ?? null,
    violations:geometry?.violations ?? null,
    missingAtomIds:[...new Set(missingAtomIds)],
    incompatibleAtomIds:[...new Set(incompatibleAtomIds)],
    invalidCoordinateAtomIds:[...new Set(invalidCoordinateAtomIds)], participants };
}
