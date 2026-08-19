// stormm-webgpu v0.3 engine: buffers, pipelines, step encoding. DOM-free (Node + browser).
import {
  SHADER, GSCALE, NUMERIC_FAULT_NAN, NUMERIC_FAULT_CLAMPED,
  CONSTRAINT_FAULT_POSITION, CONSTRAINT_FAULT_VELOCITY,
  CONSTRAINT_FAULT_GEOMETRY, CONSTRAINT_RESIDUAL_SCALE,
  initReplicas, decodeAcc, decodeForces, mulberry32,
} from './core.mjs';

const CHUNK = 50;   // max MD steps per command-buffer submit (keeps buffers small, UI responsive)

function requireFiniteArray(label, values, expectedLength){
  if (!values || values.length !== expectedLength)
    throw new TypeError(`${label} must contain exactly ${expectedLength} values`);
  for (let i = 0; i < values.length; i++)
    if (!Number.isFinite(values[i])) throw new TypeError(`${label}[${i}] is not finite`);
}

function validateTopology(topo){
  if (!topo || !Number.isInteger(topo.nAtoms) || topo.nAtoms < 1)
    throw new TypeError('Topology must contain a positive integer atom count');
  const n = topo.nAtoms;
  requireFiniteArray('Topology properties', topo.props, n * 4);
  requireFiniteArray('Topology coordinates', topo.coords, n * 3);
  for (let atom = 0; atom < n; atom++) {
    const sigma = topo.props[atom * 4];
    const epsilon = topo.props[atom * 4 + 1];
    const mass = topo.props[atom * 4 + 3];
    if (sigma < 0 || epsilon < 0 || !(mass > 0))
      throw new RangeError(`Atom ${atom} has invalid sigma, epsilon, or mass`);
  }
  const exclusionWords = Math.ceil(n / 32);
  if (topo.exclW !== exclusionWords || !(topo.excl instanceof Uint32Array) ||
      topo.excl.length !== n * exclusionWords)
    throw new RangeError(`Topology exclusion mask must use ${exclusionWords} words per atom`);
  if (!(topo.dt > 0) || !Number.isFinite(topo.dt))
    throw new RangeError('Topology time step must be finite and positive');
  if (!(topo.tu instanceof Uint32Array) || !(topo.tf instanceof Float32Array) ||
      !topo.counts || !topo.offs)
    throw new TypeError('Topology must be packed before creating an engine');
  for (let i = 0; i < topo.tf.length; i++)
    if (!Number.isFinite(topo.tf[i])) throw new TypeError(`Packed topology float data[${i}] is not finite`);
  if (topo.implicitSolvent) {
    if (topo.implicitSolvent !== 'OBC2')
      throw new Error(`Unsupported STORMM implicit solvent: ${topo.implicitSolvent}`);
    requireFiniteArray('OBC2 parameters', topo.obc, n * 2);
    for (let atom = 0; atom < n; atom++)
      if (!(topo.obc[atom * 2] > 0.09) || !(topo.obc[atom * 2 + 1] > 0))
        throw new RangeError(`Atom ${atom} has an invalid OBC2 radius or scale`);
  }
  if (!Number.isInteger(topo.offs.oExcl) || topo.offs.oExcl < 0 || topo.offs.oExcl > topo.tu.length)
    throw new RangeError('Packed topology exclusion offset is invalid');
  for (let i = 0; i < topo.offs.oExcl; i++)
    if (topo.tu[i] >= n) throw new RangeError(`Packed topology atom index ${topo.tu[i]} is out of range`);
  const constraintCount = topo.counts.nConstraints ?? 0;
  if (!Number.isInteger(constraintCount) || constraintCount < 0 ||
      !Number.isInteger(topo.offs.oConstraintI) ||
      !Number.isInteger(topo.offs.oConstraintP))
    throw new RangeError('Packed constraint metadata is invalid');
  if (topo.offs.oConstraintI + 2*constraintCount > topo.tu.length ||
      topo.offs.oConstraintP + constraintCount > topo.tf.length)
    throw new RangeError('Packed constraint arrays exceed the topology buffers');
  for (let constraint = 0; constraint < constraintCount; constraint++) {
    const i = topo.tu[topo.offs.oConstraintI + 2*constraint];
    const j = topo.tu[topo.offs.oConstraintI + 2*constraint + 1];
    const distance = topo.tf[topo.offs.oConstraintP + constraint];
    if (i >= n || j >= n || i === j || !(distance > 0) || !Number.isFinite(distance))
      throw new RangeError(`Constraint ${constraint} is invalid`);
  }
}

function requireReplica(rep, nReps){
  if (!Number.isInteger(rep) || rep < 0 || rep >= nReps)
    throw new RangeError(`Replica index must be between 0 and ${nReps - 1}`);
}

export async function createEngine(device, topo, nReps,
    { T = 300, thermo = 0, gamma = 2.0, seed = 12345, initSeed = null,
      randomizeCoordinates = true, coordinateJitter = 0.02,
      initialPositions = null,
      constraintTolerance = 1e-5, constraintIterations = 32 } = {}){
  if (!device?.createBuffer) throw new TypeError('A WebGPU device is required');
  validateTopology(topo);
  if (!Number.isInteger(nReps) || nReps < 1)
    throw new RangeError('Replica count must be a positive integer');
  if (nReps > device.limits.maxComputeWorkgroupsPerDimension)
    throw new RangeError('Replica count exceeds the WebGPU dispatch limit');
  if (!Number.isFinite(T) || T < 0 || !Number.isFinite(gamma) || gamma < 0)
    throw new RangeError('Temperature and collision rate must be finite and non-negative');
  if (thermo !== 0 && thermo !== 1) throw new RangeError('Thermostat selector must be 0 or 1');
  if (!Number.isFinite(constraintTolerance) || constraintTolerance <= 0 || constraintTolerance > 0.01)
    throw new RangeError('Constraint tolerance must be finite and in (0, 0.01]');
  if (!Number.isInteger(constraintIterations) || constraintIterations < 1 || constraintIterations > 256)
    throw new RangeError('Constraint iterations must be an integer between 1 and 256');
  const n = topo.nAtoms;
  const rng = initSeed === null ? Math.random : mulberry32(initSeed);
  const { pos, vel } = initReplicas(topo, nReps, T, rng,
    { randomizeCoordinates, coordinateJitter, initialPositions });
  const mk = (size, usage) => device.createBuffer({ size: Math.max(size, 16), usage });
  const B = {
    pos: mk(nReps*n*16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC),
    vel: mk(nReps*n*16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC),
    frc: mk(nReps*n*24, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST),
    // The final 16 bytes hold step and numeric-status words, avoiding a ninth
    // buffer binding on minimum-spec WebGPU adapters.
    acc: mk(nReps*64 + 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST),
    tu:  mk(topo.tu.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
    tf:  mk(topo.tf.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
    fix: mk(nReps*n*24, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
    uni: mk(128, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    stE: mk(nReps*64, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST),
    // Large enough for a whole synthesis snapshot. readPositions() maps only the
    // requested prefix; readAllPositions() performs one bulk replica readback.
    stP: mk(nReps*n*16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST),
    stF: mk(n*24, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST),
    stC: mk(16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST),
  };
  device.queue.writeBuffer(B.pos, 0, pos);
  device.queue.writeBuffer(B.vel, 0, vel);
  device.queue.writeBuffer(B.tu, 0, topo.tu);
  device.queue.writeBuffer(B.tf, 0, topo.tf);
  // int64 fixed-point coordinates (lo,hi u32 pairs), exact from the f32 initial positions
  const fix = new Uint32Array(nReps*n*6);
  for (let i = 0; i < nReps*n; i++) for (let c = 0; c < 3; c++){
    const v = BigInt.asUintN(64, BigInt(Math.round(pos[i*4+c] * GSCALE)));
    fix[(i*3+c)*2]   = Number(v & 0xFFFFFFFFn);
    fix[(i*3+c)*2+1] = Number(v >> 32n);
  }
  device.queue.writeBuffer(B.fix, 0, fix);
  const c = topo.counts, o = topo.offs;
  const uni = new ArrayBuffer(128), U = new Uint32Array(uni), F = new Float32Array(uni);
  U.set([n, nReps, c.nBonds, c.nAngles, c.nDih, c.nPairs, thermo, seed,
         o.oBondI, o.oAngleI, o.oDihI, o.oPairI, o.oExcl,
         o.oBondP, o.oAngleP, o.oDihP, o.oPairP, o.oProps], 0);
  F[18] = topo.dt; F[19] = gamma; F[20] = 0.0019872 * T; U[21] = topo.exclW;
  U[22] = topo.implicitSolvent === 'OBC2' ? 1 : 0; U[23] = o.oObc;
  F[24] = topo.coulombConstant ?? 332.0636;
  const solventDielectric = topo.implicitSolventDielectric ?? 78.3;
  const surfaceAreaFactor = topo.implicitSurfaceAreaFactor ?? 0.0678584013;
  if (!Number.isFinite(solventDielectric) || solventDielectric <= 1)
    throw new RangeError('Implicit-solvent dielectric must be finite and greater than one');
  if (!Number.isFinite(surfaceAreaFactor) || surfaceAreaFactor < 0)
    throw new RangeError('Implicit-solvent surface-area factor must be finite and non-negative');
  F[25] = 1 - 1 / solventDielectric;
  F[26] = surfaceAreaFactor;
  U[27] = c.nConstraints ?? 0;
  U[28] = o.oConstraintI;
  U[29] = o.oConstraintP;
  U[30] = constraintIterations;
  F[31] = constraintTolerance;
  device.queue.writeBuffer(B.uni, 0, uni);

  const mod = device.createShaderModule({ code: SHADER });
  const info = await mod.getCompilationInfo();
  const errs = info.messages.filter(m => m.type === 'error');
  if (errs.length) throw new Error('WGSL: ' + errs.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
  const st = t => ({ binding:0, visibility: GPUShaderStage.COMPUTE, buffer:{ type:t } });
  const bgl = device.createBindGroupLayout({ entries: [
    { ...st('uniform'), binding:0 }, { ...st('storage'), binding:1 }, { ...st('storage'), binding:2 },
    { ...st('storage'), binding:3 }, { ...st('storage'), binding:4 },
    { ...st('read-only-storage'), binding:5 }, { ...st('read-only-storage'), binding:6 },
    { ...st('storage'), binding:7 },
  ]});
  const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
  const pipe = {}, names = ['bornRadii', 'bornDerivatives', 'implicit', 'valence', 'nonbond',
    'kickDrift', 'steepestDescent', 'shakePositions', 'kickKE', 'rattleVelocities', 'tick'];
  for (const nm of names) pipe[nm] = device.createComputePipeline({ layout, compute:{ module: mod, entryPoint: nm } });
  const bind = device.createBindGroup({ layout: bgl, entries: [
    { binding:0, resource:{ buffer:B.uni } }, { binding:1, resource:{ buffer:B.pos } },
    { binding:2, resource:{ buffer:B.vel } }, { binding:3, resource:{ buffer:B.frc } },
    { binding:4, resource:{ buffer:B.acc } }, { binding:5, resource:{ buffer:B.tu } },
    { binding:6, resource:{ buffer:B.tf } },  { binding:7, resource:{ buffer:B.fix } },
  ]});

  function encodeForces(enc){
    enc.clearBuffer(B.frc);
    const pass = enc.beginComputePass();
    if (topo.implicitSolvent === 'OBC2') {
      pass.setPipeline(pipe.bornRadii);       pass.setBindGroup(0, bind); pass.dispatchWorkgroups(nReps);
      pass.setPipeline(pipe.bornDerivatives); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(nReps);
    }
    pass.setPipeline(pipe.valence);  pass.setBindGroup(0, bind);  pass.dispatchWorkgroups(nReps);
    pass.setPipeline(pipe.nonbond);  pass.setBindGroup(0, bind);  pass.dispatchWorkgroups(nReps);
    if (topo.implicitSolvent === 'OBC2') {
      pass.setPipeline(pipe.implicit); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(nReps);
    }
    pass.end();
  }
  function encodeStep(enc, withIntegrate = true){
    enc.clearBuffer(B.acc, 0, nReps*64);
    if (withIntegrate){                          // velocity Verlet: B(half) A | forces | B(half)
      const pa = enc.beginComputePass();
      pa.setPipeline(pipe.kickDrift); pa.setBindGroup(0, bind); pa.dispatchWorkgroups(nReps);
      if (c.nConstraints) {
        pa.setPipeline(pipe.shakePositions); pa.setBindGroup(0, bind); pa.dispatchWorkgroups(nReps);
      }
      pa.end();
    }
    encodeForces(enc);
    if (withIntegrate){
      const pc = enc.beginComputePass();
      pc.setPipeline(pipe.kickKE); pc.setBindGroup(0, bind); pc.dispatchWorkgroups(nReps);
      if (c.nConstraints) {
        pc.setPipeline(pipe.rattleVelocities); pc.setBindGroup(0, bind); pc.dispatchWorkgroups(nReps);
      }
      pc.setPipeline(pipe.tick);   pc.setBindGroup(0, bind); pc.dispatchWorkgroups(1);
      pc.end();
    }
  }
  const run = (steps) => {                       // chunked submits: bounded command buffers
    if (!Number.isSafeInteger(steps) || steps < 0)
      throw new RangeError('MD step count must be a non-negative safe integer');
    while (steps > 0){
      const k = Math.min(steps, CHUNK); steps -= k;
      const enc = device.createCommandEncoder();
      for (let i = 0; i < k; i++) encodeStep(enc);
      device.queue.submit([enc.finish()]);
    }
  };
  const forceOnly = () => {
    const enc = device.createCommandEncoder();
    encodeStep(enc, false);
    device.queue.submit([enc.finish()]);
  };
  const setDynamics = ({ temperature = T, collisionRate = gamma } = {}) => {
    if (!Number.isFinite(temperature) || temperature < 0)
      throw new RangeError('Temperature must be finite and non-negative');
    if (!Number.isFinite(collisionRate) || collisionRate < 0)
      throw new RangeError('Collision rate must be finite and non-negative');
    device.queue.writeBuffer(B.uni, 19 * 4,
      new Float32Array([collisionRate, 0.0019872 * temperature]));
  };
  const relax = (iterations, { stepScale = 1e-4, maximumDisplacement = 0.01 } = {}) => {
    if (!Number.isSafeInteger(iterations) || iterations < 0)
      throw new RangeError('Minimization iteration count must be a non-negative safe integer');
    if (!Number.isFinite(stepScale) || stepScale <= 0
      || !Number.isFinite(maximumDisplacement) || maximumDisplacement <= 0)
      throw new RangeError('Minimizer scale and displacement cap must be finite and positive');
    device.queue.writeBuffer(B.uni, 19 * 4,
      new Float32Array([stepScale, maximumDisplacement]));
    let remaining = iterations;
    while (remaining > 0) {
      const count = Math.min(remaining, CHUNK); remaining -= count;
      const enc = device.createCommandEncoder();
      for (let iteration = 0; iteration < count; iteration++) {
        enc.clearBuffer(B.acc, 0, nReps*64);
        encodeForces(enc);
        const pass = enc.beginComputePass();
        pass.setPipeline(pipe.steepestDescent); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(nReps);
        if (c.nConstraints) {
          pass.setPipeline(pipe.shakePositions); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(nReps);
        }
        pass.end();
      }
      device.queue.submit([enc.finish()]);
    }
    forceOnly();
  };
  async function readMap(src, srcOff, st, bytes, Ctor){
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(src, srcOff, st, 0, bytes);
    device.queue.submit([enc.finish()]);
    await st.mapAsync(GPUMapMode.READ, 0, bytes);
    const out = new Ctor(st.getMappedRange(0, bytes).slice(0));
    st.unmap();
    return out;
  }
  async function readStatus(){
    const words = await readMap(B.acc, nReps*64, B.stC, 16, Uint32Array);
    return { step: words[0], numericFlags: words[1] };
  }
  async function readConstraintStatus(){
    if (!c.nConstraints) return {
      constraintCount: 0, tolerance: constraintTolerance, iterations: constraintIterations,
      maximumResidual: 0, replicas: [], converged: true,
    };
    const words = await readMap(B.acc, 0, B.stE, nReps*64, Uint32Array);
    const replicas = [];
    let maximumResidual = 0;
    for (let replica = 0; replica < nReps; replica++) {
      const flags = words[replica*16 + 14];
      const residual = words[replica*16 + 15] / CONSTRAINT_RESIDUAL_SCALE;
      maximumResidual = Math.max(maximumResidual, residual);
      if (flags) replicas.push({ replica, flags, residual });
    }
    return {
      constraintCount: c.nConstraints, tolerance: constraintTolerance,
      iterations: constraintIterations, maximumResidual, replicas,
      converged: replicas.length === 0,
    };
  }
  async function assertHealthy(){
    const status = await readStatus();
    if (status.numericFlags) {
      const reasons = [];
      if (status.numericFlags & NUMERIC_FAULT_NAN) reasons.push('NaN encountered');
      if (status.numericFlags & NUMERIC_FAULT_CLAMPED) reasons.push('fixed-point contribution clamped');
      throw new Error(`WebGPU numerical fault at step ${status.step}: ${reasons.join(', ')}`);
    }
    const constraints = await readConstraintStatus();
    if (!constraints.converged) {
      const descriptions = constraints.replicas.map(({ replica, flags, residual }) => {
        const phases = [];
        if (flags & CONSTRAINT_FAULT_POSITION) phases.push('SHAKE');
        if (flags & CONSTRAINT_FAULT_VELOCITY) phases.push('RATTLE');
        if (flags & CONSTRAINT_FAULT_GEOMETRY) phases.push('degenerate geometry');
        return `replica ${replica + 1} ${phases.join('/')} residual ${residual.toExponential(3)}`;
      });
      throw new Error(`STORMM constraints did not converge at step ${status.step} after ${constraintIterations} iterations: ${descriptions.join('; ')}`);
    }
    return { ...status, constraints };
  }
  if (c.nConstraints) {
    // Project generated/jittered starting coordinates before they are exposed
    // as frame zero, then remove radial constraint velocity components.
    const enc = device.createCommandEncoder();
    enc.clearBuffer(B.acc, 0, nReps*64);
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe.shakePositions); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(nReps);
    pass.setPipeline(pipe.rattleVelocities); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(nReps);
    pass.end();
    device.queue.submit([enc.finish()]);
  }
  forceOnly();                                   // prime f(x0) for the first half-kick
  return {
    B, topo, nReps, run, relax, forceOnly, encodeStep, setDynamics,
    readEnergies: async () => {
      const values = decodeAcc(await readMap(B.acc, 0, B.stE, nReps*64, Uint32Array), nReps);
      await assertHealthy();
      return values;
    },
    readPositions: async (rep) => {
      requireReplica(rep, nReps);
      const values = await readMap(B.pos, rep*n*16, B.stP, n*16, Float32Array);
      await assertHealthy();
      return values;
    },
    readAllPositions: async () => {
      const values = await readMap(B.pos, 0, B.stP, nReps*n*16, Float32Array);
      await assertHealthy();
      return values;
    },
    readVelocities: async (rep) => {
      requireReplica(rep, nReps);
      const values = await readMap(B.vel, rep*n*16, B.stP, n*16, Float32Array);
      await assertHealthy();
      return values;
    },
    readForces: async (rep) => {
      requireReplica(rep, nReps);
      const values = decodeForces(await readMap(B.frc, rep*n*24, B.stF, n*24, Uint32Array));
      await assertHealthy();
      return values;
    },
    readStatus, readConstraintStatus, assertHealthy,
    done: () => device.queue.onSubmittedWorkDone(),
    destroy: () => { for (const b of Object.values(B)) b.destroy?.(); },
  };
}
