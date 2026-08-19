import * as ort from './vendor/onnxruntime-web/ort.webgpu.bundle.min.mjs';
import {
  ANI2X_HARTREE_TO_KCAL_MOL,
  ani2xCompatibility,
  ani2xSpecies,
  buildAni2xAevs,
  contractAni2xAevGradients,
  forceStatistics,
  moleculePositions,
} from './mlip/ani2x.js';
import { Ani2xWebGpuEvaluator } from './mlip/ani2x-webgpu.js';

const configuredAssetBase = new URL(self.location.href).searchParams.get('assetBase');
const MODEL_ROOT = configuredAssetBase
  ? new URL('mlip/models/', configuredAssetBase) : new URL('./mlip/models/', self.location.href);
const MAX_MINIMIZATION_ITERATIONS = 250;
const MAX_CONFORMER_COUNT = 64;
const MAX_SCORE_COORDINATES = 4096;
const CONFORMER_FRAME_COUNT = 6;
let manifestPromise;
const sessions = new Map();

ort.env.wasm.wasmPaths = configuredAssetBase
  ? new URL('onnxruntime-web/1.27.0/', configuredAssetBase).href
  : new URL('./node_modules/onnxruntime-web/dist/', self.location.href).href;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

function progress(id, phase, model, calculation) {
  self.postMessage({ type: 'progress', id, phase, model, calculation });
}

async function manifest() {
  manifestPromise ??= fetch(new URL('ani2x-manifest.json', MODEL_ROOT)).then(async (response) => {
    if (!response.ok) throw new Error(`ANI-2x manifest could not be loaded (HTTP ${response.status})`);
    const payload = await response.json();
    if (payload?.schema !== 1 || payload?.model !== 'ANI-2x'
        || payload.aevLength !== 1008 || payload.ensembleSize !== 8)
      throw new Error('The ANI-2x manifest is incomplete or unsupported');
    return payload;
  }).catch((error) => { manifestPromise = null; throw error; });
  return manifestPromise;
}

async function createSession(element, model, id) {
  const artifact = model.artifacts[element];
  if (!artifact) throw new Error(`ANI-2x has no ${element} network artifact`);
  const modelUrl = new URL(artifact.file, MODEL_ROOT).href;
  const options = {
    graphOptimizationLevel: 'all',
    executionMode: 'sequential',
    enableCpuMemArena: true,
    enableMemPattern: true,
  };
  if (self.navigator?.gpu) {
    try {
      progress(id, `Loading ANI-2x ${element} ensemble on WebGPU…`, 0.2, 0);
      const session = await ort.InferenceSession.create(modelUrl, {
        ...options, executionProviders: ['webgpu'],
        preferredOutputLocation: {
          member_atomic_energies:'gpu-buffer', aev_gradients:'gpu-buffer',
        },
      });
      return { session, provider: 'WebGPU' };
    } catch (error) {
      console.warn(`ANI-2x ${element} WebGPU session failed; using WASM`, error);
    }
  }
  progress(id, `Loading ANI-2x ${element} ensemble in WebAssembly…`, 0.2, 0);
  const session = await ort.InferenceSession.create(modelUrl, {
    ...options, executionProviders: ['wasm'],
  });
  return { session, provider: 'WebAssembly' };
}

async function sessionFor(element, model, id) {
  if (!sessions.has(element)) sessions.set(element,
    createSession(element, model, id).catch((error) => { sessions.delete(element); throw error; }));
  return sessions.get(element);
}

function groupAtoms(species, symbols) {
  const groups = new Map();
  species.forEach((elementIndex, atom) => {
    const element = symbols[elementIndex];
    if (!groups.has(element)) groups.set(element, []);
    groups.get(element).push(atom);
  });
  return groups;
}

function providerName(providers) {
  const unique = [...new Set(providers)];
  return unique.length === 1 ? unique[0] : 'WebGPU + WebAssembly';
}

function standardDeviation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

async function createEvaluator(molecule, id, evaluatorOptions = {}) {
  const compatibility = ani2xCompatibility(molecule);
  if (!compatibility.supported) throw new Error(compatibility.reason);
  const model = await manifest();
  const species = ani2xSpecies(molecule);
  const groups = groupAtoms(species, model.symbols);
  const loaded = new Map();
  let loadedCount = 0;
  for (const element of groups.keys()) {
    loaded.set(element, await sessionFor(element, model, id));
    loadedCount++;
    progress(id, `ANI-2x ${element} ensemble ready`, 0.2 + 0.7 * loadedCount / groups.size, 0);
  }
  const providers = [...loaded.values()].map((entry) => entry.provider);
  let evaluations = 0;
  let inferenceBatches = 0;
  const cpuTimings = { aevBuildMs:0, networkMs:0, forceContractionMs:0 };
  let gpuEvaluator = null;
  let gpuFallbackReason = null;
  if (!evaluatorOptions.forceCpuDescriptors
      && providers.every((provider) => provider === 'WebGPU') && ort.env.webgpu.device) {
    try {
      progress(id, 'Compiling ANI-2x WebGPU descriptors and force contraction…', 0.94, 0);
      gpuEvaluator = await Ani2xWebGpuEvaluator.create(
        ort.env.webgpu.device, species, groups, model, ort);
    } catch (error) {
      console.warn('ANI-2x GPU-resident descriptor path is unavailable; using verified CPU descriptors', error);
    }
  }

  function initialMemberEnergies(batchCount) {
    return Array.from({ length:batchCount }, () => {
      const values = new Float64Array(model.ensembleSize);
      for (let atom = 0; atom < species.length; atom++) {
        const selfEnergy = model.selfEnergiesHartree[species[atom]];
        for (let member = 0; member < model.ensembleSize; member++) values[member] += selfEnergy;
      }
      return values;
    });
  }

  async function tensorData(tensor, expectedLength, name) {
    if (!tensor) throw new Error(`ANI-2x ${name} output is missing`);
    const data = tensor.location === 'cpu' ? tensor.data : await tensor.getData();
    if (!(data instanceof Float32Array) || data.length !== expectedLength)
      throw new Error(`ANI-2x ${name} returned an invalid tensor shape`);
    return data;
  }

  function resultsFromMemberEnergies(memberEnergies) {
    return memberEnergies.map((energies) => {
      const energyHartree = energies.reduce((sum, value) => sum + value, 0)
        / model.ensembleSize;
      if (!Number.isFinite(energyHartree))
        throw new Error('ANI-2x produced a non-finite energy');
      return {
        energyHartree,
        energyKcalMol:energyHartree * ANI2X_HARTREE_TO_KCAL_MOL,
        ensembleStdDevKcalMol:standardDeviation(energies) * ANI2X_HARTREE_TO_KCAL_MOL,
      };
    });
  }

  function resultsFromGradients(positionBatch, memberEnergies, coordinateGradients) {
    const energies = resultsFromMemberEnergies(memberEnergies);
    return positionBatch.map((_, batch) => {
      const forces = Float64Array.from(coordinateGradients[batch],
        (gradient) => -gradient * ANI2X_HARTREE_TO_KCAL_MOL);
      if (!forces.every(Number.isFinite))
        throw new Error('ANI-2x produced a non-finite energy or force');
      return { ...energies[batch], forces };
    });
  }

  function recoverableGpuResourceError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /exceeds max(StorageBufferBindingSize|BufferSize)|out[- ]of[- ]memory|memory allocation|createBuffer.*(?:failed|memory)|failed to (?:create|allocate).*(?:buffer|memory)/i
      .test(message);
  }

  const evaluateBatch = async (positionBatch, evaluationOptions = {}) => {
    if (!Array.isArray(positionBatch) || !positionBatch.length)
      throw new Error('ANI-2x requires at least one coordinate set');
    const includeForces = evaluationOptions.includeForces !== false;
    inferenceBatches++;
    evaluations += positionBatch.length;
    const atomCount = species.length;
    const memberEnergies = initialMemberEnergies(positionBatch.length);
    if (gpuEvaluator) {
      try {
        const coordinateGradients = await gpuEvaluator.evaluate(
          positionBatch, loaded, memberEnergies, { includeForces });
        return includeForces
          ? resultsFromGradients(positionBatch, memberEnergies, coordinateGradients)
          : resultsFromMemberEnergies(memberEnergies);
      } catch (error) {
        if (!recoverableGpuResourceError(error)) throw error;
        gpuFallbackReason = error instanceof Error ? error.message : String(error);
        console.warn('ANI-2x WebGPU descriptor resources are unavailable; using CPU descriptors', error);
        gpuEvaluator = null;
        // The CPU path below still uses the loaded ONNX WebGPU networks. Reset
        // the self-energy accumulator in case a failure followed partial output.
        memberEnergies.splice(0, memberEnergies.length,
          ...initialMemberEnergies(positionBatch.length));
      }
    }
    const aevStarted = performance.now();
    const aevBatch = positionBatch.map((positions) =>
      buildAni2xAevs(species, positions, model));
    cpuTimings.aevBuildMs += performance.now() - aevStarted;
    const aevGradients = includeForces ? Array.from({ length:positionBatch.length },
      () => new Float32Array(atomCount * model.aevLength)) : null;

    const networkStarted = performance.now();
    for (const [element, atomIndices] of groups) {
      const rowCount = positionBatch.length * atomIndices.length;
      const input = new Float32Array(rowCount * model.aevLength);
      positionBatch.forEach((_, batch) => atomIndices.forEach((atom, localRow) => {
        const source = aevBatch[batch].subarray(
          atom * model.aevLength, (atom + 1) * model.aevLength);
        const row = batch * atomIndices.length + localRow;
        input.set(source, row * model.aevLength);
      }));
      const { session } = loaded.get(element);
      const feeds = {
        aev: new ort.Tensor('float32', input, [rowCount, model.aevLength]),
      };
      const outputs = includeForces
        ? await session.run(feeds)
        : await session.run(feeds, ['member_atomic_energies']);
      const atomicEnergies = await tensorData(outputs.member_atomic_energies,
        rowCount * model.ensembleSize, `${element} atomic energies`);
      const gradients = includeForces ? await tensorData(outputs.aev_gradients,
        input.length, `${element} AEV gradients`) : null;
      positionBatch.forEach((_, batch) => atomIndices.forEach((atom, localRow) => {
        const row = batch * atomIndices.length + localRow;
        for (let member = 0; member < model.ensembleSize; member++)
          memberEnergies[batch][member]
            += atomicEnergies[row * model.ensembleSize + member];
        if (includeForces) aevGradients[batch].set(
          gradients.subarray(row * model.aevLength, (row + 1) * model.aevLength),
          atom * model.aevLength);
      }));
      outputs.member_atomic_energies.dispose?.();
      outputs.aev_gradients?.dispose?.();
    }
    cpuTimings.networkMs += performance.now() - networkStarted;

    if (!includeForces) return resultsFromMemberEnergies(memberEnergies);

    const contractionStarted = performance.now();
    const coordinateGradients = positionBatch.map((positions, batch) =>
      contractAni2xAevGradients(species, positions, aevGradients[batch], model));
    cpuTimings.forceContractionMs += performance.now() - contractionStarted;
    return resultsFromGradients(positionBatch, memberEnergies, coordinateGradients);
  };

  return {
    model,
    species,
    get provider() {
      return gpuEvaluator ? 'WebGPU · GPU-resident AEV/forces' : providerName(providers);
    },
    get evaluations() { return evaluations; },
    get inferenceBatches() { return inferenceBatches; },
    get stageTimings() {
      const source = gpuEvaluator?.timings || cpuTimings;
      return {
        ...source,
        descriptorBackend:gpuEvaluator ? 'WebGPU' : 'JavaScript CPU',
        ...(gpuFallbackReason ? { fallbackReason:gpuFallbackReason } : {}),
      };
    },
    evaluateBatch,
    async evaluate(positions) {
      return (await evaluateBatch([positions]))[0];
    },
  };
}

function dot(first, second) {
  let sum = 0;
  for (let index = 0; index < first.length; index++) sum += first[index] * second[index];
  return sum;
}

function scaledDirection(direction, maximumAtomStep) {
  let maximum = 0;
  for (let atom = 0; atom < direction.length / 3; atom++) {
    const offset = atom * 3;
    maximum = Math.max(maximum,
      Math.hypot(direction[offset], direction[offset + 1], direction[offset + 2]));
  }
  if (maximum <= maximumAtomStep || maximum === 0) return direction;
  const scale = maximumAtomStep / maximum;
  return Float64Array.from(direction, (value) => value * scale);
}

function lbfgsDirection(gradient, history) {
  if (!history.length) return Float64Array.from(gradient, (value) => -value);
  const q = Float64Array.from(gradient);
  const alphas = new Float64Array(history.length);
  for (let index = history.length - 1; index >= 0; index--) {
    const item = history[index];
    const alpha = item.rho * dot(item.s, q);
    alphas[index] = alpha;
    for (let coordinate = 0; coordinate < q.length; coordinate++) q[coordinate] -= alpha * item.y[coordinate];
  }
  const last = history.at(-1);
  const gamma = Math.max(1e-8, Math.min(10, dot(last.s, last.y) / Math.max(1e-16, dot(last.y, last.y))));
  const result = Float64Array.from(q, (value) => value * gamma);
  for (let index = 0; index < history.length; index++) {
    const item = history[index];
    const beta = item.rho * dot(item.y, result);
    for (let coordinate = 0; coordinate < result.length; coordinate++)
      result[coordinate] += item.s[coordinate] * (alphas[index] - beta);
  }
  for (let coordinate = 0; coordinate < result.length; coordinate++) result[coordinate] *= -1;
  return result;
}

function gradientFromForces(forces) {
  return Float64Array.from(forces, (force) => -force);
}

function packedFrames(frames, atomCount) {
  const stride = atomCount * 3;
  const frameEnergies = Float64Array.from(frames, (frame) => frame.energy);
  const frameSteps = Int32Array.from(frames, (frame) => frame.step);
  const trajectory = new Float64Array(frames.length * stride);
  frames.forEach((frame, index) => trajectory.set(frame.positions, index * stride));
  return { frameEnergies, frameSteps, trajectory };
}

async function minimize(evaluator, initialPositions, options, id) {
  const maximumIterations = Math.max(1, Math.min(MAX_MINIMIZATION_ITERATIONS,
    Math.round(Number(options.maxIterations ?? 150))));
  const forceTolerance = Math.max(0.005, Number(options.forceTolerance ?? 0.05));
  const frameInterval = Math.max(1, Math.ceil(maximumIterations / 10));
  let positions = Float64Array.from(initialPositions);
  let evaluated = await evaluator.evaluate(positions);
  const initial = evaluated;
  let gradient = gradientFromForces(evaluated.forces);
  const history = [];
  const frames = [{ step: 0, energy: evaluated.energyKcalMol, positions: positions.slice() }];
  let iterations = 0;
  let reason = 'maximum iterations';

  for (let iteration = 1; iteration <= maximumIterations; iteration++) {
    const statistics = forceStatistics(evaluated.forces);
    if (statistics.rms <= forceTolerance && statistics.maximum <= forceTolerance * 3) {
      reason = 'force tolerance';
      break;
    }
    let direction = scaledDirection(lbfgsDirection(gradient, history), 0.20);
    let directionalDerivative = dot(gradient, direction);
    if (!(directionalDerivative < 0)) {
      history.length = 0;
      direction = scaledDirection(Float64Array.from(gradient, (value) => -value), 0.05);
      directionalDerivative = dot(gradient, direction);
    }
    let accepted = null;
    let acceptedPositions = null;
    let step = 1;
    for (let lineSearch = 0; lineSearch < 9; lineSearch++) {
      const trial = Float64Array.from(positions,
        (value, coordinate) => value + step * direction[coordinate]);
      const candidate = await evaluator.evaluate(trial);
      if (candidate.energyKcalMol <= evaluated.energyKcalMol
          + 1e-4 * step * directionalDerivative) {
        accepted = candidate;
        acceptedPositions = trial;
        break;
      }
      step *= 0.5;
    }
    if (!accepted) {
      history.length = 0;
      const fallbackDirection = scaledDirection(
        Float64Array.from(gradient, (value) => -value), 0.01);
      const trial = Float64Array.from(positions,
        (value, coordinate) => value + fallbackDirection[coordinate]);
      const candidate = await evaluator.evaluate(trial);
      if (!(candidate.energyKcalMol < evaluated.energyKcalMol)) {
        reason = 'line search stalled';
        break;
      }
      accepted = candidate;
      acceptedPositions = trial;
    }
    const nextGradient = gradientFromForces(accepted.forces);
    const s = Float64Array.from(positions, (value, index) => acceptedPositions[index] - value);
    const y = Float64Array.from(gradient, (value, index) => nextGradient[index] - value);
    const curvature = dot(s, y);
    if (curvature > 1e-8) {
      history.push({ s, y, rho: 1 / curvature });
      if (history.length > 7) history.shift();
    }
    positions = acceptedPositions;
    evaluated = accepted;
    gradient = nextGradient;
    iterations = iteration;
    if (iteration % frameInterval === 0 || iteration === maximumIterations)
      frames.push({ step: iteration, energy: evaluated.energyKcalMol, positions: positions.slice() });
    if (!options.suppressProgress) progress(id,
      `Minimizing with ANI-2x · iteration ${iteration}/${maximumIterations}…`, 1,
      0.12 + 0.82 * iteration / maximumIterations);
  }
  if (frames.at(-1).step !== iterations)
    frames.push({ step: iterations, energy: evaluated.energyKcalMol, positions: positions.slice() });
  const statistics = forceStatistics(evaluated.forces);
  return {
    initial, final: evaluated, positions, frames, iterations, reason,
    converged: statistics.rms <= forceTolerance && statistics.maximum <= forceTolerance * 3,
    rmsForce: statistics.rms, maximumForce: statistics.maximum,
  };
}

async function minimizeBatch(evaluator, initialConformers, stride, options, id) {
  const maximumIterations = Math.max(1, Math.min(MAX_MINIMIZATION_ITERATIONS,
    Math.round(Number(options.maxIterations ?? 150))));
  const forceTolerance = Math.max(0.005, Number(options.forceTolerance ?? 0.05));
  const frameInterval = Math.max(1, Math.ceil(maximumIterations / 10));
  const replicaCount = initialConformers.length / stride;
  const states = Array.from({ length:replicaCount }, (_, replica) => ({
    positions:Float64Array.from(initialConformers.subarray(
      replica * stride, (replica + 1) * stride)),
    evaluated:null,
    initial:null,
    gradient:null,
    history:[],
    frames:[],
    iterations:0,
    reason:'maximum iterations',
    active:true,
  }));
  const initial = await evaluator.evaluateBatch(states.map((state) => state.positions));
  states.forEach((state, replica) => {
    state.evaluated = initial[replica];
    state.initial = initial[replica];
    state.gradient = gradientFromForces(initial[replica].forces);
    state.frames.push({ step:0, energy:initial[replica].energyKcalMol,
      positions:state.positions.slice() });
  });

  for (let iteration = 1; iteration <= maximumIterations; iteration++) {
    const work = [];
    states.forEach((state) => {
      if (!state.active) return;
      const statistics = forceStatistics(state.evaluated.forces);
      if (statistics.rms <= forceTolerance && statistics.maximum <= forceTolerance * 3) {
        state.reason = 'force tolerance';
        state.active = false;
        return;
      }
      let direction = scaledDirection(lbfgsDirection(state.gradient, state.history), 0.20);
      let directionalDerivative = dot(state.gradient, direction);
      if (!(directionalDerivative < 0)) {
        state.history.length = 0;
        direction = scaledDirection(
          Float64Array.from(state.gradient, (value) => -value), 0.05);
        directionalDerivative = dot(state.gradient, direction);
      }
      work.push({ state, direction, directionalDerivative, step:1,
        accepted:null, acceptedPositions:null });
    });
    if (!work.length) break;

    for (let lineSearch = 0; lineSearch < 9; lineSearch++) {
      const pending = work.filter((item) => !item.accepted);
      if (!pending.length) break;
      const trials = pending.map((item) => Float64Array.from(item.state.positions,
        (value, coordinate) => value + item.step * item.direction[coordinate]));
      const candidates = await evaluator.evaluateBatch(trials);
      pending.forEach((item, index) => {
        const candidate = candidates[index];
        if (candidate.energyKcalMol <= item.state.evaluated.energyKcalMol
            + 1e-4 * item.step * item.directionalDerivative) {
          item.accepted = candidate;
          item.acceptedPositions = trials[index];
        } else item.step *= 0.5;
      });
    }

    const stalled = work.filter((item) => !item.accepted);
    if (stalled.length) {
      const trials = stalled.map((item) => {
        item.state.history.length = 0;
        const direction = scaledDirection(
          Float64Array.from(item.state.gradient, (value) => -value), 0.01);
        return Float64Array.from(item.state.positions,
          (value, coordinate) => value + direction[coordinate]);
      });
      const candidates = await evaluator.evaluateBatch(trials);
      stalled.forEach((item, index) => {
        if (candidates[index].energyKcalMol < item.state.evaluated.energyKcalMol) {
          item.accepted = candidates[index];
          item.acceptedPositions = trials[index];
        } else {
          item.state.reason = 'line search stalled';
          item.state.active = false;
        }
      });
    }

    work.forEach((item) => {
      if (!item.accepted) return;
      const state = item.state;
      const nextGradient = gradientFromForces(item.accepted.forces);
      const s = Float64Array.from(state.positions,
        (value, index) => item.acceptedPositions[index] - value);
      const y = Float64Array.from(state.gradient,
        (value, index) => nextGradient[index] - value);
      const curvature = dot(s, y);
      if (curvature > 1e-8) {
        state.history.push({ s, y, rho:1 / curvature });
        if (state.history.length > 7) state.history.shift();
      }
      state.positions = item.acceptedPositions;
      state.evaluated = item.accepted;
      state.gradient = nextGradient;
      state.iterations = iteration;
      if (iteration % frameInterval === 0 || iteration === maximumIterations)
        state.frames.push({ step:iteration, energy:state.evaluated.energyKcalMol,
          positions:state.positions.slice() });
    });
    progress(id, `Batched ANI-2x refinement · iteration ${iteration}/${maximumIterations} · ${work.length} active…`,
      1, 0.08 + 0.86 * iteration / maximumIterations);
  }

  states.forEach((state) => {
    const statistics = forceStatistics(state.evaluated.forces);
    const converged = statistics.rms <= forceTolerance
      && statistics.maximum <= forceTolerance * 3;
    if (converged) state.reason = 'force tolerance';
    if (state.frames.at(-1).step !== state.iterations)
      state.frames.push({ step:state.iterations, energy:state.evaluated.energyKcalMol,
        positions:state.positions.slice() });
    state.converged = converged;
    state.rmsForce = statistics.rms;
    state.maximumForce = statistics.maximum;
  });
  return states;
}

function sampledOptimizationFrames(frames, count = CONFORMER_FRAME_COUNT) {
  if (!frames.length) throw new Error('ANI-2x minimization returned no trajectory frames');
  if (count === 1) return [frames.at(-1)];
  return Array.from({ length: count }, (_, index) => {
    const target = index * (frames.length - 1) / (count - 1);
    return frames[Math.round(target)];
  });
}

function conformerIterationLimit(options) {
  const effort = String(options.conformerEffort || 'balanced');
  const fallback = ({ quick: 20, balanced: 50, thorough: 100 })[effort] || 50;
  return Math.max(2, Math.min(150, Math.round(Number(
    options.aniConformerIterations ?? fallback,
  ))));
}

async function runConformerRefinement(message) {
  const { id, molecule, options = {} } = message;
  const started = performance.now();
  const stride = molecule.atoms.length * 3;
  const initialConformers = options.initialConformers;
  if (!ArrayBuffer.isView(initialConformers)
      || initialConformers.length < stride
      || initialConformers.length % stride !== 0)
    throw new Error('ANI-2x conformer refinement requires a packed coordinate stack');
  const replicaCount = initialConformers.length / stride;
  if (replicaCount > MAX_CONFORMER_COUNT)
    throw new Error(`ANI-2x conformer refinement is limited to ${MAX_CONFORMER_COUNT} seeds`);

  const evaluator = await createEvaluator(molecule, id, options);
  const setupMs = performance.now() - started;
  const searchStarted = performance.now();
  const maximumIterations = conformerIterationLimit(options);
  const frameCount = CONFORMER_FRAME_COUNT;
  const frameSteps = Int32Array.from({ length: frameCount }, (_, frame) => frame);
  const ensembleEnergies = new Float64Array(frameCount * replicaCount);
  const ensembleTrajectory = new Float32Array(frameCount * replicaCount * stride);
  const finalPositions = new Array(replicaCount);

  progress(id, `Batching ${replicaCount} conformers through ANI-2x…`, 1, 0.08);
  const calculations = await minimizeBatch(evaluator, initialConformers, stride,
    { ...options, maxIterations:maximumIterations }, id);
  calculations.forEach((calculation, replica) => {
    const frames = sampledOptimizationFrames(calculation.frames, frameCount);
    finalPositions[replica] = calculation.positions;
    frames.forEach((frame, frameIndex) => {
      const destination = (frameIndex * replicaCount + replica) * stride;
      ensembleTrajectory.set(frame.positions, destination);
      ensembleEnergies[frameIndex * replicaCount + replica] = frame.energy;
    });
  });

  const finalOffset = (frameCount - 1) * replicaCount;
  let bestReplica = 0;
  for (let replica = 1; replica < replicaCount; replica++) {
    if (ensembleEnergies[finalOffset + replica] < ensembleEnergies[finalOffset + bestReplica])
      bestReplica = replica;
  }
  const searchMs = performance.now() - searchStarted;
  const stageTimings = evaluator.stageTimings;
  const result = {
    type: 'result', id, job: 'conformers',
    positions: Float64Array.from(finalPositions[bestReplica]),
    initialEnergy: ensembleEnergies[bestReplica],
    finalEnergy: ensembleEnergies[finalOffset + bestReplica],
    elapsedMs: performance.now() - started,
    setupMs, searchMs,
    forcefield: 'TorchANI ANI-2x',
    model: 'ANI-2x ensemble (8 members)',
    modelEnvironment: 'vacuum',
    modelLevel: 'wB97X/6-31G(d)',
    modelSourceSha256: evaluator.model.stateDictSha256,
    platform: evaluator.provider,
    backend: 'ONNX Runtime Web',
    unit: 'kcal/mol',
    energyKind: 'total electronic energy',
    frameCount, frameSteps, replicaCount,
    ensembleEnergies, ensembleTrajectory,
    ensembleLayout: 'frame-replica-xyz',
    conformerStageLabels: [
      'Shared ETKDG + MMFF seed',
      'ANI-2x refinement 1/4',
      'ANI-2x refinement 2/4',
      'ANI-2x refinement 3/4',
      'ANI-2x refinement 4/4',
      'ANI-2x final geometry',
    ],
    conformerMinimizationIterations: maximumIterations,
    modelEvaluations: evaluator.evaluations,
    inferenceBatches: evaluator.inferenceBatches,
    inferenceBatchSize: replicaCount,
    aevBuildMs: stageTimings.aevBuildMs,
    networkMs: stageTimings.networkMs,
    forceContractionMs: stageTimings.forceContractionMs,
    descriptorBackend: stageTimings.descriptorBackend,
    descriptorFallbackReason: stageTimings.fallbackReason || null,
    constraintError: 0,
  };
  progress(id, 'ANI-2x conformer refinement complete', 1, 1);
  self.postMessage(result, [
    result.positions.buffer, frameSteps.buffer,
    ensembleEnergies.buffer, ensembleTrajectory.buffer,
  ]);
}

async function runCalculation(message) {
  const { id, job, molecule, options = {} } = message;
  if (!['energy', 'geometry'].includes(job))
    throw new Error('ANI-2x currently supports single-point energy and geometry optimization only');
  const started = performance.now();
  const evaluator = await createEvaluator(molecule, id, options);
  const initialPositions = moleculePositions(molecule);
  progress(id, 'Evaluating ANI-2x ensemble and analytical forces…', 1, 0.08);

  let calculation;
  if (job === 'geometry') calculation = await minimize(evaluator, initialPositions, options, id);
  else {
    const evaluated = await evaluator.evaluate(initialPositions);
    calculation = {
      initial: evaluated, final: evaluated, positions: initialPositions,
      frames: [{ step: 0, energy: evaluated.energyKcalMol, positions: initialPositions.slice() }],
      iterations: 0, reason: 'single point', converged: true,
      ...forceStatistics(evaluated.forces),
    };
  }
  const { frameEnergies, frameSteps, trajectory } = packedFrames(
    calculation.frames, molecule.atoms.length);
  const stageTimings = evaluator.stageTimings;
  const result = {
    type: 'result', id, job,
    initialEnergy: calculation.initial.energyKcalMol,
    finalEnergy: calculation.final.energyKcalMol,
    positions: calculation.positions,
    forces: calculation.final.forces,
    elapsedMs: performance.now() - started,
    forcefield: 'TorchANI ANI-2x',
    model: 'ANI-2x ensemble (8 members)',
    modelEnvironment: 'vacuum',
    modelLevel: 'wB97X/6-31G(d)',
    modelSourceSha256: evaluator.model.stateDictSha256,
    platform: evaluator.provider,
    backend: 'ONNX Runtime Web',
    unit: 'kcal/mol',
    energyKind: 'total electronic energy',
    frameCount: calculation.frames.length,
    frameEnergies, frameSteps, trajectory,
    converged: calculation.converged,
    convergenceReason: calculation.reason,
    iterations: calculation.iterations,
    rmsForce: calculation.rmsForce ?? calculation.rms,
    maximumForce: calculation.maximumForce ?? calculation.maximum,
    initialEnsembleStdDev: calculation.initial.ensembleStdDevKcalMol,
    finalEnsembleStdDev: calculation.final.ensembleStdDevKcalMol,
    modelEvaluations: evaluator.evaluations,
    inferenceBatches: evaluator.inferenceBatches,
    inferenceBatchSize: 1,
    aevBuildMs: stageTimings.aevBuildMs,
    networkMs: stageTimings.networkMs,
    forceContractionMs: stageTimings.forceContractionMs,
    descriptorBackend: stageTimings.descriptorBackend,
    descriptorFallbackReason: stageTimings.fallbackReason || null,
    supportedElements: evaluator.model.symbols,
  };
  progress(id, 'ANI-2x calculation complete', 1, 1);
  self.postMessage(result, [
    result.positions.buffer, result.forces.buffer, frameEnergies.buffer,
    frameSteps.buffer, trajectory.buffer,
  ]);
}

async function runBatchValidation(message) {
  const { id, molecule, options = {} } = message;
  const stride = molecule.atoms.length * 3;
  const packedPositions = options.packedPositions;
  if (!ArrayBuffer.isView(packedPositions) || packedPositions.length < stride
      || packedPositions.length % stride !== 0)
    throw new Error('ANI-2x batch validation requires a packed coordinate stack');
  const batchCount = packedPositions.length / stride;
  if (batchCount > MAX_CONFORMER_COUNT)
    throw new Error(`ANI-2x batch validation is limited to ${MAX_CONFORMER_COUNT} structures`);
  const evaluator = await createEvaluator(molecule, id, options);
  const positionBatch = Array.from({ length:batchCount }, (_, batch) =>
    packedPositions.subarray(batch * stride, (batch + 1) * stride));
  const evaluated = await evaluator.evaluateBatch(positionBatch);
  const energiesHartree = Float64Array.from(evaluated, (item) => item.energyHartree);
  const forces = new Float64Array(batchCount * stride);
  evaluated.forEach((item, batch) => forces.set(item.forces, batch * stride));
  const stageTimings = evaluator.stageTimings;
  const result = {
    type:'result', id, job:'batch-validation', batchCount,
    energiesHartree, forces, platform:evaluator.provider,
    aevBuildMs:stageTimings.aevBuildMs,
    networkMs:stageTimings.networkMs,
    forceContractionMs:stageTimings.forceContractionMs,
    descriptorBackend:stageTimings.descriptorBackend,
    descriptorFallbackReason:stageTimings.fallbackReason || null,
  };
  self.postMessage(result, [energiesHartree.buffer, forces.buffer]);
}

async function runBatchScore(message) {
  const { id, molecule, options = {} } = message;
  const started = performance.now();
  const stride = molecule.atoms.length * 3;
  const coordinateStack = options.coordinateStack;
  if (!ArrayBuffer.isView(coordinateStack) || coordinateStack.length < stride
      || coordinateStack.length % stride !== 0)
    throw new Error('ANI-2x batch rescore requires a packed coordinate stack');
  const coordinateCount = coordinateStack.length / stride;
  if (coordinateCount > MAX_SCORE_COORDINATES)
    throw new Error(`ANI-2x batch rescore is limited to ${MAX_SCORE_COORDINATES} structures`);
  const evaluator = await createEvaluator(molecule, id, options);
  const setupMs = performance.now() - started;
  const scoreStarted = performance.now();
  const energies = new Float64Array(coordinateCount);
  const ensembleStdDevs = new Float64Array(coordinateCount);
  const batchSize = Math.max(1, Math.min(MAX_CONFORMER_COUNT,
    Math.round(Number(options.batchSize || MAX_CONFORMER_COUNT))));
  for (let start = 0; start < coordinateCount; start += batchSize) {
    const end = Math.min(coordinateCount, start + batchSize);
    const positionBatch = Array.from({ length:end - start }, (_, local) => {
      const offset = (start + local) * stride;
      return coordinateStack.subarray(offset, offset + stride);
    });
    const evaluated = await evaluator.evaluateBatch(positionBatch, { includeForces:false });
    evaluated.forEach((item, local) => {
      energies[start + local] = item.energyKcalMol;
      ensembleStdDevs[start + local] = item.ensembleStdDevKcalMol;
    });
    progress(id, `ANI-2x common rescore · ${end}/${coordinateCount} candidates…`, 1,
      0.08 + 0.88 * end / coordinateCount);
  }
  if (![...energies].every(Number.isFinite))
    throw new Error('ANI-2x batch rescore returned an incomplete energy stack');
  const stageTimings = evaluator.stageTimings;
  const result = {
    type:'result', id, job:'score-batch', coordinateCount, energies, ensembleStdDevs,
    elapsedMs:performance.now() - started, setupMs, scoreMs:performance.now() - scoreStarted,
    forcefield:'TorchANI ANI-2x', model:'ANI-2x ensemble (8 members)',
    modelEnvironment:'vacuum',
    modelLevel:'wB97X/6-31G(d)', modelSourceSha256:evaluator.model.stateDictSha256,
    platform:evaluator.provider, backend:'ONNX Runtime Web', unit:'kcal/mol',
    energyKind:'total electronic energy', modelEvaluations:evaluator.evaluations,
    inferenceBatches:evaluator.inferenceBatches, inferenceBatchSize:batchSize,
    aevBuildMs:stageTimings.aevBuildMs, networkMs:stageTimings.networkMs,
    forceContractionMs:stageTimings.forceContractionMs,
    descriptorBackend:stageTimings.descriptorBackend,
    descriptorFallbackReason:stageTimings.fallbackReason || null,
  };
  progress(id, 'ANI-2x common rescore complete', 1, 1);
  self.postMessage(result, [energies.buffer, ensembleStdDevs.buffer]);
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'run') return;
  const task = event.data.job === 'conformers' ? runConformerRefinement(event.data)
    : event.data.job === 'batch-validation' ? runBatchValidation(event.data)
      : event.data.job === 'score-batch' ? runBatchScore(event.data)
      : runCalculation(event.data);
  task.catch((error) => {
    self.postMessage({
      type: 'error', id: event.data.id,
      message: `${event.data.job}: ${error instanceof Error ? error.message : String(error)}`,
    });
  });
});
