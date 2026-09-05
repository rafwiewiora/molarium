// OpenFF Sage 2.1 direct WebGPU evaluator.
//
// Potential-energy terms are evaluated directly.  Each Cartesian force
// component is also evaluated by an independent thread, using analytical
// derivatives.  This avoids floating point atomics while keeping force
// accumulation deterministic.  Torsions use forward analytical derivatives
// so their signs exactly follow the dihedral convention used by the energy.

const WORKGROUP_SIZE : u32 = 64u;
const ONE_4PI_EPS0 : f32 = 138.935456;
const BOLTZ : f32 = 0.00831446261815324;
const TWO_PI : f32 = 6.283185307179586;
const OBC_OFFSET : f32 = 0.009;
const OBC_PROBE_RADIUS : f32 = 0.14;
const OBC_DIELECTRIC_FACTOR : f32 = 0.9872286079182631; // 1 - 1/78.3
const OBC_SA_FACTOR : f32 = 28.3919551; // 4*pi*2.25936 kJ/mol/nm^2

struct SimParams {
  numAtoms : u32,
  numBonds : u32,
  numAngles : u32,
  numTorsions : u32,
  numExceptions : u32,
  stepIndex : u32,
  seed : u32,
  implicitSolvent : u32,
  dt : f32,
  friction : f32,
  temperature : f32,
  forceDelta : f32,
  minimizeRate : f32,
  maxDisplacement : f32,
  numConstraints : u32,
  constraintIterations : u32,
  cutoff : f32,
  neighborRadius : f32,
  maxNeighbors : u32,
  neighborRebuildInterval : u32,
  numConstraintColors : u32,
  _pad0 : u32,
  _pad1 : u32,
  _pad2 : u32,
};

struct Bond {
  atoms : vec2<u32>,
  length : f32,
  k : f32,
};

struct Angle {
  atoms : vec4<u32>,
  angle : f32,
  k : f32,
  _pad0 : f32,
  _pad1 : f32,
};

struct Torsion {
  atoms : vec4<u32>,
  values : vec4<f32>, // k, periodicity, phase, unused
};

struct Constraint {
  atoms : vec2<u32>,
  distance : f32,
  color : u32,
};

@group(0) @binding(0) var<uniform> params : SimParams;
@group(0) @binding(1) var<storage, read_write> posm : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocity : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> bonds : array<Bond>;
@group(0) @binding(4) var<storage, read> angles : array<Angle>;
@group(0) @binding(5) var<storage, read> torsions : array<Torsion>;
// Two vec4 records per particle. The first contains charge, sigma, epsilon,
// and mbondi2 radius. The second begins with the OBC2 screening factor.
@group(0) @binding(6) var<storage, read_write> nonbonded : array<vec4<f32>>;
// Cartesian xyz force and an unused fourth lane.
@group(0) @binding(7) var<storage, read_write> forces : array<vec4<f32>>;
@group(0) @binding(8) var<storage, read_write> output : array<f32>;
// First numAtoms+1 values are per-atom reference offsets.  Remaining values
// encode an incident term as two kind bits followed by a 30-bit term index.
@group(0) @binding(9) var<storage, read> incidence : array<u32>;
// Directed sparse exception CSR.  The first numAtoms+1 words are edge
// offsets.  Every edge then stores other:u32 followed by bitcast f32 charge
// product, sigma and epsilon words.  Rows are sorted by `other`.
@group(0) @binding(10) var<storage, read> exceptions : array<u32>;
@group(0) @binding(11) var<storage, read> constraints : array<Constraint>;
// Directed fixed-stride Verlet rows.  The first numAtoms words are counts;
// row entries begin at numAtoms + atom*maxNeighbors.
@group(0) @binding(12) var<storage, read_write> neighbors : array<u32>;

fn useCutoff() -> bool { return params.cutoff > 0.0; }

fn neighborCount(atom : u32) -> u32 {
  return min(neighbors[atom], params.maxNeighbors);
}

fn neighborAt(atom : u32, cursor : u32) -> u32 {
  return neighbors[params.numAtoms + atom * params.maxNeighbors + cursor];
}

fn withinCutoff(atomA : u32, atomB : u32) -> bool {
  if (!useCutoff()) { return true; }
  let delta = posm[atomA].xyz - posm[atomB].xyz;
  return dot(delta, delta) < params.cutoff * params.cutoff;
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn buildNeighborList(@builtin(global_invocation_id) gid : vec3<u32>) {
  let atom = gid.x;
  if (atom >= params.numAtoms || !useCutoff()) { return; }
  let radius2 = params.neighborRadius * params.neighborRadius;
  let rowBase = params.numAtoms + atom * params.maxNeighbors;
  var count = 0u;
  for (var other = 0u; other < params.numAtoms; other = other + 1u) {
    if (other == atom) { continue; }
    let delta = posm[atom].xyz - posm[other].xyz;
    if (dot(delta, delta) <= radius2) {
      if (count < params.maxNeighbors) { neighbors[rowBase + count] = other; }
      count = count + 1u;
    }
  }
  // count>maxNeighbors is retained as an overflow marker for host validation.
  neighbors[atom] = count;
}

fn position(atom : u32, displacedDof : u32, delta : f32) -> vec3<f32> {
  var p = posm[atom].xyz;
  if (displacedDof < params.numAtoms * 3u && atom == displacedDof / 3u) {
    let axis = displacedDof % 3u;
    p[axis] = p[axis] + delta;
  }
  return p;
}

fn particleParameters(atom : u32) -> vec4<f32> {
  return nonbonded[atom * 2u];
}

fn obcParameters(atom : u32) -> vec2<f32> {
  return vec2<f32>(nonbonded[atom * 2u].w, nonbonded[atom * 2u + 1u].x);
}

fn bornData(atom : u32) -> vec3<f32> {
  let data = nonbonded[atom * 2u + 1u];
  return vec3<f32>(data.y, data.z, data.w); // B, dE/dI, dB/dI
}

fn bondPotential(index : u32, displacedDof : u32, delta : f32) -> f32 {
    let term = bonds[index];
    let d = position(term.atoms.x, displacedDof, delta)
          - position(term.atoms.y, displacedDof, delta);
    let dr = length(d) - term.length;
    return 0.5 * term.k * dr * dr;
}

fn anglePotential(index : u32, displacedDof : u32, delta : f32) -> f32 {
    let term = angles[index];
    let a = position(term.atoms.x, displacedDof, delta)
          - position(term.atoms.y, displacedDof, delta);
    let b = position(term.atoms.z, displacedDof, delta)
          - position(term.atoms.y, displacedDof, delta);
    let denominator = max(length(a) * length(b), 1.0e-10);
    let theta = acos(clamp(dot(a, b) / denominator, -1.0, 1.0));
    let dtheta = theta - term.angle;
    return 0.5 * term.k * dtheta * dtheta;
}

fn torsionPotential(index : u32, displacedDof : u32, delta : f32) -> f32 {
    let term = torsions[index];
    let p0 = position(term.atoms.x, displacedDof, delta);
    let p1 = position(term.atoms.y, displacedDof, delta);
    let p2 = position(term.atoms.z, displacedDof, delta);
    let p3 = position(term.atoms.w, displacedDof, delta);
    let b1 = p1 - p0;
    let b2 = p2 - p1;
    let b3 = p3 - p2;
    let c1 = cross(b1, b2);
    let c2 = cross(b2, b3);
    let c1Length = max(length(c1), 1.0e-10);
    let c2Length = max(length(c2), 1.0e-10);
    let b2Unit = b2 / max(length(b2), 1.0e-10);
    let cosine = clamp(dot(c1, c2) / (c1Length * c2Length), -1.0, 1.0);
    let sine = dot(cross(c1, c2), b2Unit) / (c1Length * c2Length);
    let phi = atan2(sine, cosine);
    return term.values.x
      * (1.0 + cos(term.values.y * phi - term.values.z));
}

fn exceptionParameters(atom : u32, other : u32) -> vec4<f32> {
    var low = exceptions[atom];
    var high = exceptions[atom + 1u];
    let end = high;
    let recordBase = params.numAtoms + 1u;
    while (low < high) {
      let middle = low + (high - low) / 2u;
      let candidate = exceptions[recordBase + middle * 4u];
      if (candidate < other) {
        low = middle + 1u;
      } else {
        high = middle;
      }
    }
    if (low < end) {
      let base = recordBase + low * 4u;
      if (exceptions[base] == other) {
        return vec4<f32>(bitcast<f32>(exceptions[base + 1u]),
                         bitcast<f32>(exceptions[base + 2u]),
                         bitcast<f32>(exceptions[base + 3u]), 1.0);
      }
    }
    return vec4<f32>(0.0);
}

fn exceptionParametersAt(cursor : u32) -> vec4<f32> {
    let base = params.numAtoms + 1u + cursor * 4u;
    return vec4<f32>(bitcast<f32>(exceptions[base + 1u]),
                     bitcast<f32>(exceptions[base + 2u]),
                     bitcast<f32>(exceptions[base + 3u]), 1.0);
}

fn ordinaryPairParameters(atomA : u32, atomB : u32) -> vec4<f32> {
    let first = particleParameters(atomA);
    let second = particleParameters(atomB);
    return vec4<f32>(first.x * second.x,
                     0.5 * (first.y + second.y),
                     sqrt(max(0.0, first.z * second.z)), 1.0);
}

fn pairParameters(atomA : u32, atomB : u32) -> vec4<f32> {
    let special = exceptionParameters(atomA, atomB);
    if (special.w > 0.5) { return special; }
    return ordinaryPairParameters(atomA, atomB);
}

fn nonbondPotentialWithParameters(atomA : u32, atomB : u32,
                                  displacedDof : u32, delta : f32,
                                  values : vec4<f32>, applyCutoff : bool) -> f32 {
    if (abs(values.x) < 1.0e-15 && values.z == 0.0) { return 0.0; }
    let d = position(atomA, displacedDof, delta)
          - position(atomB, displacedDof, delta);
    let invR2 = 1.0 / max(dot(d, d), 1.0e-12);
    if (applyCutoff && useCutoff() && invR2 <= 1.0 / (params.cutoff * params.cutoff)) {
      return 0.0;
    }
    let invR = sqrt(invR2);
    let sr2 = values.y * values.y * invR2;
    let sr6 = sr2 * sr2 * sr2;
    var shiftedInverseR = invR;
    if (applyCutoff && useCutoff()) { shiftedInverseR = shiftedInverseR - 1.0 / params.cutoff; }
    return ONE_4PI_EPS0 * values.x * shiftedInverseR
      + 4.0 * values.z * (sr6 * sr6 - sr6);
}

fn nonbondPotential(atomA : u32, atomB : u32, displacedDof : u32, delta : f32) -> f32 {
    let special = exceptionParameters(atomA, atomB);
    if (special.w > 0.5) {
      return nonbondPotentialWithParameters(atomA, atomB, displacedDof, delta, special, false);
    }
    return nonbondPotentialWithParameters(atomA, atomB, displacedDof, delta,
                                          ordinaryPairParameters(atomA, atomB), true);
}

struct Radial {
  value : f32,
  derivative : f32,
};

fn radialAdd(a : Radial, b : Radial) -> Radial {
  return Radial(a.value + b.value, a.derivative + b.derivative);
}

fn radialSubtract(a : Radial, b : Radial) -> Radial {
  return Radial(a.value - b.value, a.derivative - b.derivative);
}

fn radialMultiply(a : Radial, b : Radial) -> Radial {
  return Radial(a.value * b.value,
                a.derivative * b.value + a.value * b.derivative);
}

fn radialScale(a : Radial, scale : f32) -> Radial {
  return Radial(a.value * scale, a.derivative * scale);
}

fn radialInverse(a : Radial) -> Radial {
  let denominator = max(abs(a.value), 1.0e-10);
  let signed = select(-denominator, denominator, a.value >= 0.0);
  return Radial(1.0 / signed, -a.derivative / (signed * signed));
}

fn radialLog(a : Radial) -> Radial {
  let safe = max(a.value, 1.0e-10);
  return Radial(log(safe), a.derivative / safe);
}

fn radialAbs(a : Radial) -> Radial {
  if (a.value > 0.0) { return a; }
  if (a.value < 0.0) { return Radial(-a.value, -a.derivative); }
  return Radial(0.0, 0.0);
}

fn radialMaxConstant(a : Radial, minimum : f32) -> Radial {
  if (a.value > minimum) { return a; }
  return Radial(minimum, 0.0);
}

// Pair contribution to the HCT integral and its radial derivative. This
// includes the complete-inside correction used by OpenMM's Reference OBC2.
fn obcIntegralAndDerivative(atom : u32, other : u32) -> vec2<f32> {
  let delta = posm[atom].xyz - posm[other].xyz;
  let distance = max(length(delta), 1.0e-8);
  if (useCutoff() && distance >= params.cutoff) { return vec2<f32>(0.0); }
  let first = obcParameters(atom);
  let second = obcParameters(other);
  let offsetRadius = first.x - OBC_OFFSET;
  let scaledRadius = (second.x - OBC_OFFSET) * second.y;
  if (offsetRadius >= distance + scaledRadius) { return vec2<f32>(0.0); }

  let r = Radial(distance, 1.0);
  let inverseR = radialInverse(r);
  let lowerLength = radialMaxConstant(
    radialAbs(radialSubtract(r, Radial(scaledRadius, 0.0))), offsetRadius);
  let lower = radialInverse(lowerLength);
  let upper = radialInverse(radialAdd(r, Radial(scaledRadius, 0.0)));
  let lower2 = radialMultiply(lower, lower);
  let upper2 = radialMultiply(upper, upper);
  var term = radialSubtract(lower, upper);
  term = radialAdd(term, radialScale(radialMultiply(r,
    radialSubtract(upper2, lower2)), 0.25));
  term = radialAdd(term, radialScale(radialMultiply(inverseR,
    radialLog(radialMultiply(upper, radialInverse(lower)))), 0.5));
  term = radialAdd(term, radialScale(radialMultiply(inverseR,
    radialSubtract(lower2, upper2)), 0.25 * scaledRadius * scaledRadius));
  if (offsetRadius < scaledRadius - distance) {
    term = radialAdd(term, radialScale(radialSubtract(
      Radial(1.0 / offsetRadius, 0.0), lower), 2.0));
  }
  term = radialScale(term, 0.5);
  return vec2<f32>(term.value, term.derivative);
}

fn obcPairEnergy(first : u32, second : u32) -> f32 {
  if (!withinCutoff(first, second)) { return 0.0; }
  let polarFactor = ONE_4PI_EPS0 * OBC_DIELECTRIC_FACTOR;
  let delta = posm[first].xyz - posm[second].xyz;
  let r2 = dot(delta, delta);
  let product = max(bornData(first).x * bornData(second).x, 1.0e-12);
  let exponential = exp(-r2 / (4.0 * product));
  let denominator = sqrt(max(r2 + product * exponential, 1.0e-12));
  var energy = -polarFactor * particleParameters(first).x
    * particleParameters(second).x / denominator;
  if (useCutoff()) {
    energy = energy + polarFactor * particleParameters(first).x
      * particleParameters(second).x / params.cutoff;
  }
  return energy;
}

fn obcEnergy() -> f32 {
  if (params.implicitSolvent == 0u) { return 0.0; }
  let polarFactor = ONE_4PI_EPS0 * OBC_DIELECTRIC_FACTOR;
  var energy = 0.0;
  for (var atom = 0u; atom < params.numAtoms; atom = atom + 1u) {
    let particle = particleParameters(atom);
    let radius = obcParameters(atom).x;
    let born = max(bornData(atom).x, 1.0e-8);
    energy = energy - 0.5 * polarFactor * particle.x * particle.x / born;
    let ratio = radius / born;
    let ratio2 = ratio * ratio;
    let ratio6 = ratio2 * ratio2 * ratio2;
    energy = energy + OBC_SA_FACTOR * (radius + OBC_PROBE_RADIUS)
      * (radius + OBC_PROBE_RADIUS) * ratio6;
  }
  for (var first = 0u; first < params.numAtoms; first = first + 1u) {
    if (useCutoff()) {
      let count = neighborCount(first);
      for (var cursor = 0u; cursor < count; cursor = cursor + 1u) {
        let second = neighborAt(first, cursor);
        if (second > first) { energy = energy + obcPairEnergy(first, second); }
      }
    } else {
      for (var second = first + 1u; second < params.numAtoms; second = second + 1u) {
        energy = energy + obcPairEnergy(first, second);
      }
    }
  }
  return energy;
}

fn potential(displacedDof : u32, delta : f32) -> f32 {
  var energy = 0.0;
  for (var index = 0u; index < params.numBonds; index = index + 1u) {
    energy = energy + bondPotential(index, displacedDof, delta);
  }
  for (var index = 0u; index < params.numAngles; index = index + 1u) {
    energy = energy + anglePotential(index, displacedDof, delta);
  }
  for (var index = 0u; index < params.numTorsions; index = index + 1u) {
    energy = energy + torsionPotential(index, displacedDof, delta);
  }
  let exceptionRecordBase = params.numAtoms + 1u;
  for (var atomA = 0u; atomA < params.numAtoms; atomA = atomA + 1u) {
    var exceptionCursor = exceptions[atomA];
    let exceptionEnd = exceptions[atomA + 1u];
    while (exceptionCursor < exceptionEnd
           && exceptions[exceptionRecordBase + exceptionCursor * 4u] <= atomA) {
      exceptionCursor = exceptionCursor + 1u;
    }
    if (useCutoff()) {
      // OpenMM exceptions are evaluated independent of the ordinary-pair
      // cutoff, including scaled 1-4 interactions.
      for (var cursor = exceptionCursor; cursor < exceptionEnd; cursor = cursor + 1u) {
        let atomB = exceptions[exceptionRecordBase + cursor * 4u];
        energy = energy + nonbondPotentialWithParameters(atomA, atomB,
          displacedDof, delta, exceptionParametersAt(cursor), false);
      }
      let count = neighborCount(atomA);
      for (var cursor = 0u; cursor < count; cursor = cursor + 1u) {
        let atomB = neighborAt(atomA, cursor);
        if (atomB > atomA && exceptionParameters(atomA, atomB).w < 0.5) {
          energy = energy + nonbondPotentialWithParameters(atomA, atomB,
            displacedDof, delta, ordinaryPairParameters(atomA, atomB), true);
        }
      }
    } else {
      for (var atomB = atomA + 1u; atomB < params.numAtoms; atomB = atomB + 1u) {
        var values = vec4<f32>(0.0);
        if (exceptionCursor < exceptionEnd
            && exceptions[exceptionRecordBase + exceptionCursor * 4u] == atomB) {
          values = exceptionParametersAt(exceptionCursor);
          exceptionCursor = exceptionCursor + 1u;
        } else {
          values = ordinaryPairParameters(atomA, atomB);
        }
        energy = energy + nonbondPotentialWithParameters(atomA, atomB,
                                                          displacedDof, delta, values, false);
      }
    }
  }
  energy = energy + obcEnergy();
  return energy;
}

fn localPotential(displacedDof : u32, delta : f32) -> f32 {
  let atom = displacedDof / 3u;
  var energy = 0.0;
  for (var index = 0u; index < params.numBonds; index = index + 1u) {
    let term = bonds[index];
    if (term.atoms.x == atom || term.atoms.y == atom) {
      energy = energy + bondPotential(index, displacedDof, delta);
    }
  }
  for (var index = 0u; index < params.numAngles; index = index + 1u) {
    let term = angles[index];
    if (term.atoms.x == atom || term.atoms.y == atom || term.atoms.z == atom) {
      energy = energy + anglePotential(index, displacedDof, delta);
    }
  }
  for (var index = 0u; index < params.numTorsions; index = index + 1u) {
    let term = torsions[index];
    if (term.atoms.x == atom || term.atoms.y == atom
        || term.atoms.z == atom || term.atoms.w == atom) {
      energy = energy + torsionPotential(index, displacedDof, delta);
    }
  }
  for (var other = 0u; other < params.numAtoms; other = other + 1u) {
    if (other == atom) { continue; }
    let atomA = min(atom, other);
    let atomB = max(atom, other);
    energy = energy + nonbondPotential(atomA, atomB, displacedDof, delta);
  }
  return energy;
}

fn bondForceComponent(index : u32, atom : u32, axis : u32) -> f32 {
  let term = bonds[index];
  if (term.atoms.x != atom && term.atoms.y != atom) { return 0.0; }
  let delta = posm[term.atoms.x].xyz - posm[term.atoms.y].xyz;
  let distance = max(length(delta), 1.0e-10);
  let forceOnFirst = -term.k * (distance - term.length) * delta / distance;
  if (term.atoms.x == atom) { return forceOnFirst[axis]; }
  return -forceOnFirst[axis];
}

fn angleForceComponent(index : u32, atom : u32, axis : u32) -> f32 {
  let term = angles[index];
  if (term.atoms.x != atom && term.atoms.y != atom && term.atoms.z != atom) {
    return 0.0;
  }
  let first = posm[term.atoms.x].xyz - posm[term.atoms.y].xyz;
  let second = posm[term.atoms.z].xyz - posm[term.atoms.y].xyz;
  let firstLength = max(length(first), 1.0e-10);
  let secondLength = max(length(second), 1.0e-10);
  let firstUnit = first / firstLength;
  let secondUnit = second / secondLength;
  let cosine = clamp(dot(firstUnit, secondUnit), -1.0, 1.0);
  let sine = sqrt(max(1.0 - cosine * cosine, 1.0e-12));
  let dEdTheta = term.k * (acos(cosine) - term.angle);
  let forceOnFirst = dEdTheta * (secondUnit - cosine * firstUnit)
                   / (firstLength * sine);
  let forceOnThird = dEdTheta * (firstUnit - cosine * secondUnit)
                   / (secondLength * sine);
  if (term.atoms.x == atom) { return forceOnFirst[axis]; }
  if (term.atoms.z == atom) { return forceOnThird[axis]; }
  return -(forceOnFirst[axis] + forceOnThird[axis]);
}

struct Dual {
  value : f32,
  derivative : f32,
};

struct DualVector {
  value : vec3<f32>,
  derivative : vec3<f32>,
};

fn dualPosition(positionAtom : u32, differentiatedAtom : u32, axis : u32) -> DualVector {
  var derivative = vec3<f32>(0.0);
  if (positionAtom == differentiatedAtom) { derivative[axis] = 1.0; }
  return DualVector(posm[positionAtom].xyz, derivative);
}

fn dualSubtract(first : DualVector, second : DualVector) -> DualVector {
  return DualVector(first.value - second.value,
                    first.derivative - second.derivative);
}

fn dualCross(first : DualVector, second : DualVector) -> DualVector {
  return DualVector(cross(first.value, second.value),
                    cross(first.derivative, second.value)
                      + cross(first.value, second.derivative));
}

fn dualDot(first : DualVector, second : DualVector) -> Dual {
  return Dual(dot(first.value, second.value),
              dot(first.derivative, second.value)
                + dot(first.value, second.derivative));
}

fn dualLength(vector : DualVector) -> Dual {
  let value = length(vector.value);
  if (value <= 1.0e-10) { return Dual(1.0e-10, 0.0); }
  return Dual(value, dot(vector.value, vector.derivative) / value);
}

fn dualMultiply(first : Dual, second : Dual) -> Dual {
  return Dual(first.value * second.value,
              first.derivative * second.value + first.value * second.derivative);
}

fn dualDivide(first : Dual, second : Dual) -> Dual {
  let denominator = max(abs(second.value), 1.0e-10);
  let signedDenominator = select(-denominator, denominator, second.value >= 0.0);
  return Dual(first.value / signedDenominator,
              (first.derivative * signedDenominator
                - first.value * second.derivative)
                / (signedDenominator * signedDenominator));
}

fn dualVectorDivide(vector : DualVector, scalar : Dual) -> DualVector {
  let denominator = max(abs(scalar.value), 1.0e-10);
  let signedDenominator = select(-denominator, denominator, scalar.value >= 0.0);
  return DualVector(vector.value / signedDenominator,
                    (vector.derivative * signedDenominator
                      - vector.value * scalar.derivative)
                      / (signedDenominator * signedDenominator));
}

fn torsionForceComponent(index : u32, atom : u32, axis : u32) -> f32 {
  let term = torsions[index];
  if (term.atoms.x != atom && term.atoms.y != atom
      && term.atoms.z != atom && term.atoms.w != atom) {
    return 0.0;
  }

  let p0 = dualPosition(term.atoms.x, atom, axis);
  let p1 = dualPosition(term.atoms.y, atom, axis);
  let p2 = dualPosition(term.atoms.z, atom, axis);
  let p3 = dualPosition(term.atoms.w, atom, axis);
  let b1 = dualSubtract(p1, p0);
  let b2 = dualSubtract(p2, p1);
  let b3 = dualSubtract(p3, p2);
  let c1 = dualCross(b1, b2);
  let c2 = dualCross(b2, b3);
  let c1Length = dualLength(c1);
  let c2Length = dualLength(c2);
  let normalDenominator = dualMultiply(c1Length, c2Length);

  var cosine = dualDivide(dualDot(c1, c2), normalDenominator);
  if (cosine.value <= -1.0 || cosine.value >= 1.0) {
    cosine.derivative = 0.0;
  }
  cosine.value = clamp(cosine.value, -1.0, 1.0);

  let b2Unit = dualVectorDivide(b2, dualLength(b2));
  let sine = dualDivide(dualDot(dualCross(c1, c2), b2Unit),
                        normalDenominator);
  let phi = atan2(sine.value, cosine.value);
  let atanDenominator = max(sine.value * sine.value
                          + cosine.value * cosine.value, 1.0e-12);
  let phiDerivative = (cosine.value * sine.derivative
                     - sine.value * cosine.derivative) / atanDenominator;
  let argument = term.values.y * phi - term.values.z;
  return term.values.x * term.values.y * sin(argument) * phiDerivative;
}

fn nonbondForce(atomA : u32, atomB : u32, values : vec4<f32>,
                applyCutoff : bool) -> vec3<f32> {
  if (abs(values.x) < 1.0e-15 && values.z == 0.0) {
    return vec3<f32>(0.0);
  }
  let delta = posm[atomA].xyz - posm[atomB].xyz;
  let invR2 = 1.0 / max(dot(delta, delta), 1.0e-12);
  if (applyCutoff && useCutoff() && invR2 <= 1.0 / (params.cutoff * params.cutoff)) {
    return vec3<f32>(0.0);
  }
  let invR = sqrt(invR2);
  let sr2 = values.y * values.y * invR2;
  let sr6 = sr2 * sr2 * sr2;
  let coefficient = ONE_4PI_EPS0 * values.x * invR2 * invR
                  + 24.0 * values.z * (2.0 * sr6 * sr6 - sr6) * invR2;
  return coefficient * delta;
}

fn bondForce(index : u32, atom : u32) -> vec3<f32> {
  return vec3<f32>(bondForceComponent(index, atom, 0u),
                   bondForceComponent(index, atom, 1u),
                   bondForceComponent(index, atom, 2u));
}

fn angleForce(index : u32, atom : u32) -> vec3<f32> {
  return vec3<f32>(angleForceComponent(index, atom, 0u),
                   angleForceComponent(index, atom, 1u),
                   angleForceComponent(index, atom, 2u));
}

fn torsionForce(index : u32, atom : u32) -> vec3<f32> {
  return vec3<f32>(torsionForceComponent(index, atom, 0u),
                   torsionForceComponent(index, atom, 1u),
                   torsionForceComponent(index, atom, 2u));
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn computeBornRadii(@builtin(global_invocation_id) gid : vec3<u32>) {
  let atom = gid.x;
  if (atom >= params.numAtoms || params.implicitSolvent == 0u) { return; }
  let obc = obcParameters(atom);
  let offsetRadius = obc.x - OBC_OFFSET;
  var integral = 0.0;
  if (useCutoff()) {
    let count = neighborCount(atom);
    for (var cursor = 0u; cursor < count; cursor = cursor + 1u) {
      integral = integral + obcIntegralAndDerivative(atom, neighborAt(atom, cursor)).x;
    }
  } else {
    for (var other = 0u; other < params.numAtoms; other = other + 1u) {
      if (other != atom) { integral = integral + obcIntegralAndDerivative(atom, other).x; }
    }
  }
  let psi = integral * offsetRadius;
  let psi2 = psi * psi;
  let argument = psi - 0.8 * psi2 + 4.85 * psi2 * psi;
  let hyperbolic = tanh(argument);
  let born = 1.0 / (1.0 / offsetRadius - hyperbolic / obc.x);
  let chain = (1.0 - hyperbolic * hyperbolic) * offsetRadius
    * (1.0 - 1.6 * psi + 14.55 * psi2) / obc.x;
  let dBornDIntegral = born * born * chain;
  var data = nonbonded[atom * 2u + 1u];
  data.y = born;
  data.z = integral;
  data.w = dBornDIntegral;
  nonbonded[atom * 2u + 1u] = data;
}

fn obcBornDerivativeContribution(atom : u32, other : u32, born : f32) -> f32 {
  if (!withinCutoff(atom, other)) { return 0.0; }
  let polarFactor = ONE_4PI_EPS0 * OBC_DIELECTRIC_FACTOR;
  let otherBorn = max(bornData(other).x, 1.0e-8);
  let delta = posm[atom].xyz - posm[other].xyz;
  let r2 = dot(delta, delta);
  let product = max(born * otherBorn, 1.0e-12);
  let scaledDistance = r2 / (4.0 * product);
  let exponential = exp(-scaledDistance);
  let denominator2 = max(r2 + product * exponential, 1.0e-12);
  let denominator = sqrt(denominator2);
  return 0.5 * polarFactor * particleParameters(atom).x
    * particleParameters(other).x * otherBorn * exponential
    * (1.0 + scaledDistance) / (denominator2 * denominator);
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn computeBornDerivatives(@builtin(global_invocation_id) gid : vec3<u32>) {
  let atom = gid.x;
  if (atom >= params.numAtoms || params.implicitSolvent == 0u) { return; }
  let polarFactor = ONE_4PI_EPS0 * OBC_DIELECTRIC_FACTOR;
  let particle = particleParameters(atom);
  let radius = obcParameters(atom).x;
  let data = bornData(atom);
  let born = max(data.x, 1.0e-8);
  var derivative = 0.5 * polarFactor * particle.x * particle.x / (born * born);
  let ratio = radius / born;
  let ratio2 = ratio * ratio;
  let ratio6 = ratio2 * ratio2 * ratio2;
  let surface = OBC_SA_FACTOR * (radius + OBC_PROBE_RADIUS)
    * (radius + OBC_PROBE_RADIUS) * ratio6;
  derivative = derivative - 6.0 * surface / born;
  if (useCutoff()) {
    let count = neighborCount(atom);
    for (var cursor = 0u; cursor < count; cursor = cursor + 1u) {
      derivative = derivative + obcBornDerivativeContribution(
        atom, neighborAt(atom, cursor), born);
    }
  } else {
    for (var other = 0u; other < params.numAtoms; other = other + 1u) {
      if (other != atom) {
        derivative = derivative + obcBornDerivativeContribution(atom, other, born);
      }
    }
  }
  var packed = nonbonded[atom * 2u + 1u];
  packed.z = derivative * data.z;
  nonbonded[atom * 2u + 1u] = packed;
}

fn obcForcePair(atom : u32, other : u32, firstBorn : vec3<f32>) -> vec3<f32> {
  if (!withinCutoff(atom, other)) { return vec3<f32>(0.0); }
  let polarFactor = ONE_4PI_EPS0 * OBC_DIELECTRIC_FACTOR;
  let secondBorn = bornData(other);
  let delta = posm[atom].xyz - posm[other].xyz;
  let r2 = max(dot(delta, delta), 1.0e-12);
  let distance = sqrt(r2);
  let product = max(firstBorn.x * secondBorn.x, 1.0e-12);
  let exponential = exp(-r2 / (4.0 * product));
  let denominator2 = max(r2 + product * exponential, 1.0e-12);
  let denominator = sqrt(denominator2);
  let direct = -polarFactor * particleParameters(atom).x
    * particleParameters(other).x * (1.0 - 0.25 * exponential)
    / (denominator2 * denominator);
  let chain = firstBorn.y * obcIntegralAndDerivative(atom, other).y
    + secondBorn.y * obcIntegralAndDerivative(other, atom).y;
  return (direct - chain / distance) * delta;
}

fn obcForce(atom : u32) -> vec3<f32> {
  if (params.implicitSolvent == 0u) { return vec3<f32>(0.0); }
  let firstBorn = bornData(atom);
  var force = vec3<f32>(0.0);
  if (useCutoff()) {
    let count = neighborCount(atom);
    for (var cursor = 0u; cursor < count; cursor = cursor + 1u) {
      force = force + obcForcePair(atom, neighborAt(atom, cursor), firstBorn);
    }
  } else {
    for (var other = 0u; other < params.numAtoms; other = other + 1u) {
      if (other != atom) { force = force + obcForcePair(atom, other, firstBorn); }
    }
  }
  return force;
}

// Sum each atom's upper-triangle row separately, then reduce a workgroup tree.
// A single f32 accumulator over every pair loses small LJ/GB contributions on
// proteins (the independent native-OpenMM benchmark catches this for ubiquitin).
// This changes accumulation order only: the pair equations and exclusions are
// the same as the force kernels and the former serial energy evaluator.
fn energyRow(atomA : u32) -> f32 {
  var nonbondedEnergy = 0.0;
  var solventEnergy = 0.0;
  let recordBase = params.numAtoms + 1u;
  var exceptionCursor = exceptions[atomA];
  let exceptionEnd = exceptions[atomA + 1u];
  while (exceptionCursor < exceptionEnd
      && exceptions[recordBase + exceptionCursor * 4u] <= atomA) {
    exceptionCursor = exceptionCursor + 1u;
  }
  if (useCutoff()) {
    for (var cursor = exceptionCursor; cursor < exceptionEnd; cursor = cursor + 1u) {
      let atomB = exceptions[recordBase + cursor * 4u];
      nonbondedEnergy = nonbondedEnergy + nonbondPotentialWithParameters(atomA, atomB,
        0xffffffffu, 0.0, exceptionParametersAt(cursor), false);
    }
    let count = neighborCount(atomA);
    for (var cursor = 0u; cursor < count; cursor = cursor + 1u) {
      let atomB = neighborAt(atomA, cursor);
      if (atomB > atomA) {
        if (exceptionParameters(atomA, atomB).w < 0.5) {
          nonbondedEnergy = nonbondedEnergy + nonbondPotentialWithParameters(atomA, atomB,
            0xffffffffu, 0.0, ordinaryPairParameters(atomA, atomB), true);
        }
        if (params.implicitSolvent != 0u) { solventEnergy = solventEnergy + obcPairEnergy(atomA, atomB); }
      }
    }
  } else {
    for (var atomB = atomA + 1u; atomB < params.numAtoms; atomB = atomB + 1u) {
      var values = vec4<f32>(0.0);
      if (exceptionCursor < exceptionEnd
          && exceptions[recordBase + exceptionCursor * 4u] == atomB) {
        values = exceptionParametersAt(exceptionCursor);
        exceptionCursor = exceptionCursor + 1u;
      } else {
        values = ordinaryPairParameters(atomA, atomB);
      }
      nonbondedEnergy = nonbondedEnergy + nonbondPotentialWithParameters(atomA, atomB,
        0xffffffffu, 0.0, values, false);
      if (params.implicitSolvent != 0u) { solventEnergy = solventEnergy + obcPairEnergy(atomA, atomB); }
    }
  }
  if (params.implicitSolvent != 0u) {
    let charge = particleParameters(atomA).x;
    let radius = obcParameters(atomA).x;
    let born = max(bornData(atomA).x, 1.0e-8);
    solventEnergy = solventEnergy - 0.5 * ONE_4PI_EPS0 * OBC_DIELECTRIC_FACTOR * charge * charge / born;
    let ratio = radius / born;
    let ratio2 = ratio * ratio;
    let ratio6 = ratio2 * ratio2 * ratio2;
    solventEnergy = solventEnergy + OBC_SA_FACTOR * (radius + OBC_PROBE_RADIUS)
      * (radius + OBC_PROBE_RADIUS) * ratio6;
  }
  return nonbondedEnergy + solventEnergy;
}

var<workgroup> energyReduction : array<f32, 64>;

@compute @workgroup_size(WORKGROUP_SIZE)
fn computeEnergy(@builtin(local_invocation_id) lid : vec3<u32>) {
  let lane = lid.x;
  var energy = 0.0;
  for (var index = lane; index < params.numBonds; index = index + WORKGROUP_SIZE) {
    energy = energy + bondPotential(index, 0xffffffffu, 0.0);
  }
  for (var index = lane; index < params.numAngles; index = index + WORKGROUP_SIZE) {
    energy = energy + anglePotential(index, 0xffffffffu, 0.0);
  }
  for (var index = lane; index < params.numTorsions; index = index + WORKGROUP_SIZE) {
    energy = energy + torsionPotential(index, 0xffffffffu, 0.0);
  }
  for (var atom = lane; atom < params.numAtoms; atom = atom + WORKGROUP_SIZE) {
    energy = energy + energyRow(atom);
  }
  energyReduction[lane] = energy;
  workgroupBarrier();
  for (var stride = WORKGROUP_SIZE / 2u; stride > 0u; stride = stride / 2u) {
    if (lane < stride) { energyReduction[lane] = energyReduction[lane] + energyReduction[lane + stride]; }
    workgroupBarrier();
  }
  if (lane == 0u) { output[0] = energyReduction[0]; }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn computeForces(@builtin(global_invocation_id) gid : vec3<u32>) {
  let atom = gid.x;
  if (atom >= params.numAtoms) { return; }
  // A zero inverse mass marks a fixed atom in an interactive pocket
  // minimization.  Movable atoms still evaluate their complete interactions
  // against these coordinates, but fixed atoms need no force accumulation.
  if (posm[atom].w <= 0.0) {
    forces[atom] = vec4<f32>(0.0);
    return;
  }
  var force = vec3<f32>(0.0);
  let referenceBase = params.numAtoms + 1u;
  let referenceEnd = incidence[atom + 1u];
  for (var cursor = incidence[atom]; cursor < referenceEnd; cursor = cursor + 1u) {
    let reference = incidence[referenceBase + cursor];
    let kind = reference >> 30u;
    let index = reference & 0x3fffffffu;
    if (kind == 0u) {
      force = force + bondForce(index, atom);
    } else if (kind == 1u) {
      force = force + angleForce(index, atom);
    } else {
      force = force + torsionForce(index, atom);
    }
  }
  let exceptionRecordBase = params.numAtoms + 1u;
  let exceptionStart = exceptions[atom];
  var exceptionCursor = exceptionStart;
  let exceptionEnd = exceptions[atom + 1u];
  if (useCutoff()) {
    // Exceptions are complete, not cutoff-limited.
    for (var cursor = exceptionStart; cursor < exceptionEnd; cursor = cursor + 1u) {
      let other = exceptions[exceptionRecordBase + cursor * 4u];
      force = force + nonbondForce(atom, other, exceptionParametersAt(cursor), false);
    }
    let count = neighborCount(atom);
    for (var cursor = 0u; cursor < count; cursor = cursor + 1u) {
      let other = neighborAt(atom, cursor);
      if (exceptionParameters(atom, other).w < 0.5) {
        force = force + nonbondForce(atom, other,
          ordinaryPairParameters(atom, other), true);
      }
    }
  } else {
    for (var other = 0u; other < params.numAtoms; other = other + 1u) {
      if (other == atom) { continue; }
      var values = vec4<f32>(0.0);
      if (exceptionCursor < exceptionEnd
          && exceptions[exceptionRecordBase + exceptionCursor * 4u] == other) {
        values = exceptionParametersAt(exceptionCursor);
        exceptionCursor = exceptionCursor + 1u;
      } else {
        values = ordinaryPairParameters(atom, other);
      }
      force = force + nonbondForce(atom, other, values, false);
    }
  }
  force = force + obcForce(atom);
  force = clamp(force, vec3<f32>(-1.0e7), vec3<f32>(1.0e7));
  forces[atom] = vec4<f32>(force, 0.0);
}

fn hash(value : u32) -> u32 {
  var x = value;
  x = x ^ (x >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  return x ^ (x >> 16u);
}

fn randomUniform(atom : u32, lane : u32) -> f32 {
  let mixed = params.seed ^ (params.stepIndex * 0x9e3779b9u)
    ^ (atom * 0x85ebca6bu) ^ (lane * 0xc2b2ae35u);
  return max((f32(hash(mixed)) + 0.5) / 4294967296.0, 1.0e-7);
}

fn gaussian3(atom : u32) -> vec3<f32> {
  let u0 = randomUniform(atom, 0u);
  let u1 = randomUniform(atom, 1u);
  let u2 = randomUniform(atom, 2u);
  let u3 = randomUniform(atom, 3u);
  let r0 = sqrt(-2.0 * log(u0));
  let r1 = sqrt(-2.0 * log(u2));
  return vec3<f32>(r0 * cos(TWO_PI * u1), r0 * sin(TWO_PI * u1),
                   r1 * cos(TWO_PI * u3));
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn integrateLangevin(@builtin(global_invocation_id) gid : vec3<u32>) {
  let atom = gid.x;
  if (atom >= params.numAtoms) { return; }
  var p = posm[atom];
  if (p.w <= 0.0) { return; }
  var v = velocity[atom];
  let c = exp(-params.friction * params.dt);
  let noise = sqrt(max(0.0, BOLTZ * params.temperature * p.w * (1.0 - c * c)));
  let force = forces[atom].xyz;
  v = vec4<f32>(c * v.xyz + params.dt * p.w * force
                + noise * gaussian3(atom), 0.0);
  p = vec4<f32>(p.xyz + params.dt * v.xyz, p.w);
  velocity[atom] = v;
  posm[atom] = p;
}

// A serial constraint kernel is deliberately used for the first portable
// implementation.  It provides deterministic Gauss-Seidel SHAKE and RATTLE
// without unavailable floating-point atomics.  The constrained edge count is
// O(N) and force evaluation dominates for the protein-sized browser targets.
@compute @workgroup_size(256)
fn applyShakeRattle(@builtin(local_invocation_id) lid : vec3<u32>) {
  if (params.numConstraints == 0u) {
    if (lid.x == 0u) { output[1] = 0.0; }
    return;
  }

  let iterations = max(params.constraintIterations, 1u);
  for (var iteration = 0u; iteration < iterations; iteration = iteration + 1u) {
    for (var color = 0u; color < params.numConstraintColors; color = color + 1u) {
      for (var index = lid.x; index < params.numConstraints; index = index + 256u) {
        let term = constraints[index];
        if (term.color == color) {
          var first = posm[term.atoms.x];
          var second = posm[term.atoms.y];
          let delta = first.xyz - second.xyz;
          let distance2 = max(dot(delta, delta), 1.0e-12);
          let inverseMassSum = first.w + second.w;
          if (inverseMassSum > 0.0) {
            let target2 = term.distance * term.distance;
            let multiplier = (distance2 - target2) / (2.0 * inverseMassSum * distance2);
            let firstCorrection = -first.w * multiplier * delta;
            let secondCorrection = second.w * multiplier * delta;
            first = vec4<f32>(first.xyz + firstCorrection, first.w);
            second = vec4<f32>(second.xyz + secondCorrection, second.w);
            posm[term.atoms.x] = first;
            posm[term.atoms.y] = second;
            if (params.dt > 0.0) {
              velocity[term.atoms.x] = vec4<f32>(
                velocity[term.atoms.x].xyz + firstCorrection / params.dt, 0.0);
              velocity[term.atoms.y] = vec4<f32>(
                velocity[term.atoms.y].xyz + secondCorrection / params.dt, 0.0);
            }
          }
        }
      }
      storageBarrier();
      workgroupBarrier();
    }
  }

  // RATTLE projects relative velocities onto the tangent space of every
  // constrained bond after SHAKE has corrected positions.
  for (var iteration = 0u; iteration < iterations; iteration = iteration + 1u) {
    for (var color = 0u; color < params.numConstraintColors; color = color + 1u) {
      for (var index = lid.x; index < params.numConstraints; index = index + 256u) {
        let term = constraints[index];
        if (term.color == color) {
          let first = posm[term.atoms.x];
          let second = posm[term.atoms.y];
          let delta = first.xyz - second.xyz;
          let distance2 = max(dot(delta, delta), 1.0e-12);
          let inverseMassSum = first.w + second.w;
          if (inverseMassSum > 0.0) {
            var firstVelocity = velocity[term.atoms.x];
            var secondVelocity = velocity[term.atoms.y];
            let multiplier = dot(delta, firstVelocity.xyz - secondVelocity.xyz)
              / (inverseMassSum * distance2);
            firstVelocity = vec4<f32>(firstVelocity.xyz - first.w * multiplier * delta, 0.0);
            secondVelocity = vec4<f32>(secondVelocity.xyz + second.w * multiplier * delta, 0.0);
            velocity[term.atoms.x] = firstVelocity;
            velocity[term.atoms.y] = secondVelocity;
          }
        }
      }
      storageBarrier();
      workgroupBarrier();
    }
  }
  if (lid.x == 0u) { output[1] = 0.0; }
}

@compute @workgroup_size(WORKGROUP_SIZE)
fn minimizeStep(@builtin(global_invocation_id) gid : vec3<u32>) {
  let atom = gid.x;
  if (atom >= params.numAtoms) { return; }
  var p = posm[atom];
  if (p.w <= 0.0) { return; }
  let force = forces[atom].xyz;
  var displacement = params.minimizeRate * force;
  let distance = length(displacement);
  if (distance > params.maxDisplacement) {
    displacement = displacement * (params.maxDisplacement / distance);
  }
  posm[atom] = vec4<f32>(p.xyz + displacement, p.w);
}
