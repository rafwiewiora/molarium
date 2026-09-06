// Contract for the existing seven-array numeric System representation. This
// validates, but never rewrites, the parameter bytes or infers missing forces.
export const NUMERIC_SYSTEM_CONTRACT = 'molarium.numeric-system/v1';
const fields = Object.freeze({
  particles:['mass_amu'], constraints:['i','j','distance_nm'],
  bonds:['i','j','r0_nm','k_kj_nm2'],
  angles:['i','j','k','theta0_rad','k_kj_rad2'],
  torsions:['i','j','k','l','periodicity','phase_rad','k_kj'],
  nonbonded:['charge_e','sigma_nm','epsilon_kj'],
  exceptions:['i','j','chargeprod_e2','sigma_nm','epsilon_kj'],
});
const indices = {constraints:['i','j'],bonds:['i','j'],angles:['i','j','k'],
  torsions:['i','j','k','l'],exceptions:['i','j']};
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateNumericSystem(molecule, system) {
  if (!Array.isArray(molecule?.atoms) || !molecule.atoms.length || !record(system))
    throw new TypeError('A nonempty molecule and numeric force-field System are required');
  const n = molecule.atoms.length;
  const unknown = Object.keys(system).filter(key => !Object.hasOwn(fields, key));
  if (unknown.length)
    throw new TypeError(`Unsupported numeric System content: ${unknown.join(', ')} (${NUMERIC_SYSTEM_CONTRACT})`);
  for (const [kind, required] of Object.entries(fields)) {
    if (!Array.isArray(system[kind])) throw new TypeError(`Numeric System is missing ${kind}`);
    if ((kind === 'particles' || kind === 'nonbonded') && system[kind].length !== n)
      throw new RangeError(`Numeric System ${kind} count must match ${n} atoms`);
    const allowed = new Set([...required,...(['particles','nonbonded'].includes(kind) ? ['index'] : [])]);
    const pairs = new Set();
    system[kind].forEach((term, ordinal) => {
      const label = `${kind}[${ordinal}]`;
      if (!record(term) || required.some(key => !Object.hasOwn(term, key))
          || Object.keys(term).some(key => !allowed.has(key)))
        throw new TypeError(`Numeric System ${label} has missing or unsupported fields`);
      for (const [key, value] of Object.entries(term))
        if (!Number.isFinite(value)) throw new TypeError(`${label}.${key} must be a finite number`);
      if (Object.hasOwn(term, 'index') && term.index !== ordinal)
        throw new RangeError(`${label}.index changes atom order`);
      const atomIndices = (indices[kind] || []).map(key => term[key]);
      if (atomIndices.some(index => !Number.isInteger(index) || index < 0 || index >= n)
          || new Set(atomIndices).size !== atomIndices.length)
        throw new RangeError(`${label} has invalid or repeated atom indices`);
      if (kind === 'constraints' || kind === 'exceptions') {
        const pair = [term.i,term.j].sort((a,b) => a-b).join(':');
        if (pairs.has(pair)) throw new RangeError(`Duplicate ${kind} pair ${pair}`);
        pairs.add(pair);
      }
      if (kind === 'particles' && term.mass_amu <= 0)
        throw new RangeError(`${label}.mass_amu must be positive; virtual sites are unsupported`);
      if (kind === 'constraints' && term.distance_nm <= 0)
        throw new RangeError(`${label}.distance_nm must be positive`);
      for (const key of ['sigma_nm','epsilon_kj','r0_nm','k_kj_nm2','k_kj_rad2'])
        if (Object.hasOwn(term, key) && term[key] < 0)
          throw new RangeError(`${label}.${key} must be nonnegative`);
      if (kind === 'angles' && (term.theta0_rad < 0 || term.theta0_rad > Math.PI))
        throw new RangeError(`${label}.theta0_rad must be between zero and pi`);
      if (kind === 'torsions' && (!Number.isInteger(term.periodicity)
          || term.periodicity < 1 || term.periodicity > 0x7fffffff))
        throw new RangeError(`${label}.periodicity must be a positive signed 32-bit integer`);
      // Signed periodic-torsion amplitudes are valid: Rosemary uses them.
    });
  }
  molecule.atoms.forEach((atom, index) => {
    if (!['x','y','z'].every(axis => Number.isFinite(atom?.[axis])))
      throw new TypeError(`Atom ${index} coordinates must be finite numbers`);
  });
  return {contract:NUMERIC_SYSTEM_CONTRACT, atomCount:n};
}

export function validatePackedFloat32(label, values) {
  for (let index = 0; index < values.length; index++)
    if (!Number.isFinite(values[index]) || !Number.isFinite(Math.fround(values[index])))
      throw new RangeError(`${label}[${index}] cannot be represented as finite f32`);
}
