export const ANI2X_HARTREE_TO_KCAL_MOL = 627.5094740631;
export const ANI2X_SUPPORTED_ELEMENTS = Object.freeze(['H', 'C', 'N', 'O', 'S', 'F', 'Cl']);
export const ANI2X_MAX_ATOMS = 96;

const ELEMENT_TO_INDEX = Object.freeze(Object.fromEntries(
  ANI2X_SUPPORTED_ELEMENTS.map((element, index) => [element, index])));

const PAIR_INDEX = Object.freeze([
  [0, 1, 2, 3, 4, 5, 6],
  [1, 7, 8, 9, 10, 11, 12],
  [2, 8, 13, 14, 15, 16, 17],
  [3, 9, 14, 18, 19, 20, 21],
  [4, 10, 15, 19, 22, 23, 24],
  [5, 11, 16, 20, 23, 25, 26],
  [6, 12, 17, 21, 24, 26, 27],
]);

function atomFormalCharge(atom) {
  const charge = Number(atom?.formalCharge ?? atom?.charge ?? 0);
  return Number.isFinite(charge) ? charge : 0;
}

function connectedAtomCount(molecule) {
  if (!molecule?.atoms?.length) return 0;
  const adjacency = molecule.atoms.map(() => []);
  for (const bond of molecule.bonds || []) {
    if (Number.isInteger(bond.a) && Number.isInteger(bond.b)
        && adjacency[bond.a] && adjacency[bond.b]) {
      adjacency[bond.a].push(bond.b);
      adjacency[bond.b].push(bond.a);
    }
  }
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const current = queue.shift();
    for (const neighbor of adjacency[current]) if (!seen.has(neighbor)) {
      seen.add(neighbor);
      queue.push(neighbor);
    }
  }
  return seen.size;
}

export function ani2xCompatibility(molecule) {
  if (!molecule?.atoms?.length) return { supported: false, reason: 'Load a molecule first.' };
  if (molecule.atoms.length > ANI2X_MAX_ATOMS)
    return { supported: false, reason: `ANI-2x browser minimization is currently limited to ${ANI2X_MAX_ATOMS} atoms.` };
  const unsupported = [...new Set(molecule.atoms.map((atom) => atom.element)
    .filter((element) => !(element in ELEMENT_TO_INDEX)))];
  if (unsupported.length)
    return { supported: false, reason: `ANI-2x does not support ${unsupported.join(', ')}; supported elements are H, C, N, O, F, S, and Cl.` };
  const charge = molecule.atoms.reduce((sum, atom) => sum + atomFormalCharge(atom), 0);
  if (Math.abs(charge) > 1e-6)
    return { supported: false, reason: 'This ANI-2x lane is restricted to neutral molecules.' };
  if (Number(molecule.multiplicity ?? 1) !== 1)
    return { supported: false, reason: 'This ANI-2x lane is restricted to closed-shell singlets.' };
  if (connectedAtomCount(molecule) !== molecule.atoms.length)
    return { supported: false, reason: 'ANI-2x minimization currently requires one connected molecule.' };
  const hydrogenCount = molecule.atoms.filter((atom) => atom.element === 'H').length;
  if (!hydrogenCount)
    return { supported: false, reason: 'ANI-2x requires explicit hydrogens; load a hydrogen-complete structure.' };
  return { supported: true, reason: 'ANI-2x domain check passed.' };
}

export function ani2xSpecies(molecule) {
  const compatibility = ani2xCompatibility(molecule);
  if (!compatibility.supported) throw new Error(compatibility.reason);
  return Int32Array.from(molecule.atoms, (atom) => ELEMENT_TO_INDEX[atom.element]);
}

export function moleculePositions(molecule) {
  return Float64Array.from(molecule.atoms.flatMap((atom) => [atom.x, atom.y, atom.z]));
}

function cutoff(distance, radius) {
  const angle = Math.PI * distance / radius;
  return { value: 0.5 * Math.cos(angle) + 0.5,
    derivative: -0.5 * Math.PI / radius * Math.sin(angle) };
}

function displacement(positions, center, neighbor) {
  const c = center * 3;
  const n = neighbor * 3;
  const x = positions[n] - positions[c];
  const y = positions[n + 1] - positions[c + 1];
  const z = positions[n + 2] - positions[c + 2];
  const distance = Math.hypot(x, y, z);
  if (!Number.isFinite(distance) || distance < 1e-5)
    throw new Error(`ANI-2x found overlapping atoms ${center + 1} and ${neighbor + 1}`);
  return { index: neighbor, x, y, z, distance,
    ux: x / distance, uy: y / distance, uz: z / distance };
}

function aniParameters(manifest) {
  if (manifest?.aevLength !== 1008 || manifest?.ensembleSize !== 8)
    throw new Error('The ANI-2x manifest has an unsupported descriptor or ensemble shape');
  return {
    radialCutoff: Number(manifest.radial.cutoff),
    radialEta: Number(manifest.radial.eta),
    radialShifts: manifest.radial.shifts,
    angularCutoff: Number(manifest.angular.cutoff),
    angularEta: Number(manifest.angular.eta),
    angularZeta: Number(manifest.angular.zeta),
    angularShifts: manifest.angular.shifts,
    angularSections: manifest.angular.sections,
  };
}

export function buildAni2xAevs(species, positions, manifest) {
  const params = aniParameters(manifest);
  const atomCount = species.length;
  if (positions.length !== atomCount * 3) throw new Error('ANI-2x received an invalid coordinate array');
  const aevs = new Float32Array(atomCount * manifest.aevLength);
  for (let center = 0; center < atomCount; center++) {
    const neighbors = [];
    for (let neighbor = 0; neighbor < atomCount; neighbor++) {
      if (neighbor === center) continue;
      const vector = displacement(positions, center, neighbor);
      if (vector.distance < params.radialCutoff) {
        const radialFc = cutoff(vector.distance, params.radialCutoff).value;
        const offset = center * manifest.aevLength + species[neighbor] * params.radialShifts.length;
        for (let shift = 0; shift < params.radialShifts.length; shift++) {
          const delta = vector.distance - params.radialShifts[shift];
          aevs[offset + shift] += 0.25 * Math.exp(-params.radialEta * delta * delta) * radialFc;
        }
      }
      if (vector.distance < params.angularCutoff) neighbors.push(vector);
    }
    for (let first = 0; first < neighbors.length; first++) {
      const one = neighbors[first];
      const cutoffOne = cutoff(one.distance, params.angularCutoff).value;
      for (let second = first + 1; second < neighbors.length; second++) {
        const two = neighbors[second];
        const cutoffTwo = cutoff(two.distance, params.angularCutoff).value;
        const cosine = Math.max(-1, Math.min(1, one.ux * two.ux + one.uy * two.uy + one.uz * two.uz));
        const angle = Math.acos(0.95 * cosine);
        const meanDistance = 0.5 * (one.distance + two.distance);
        const pair = PAIR_INDEX[species[one.index]][species[two.index]];
        const baseOffset = center * manifest.aevLength + 112 + pair * 32;
        for (let shift = 0; shift < params.angularShifts.length; shift++) {
          const radialDelta = meanDistance - params.angularShifts[shift];
          const radial = Math.exp(-params.angularEta * radialDelta * radialDelta);
          for (let section = 0; section < params.angularSections.length; section++) {
            const halfCosine = 0.5 * (1 + Math.cos(angle - params.angularSections[section]));
            const angular = 2 * halfCosine ** params.angularZeta;
            aevs[baseOffset + shift * params.angularSections.length + section]
              += radial * angular * cutoffOne * cutoffTwo;
          }
        }
      }
    }
  }
  return aevs;
}

function addVector(array, atom, scale, x, y, z) {
  const offset = atom * 3;
  array[offset] += scale * x;
  array[offset + 1] += scale * y;
  array[offset + 2] += scale * z;
}

export function contractAni2xAevGradients(species, positions, gradients, manifest) {
  const params = aniParameters(manifest);
  const atomCount = species.length;
  if (gradients.length !== atomCount * manifest.aevLength)
    throw new Error('ANI-2x returned an invalid AEV-gradient array');
  const coordinateGradient = new Float64Array(atomCount * 3);
  for (let center = 0; center < atomCount; center++) {
    const neighbors = [];
    for (let neighbor = 0; neighbor < atomCount; neighbor++) {
      if (neighbor === center) continue;
      const vector = displacement(positions, center, neighbor);
      if (vector.distance < params.radialCutoff) {
        const radialFc = cutoff(vector.distance, params.radialCutoff);
        const offset = center * manifest.aevLength + species[neighbor] * params.radialShifts.length;
        let derivative = 0;
        for (let shift = 0; shift < params.radialShifts.length; shift++) {
          const delta = vector.distance - params.radialShifts[shift];
          const base = 0.25 * Math.exp(-params.radialEta * delta * delta);
          const termDerivative = base * (
            -2 * params.radialEta * delta * radialFc.value + radialFc.derivative);
          derivative += gradients[offset + shift] * termDerivative;
        }
        addVector(coordinateGradient, neighbor, derivative, vector.ux, vector.uy, vector.uz);
        addVector(coordinateGradient, center, -derivative, vector.ux, vector.uy, vector.uz);
      }
      if (vector.distance < params.angularCutoff) neighbors.push(vector);
    }
    for (let first = 0; first < neighbors.length; first++) {
      const one = neighbors[first];
      const cutoffOne = cutoff(one.distance, params.angularCutoff);
      for (let second = first + 1; second < neighbors.length; second++) {
        const two = neighbors[second];
        const cutoffTwo = cutoff(two.distance, params.angularCutoff);
        const cosine = Math.max(-1, Math.min(1,
          one.ux * two.ux + one.uy * two.uy + one.uz * two.uz));
        const scaledCosine = 0.95 * cosine;
        const angle = Math.acos(scaledCosine);
        const inverseAngleSine = 1 / Math.sqrt(Math.max(1e-12, 1 - scaledCosine * scaledCosine));
        const meanDistance = 0.5 * (one.distance + two.distance);
        const pair = PAIR_INDEX[species[one.index]][species[two.index]];
        const baseOffset = center * manifest.aevLength + 112 + pair * 32;
        let derivativeOne = 0;
        let derivativeTwo = 0;
        let derivativeCosine = 0;
        for (let shift = 0; shift < params.angularShifts.length; shift++) {
          const radialDelta = meanDistance - params.angularShifts[shift];
          const radial = Math.exp(-params.angularEta * radialDelta * radialDelta);
          const radialDerivative = -params.angularEta * radialDelta * radial;
          for (let section = 0; section < params.angularSections.length; section++) {
            const delta = angle - params.angularSections[section];
            const halfCosine = 0.5 * (1 + Math.cos(delta));
            const angular = 2 * halfCosine ** params.angularZeta;
            const angularCosineDerivative = 0.95 * params.angularZeta
              * halfCosine ** (params.angularZeta - 1) * Math.sin(delta) * inverseAngleSine;
            const gradient = gradients[baseOffset + shift * params.angularSections.length + section];
            derivativeOne += gradient * angular * cutoffTwo.value
              * (radialDerivative * cutoffOne.value + radial * cutoffOne.derivative);
            derivativeTwo += gradient * angular * cutoffOne.value
              * (radialDerivative * cutoffTwo.value + radial * cutoffTwo.derivative);
            derivativeCosine += gradient * radial * cutoffOne.value * cutoffTwo.value
              * angularCosineDerivative;
          }
        }
        const cosineOneX = (two.ux - cosine * one.ux) / one.distance;
        const cosineOneY = (two.uy - cosine * one.uy) / one.distance;
        const cosineOneZ = (two.uz - cosine * one.uz) / one.distance;
        const cosineTwoX = (one.ux - cosine * two.ux) / two.distance;
        const cosineTwoY = (one.uy - cosine * two.uy) / two.distance;
        const cosineTwoZ = (one.uz - cosine * two.uz) / two.distance;
        const gradientOne = {
          x: derivativeOne * one.ux + derivativeCosine * cosineOneX,
          y: derivativeOne * one.uy + derivativeCosine * cosineOneY,
          z: derivativeOne * one.uz + derivativeCosine * cosineOneZ,
        };
        const gradientTwo = {
          x: derivativeTwo * two.ux + derivativeCosine * cosineTwoX,
          y: derivativeTwo * two.uy + derivativeCosine * cosineTwoY,
          z: derivativeTwo * two.uz + derivativeCosine * cosineTwoZ,
        };
        addVector(coordinateGradient, one.index, 1, gradientOne.x, gradientOne.y, gradientOne.z);
        addVector(coordinateGradient, two.index, 1, gradientTwo.x, gradientTwo.y, gradientTwo.z);
        addVector(coordinateGradient, center, -1,
          gradientOne.x + gradientTwo.x,
          gradientOne.y + gradientTwo.y,
          gradientOne.z + gradientTwo.z);
      }
    }
  }
  return coordinateGradient;
}

export function forceStatistics(forces) {
  let squared = 0;
  let maximum = 0;
  for (let atom = 0; atom < forces.length / 3; atom++) {
    const offset = atom * 3;
    const magnitude = Math.hypot(forces[offset], forces[offset + 1], forces[offset + 2]);
    squared += magnitude * magnitude;
    maximum = Math.max(maximum, magnitude);
  }
  return { rms: Math.sqrt(squared / Math.max(1, forces.length / 3)), maximum };
}
