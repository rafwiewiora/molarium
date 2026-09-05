export const MOLECULAR_STATE_HASH_SCHEMA = 'molarium.molecular-state-hash/v1';

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return Object.is(number, -0) ? 0 : number;
}

function optionalText(value) {
  return value == null ? null : String(value);
}

/**
 * Canonical, identity-anchored molecular state. Atom-array order and bond
 * direction do not affect the result; persistent atom identity, chemistry,
 * topology, and exact coordinates do.
 */
export function canonicalMolecularState(molecule) {
  if (!molecule || !Array.isArray(molecule.atoms) || !molecule.atoms.length
    || !Array.isArray(molecule.bonds))
    throw new Error('Molecular state hash requires a non-empty molecule');
  const atomIdByIndex = new Map(), seen = new Set();
  const atoms = molecule.atoms.map((atom, index) => {
    const atomId = atom?.designAtomId;
    if (typeof atomId !== 'string' || !atomId)
      throw new Error(`Molecular state hash requires persistent atom identity at index ${index}`);
    if (seen.has(atomId)) throw new Error(`Duplicate persistent atom identity: ${atomId}`);
    seen.add(atomId); atomIdByIndex.set(index, atomId);
    return {
      atomId,
      element:optionalText(atom.element),
      formalCharge:finiteNumber(atom.formalCharge ?? atom.charge ?? 0,
        `formal charge for ${atomId}`),
      aromatic:Boolean(atom.aromatic),
      isotope:atom.isotope == null ? null : finiteNumber(atom.isotope, `isotope for ${atomId}`),
      atomName:optionalText(atom.atomName),
      record:optionalText(atom.record),
      chain:optionalText(atom.chain),
      residueName:optionalText(atom.residueName),
      residueIndex:optionalText(atom.residueIndex),
      insertionCode:optionalText(atom.insertionCode),
      coordinatesAngstrom:[
        finiteNumber(atom.x, `x coordinate for ${atomId}`),
        finiteNumber(atom.y, `y coordinate for ${atomId}`),
        finiteNumber(atom.z, `z coordinate for ${atomId}`),
      ],
    };
  }).sort((first, second) => first.atomId < second.atomId ? -1 : first.atomId > second.atomId ? 1 : 0);
  const bonds = molecule.bonds.map((bond, index) => {
    const first = atomIdByIndex.get(Number(bond.a));
    const second = atomIdByIndex.get(Number(bond.b));
    if (!first || !second || first === second)
      throw new Error(`Molecular state hash found an invalid bond at index ${index}`);
    const [atomIdA, atomIdB] = first < second ? [first, second] : [second, first];
    return { atomIdA, atomIdB,
      order:finiteNumber(bond.order ?? 1, `bond order at index ${index}`),
      aromatic:Boolean(bond.aromatic), stereo:optionalText(bond.stereo) };
  }).sort((first, second) => {
    const a = JSON.stringify(first), b = JSON.stringify(second);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { schema:MOLECULAR_STATE_HASH_SCHEMA,
    charge:finiteNumber(molecule.charge ?? 0, 'molecular charge'),
    multiplicity:finiteNumber(molecule.multiplicity ?? 1, 'molecular multiplicity'),
    atoms, bonds };
}

export function serializeMolecularState(molecule) {
  return JSON.stringify(canonicalMolecularState(molecule));
}

export async function molecularStateSha256(molecule) {
  const bytes = new TextEncoder().encode(serializeMolecularState(molecule));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
