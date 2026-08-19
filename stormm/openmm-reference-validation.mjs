// Compare the WebGPU kernels against Molarium's bundled OpenMM 8.2 Reference-platform WASM.
import { readFile } from 'node:fs/promises';
import { create } from 'webgpu';
import createMolariumOpenMM from '../openmm/molarium-openmm.js';
import { obc2Parameters } from '../openff/implicit-solvent.js';
import { buildAlkane, buildDimer, buildParameterizedSystem, buildWater, mulberry32 } from './core.mjs';
import { createEngine } from './engine.mjs';

Object.assign(globalThis, (await import('webgpu')).globals);

const KJ_PER_KCAL = 4.184;
const KJ_NM_PER_KCAL_ANGSTROM = 41.84;
const ENERGY_REL_TOL = 3e-4;
const ENERGY_ABS_TOL = 2e-4;
const FORCE_REL_RMS_TOL = 5e-4;

const gpu = create([]);
const adapter = await gpu.requestAdapter();
if (!adapter) throw new Error('No WebGPU adapter is available');
const device = await adapter.requestDevice();

const wasmBytes = await readFile(new URL('../openmm/molarium-openmm.wasm', import.meta.url));
const openmm = await createMolariumOpenMM({
  instantiateWasm(imports, success){
    WebAssembly.instantiate(wasmBytes, imports).then(({ instance }) => success(instance));
    return {};
  },
});

function lastOpenMMError(){
  return openmm.UTF8ToString(openmm._molarium_last_error()) || 'OpenMM calculation failed';
}

function requireOpenMMSuccess(success){
  if (!success) throw new Error(lastOpenMMError());
}

function allocate(array){
  if (!array.length) return 0;
  const pointer = openmm._malloc(array.byteLength);
  if (array instanceof Int32Array) openmm.HEAP32.set(array, pointer >> 2);
  else openmm.HEAPF64.set(array, pointer >> 3);
  return pointer;
}

const indices = (values) => Int32Array.from(values);
const numbers = (values) => Float64Array.from(values);
const pairKey = (i, j) => i < j ? `${i}:${j}` : `${j}:${i}`;

function unpackTopology(topo, positions, mode, useImplicit){
  const n = topo.nAtoms;
  const includeBond = mode === 'total' || mode === 'bond';
  const includeAngle = mode === 'total' || mode === 'angle';
  const includeDih = mode === 'total' || mode === 'dih';
  const includeLJ = mode === 'total' || mode === 'lj';
  const includeCoul = mode === 'total' || mode === 'coul';
  const prop = (atom, field) => topo.tf[topo.offs.oProps + atom * 4 + field];

  const masses = [], charges = [], sigmas = [], epsilons = [];
  for (let atom = 0; atom < n; atom++) {
    masses.push(prop(atom, 3));
    charges.push(includeCoul ? prop(atom, 2) : 0);
    sigmas.push(prop(atom, 0) * 0.1);
    epsilons.push(includeLJ ? prop(atom, 1) * KJ_PER_KCAL : 0);
  }

  const bondI = [], bondJ = [], bondR0 = [], bondK = [];
  if (includeBond) for (let term = 0; term < topo.counts.nBonds; term++) {
    bondI.push(topo.tu[topo.offs.oBondI + term * 2]);
    bondJ.push(topo.tu[topo.offs.oBondI + term * 2 + 1]);
    const k = topo.tf[topo.offs.oBondP + term * 2];
    bondK.push(2 * k * KJ_PER_KCAL * 100); // OpenMM uses 1/2*k*(r-r0)^2 and nm.
    bondR0.push(topo.tf[topo.offs.oBondP + term * 2 + 1] * 0.1);
  }

  const angleI = [], angleJ = [], angleKAtom = [], angleTheta = [], angleForce = [];
  if (includeAngle) for (let term = 0; term < topo.counts.nAngles; term++) {
    angleI.push(topo.tu[topo.offs.oAngleI + term * 3]);
    angleJ.push(topo.tu[topo.offs.oAngleI + term * 3 + 1]);
    angleKAtom.push(topo.tu[topo.offs.oAngleI + term * 3 + 2]);
    angleForce.push(2 * topo.tf[topo.offs.oAngleP + term * 2] * KJ_PER_KCAL);
    angleTheta.push(topo.tf[topo.offs.oAngleP + term * 2 + 1]);
  }

  const dihI = [], dihJ = [], dihK = [], dihL = [], periodicity = [], phase = [], dihForce = [];
  if (includeDih) for (let term = 0; term < topo.counts.nDih; term++) {
    const atoms = [0, 1, 2, 3].map((offset) => topo.tu[topo.offs.oDihI + term * 4 + offset]);
    const offset = topo.offs.oDihP + term * 4;
    dihI.push(atoms[0]); dihJ.push(atoms[1]); dihK.push(atoms[2]); dihL.push(atoms[3]);
    periodicity.push(Math.round(topo.tf[offset + 1]));
    phase.push(Math.atan2(topo.tf[offset + 3], topo.tf[offset + 2]));
    dihForce.push(topo.tf[offset] * KJ_PER_KCAL);
  }

  const scaledPairs = new Map();
  for (let term = 0; term < topo.counts.nPairs; term++) {
    const i = topo.tu[topo.offs.oPairI + term * 2];
    const j = topo.tu[topo.offs.oPairI + term * 2 + 1];
    scaledPairs.set(pairKey(i, j), {
      sigma: topo.tf[topo.offs.oPairP + term * 3],
      epsilon: topo.tf[topo.offs.oPairP + term * 3 + 1],
      chargeprod: topo.tf[topo.offs.oPairP + term * 3 + 2],
    });
  }
  const exceptionI = [], exceptionJ = [], exceptionCharge = [], exceptionSigma = [], exceptionEpsilon = [];
  if (includeLJ || includeCoul) for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const excluded = (topo.excl[i * topo.exclW + (j >> 5)] >>> (j & 31)) & 1;
    if (!excluded) continue;
    const pair = scaledPairs.get(pairKey(i, j)) ?? {
      sigma: 0.5 * (prop(i, 0) + prop(j, 0)), epsilon: 0, chargeprod: 0,
    };
    exceptionI.push(i); exceptionJ.push(j);
    exceptionCharge.push(includeCoul ? pair.chargeprod : 0);
    exceptionSigma.push(pair.sigma * 0.1);
    exceptionEpsilon.push(includeLJ ? pair.epsilon * KJ_PER_KCAL : 0);
  }
  const obcRadii = [], obcScale = [];
  if (useImplicit) for (let atom = 0; atom < n; atom++) {
    obcRadii.push(topo.obc[atom * 2] * 0.1);
    obcScale.push(topo.obc[atom * 2 + 1]);
  }

  const constraintI = [], constraintJ = [], constraintDistance = [];
  for (let term = 0; term < (topo.counts.nConstraints ?? 0); term++) {
    constraintI.push(topo.tu[topo.offs.oConstraintI + term*2]);
    constraintJ.push(topo.tu[topo.offs.oConstraintI + term*2 + 1]);
    constraintDistance.push(topo.tf[topo.offs.oConstraintP + term]*0.1);
  }

  return {
    masses: numbers(masses), positions: numbers(positions),
    constraintI: indices(constraintI), constraintJ: indices(constraintJ),
    constraintDistance: numbers(constraintDistance),
    bondI: indices(bondI), bondJ: indices(bondJ), bondR0: numbers(bondR0), bondK: numbers(bondK),
    angleI: indices(angleI), angleJ: indices(angleJ), angleK: indices(angleKAtom),
    angleTheta: numbers(angleTheta), angleForce: numbers(angleForce),
    dihI: indices(dihI), dihJ: indices(dihJ), dihK: indices(dihK), dihL: indices(dihL),
    periodicity: indices(periodicity), phase: numbers(phase), dihForce: numbers(dihForce),
    charges: numbers(charges), sigmas: numbers(sigmas), epsilons: numbers(epsilons),
    exceptionI: indices(exceptionI), exceptionJ: indices(exceptionJ),
    exceptionCharge: numbers(exceptionCharge), exceptionSigma: numbers(exceptionSigma),
    exceptionEpsilon: numbers(exceptionEpsilon),
    obcRadii: numbers(obcRadii), obcScale: numbers(obcScale),
  };
}

function initializeReference(topo, positions, mode, useImplicit = Boolean(topo.implicitSolvent)){
  const x = unpackTopology(topo, positions, mode, useImplicit);
  const arrays = [
    x.masses, x.positions,
    x.constraintI, x.constraintJ, x.constraintDistance,
    x.bondI, x.bondJ, x.bondR0, x.bondK,
    x.angleI, x.angleJ, x.angleK, x.angleTheta, x.angleForce,
    x.dihI, x.dihJ, x.dihK, x.dihL, x.periodicity, x.phase, x.dihForce,
    x.charges, x.sigmas, x.epsilons,
    x.exceptionI, x.exceptionJ, x.exceptionCharge, x.exceptionSigma, x.exceptionEpsilon,
    x.obcRadii, x.obcScale,
  ];
  const p = arrays.map(allocate);
  try {
    requireOpenMMSuccess(openmm._molarium_initialize_sage(
      topo.nAtoms, p[0], p[1],
      x.constraintI.length, p[2], p[3], p[4],
      x.bondI.length, p[5], p[6], p[7], p[8],
      x.angleI.length, p[9], p[10], p[11], p[12], p[13],
      x.dihI.length, p[14], p[15], p[16], p[17], p[18], p[19], p[20],
      p[21], p[22], p[23],
      x.exceptionI.length, p[24], p[25], p[26], p[27], p[28],
      useImplicit ? 1 : 0, p[29], p[30], topo.dt, 0,
    ));
  } finally {
    p.forEach((pointer) => { if (pointer) openmm._free(pointer); });
  }
}

function readReferenceForces(atomCount){
  const length = atomCount * 3;
  const pointer = openmm._malloc(length * Float64Array.BYTES_PER_ELEMENT);
  try {
    requireOpenMMSuccess(openmm._molarium_get_forces(pointer, length));
    return Float64Array.from(openmm.HEAPF64.subarray(pointer >> 3, (pointer >> 3) + length),
      (force) => force / KJ_NM_PER_KCAL_ANGSTROM);
  } finally {
    openmm._free(pointer);
  }
}

function readReferencePositions(atomCount){
  const length = atomCount*3;
  const pointer = openmm._malloc(length*Float64Array.BYTES_PER_ELEMENT);
  try {
    requireOpenMMSuccess(openmm._molarium_get_positions(pointer, length));
    return Float64Array.from(openmm.HEAPF64.subarray(pointer >> 3, (pointer >> 3) + length));
  } finally {
    openmm._free(pointer);
  }
}

function maximumConstraintError(topo, positions, packed = false){
  let maximum = 0;
  const coordinate = (atom, axis) => positions[atom*(packed ? 4 : 3) + axis];
  for (let term = 0; term < (topo.counts.nConstraints ?? 0); term++) {
    const i = topo.tu[topo.offs.oConstraintI + term*2];
    const j = topo.tu[topo.offs.oConstraintI + term*2 + 1];
    const target = topo.tf[topo.offs.oConstraintP + term];
    const distance = Math.hypot(
      coordinate(i, 0) - coordinate(j, 0),
      coordinate(i, 1) - coordinate(j, 1),
      coordinate(i, 2) - coordinate(j, 2),
    );
    maximum = Math.max(maximum, Math.abs(distance/target - 1));
  }
  return maximum;
}

function referenceEvaluation(topo, positions, mode, withForces = false,
    useImplicit = Boolean(topo.implicitSolvent)){
  initializeReference(topo, positions, mode, useImplicit);
  try {
    const energyKj = openmm._molarium_get_potential_energy();
    if (!Number.isFinite(energyKj)) throw new Error(lastOpenMMError());
    return {
      energy: energyKj / KJ_PER_KCAL,
      forces: withForces ? readReferenceForces(topo.nAtoms) : null,
    };
  } finally {
    openmm._molarium_destroy();
  }
}

function relativeError(value, reference){
  return Math.abs(value - reference) / Math.max(Math.abs(reference), 1e-12);
}

function compareForces(values, reference){
  let error2 = 0, reference2 = 0, maximumAbsolute = 0;
  for (let i = 0; i < values.length; i++) {
    const error = values[i] - reference[i];
    error2 += error * error;
    reference2 += reference[i] * reference[i];
    maximumAbsolute = Math.max(maximumAbsolute, Math.abs(error));
  }
  return {
    relativeRms: Math.sqrt(error2 / Math.max(reference2, 1e-30)),
    rmsAbsolute: Math.sqrt(error2 / values.length),
    maximumAbsolute,
  };
}

const results = [];
let passed = true;
function check(label, ok, detail){
  console.log(`  ${label.padEnd(38)} ${detail}  ${ok ? 'OK' : '*** FAIL'}`);
  passed &&= ok;
}

async function compareCase(name, topo, initSeed){
  console.log(`\n=== ${name} · ${topo.nAtoms} atoms`);
  const engine = await createEngine(device, topo, 1, { T: 0, thermo: 0, initSeed });
  await engine.done();
  try {
    const gpuEnergy = (await engine.readEnergies())[0];
    const pos4 = await engine.readPositions(0);
    const positions = Float64Array.from({ length: topo.nAtoms * 3 }, (_, index) => {
      const atom = Math.floor(index / 3), axis = index % 3;
      return pos4[atom * 4 + axis];
    });
    const componentMap = { bond: 'bond', angle: 'angle', dih: 'dih', lj: 'lj', coul: 'coul' };
    const componentResults = {};
    for (const [key, mode] of Object.entries(componentMap)) {
      const reference = referenceEvaluation(topo, positions, mode, false, false).energy;
      const absolute = Math.abs(gpuEnergy[key] - reference);
      const relative = relativeError(gpuEnergy[key], reference);
      const ok = absolute < ENERGY_ABS_TOL || relative < ENERGY_REL_TOL;
      componentResults[key] = { webgpu: gpuEnergy[key], openmm: reference, absolute, relative, passed: ok };
      check(`${key} energy`, ok, `GPU ${gpuEnergy[key].toFixed(7)} · OpenMM ${reference.toFixed(7)} · rel ${relative.toExponential(2)}`);
    }

    if (topo.implicitSolvent) {
      const withImplicit = referenceEvaluation(topo, positions, 'total', false, true).energy;
      const vacuum = referenceEvaluation(topo, positions, 'total', false, false).energy;
      const reference = withImplicit - vacuum;
      const absolute = Math.abs(gpuEnergy.implicit - reference);
      const relative = relativeError(gpuEnergy.implicit, reference);
      const ok = absolute < ENERGY_ABS_TOL * 2 || relative < ENERGY_REL_TOL;
      componentResults.implicit = {
        webgpu: gpuEnergy.implicit, openmm: reference, absolute, relative, passed: ok,
      };
      check('implicit energy', ok,
        `GPU ${gpuEnergy.implicit.toFixed(7)} · OpenMM ${reference.toFixed(7)} · rel ${relative.toExponential(2)}`);
    }

    const totalReference = referenceEvaluation(topo, positions, 'total', true);
    const totalGpu = gpuEnergy.bond + gpuEnergy.angle + gpuEnergy.dih + gpuEnergy.lj
      + gpuEnergy.coul + gpuEnergy.implicit;
    const totalAbsolute = Math.abs(totalGpu - totalReference.energy);
    const totalRelative = relativeError(totalGpu, totalReference.energy);
    const totalOk = totalAbsolute < ENERGY_ABS_TOL * 2 || totalRelative < ENERGY_REL_TOL;
    check('total potential', totalOk, `GPU ${totalGpu.toFixed(7)} · OpenMM ${totalReference.energy.toFixed(7)} · abs ${totalAbsolute.toExponential(2)}`);

    const gpuForces = await engine.readForces(0);
    const force = compareForces(gpuForces, totalReference.forces);
    const forceOk = force.relativeRms < FORCE_REL_RMS_TOL;
    check('all force components', forceOk,
      `rel RMS ${force.relativeRms.toExponential(2)} · max ${force.maximumAbsolute.toExponential(2)} kcal/mol/A`);
    results.push({ name, atoms: topo.nAtoms, components: componentResults,
      total: { webgpu: totalGpu, openmm: totalReference.energy, absolute: totalAbsolute, relative: totalRelative, passed: totalOk },
      forces: { ...force, passed: forceOk } });
  } finally {
    engine.destroy();
  }
}

function generalParameterizedCase(implicit = false){
  const molecule = {
    atoms: [
      { element:'C', x:0, y:0, z:0 }, { element:'C', x:1.48, y:0.12, z:0 },
      { element:'N', x:2.57, y:1.02, z:0.28 }, { element:'O', x:3.78, y:0.66, z:1.02 },
    ],
    bonds:[{a:0,b:1,order:1},{a:1,b:2,order:1},{a:2,b:3,order:1}],
  };
  const nonbonded = [
    { charge_e:0.4, sigma_nm:0.34, epsilon_kj:0.42 },
    { charge_e:-0.2, sigma_nm:0.33, epsilon_kj:0.31 },
    { charge_e:0.1, sigma_nm:0.32, epsilon_kj:0.55 },
    { charge_e:-0.3, sigma_nm:0.30, epsilon_kj:0.66 },
  ];
  const zero = (i,j) => ({ i,j,chargeprod_e2:0,sigma_nm:1,epsilon_kj:0 });
  const parameterization = {
    forcefield:'Synthetic general OpenMM System', chargeModel:'explicit test charges',
    system:{
      particles:[12.01,12.01,14.01,16].map((mass_amu) => ({mass_amu})), constraints:[],
      bonds:[
        {i:0,j:1,r0_nm:0.151,k_kj_nm2:190000},
        {i:1,j:2,r0_nm:0.143,k_kj_nm2:210000},
        {i:2,j:3,r0_nm:0.138,k_kj_nm2:250000},
      ],
      angles:[
        {i:0,j:1,k:2,theta0_rad:1.98,k_kj_rad2:520},
        {i:1,j:2,k:3,theta0_rad:2.05,k_kj_rad2:610},
      ],
      torsions:[{i:0,j:1,k:2,l:3,periodicity:6,phase_rad:Math.PI/2,k_kj:4.75}],
      nonbonded,
      exceptions:[zero(0,1),zero(0,2),
        {i:0,j:3,chargeprod_e2:-0.05,sigma_nm:0.31,epsilon_kj:0.4},
        zero(1,2),zero(1,3),zero(2,3)],
    },
  };
  return buildParameterizedSystem(molecule, parameterization, {
    implicitSolvent: implicit ? obc2Parameters(molecule, parameterization.system) : null,
  });
}


function constrainedWaterCase(){
  const molecule = {
    atoms:[
      {element:'O',x:0,y:0,z:0},
      {element:'H',x:0.75695,y:0.58588,z:0},
      {element:'H',x:-0.75695,y:0.58588,z:0},
    ],
    bonds:[{a:0,b:1,order:1},{a:0,b:2,order:1}],
  };
  const zero = (i,j) => ({i,j,chargeprod_e2:0,sigma_nm:1,epsilon_kj:0});
  const parameterization = {
    forcefield:'Constrained TIP3P-like validation', chargeModel:'TIP3P charges',
    system:{
      particles:[{mass_amu:15.9994},{mass_amu:1.008},{mass_amu:1.008}],
      constraints:[{i:0,j:1,distance_nm:0.09572},{i:0,j:2,distance_nm:0.09572}],
      bonds:[
        {i:0,j:1,r0_nm:0.09572,k_kj_nm2:376560},
        {i:0,j:2,r0_nm:0.09572,k_kj_nm2:376560},
      ],
      angles:[{i:1,j:0,k:2,theta0_rad:104.52*Math.PI/180,k_kj_rad2:460.24}],
      torsions:[],
      nonbonded:[
        {charge_e:-0.834,sigma_nm:0.31507,epsilon_kj:0.6365364},
        {charge_e:0.417,sigma_nm:0.04,epsilon_kj:0.192464},
        {charge_e:0.417,sigma_nm:0.04,epsilon_kj:0.192464},
      ],
      exceptions:[zero(0,1),zero(0,2),zero(1,2)],
    },
  };
  return buildParameterizedSystem(molecule, parameterization, {dt:0.002});
}

await compareCase('OPLS-like united-atom C16', buildAlkane(16), 71);
await compareCase('flexible water 27', buildWater(3, mulberry32(72)), 73);
await compareCase('charged LJ dimer', buildDimer({ r: 4.2, q: 0.5 }), 74);
await compareCase('general parameterized System', generalParameterizedCase(), 75);
await compareCase('general parameterized System OBC2/ACE', generalParameterizedCase(true), 76);

{
  console.log('\n=== constrained water dynamics · STORMM SHAKE/RATTLE vs OpenMM Reference CCMA');
  const topo = constrainedWaterCase();
  const engine = await createEngine(device, topo, 1, {
    T:300, thermo:1, gamma:1, seed:20260816, initSeed:20260816,
    randomizeCoordinates:false, coordinateJitter:0,
    constraintTolerance:1e-5, constraintIterations:32,
  });
  engine.run(500); await engine.done();
  const stormmPositions = await engine.readPositions(0);
  const stormmStatus = await engine.readConstraintStatus();
  const stormmError = maximumConstraintError(topo, stormmPositions, true);
  const initial = Float64Array.from(topo.coords);
  initializeReference(topo, initial, 'total', false);
  requireOpenMMSuccess(openmm._molarium_step(500, 300));
  const referencePositions = readReferencePositions(topo.nAtoms);
  const referenceError = maximumConstraintError(topo, referencePositions, false);
  const constraintOk = stormmStatus.converged && stormmError < 2e-5 && referenceError < 2e-5;
  check('500-step constrained distances', constraintOk,
    `STORMM ${stormmError.toExponential(2)} · OpenMM ${referenceError.toExponential(2)}`);
  results.push({
    name:'constrained water dynamics', atoms:topo.nAtoms, steps:500, timestepFs:2,
    constraints:topo.counts.nConstraints,
    stormmMaximumRelativeDistanceError:stormmError,
    stormmMaximumCombinedResidual:stormmStatus.maximumResidual,
    openmmMaximumRelativeDistanceError:referenceError,
    passed:constraintOk,
  });
  openmm._molarium_destroy();
  engine.destroy();
}

const benchmarks = [];
async function benchmarkCase(name, topo, replicas, webgpuSteps, initSeed){
  const engine = await createEngine(device, topo, replicas,
    { T: 300, thermo: 1, gamma: 1.0, seed: 700 + initSeed, initSeed });
  await engine.done();
  try {
    const pos4 = await engine.readPositions(0);
    const positions = Float64Array.from({ length: topo.nAtoms * 3 }, (_, index) => {
      const atom = Math.floor(index / 3), axis = index % 3;
      return pos4[atom * 4 + axis];
    });
    initializeReference(topo, positions, 'total');
    engine.run(10); await engine.done();
    requireOpenMMSuccess(openmm._molarium_step(10, 300));

    const totalReplicaSteps = replicas * webgpuSteps;
    const webgpuSamplesMs = [], openmmSamplesMs = [];
    for (let repeat = 0; repeat < 3; repeat++) {
      const gpuStart = performance.now();
      engine.run(webgpuSteps); await engine.done();
      webgpuSamplesMs.push(performance.now() - gpuStart);
      const referenceStart = performance.now();
      requireOpenMMSuccess(openmm._molarium_step(totalReplicaSteps, 300));
      openmmSamplesMs.push(performance.now() - referenceStart);
    }
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const webgpuMs = median(webgpuSamplesMs), openmmMs = median(openmmSamplesMs);
    const result = {
      name, atoms: topo.nAtoms, replicas, webgpuSteps, totalReplicaSteps,
      samples: 3, webgpuSamplesMs, openmmSamplesMs, webgpuMs, openmmReferenceMs: openmmMs,
      webgpuReplicaStepsPerSecond: totalReplicaSteps / (webgpuMs / 1000),
      openmmReferenceStepsPerSecond: totalReplicaSteps / (openmmMs / 1000),
      speedup: openmmMs / webgpuMs,
    };
    benchmarks.push(result);
    console.log(`  ${name.padEnd(34)} WebGPU ${webgpuMs.toFixed(2)} ms · OpenMM ${openmmMs.toFixed(2)} ms · ${result.speedup.toFixed(2)}x`);
  } finally {
    openmm._molarium_destroy();
    engine.destroy();
  }
}

if (process.argv.includes('--benchmark')) {
  console.log('\n=== steady-state dynamics throughput (equal aggregate replica-steps)');
  await benchmarkCase('C16 single system', buildAlkane(16), 1, 2000, 81);
  await benchmarkCase('C16 stack of 1024', buildAlkane(16), 1024, 100, 82);
  await benchmarkCase('water27 single system', buildWater(3, mulberry32(83)), 1, 500, 84);
  await benchmarkCase('water27 stack of 256', buildWater(3, mulberry32(85)), 256, 50, 86);
}

const summary = {
  openmmVersion: openmm.UTF8ToString(openmm._molarium_openmm_version()),
  platform: 'Reference (hard-coded by Molarium OpenMM bridge)',
  webgpuAdapter: adapter.info ?? null,
  tolerances: { energyRelative: ENERGY_REL_TOL, energyAbsoluteKcal: ENERGY_ABS_TOL, forceRelativeRms: FORCE_REL_RMS_TOL },
  passed,
  results,
  benchmarks,
};
console.log(`\n${passed ? 'ALL OPENMM REFERENCE COMPARISONS PASS' : 'OPENMM REFERENCE COMPARISON FAILED'}`);
console.log(`SUMMARY_JSON ${JSON.stringify(summary)}`);
openmm._molarium_destroy();
device.destroy?.();
process.exit(passed ? 0 : 1); // Dawn's Node binding can fault during implicit process teardown.
