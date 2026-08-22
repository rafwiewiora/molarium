import { ensureStableAtomIds } from './reference-core.mjs';
import { perceiveHydrogenBondFeature,
  validateCapturedLigandHydrogenBondFeature } from './contact-remap.mjs';

const moleculeGraphByAtomArray = new WeakMap();

function uniqueValidIndices(indices, atomCount, label) {
  const result = [...new Set(Array.from(indices || [], Number))];
  if (!result.length || result.some((index) => !Number.isInteger(index)
      || index < 0 || index >= atomCount))
    throw new Error(`${label} must contain unique valid atom indices`);
  return result;
}

function copiedPoint(atom) {
  return { x:Number(atom.x), y:Number(atom.y), z:Number(atom.z) };
}

function atomLabel(atom, index) {
  const residue = atom?.residueName
    ? `${atom.residueName} ${atom.chain || ''}${atom.residueIndex ?? ''}`.trim() : 'ligand';
  return `${residue} ${atom?.atomName || atom?.element || `atom ${index + 1}`}`;
}

export function createLigandPlan(molecule, ligandAtomIndices, namespace = 'molarium') {
  if (!molecule?.atoms?.length) throw new Error('A molecule is required');
  ensureStableAtomIds(molecule, namespace);
  const globalAtomIndices = uniqueValidIndices(ligandAtomIndices, molecule.atoms.length,
    'The ligand selection');
  const selected = new Set(globalAtomIndices);
  const globalToLocal = new Map(globalAtomIndices.map((index, local) => [index, local]));
  const atoms = globalAtomIndices.map((index) => ({ ...molecule.atoms[index] }));
  const bonds = molecule.bonds.flatMap((bond) => selected.has(bond.a) && selected.has(bond.b)
    ? [{ ...bond, a:globalToLocal.get(bond.a), b:globalToLocal.get(bond.b) }] : []);
  const ligandMolecule = {
      atoms, bonds,
      name:`${molecule.name || 'structure'} ligand`,
      smiles:molecule.smiles || 'Ligand component',
      charge:atoms.reduce((sum, atom) => sum + Number(atom.formalCharge ?? atom.charge ?? 0), 0),
      multiplicity:1,
      source:{ format:'molarium-docking-ligand', parent:molecule.name || null },
    };
  moleculeGraphByAtomArray.set(atoms, ligandMolecule);
  return {
    molecule:ligandMolecule,
    globalAtomIndices,
    globalToLocal,
  };
}

export function captureCrossHydrogenBonds(molecule, ligandAtomIndices, hydrogenBonds) {
  ensureStableAtomIds(molecule);
  const ligand = new Set(uniqueValidIndices(ligandAtomIndices, molecule.atoms.length,
    'The ligand selection'));
  return Array.from(hydrogenBonds || []).flatMap((bond, ordinal) => {
    const donorIsLigand = ligand.has(bond.donor);
    const hydrogenIsLigand = ligand.has(bond.hydrogen);
    const acceptorIsLigand = ligand.has(bond.acceptor);
    if (donorIsLigand !== hydrogenIsLigand || donorIsLigand === acceptorIsLigand) return [];
    const donor = molecule.atoms[bond.donor];
    const hydrogen = molecule.atoms[bond.hydrogen];
    const acceptor = molecule.atoms[bond.acceptor];
    const ligandRole = donorIsLigand ? 'donor' : 'acceptor';
    const ligandFeatureIndex = donorIsLigand ? bond.donor : bond.acceptor;
    const ligandFeature = perceiveHydrogenBondFeature(molecule, ligandFeatureIndex, ligandRole);
    if (!ligandFeature || donorIsLigand
      && !ligandFeature.hydrogenIndices.includes(bond.hydrogen)) return [];
    const ligandDescriptor = (index, role = null) => ({ scope:'ligand',
      designAtomId:molecule.atoms[index].designAtomId,
      element:molecule.atoms[index].element,
      ...(role === 'acceptor' || role === 'donor'
        ? { featureSignature:ligandFeature.signature } : {}),
      referencePoint:copiedPoint(molecule.atoms[index]) });
    const receptorDescriptor = (index) => ({ scope:'receptor', point:copiedPoint(molecule.atoms[index]),
      sourceGlobalAtomIndex:index, designAtomId:molecule.atoms[index].designAtomId,
      element:molecule.atoms[index].element });
    return [{
      id:`reference-hbond-${ordinal + 1}`,
      label:`${atomLabel(donor, bond.donor)} → ${atomLabel(acceptor, bond.acceptor)}`,
      required:true,
      receptorRole:donorIsLigand ? 'acceptor' : 'donor',
      donor:donorIsLigand ? ligandDescriptor(bond.donor, 'donor') : receptorDescriptor(bond.donor),
      hydrogen:hydrogenIsLigand ? ligandDescriptor(bond.hydrogen, 'hydrogen') : receptorDescriptor(bond.hydrogen),
      acceptor:acceptorIsLigand ? ligandDescriptor(bond.acceptor, 'acceptor') : receptorDescriptor(bond.acceptor),
      referenceGeometry:{ hydrogenAcceptorDistanceAngstrom:Number(bond.distance), cosine:Number(bond.cosine) },
    }];
  });
}

export function mapCapturedHydrogenBonds(definitions, candidateAtoms, selectedIds = null) {
  const candidateById = new Map(candidateAtoms.map((atom, index) => [atom.designAtomId, index]));
  const selected = selectedIds ? new Set(selectedIds) : null;
  const missing = [], droppedAlternatives = [];
  const mapOne = (definition, parent = definition, missingTarget = missing) => {
    const participant = (descriptor) => {
      if (descriptor.scope === 'receptor') return { scope:'receptor', point:{ ...descriptor.point },
        designAtomId:descriptor.designAtomId, element:descriptor.element };
      const atomIndex = candidateById.get(descriptor.designAtomId);
      if (!Number.isInteger(atomIndex)) {
        missingTarget.push({ constraintId:parent.id, alternativeId:definition.alternativeId || null,
          designAtomId:descriptor.designAtomId });
        return null;
      }
      return { scope:'ligand', atomIndex, designAtomId:descriptor.designAtomId,
        referencePoint:descriptor.referencePoint ? { ...descriptor.referencePoint } : null };
    };
    const donor = participant(definition.donor);
    const hydrogen = participant(definition.hydrogen);
    const acceptor = participant(definition.acceptor);
    if (!donor || !hydrogen || !acceptor) return null;
    return { id:definition.alternativeId || definition.id, label:definition.label || parent.label,
      required:parent.required !== false, receptorRole:definition.receptorRole,
      matchKind:definition.matchKind || null,
      targetLigandFeatureReferencePoint:definition.targetLigandFeatureReferencePoint
        ? { ...definition.targetLigandFeatureReferencePoint } : null,
      donor, hydrogen, acceptor };
  };
  const mapped = Array.from(definitions || []).flatMap((definition) => {
    if (selected && !selected.has(definition.id)) return [];
    if (definition.alternatives?.length) {
      const alternativeMissing = [];
      const alternatives = definition.alternatives
        .map((entry) => mapOne(entry, definition, alternativeMissing))
        .filter(Boolean);
      if (!alternatives.length) missing.push(...alternativeMissing);
      else droppedAlternatives.push(...alternativeMissing);
      return alternatives.length ? [{ id:definition.id, label:definition.label,
        required:definition.required !== false, receptorRole:definition.receptorRole,
        alternatives }] : [];
    }
    const single = mapOne(definition);
    return single ? [single] : [];
  });
  return { constraints:mapped, missing, droppedAlternatives,
    complete:missing.length === 0 };
}

export function capturedReceptorContactIntegrity(definitions, molecule, toleranceAngstrom = 1e-6) {
  const atomsById = new Map(Array.from(molecule?.atoms || [], (atom, index) =>
    [atom.designAtomId, { atom, index }]));
  const checked = [], issues = [], seen = new Set();
  Array.from(definitions || []).forEach((definition) => {
    const variants = definition.alternatives?.length ? definition.alternatives : [definition];
    variants.flatMap((entry) => [entry.donor, entry.hydrogen, entry.acceptor])
      .filter((descriptor) => descriptor?.scope === 'receptor')
      .forEach((descriptor) => {
        if (!descriptor.designAtomId || seen.has(descriptor.designAtomId)) return;
        seen.add(descriptor.designAtomId);
        const current = atomsById.get(descriptor.designAtomId);
        if (!current) {
          issues.push({ designAtomId:descriptor.designAtomId, reason:'missing' }); return;
        }
        if (current.atom.element !== descriptor.element) {
          issues.push({ designAtomId:descriptor.designAtomId, reason:'element-changed' }); return;
        }
        const displacementAngstrom = Math.hypot(current.atom.x - descriptor.point.x,
          current.atom.y - descriptor.point.y, current.atom.z - descriptor.point.z);
        checked.push({ designAtomId:descriptor.designAtomId, globalAtomIndex:current.index,
          displacementAngstrom });
        if (displacementAngstrom > toleranceAngstrom)
          issues.push({ designAtomId:descriptor.designAtomId, reason:'coordinate-changed',
            displacementAngstrom });
      });
  });
  return { valid:issues.length === 0, toleranceAngstrom, checked, issues };
}

export function capturedHydrogenBondAvailability(definitions, candidate, candidateBonds = null) {
  const molecule = Array.isArray(candidate)
    ? moleculeGraphByAtomArray.get(candidate) || { atoms:candidate, bonds:candidateBonds || [] }
    : candidate;
  if (!molecule?.atoms || !Array.isArray(molecule.bonds))
    throw new Error('Captured-contact availability requires a complete candidate graph');
  return Array.from(definitions || []).map((definition) => {
    if (!definition.alternatives?.length)
      return validateCapturedLigandHydrogenBondFeature(definition, molecule);
    const alternatives = definition.alternatives.map((entry) => ({
      alternativeId:entry.alternativeId || entry.id,
      ...validateCapturedLigandHydrogenBondFeature(entry, molecule),
    }));
    const available = alternatives.some((entry) => entry.available);
    return { id:definition.id, ligandRole:alternatives[0]?.ligandRole || null, available,
      alternatives,
      missingAtomIds:available ? [] : [...new Set(alternatives.flatMap((entry) => entry.missingAtomIds))],
      incompatibleAtomIds:available ? []
        : [...new Set(alternatives.flatMap((entry) => entry.incompatibleAtomIds))],
      reasons:available ? [] : [...new Set(alternatives.flatMap((entry) => entry.reasons))] };
  });
}

export function unpackConformerStack(stack, atomCount) {
  if (!ArrayBuffer.isView(stack) || !Number.isInteger(atomCount) || atomCount < 1)
    throw new Error('A typed conformer stack and atom count are required');
  const stride = atomCount * 3;
  if (!stack.length || stack.length % stride) throw new Error('The conformer stack has an invalid shape');
  return Array.from({ length:stack.length / stride }, (_, index) =>
    Float64Array.from(stack.subarray(index * stride, (index + 1) * stride)));
}

export function applyLigandPositions(molecule, globalAtomIndices, positions) {
  const indices = uniqueValidIndices(globalAtomIndices, molecule.atoms.length, 'The ligand mapping');
  if (!ArrayBuffer.isView(positions) || positions.length !== indices.length * 3)
    throw new Error('Docked ligand coordinates do not match the ligand mapping');
  indices.forEach((globalIndex, localIndex) => {
    const atom = molecule.atoms[globalIndex];
    atom.x = Number(positions[localIndex * 3]);
    atom.y = Number(positions[localIndex * 3 + 1]);
    atom.z = Number(positions[localIndex * 3 + 2]);
  });
  return molecule;
}

export function dockingInputText(molecule, atomIndices) {
  const indices = uniqueValidIndices(atomIndices, molecule.atoms.length, 'The provenance selection');
  const selected = new Set(indices);
  const globalToLocal = new Map(indices.map((index, local) => [index, local]));
  return JSON.stringify({
    atoms:indices.map((index) => {
      const atom = molecule.atoms[index];
      return { designAtomId:atom.designAtomId, element:atom.element, record:atom.record || null,
        atomName:atom.atomName || null, residueName:atom.residueName || null,
        chain:atom.chain || null, residueIndex:atom.residueIndex ?? null,
        x:Number(atom.x), y:Number(atom.y), z:Number(atom.z) };
    }),
    bonds:molecule.bonds.flatMap((bond) => selected.has(bond.a) && selected.has(bond.b)
      ? [{ a:globalToLocal.get(bond.a), b:globalToLocal.get(bond.b), order:Number(bond.order || 1) }] : []),
  });
}

export function dockingTopologyText(molecule, atomIndices) {
  const indices = uniqueValidIndices(atomIndices, molecule.atoms.length, 'The topology selection');
  const selected = new Set(indices);
  const globalToLocal = new Map(indices.map((index, local) => [index, local]));
  return JSON.stringify({
    atoms:indices.map((index) => {
      const atom = molecule.atoms[index];
      return { designAtomId:atom.designAtomId, element:atom.element,
        formalCharge:Number(atom.formalCharge ?? atom.charge ?? 0), aromatic:Boolean(atom.aromatic) };
    }),
    bonds:molecule.bonds.flatMap((bond) => selected.has(bond.a) && selected.has(bond.b)
      ? [{ a:globalToLocal.get(bond.a), b:globalToLocal.get(bond.b), order:Number(bond.order || 1) }] : []),
  });
}
