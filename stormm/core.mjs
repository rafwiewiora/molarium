// stormm-webgpu v0.3 core: WGSL molecular mechanics kernels + topology builders
// Units: Angstrom, kcal/mol, amu, ps.  a[A/ps^2] = 418.4 * F[kcal/mol/A] / m[amu]
//
// Numeric representations (fixed-point accumulation is deterministic and order-independent):
//   energies    : int64 split (2 x atomic<u32>, manual carry) @ 2^22 per kcal/mol
//   forces      : int64 split (2 x atomic<u32>, manual carry) @ 2^18 per kcal/mol/A
//   coordinates : int64 fixed-point (2 x u32) @ 2^32 per A (authoritative; f32 mirror for kernels)
// Single-contribution magnitude limit: |value| < 9e15 / scale (guard clamp far beyond physics).
import { validateNumericSystem, validatePackedFloat32 } from '../openff/numeric-system.mjs';
export const WG = 64;
export const ESCALE = 4194304;        // 2^22 per kcal/mol
export const FSCALE = 262144;         // 2^18 per kcal/mol/A
export const GSCALE = 4294967296;     // 2^32 per Angstrom
export const KCAL2A = 418.4;
export const KB = 0.0019872;
export const COUL = 332.0636;
export const OBC_SOLVENT_DIELECTRIC = 78.3;
export const OBC_SA_FACTOR = 0.0678584013; // kcal/mol/A^2, includes 4*pi
export const NUMERIC_FAULT_NAN = 1;
export const NUMERIC_FAULT_CLAMPED = 2;
export const CONSTRAINT_FAULT_POSITION = 1;
export const CONSTRAINT_FAULT_VELOCITY = 2;
export const CONSTRAINT_FAULT_GEOMETRY = 4;
export const CONSTRAINT_RESIDUAL_SCALE = 1000000000;

export const SHADER = /* wgsl */`
struct P {
  nAtoms:u32, nReps:u32, nBonds:u32, nAngles:u32, nDih:u32, nPairs:u32, thermo:u32, seed:u32,
  oBondI:u32, oAngleI:u32, oDihI:u32, oPairI:u32, oExcl:u32,
  oBondP:u32, oAngleP:u32, oDihP:u32, oPairP:u32, oProps:u32,
  dt:f32, gamma:f32, kT:f32, exclW:u32, implicitSolvent:u32, oObc:u32,
  coulombConstant:f32, obcDielectricFactor:f32, obcSurfaceAreaFactor:f32,
  nConstraints:u32, oConstraintI:u32, oConstraintP:u32, constraintIterations:u32,
  constraintTolerance:f32,
};
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var<storage, read_write> pos:array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel:array<vec4f>;
@group(0) @binding(3) var<storage, read_write> frc:array<atomic<u32>>;   // int64 split, 6 words/atom
@group(0) @binding(4) var<storage, read_write> acc:array<atomic<u32>>;   // int64 split, 16 words/replica
@group(0) @binding(5) var<storage, read> tu:array<u32>;                   // packed topology (indices, masks)
@group(0) @binding(6) var<storage, read> tf:array<f32>;                   // packed topology (parameters)
@group(0) @binding(7) var<storage, read_write> posFix:array<u32>;         // int64 coords, 6 words/atom

const ESCALE = ${ESCALE}.0;
const FSCALE = ${FSCALE}.0;
const GSCALE = ${GSCALE}.0;
const KCAL2A = ${KCAL2A};
const OBC_OFFSET = 0.09;                         // Angstrom
const OBC_PROBE_RADIUS = 1.4;                    // Angstrom
const CONSTRAINT_RESIDUAL_SCALE = ${CONSTRAINT_RESIDUAL_SCALE}.0;

fn controlIndex(word:u32) -> u32 { return p.nReps*16u + word; }

// ---- int64 helpers (two's-complement in a lo/hi pair of u32) ----
fn splitI64(x0:f32) -> vec2u {                 // exact int64 of round(x), |x| clamped < 9e15
  var x = x0;
  if (x != x){                                  // clamp(NaN) remains NaN: handle it explicitly
    atomicOr(&acc[controlIndex(1u)], 1u);
    x = 0.0;
  }
  if (abs(x) > 9.0e15){
    atomicOr(&acc[controlIndex(1u)], 2u);
    x = clamp(x, -9.0e15, 9.0e15);
  }
  let a = round(abs(x));
  let hi_f = floor(a / 4294967296.0);
  let lo_f = a - hi_f * 4294967296.0;          // exact (power-of-two split)
  var lo = u32(lo_f);
  var hi = u32(hi_f);
  if (x < 0.0){                                 // negate 64-bit
    lo = 0u - lo;
    hi = select(~hi, 0u - hi, lo == 0u);
  }
  return vec2u(lo, hi);
}
fn i64ToF32(lo0:u32, hi0:u32) -> f32 {          // sign-magnitude conversion avoids cancellation
  var lo = lo0; var hi = hi0; var s = 1.0;
  if ((hi & 0x80000000u) != 0u){
    s = -1.0;
    lo = 0u - lo;
    hi = select(~hi0, 0u - hi0, lo == 0u);
  }
  return s * (f32(hi) * 4294967296.0 + f32(lo));
}
fn addAcc64(base:u32, val:f32){                 // energy accumulate @ ESCALE
  let v = splitI64(val * ESCALE);
  let old = atomicAdd(&acc[base], v.x);
  let carry = select(0u, 1u, (old + v.x) < old);
  atomicAdd(&acc[base + 1u], v.y + carry);
}
fn addFrc64(word:u32, val:f32){                 // force accumulate @ FSCALE
  let v = splitI64(val * FSCALE);
  let old = atomicAdd(&frc[word], v.x);
  let carry = select(0u, 1u, (old + v.x) < old);
  atomicAdd(&frc[word + 1u], v.y + carry);
}
fn addForce(g:u32, f:vec3f){
  addFrc64((g*3u + 0u)*2u, f.x);
  addFrc64((g*3u + 1u)*2u, f.y);
  addFrc64((g*3u + 2u)*2u, f.z);
}
fn loadForce(g:u32) -> vec3f {
  return vec3f(
    i64ToF32(atomicLoad(&frc[(g*3u+0u)*2u]), atomicLoad(&frc[(g*3u+0u)*2u+1u])),
    i64ToF32(atomicLoad(&frc[(g*3u+1u)*2u]), atomicLoad(&frc[(g*3u+1u)*2u+1u])),
    i64ToF32(atomicLoad(&frc[(g*3u+2u)*2u]), atomicLoad(&frc[(g*3u+2u)*2u+1u]))) / FSCALE;
}

fn addFixedPosition(g:u32, displacement:vec3f){
  var mirror = pos[g].xyz;
  for (var c = 0u; c < 3u; c++){
    let word = (g*3u + c)*2u;
    let increment = splitI64(displacement[c] * GSCALE);
    let lo = posFix[word];
    let hi = posFix[word + 1u];
    let nextLo = lo + increment.x;
    let carry = select(0u, 1u, nextLo < lo);
    let nextHi = hi + increment.y + carry;
    posFix[word] = nextLo;
    posFix[word + 1u] = nextHi;
    mirror[c] = i64ToF32(nextLo, nextHi) / GSCALE;
  }
  pos[g] = vec4f(mirror, pos[g].w);
}

fn recordConstraintResidual(rep:u32, residual:f32){
  let scaled = u32(round(clamp(residual, 0.0, 4.0) * CONSTRAINT_RESIDUAL_SCALE));
  atomicMax(&acc[rep*16u + 15u], scaled);
}

// ---- precise inverse trig (WGSL builtins permit ~1e-4 abs error: unusable at MM force constants) ----
fn asinCore(x:f32) -> f32 {   // |x| <= 0.5, Taylor to x^15, abs err < 2e-7
  let x2 = x*x;
  return x*(1.0 + x2*(0.16666667 + x2*(0.075 + x2*(0.04464286 + x2*(0.03038194 + x2*(0.02237216 + x2*(0.01735973 + x2*0.01396484)))))));
}
fn acosPrecise(c:f32) -> f32 {
  let a = abs(c);
  if (a <= 0.5) { return 1.5707963268 - asinCore(c); }
  let t = 2.0 * asinCore(sqrt(max(0.5*(1.0 - a), 0.0)));
  return select(3.1415926536 - t, t, c > 0.0);
}
fn ljPair(sig:f32, eps:f32, r2:f32) -> vec2f {   // (energy, dE factor: f = ret.y * dvec)
  let s2 = sig*sig / r2;
  let s6 = s2*s2*s2;
  let e  = 4.0*eps*(s6*s6 - s6);
  let f  = 24.0*eps*(2.0*s6*s6 - s6) / r2;
  return vec2f(e, f);
}

// ---------------- valence: bonds, angles, dihedrals, scaled 1-4 pairs ----------------
@compute @workgroup_size(${WG})
fn valence(@builtin(workgroup_id) wid:vec3u, @builtin(local_invocation_id) lid:vec3u){
  let rep = wid.x; if (rep >= p.nReps){ return; }
  let base = rep * p.nAtoms;
  var eb = 0.0; var ea = 0.0; var ed = 0.0; var elj = 0.0; var eqq = 0.0;

  for (var b = lid.x; b < p.nBonds; b += ${WG}u){
    let i = tu[p.oBondI + 2u*b];  let j = tu[p.oBondI + 2u*b + 1u];
    let k = tf[p.oBondP + 2u*b];  let r0 = tf[p.oBondP + 2u*b + 1u];
    let d = pos[base+i].xyz - pos[base+j].xyz;
    let r = max(length(d), 1e-6);
    let dr = r - r0;
    eb += k * dr * dr;
    let f = (-2.0 * k * dr / r) * d;
    addForce(base+i, f); addForce(base+j, -f);
  }
  for (var a = lid.x; a < p.nAngles; a += ${WG}u){
    let i = tu[p.oAngleI + 3u*a]; let j = tu[p.oAngleI + 3u*a + 1u]; let k2 = tu[p.oAngleI + 3u*a + 2u];
    let ka = tf[p.oAngleP + 2u*a]; let t0 = tf[p.oAngleP + 2u*a + 1u];
    let rij = pos[base+i].xyz - pos[base+j].xyz;
    let rkj = pos[base+k2].xyz - pos[base+j].xyz;
    let lij = max(length(rij), 1e-6); let lkj = max(length(rkj), 1e-6);
    let c = clamp(dot(rij, rkj) / (lij*lkj), -0.999999, 0.999999);
    let th = acosPrecise(c);
    let s = sqrt(1.0 - c*c);
    let dth = th - t0;
    ea += ka * dth * dth;
    let coef = 2.0 * ka * dth / s;    // F = (dV/dth)(1/s) * dcos/dr
    let fi = (coef / lij) * (rkj/lkj - c * rij/lij);
    let fk = (coef / lkj) * (rij/lij - c * rkj/lkj);
    addForce(base+i, fi); addForce(base+k2, fk); addForce(base+j, -(fi+fk));
  }
  for (var d0 = lid.x; d0 < p.nDih; d0 += ${WG}u){
    let ai = tu[p.oDihI + 4u*d0];      let aj = tu[p.oDihI + 4u*d0 + 1u];
    let ak = tu[p.oDihI + 4u*d0 + 2u]; let al = tu[p.oDihI + 4u*d0 + 3u];
    let amp = tf[p.oDihP + 4u*d0];
    let periodicity = max(1u, u32(round(tf[p.oDihP + 4u*d0 + 1u])));
    let cosPhase = tf[p.oDihP + 4u*d0 + 2u];
    let sinPhase = tf[p.oDihP + 4u*d0 + 3u];
    let rij = pos[base+ai].xyz - pos[base+aj].xyz;
    let rkj = pos[base+ak].xyz - pos[base+aj].xyz;
    let rkl = pos[base+ak].xyz - pos[base+al].xyz;
    let m = cross(rij, rkj); let n = cross(rkj, rkl);
    let lkj = max(length(rkj), 1e-6);
    let m2 = max(dot(m,m), 1e-8); let n2 = max(dot(n,n), 1e-8);
    let inv_mn = inverseSqrt(m2 * n2);
    let cp = dot(m, n) * inv_mn;                 // cos(phi)  -- no atan2: WGSL trig too imprecise
    let sp = dot(rij, n) * lkj * inv_mn;         // sin(phi)
    var cosN = 1.0; var sinN = 0.0;
    for (var harmonic = 0u; harmonic < periodicity; harmonic++){
      let nextCos = cosN*cp - sinN*sp;
      let nextSin = sinN*cp + cosN*sp;
      cosN = nextCos; sinN = nextSin;
    }
    let cosShift = cosN*cosPhase + sinN*sinPhase;
    let sinShift = sinN*cosPhase - cosN*sinPhase;
    ed += amp * (1.0 + cosShift);
    let dV = -amp * f32(periodicity) * sinShift;
    let fi = (-dV * lkj / m2) * m;
    let fl = ( dV * lkj / n2) * n;
    let pq = dot(rij, rkj) / (lkj*lkj);
    let qq = dot(rkl, rkj) / (lkj*lkj);
    let sv = pq*fi - qq*fl;
    let fj = sv - fi;
    let fk = -sv - fl;
    addForce(base+ai, fi); addForce(base+aj, fj); addForce(base+ak, fk); addForce(base+al, fl);
  }
  for (var q = lid.x; q < p.nPairs; q += ${WG}u){
    let i = tu[p.oPairI + 2u*q]; let j = tu[p.oPairI + 2u*q + 1u];
    let sig = tf[p.oPairP + 3u*q];
    let eps = tf[p.oPairP + 3u*q + 1u];
    let chargeprod = tf[p.oPairP + 3u*q + 2u];
    let d = pos[base+i].xyz - pos[base+j].xyz;
    let r2 = max(dot(d, d), 1e-4);
    let lj = ljPair(sig, eps, r2);
    let r = sqrt(r2);
    let eq = p.coulombConstant * chargeprod / r;
    elj += lj.x;
    eqq += eq;
    let f = (lj.y + eq / r2) * d;
    addForce(base+i, f); addForce(base+j, -f);
  }
  addAcc64(rep*16u + 0u, eb);
  addAcc64(rep*16u + 2u, ea);
  addAcc64(rep*16u + 4u, ed);
  addAcc64(rep*16u + 6u, elj);
  addAcc64(rep*16u + 8u, eqq);
}

// ---------------- nonbonded: all-pairs LJ + Coulomb with exclusion bitmasks ----------------
@compute @workgroup_size(${WG})
fn nonbond(@builtin(workgroup_id) wid:vec3u, @builtin(local_invocation_id) lid:vec3u){
  let rep = wid.x; if (rep >= p.nReps){ return; }
  let base = rep * p.nAtoms;
  var elj = 0.0; var eqq = 0.0;
  for (var a = lid.x; a < p.nAtoms; a += ${WG}u){
    let ri = pos[base+a].xyz;
    let si = tf[p.oProps + 4u*a]; let ei = tf[p.oProps + 4u*a + 1u]; let qi = tf[p.oProps + 4u*a + 2u];
    var f = vec3f(0.0);
    for (var j = 0u; j < p.nAtoms; j++){
      if (j == a){ continue; }
      if (((tu[p.oExcl + a*p.exclW + (j >> 5u)] >> (j & 31u)) & 1u) == 1u){ continue; }
      let d = ri - pos[base+j].xyz;
      let r2 = max(dot(d, d), 1e-4);
      let sj = tf[p.oProps + 4u*j]; let ej = tf[p.oProps + 4u*j + 1u]; let qj = tf[p.oProps + 4u*j + 2u];
      let lj = ljPair(0.5*(si+sj), sqrt(ei*ej), r2);
      let r = sqrt(r2);
      let eq = p.coulombConstant * qi * qj / r;
      elj += 0.5 * lj.x;
      eqq += 0.5 * eq;
      f += (lj.y + eq / r2) * d;
    }
    addForce(base+a, f);
  }
  addAcc64(rep*16u + 6u, elj);
  addAcc64(rep*16u + 8u, eqq);
}

// ---------------- OBC2 generalized Born + ACE implicit water ----------------
fn obcParameters(atom:u32) -> vec2f {
  return vec2f(tf[p.oObc + 2u*atom], tf[p.oObc + 2u*atom + 1u]);
}
// The spare w lanes hold B and then integral/dE-dI. This keeps the kernel at
// WebGPU's portable limit of eight storage buffers per shader stage.
fn bornData(g:u32) -> vec2f { return vec2f(pos[g].w, vel[g].w); }

struct Radial { value:f32, derivative:f32 }
fn radialAdd(a:Radial, b:Radial) -> Radial {
  return Radial(a.value + b.value, a.derivative + b.derivative);
}
fn radialSubtract(a:Radial, b:Radial) -> Radial {
  return Radial(a.value - b.value, a.derivative - b.derivative);
}
fn radialMultiply(a:Radial, b:Radial) -> Radial {
  return Radial(a.value*b.value, a.derivative*b.value + a.value*b.derivative);
}
fn radialScale(a:Radial, scale:f32) -> Radial {
  return Radial(a.value*scale, a.derivative*scale);
}
fn radialInverse(a:Radial) -> Radial {
  let denominator = max(abs(a.value), 1e-8);
  let signed = select(-denominator, denominator, a.value >= 0.0);
  return Radial(1.0/signed, -a.derivative/(signed*signed));
}
fn radialLog(a:Radial) -> Radial {
  let safe = max(a.value, 1e-8);
  return Radial(log(safe), a.derivative/safe);
}
fn radialAbs(a:Radial) -> Radial {
  if (a.value > 0.0){ return a; }
  if (a.value < 0.0){ return Radial(-a.value, -a.derivative); }
  return Radial(0.0, 0.0);
}
fn radialMaxConstant(a:Radial, minimum:f32) -> Radial {
  if (a.value > minimum){ return a; }
  return Radial(minimum, 0.0);
}

// HCT integral contribution and radial derivative, including OpenMM's
// complete-inside correction. Lengths are Angstrom throughout this kernel.
fn obcIntegralAndDerivative(base:u32, atom:u32, other:u32) -> vec2f {
  let delta = pos[base+atom].xyz - pos[base+other].xyz;
  let distance = max(length(delta), 1e-6);
  let first = obcParameters(atom);
  let second = obcParameters(other);
  let offsetRadius = first.x - OBC_OFFSET;
  let scaledRadius = (second.x - OBC_OFFSET) * second.y;
  if (offsetRadius >= distance + scaledRadius){ return vec2f(0.0); }

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
    radialSubtract(lower2, upper2)), 0.25*scaledRadius*scaledRadius));
  if (offsetRadius < scaledRadius - distance){
    term = radialAdd(term, radialScale(radialSubtract(
      Radial(1.0/offsetRadius, 0.0), lower), 2.0));
  }
  term = radialScale(term, 0.5);
  return vec2f(term.value, term.derivative);
}

@compute @workgroup_size(${WG})
fn bornRadii(@builtin(workgroup_id) wid:vec3u, @builtin(local_invocation_id) lid:vec3u){
  let rep = wid.x; if (rep >= p.nReps || p.implicitSolvent == 0u){ return; }
  let base = rep*p.nAtoms;
  for (var atom = lid.x; atom < p.nAtoms; atom += ${WG}u){
    let obc = obcParameters(atom);
    let offsetRadius = obc.x - OBC_OFFSET;
    var integral = 0.0;
    for (var other = 0u; other < p.nAtoms; other++){
      if (other != atom){ integral += obcIntegralAndDerivative(base, atom, other).x; }
    }
    let psi = integral*offsetRadius;
    let psi2 = psi*psi;
    let argument = psi - 0.8*psi2 + 4.85*psi2*psi;
    let hyperbolic = tanh(argument);
    let B = 1.0/(1.0/offsetRadius - hyperbolic/obc.x);
    let g = base+atom;
    pos[g] = vec4f(pos[g].xyz, B);
    vel[g] = vec4f(vel[g].xyz, integral);
  }
}

@compute @workgroup_size(${WG})
fn bornDerivatives(@builtin(workgroup_id) wid:vec3u, @builtin(local_invocation_id) lid:vec3u){
  let rep = wid.x; if (rep >= p.nReps || p.implicitSolvent == 0u){ return; }
  let base = rep*p.nAtoms;
  let polarFactor = p.coulombConstant*p.obcDielectricFactor;
  for (var atom = lid.x; atom < p.nAtoms; atom += ${WG}u){
    let q = tf[p.oProps + 4u*atom + 2u];
    let radius = obcParameters(atom).x;
    let g = base+atom;
    let data = bornData(g);
    let B = max(data.x, 1e-6);
    var derivative = 0.5*polarFactor*q*q/(B*B);
    let ratio = radius/B;
    let ratio2 = ratio*ratio;
    let ratio6 = ratio2*ratio2*ratio2;
    let surface = p.obcSurfaceAreaFactor*(radius+OBC_PROBE_RADIUS)
      *(radius+OBC_PROBE_RADIUS)*ratio6;
    derivative -= 6.0*surface/B;
    for (var other = 0u; other < p.nAtoms; other++){
      if (other == atom){ continue; }
      let otherBorn = max(bornData(base+other).x, 1e-6);
      let delta = pos[base+atom].xyz - pos[base+other].xyz;
      let r2 = dot(delta, delta);
      let product = max(B*otherBorn, 1e-8);
      let scaledDistance = r2/(4.0*product);
      let exponential = exp(-scaledDistance);
      let denominator2 = max(r2 + product*exponential, 1e-8);
      let denominator = sqrt(denominator2);
      let otherQ = tf[p.oProps + 4u*other + 2u];
      derivative += 0.5*polarFactor*q*otherQ*otherBorn*exponential
        *(1.0+scaledDistance)/(denominator2*denominator);
    }
    let offsetRadius = radius - OBC_OFFSET;
    let psi = data.y*offsetRadius;
    let psi2 = psi*psi;
    let hyperbolic = tanh(psi - 0.8*psi2 + 4.85*psi2*psi);
    let chain = (1.0 - hyperbolic*hyperbolic)*offsetRadius
      *(1.0 - 1.6*psi + 14.55*psi2)/radius;
    let dBornDIntegral = B*B*chain;
    vel[g] = vec4f(vel[g].xyz, derivative*dBornDIntegral);
  }
}

fn obcForce(base:u32, atom:u32) -> vec3f {
  let polarFactor = p.coulombConstant*p.obcDielectricFactor;
  let firstBorn = bornData(base+atom);
  let firstQ = tf[p.oProps + 4u*atom + 2u];
  var force = vec3f(0.0);
  for (var other = 0u; other < p.nAtoms; other++){
    if (other == atom){ continue; }
    let secondBorn = bornData(base+other);
    let delta = pos[base+atom].xyz - pos[base+other].xyz;
    let r2 = max(dot(delta, delta), 1e-8);
    let distance = sqrt(r2);
    let product = max(firstBorn.x*secondBorn.x, 1e-8);
    let exponential = exp(-r2/(4.0*product));
    let denominator2 = max(r2 + product*exponential, 1e-8);
    let denominator = sqrt(denominator2);
    let otherQ = tf[p.oProps + 4u*other + 2u];
    let direct = -polarFactor*firstQ*otherQ*(1.0 - 0.25*exponential)
      /(denominator2*denominator);
    let chain = firstBorn.y*obcIntegralAndDerivative(base, atom, other).y
      + secondBorn.y*obcIntegralAndDerivative(base, other, atom).y;
    force += (direct - chain/distance)*delta;
  }
  return force;
}

@compute @workgroup_size(${WG})
fn implicit(@builtin(workgroup_id) wid:vec3u, @builtin(local_invocation_id) lid:vec3u){
  let rep = wid.x; if (rep >= p.nReps || p.implicitSolvent == 0u){ return; }
  let base = rep*p.nAtoms;
  let polarFactor = p.coulombConstant*p.obcDielectricFactor;
  var energy = 0.0;
  for (var atom = lid.x; atom < p.nAtoms; atom += ${WG}u){
    let q = tf[p.oProps + 4u*atom + 2u];
    let radius = obcParameters(atom).x;
    let B = max(bornData(base+atom).x, 1e-6);
    energy -= 0.5*polarFactor*q*q/B;
    let ratio = radius/B;
    let ratio2 = ratio*ratio;
    let ratio6 = ratio2*ratio2*ratio2;
    energy += p.obcSurfaceAreaFactor*(radius+OBC_PROBE_RADIUS)
      *(radius+OBC_PROBE_RADIUS)*ratio6;
    for (var other = 0u; other < p.nAtoms; other++){
      if (other == atom){ continue; }
      let delta = pos[base+atom].xyz - pos[base+other].xyz;
      let r2 = dot(delta, delta);
      let product = max(B*bornData(base+other).x, 1e-8);
      let denominator = sqrt(max(r2 + product*exp(-r2/(4.0*product)), 1e-8));
      let otherQ = tf[p.oProps + 4u*other + 2u];
      energy -= 0.5*polarFactor*q*otherQ/denominator;
    }
    addForce(base+atom, obcForce(base, atom));
  }
  addAcc64(rep*16u + 12u, energy);
}

// ---------------- integration: velocity Verlet (two half-kicks), optional Langevin ----------------
fn pcg(v:u32) -> u32 {
  var s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn gauss2(h1:u32, h2:u32) -> vec2f {
  let u1 = max((f32(h1) + 0.5) / 4294967296.0, 1e-7);
  let u2 = (f32(h2) + 0.5) / 4294967296.0;
  let r = sqrt(-2.0 * log(u1));
  return vec2f(r * cos(6.2831853 * u2), r * sin(6.2831853 * u2));
}
@compute @workgroup_size(${WG})
fn kickDrift(@builtin(workgroup_id) wid:vec3u, @builtin(local_invocation_id) lid:vec3u){
  let rep = wid.x; if (rep >= p.nReps){ return; }
  let base = rep * p.nAtoms;
  for (var a = lid.x; a < p.nAtoms; a += ${WG}u){
    let g = base + a;
    let m = tf[p.oProps + 4u*a + 3u];
    let v = vel[g].xyz + (0.5 * KCAL2A / m) * loadForce(g) * p.dt;
    vel[g] = vec4f(v, 0.0);
    // STORMM-style fixed-point coordinate update: rounded increments into authoritative
    // int64 coordinates; never absorbed by f32 rounding, range +/- 2^31 Angstrom.
    let d = v * p.dt * GSCALE;
    var mir: vec3f;
    for (var c = 0u; c < 3u; c++){
      let w = (g*3u + c)*2u;
      let inc = splitI64(d[c]);
      let lo = posFix[w]; let hi = posFix[w + 1u];
      let nlo = lo + inc.x;
      let carry = select(0u, 1u, nlo < lo);
      let nhi = hi + inc.y + carry;
      posFix[w] = nlo; posFix[w + 1u] = nhi;
      mir[c] = i64ToF32(nlo, nhi) / GSCALE;
    }
    pos[g] = vec4f(mir, 0.0);                    // f32 working mirror
  }
}

// Fixed-step steepest descent for batched conformer polishing. During this
// kernel p.gamma is the force-to-displacement scale and p.kT is the per-atom
// displacement cap; the ordinary dynamics values are restored before MD.
@compute @workgroup_size(${WG})
fn steepestDescent(@builtin(workgroup_id) wid:vec3u, @builtin(local_invocation_id) lid:vec3u){
  let rep = wid.x; if (rep >= p.nReps){ return; }
  let base = rep*p.nAtoms;
  for (var atom = lid.x; atom < p.nAtoms; atom += ${WG}u){
    let globalAtom = base + atom;
    let force = loadForce(globalAtom);
    let magnitude = length(force);
    let scale = select(p.gamma, min(p.gamma, p.kT/magnitude), magnitude > 1.0e-12);
    addFixedPosition(globalAtom, force*scale);
    vel[globalAtom] = vec4f(0.0);
  }
}

// Replica-local, deterministic Gauss-Seidel SHAKE. Each workgroup invocation
// owns one replica, avoiding floating-point atomics and cross-replica coupling.
// Corrections are committed as rounded increments to the authoritative int64
// coordinate store, and the matching displacement is added to velocity.
@compute @workgroup_size(1)
fn shakePositions(@builtin(workgroup_id) wid:vec3u){
  let rep = wid.x;
  if (rep >= p.nReps || p.nConstraints == 0u){ return; }
  let base = rep*p.nAtoms;
  var maximumResidual = 0.0;
  var badGeometry = false;
  for (var iteration = 0u; iteration < p.constraintIterations; iteration++){
    for (var constraint = 0u; constraint < p.nConstraints; constraint++){
      let i = tu[p.oConstraintI + 2u*constraint];
      let j = tu[p.oConstraintI + 2u*constraint + 1u];
      let constraintLength = tf[p.oConstraintP + constraint];
      let gi = base+i;
      let gj = base+j;
      let delta = pos[gi].xyz - pos[gj].xyz;
      let distance2 = dot(delta, delta);
      if (distance2 <= 1.0e-12){
        badGeometry = true;
        continue;
      }
      let distance = sqrt(distance2);
      let inverseMassI = 1.0/tf[p.oProps + 4u*i + 3u];
      let inverseMassJ = 1.0/tf[p.oProps + 4u*j + 3u];
      let inverseMassSum = inverseMassI + inverseMassJ;
      let scale = (constraintLength/distance - 1.0)/inverseMassSum;
      let correctionI = inverseMassI*scale*delta;
      let correctionJ = -inverseMassJ*scale*delta;
      addFixedPosition(gi, correctionI);
      addFixedPosition(gj, correctionJ);
      vel[gi] = vec4f(vel[gi].xyz + correctionI/p.dt, vel[gi].w);
      vel[gj] = vec4f(vel[gj].xyz + correctionJ/p.dt, vel[gj].w);
    }
    maximumResidual = 0.0;
    for (var constraint = 0u; constraint < p.nConstraints; constraint++){
      let i = tu[p.oConstraintI + 2u*constraint];
      let j = tu[p.oConstraintI + 2u*constraint + 1u];
      let constraintLength = tf[p.oConstraintP + constraint];
      let distance = length(pos[base+i].xyz - pos[base+j].xyz);
      maximumResidual = max(maximumResidual, abs(distance/constraintLength - 1.0));
    }
    if (maximumResidual <= p.constraintTolerance){ break; }
  }
  recordConstraintResidual(rep, maximumResidual);
  if (badGeometry){ atomicOr(&acc[rep*16u + 14u], ${CONSTRAINT_FAULT_GEOMETRY}u); }
  if (maximumResidual > p.constraintTolerance){
    atomicOr(&acc[rep*16u + 14u], ${CONSTRAINT_FAULT_POSITION}u);
  }
}
@compute @workgroup_size(${WG})
fn kickKE(@builtin(workgroup_id) wid:vec3u, @builtin(local_invocation_id) lid:vec3u){
  let rep = wid.x; if (rep >= p.nReps){ return; }
  let base = rep * p.nAtoms;
  let step = atomicLoad(&acc[controlIndex(0u)]);
  var ke = 0.0;
  for (var a = lid.x; a < p.nAtoms; a += ${WG}u){
    let g = base + a;
    let m = tf[p.oProps + 4u*a + 3u];
    var v = vel[g].xyz + (0.5 * KCAL2A / m) * loadForce(g) * p.dt;
    if (p.thermo == 1u){
      let c1 = exp(-p.gamma * p.dt);
      let c2 = sqrt((1.0 - c1*c1) * KCAL2A * p.kT / m);
      let h0 = pcg(g ^ (step * 2654435761u) ^ p.seed);
      let h1 = pcg(h0); let h2 = pcg(h1); let h3 = pcg(h2);
      let g1 = gauss2(h0, h1); let g2 = gauss2(h2, h3);
      v = c1 * v + c2 * vec3f(g1.x, g1.y, g2.x);
    }
    ke += 0.5 * m * dot(v, v) / KCAL2A;
    vel[g] = vec4f(v, 0.0);
  }
  addAcc64(rep*16u + 10u, ke);
}

// RATTLE projection after the second half-kick (and optional thermostat). The
// residual is dt*|r_ij dot v_ij|/|r_ij|^2, a dimensionless one-step constraint
// error directly comparable to the SHAKE relative-distance tolerance.
@compute @workgroup_size(1)
fn rattleVelocities(@builtin(workgroup_id) wid:vec3u){
  let rep = wid.x;
  if (rep >= p.nReps || p.nConstraints == 0u){ return; }
  let base = rep*p.nAtoms;
  var kineticBefore = 0.0;
  for (var atom = 0u; atom < p.nAtoms; atom++){
    let mass = tf[p.oProps + 4u*atom + 3u];
    kineticBefore += 0.5*mass*dot(vel[base+atom].xyz, vel[base+atom].xyz)/KCAL2A;
  }
  var maximumResidual = 0.0;
  var badGeometry = false;
  for (var iteration = 0u; iteration < p.constraintIterations; iteration++){
    for (var constraint = 0u; constraint < p.nConstraints; constraint++){
      let i = tu[p.oConstraintI + 2u*constraint];
      let j = tu[p.oConstraintI + 2u*constraint + 1u];
      let gi = base+i;
      let gj = base+j;
      let delta = pos[gi].xyz - pos[gj].xyz;
      let distance2 = dot(delta, delta);
      if (distance2 <= 1.0e-12){
        badGeometry = true;
        continue;
      }
      let inverseMassI = 1.0/tf[p.oProps + 4u*i + 3u];
      let inverseMassJ = 1.0/tf[p.oProps + 4u*j + 3u];
      let relativeVelocity = vel[gi].xyz - vel[gj].xyz;
      let multiplier = dot(delta, relativeVelocity)
        / ((inverseMassI + inverseMassJ)*distance2);
      vel[gi] = vec4f(vel[gi].xyz - inverseMassI*multiplier*delta, vel[gi].w);
      vel[gj] = vec4f(vel[gj].xyz + inverseMassJ*multiplier*delta, vel[gj].w);
    }
    maximumResidual = 0.0;
    for (var constraint = 0u; constraint < p.nConstraints; constraint++){
      let i = tu[p.oConstraintI + 2u*constraint];
      let j = tu[p.oConstraintI + 2u*constraint + 1u];
      let delta = pos[base+i].xyz - pos[base+j].xyz;
      let distance2 = max(dot(delta, delta), 1.0e-12);
      let relativeVelocity = vel[base+i].xyz - vel[base+j].xyz;
      maximumResidual = max(maximumResidual,
        p.dt*abs(dot(delta, relativeVelocity))/distance2);
    }
    if (maximumResidual <= p.constraintTolerance){ break; }
  }
  var kineticAfter = 0.0;
  for (var atom = 0u; atom < p.nAtoms; atom++){
    let mass = tf[p.oProps + 4u*atom + 3u];
    kineticAfter += 0.5*mass*dot(vel[base+atom].xyz, vel[base+atom].xyz)/KCAL2A;
  }
  addAcc64(rep*16u + 10u, kineticAfter - kineticBefore);
  recordConstraintResidual(rep, maximumResidual);
  if (badGeometry){ atomicOr(&acc[rep*16u + 14u], ${CONSTRAINT_FAULT_GEOMETRY}u); }
  if (maximumResidual > p.constraintTolerance){
    atomicOr(&acc[rep*16u + 14u], ${CONSTRAINT_FAULT_VELOCITY}u);
  }
}
@compute @workgroup_size(1)
fn tick(){ atomicAdd(&acc[controlIndex(0u)], 1u); }
`;

// ---------------------------------------------------------------------------
// Topology builders.
function exclSet(excl, i, j, W){
  excl[i*W + (j>>5)] |= 1 << (j & 31);
  excl[j*W + (i>>5)] |= 1 << (i & 31);
}
const D2R = Math.PI / 180;

export function buildAlkane(nC){
  if (!Number.isInteger(nC) || nC < 2) throw new RangeError('Alkane size must be an integer of at least 2');
  const props = [], coords = [], colors = [];
  const W = Math.ceil(nC / 32);
  const a = 0.831 * 1.526, b = 0.556 * 1.526;
  for (let i = 0; i < nC; i++){
    const end = (i === 0 || i === nC-1);
    props.push(3.905, end ? 0.175 : 0.118, 0.0, end ? 15.035 : 14.027);
    coords.push(i * a, (i % 2) * b, 0);
    colors.push(end ? '#3a4a5a' : '#16202B');
  }
  const bondsI = [], bondsP = [], angI = [], angP = [], dihI = [], dihP = [], prI = [], prP = [];
  const excl = new Uint32Array(nC * W), drawBonds = [];
  for (let i = 0; i < nC-1; i++){ bondsI.push(i, i+1); bondsP.push(260.0, 1.526); exclSet(excl, i, i+1, W); drawBonds.push([i, i+1]); }
  for (let i = 0; i < nC-2; i++){ angI.push(i, i+1, i+2); angP.push(63.0, 112.4 * D2R); exclSet(excl, i, i+2, W); }
  for (let i = 0; i < nC-3; i++){
    dihI.push(i, i+1, i+2, i+3, i, i+1, i+2, i+3, i, i+1, i+2, i+3);
    // One general periodic term per row: amplitude, periodicity, cos(phase), sin(phase).
    dihP.push(0.5*1.411, 1, 1, 0, 0.5*-0.271, 2, -1, 0, 0.5*3.145, 3, 1, 0);
    const sig = 0.5 * (props[i*4] + props[(i+3)*4]);
    const eps = 0.5 * Math.sqrt(props[i*4+1] * props[(i+3)*4+1]);
    prI.push(i, i+3); prP.push(sig, eps, 0); exclSet(excl, i, i+3, W);
  }
  return pack({ name:`n-C${nC}H${2*nC+2} (united-atom, OPLS-like)`, nAtoms:nC, exclW:W, props, coords, colors,
    bondsI, bondsP, angI, angP, dihI, dihP, prI, prP, excl, drawBonds, dt:0.001 });
}

export function buildWater(side, rng = Math.random){  // side^3 molecules on a grid
  if (!Number.isInteger(side) || side < 1) throw new RangeError('Water-box side must be a positive integer');
  if (typeof rng !== 'function') throw new TypeError('Water builder RNG must be a function');
  const nw = side*side*side, nAtoms = nw*3;
  const W = Math.ceil(nAtoms / 32);
  const props = [], coords = [], colors = [];
  const bondsI = [], bondsP = [], angI = [], angP = [];
  const excl = new Uint32Array(nAtoms * W), drawBonds = [];
  const rOH = 0.9572, th = 104.52 * D2R, sp = 3.2;
  for (let w = 0; w < nw; w++){
    const O = w*3, H1 = w*3+1, H2 = w*3+2;
    props.push(3.1507, 0.1521, -0.834, 15.9994);
    props.push(0.4,    0.046,   0.417,  1.008);
    props.push(0.4,    0.046,   0.417,  1.008);
    colors.push('#C25E1F', '#8fa3b0', '#8fa3b0');
    const cx = (w % side) * sp, cy = (Math.floor(w/side) % side) * sp, cz = Math.floor(w/(side*side)) * sp;
    const u = rng()*2*Math.PI, v = Math.acos(2*rng()-1), w2 = rng()*2*Math.PI;
    const ax = [Math.sin(v)*Math.cos(u), Math.sin(v)*Math.sin(u), Math.cos(v)];
    let px = [ -ax[1], ax[0], 0 ]; const pl = Math.hypot(...px) || 1;
    px = px.map(x => x/pl);
    const py = [ ax[1]*px[2]-ax[2]*px[1], ax[2]*px[0]-ax[0]*px[2], ax[0]*px[1]-ax[1]*px[0] ];
    const c1 = Math.cos(w2), s1 = Math.sin(w2);
    const e1 = px.map((x,i) => x*c1 + py[i]*s1), e2 = px.map((x,i) => -x*s1 + py[i]*c1);
    coords.push(cx, cy, cz);
    const h = th/2;
    coords.push(cx + rOH*(Math.sin(h)*e1[0] + Math.cos(h)*e2[0]), cy + rOH*(Math.sin(h)*e1[1] + Math.cos(h)*e2[1]), cz + rOH*(Math.sin(h)*e1[2] + Math.cos(h)*e2[2]));
    coords.push(cx + rOH*(-Math.sin(h)*e1[0] + Math.cos(h)*e2[0]), cy + rOH*(-Math.sin(h)*e1[1] + Math.cos(h)*e2[1]), cz + rOH*(-Math.sin(h)*e1[2] + Math.cos(h)*e2[2]));
    bondsI.push(O, H1); bondsP.push(450.0, rOH);
    bondsI.push(O, H2); bondsP.push(450.0, rOH);
    angI.push(H1, O, H2); angP.push(55.0, th);
    exclSet(excl, O, H1, W); exclSet(excl, O, H2, W); exclSet(excl, H1, H2, W);
    drawBonds.push([O, H1], [O, H2]);
  }
  return pack({ name:`(H2O)${nw} cluster (flexible TIP3P-like)`, nAtoms, exclW:W, props, coords, colors,
    bondsI, bondsP, angI, angP, dihI:[], dihP:[], prI:[], prP:[], excl, drawBonds, dt:0.0005 });
}

// Minimal two-atom system for overflow / analytic-force tests.
export function buildDimer({ r = 1.0, sig = 3.4, eps = 0.238, q = 0.0 } = {}){
  const W = 1;
  return pack({ name:`LJ dimer r=${r}`, nAtoms:2, exclW:W,
    props:[sig, eps, q, 39.948, sig, eps, -q, 39.948],
    coords:[0,0,0, r,0,0], colors:['#16202B','#16202B'],
    bondsI:[], bondsP:[], angI:[], angP:[], dihI:[], dihP:[], prI:[], prP:[],
    excl:new Uint32Array(2*W), drawBonds:[], dt:0.001 });
}

const KJ_TO_KCAL = 1 / 4.184;

// Convert the complete numeric System exported by Molarium's OpenMM/Sage worker.
// The topology is replicated by createEngine(); chemical perception stays in the
// established OpenMM worker rather than being duplicated here.
export function buildParameterizedSystem(molecule, parameterization,
    { dt = 0.001, implicitSolvent = null, coulombConstant = COUL } = {}){
  const system = parameterization?.system;
  validateNumericSystem(molecule, system);
  const nAtoms = molecule?.atoms?.length;
  if (!Number.isInteger(nAtoms) || nAtoms < 1 || !system)
    throw new TypeError('A molecule and numeric parameterized System are required');
  for (const field of ['particles', 'constraints', 'bonds', 'angles', 'torsions', 'nonbonded', 'exceptions'])
    if (!Array.isArray(system[field])) throw new TypeError(`Parameterized System is missing ${field}`);
  if (system.particles.length !== nAtoms || system.nonbonded.length !== nAtoms)
    throw new Error('Parameterized particle and nonbonded counts must match the molecule');
  if (!Number.isFinite(dt) || dt <= 0) throw new RangeError('Parameterized time step must be positive');
  if (!Number.isFinite(coulombConstant) || coulombConstant <= 0)
    throw new RangeError('Coulomb constant must be finite and positive');

  const finite = (label, values) => {
    if (!values.every(Number.isFinite)) throw new TypeError(`${label} contains a non-finite value`);
  };
  const atoms = (label, values) => {
    if (!values.every((value) => Number.isInteger(value) && value >= 0 && value < nAtoms))
      throw new RangeError(`${label} contains an invalid atom index`);
  };
  const props = [], coords = [], colors = [];
  for (let index = 0; index < nAtoms; index++) {
    const atom = molecule.atoms[index];
    const particle = system.particles[index], nonbonded = system.nonbonded[index];
    const values = [
      Number(nonbonded.sigma_nm) * 10,
      Number(nonbonded.epsilon_kj) * KJ_TO_KCAL,
      Number(nonbonded.charge_e),
      Number(particle.mass_amu),
    ];
    finite(`Particle ${index + 1}`, values);
    if (values[0] < 0 || values[1] < 0 || !(values[3] > 0))
      throw new RangeError(`Particle ${index + 1} has invalid sigma, epsilon, or mass`);
    props.push(...values);
    const xyz = [Number(atom.x), Number(atom.y), Number(atom.z)];
    finite(`Atom ${index + 1} coordinates`, xyz);
    coords.push(...xyz);
    colors.push('#64748b');
  }

  const bondsI = [], bondsP = [];
  system.bonds.forEach((term, index) => {
    const indices = [Number(term.i), Number(term.j)]; atoms(`Bond ${index + 1}`, indices);
    const values = [Number(term.k_kj_nm2) * KJ_TO_KCAL / 200, Number(term.r0_nm) * 10];
    finite(`Bond ${index + 1}`, values);
    bondsI.push(...indices); bondsP.push(...values);
  });
  const constraintI = [], constraintP = [], constraintKeys = new Set();
  system.constraints.forEach((term, index) => {
    const indices = [Number(term.i), Number(term.j)];
    atoms(`Constraint ${index + 1}`, indices);
    if (indices[0] === indices[1]) throw new RangeError(`Constraint ${index + 1} is a self pair`);
    const key = indices[0] < indices[1]
      ? `${indices[0]}:${indices[1]}` : `${indices[1]}:${indices[0]}`;
    if (constraintKeys.has(key)) throw new Error(`Parameterized System contains duplicate constraint ${key}`);
    constraintKeys.add(key);
    const distance = Number(term.distance_nm) * 10;
    finite(`Constraint ${index + 1}`, [distance]);
    if (!(distance > 0)) throw new RangeError(`Constraint ${index + 1} has an invalid distance`);
    constraintI.push(...indices);
    constraintP.push(distance);
  });
  const angI = [], angP = [];
  system.angles.forEach((term, index) => {
    const indices = [Number(term.i), Number(term.j), Number(term.k)]; atoms(`Angle ${index + 1}`, indices);
    const values = [Number(term.k_kj_rad2) * KJ_TO_KCAL / 2, Number(term.theta0_rad)];
    finite(`Angle ${index + 1}`, values);
    angI.push(...indices); angP.push(...values);
  });
  const dihI = [], dihP = [];
  system.torsions.forEach((term, index) => {
    const indices = [Number(term.i), Number(term.j), Number(term.k), Number(term.l)]; atoms(`Torsion ${index + 1}`, indices);
    const periodicity = Number(term.periodicity), phase = Number(term.phase_rad);
    const values = [Number(term.k_kj) * KJ_TO_KCAL, periodicity, Math.cos(phase), Math.sin(phase)];
    finite(`Torsion ${index + 1}`, values);
    if (!Number.isInteger(periodicity) || periodicity < 1 || periodicity > 32)
      throw new RangeError(`Torsion ${index + 1} has unsupported periodicity ${periodicity}`);
    dihI.push(...indices); dihP.push(...values);
  });

  const exclW = Math.ceil(nAtoms / 32);
  const excl = new Uint32Array(nAtoms * exclW), prI = [], prP = [];
  const exceptionKeys = new Set();
  system.exceptions.forEach((term, index) => {
    const pair = [Number(term.i), Number(term.j)]; atoms(`Exception ${index + 1}`, pair);
    if (pair[0] === pair[1]) throw new RangeError(`Exception ${index + 1} is a self pair`);
    const key = pair[0] < pair[1] ? `${pair[0]}:${pair[1]}` : `${pair[1]}:${pair[0]}`;
    if (exceptionKeys.has(key)) throw new Error(`Parameterized System contains duplicate exception ${key}`);
    exceptionKeys.add(key);
    const values = [
      Number(term.sigma_nm) * 10,
      Number(term.epsilon_kj) * KJ_TO_KCAL,
      Number(term.chargeprod_e2),
    ];
    finite(`Exception ${index + 1}`, values);
    prI.push(...pair); prP.push(...values); exclSet(excl, pair[0], pair[1], exclW);
  });
  const drawBonds = (molecule.bonds || []).map((bond, index) => {
    const pair = [Number(bond.a), Number(bond.b)]; atoms(`Viewer bond ${index + 1}`, pair);
    return pair;
  });
  const obc = [];
  if (implicitSolvent) {
    if (implicitSolvent.model !== 'OBC2' || !Array.isArray(implicitSolvent.particles)
        || implicitSolvent.particles.length !== nAtoms)
      throw new Error('STORMM implicit solvent requires one OBC2 parameter record per atom');
    implicitSolvent.particles.forEach((particle, index) => {
      const radius = Number(particle.radius_nm) * 10;
      const scale = Number(particle.scale);
      finite(`OBC2 particle ${index + 1}`, [radius, scale]);
      if (!(radius > 0.09) || !(scale > 0))
        throw new RangeError(`OBC2 particle ${index + 1} has an invalid radius or scale`);
      obc.push(radius, scale);
    });
  }
  for (const [label, values] of Object.entries({props,coords,bondsP,angP,dihP,prP,constraintP,obc}))
    validatePackedFloat32(`STORMM ${label}`, values);
  return pack({
    name: parameterization.forcefield || 'Parameterized OpenMM System',
    nAtoms, exclW, props, coords, colors,
    bondsI, bondsP, angI, angP, dihI, dihP, prI, prP,
    constraintI, constraintP, excl, drawBonds, dt, obc,
    implicitSolvent: implicitSolvent?.model || null,
    implicitSolventDielectric: implicitSolvent?.solventDielectric ?? OBC_SOLVENT_DIELECTRIC,
    implicitSurfaceAreaFactor: implicitSolvent?.surfaceAreaFactor ?? OBC_SA_FACTOR,
    coulombConstant,
    parameterization: {
      forcefield: parameterization.forcefield,
      chargeModel: parameterization.chargeModel,
      sourceSha256: parameterization.sourceSha256,
    },
  });
}

function pack(t){
  const constraintI = t.constraintI || [];
  const constraintP = t.constraintP || [];
  if (constraintI.length !== constraintP.length*2)
    throw new Error('Each rigid constraint needs two atom indices and one distance');
  const oBondI = 0;
  const oAngleI = oBondI + t.bondsI.length;
  const oDihI   = oAngleI + t.angI.length;
  const oPairI  = oDihI + t.dihI.length;
  const oConstraintI = oPairI + t.prI.length;
  const oExcl   = oConstraintI + constraintI.length;
  const tu = new Uint32Array(oExcl + t.excl.length);
  tu.set(t.bondsI, oBondI); tu.set(t.angI, oAngleI); tu.set(t.dihI, oDihI);
  tu.set(t.prI, oPairI); tu.set(constraintI, oConstraintI); tu.set(t.excl, oExcl);
  const oBondP = 0;
  const oAngleP = oBondP + t.bondsP.length;
  const oDihP   = oAngleP + t.angP.length;
  const oPairP  = oDihP + t.dihP.length;
  const oConstraintP = oPairP + t.prP.length;
  const oProps  = oConstraintP + constraintP.length;
  const oObc    = oProps + t.props.length;
  const obc = t.obc || [];
  const tf = new Float32Array(oObc + obc.length);
  tf.set(t.bondsP, oBondP); tf.set(t.angP, oAngleP); tf.set(t.dihP, oDihP);
  tf.set(t.prP, oPairP); tf.set(constraintP, oConstraintP); tf.set(t.props, oProps);
  tf.set(obc, oObc);
  return { ...t, constraintI, constraintP, tu, tf,
    counts:{ nBonds: t.bondsI.length/2, nAngles: t.angI.length/3,
      nDih: t.dihI.length/4, nPairs: t.prI.length/2,
      nConstraints: constraintP.length },
    offs:{ oBondI, oAngleI, oDihI, oPairI, oConstraintI, oExcl,
      oBondP, oAngleP, oDihP, oPairP, oConstraintP, oProps, oObc } };
}

// Deterministic RNG for reproducible initial conditions.
export function mulberry32(seed){
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Per-replica starting coordinates + Maxwell-Boltzmann velocities.
export function initReplicas(topo, nReps, T, rng = Math.random,
    { randomizeCoordinates = true, coordinateJitter = 0.02,
      initialPositions = null } = {}){
  const n = topo.nAtoms, pos = new Float32Array(nReps*n*4), vel = new Float32Array(nReps*n*4);
  if (!Number.isFinite(coordinateJitter) || coordinateJitter < 0)
    throw new RangeError('Coordinate jitter must be finite and non-negative');
  if (initialPositions !== null) {
    if (!ArrayBuffer.isView(initialPositions) || initialPositions.length !== nReps*n*3)
      throw new RangeError(`Initial conformers must contain exactly ${nReps*n*3} xyz values`);
    for (let i = 0; i < initialPositions.length; i++)
      if (!Number.isFinite(initialPositions[i]))
        throw new RangeError(`Initial conformer coordinate ${i} is not finite`);
  }
  const gauss = () => { let u = 0, v = 0; while (!u) u = rng(); v = rng();
    return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v); };
  for (let r = 0; r < nReps; r++){
    const q = initialPositions === null && randomizeCoordinates
      ? [gauss(), gauss(), gauss(), gauss()] : [1, 0, 0, 0];
    const ql = Math.hypot(...q) || 1;
    const [w, x, y, z] = q.map(c => c/ql);
    const R = [ 1-2*(y*y+z*z), 2*(x*y-w*z), 2*(x*z+w*y),
                2*(x*y+w*z), 1-2*(x*x+z*z), 2*(y*z-w*x),
                2*(x*z-w*y), 2*(y*z+w*x), 1-2*(x*x+y*y) ];
    for (let a = 0; a < n; a++){
      const source = initialPositions === null ? topo.coords : initialPositions;
      const sourceOffset = initialPositions === null ? a*3 : (r*n+a)*3;
      const cx = source[sourceOffset], cy = source[sourceOffset+1], cz = source[sourceOffset+2];
      const i = (r*n + a) * 4;
      const jitter = initialPositions === null && randomizeCoordinates ? coordinateJitter : 0;
      pos[i]   = R[0]*cx + R[1]*cy + R[2]*cz + (rng()-0.5)*jitter;
      pos[i+1] = R[3]*cx + R[4]*cy + R[5]*cz + (rng()-0.5)*jitter;
      pos[i+2] = R[6]*cx + R[7]*cy + R[8]*cz + (rng()-0.5)*jitter;
      const m = topo.props[a*4+3], s = Math.sqrt(KCAL2A * KB * T / m);
      vel[i] = s*gauss(); vel[i+1] = s*gauss(); vel[i+2] = s*gauss();
    }
    for (let c = 0; c < 3; c++){
      let pm = 0, M = 0;
      for (let a = 0; a < n; a++){ const m = topo.props[a*4+3]; pm += m*vel[(r*n+a)*4+c]; M += m; }
      for (let a = 0; a < n; a++) vel[(r*n+a)*4+c] -= pm/M;
    }
  }
  return { pos, vel };
}

// ---------------- CPU f64 reference (mirrors WGSL exactly) ----------------
export function cpuEnergies(topo, P){
  const n = topo.nAtoms, pr = topo.props, at = i => [P[i*4], P[i*4+1], P[i*4+2]];
  const sub = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const crs = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  let bond = 0, angle = 0, dih = 0, lj = 0, coul = 0;
  for (let b = 0; b < topo.counts.nBonds; b++){
    const i = topo.tu[topo.offs.oBondI+2*b], j = topo.tu[topo.offs.oBondI+2*b+1];
    const k = topo.tf[topo.offs.oBondP+2*b], r0 = topo.tf[topo.offs.oBondP+2*b+1];
    const dr = Math.sqrt(dot(sub(at(i),at(j)), sub(at(i),at(j)))) - r0;
    bond += k*dr*dr;
  }
  for (let a = 0; a < topo.counts.nAngles; a++){
    const i = topo.tu[topo.offs.oAngleI+3*a], j = topo.tu[topo.offs.oAngleI+3*a+1], k2 = topo.tu[topo.offs.oAngleI+3*a+2];
    const ka = topo.tf[topo.offs.oAngleP+2*a], t0 = topo.tf[topo.offs.oAngleP+2*a+1];
    const rij = sub(at(i),at(j)), rkj = sub(at(k2),at(j));
    const c = Math.min(0.999999, Math.max(-0.999999, dot(rij,rkj)/(Math.sqrt(dot(rij,rij))*Math.sqrt(dot(rkj,rkj)))));
    const d = Math.acos(c) - t0;
    angle += ka*d*d;
  }
  for (let d0 = 0; d0 < topo.counts.nDih; d0++){
    const [ai,aj,ak,al] = [0,1,2,3].map(o => topo.tu[topo.offs.oDihI+4*d0+o]);
    const [amp, periodicity, cosPhase, sinPhase] = [0,1,2,3].map(o => topo.tf[topo.offs.oDihP+4*d0+o]);
    const b1 = sub(at(ai),at(aj)), b2 = sub(at(ak),at(aj)), b3 = sub(at(ak),at(al));
    const m = crs(b1,b2), nn = crs(b2,b3);
    const phi = Math.atan2(dot(b1,nn)*Math.sqrt(dot(b2,b2)), dot(m,nn));
    dih += amp * (1 + Math.cos(periodicity*phi)*cosPhase + Math.sin(periodicity*phi)*sinPhase);
  }
  for (let q = 0; q < topo.counts.nPairs; q++){
    const i = topo.tu[topo.offs.oPairI+2*q], j = topo.tu[topo.offs.oPairI+2*q+1];
    const sig = topo.tf[topo.offs.oPairP+3*q], eps = topo.tf[topo.offs.oPairP+3*q+1];
    const chargeprod = topo.tf[topo.offs.oPairP+3*q+2];
    const d = sub(at(i),at(j)); const r2 = Math.max(dot(d,d), 1e-4);
    const s6 = (sig*sig/r2)**3;
    lj += 4*eps*(s6*s6 - s6);
    coul += (topo.coulombConstant ?? COUL) * chargeprod / Math.sqrt(r2);
  }
  const W = topo.exclW;
  for (let a = 0; a < n; a++) for (let j = a+1; j < n; j++){
    if ((topo.excl[a*W + (j>>5)] >> (j & 31)) & 1) continue;
    const d = sub(at(a),at(j)); const r2 = Math.max(dot(d,d), 1e-4);
    const sig = 0.5*(pr[a*4]+pr[j*4]), eps = Math.sqrt(pr[a*4+1]*pr[j*4+1]);
    const s6 = (sig*sig/r2)**3;
    lj += 4*eps*(s6*s6 - s6);
    coul += (topo.coulombConstant ?? COUL) * pr[a*4+2]*pr[j*4+2] / Math.sqrt(r2);
  }
  return { bond, angle, dih, lj, coul, total: bond+angle+dih+lj+coul };
}

// Analytic f64 nonbonded pair force on atom i of a 2-atom system (for overflow tests).
export function cpuDimerForce(topo, P){
  const pr = topo.props;
  const d = [P[0]-P[4], P[1]-P[5], P[2]-P[6]];
  const r2 = Math.max(d[0]*d[0]+d[1]*d[1]+d[2]*d[2], 1e-4);
  const sig = 0.5*(pr[0]+pr[4]), eps = Math.sqrt(pr[1]*pr[5]);
  const s6 = (sig*sig/r2)**3;
  const flj = 24*eps*(2*s6*s6 - s6)/r2;
  const fqq = (topo.coulombConstant ?? COUL)*pr[2]*pr[6]/(Math.sqrt(r2)*r2);
  return d.map(x => (flj + fqq)*x);
}

export function decodeI64(lo, hi, scale){
  let v = (BigInt(hi) << 32n) | BigInt(lo);
  if (v & 0x8000000000000000n) v -= 0x10000000000000000n;
  return Number(v) / scale;
}
export function decodeAcc(u32, nReps){
  const out = [];
  for (let r = 0; r < nReps; r++){
    const b = r*16, d = o => decodeI64(u32[b+o], u32[b+o+1], ESCALE);
    out.push({ bond:d(0), angle:d(2), dih:d(4), lj:d(6), coul:d(8), ke:d(10), implicit:d(12) });
  }
  return out;
}
export function decodeForces(u32){
  const out = new Float64Array(u32.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = decodeI64(u32[i*2], u32[i*2+1], FSCALE);
  return out;
}
