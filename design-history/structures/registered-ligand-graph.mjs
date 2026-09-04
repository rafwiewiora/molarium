function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}

function normalizedResidueIdentity(atom) {
  return {
    residueName:String(atom.residueName || '').trim().toUpperCase(),
    chain:String(atom.chain || 'A'),
    residueIndex:Number(atom.residueIndex || 0),
    insertionCode:String(atom.insertionCode || ''),
  };
}

function normalizeLocator(locator, fallbackResidueName = '') {
  const value = requireObject(locator, 'Registered ligand locator');
  const residueName = String(value.residueName || fallbackResidueName).trim().toUpperCase();
  const chain = String(value.chain || '');
  const residueIndex = Number(value.residueIndex);
  const insertionCode = String(value.insertionCode || '');
  if (!residueName || !chain || !Number.isInteger(residueIndex))
    throw new Error('Registered ligand locator requires residueName, chain, and integer residueIndex');
  return { residueName, chain, residueIndex, insertionCode };
}

export function canonicalRegisteredLigandDefinition(definition) {
  requireObject(definition, 'Registered ligand definition');
  const id = String(definition.id || '').trim().toUpperCase();
  if (!id || !Array.isArray(definition.atoms) || !Array.isArray(definition.bonds))
    throw new Error('Registered ligand definition requires id, atoms, and bonds');
  const atoms = definition.atoms.map((atom) => ({
    id:String(atom?.id || '').trim(), element:String(atom?.element || '').trim(),
    formalCharge:Number(atom?.formalCharge ?? atom?.charge ?? 0),
    aromatic:Boolean(atom?.aromatic), leaving:Boolean(atom?.leaving),
  })).sort((first, second) => first.id.localeCompare(second.id));
  if (atoms.some((atom) => !atom.id || !atom.element || !Number.isInteger(atom.formalCharge)))
    throw new Error(`Registered ${id} atoms require names, elements, and integer formal charges`);
  const names = new Set(atoms.map((atom) => atom.id));
  if (names.size !== atoms.length) throw new Error(`Registered ${id} atom names must be unique`);
  const bondKeys = new Set();
  const bonds = definition.bonds.map((bond) => {
    const endpoints = [String(bond?.a || '').trim(), String(bond?.b || '').trim()]
      .sort((first, second) => first.localeCompare(second));
    const [a, b] = endpoints;
    const order = Number(bond?.order ?? 1);
    if (!names.has(a) || !names.has(b) || a === b || !Number.isFinite(order)
      || order <= 0 || order > 4)
      throw new Error(`Registered ${id} contains an invalid bond`);
    const key = `${a}:${b}`;
    if (bondKeys.has(key)) throw new Error(`Registered ${id} contains duplicate bond ${key}`);
    bondKeys.add(key);
    return { a, b, order, aromatic:Boolean(bond?.aromatic) };
  }).sort((first, second) => `${first.a}:${first.b}`.localeCompare(`${second.a}:${second.b}`));
  return { schema:'molarium.registered-ligand-graph/v1', id, atoms, bonds };
}

export function serializeRegisteredLigandDefinition(definition) {
  return JSON.stringify(canonicalRegisteredLigandDefinition(definition));
}

export function validateConnectedMolecularGraph(molecule, { maximumAtoms = 256 } = {}) {
  requireObject(molecule, 'Molecule');
  if (!Array.isArray(molecule.atoms) || !molecule.atoms.length)
    throw new Error('2D depiction requires at least one atom');
  if (molecule.atoms.length > maximumAtoms)
    throw new Error(`2D depiction supports at most ${maximumAtoms} atoms`);
  if (!Array.isArray(molecule.bonds)) throw new Error('Molecule bonds must be an array');
  const heavy = molecule.atoms.flatMap((atom, index) => atom?.element === 'H' ? [] : [index]);
  if (!heavy.length) throw new Error('2D depiction requires at least one heavy atom');
  const heavySet = new Set(heavy);
  const adjacency = new Map(heavy.map((index) => [index, []]));
  const valence = new Map(heavy.map((index) => [index, 0]));
  const seenBonds = new Set();
  molecule.bonds.forEach((bond, index) => {
    const a = Number(bond?.a), b = Number(bond?.b), order = Number(bond?.order ?? 1);
    if (!Number.isInteger(a) || !Number.isInteger(b)
      || a < 0 || b < 0 || a >= molecule.atoms.length || b >= molecule.atoms.length)
      throw new Error(`2D depiction bond ${index} has an invalid atom index`);
    if (a === b) throw new Error(`2D depiction bond ${index} is a self bond`);
    if (!Number.isFinite(order) || order <= 0 || order > 4)
      throw new Error(`2D depiction bond ${index} has an invalid order`);
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seenBonds.has(key)) throw new Error(`2D depiction has duplicate bond ${key}`);
    seenBonds.add(key);
    if (heavySet.has(a) && heavySet.has(b)) {
      adjacency.get(a).push(b); adjacency.get(b).push(a);
      const valenceOrder = bond.aromatic === true || Math.abs(order - 1.5) < 1e-6 ? 1 : order;
      valence.set(a, valence.get(a) + valenceOrder);
      valence.set(b, valence.get(b) + valenceOrder);
    }
  });
  const maximumValence = { B:3, C:4, N:4, O:3, F:1, Si:4, P:6, S:6, Cl:1, Br:1, I:1 };
  for (const index of heavy) {
    const element = molecule.atoms[index]?.element;
    const maximum = maximumValence[element];
    if (maximum != null && valence.get(index) > maximum + 1e-6)
      throw new Error(`2D depiction refused an unsanitizable ${element} atom with bond-order valence ${valence.get(index)}`);
  }
  const visited = new Set([heavy[0]]), pending = [heavy[0]];
  while (pending.length) {
    const atom = pending.pop();
    for (const neighbor of adjacency.get(atom)) {
      if (!visited.has(neighbor)) { visited.add(neighbor); pending.push(neighbor); }
    }
  }
  if (visited.size !== heavy.length)
    throw new Error(`2D depiction refused a disconnected molecular graph (${visited.size}/${heavy.length} heavy atoms connected)`);
  return { atomCount:molecule.atoms.length, heavyAtomCount:heavy.length,
    bondCount:molecule.bonds.length, connected:true };
}

/**
 * Install a registered CCD-style graph onto coordinate-bearing PDB atoms.
 * Coordinates are copied only from the PDB molecule; definition coordinates
 * are deliberately ignored and no missing atom (including hydrogen) is added.
 */
export function applyRegisteredLigandDefinition(inputMolecule, {
  residueName, locator:requestedLocator = null, definition,
} = {}) {
  requireObject(inputMolecule, 'Coordinate molecule');
  requireObject(definition, 'Registered ligand definition');
  const expectedResidueName = String(residueName || definition.id || '').trim().toUpperCase();
  if (!expectedResidueName) throw new Error('Registered ligand residueName is required');
  if (!Array.isArray(inputMolecule.atoms) || !Array.isArray(inputMolecule.bonds))
    throw new Error('Coordinate molecule must contain atoms and bonds');
  if (!Array.isArray(definition.atoms) || !Array.isArray(definition.bonds))
    throw new Error('Registered ligand definition must contain atoms and bonds');

  const definitionByName = new Map();
  for (const atom of definition.atoms) {
    const name = String(atom?.id || '').trim();
    if (!name || definitionByName.has(name))
      throw new Error(`Registered ${expectedResidueName} definition has a missing or duplicate atom name`);
    definitionByName.set(name, atom);
  }
  const retainedHeavyNames = definition.atoms
    .filter((atom) => atom.element !== 'H' && atom.leaving !== true)
    .map((atom) => atom.id);
  if (!retainedHeavyNames.length)
    throw new Error(`Registered ${expectedResidueName} definition has no retained heavy atoms`);

  const targetLocator = requestedLocator
    ? normalizeLocator(requestedLocator, expectedResidueName) : null;
  if (targetLocator && targetLocator.residueName !== expectedResidueName)
    throw new Error('Registered ligand locator and definition residue names differ');
  const candidateGroups = new Map();
  inputMolecule.atoms.forEach((atom, index) => {
    if (String(atom.residueName || '').trim().toUpperCase() !== expectedResidueName) return;
    const identity = normalizedResidueIdentity(atom);
    if (targetLocator && (identity.chain !== targetLocator.chain
      || identity.residueIndex !== targetLocator.residueIndex
      || identity.insertionCode !== targetLocator.insertionCode)) return;
    const key = `${identity.chain}:${identity.residueIndex}:${identity.insertionCode}:${identity.residueName}`;
    if (!candidateGroups.has(key)) candidateGroups.set(key, { identity, indices:[] });
    candidateGroups.get(key).indices.push(index);
  });
  if (candidateGroups.size !== 1)
    throw new Error(`Registered ${expectedResidueName} coordinates must identify exactly one residue; found ${candidateGroups.size}`);
  const group = [...candidateGroups.values()][0];
  const existingByName = new Map();
  for (const index of group.indices) {
    const atom = inputMolecule.atoms[index];
    const name = String(atom.atomName || '').trim();
    if (!name || existingByName.has(name))
      throw new Error(`Coordinate ${expectedResidueName} has a missing or duplicate atom name ${name || '(empty)'}`);
    const expected = definitionByName.get(name);
    if (!expected) throw new Error(`Coordinate ${expectedResidueName} atom ${name} is absent from its registered definition`);
    if (atom.element !== expected.element)
      throw new Error(`Coordinate ${expectedResidueName} atom ${name} element differs from its registered definition (${atom.element}/${expected.element})`);
    existingByName.set(name, index);
  }
  const missingHeavy = retainedHeavyNames.filter((name) => !existingByName.has(name));
  const extraHeavy = [...existingByName].filter(([name, index]) =>
    inputMolecule.atoms[index].element !== 'H' && !retainedHeavyNames.includes(name)).map(([name]) => name);
  if (missingHeavy.length || extraHeavy.length)
    throw new Error(`Registered ${expectedResidueName} heavy-atom mapping mismatch; missing [${missingHeavy.join(', ')}], extra [${extraHeavy.join(', ')}]`);

  const molecule = structuredClone(inputMolecule);
  const beforeCoordinates = group.indices.map((index) => [
    molecule.atoms[index].x, molecule.atoms[index].y, molecule.atoms[index].z,
  ]);
  for (const [name, index] of existingByName) {
    const expected = definitionByName.get(name);
    molecule.atoms[index].charge = Number(expected.formalCharge ?? expected.charge ?? 0);
    molecule.atoms[index].aromatic = Boolean(expected.aromatic);
    molecule.atoms[index].ccd = expectedResidueName;
  }
  const inGroup = new Set(group.indices);
  molecule.bonds = molecule.bonds.filter((bond) => !(inGroup.has(bond.a) && inGroup.has(bond.b)));
  for (const bond of definition.bonds) {
    const a = existingByName.get(bond.a), b = existingByName.get(bond.b);
    if (a === undefined || b === undefined) continue;
    const first = molecule.atoms[a], second = molecule.atoms[b];
    molecule.bonds.push({ a, b, order:Number(bond.order || 1),
      distance:Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z),
      topology:'registered ligand definition', aromatic:Boolean(bond.aromatic) });
  }
  const subsetRemap = new Map(group.indices.map((index, localIndex) => [index, localIndex]));
  const subset = {
    atoms:group.indices.map((index) => molecule.atoms[index]),
    bonds:molecule.bonds.flatMap((bond) => subsetRemap.has(bond.a) && subsetRemap.has(bond.b)
      ? [{ ...bond, a:subsetRemap.get(bond.a), b:subsetRemap.get(bond.b) }] : []),
  };
  const graph = validateConnectedMolecularGraph(subset);
  const coordinateMaximumDisplacement = group.indices.reduce((maximum, index, ordinal) => {
    const atom = molecule.atoms[index], before = beforeCoordinates[ordinal];
    return Math.max(maximum, Math.hypot(atom.x - before[0], atom.y - before[1], atom.z - before[2]));
  }, 0);
  if (coordinateMaximumDisplacement !== 0)
    throw new Error('Registered ligand graph installation changed coordinate-bearing PDB atoms');
  const locator = { ...group.identity };
  molecule.source = { ...(molecule.source || {}), registeredLigandGraph:{
    ...(molecule.source?.registeredLigandGraph || {}),
    definitionId:String(definition.id || expectedResidueName), locator,
    atomNameMapping:'exact residue and PDB atom names', coordinates:'unchanged PDB input',
    heavyAtomCount:graph.heavyAtomCount, bondCount:graph.bondCount,
  } };
  molecule.charge = molecule.atoms.reduce((sum, atom) => sum + Number(atom.charge || 0), 0);
  return { molecule, locator, ...graph, coordinateMaximumDisplacement };
}
