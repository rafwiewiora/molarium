function nonemptyString(value, label) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function uniqueMatch(indices, label) {
  if (indices.length !== 1)
    throw new Error(`${label} must resolve to exactly one atom; found ${indices.length}`);
  return indices[0];
}

// Resolve human-readable, topology-stable selectors at action execution time.
// Persistent IDs remain the identity used in the resulting contact definition;
// selectors only make a replay portable across independently prepared copies of
// the same registered complex.
export function resolveLigandAtomSelector({ molecule, components, selector } = {}) {
  if (!molecule?.atoms?.length || !Array.isArray(components))
    throw new Error('Ligand atom selection requires a molecule and its components');
  if (!selector || typeof selector !== 'object' || Array.isArray(selector))
    throw new Error('ligandAtom must be a selector object');
  const allowed = new Set(['componentId', 'atomName']);
  const unexpected = Object.keys(selector).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`Unexpected ligand atom selector arguments: ${unexpected.join(', ')}`);
  const componentId = nonemptyString(selector.componentId, 'ligandAtom.componentId');
  const atomName = nonemptyString(selector.atomName, 'ligandAtom.atomName');
  const component = components.find((entry) => entry.id === componentId);
  if (!component) throw new Error(`Unknown ligand component: ${componentId}`);
  if (component.kind !== 'ligand')
    throw new Error(`Component ${componentId} is not a ligand`);
  const matches = Array.from(component.atomIndices || []).filter((index) =>
    molecule.atoms[index]?.atomName === atomName);
  return uniqueMatch(matches, `Ligand selector ${componentId}/${atomName}`);
}

// Resolve only identities. Bond, branch, contact, and fixed-atom validation
// remain the responsibility of the existing geometry action.
export function resolveLigandAxisArguments({ molecule, components, args } = {}) {
  const resolved = { ...args };
  for (const [selectorKey, idKey, coupled] of [
    ['axisAtomSelectors', 'axisAtomIds', false],
    ['coupledAxisAtomSelectors', 'coupledAxisAtomIds', true],
    ['upstreamAxisAtomSelectors', 'upstreamAxisAtomIds', false],
  ]) {
    if (!Object.hasOwn(args, selectorKey)) continue;
    if (Object.hasOwn(args, idKey))
      throw new Error(`Provide ${selectorKey} or ${idKey}, not both`);
    const axis = (selectors) => {
      if (!Array.isArray(selectors) || selectors.length !== 2)
        throw new Error(`${selectorKey} requires ordered pairs of ligand selectors`);
      return selectors.map((selector) => {
        const index = resolveLigandAtomSelector({ molecule, components, selector });
        const id = molecule.atoms[index].designAtomId;
        if (typeof id !== 'string' || !id) throw new Error('Resolved ligand atom has no persistent identity');
        return id;
      });
    };
    if (coupled && (!Array.isArray(args[selectorKey]) || args[selectorKey].length !== 2))
      throw new Error(`${selectorKey} requires exactly two ordered axes`);
    resolved[idKey] = coupled ? args[selectorKey].map(axis) : axis(args[selectorKey]);
    delete resolved[selectorKey];
  }
  return resolved;
}

export function resolveReceptorAtomSelector({ molecule, selector } = {}) {
  if (!molecule?.atoms?.length)
    throw new Error('Receptor atom selection requires a molecule');
  if (!selector || typeof selector !== 'object' || Array.isArray(selector))
    throw new Error('receptorAtom must be a selector object');
  const allowed = new Set(['residueName', 'chain', 'residueIndex', 'insertionCode', 'atomName']);
  const unexpected = Object.keys(selector).filter((key) => !allowed.has(key));
  if (unexpected.length) throw new Error(`Unexpected receptor atom selector arguments: ${unexpected.join(', ')}`);
  const residueName = nonemptyString(selector.residueName, 'receptorAtom.residueName').toUpperCase();
  const chain = nonemptyString(selector.chain, 'receptorAtom.chain');
  const atomName = nonemptyString(selector.atomName, 'receptorAtom.atomName');
  const residueIndex = Number(selector.residueIndex);
  if (!Number.isInteger(residueIndex))
    throw new Error('receptorAtom.residueIndex must be an integer');
  const insertionCode = selector.insertionCode == null ? '' : String(selector.insertionCode);
  const matches = molecule.atoms.flatMap((atom, index) => atom.record === 'ATOM'
    && String(atom.residueName || '').toUpperCase() === residueName
    && String(atom.chain || '') === chain
    && Number(atom.residueIndex) === residueIndex
    && String(atom.insertionCode || '') === insertionCode
    && atom.atomName === atomName ? [index] : []);
  return uniqueMatch(matches,
    `Receptor selector ${residueName} ${chain}${residueIndex}${insertionCode}/${atomName}`);
}
