/* OpenFF SMIRNOFF System + direct WebGPU evaluation.
 * This is not an OpenMM Platform: the same numeric Sage or Rosemary System
 * used by the OpenMM worker is packed into WGSL buffers and evaluated here. */

self.importScripts('./rdkit/dist/RDKit_minimal.js');

const WORKGROUP_SIZE = 64;
const BOLTZ = 0.00831446261815324;
const KJ_TO_KCAL = 1 / 4.184;
const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

let webgpuPromise;
let rdkitPromise;
let parameterizerPromise;
let implicitSolventPromise;
let simulationOptionsPromise;
let uncapturedError;

function progress(id, phase, model, calculation) {
  self.postMessage({ type: 'progress', id, phase, model, calculation });
}

function getRDKit(id) {
  if (!rdkitPromise) {
    progress(id, 'Loading RDKit chemical perception…', 0.08, 0);
    rdkitPromise = self.initRDKitModule({
      locateFile: (file) => new URL(`./rdkit/dist/${file}`, self.location.href).href,
    }).catch((error) => {
      rdkitPromise = null;
      throw error;
    });
  }
  return rdkitPromise;
}

function getParameterizer() {
  parameterizerPromise ??= import('./openff/sage-parameterizer.js').catch((error) => {
    parameterizerPromise = null;
    throw error;
  });
  return parameterizerPromise;
}

function getImplicitSolvent() {
  implicitSolventPromise ??= import('./openff/implicit-solvent.js').catch((error) => {
    implicitSolventPromise = null;
    throw error;
  });
  return implicitSolventPromise;
}

function getSimulationOptions() {
  simulationOptionsPromise ??= import('./openff/simulation-options.js').catch((error) => {
    simulationOptionsPromise = null;
    throw error;
  });
  return simulationOptionsPromise;
}

async function parameterizeMolecule(id, molecule) {
  if (molecule.parameterization?.system) {
    progress(id, `Loading ${molecule.parameterization.forcefield} parameters…`, 0.9, 0.03);
    return molecule.parameterization;
  }
  const [rdkit, { parameterizeSage }] = await Promise.all([getRDKit(id), getParameterizer()]);
  progress(id, 'Assigning OpenFF Sage 2.1 parameters…', 0.45, 0.03);
  return parameterizeSage(rdkit, molecule);
}

function pack(rows, stride, fill) {
  const values = new Float32Array(Math.max(rows.length, 1) * stride);
  const integers = new Uint32Array(values.buffer);
  rows.forEach((row, index) => fill(row, integers, values, index * stride));
  return values;
}

function seededGaussian(seed) {
  let state = seed >>> 0;
  const uniform = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
  let spare;
  return () => {
    if (spare !== undefined) { const value = spare; spare = undefined; return value; }
    const radius = Math.sqrt(-2 * Math.log(Math.max(uniform(), 1e-12)));
    const angle = 2 * Math.PI * uniform();
    spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  };
}

function packSmirnoffModel(molecule, system, temperature, forcefield, implicitSolvent = null,
  movableAtomIndices = null) {
  const count = molecule.atoms.length;
  if (!count) throw new Error('The molecule has no atoms');
  if (system.nonbonded.length !== count)
    throw new Error(`${forcefield} has ${system.nonbonded.length} nonbonded particles for ${count} atoms`);

  const bonds = system.bonds.map((term) => [term.i, term.j, term.r0_nm, term.k_kj_nm2]);
  const angles = system.angles.map((term) => [term.i, term.j, term.k, term.theta0_rad, term.k_kj_rad2]);
  const torsions = system.torsions.map((term) => [
    term.i, term.j, term.k, term.l, term.k_kj, term.periodicity, term.phase_rad,
  ]);
  // Force accumulation is deterministic and does not rely on unavailable f32
  // atomics.  Give each atom the exact valence terms that touch it so one GPU
  // invocation can accumulate its complete xyz force without rescanning every
  // term in the System for every Cartesian component.
  const incident = Array.from({ length: count }, () => []);
  bonds.forEach((term, index) => {
    incident[term[0]].push(index);
    incident[term[1]].push(index);
  });
  angles.forEach((term, index) => {
    const encoded = 0x40000000 | index;
    incident[term[0]].push(encoded);
    incident[term[1]].push(encoded);
    incident[term[2]].push(encoded);
  });
  torsions.forEach((term, index) => {
    const encoded = 0x80000000 | index;
    incident[term[0]].push(encoded);
    incident[term[1]].push(encoded);
    incident[term[2]].push(encoded);
    incident[term[3]].push(encoded);
  });
  const incidentCount = incident.reduce((sum, terms) => sum + terms.length, 0);
  const incidence = new Uint32Array(count + 1 + incidentCount);
  let incidentOffset = 0;
  incident.forEach((terms, atom) => {
    incidence[atom] = incidentOffset;
    incidence.set(terms, count + 1 + incidentOffset);
    incidentOffset += terms.length;
  });
  incidence[count] = incidentOffset;

  // Store O(N) particle parameters and sparse, directed exception rows.  The
  // shader mixes ordinary pairs on demand and linearly merges each sorted
  // exception row for exclusions and scaled 1-4 interactions.  This
  // replaces the previous 32*N*N byte pair matrix.
  const nonbonded = pack(system.nonbonded, 8, (term, _u32, f32, offset) => {
    const values = [term.charge_e, term.sigma_nm, term.epsilon_kj];
    if (!values.every(Number.isFinite))
      throw new Error(`${forcefield} contains invalid nonbonded parameters at atom ${offset / 8 + 1}`);
    f32[offset] = values[0]; f32[offset + 1] = values[1]; f32[offset + 2] = values[2];
    if (implicitSolvent) {
      const particle = implicitSolvent.particles[offset / 8];
      f32[offset + 3] = particle.radius_nm;
      f32[offset + 4] = particle.scale;
    }
  });
  const exceptionRows = Array.from({ length: count }, () => []);
  system.exceptions.forEach((term, index) => {
    const first = Number(term.i), second = Number(term.j);
    const values = [term.chargeprod_e2, term.sigma_nm, term.epsilon_kj].map(Number);
    if (!Number.isInteger(first) || !Number.isInteger(second)
        || first < 0 || second < 0 || first >= count || second >= count || first === second)
      throw new Error(`${forcefield} contains an invalid nonbonded exception at index ${index}`);
    if (!values.every(Number.isFinite))
      throw new Error(`${forcefield} contains invalid nonbonded exception parameters for atoms ${first + 1} and ${second + 1}`);
    exceptionRows[first].push([second, ...values]);
    exceptionRows[second].push([first, ...values]);
  });
  exceptionRows.forEach((row, atom) => {
    row.sort((first, second) => first[0] - second[0]);
    for (let index = 1; index < row.length; index++) {
      if (row[index - 1][0] === row[index][0])
        throw new Error(`${forcefield} contains duplicate nonbonded exceptions for atoms ${atom + 1} and ${row[index][0] + 1}`);
    }
  });
  const directedExceptionCount = exceptionRows.reduce((sum, row) => sum + row.length, 0);
  const exceptionWords = new Uint32Array(count + 1 + directedExceptionCount * 4);
  const exceptionFloats = new Float32Array(exceptionWords.buffer);
  let exceptionOffset = 0;
  exceptionRows.forEach((row, atom) => {
    exceptionWords[atom] = exceptionOffset;
    row.forEach((entry) => {
      const base = count + 1 + exceptionOffset * 4;
      exceptionWords[base] = entry[0];
      exceptionFloats[base + 1] = entry[1];
      exceptionFloats[base + 2] = entry[2];
      exceptionFloats[base + 3] = entry[3];
      exceptionOffset += 1;
    });
  });
  exceptionWords[count] = exceptionOffset;

  const posm = new Float32Array(count * 4);
  const velocity = new Float32Array(count * 4);
  const gaussian = seededGaussian(20260816);
  const movable = Array.isArray(movableAtomIndices) || ArrayBuffer.isView(movableAtomIndices)
    ? new Set(Array.from(movableAtomIndices, Number)) : null;
  if (movable && (!movable.size || [...movable].some((index) =>
    !Number.isInteger(index) || index < 0 || index >= count)))
    throw new Error('The WebGPU movable-atom selection is empty or contains an invalid atom index');
  let totalMass = 0;
  const momentum = [0, 0, 0];
  molecule.atoms.forEach((atom, index) => {
    const mass = Number(system.particles[index]?.mass_amu);
    if (!(mass > 0)) throw new Error(`${forcefield} contains an invalid mass for atom ${index + 1}`);
    const isMovable = !movable || movable.has(index);
    posm.set([Number(atom.x) * 0.1, Number(atom.y) * 0.1, Number(atom.z) * 0.1,
      isMovable ? 1 / mass : 0], index * 4);
    if (!isMovable) return;
    const sigma = Math.sqrt(BOLTZ * temperature / mass);
    for (let axis = 0; axis < 3; axis++) {
      const value = sigma * gaussian();
      velocity[index * 4 + axis] = value;
      momentum[axis] += mass * value;
    }
    totalMass += mass;
  });
  for (let atom = 0; atom < count; atom++) {
    if (posm[atom * 4 + 3] <= 0) continue;
    for (let axis = 0; axis < 3; axis++) velocity[atom * 4 + axis] -= momentum[axis] / totalMass;
  }

  // Greedy edge coloring makes every constraint within a color atom-disjoint.
  // The shader can therefore solve a complete color in parallel without f32
  // atomics, then place a storage barrier between colors.
  const atomConstraintColors = Array.from({ length: count }, () => new Set());
  const constraintRows = (system.constraints || []).map((term) => {
    let color = 0;
    while (atomConstraintColors[term.i].has(color) || atomConstraintColors[term.j].has(color)) color++;
    atomConstraintColors[term.i].add(color);
    atomConstraintColors[term.j].add(color);
    return [term.i, term.j, term.distance_nm, color];
  });
  const constraintColorCount = constraintRows.reduce((maximum, row) => Math.max(maximum, row[3] + 1), 0);

  return {
    count, posm, velocity, implicitSolvent: Boolean(implicitSolvent),
    movableAtomCount:movable?.size || count,
    bonds: pack(bonds, 4, (row, u32, f32, offset) => {
      u32[offset] = row[0]; u32[offset + 1] = row[1];
      f32[offset + 2] = row[2]; f32[offset + 3] = row[3];
    }),
    angles: pack(angles, 8, (row, u32, f32, offset) => {
      u32[offset] = row[0]; u32[offset + 1] = row[1]; u32[offset + 2] = row[2];
      f32[offset + 4] = row[3]; f32[offset + 5] = row[4];
    }),
    torsions: pack(torsions, 8, (row, u32, f32, offset) => {
      u32[offset] = row[0]; u32[offset + 1] = row[1];
      u32[offset + 2] = row[2]; u32[offset + 3] = row[3];
      f32[offset + 4] = row[4]; f32[offset + 5] = row[5]; f32[offset + 6] = row[6];
    }),
    nonbonded, exceptions: exceptionWords, incidence,
    constraints: pack(constraintRows, 4, (term, u32, f32, offset) => {
      u32[offset] = term[0]; u32[offset + 1] = term[1];
      f32[offset + 2] = term[2]; u32[offset + 3] = term[3];
    }),
    sizes: {
      bonds: bonds.length, angles: angles.length, torsions: torsions.length,
      exceptions: system.exceptions.length,
      constraints: (system.constraints || []).length,
      constraintColors: constraintColorCount,
    },
  };
}

function createBuffer(device, data, usage = STORAGE, label = 'WebGPU data') {
  const size = Math.max(16, data.byteLength);
  const maximum = (usage & GPUBufferUsage.STORAGE)
    ? Math.min(device.limits.maxBufferSize, device.limits.maxStorageBufferBindingSize)
    : device.limits.maxBufferSize;
  if (size > maximum)
    throw new Error(`${label} requires ${(size / 1048576).toFixed(1)} MiB, above this adapter's ${(maximum / 1048576).toFixed(1)} MiB buffer limit`);
  const buffer = device.createBuffer({ size, usage, label });
  if (data.byteLength) device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

async function initializeWebGPU(id) {
  if (!self.navigator?.gpu) throw new Error('WebGPU is not available in this browser');
  progress(id, 'Requesting a WebGPU adapter…', 0.1, 0);
  const adapter = await self.navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('The browser could not provide a WebGPU adapter');
  if (adapter.limits.maxStorageBuffersPerShaderStage < 9)
    throw new Error('This WebGPU adapter exposes fewer than the 9 storage buffers required by the Sage kernels');
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBuffersPerShaderStage: 9,
    },
  });
  device.addEventListener('uncapturederror', (event) => {
    uncapturedError ??= new Error(event.error?.message || String(event.error || 'Unknown WebGPU validation error'));
  });
  device.lost.then((info) => {
    uncapturedError = new Error(`The WebGPU device was lost: ${info.message || info.reason}`);
    webgpuPromise = null;
  });
  const response = await fetch('./webgpu/molarium-webgpu.wgsl');
  if (!response.ok) throw new Error(`The WebGPU shader could not be loaded (HTTP ${response.status})`);
  const shader = device.createShaderModule({ code: await response.text(), label: 'OpenFF Sage WebGPU kernels' });
  const compilation = await shader.getCompilationInfo();
  const errors = compilation.messages.filter((message) => message.type === 'error');
  if (errors.length) throw new Error(`WebGPU shader compilation failed: ${errors[0].message}`);
  const makePipeline = (entryPoint) => device.createComputePipelineAsync({
    layout: 'auto', compute: { module: shader, entryPoint }, label: `Sage WebGPU ${entryPoint}`,
  });
  const [energy, forces, integrate, minimize, born, bornDerivative, constraints, neighbors] = await Promise.all([
    makePipeline('computeEnergy'), makePipeline('computeForces'),
    makePipeline('integrateLangevin'), makePipeline('minimizeStep'),
    makePipeline('computeBornRadii'), makePipeline('computeBornDerivatives'),
    makePipeline('applyShakeRattle'),
    makePipeline('buildNeighborList'),
  ]);
  return { device, adapter, pipelines: {
    energy, forces, integrate, minimize, born, bornDerivative, constraints, neighbors,
  } };
}

function getWebGPU(id) {
  webgpuPromise ||= initializeWebGPU(id).catch((error) => { webgpuPromise = null; throw error; });
  return webgpuPromise;
}

function createSimulation(device, model, options) {
  const cutoffNm = Number(options.nonbondedCutoffNm ?? options.cutoffNm ?? 0);
  const maximumNeighbors = Math.max(1, Math.min(model.count - 1 || 1,
    Math.round(Number(options.maximumNeighbors ?? 1024))));
  const buffers = {
    params: device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    posm: createBuffer(device, model.posm, STORAGE, 'positions'),
    velocity: createBuffer(device, model.velocity, STORAGE, 'velocities'),
    bonds: createBuffer(device, model.bonds, STORAGE, 'bond terms'),
    angles: createBuffer(device, model.angles, STORAGE, 'angle terms'),
    torsions: createBuffer(device, model.torsions, STORAGE, 'torsion terms'),
    nonbonded: createBuffer(device, model.nonbonded, STORAGE, 'particle nonbonded parameters'),
    exceptions: createBuffer(device, model.exceptions, STORAGE, 'nonbonded exception CSR'),
    constraints: createBuffer(device, model.constraints, STORAGE, 'distance constraints'),
    neighbors: createBuffer(device,
      new Uint32Array(model.count + model.count * maximumNeighbors), STORAGE, 'Verlet neighbor list'),
    incidence: createBuffer(device, model.incidence, STORAGE, 'bonded incidence CSR'),
    forces: createBuffer(device, new Float32Array(model.count * 4), STORAGE, 'forces and Born intermediates'),
    output: createBuffer(device, new Float32Array(4), STORAGE, 'energy output'),
  };
  return {
    model, buffers, step: 0, neighborListBuilt: false,
    settings: {
      dt: Number(options.dt ?? 0.001), friction: Number(options.friction ?? 1),
      temperature: Number(options.temperature ?? 300), forceDelta: Number(options.forceDelta ?? 0.00005),
      minimizeRate: Number(options.minimizeRate ?? 0.00000035),
      maxDisplacement: Number(options.maxDisplacement ?? 0.001), seed: Number(options.seed ?? 20260816),
      implicitSolvent: model.implicitSolvent,
      constraintIterations: Math.max(1, Math.min(32, Math.round(Number(options.constraintIterations ?? 4)))),
      cutoffNm,
      neighborRadiusNm: cutoffNm > 0 ? cutoffNm + Math.max(0.05, Number(options.neighborSkinNm ?? 0.2)) : 0,
      maximumNeighbors,
      neighborRebuildInterval: Math.max(1, Math.round(Number(options.neighborRebuildInterval ?? 20))),
    },
  };
}

function writeParams(device, simulation) {
  const { model, settings } = simulation;
  const bytes = new ArrayBuffer(96), u32 = new Uint32Array(bytes), f32 = new Float32Array(bytes);
  u32[0] = model.count; u32[1] = model.sizes.bonds; u32[2] = model.sizes.angles;
  u32[3] = model.sizes.torsions; u32[4] = model.sizes.exceptions;
  u32[5] = simulation.step; u32[6] = settings.seed;
  u32[7] = settings.implicitSolvent ? 1 : 0;
  f32[8] = settings.dt; f32[9] = settings.friction; f32[10] = settings.temperature;
  f32[11] = settings.forceDelta; f32[12] = settings.minimizeRate;
  f32[13] = settings.maxDisplacement;
  u32[14] = model.sizes.constraints; u32[15] = settings.constraintIterations;
  f32[16] = settings.cutoffNm; f32[17] = settings.neighborRadiusNm;
  u32[18] = settings.maximumNeighbors; u32[19] = settings.neighborRebuildInterval;
  u32[20] = model.sizes.constraintColors;
  device.queue.writeBuffer(simulation.buffers.params, 0, bytes);
}

function bindGroup(device, pipeline, simulation, bindings) {
  const source = simulation.buffers;
  const names = ['params', 'posm', 'velocity', 'bonds', 'angles', 'torsions', 'nonbonded', 'forces', 'output', 'incidence', 'exceptions', 'constraints', 'neighbors'];
  return device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: bindings.map((binding) => ({ binding, resource: { buffer: source[names[binding]] } })),
  });
}

function makeBindGroups(device, pipelines, simulation) {
  return {
    energy: bindGroup(device, pipelines.energy, simulation, [0, 1, 3, 4, 5, 6, 8, 10, 12]),
    forces: bindGroup(device, pipelines.forces, simulation, [0, 1, 3, 4, 5, 6, 7, 9, 10, 12]),
    born: bindGroup(device, pipelines.born, simulation, [0, 1, 6, 12]),
    bornDerivative: bindGroup(device, pipelines.bornDerivative, simulation, [0, 1, 6, 12]),
    integrate: bindGroup(device, pipelines.integrate, simulation, [0, 1, 2, 7]),
    minimize: bindGroup(device, pipelines.minimize, simulation, [0, 1, 7]),
    constraints: bindGroup(device, pipelines.constraints, simulation, [0, 1, 2, 8, 11]),
    neighbors: bindGroup(device, pipelines.neighbors, simulation, [0, 1, 12]),
  };
}

function dispatch(pass, pipeline, group, workgroups) {
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(workgroups);
}

async function readBuffer(device, source, byteLength) {
  const target = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, target, 0, byteLength);
  device.queue.submit([encoder.finish()]);
  await target.mapAsync(GPUMapMode.READ);
  const result = target.getMappedRange().slice(0);
  target.unmap(); target.destroy();
  return result;
}

function encodeNeighborList(gpu, simulation, groups, pass) {
  if (!(simulation.settings.cutoffNm > 0)) return;
  dispatch(pass, gpu.pipelines.neighbors, groups.neighbors,
    Math.ceil(simulation.model.count / WORKGROUP_SIZE));
  simulation.neighborListBuilt = true;
}

async function potentialEnergy(gpu, simulation, groups) {
  writeParams(gpu.device, simulation);
  const encoder = gpu.device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  const validateNeighborList = simulation.settings.cutoffNm > 0 && !simulation.neighborListBuilt;
  if (validateNeighborList) encodeNeighborList(gpu, simulation, groups, pass);
  if (simulation.settings.implicitSolvent)
    dispatch(pass, gpu.pipelines.born, groups.born, Math.ceil(simulation.model.count / WORKGROUP_SIZE));
  dispatch(pass, gpu.pipelines.energy, groups.energy, 1);
  pass.end();
  gpu.device.queue.submit([encoder.finish()]);
  const reads = [readBuffer(gpu.device, simulation.buffers.output, 16)];
  if (validateNeighborList) {
    reads.push(readBuffer(gpu.device, simulation.buffers.neighbors,
      simulation.model.count * Uint32Array.BYTES_PER_ELEMENT));
  }
  const results = await Promise.all(reads);
  const values = new Float32Array(results[0]);
  if (validateNeighborList) {
    const counts = new Uint32Array(results[1]);
    const largest = counts.reduce((maximum, count) => Math.max(maximum, count), 0);
    if (largest > simulation.settings.maximumNeighbors) {
      throw new Error(`The ${simulation.settings.neighborRadiusNm.toFixed(2)} nm Verlet list needs ${largest} neighbors per atom; increase its ${simulation.settings.maximumNeighbors} entry capacity`);
    }
  }
  if (!Number.isFinite(values[0])) throw new Error('WebGPU produced a non-finite potential energy');
  return values[0];
}

async function evaluateForces(gpu, simulation, groups) {
  writeParams(gpu.device, simulation);
  const encoder = gpu.device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  if (!simulation.neighborListBuilt) encodeNeighborList(gpu, simulation, groups, pass);
  if (simulation.settings.implicitSolvent) {
    const workgroups = Math.ceil(simulation.model.count / WORKGROUP_SIZE);
    dispatch(pass, gpu.pipelines.born, groups.born, workgroups);
    dispatch(pass, gpu.pipelines.bornDerivative, groups.bornDerivative, workgroups);
  }
  dispatch(pass, gpu.pipelines.forces, groups.forces,
    Math.ceil(simulation.model.count / WORKGROUP_SIZE));
  pass.end();
  gpu.device.queue.submit([encoder.finish()]);
  const packed = new Float32Array(await readBuffer(
    gpu.device, simulation.buffers.forces,
    simulation.model.count * 4 * Float32Array.BYTES_PER_ELEMENT,
  ));
  const forces = new Float64Array(simulation.model.count * 3);
  for (let atom = 0; atom < simulation.model.count; atom++)
    forces.set(packed.subarray(atom * 4, atom * 4 + 3), atom * 3);
  if (!forces.every(Number.isFinite)) throw new Error('WebGPU produced non-finite forces');
  return forces;
}

async function minimize(gpu, simulation, groups, id, iterations, savedFrameCount, onFrame) {
  const workgroups = Math.ceil(simulation.model.count / WORKGROUP_SIZE);
  const atomWorkgroups = Math.ceil(simulation.model.count / WORKGROUP_SIZE);
  const frameCount = iterations > 0
    ? Math.max(2, Math.min(iterations + 1, Math.round(Number(savedFrameCount ?? 26))))
    : 1;
  let completed = 0;
  for (let frame = 1; frame < frameCount; frame++) {
    const target = Math.round(frame * iterations / (frameCount - 1));
    const count = target - completed;
    if (count < 1) continue;
    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    for (let iteration = 0; iteration < count; iteration++) {
      simulation.step = completed + iteration;
      writeParams(gpu.device, simulation);
      if (simulation.settings.cutoffNm > 0
          && simulation.step % simulation.settings.neighborRebuildInterval === 0)
        encodeNeighborList(gpu, simulation, groups, pass);
      if (simulation.settings.implicitSolvent) {
        dispatch(pass, gpu.pipelines.born, groups.born, atomWorkgroups);
        dispatch(pass, gpu.pipelines.bornDerivative, groups.bornDerivative, atomWorkgroups);
      }
      dispatch(pass, gpu.pipelines.forces, groups.forces, workgroups);
      dispatch(pass, gpu.pipelines.minimize, groups.minimize, atomWorkgroups);
      if (simulation.model.sizes.constraints)
        dispatch(pass, gpu.pipelines.constraints, groups.constraints, 1);
    }
    pass.end();
    gpu.device.queue.submit([encoder.finish()]);
    await gpu.device.queue.onSubmittedWorkDone();
    completed = target;
    progress(id, 'Minimizing with WebGPU…', 1, 0.2 + 0.72 * Math.min(1, completed / iterations));
    if (uncapturedError) throw uncapturedError;
    await onFrame(completed);
  }
}

async function dynamics(gpu, simulation, groups, id, steps, savedFrameCount, onFrame) {
  const forceWorkgroups = Math.ceil(simulation.model.count / WORKGROUP_SIZE);
  const atomWorkgroups = Math.ceil(simulation.model.count / WORKGROUP_SIZE);
  const frameCount = steps > 0
    ? Math.max(2, Math.min(steps + 1, Math.round(Number(savedFrameCount ?? 26))))
    : 1;
  let nextFrame = 1;
  let nextSampleStep = frameCount > 1 ? Math.round(nextFrame * steps / (frameCount - 1)) : -1;
  for (let step = 0; step < steps; step++) {
    simulation.step = step;
    writeParams(gpu.device, simulation);
    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    if (simulation.settings.cutoffNm > 0
        && step % simulation.settings.neighborRebuildInterval === 0)
      encodeNeighborList(gpu, simulation, groups, pass);
    if (simulation.settings.implicitSolvent) {
      dispatch(pass, gpu.pipelines.born, groups.born, atomWorkgroups);
      dispatch(pass, gpu.pipelines.bornDerivative, groups.bornDerivative, atomWorkgroups);
    }
    dispatch(pass, gpu.pipelines.forces, groups.forces, forceWorkgroups);
    dispatch(pass, gpu.pipelines.integrate, groups.integrate, atomWorkgroups);
    if (simulation.model.sizes.constraints)
      dispatch(pass, gpu.pipelines.constraints, groups.constraints, 1);
    pass.end();
    gpu.device.queue.submit([encoder.finish()]);
    if (step + 1 === nextSampleStep) {
      await gpu.device.queue.onSubmittedWorkDone();
      progress(id, 'Running WebGPU molecular dynamics…', 1, 0.2 + 0.72 * (step + 1) / steps);
      if (uncapturedError) throw uncapturedError;
      await onFrame(step + 1);
      nextFrame += 1;
      if (nextFrame < frameCount)
        nextSampleStep = Math.round(nextFrame * steps / (frameCount - 1));
    }
  }
}

async function readPositions(device, simulation) {
  const packed = new Float32Array(await readBuffer(
    device, simulation.buffers.posm, simulation.model.count * 4 * Float32Array.BYTES_PER_ELEMENT,
  ));
  const positions = new Float64Array(simulation.model.count * 3);
  for (let atom = 0; atom < simulation.model.count; atom++) {
    positions[atom * 3] = packed[atom * 4] * 10;
    positions[atom * 3 + 1] = packed[atom * 4 + 1] * 10;
    positions[atom * 3 + 2] = packed[atom * 4 + 2] * 10;
  }
  if (!positions.every(Number.isFinite)) throw new Error('WebGPU produced non-finite coordinates');
  return positions;
}

function packFrames(frames, atomCount) {
  const stride = atomCount * 3;
  const frameEnergies = Float64Array.from(frames, (frame) => frame.energy);
  const frameSteps = Int32Array.from(frames, (frame) => frame.step);
  const trajectory = new Float64Array(frames.length * stride);
  frames.forEach((frame, index) => trajectory.set(frame.positions, index * stride));
  return { frameEnergies, frameSteps, trajectory };
}

function maximumConstraintError(positionsAngstrom, constraints) {
  let maximum = 0;
  for (const term of constraints) {
    const first = term.i * 3, second = term.j * 3;
    const distanceAngstrom = Math.hypot(
      positionsAngstrom[first] - positionsAngstrom[second],
      positionsAngstrom[first + 1] - positionsAngstrom[second + 1],
      positionsAngstrom[first + 2] - positionsAngstrom[second + 2],
    );
    maximum = Math.max(maximum,
      Math.abs(distanceAngstrom * 0.1 - term.distance_nm) / term.distance_nm);
  }
  return constraints.length ? maximum : null;
}

function destroySimulation(simulation) {
  Object.values(simulation.buffers).forEach((buffer) => buffer.destroy());
}

async function runCalculation(message) {
  const { id, job, molecule, options = {} } = message;
  const started = performance.now();
  uncapturedError = null;
  const parameterized = await parameterizeMolecule(id, molecule);
  const parameterCounts = Object.fromEntries(
    Object.entries(parameterized.system).map(([name, terms]) => [name, terms.length]),
  );
  if (job === 'parameters') {
    self.postMessage({
      type:'result', id, job,
      forcefield:parameterized.forcefield,
      chargeModel:parameterized.chargeModel,
      sourceSha256:parameterized.sourceSha256,
      system:parameterized.system,
      labels:parameterized.labels,
      parameterCounts,
      elapsedMs:performance.now() - started,
    });
    return;
  }
  const [gpu, { configureSimulationSystem }] = await Promise.all([
    getWebGPU(id), getSimulationOptions(),
  ]);
  const { obc2Parameters, requestedImplicitSolvent } = await getImplicitSolvent();
  const implicitModel = requestedImplicitSolvent(options);
  const implicitSolvent = implicitModel === 'obc2'
    ? obc2Parameters(molecule, parameterized.system) : null;
  const temperature = Math.max(1, Number(options.temperature ?? 300));
  const simulationConfig = configureSimulationSystem(molecule, parameterized.system, options);
  if (options.movableAtomIndices != null && job !== 'geometry')
    throw new Error('A movable-atom selection is supported only for WebGPU geometry minimization');
  const model = packSmirnoffModel(molecule, simulationConfig.system, temperature,
    parameterized.forcefield, implicitSolvent, options.movableAtomIndices);
  progress(id, `Uploading ${parameterized.forcefield} System to WebGPU · ${model.count} atoms · ${model.sizes.torsions} torsions…`, 0.9, 0.08);
  const simulation = createSimulation(gpu.device, model, {
    ...options, dt: simulationConfig.timestepPs,
    nonbondedCutoffNm: simulationConfig.cutoffNm, temperature,
  });
  const groups = makeBindGroups(gpu.device, gpu.pipelines, simulation);
  try {
    const initialEnergy = await potentialEnergy(gpu, simulation, groups) * KJ_TO_KCAL;
    const frames = [{ step: 0, energy: initialEnergy, positions: await readPositions(gpu.device, simulation) }];
    const captureFrame = async (step) => {
      frames.push({
        step,
        energy: await potentialEnergy(gpu, simulation, groups) * KJ_TO_KCAL,
        positions: await readPositions(gpu.device, simulation),
      });
    };
    if (job === 'geometry') {
      const iterations = Math.min(2000, Math.max(0, Number(options.maxIterations ?? 750)));
      await minimize(gpu, simulation, groups, id, iterations, options.savedFrameCount, captureFrame);
    } else if (job === 'dynamics') {
      const steps = Math.round(Number(options.steps ?? 250));
      if (!Number.isInteger(steps) || steps < 1 || steps > 5000)
        throw new Error('Direct Sage WebGPU dynamics supports between 1 and 5,000 steps; use the STORMM WebGPU ensemble for longer trajectories');
      await dynamics(gpu, simulation, groups, id, steps, options.savedFrameCount, captureFrame);
    } else if (job !== 'energy') {
      throw new Error(`Unknown WebGPU job type: ${job}`);
    }
    progress(id, 'Collecting WebGPU results…', 1, 0.95);
    const finalFrame = frames.at(-1);
    const finalEnergy = finalFrame.energy;
    const positions = finalFrame.positions;
    const forces = await evaluateForces(gpu, simulation, groups);
    const diagnostics = new Float32Array(await readBuffer(gpu.device, simulation.buffers.output, 16));
    const { frameEnergies, frameSteps, trajectory } = packFrames(frames, molecule.atoms.length);
    const result = {
      type: 'result', id, job, initialEnergy, finalEnergy, positions, forces,
      elapsedMs: performance.now() - started,
      forcefield: parameterized.forcefield,
      chargeModel: parameterized.chargeModel,
      sourceSha256: parameterized.sourceSha256,
      parameterCounts,
      implicitSolvent: implicitSolvent?.model || null,
      constraintMode: simulationConfig.constraintMode,
      constraintCount: simulationConfig.constraints.length,
      derivedConstraintCount: simulationConfig.derivedConstraintCount,
      cutoffNm: simulationConfig.cutoffNm || null,
      neighborRadiusNm: simulation.settings.cutoffNm > 0 ? simulation.settings.neighborRadiusNm : null,
      movableAtomCount:model.movableAtomCount,
      fixedAtomCount:model.count - model.movableAtomCount,
      constraintError: job !== 'energy' && simulationConfig.constraints.length
        ? Math.max(diagnostics[1], maximumConstraintError(positions, simulationConfig.constraints)) : null,
      platform: 'WebGPU',
      backend: parameterized.forcefield.includes('Rosemary') ? 'Rosemary WebGPU' : 'Sage WebGPU',
      unit: 'kcal/mol',
      timestepFs: job === 'dynamics' ? simulation.settings.dt * 1000 : null,
      frameCount: frames.length, frameEnergies, frameSteps, trajectory,
    };
    self.postMessage(result, [positions.buffer, forces.buffer, frameEnergies.buffer, frameSteps.buffer, trajectory.buffer]);
  } finally {
    destroySimulation(simulation);
  }
}

self.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type === 'probe') {
    getWebGPU(message.id).then(() => self.postMessage({ type: 'probe', id: message.id, available: true }))
      .catch((error) => self.postMessage({ type: 'probe', id: message.id, available: false, message: error.message }));
    return;
  }
  if (message?.type !== 'run') return;
  runCalculation(message).catch((error) => {
    self.postMessage({ type: 'error', id: message.id,
      message: error instanceof Error ? error.message : String(error) });
  });
});
