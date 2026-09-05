// OpenMM GBSAOBCForce-compatible OBC2 parameters. Radii are mbondi2 and
// scaling factors are the standard Amber/OpenMM element screen parameters.

const RADII_NM = Object.freeze({
  C: 0.170, N: 0.155, O: 0.150, F: 0.150, Si: 0.210,
  P: 0.185, S: 0.180, Cl: 0.170,
});

const SCREEN = Object.freeze({
  H: 0.85, C: 0.72, N: 0.79, O: 0.85, F: 0.88,
  P: 0.86, S: 0.96,
});

export const OBC2_SETTINGS = Object.freeze({
  model: 'OBC2',
  solventDielectric: 78.3,
  soluteDielectric: 1.0,
  surfaceAreaEnergyKjNm2: 2.25936,
  radiusOffsetNm: 0.009,
});

export function obc2Parameters(molecule, system) {
  const atoms = molecule?.atoms;
  if (!Array.isArray(atoms) || !Array.isArray(molecule?.bonds))
    throw new Error('OBC2 requires atoms and explicit molecular bonds');
  if (!Array.isArray(system?.nonbonded) || system.nonbonded.length !== atoms.length)
    throw new Error('OBC2 requires one nonbonded charge per atom');

  // Prepared numeric Systems may carry explicit radii (e.g. the official
  // OpenMM AMBER99/OBC benchmark does not use our default mbondi2 radii).
  // Preserve those parameters, but reject constants the current WGSL kernels
  // cannot represent. Unannotated Sage/Rosemary inputs keep the same defaults.
  const prepared = molecule.parameterization?.implicitSolvent;
  if (prepared != null) {
    for (const [name, value] of Object.entries(OBC2_SETTINGS)) {
      if (prepared[name] !== value)
        throw new Error(`Prepared OBC2 has unsupported ${name}: ${prepared[name]}`);
    }
    if (!Array.isArray(prepared.particles) || prepared.particles.length !== atoms.length)
      throw new Error('Prepared OBC2 requires one radius and scale per atom');
    const particles = prepared.particles.map((particle, index) => {
      const { charge_e, radius_nm, scale } = particle;
      if (![charge_e, radius_nm, scale].every(Number.isFinite)
          || radius_nm <= OBC2_SETTINGS.radiusOffsetNm || scale <= 0
          || charge_e !== system.nonbonded[index].charge_e)
        throw new Error(`Prepared OBC2 contains invalid or mismatched parameters at atom ${index + 1}`);
      return { charge_e, radius_nm, scale };
    });
    return { ...OBC2_SETTINGS, particles };
  }

  const neighbors = Array.from({ length: atoms.length }, () => []);
  molecule.bonds.forEach((bond, index) => {
    const first = Number(bond.a), second = Number(bond.b);
    if (!Number.isInteger(first) || !Number.isInteger(second)
        || first < 0 || second < 0 || first >= atoms.length || second >= atoms.length)
      throw new Error(`OBC2 found an invalid molecular bond at index ${index}`);
    neighbors[first].push(second);
    neighbors[second].push(first);
  });

  const particles = atoms.map((atom, index) => {
    const element = String(atom.element || '');
    let radiusNm = RADII_NM[element] ?? 0.150;
    if (element === 'H') {
      const bondedElement = atoms[neighbors[index][0]]?.element;
      radiusNm = bondedElement === 'N' ? 0.130 : 0.120;
    }
    const charge = Number(system.nonbonded[index].charge_e);
    const scale = SCREEN[element] ?? 0.80;
    if (![charge, radiusNm, scale].every(Number.isFinite))
      throw new Error(`OBC2 produced invalid parameters for atom ${index + 1}`);
    return { charge_e: charge, radius_nm: radiusNm, scale };
  });
  return { ...OBC2_SETTINGS, particles };
}

export function requestedImplicitSolvent(options = {}) {
  const value = String(options.implicitSolvent || 'vacuum').toLowerCase();
  if (value === 'vacuum' || value === 'none') return null;
  if (value === 'obc2') return 'obc2';
  throw new Error(`Unsupported implicit solvent model: ${options.implicitSolvent}`);
}
