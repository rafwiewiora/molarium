// stormm-webgpu v0.3 validation suite.
// Run: VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json node test.mjs
import { create } from 'webgpu';
Object.assign(globalThis, (await import('webgpu')).globals);
import { buildAlkane, buildWater, buildDimer, buildParameterizedSystem,
  cpuEnergies, cpuDimerForce, mulberry32 } from './core.mjs';
import { createEngine } from './engine.mjs';

const gpu = create([]);
const adapter = await gpu.requestAdapter();
if (!adapter) { console.error('NO ADAPTER'); process.exit(1); }
const device = await adapter.requestDevice();
let allPass = true;
const constraintsOnly = process.argv.includes('--constraints-only');
const seededWater = (side, seed) => buildWater(side, mulberry32(seed));
const check = (label, ok, detail) => {
  console.log(`  ${label.padEnd(46)} ${detail}  ${ok ? 'OK' : '*** FAIL'}`);
  allPass = allPass && ok;
};

// Thresholds (empirical margins ~3-5x over observed maxima on lavapipe f32):
const E_REL = 1e-4, E_ABS = 1e-4;      // energy component agreement vs f64
const F_REL = 2e-4;                     // force vs f64 finite differences, ALL atoms
const NVE_TOL = 0.005;                  // windowed |dE/E| over 4000 steps
const T_LO = 275, T_HI = 325;           // Langevin mean T bounds (2.6 sigma for this system size)

function relOK(g, c){ const rel = Math.abs(g-c)/Math.max(Math.abs(c),1e-9); return rel < E_REL || Math.abs(g-c) < E_ABS; }
const relOf = (g, c) => (Math.abs(g-c)/Math.max(Math.abs(c),1e-9)).toExponential(1);

function constrainedWater(side = 2, seed = 500){
  const source = seededWater(side, seed);
  const molecule = { atoms: [], bonds: [] };
  const particles = [], nonbonded = [], constraints = [], bonds = [], angles = [], exceptions = [];
  for (let atom = 0; atom < source.nAtoms; atom++) {
    const isOxygen = atom % 3 === 0;
    molecule.atoms.push({
      element: isOxygen ? 'O' : 'H',
      x: source.coords[atom*3], y: source.coords[atom*3 + 1], z: source.coords[atom*3 + 2],
    });
    particles.push({ mass_amu: source.props[atom*4 + 3] });
    nonbonded.push({
      sigma_nm: source.props[atom*4]*0.1,
      epsilon_kj: source.props[atom*4 + 1]*4.184,
      charge_e: source.props[atom*4 + 2],
    });
  }
  const zero = (i, j) => ({ i, j, chargeprod_e2:0, sigma_nm:1, epsilon_kj:0 });
  for (let water = 0; water < source.nAtoms/3; water++) {
    const oxygen = water*3, h1 = oxygen + 1, h2 = oxygen + 2;
    molecule.bonds.push({ a:oxygen, b:h1, order:1 }, { a:oxygen, b:h2, order:1 });
    constraints.push({ i:oxygen, j:h1, distance_nm:0.09572 },
      { i:oxygen, j:h2, distance_nm:0.09572 });
    bonds.push({ i:oxygen, j:h1, r0_nm:0.09572, k_kj_nm2:376560 },
      { i:oxygen, j:h2, r0_nm:0.09572, k_kj_nm2:376560 });
    angles.push({ i:h1, j:oxygen, k:h2, theta0_rad:104.52*Math.PI/180,
      k_kj_rad2:460.24 });
    exceptions.push(zero(oxygen, h1), zero(oxygen, h2), zero(h1, h2));
  }
  return buildParameterizedSystem(molecule, {
    forcefield:'constrained TIP3P-like validation', chargeModel:'TIP3P charges',
    system:{ particles, constraints, bonds, angles, torsions:[], nonbonded, exceptions },
  }, { dt:0.002 });
}

function maximumConstraintError(topo, packedPositions){
  let maximum = 0;
  for (let constraint = 0; constraint < topo.counts.nConstraints; constraint++) {
    const i = topo.tu[topo.offs.oConstraintI + constraint*2];
    const j = topo.tu[topo.offs.oConstraintI + constraint*2 + 1];
    const target = topo.tf[topo.offs.oConstraintP + constraint];
    const distance = Math.hypot(
      packedPositions[i*4] - packedPositions[j*4],
      packedPositions[i*4 + 1] - packedPositions[j*4 + 1],
      packedPositions[i*4 + 2] - packedPositions[j*4 + 2],
    );
    maximum = Math.max(maximum, Math.abs(distance/target - 1));
  }
  return maximum;
}

function maximumVelocityConstraintError(topo, packedPositions, packedVelocities){
  let maximum = 0;
  for (let constraint = 0; constraint < topo.counts.nConstraints; constraint++) {
    const i = topo.tu[topo.offs.oConstraintI + constraint*2];
    const j = topo.tu[topo.offs.oConstraintI + constraint*2 + 1];
    const delta = [0, 1, 2].map((axis) => packedPositions[i*4 + axis] - packedPositions[j*4 + axis]);
    const relativeVelocity = [0, 1, 2].map((axis) => packedVelocities[i*4 + axis] - packedVelocities[j*4 + axis]);
    const distance2 = delta.reduce((sum, value) => sum + value*value, 0);
    const dot = delta.reduce((sum, value, axis) => sum + value*relativeVelocity[axis], 0);
    maximum = Math.max(maximum, topo.dt*Math.abs(dot)/distance2);
  }
  return maximum;
}

async function energyAndForces(name, topo, T = 200){
  console.log(`\n=== ${name}: atoms=${topo.nAtoms} bonds=${topo.counts.nBonds} angles=${topo.counts.nAngles} dih=${topo.counts.nDih} pairs=${topo.counts.nPairs} exclW=${topo.exclW}`);
  const eng = await createEngine(device, topo, 8, { T, thermo: 0, initSeed: 7 });
  await eng.done();
  const E = (await eng.readEnergies())[0];
  const P = await eng.readPositions(0);
  const C = cpuEnergies(topo, P);
  for (const k of ['bond','angle','dih','lj','coul'])
    check(`energy ${k} vs f64`, relOK(E[k], C[k]), `gpu=${E[k].toFixed(5)} cpu=${C[k].toFixed(5)} rel=${relOf(E[k],C[k])}`);
  // forces vs f64 finite differences — every atom, every component
  const Fg = await eng.readForces(0);
  const Pd = Float64Array.from(P);
  let maxRel = 0, h = 1e-5;
  for (let a = 0; a < topo.nAtoms; a++) for (let c = 0; c < 3; c++){
    const keep = Pd[a*4+c];
    Pd[a*4+c] = keep + h; const ep = cpuEnergies(topo, Pd).total;
    Pd[a*4+c] = keep - h; const em = cpuEnergies(topo, Pd).total;
    Pd[a*4+c] = keep;
    const fd = -(ep - em) / (2*h);
    maxRel = Math.max(maxRel, Math.abs(Fg[a*3+c] - fd) / Math.max(Math.abs(fd), 1.0));
  }
  check(`forces vs FD (${topo.nAtoms*3} components)`, maxRel < F_REL, `max rel=${maxRel.toExponential(1)}`);
  return eng;
}

async function nve(name, topo, steps){
  const eng = await createEngine(device, topo, 8, { T: 200, thermo: 0, initSeed: 11 });
  const S = [];
  for (let sN = 0; sN < 16; sN++){
    eng.run(steps >> 4); await eng.done();
    const e = await eng.readEnergies();
    S.push(e.map(x => x.bond + x.angle + x.dih + x.lj + x.coul + x.implicit + x.ke));
  }
  let maxDrift = 0;
  for (let r = 0; r < 8; r++){
    const head = S.slice(0, 4).reduce((a, s) => a + s[r], 0) / 4;
    const tail = S.slice(-4).reduce((a, s) => a + s[r], 0) / 4;
    maxDrift = Math.max(maxDrift, Math.abs((tail - head) / head));
  }
  check(`${name} NVE drift ${steps} steps dt=${topo.dt*1e3}fs`, maxDrift < NVE_TOL, `windowed max |dE/E|=${(maxDrift*100).toExponential(1)}%`);
  eng.destroy();
}

if (!constraintsOnly) {
// ---- 1-2: standard molecules: energies, all-atom FD forces, NVE ----
(await energyAndForces('alkane C16', buildAlkane(16))).destroy();
(await energyAndForces('water 27 (81 atoms)', seededWater(3, 101))).destroy();
await nve('alkane C16', buildAlkane(16), 4000);
await nve('water 27', seededWater(3, 102), 4000);

// ---- 3: atom-count above the old 128 cap (dynamic exclusion masks) ----
(await energyAndForces('water 64 (192 atoms, exclW=6)', seededWater(4, 103))).destroy();

// ---- 4: accumulator overflow — clashed dimer, |E| ~ 2e6 kcal/mol, |F| ~ 3e7 ----
{
  console.log('\n=== overflow: LJ dimer at r=1.0 A (was saturated at ±453 kcal/mol pre-v0.3)');
  const topo = buildDimer({ r: 1.0 });
  const eng = await createEngine(device, topo, 2, { T: 1e-9, thermo: 0, initSeed: 3 });
  await eng.done();
  const E = (await eng.readEnergies())[0];
  const P = await eng.readPositions(0);
  const C = cpuEnergies(topo, P);
  check('clash LJ energy (~2e6) vs f64', relOK(E.lj, C.lj) && Math.abs(C.lj) > 1e5,
        `gpu=${E.lj.toExponential(4)} cpu=${C.lj.toExponential(4)} rel=${relOf(E.lj,C.lj)}`);
  const Fg = await eng.readForces(0);
  const Fa = cpuDimerForce(topo, P);
  const rel = Math.abs(Fg[0] - Fa[0]) / Math.abs(Fa[0]);
  check('clash force (~3e7) vs f64 analytic', rel < 1e-4 && Math.abs(Fa[0]) > 1e6,
        `gpu=${Fg[0].toExponential(4)} cpu=${Fa[0].toExponential(4)} rel=${rel.toExponential(1)}`);
  eng.destroy();
}

// ---- 5: coordinate range — system translated 500 A (old i32@2^24 coords wrapped at ±128 A) ----
{
  console.log('\n=== coordinate range: alkane translated +500 A on each axis');
  const t0 = buildAlkane(16);
  const t1 = buildAlkane(16);
  for (let i = 0; i < t1.coords.length; i++) t1.coords[i] += 500;
  const e0 = await createEngine(device, t0, 2, { T: 1e-9, thermo: 0, initSeed: 5 });
  const e1 = await createEngine(device, t1, 2, { T: 1e-9, thermo: 0, initSeed: 5 });
  await e0.done(); await e1.done();
  const E0 = (await e0.readEnergies())[0], E1 = (await e1.readEnergies())[0];
  const tot0 = E0.bond + E0.angle + E0.dih + E0.lj + E0.coul + E0.implicit;
  const tot1 = E1.bond + E1.angle + E1.dih + E1.lj + E1.coul + E1.implicit;
  // f32 mirror at 500 A has ~6e-5 A resolution -> expect % -level agreement, not exact
  const rel = Math.abs(tot1 - tot0) / Math.max(Math.abs(tot0), 1e-9);
  check('translation invariance at 500 A', rel < 0.05, `E(0)=${tot0.toFixed(4)} E(+500)=${tot1.toFixed(4)} rel=${rel.toExponential(1)}`);
  const P1 = await e1.readPositions(0);
  // initReplicas applies a random rigid rotation about the origin: compare the
  // rotation-invariant radius of atom 0, which must survive the int64 coordinate path.
  const rGot = Math.hypot(P1[0], P1[1], P1[2]);
  const rExp = Math.hypot(t1.coords[0], t1.coords[1], t1.coords[2]);
  check('coordinate radius round-trip at 500 A', Math.abs(rGot - rExp) < 0.05, `|r| read=${rGot.toFixed(3)} expected=${rExp.toFixed(3)}`);
  e0.destroy(); e1.destroy();
}

// ---- 6: deterministic replay — bitwise-identical trajectories, thermostat ON ----
{
  console.log('\n=== determinism: two engines, same seeds, 500 Langevin steps');
  const mk = () => createEngine(device, seededWater(3, 1234), 4,
    { T: 300, thermo: 1, gamma: 2.0, seed: 42, initSeed: 99 });
  const a = await mk(), b = await mk();
  a.run(500); b.run(500); await a.done(); await b.done();
  const Ea = await a.readEnergies(), Eb = await b.readEnergies();
  let eEq = true;
  for (let r = 0; r < 4; r++) for (const k of ['bond','angle','dih','lj','coul','implicit','ke']) eEq = eEq && (Ea[r][k] === Eb[r][k]);
  check('energies bitwise identical (fixed-point)', eEq, eEq ? 'all components, 4 replicas' : 'mismatch');
  const Pa = await a.readPositions(2), Pb = await b.readPositions(2);
  let pEq = true;
  for (let i = 0; i < Pa.length; i++) pEq = pEq && (Pa[i] === Pb[i]);
  check('positions bitwise identical after 500 steps', pEq, pEq ? `${Pa.length/4} atoms` : 'mismatch');
  const allPositions = await a.readAllPositions();
  const replicaOffset = 2 * Pa.length;
  let bulkEq = allPositions.length === Pa.length * 4;
  for (let i = 0; i < Pa.length; i++) bulkEq = bulkEq && (allPositions[replicaOffset + i] === Pa[i]);
  check('bulk snapshot preserves replica boundaries', bulkEq,
    bulkEq ? '4 separate replica blocks' : 'bulk layout mismatch');
  a.destroy(); b.destroy();
}

// ---- 7: Langevin thermostat regulation ----
{
  const topo = seededWater(3, 104);
  const eng = await createEngine(device, topo, 8, { T: 300, thermo: 1, gamma: 5.0, initSeed: 21 });
  eng.run(2000); await eng.done();
  const kb = 0.0019872, dof = 3*topo.nAtoms;
  let Tm = 0, nS = 4;
  for (let s = 0; s < nS; s++){
    eng.run(250); await eng.done();
    const e = await eng.readEnergies();
    Tm += e.reduce((a, x) => a + 2*x.ke/(dof*kb), 0) / e.length / nS;
  }
  console.log('\n=== thermostat');
  check(`Langevin mean T in [${T_LO},${T_HI}] K`, Tm > T_LO && Tm < T_HI, `T=${Tm.toFixed(1)} K (8 replicas x 4 samples)`);
  eng.destroy();
}
}

// ---- 8: coupled X-H SHAKE/RATTLE, deterministic replay, replica isolation ----
{
  console.log('\n=== constraints: coupled water O-H bonds, 2 fs SHAKE/RATTLE');
  const topo = constrainedWater(2, 501);
  const options = { T:300, thermo:1, gamma:2, seed:2718, initSeed:31415,
    constraintTolerance:1e-5, constraintIterations:32 };
  const a = await createEngine(device, topo, 4, options);
  const b = await createEngine(device, topo, 4, options);
  const single = await createEngine(device, topo, 1, options);
  a.run(500); b.run(500); single.run(500);
  await a.done(); await b.done(); await single.done();
  const status = await a.readConstraintStatus();
  const pa = await a.readPositions(0), pb = await b.readPositions(0), ps = await single.readPositions(0);
  const velocities = await a.readVelocities(0);
  const geometricResidual = maximumConstraintError(topo, pa);
  const velocityResidual = maximumVelocityConstraintError(topo, pa, velocities);
  check('SHAKE/RATTLE reports convergence', status.converged,
    `max combined residual=${status.maximumResidual.toExponential(2)}`);
  check('all constrained distances satisfy tolerance', geometricResidual <= 1.1e-5,
    `max relative distance error=${geometricResidual.toExponential(2)}`);
  check('RATTLE projects constrained velocities', velocityResidual <= 1.1e-5,
    `max dimensionless one-step residual=${velocityResidual.toExponential(2)}`);
  check('constrained replay is bitwise deterministic', pa.every((value, index) => value === pb[index]),
    `${topo.counts.nConstraints} constraints · 500 Langevin steps`);
  check('replica 1 matches a standalone trajectory bitwise', pa.every((value, index) => value === ps[index]),
    '1-replica and 4-replica synthesis boundaries are isolated');
  await a.assertHealthy(); await b.assertHealthy(); await single.assertHealthy();
  a.destroy(); b.destroy(); single.destroy();

  const fail = await createEngine(device, constrainedWater(2, 502), 2, {
    ...options, coordinateJitter:0.2, constraintTolerance:1e-8, constraintIterations:1,
  });
  fail.run(1); await fail.done();
  let reportedNonconvergence = false;
  try { await fail.assertHealthy(); }
  catch (error) { reportedNonconvergence = /constraints did not converge.*(SHAKE|RATTLE)/s.test(String(error)); }
  check('iteration-limit failure is explicit', reportedNonconvergence,
    reportedNonconvergence ? 'replica and residual reported' : 'failure was not reported');
  fail.destroy();
}

if (!constraintsOnly) {
// ---- 9: deterministic builders and defensive input checks ----
{
  console.log('\n=== validation guards');
  const a = seededWater(3, 2026), b = seededWater(3, 2026);
  check('water builder honors supplied RNG', JSON.stringify(a.coords) === JSON.stringify(b.coords),
    'same seed gives identical topology coordinates');
  let rejectedNaN = false;
  try {
    await createEngine(device, buildDimer({ eps: Number.NaN }), 1, { initSeed: 1 });
  } catch (error) {
    rejectedNaN = /not finite/.test(String(error));
  }
  check('non-finite topology rejected before dispatch', rejectedNaN, rejectedNaN ? 'rejected' : 'not rejected');
  const eng = await createEngine(device, buildDimer(), 1, { initSeed: 1 });
  let rejectedSteps = false;
  try { eng.run(Number.POSITIVE_INFINITY); } catch (error) { rejectedSteps = /step count/.test(String(error)); }
  check('non-finite MD step count rejected', rejectedSteps, rejectedSteps ? 'rejected' : 'not rejected');
  eng.destroy();
  const overflow = await createEngine(device, buildDimer({ sig: 1000 }), 1, { T: 0, initSeed: 2 });
  await overflow.done();
  let reportedFault = false;
  try { await overflow.readEnergies(); } catch (error) { reportedFault = /clamped/.test(String(error)); }
  check('GPU fixed-point clamp is reported', reportedFault, reportedFault ? 'reported' : 'not reported');
  overflow.destroy();
}
}

console.log(allPass ? '\nALL TESTS PASS' : '\nFAILURES PRESENT');
process.exit(allPass ? 0 : 1);
