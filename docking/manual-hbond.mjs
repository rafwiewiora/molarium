import { perceiveHydrogenBondFeature } from './contact-remap.mjs';

export const MANUAL_HBOND_SCHEMA = 'molarium.docking.manual-hydrogen-bond/v1';

const IDEAL_DA_ANGSTROM = 2.9;
const IDEAL_HA_ANGSTROM = 1.9;

function finitePoint(atom, label = 'atom') {
  const point = { x:Number(atom?.x), y:Number(atom?.y), z:Number(atom?.z) };
  if (![point.x, point.y, point.z].every(Number.isFinite))
    throw new Error(`${label} has no finite coordinates`);
  return point;
}

function vector(from, to) {
  return { x:to.x - from.x, y:to.y - from.y, z:to.z - from.z };
}

function unit(value, fallback = { x:1, y:0, z:0 }) {
  const length = Math.hypot(value.x, value.y, value.z);
  return length > 1e-10
    ? { x:value.x / length, y:value.y / length, z:value.z / length }
    : { ...fallback };
}

function advanced(point, direction, distance) {
  return { x:point.x + direction.x * distance,
    y:point.y + direction.y * distance,
    z:point.z + direction.z * distance };
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}

function geometry(donor, hydrogen, acceptor) {
  const hd = vector(hydrogen, donor), ha = vector(hydrogen, acceptor);
  const denominator = Math.hypot(hd.x, hd.y, hd.z) * Math.hypot(ha.x, ha.y, ha.z);
  const cosine = denominator ? Math.max(-1, Math.min(1,
    (hd.x * ha.x + hd.y * ha.y + hd.z * ha.z) / denominator)) : 1;
  return { donorAcceptorDistanceAngstrom:distance(donor, acceptor),
    hydrogenAcceptorDistanceAngstrom:distance(hydrogen, acceptor),
    dhaAngleDegrees:Math.acos(cosine) * 180 / Math.PI };
}

function geometryScore(value) {
  return Math.abs(value.hydrogenAcceptorDistanceAngstrom - IDEAL_HA_ANGSTROM)
    + 0.5 * Math.abs(value.donorAcceptorDistanceAngstrom - IDEAL_DA_ANGSTROM)
    + Math.max(0, 150 - value.dhaAngleDegrees) / 30;
}

function adjacency(molecule) {
  const entries = molecule.atoms.map(() => []);
  molecule.bonds.forEach((bond) => {
    entries[bond.a]?.push(bond.b); entries[bond.b]?.push(bond.a);
  });
  return entries;
}

function normalizedFeatureAtom(molecule, atomIndex, entries) {
  const atom = molecule.atoms[atomIndex];
  if (!atom) throw new Error(`Atom ${atomIndex} is outside the molecular graph`);
  if (atom.element !== 'H') return atomIndex;
  const parents = entries[atomIndex].filter((index) => molecule.atoms[index]?.element !== 'H');
  if (parents.length !== 1)
    throw new Error('Select the donor heavy atom rather than an unbound or ambiguous hydrogen');
  return parents[0];
}

function atomLabel(atom, index) {
  const residue = atom?.residueName
    ? `${atom.residueName} ${atom.chain || ''}${atom.residueIndex ?? ''}`.trim() : 'ligand';
  return `${residue} ${atom?.atomName || `${atom?.element || '?'}${index + 1}`}`;
}

function ligandDescriptor(molecule, atomIndex, role, feature, referencePoint = null) {
  const atom = molecule.atoms[atomIndex];
  return { scope:'ligand', designAtomId:atom.designAtomId, element:atom.element,
    ...(role === 'acceptor' || role === 'donor'
      ? { featureSignature:feature.signature } : {}),
    ...(referencePoint ? { referencePoint:{ ...referencePoint } } : {}) };
}

function receptorDescriptor(molecule, atomIndex) {
  const atom = molecule.atoms[atomIndex];
  return { scope:'receptor', point:finitePoint(atom), sourceGlobalAtomIndex:atomIndex,
    designAtomId:atom.designAtomId, element:atom.element };
}

function bestHydrogen(molecule, indices, targetPoint) {
  return [...indices].map((index) => ({ index,
    distance:distance(finitePoint(molecule.atoms[index]), targetPoint) }))
    .sort((first, second) => first.distance - second.distance || first.index - second.index)[0];
}

function optionSort(first, second) {
  if (first.ligandRole !== second.ligandRole)
    return first.ligandRole < second.ligandRole ? -1 : 1;
  return first.currentGeometryScore - second.currentGeometryScore;
}

export function manualHydrogenBondOptions({ molecule, ligandAtomIndices,
  ligandAtomIndex, receptorAtomIndex } = {}) {
  if (!molecule?.atoms?.length || !Array.isArray(molecule.bonds))
    throw new Error('A complete molecular graph is required');
  const ligand = new Set(Array.from(ligandAtomIndices || [], Number));
  const entries = adjacency(molecule);
  const ligandFeatureAtomIndex = normalizedFeatureAtom(molecule, Number(ligandAtomIndex), entries);
  const receptorFeatureAtomIndex = normalizedFeatureAtom(molecule, Number(receptorAtomIndex), entries);
  if (!ligand.has(ligandFeatureAtomIndex))
    throw new Error('Pick a donor or acceptor on the editable ligand first');
  if (ligand.has(receptorFeatureAtomIndex))
    throw new Error('The second atom must belong to the receptor or a retained water');
  const ligandAtom = molecule.atoms[ligandFeatureAtomIndex];
  const receptorAtom = molecule.atoms[receptorFeatureAtomIndex];
  if (!ligandAtom.designAtomId || !receptorAtom.designAtomId)
    throw new Error('Manual contacts require persistent atom identities');

  const ligandAcceptor = perceiveHydrogenBondFeature(molecule,
    ligandFeatureAtomIndex, 'acceptor');
  const ligandDonor = perceiveHydrogenBondFeature(molecule,
    ligandFeatureAtomIndex, 'donor');
  const receptorAcceptor = perceiveHydrogenBondFeature(molecule,
    receptorFeatureAtomIndex, 'acceptor');
  const receptorDonor = perceiveHydrogenBondFeature(molecule,
    receptorFeatureAtomIndex, 'donor');
  const options = [];

  if (ligandAcceptor && receptorDonor) {
    const acceptorPoint = finitePoint(ligandAtom);
    const chosen = bestHydrogen(molecule, receptorDonor.hydrogenIndices, acceptorPoint);
    const donorPoint = finitePoint(receptorAtom), hydrogenPoint = finitePoint(molecule.atoms[chosen.index]);
    const targetPoint = advanced(hydrogenPoint, unit(vector(donorPoint, hydrogenPoint)),
      IDEAL_HA_ANGSTROM);
    const currentGeometry = geometry(donorPoint, hydrogenPoint, acceptorPoint);
    options.push({ ligandRole:'acceptor', receptorRole:'donor',
      label:`${atomLabel(receptorAtom, receptorFeatureAtomIndex)} → ${atomLabel(ligandAtom, ligandFeatureAtomIndex)}`,
      ligandFeatureType:ligandAcceptor.type, receptorFeatureType:receptorDonor.type,
      ligandAtomIndex:ligandFeatureAtomIndex, receptorAtomIndex:receptorFeatureAtomIndex,
      receptorHydrogenIndex:chosen.index,
      consideredHydrogenIndices:[...receptorDonor.hydrogenIndices].sort((a, b) => a - b),
      currentGeometry, currentGeometryScore:geometryScore(currentGeometry),
      targetLigandFeatureReferencePoint:targetPoint,
      definition:{ receptorRole:'donor',
        donor:receptorDescriptor(molecule, receptorFeatureAtomIndex),
        hydrogen:receptorDescriptor(molecule, chosen.index),
        acceptor:ligandDescriptor(molecule, ligandFeatureAtomIndex, 'acceptor',
          ligandAcceptor, targetPoint) } });
  }

  if (ligandDonor && receptorAcceptor) {
    const acceptorPoint = finitePoint(receptorAtom), donorPoint = finitePoint(ligandAtom);
    const chosen = bestHydrogen(molecule, ligandDonor.hydrogenIndices, acceptorPoint);
    const hydrogenPoint = finitePoint(molecule.atoms[chosen.index]);
    const targetPoint = advanced(acceptorPoint, unit(vector(acceptorPoint, donorPoint)),
      IDEAL_DA_ANGSTROM);
    const currentGeometry = geometry(donorPoint, hydrogenPoint, acceptorPoint);
    options.push({ ligandRole:'donor', receptorRole:'acceptor',
      label:`${atomLabel(ligandAtom, ligandFeatureAtomIndex)} → ${atomLabel(receptorAtom, receptorFeatureAtomIndex)}`,
      ligandFeatureType:ligandDonor.type, receptorFeatureType:receptorAcceptor.type,
      ligandAtomIndex:ligandFeatureAtomIndex, ligandHydrogenIndex:chosen.index,
      receptorAtomIndex:receptorFeatureAtomIndex,
      consideredHydrogenIndices:[...ligandDonor.hydrogenIndices].sort((a, b) => a - b),
      currentGeometry, currentGeometryScore:geometryScore(currentGeometry),
      targetLigandFeatureReferencePoint:targetPoint,
      definition:{ receptorRole:'acceptor',
        donor:ligandDescriptor(molecule, ligandFeatureAtomIndex, 'donor',
          ligandDonor, targetPoint),
        // This is a newly asserted design hypothesis, not a captured donor-H
        // coordinate. Refinement may orient the hydrogen; never snap it back.
        hydrogen:ligandDescriptor(molecule, chosen.index, 'hydrogen', ligandDonor),
        acceptor:receptorDescriptor(molecule, receptorFeatureAtomIndex) } });
  }
  return options.sort(optionSort);
}

export function createManualHydrogenBondDefinition({ molecule, ligandAtomIndices,
  ligandAtomIndex, receptorAtomIndex, ligandRole = 'auto', id,
  createdAt = new Date().toISOString(), method = 'two-atom-selection' } = {}) {
  const options = manualHydrogenBondOptions({ molecule, ligandAtomIndices,
    ligandAtomIndex, receptorAtomIndex });
  if (!options.length)
    throw new Error('Those atoms do not provide complementary hydrogen-bond donor/acceptor roles');
  const matching = ligandRole === 'auto' ? options
    : options.filter((entry) => entry.ligandRole === ligandRole);
  if (!matching.length)
    throw new Error(`The ligand atom is not a compatible ${ligandRole}`);
  if (matching.length > 1 || ligandRole === 'auto' && options.length > 1)
    throw new Error('Both donor and acceptor interpretations are possible; choose the ligand role');
  if (typeof id !== 'string' || !id)
    throw new Error('A stable manual contact ID is required');
  const option = matching[0];
  return { id, label:option.label, required:true, ...structuredClone(option.definition),
    targetLigandFeatureReferencePoint:{ ...option.targetLigandFeatureReferencePoint },
    referenceGeometry:{ hydrogenAcceptorDistanceAngstrom:IDEAL_HA_ANGSTROM, cosine:-1 },
    origin:{ schema:MANUAL_HBOND_SCHEMA, kind:'user-added-hydrogen-bond-hypothesis',
      method, createdAt, ligandRole:option.ligandRole,
      ligandFeatureType:option.ligandFeatureType,
      receptorFeatureType:option.receptorFeatureType,
      selectedLigandAtomId:molecule.atoms[option.ligandAtomIndex].designAtomId,
      selectedReceptorAtomId:molecule.atoms[option.receptorAtomIndex].designAtomId,
      selectedHydrogenAtomId:molecule.atoms[option.receptorHydrogenIndex
        ?? option.ligandHydrogenIndex].designAtomId,
      consideredHydrogenAtomIds:option.consideredHydrogenIndices.map((index) =>
        molecule.atoms[index].designAtomId),
      currentGeometry:structuredClone(option.currentGeometry),
      idealGeometry:{ donorAcceptorDistanceAngstrom:IDEAL_DA_ANGSTROM,
        hydrogenAcceptorDistanceAngstrom:IDEAL_HA_ANGSTROM,
        minimumDhaAngleDegrees:150 },
      targetLigandFeatureReferencePoint:{ ...option.targetLigandFeatureReferencePoint } } };
}

export function manualHydrogenBondGeometry(molecule, definition) {
  const byId = new Map(molecule?.atoms?.map((atom) => [atom.designAtomId, atom]) || []);
  const participant = (descriptor) => descriptor?.scope === 'ligand'
    ? byId.get(descriptor.designAtomId) : byId.get(descriptor?.designAtomId) || descriptor?.point;
  const donor = participant(definition?.donor), hydrogen = participant(definition?.hydrogen);
  const acceptor = participant(definition?.acceptor);
  if (!donor || !hydrogen || !acceptor) return null;
  const value = geometry(finitePoint(donor), finitePoint(hydrogen), finitePoint(acceptor));
  return { ...value, satisfied:value.donorAcceptorDistanceAngstrom <= 3.5
    && value.hydrogenAcceptorDistanceAngstrom <= 2.6 && value.dhaAngleDegrees >= 150 };
}

export function manualHydrogenBondParticipantKey(definition) {
  return [definition?.receptorRole,
    definition?.donor?.designAtomId, definition?.hydrogen?.designAtomId,
    definition?.acceptor?.designAtomId].join('|');
}

