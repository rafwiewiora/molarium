const ELEMENT_DATA = Object.freeze({
  H: { atomicNumber: 1, mass: 1.007947 },
  B: { atomicNumber: 5, mass: 10.811 },
  C: { atomicNumber: 6, mass: 12.01078 },
  N: { atomicNumber: 7, mass: 14.00672 },
  O: { atomicNumber: 8, mass: 15.99943 },
  F: { atomicNumber: 9, mass: 18.9984032 },
  Si: { atomicNumber: 14, mass: 28.0855 },
  P: { atomicNumber: 15, mass: 30.973762 },
  S: { atomicNumber: 16, mass: 32.0655 },
  Cl: { atomicNumber: 17, mass: 35.4532 },
  Br: { atomicNumber: 35, mass: 79.904 },
  I: { atomicNumber: 53, mass: 126.904473 },
});

const MAX_V2000_ATOMS = 999;
const queryCache = new Map();
let forcefieldPromise;

function fixed(value, width, decimals = 0) {
  const formatted = decimals ? Number(value).toFixed(decimals) : String(Math.trunc(value));
  if (formatted.length > width) throw new Error(`Molfile field ${formatted} exceeds V2000 limits`);
  return formatted.padStart(width, ' ');
}

export function moleculeToMolBlock(molecule) {
  if (!molecule?.atoms?.length) throw new Error('The molecule is empty');
  if (molecule.atoms.length > MAX_V2000_ATOMS || molecule.bonds.length > MAX_V2000_ATOMS) {
    const lines = [
      String(molecule.name || 'Molarium molecule').slice(0, 80),
      '  Molarium Sage 3D', '', '  0  0  0     0  0            999 V3000',
      'M  V30 BEGIN CTAB', `M  V30 COUNTS ${molecule.atoms.length} ${molecule.bonds.length} 0 0 0`,
      'M  V30 BEGIN ATOM',
    ];
    molecule.atoms.forEach((atom, index) => {
      const element = String(atom.element || '').trim();
      if (!ELEMENT_DATA[element]) throw new Error(`OpenFF Sage does not support element ${element || '(empty)'}`);
      const charge = Math.trunc(Number(atom.charge || 0));
      lines.push(`M  V30 ${index + 1} ${element} ${Number(atom.x).toFixed(6)} ${Number(atom.y).toFixed(6)} ${Number(atom.z).toFixed(6)} 0${charge ? ` CHG=${charge}` : ''}`);
    });
    lines.push('M  V30 END ATOM', 'M  V30 BEGIN BOND');
    molecule.bonds.forEach((bond, index) => {
      const order = Number(bond.order || 1);
      const type = Math.abs(order - 1.5) < 0.1 ? 4 : Math.max(1, Math.min(3, Math.round(order)));
      lines.push(`M  V30 ${index + 1} ${type} ${bond.a + 1} ${bond.b + 1}`);
    });
    lines.push('M  V30 END BOND', 'M  V30 END CTAB', 'M  END');
    return lines.join('\n');
  }
  const lines = [
    String(molecule.name || 'Molarium molecule').slice(0, 80),
    '  Molarium Sage 3D',
    '',
    `${fixed(molecule.atoms.length, 3)}${fixed(molecule.bonds.length, 3)}  0  0  0  0            999 V2000`,
  ];
  molecule.atoms.forEach((atom) => {
    const element = String(atom.element || '').trim();
    if (!ELEMENT_DATA[element]) throw new Error(`OpenFF Sage does not support element ${element || '(empty)'}`);
    lines.push(`${fixed(atom.x, 10, 4)}${fixed(atom.y, 10, 4)}${fixed(atom.z, 10, 4)} ${element.padEnd(3, ' ')} 0  0  0  0  0  0  0  0  0  0  0  0`);
  });
  molecule.bonds.forEach((bond) => {
    const order = Number(bond.order || 1);
    const type = Math.abs(order - 1.5) < 0.1 ? 4 : Math.max(1, Math.min(3, Math.round(order)));
    lines.push(`${fixed(bond.a + 1, 3)}${fixed(bond.b + 1, 3)}${fixed(type, 3)}  0  0  0  0`);
  });
  const charges = molecule.atoms
    .map((atom, index) => ({ index: index + 1, charge: Math.trunc(Number(atom.charge || 0)) }))
    .filter((entry) => entry.charge);
  for (let offset = 0; offset < charges.length; offset += 8) {
    const group = charges.slice(offset, offset + 8);
    lines.push(`M  CHG${fixed(group.length, 3)}${group.map((entry) => `${fixed(entry.index, 4)}${fixed(entry.charge, 4)}`).join('')}`);
  }
  lines.push('M  END');
  return lines.join('\n');
}

export function loadSageForceField() {
  forcefieldPromise ??= fetch(new URL('./sage-2.1.0.json', import.meta.url))
    .then((response) => {
      if (!response.ok) throw new Error(`OpenFF Sage parameter data failed to load (HTTP ${response.status})`);
      return response.json();
    })
    .then((forcefield) => {
      if (forcefield.schema !== 1 || forcefield.name !== 'OpenFF Sage 2.1.0')
        throw new Error('The OpenFF Sage parameter data has an unsupported schema');
      return forcefield;
    })
    .catch((error) => {
      forcefieldPromise = null;
      throw error;
    });
  return forcefieldPromise;
}

function lexicographic(a, b) {
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function reverseCanonical(atoms) {
  const reverse = atoms.slice().reverse();
  return lexicographic(atoms, reverse) <= 0 ? atoms.slice() : reverse;
}

function bondCanonical(atoms) {
  return atoms[0] <= atoms[1] ? atoms.slice(0, 2) : [atoms[1], atoms[0]];
}

function improperCanonical(atoms) {
  return [atoms[1], ...[atoms[0], atoms[2], atoms[3]].sort((a, b) => a - b)];
}

function key(atoms) { return atoms.join(':'); }

function getQuery(rdkit, smirks) {
  let query = queryCache.get(smirks);
  if (!query) {
    query = rdkit.get_qmol(smirks);
    if (!query) throw new Error(`RDKit could not parse Sage SMIRKS ${smirks}`);
    queryCache.set(smirks, query);
  }
  return query;
}

function parameterMatches(rdkit, molecule, parameter) {
  const raw = molecule.get_smirks_matches(getQuery(rdkit, parameter.smirks));
  let matches;
  try { matches = JSON.parse(raw); }
  catch { throw new Error(`RDKit returned malformed matches for ${parameter.id}`); }
  if (!Array.isArray(matches)) throw new Error(`RDKit could not match Sage parameter ${parameter.id}`);
  return matches;
}

function assignHandler(rdkit, molecule, parameters, canonicalize) {
  const assignments = new Map();
  for (const parameter of parameters) {
    for (const match of parameterMatches(rdkit, molecule, parameter)) {
      const atoms = canonicalize(match);
      assignments.set(key(atoms), { atoms, matchedAtoms: match.slice(), parameter });
    }
  }
  return assignments;
}

function adjacencyFor(molecule) {
  const adjacency = Array.from({ length: molecule.atoms.length }, () => []);
  for (const bond of molecule.bonds) {
    adjacency[bond.a].push(bond.b);
    adjacency[bond.b].push(bond.a);
  }
  adjacency.forEach((neighbors) => neighbors.sort((a, b) => a - b));
  return adjacency;
}

function expectedAngles(adjacency) {
  const terms = [];
  adjacency.forEach((neighbors, center) => {
    for (let first = 0; first < neighbors.length; first++) {
      for (let second = first + 1; second < neighbors.length; second++) {
        terms.push(reverseCanonical([neighbors[first], center, neighbors[second]]));
      }
    }
  });
  return terms;
}

function expectedProperTorsions(adjacency, molecule) {
  const terms = new Map();
  for (const bond of molecule.bonds) {
    for (const outerA of adjacency[bond.a]) {
      if (outerA === bond.b) continue;
      for (const outerB of adjacency[bond.b]) {
        if (outerB === bond.a || outerA === outerB) continue;
        const atoms = reverseCanonical([outerA, bond.a, bond.b, outerB]);
        terms.set(key(atoms), atoms);
      }
    }
  }
  return [...terms.values()];
}

function assertComplete(label, expected, assignments) {
  const missing = expected.filter((atoms) => !assignments.has(key(atoms)));
  if (missing.length) {
    const preview = missing.slice(0, 4).map((atoms) => `[${atoms.join(',')}]`).join(', ');
    throw new Error(`OpenFF Sage has no ${label} parameter for ${preview}${missing.length > 4 ? '…' : ''}`);
  }
}

function labelsFrom(assignments) {
  return [...assignments.values()]
    .map(({ atoms, parameter }) => ({ atoms: atoms.slice(), id: parameter.id, smirks: parameter.smirks }))
    .sort((a, b) => lexicographic(a.atoms, b.atoms));
}

function improperLabelsFrom(assignments) {
  return [...assignments.values()]
    .map(({ atoms: [center, outerA, outerB, outerC], parameter }) => ({
      atoms: [outerA, center, outerB, outerC], id: parameter.id, smirks: parameter.smirks,
    }))
    .sort((a, b) => lexicographic(a.atoms, b.atoms));
}

function nonbondedExceptions(molecule, adjacency, nonbonded, scales) {
  const exceptions = [];
  for (let source = 0; source < molecule.atoms.length; source++) {
    const distance = new Int16Array(molecule.atoms.length).fill(-1);
    distance[source] = 0;
    const queue = [source];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const atom = queue[cursor];
      if (distance[atom] === 3) continue;
      for (const neighbor of adjacency[atom]) {
        if (distance[neighbor] !== -1) continue;
        distance[neighbor] = distance[atom] + 1;
        queue.push(neighbor);
      }
    }
    for (let target = source + 1; target < molecule.atoms.length; target++) {
      if (distance[target] < 1 || distance[target] > 3) continue;
      if (distance[target] < 3) {
        exceptions.push({ i: source, j: target, chargeprod_e2: 0, sigma_nm: 1, epsilon_kj: 0 });
      } else {
        const first = nonbonded[source], second = nonbonded[target];
        exceptions.push({
          i: source,
          j: target,
          chargeprod_e2: first.charge_e * second.charge_e * scales.electrostatics14,
          sigma_nm: (first.sigma_nm + second.sigma_nm) / 2,
          epsilon_kj: Math.sqrt(first.epsilon_kj * second.epsilon_kj) * scales.vdw14,
        });
      }
    }
  }
  return exceptions;
}

export async function parameterizeSage(rdkit, inputMolecule) {
  const forcefield = await loadSageForceField();
  const molBlock = moleculeToMolBlock(inputMolecule);
  const molecule = rdkit.get_mol(molBlock, JSON.stringify({
    sanitize: true, removeHs: false, strictParsing: true,
  }));
  if (!molecule) throw new Error('RDKit could not read the current structure for Sage typing');

  try {
    molecule.use_mdl_aromaticity();
    const charges = JSON.parse(molecule.get_gasteiger_charges());
    if (charges?.error) throw new Error(charges.error);
    if (!Array.isArray(charges) || charges.length !== inputMolecule.atoms.length)
      throw new Error('RDKit returned an invalid Gasteiger charge set');

    const handlers = forcefield.handlers;
    const bondAssignments = assignHandler(rdkit, molecule, handlers.bonds, bondCanonical);
    const angleAssignments = assignHandler(rdkit, molecule, handlers.angles, reverseCanonical);
    const properAssignments = assignHandler(rdkit, molecule, handlers.proper_torsions, reverseCanonical);
    const improperAssignments = assignHandler(rdkit, molecule, handlers.improper_torsions, improperCanonical);
    const vdwAssignments = assignHandler(rdkit, molecule, handlers.vdw, (atoms) => atoms.slice(0, 1));
    const constraintAssignments = assignHandler(rdkit, molecule, handlers.constraints, bondCanonical);
    const adjacency = adjacencyFor(inputMolecule);

    const expectedBonds = inputMolecule.bonds.map((bond) => bondCanonical([bond.a, bond.b]));
    const angles = expectedAngles(adjacency);
    const properTorsions = expectedProperTorsions(adjacency, inputMolecule);
    const expectedAtoms = inputMolecule.atoms.map((_, index) => [index]);
    assertComplete('bond', expectedBonds, bondAssignments);
    assertComplete('angle', angles, angleAssignments);
    assertComplete('proper torsion', properTorsions, properAssignments);
    assertComplete('van der Waals', expectedAtoms, vdwAssignments);

    // The browser uses the official unconstrained Sage variant for ordinary
    // X-H bonds so minimization has their real harmonic energy and 1 fs MD is
    // well behaved. Explicit rigid-water distances remain true constraints.
    const constraints = [...constraintAssignments.values()]
      .filter(({ parameter }) => parameter.id !== 'c1')
      .map(({ atoms, parameter }) => {
      const bond = bondAssignments.get(key(bondCanonical(atoms)))?.parameter;
      const distance_nm = parameter.distance_nm ?? bond?.length_nm;
      if (!Number.isFinite(distance_nm)) throw new Error(`Constraint ${parameter.id} has no distance`);
      return { i: atoms[0], j: atoms[1], distance_nm };
    }).sort((a, b) => a.i - b.i || a.j - b.j);
    const constrainedBonds = new Set(constraints.map((term) => key(bondCanonical([term.i, term.j]))));

    const bonds = expectedBonds
      .filter((atoms) => !constrainedBonds.has(key(atoms)))
      .map((atoms) => {
        const parameter = bondAssignments.get(key(atoms)).parameter;
        return { i: atoms[0], j: atoms[1], r0_nm: parameter.length_nm, k_kj_nm2: parameter.k_kj_nm2 };
      });
    const angleTerms = angles.map((atoms) => {
      const parameter = angleAssignments.get(key(atoms)).parameter;
      return { i: atoms[0], j: atoms[1], k: atoms[2], theta0_rad: parameter.angle_rad, k_kj_rad2: parameter.k_kj_rad2 };
    });
    const torsions = [];
    for (const atoms of properTorsions) {
      const parameter = properAssignments.get(key(atoms)).parameter;
      for (const term of parameter.terms) torsions.push({
        i: atoms[0], j: atoms[1], k: atoms[2], l: atoms[3], ...term,
      });
    }
    for (const assignment of improperAssignments.values()) {
      const [center, outerA, outerB, outerC] = assignment.atoms;
      const permutations = [
        [center, outerA, outerB, outerC],
        [center, outerB, outerC, outerA],
        [center, outerC, outerA, outerB],
      ];
      for (const atoms of permutations) {
        for (const term of assignment.parameter.terms) torsions.push({
          i: atoms[0], j: atoms[1], k: atoms[2], l: atoms[3], ...term,
        });
      }
    }

    const nonbonded = inputMolecule.atoms.map((_, index) => {
      const parameter = vdwAssignments.get(String(index))?.parameter;
      if (!parameter) throw new Error(`OpenFF Sage has no van der Waals parameter for atom ${index}`);
      return { index, charge_e: charges[index], sigma_nm: parameter.sigma_nm, epsilon_kj: parameter.epsilon_kj };
    });
    const system = {
      particles: inputMolecule.atoms.map((atom) => ({ mass_amu: ELEMENT_DATA[atom.element].mass })),
      constraints,
      bonds,
      angles: angleTerms,
      torsions,
      nonbonded,
      exceptions: nonbondedExceptions(inputMolecule, adjacency, nonbonded, forcefield.scales),
    };
    const labels = {
      Constraints: labelsFrom(constraintAssignments),
      Bonds: labelsFrom(bondAssignments),
      Angles: labelsFrom(angleAssignments),
      ProperTorsions: labelsFrom(properAssignments),
      ImproperTorsions: improperLabelsFrom(improperAssignments),
      vdW: labelsFrom(vdwAssignments),
    };
    return {
      forcefield: forcefield.name,
      chargeModel: forcefield.charge_model,
      sourceSha256: forcefield.source_sha256,
      system,
      labels,
    };
  } finally {
    molecule.delete();
  }
}
