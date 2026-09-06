import { buildAlkane, buildParameterizedSystem, buildWater, mulberry32 } from './stormm/core.mjs';
import { createEngine } from './stormm/engine.mjs';
import { obc2Parameters, requestedImplicitSolvent } from './openff/implicit-solvent.js';
import { configureSimulationSystem, requestedCutoffNanometers } from './openff/simulation-options.js';
import { conformerSearchProtocol } from './openff/conformer-protocol.js';
import { requestedSavedFrameCount, validateTrajectory } from './openff/frame-contract.mjs';

const MAX_DYNAMICS_STEPS = 100_000;
const REPLICA_SMOKE_COUNTS = Object.freeze([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]);

let gpuPromise;

function progress(id, phase, model, calculation) {
  self.postMessage({ type: 'progress', id, phase, model, calculation });
}

async function getWebGPU(id) {
  if (gpuPromise) return gpuPromise;
  gpuPromise = (async () => {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');
    progress(id, 'Requesting a WebGPU device for STORMM…', 0.15, 0);
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No compatible WebGPU adapter was found');
    const device = await adapter.requestDevice();
    device.addEventListener('uncapturederror', (event) => {
      console.error('STORMM WebGPU error', event.error);
    });
    return { adapter, device };
  })().catch((error) => {
    gpuPromise = null;
    throw error;
  });
  return gpuPromise;
}

function topologyFor(name, molecule, options) {
  for (const key of ['nonbondedCutoffNm','cutoffNm'])
    if (requestedCutoffNanometers({ cutoffNm:options[key] }) !== 0)
      throw new Error('STORMM supports only nonperiodic all-pairs interactions; nonzero cutoffs are unsupported');
  if (name === 'current') {
    const parameterization = molecule?.parameterization;
    // STORMM's current kernel is still all-pairs/nonperiodic. Reuse the shared
    // constraint materializer and timestep policy without accepting the direct
    // WebGPU path's optional Verlet cutoff.
    const simulation = configureSimulationSystem(molecule, parameterization?.system, options);
    const implicitModel = requestedImplicitSolvent(options);
    const implicitSolvent = implicitModel === 'obc2'
      ? obc2Parameters(molecule, simulation.system)
      : null;
    const topology = buildParameterizedSystem(molecule,
      { ...parameterization, system: simulation.system },
      { implicitSolvent, dt: simulation.timestepPs });
    topology.constraintMode = simulation.constraintMode;
    topology.derivedConstraintCount = simulation.derivedConstraintCount;
    return topology;
  }
  if (name === 'water27') return buildWater(3, mulberry32(41));
  if (name === 'c16') return buildAlkane(16);
  throw new Error(`Unknown STORMM ensemble preset: ${name}`);
}

function topologyMolecule(topology, preset, inputMolecule) {
  if (preset === 'current') return structuredClone(inputMolecule);
  const atoms = Array.from({ length: topology.nAtoms }, (_, index) => ({
    element: preset === 'water27' ? (index % 3 === 0 ? 'O' : 'H') : 'C',
    x: topology.coords[index * 3],
    y: topology.coords[index * 3 + 1],
    z: topology.coords[index * 3 + 2],
  }));
  const bonds = topology.drawBonds.map(([a, b]) => ({
    a, b, order: 1,
    distance: Math.hypot(
      atoms[a].x - atoms[b].x,
      atoms[a].y - atoms[b].y,
      atoms[a].z - atoms[b].z,
    ),
    topology: 'stormm',
  }));
  return {
    atoms,
    bonds,
    name: `STORMM ensemble · ${topology.name}`,
    smiles: preset === 'water27'
      ? 'Validated flexible (H₂O)₂₇ preset'
      : 'Validated n-C₁₆H₃₄ united-atom preset',
    charge: 0,
    multiplicity: 1,
  };
}

function potentialEnergy(record) {
  return record.bond + record.angle + record.dih + record.lj + record.coul + record.implicit;
}

function copyPackedPositions(target, targetOffset, packed, atomCount, replicaCount) {
  const stride = atomCount * 3;
  for (let replica = 0; replica < replicaCount; replica++) {
    const sourceBase = replica * atomCount * 4;
    const targetBase = targetOffset + replica * stride;
    for (let atom = 0; atom < atomCount; atom++) {
      target[targetBase + atom * 3] = packed[sourceBase + atom * 4];
      target[targetBase + atom * 3 + 1] = packed[sourceBase + atom * 4 + 1];
      target[targetBase + atom * 3 + 2] = packed[sourceBase + atom * 4 + 2];
    }
  }
}

function replicaPositions(trajectory, frame, replica, frameStride, atomStride) {
  const offset = frame * frameStride + replica * atomStride;
  return Float64Array.from(trajectory.subarray(offset, offset + atomStride));
}

function replicaCapacity(topology, preset) {
  if (topology.nAtoms > 512) return 0;
  const pairCapacity = Math.max(1, Math.floor(2_100_000 / (topology.nAtoms * topology.nAtoms)));
  return Math.min(1024, preset === 'water27' ? 256 : pairCapacity);
}

async function runReplicaSmoke(message) {
  const { id, molecule, options = {} } = message;
  const preset = String(options.stormmSystem || 'current');
  const topology = topologyFor(preset, molecule, options);
  const maximum = replicaCapacity(topology, preset);
  if (!maximum)
    throw new Error(`STORMM's current browser kernel is capped at 512 atoms per replica; this System has ${topology.nAtoms}`);
  const requested = Array.isArray(options.replicaCounts) ? options.replicaCounts : REPLICA_SMOKE_COUNTS;
  const candidates = [...new Set(requested.map(Number)
    .filter((count) => Number.isInteger(count) && count >= 1 && count <= maximum))]
    .sort((a, b) => a - b);
  if (!candidates.length) throw new Error('No valid replica counts fit this System');
  const warmupSteps = Math.max(2, Math.min(32, Math.round(Number(options.warmupSteps ?? 8))));
  const sampleSteps = Math.max(8, Math.min(256, Math.round(Number(options.sampleSteps ?? 64))));
  const { device } = await getWebGPU(id);
  const samples = [];
  const started = performance.now();
  for (let index = 0; index < candidates.length; index++) {
    const replicaCount = candidates[index];
    progress(id, `Smoke-testing ${replicaCount.toLocaleString()} replica${replicaCount === 1 ? '' : 's'}…`,
      1, 0.05 + 0.88 * index / candidates.length);
    const setupStarted = performance.now();
    const engine = await createEngine(device, topology, replicaCount, {
      T: Math.max(0, Number(options.temperature ?? 300)), thermo:1, gamma:2,
      seed:12345, initSeed:42, randomizeCoordinates:true, coordinateJitter:0.02,
      constraintTolerance:Number(options.constraintTolerance ?? 1e-5),
      constraintIterations:Math.round(Number(options.constraintIterations ?? 32)),
    });
    const setupMs = performance.now() - setupStarted;
    try {
      engine.run(warmupSteps);
      await engine.done();
      const timedStarted = performance.now();
      engine.run(sampleSteps);
      await engine.done();
      const elapsedMs = performance.now() - timedStarted;
      const status = await engine.readConstraintStatus();
      const perTrajectoryStepsPerSecond = sampleSteps * 1000 / elapsedMs;
      samples.push({
        replicaCount, setupMs, elapsedMs, sampleSteps,
        perTrajectoryStepsPerSecond,
        aggregateReplicaStepsPerSecond:perTrajectoryStepsPerSecond * replicaCount,
        pairWork:replicaCount * topology.nAtoms * topology.nAtoms,
        constraintsConverged:status.converged,
        constraintError:topology.counts.nConstraints ? status.maximumResidual : null,
      });
      await engine.assertHealthy();
    } finally {
      engine.destroy();
    }
  }
  const viable = samples.filter((sample) => sample.constraintsConverged !== false
    && Number.isFinite(sample.aggregateReplicaStepsPerSecond));
  if (!viable.length) throw new Error('Every replica smoke test failed its numerical health check');
  const peak = Math.max(...viable.map((sample) => sample.aggregateReplicaStepsPerSecond));
  const recommended = viable.find((sample) => sample.aggregateReplicaStepsPerSecond >= peak * 0.95)
    || viable.at(-1);
  progress(id, `Recommended: ${recommended.replicaCount.toLocaleString()} replicas`, 1, 1);
  self.postMessage({
    type:'result', id, job:'replica-smoke', backend:'STORMM WebGPU ensemble',
    atomCount:topology.nAtoms, maximumReplicaCount:maximum,
    warmupSteps, sampleSteps, samples,
    recommendedReplicaCount:recommended.replicaCount,
    peakAggregateReplicaStepsPerSecond:peak,
    elapsedMs:performance.now() - started,
    forcefield:topology.parameterization?.forcefield || topology.name,
    implicitSolvent:topology.implicitSolvent || null,
    constraintMode:topology.constraintMode || 'none',
  });
}

async function runEnsemble(message) {
  const { id, job, molecule, options = {} } = message;
  const conformerSearch = job === 'conformers';
  const energyOnly = job === 'energy';
  const scoreBatch = job === 'score-batch' || energyOnly;
  if (job !== 'dynamics' && !conformerSearch && !scoreBatch)
    throw new Error('The WebGPU ensemble supports energy, dynamics, conformer search, and batched scoring only');

  const preset = String(options.stormmSystem || 'current');
  if ((conformerSearch || scoreBatch) && preset !== 'current')
    throw new Error(`${scoreBatch ? 'Batched scoring' : 'Conformer search'} requires the current molecule`);
  const topology = topologyFor(preset, molecule, options);
  const initialConformers = conformerSearch ? options.initialConformers : null;
  const scoreCoordinates = energyOnly
    ? Float64Array.from(molecule.atoms.flatMap(atom => [atom.x,atom.y,atom.z]))
    : scoreBatch ? options.coordinateStack : null;
  const initialCoordinates = conformerSearch ? initialConformers : scoreCoordinates;
  const conformerStride = topology.nAtoms * 3;
  if ((conformerSearch || scoreBatch) && (!ArrayBuffer.isView(initialCoordinates)
      || !initialCoordinates.length || initialCoordinates.length % conformerStride))
    throw new Error(`${scoreBatch ? 'Batched scoring' : 'Conformer search'} received an invalid coordinate stack`);
  const replicaCount = conformerSearch || scoreBatch
    ? initialCoordinates.length / conformerStride
    : Number(options.replicaCount ?? 64);
  const steps = scoreBatch ? 0 : Number(options.steps ?? 250);
  if (!Number.isInteger(replicaCount) || replicaCount < 1 || replicaCount > 1024)
    throw new Error('WebGPU replica count must be between 1 and 1024');
  if (preset === 'water27' && replicaCount > 256)
    throw new Error('The water27 browser preset is capped at 256 replicas');
  if (!scoreBatch && (!Number.isInteger(steps) || steps < 1 || steps > MAX_DYNAMICS_STEPS))
    throw new Error(`STORMM dynamics steps must be between 1 and ${MAX_DYNAMICS_STEPS.toLocaleString()}`);

  let savedFrameCount = requestedSavedFrameCount(options.savedFrameCount, steps);
  const temperature = Math.max(0, Number(options.temperature ?? 300));
  if (!Number.isFinite(temperature)) throw new Error('STORMM temperature must be finite');
  const friction = Number(options.friction ?? 2);
  if (!Number.isFinite(friction) || friction < 0)
    throw new Error('STORMM friction must be finite and nonnegative');

  const started = performance.now();
  if (topology.nAtoms > 512)
    throw new Error(`STORMM's current all-pairs browser kernel is capped at 512 atoms per replica; this System has ${topology.nAtoms}`);
  const pairWork = replicaCount * topology.nAtoms * topology.nAtoms;
  if (pairWork > 2_100_000)
    throw new Error(`This ${topology.nAtoms}-atom System is too large for ${replicaCount} browser replicas; reduce the replica count`);
  const { adapter, device } = await getWebGPU(id);
  const adapterInfo = adapter.info || await adapter.requestAdapterInfo();
  const gpuAdapter = Object.fromEntries(['vendor','architecture','device','description','isFallbackAdapter']
    .map(key=>[key,adapterInfo[key] ?? adapter[key] ?? null]));
  progress(id, `Preparing fixed-point WebGPU kernels · ${replicaCount} ${scoreBatch ? 'structures' : conformerSearch ? 'conformers' : 'replicas'}…`, 0.55, 0.03);
  const protocol = conformerSearch ? conformerSearchProtocol(options) : null;
  const searchSteps = protocol?.searchSteps || 0;
  const minimizationIterations = protocol?.minimizationIterations || 0;
  const schedule = protocol?.stages || null;
  if (schedule) savedFrameCount = schedule.length;
  const engine = await createEngine(device, topology, replicaCount, {
    T: conformerSearch ? 600 : temperature,
    thermo: 1,
    gamma: friction,
    seed: 12345,
    initSeed: 42,
    randomizeCoordinates: !conformerSearch && !scoreBatch,
    coordinateJitter: conformerSearch || scoreBatch ? 0 : 0.02,
    initialPositions: conformerSearch || scoreBatch ? initialCoordinates : null,
    evaluationOnly:scoreBatch,
    constraintTolerance: Number(options.constraintTolerance ?? 1e-5),
    constraintIterations: Math.round(Number(options.constraintIterations ?? 32)),
  });
  const setupMs = performance.now() - started;
  const searchStarted = performance.now();
  const stageElapsedMs = new Float64Array(savedFrameCount);

  const atomStride = topology.nAtoms * 3;
  const frameStride = replicaCount * atomStride;
  const frameSteps = new Int32Array(savedFrameCount);
  const ensembleEnergies = new Float64Array(savedFrameCount * replicaCount);
  const ensembleTrajectory = new Float32Array(savedFrameCount * frameStride);
  let constraintStatus = await engine.readConstraintStatus();

  const capture = async (frame, step) => {
    const captureStarted = performance.now();
    await engine.done();
    const energies = await engine.readEnergies();
    const positions = await engine.readAllPositions();
    if (energies.length !== replicaCount || positions.length !== replicaCount * topology.nAtoms * 4)
      throw new Error('STORMM readback does not match the requested replica/atom counts');
    constraintStatus = await engine.readConstraintStatus();
    frameSteps[frame] = step;
    for (let replica = 0; replica < replicaCount; replica++)
      ensembleEnergies[frame * replicaCount + replica] = potentialEnergy(energies[replica]);
    copyPackedPositions(ensembleTrajectory, frame * frameStride, positions, topology.nAtoms, replicaCount);
    stageElapsedMs[frame] += performance.now() - captureStarted;
  };

  let singlePointForces = null;
  try {
    await capture(0, 0);
    if (energyOnly) {
      // Engine units are kcal/mol/Å; the public single-point force vector uses
      // kJ/mol/nm, matching the direct worker and independent native oracle.
      singlePointForces = Float64Array.from(await engine.readForces(0), value => value * 41.84);
      if (singlePointForces.length !== atomStride || !singlePointForces.every(Number.isFinite))
        throw new Error('STORMM single-point forces must contain exactly 3N finite components');
    }
    let completed = 0;
    if (conformerSearch) {
      const totalWork = protocol.totalWork;
      for (let frame = 1; frame < schedule.length; frame++) {
        const stage = schedule[frame];
        const stageStarted = performance.now();
        if (stage.kind === 'relax') engine.relax(stage.steps);
        else {
          engine.setDynamics(stage);
          engine.run(stage.steps);
        }
        stageElapsedMs[frame] += performance.now() - stageStarted;
        completed += stage.steps;
        await capture(frame, completed);
        progress(id, `${stage.label} · ${replicaCount} conformers…`, 1,
          0.08 + 0.86 * completed / totalWork);
      }
    } else if (!scoreBatch) {
      for (let frame = 1; frame < savedFrameCount; frame++) {
        const target = Math.round(frame * steps / (savedFrameCount - 1));
        engine.run(target - completed);
        completed = target;
        await capture(frame, completed);
        progress(
          id,
          `Running ${replicaCount} independent STORMM trajectories…`,
          1,
          0.08 + 0.86 * completed / steps,
        );
      }
    }
    await engine.assertHealthy();
  } finally {
    engine.destroy();
  }

  validateTrajectory({atomCount:topology.nAtoms, replicaCount, frameCount:savedFrameCount,
    frameSteps, energies:ensembleEnergies, trajectory:ensembleTrajectory,
    expectedSteps:conformerSearch ? protocol.totalWork : steps});
  const lastFrame = savedFrameCount - 1;
  const positions = replicaPositions(
    ensembleTrajectory, lastFrame, 0, frameStride, atomStride,
  );
  const initialEnergy = ensembleEnergies[0];
  const finalEnergy = ensembleEnergies[lastFrame * replicaCount];
  const result = {
    type: 'result',
    id,
    job,
    initialEnergy,
    finalEnergy,
    positions,
    ...(energyOnly ? {forces:singlePointForces, forceUnit:'kJ/mol/nm'} : {}),
    molecule: topologyMolecule(topology, preset, molecule),
    elapsedMs: performance.now() - started,
    setupMs,
    searchMs: performance.now() - searchStarted,
    stageElapsedMs,
    forcefield: topology.parameterization?.forcefield || topology.name,
    chargeModel: topology.parameterization?.chargeModel,
    platform: 'WebGPU',
    gpuAdapter,
    backend: 'STORMM WebGPU ensemble',
    unit: 'kcal/mol',
    timestepFs: topology.dt * 1000,
    frictionPerPs: friction,
    frameCount: savedFrameCount,
    frameSteps,
    replicaCount,
    ensembleEnergies,
    ensembleTrajectory,
    ensembleLayout: 'frame-replica-xyz',
    homogeneous: true,
    stormmSystem: preset,
    implicitSolvent: topology.implicitSolvent || null,
    constraintMode: topology.constraintMode || 'none',
    constraintCount: topology.counts.nConstraints,
    derivedConstraintCount: topology.derivedConstraintCount || 0,
    constraintError: topology.counts.nConstraints ? constraintStatus.maximumResidual : null,
    constraintIterations: constraintStatus.iterations,
    constraintsConverged: constraintStatus.converged,
    constraintsApplied: !scoreBatch && topology.counts.nConstraints > 0,
    conformerMethod: conformerSearch ? options.conformerMethod || 'ETKDGv3' : null,
    conformerPreparationForcefield: conformerSearch
      ? options.conformerPreparationForcefield || null : null,
    conformerPruneRms: conformerSearch ? Number(options.conformerPruneRms ?? 0.35) : null,
    conformerSearchSteps: conformerSearch ? searchSteps : null,
    conformerMinimizationIterations: conformerSearch ? minimizationIterations : null,
    conformerStageLabels: conformerSearch ? schedule.map((stage) => stage.label) : null,
  };
  self.postMessage(result, [
    positions.buffer,
    ...(singlePointForces ? [singlePointForces.buffer] : []),
    frameSteps.buffer,
    ensembleEnergies.buffer,
    ensembleTrajectory.buffer,
    stageElapsedMs.buffer,
  ]);
}

self.addEventListener('message', (event) => {
  const message = event.data;
  if (message?.type !== 'run') return;
  const operation = message.job === 'replica-smoke' ? runReplicaSmoke(message) : runEnsemble(message);
  operation.catch((error) => {
    self.postMessage({
      type: 'error',
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });
});
