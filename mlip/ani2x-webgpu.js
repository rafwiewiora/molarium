const AEV_LENGTH = 1008;
const ENSEMBLE_SIZE = 8;

function wgslArray(values) {
  return values.map((value) => `${Number(value).toPrecision(9)}`).join(', ');
}

function shaderConstants(manifest) {
  return `
const PI: f32 = 3.14159265358979323846;
const AEV_LENGTH: u32 = 1008u;
const RADIAL_COUNT: u32 = 16u;
const ANGULAR_SHIFT_COUNT: u32 = 8u;
const ANGULAR_SECTION_COUNT: u32 = 4u;
const RADIAL_CUTOFF: f32 = ${Number(manifest.radial.cutoff).toPrecision(9)};
const RADIAL_ETA: f32 = ${Number(manifest.radial.eta).toPrecision(9)};
const ANGULAR_CUTOFF: f32 = ${Number(manifest.angular.cutoff).toPrecision(9)};
const ANGULAR_ETA: f32 = ${Number(manifest.angular.eta).toPrecision(9)};
const ANGULAR_ZETA: f32 = ${Number(manifest.angular.zeta).toPrecision(9)};
const RADIAL_SHIFTS = array<f32, 16>(${wgslArray(manifest.radial.shifts)});
const ANGULAR_SHIFTS = array<f32, 8>(${wgslArray(manifest.angular.shifts)});
const ANGULAR_SECTIONS = array<f32, 4>(${wgslArray(manifest.angular.sections)});

struct Dims {
  atom_count: u32,
  row_count: u32,
  batch_count: u32,
  reserved: u32,
}

fn position(batch: u32, atom: u32) -> vec3<f32> {
  let offset = (batch * dims.atom_count + atom) * 3u;
  return vec3<f32>(positions[offset], positions[offset + 1u], positions[offset + 2u]);
}

fn cutoff_value(distance: f32, radius: f32) -> f32 {
  return 0.5 * cos(PI * distance / radius) + 0.5;
}

fn cutoff_derivative(distance: f32, radius: f32) -> f32 {
  return -0.5 * PI / radius * sin(PI * distance / radius);
}

fn pair_index(first: u32, second: u32) -> u32 {
  let low = min(first, second);
  let high = max(first, second);
  return low * 7u - (low * (low - 1u)) / 2u + high - low;
}
`;
}

function aevShader(manifest) {
  return `${shaderConstants(manifest)}
@group(0) @binding(0) var<uniform> dims: Dims;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> species: array<u32>;
@group(0) @binding(3) var<storage, read> row_atoms: array<u32>;
@group(0) @binding(4) var<storage, read_write> aevs: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let row = gid.x;
  let total_rows = dims.row_count * dims.batch_count;
  if (row >= total_rows) { return; }
  let batch = row / dims.row_count;
  let center = row_atoms[row % dims.row_count];
  let output_base = row * AEV_LENGTH;
  for (var feature = 0u; feature < AEV_LENGTH; feature++) {
    aevs[output_base + feature] = 0.0;
  }
  let center_position = position(batch, center);
  for (var neighbor = 0u; neighbor < dims.atom_count; neighbor++) {
    if (neighbor == center) { continue; }
    let vector = position(batch, neighbor) - center_position;
    let distance = length(vector);
    if (distance > 1.0e-5 && distance < RADIAL_CUTOFF) {
      let fc = cutoff_value(distance, RADIAL_CUTOFF);
      let base = output_base + species[neighbor] * RADIAL_COUNT;
      for (var shift = 0u; shift < RADIAL_COUNT; shift++) {
        let delta = distance - RADIAL_SHIFTS[shift];
        aevs[base + shift] += 0.25 * exp(-RADIAL_ETA * delta * delta) * fc;
      }
    }
  }
  for (var first = 0u; first < dims.atom_count; first++) {
    if (first == center) { continue; }
    let one_vector = position(batch, first) - center_position;
    let one_distance = length(one_vector);
    if (!(one_distance > 1.0e-5 && one_distance < ANGULAR_CUTOFF)) { continue; }
    let one_unit = one_vector / one_distance;
    let cutoff_one = cutoff_value(one_distance, ANGULAR_CUTOFF);
    for (var second = first + 1u; second < dims.atom_count; second++) {
      if (second == center) { continue; }
      let two_vector = position(batch, second) - center_position;
      let two_distance = length(two_vector);
      if (!(two_distance > 1.0e-5 && two_distance < ANGULAR_CUTOFF)) { continue; }
      let two_unit = two_vector / two_distance;
      let cutoff_two = cutoff_value(two_distance, ANGULAR_CUTOFF);
      let cosine = clamp(dot(one_unit, two_unit), -1.0, 1.0);
      let angle = acos(0.95 * cosine);
      let mean_distance = 0.5 * (one_distance + two_distance);
      let pair = pair_index(species[first], species[second]);
      let base = output_base + 112u + pair * 32u;
      for (var shift = 0u; shift < ANGULAR_SHIFT_COUNT; shift++) {
        let radial_delta = mean_distance - ANGULAR_SHIFTS[shift];
        let radial = exp(-ANGULAR_ETA * radial_delta * radial_delta);
        for (var section = 0u; section < ANGULAR_SECTION_COUNT; section++) {
          let half_cosine = 0.5 * (1.0 + cos(angle - ANGULAR_SECTIONS[section]));
          let angular = 2.0 * pow(half_cosine, ANGULAR_ZETA);
          aevs[base + shift * ANGULAR_SECTION_COUNT + section] +=
            radial * angular * cutoff_one * cutoff_two;
        }
      }
    }
  }
}`;
}

const SCATTER_SHADER = `
struct Dims { atom_count:u32, row_count:u32, batch_count:u32, reserved:u32 }
@group(0) @binding(0) var<uniform> dims: Dims;
@group(0) @binding(1) var<storage, read> source: array<f32>;
@group(0) @binding(2) var<storage, read> row_atoms: array<u32>;
@group(0) @binding(3) var<storage, read_write> destination: array<f32>;
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let scalar = gid.x;
  let total = dims.batch_count * dims.row_count * 1008u;
  if (scalar >= total) { return; }
  let row = scalar / 1008u;
  let feature = scalar % 1008u;
  let batch = row / dims.row_count;
  let atom = row_atoms[row % dims.row_count];
  destination[(batch * dims.atom_count + atom) * 1008u + feature] = source[scalar];
}`;

function contractionShader(manifest) {
  return `${shaderConstants(manifest)}
@group(0) @binding(0) var<uniform> dims: Dims;
@group(0) @binding(1) var<storage, read> positions: array<f32>;
@group(0) @binding(2) var<storage, read> species: array<u32>;
@group(0) @binding(3) var<storage, read> gradients: array<f32>;
@group(0) @binding(4) var<storage, read_write> partial: array<f32>;

fn add_partial(batch: u32, center: u32, atom: u32, value: vec3<f32>) {
  let offset = ((batch * dims.atom_count + center) * dims.atom_count + atom) * 3u;
  partial[offset] += value.x;
  partial[offset + 1u] += value.y;
  partial[offset + 2u] += value.z;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  let total = dims.batch_count * dims.atom_count;
  if (index >= total) { return; }
  let batch = index / dims.atom_count;
  let center = index % dims.atom_count;
  let partial_base = index * dims.atom_count * 3u;
  for (var scalar = 0u; scalar < dims.atom_count * 3u; scalar++) {
    partial[partial_base + scalar] = 0.0;
  }
  let gradient_base = index * AEV_LENGTH;
  let center_position = position(batch, center);
  for (var neighbor = 0u; neighbor < dims.atom_count; neighbor++) {
    if (neighbor == center) { continue; }
    let vector = position(batch, neighbor) - center_position;
    let distance = length(vector);
    if (distance > 1.0e-5 && distance < RADIAL_CUTOFF) {
      let unit = vector / distance;
      let fc = cutoff_value(distance, RADIAL_CUTOFF);
      let dfc = cutoff_derivative(distance, RADIAL_CUTOFF);
      let base = gradient_base + species[neighbor] * RADIAL_COUNT;
      var derivative = 0.0;
      for (var shift = 0u; shift < RADIAL_COUNT; shift++) {
        let delta = distance - RADIAL_SHIFTS[shift];
        let radial = 0.25 * exp(-RADIAL_ETA * delta * delta);
        derivative += gradients[base + shift] * radial *
          (-2.0 * RADIAL_ETA * delta * fc + dfc);
      }
      add_partial(batch, center, neighbor, derivative * unit);
      add_partial(batch, center, center, -derivative * unit);
    }
  }
  for (var first = 0u; first < dims.atom_count; first++) {
    if (first == center) { continue; }
    let one_vector = position(batch, first) - center_position;
    let one_distance = length(one_vector);
    if (!(one_distance > 1.0e-5 && one_distance < ANGULAR_CUTOFF)) { continue; }
    let one_unit = one_vector / one_distance;
    let cutoff_one = cutoff_value(one_distance, ANGULAR_CUTOFF);
    let cutoff_one_derivative = cutoff_derivative(one_distance, ANGULAR_CUTOFF);
    for (var second = first + 1u; second < dims.atom_count; second++) {
      if (second == center) { continue; }
      let two_vector = position(batch, second) - center_position;
      let two_distance = length(two_vector);
      if (!(two_distance > 1.0e-5 && two_distance < ANGULAR_CUTOFF)) { continue; }
      let two_unit = two_vector / two_distance;
      let cutoff_two = cutoff_value(two_distance, ANGULAR_CUTOFF);
      let cutoff_two_derivative = cutoff_derivative(two_distance, ANGULAR_CUTOFF);
      let cosine = clamp(dot(one_unit, two_unit), -1.0, 1.0);
      let scaled_cosine = 0.95 * cosine;
      let angle = acos(scaled_cosine);
      let inverse_angle_sine = inverseSqrt(max(1.0e-12, 1.0 - scaled_cosine * scaled_cosine));
      let mean_distance = 0.5 * (one_distance + two_distance);
      let pair = pair_index(species[first], species[second]);
      let base = gradient_base + 112u + pair * 32u;
      var derivative_one = 0.0;
      var derivative_two = 0.0;
      var derivative_cosine = 0.0;
      for (var shift = 0u; shift < ANGULAR_SHIFT_COUNT; shift++) {
        let radial_delta = mean_distance - ANGULAR_SHIFTS[shift];
        let radial = exp(-ANGULAR_ETA * radial_delta * radial_delta);
        let radial_derivative = -ANGULAR_ETA * radial_delta * radial;
        for (var section = 0u; section < ANGULAR_SECTION_COUNT; section++) {
          let delta = angle - ANGULAR_SECTIONS[section];
          let half_cosine = 0.5 * (1.0 + cos(delta));
          let angular = 2.0 * pow(half_cosine, ANGULAR_ZETA);
          let angular_cosine_derivative = 0.95 * ANGULAR_ZETA *
            pow(half_cosine, ANGULAR_ZETA - 1.0) * sin(delta) * inverse_angle_sine;
          let gradient = gradients[base + shift * ANGULAR_SECTION_COUNT + section];
          derivative_one += gradient * angular * cutoff_two *
            (radial_derivative * cutoff_one + radial * cutoff_one_derivative);
          derivative_two += gradient * angular * cutoff_one *
            (radial_derivative * cutoff_two + radial * cutoff_two_derivative);
          derivative_cosine += gradient * radial * cutoff_one * cutoff_two *
            angular_cosine_derivative;
        }
      }
      let cosine_one = (two_unit - cosine * one_unit) / one_distance;
      let cosine_two = (one_unit - cosine * two_unit) / two_distance;
      let gradient_one = derivative_one * one_unit + derivative_cosine * cosine_one;
      let gradient_two = derivative_two * two_unit + derivative_cosine * cosine_two;
      add_partial(batch, center, first, gradient_one);
      add_partial(batch, center, second, gradient_two);
      add_partial(batch, center, center, -(gradient_one + gradient_two));
    }
  }
}`;
}

const REDUCE_SHADER = `
struct Dims { atom_count:u32, row_count:u32, batch_count:u32, reserved:u32 }
@group(0) @binding(0) var<uniform> dims: Dims;
@group(0) @binding(1) var<storage, read> partial: array<f32>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let scalar = gid.x;
  let total = dims.batch_count * dims.atom_count * 3u;
  if (scalar >= total) { return; }
  let batch = scalar / (dims.atom_count * 3u);
  let local = scalar % (dims.atom_count * 3u);
  let atom = local / 3u;
  let component = local % 3u;
  var value = 0.0;
  for (var center = 0u; center < dims.atom_count; center++) {
    let offset = ((batch * dims.atom_count + center) * dims.atom_count + atom) * 3u + component;
    value += partial[offset];
  }
  output[scalar] = value;
}`;

function bufferSize(byteLength) {
  return Math.max(4, Math.ceil(byteLength / 4) * 4);
}

function assertBufferSize(device, size, label) {
  if (!Number.isSafeInteger(size) || size <= 0)
    throw new Error(`ANI-2x WebGPU ${label} has an invalid byte size`);
  if (size > Number(device.limits.maxStorageBufferBindingSize))
    throw new Error(`ANI-2x WebGPU ${label} exceeds maxStorageBufferBindingSize`);
  if (size > Number(device.limits.maxBufferSize))
    throw new Error(`ANI-2x WebGPU ${label} exceeds maxBufferSize`);
}

function storageBuffer(device, byteLength, label, extraUsage = 0) {
  const size = bufferSize(byteLength);
  assertBufferSize(device, size, label);
  return device.createBuffer({
    label: `ANI-2x ${label}`,
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      | GPUBufferUsage.COPY_SRC | extraUsage,
  });
}

function uniformBuffer(device, values) {
  const buffer = device.createBuffer({
    label: 'ANI-2x dimensions', size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, values);
  return buffer;
}

async function pipeline(device, label, code) {
  device.pushErrorScope('validation');
  const module = device.createShaderModule({ label, code });
  const result = await device.createComputePipelineAsync({
    label, layout:'auto', compute:{ module, entryPoint:'main' },
  });
  const error = await device.popErrorScope();
  if (error) throw new Error(`${label}: ${error.message}`);
  return result;
}

function bindGroup(device, computePipeline, entries) {
  return device.createBindGroup({
    layout:computePipeline.getBindGroupLayout(0),
    entries:entries.map((resource, binding) => ({ binding, resource:{ buffer:resource } })),
  });
}

function encodeDispatch(encoder, computePipeline, bindings, count, workgroupSize) {
  const pass = encoder.beginComputePass();
  pass.setPipeline(computePipeline);
  pass.setBindGroup(0, bindings);
  pass.dispatchWorkgroups(Math.ceil(count / workgroupSize));
  pass.end();
}

function validateOutputTensor(tensor, rows, width, name) {
  if (!tensor || tensor.location !== 'gpu-buffer')
    throw new Error(`ANI-2x ${name} did not remain in a WebGPU buffer`);
  if (tensor.type !== 'float32' || tensor.dims.length !== 2
      || Number(tensor.dims[0]) !== rows || Number(tensor.dims[1]) !== width)
    throw new Error(`ANI-2x ${name} returned an invalid GPU tensor shape`);
  const expectedBytes = rows * width * 4;
  if (!tensor.gpuBuffer || tensor.gpuBuffer.size < expectedBytes
      || !(tensor.gpuBuffer.usage & GPUBufferUsage.STORAGE))
    throw new Error(`ANI-2x ${name} returned an incompatible WebGPU buffer`);
}

export class Ani2xWebGpuEvaluator {
  static async create(device, species, groups, manifest, ort) {
    if (!device || typeof device.createBuffer !== 'function' || !ort?.Tensor?.fromGpuBuffer)
      throw new Error('ANI-2x WebGPU buffer interop is unavailable');
    if (manifest?.aevLength !== AEV_LENGTH || manifest?.ensembleSize !== ENSEMBLE_SIZE)
      throw new Error('ANI-2x WebGPU received an unsupported model shape');
    const instance = new Ani2xWebGpuEvaluator(device, species, groups, manifest, ort);
    await instance.initialize();
    return instance;
  }

  constructor(device, species, groups, manifest, ort) {
    this.device = device;
    this.species = species;
    this.groups = groups;
    this.manifest = manifest;
    this.ort = ort;
    this.atomCount = species.length;
    this.rowAtomBuffers = new Map();
    this.timings = { aevBuildMs:0, networkMs:0, forceContractionMs:0 };
  }

  async initialize() {
    this.aevPipeline = await pipeline(this.device, 'ANI-2x AEV construction', aevShader(this.manifest));
    this.scatterPipeline = await pipeline(this.device, 'ANI-2x AEV gradient scatter', SCATTER_SHADER);
    this.contractionPipeline = await pipeline(this.device, 'ANI-2x force contraction', contractionShader(this.manifest));
    this.reducePipeline = await pipeline(this.device, 'ANI-2x force reduction', REDUCE_SHADER);
    this.speciesBuffer = storageBuffer(this.device, this.atomCount * 4, 'species');
    this.device.queue.writeBuffer(this.speciesBuffer, 0, Uint32Array.from(this.species));
    for (const [element, atomIndices] of this.groups) {
      const buffer = storageBuffer(this.device, atomIndices.length * 4, `${element} atom rows`);
      this.device.queue.writeBuffer(buffer, 0, Uint32Array.from(atomIndices));
      this.rowAtomBuffers.set(element, buffer);
    }
    await this.device.queue.onSubmittedWorkDone();
  }

  destroyBuffers(buffers) {
    for (const buffer of buffers) buffer?.destroy?.();
  }

  async evaluate(positionBatch, loaded, memberEnergies, evaluationOptions = {}) {
    const includeForces = evaluationOptions.includeForces !== false;
    const batchCount = positionBatch.length;
    const positionValues = new Float32Array(batchCount * this.atomCount * 3);
    positionBatch.forEach((positions, batch) => {
      if (!ArrayBuffer.isView(positions) || positions.length !== this.atomCount * 3)
        throw new Error('ANI-2x WebGPU received an invalid coordinate batch');
      for (let index = 0; index < positions.length; index++) {
        const value = Number(positions[index]);
        if (!Number.isFinite(value)) throw new Error('ANI-2x WebGPU received non-finite coordinates');
        positionValues[batch * positions.length + index] = value;
      }
    });
    const owned = [];
    const gradientOutputs = [];
    try {
      const positionsBuffer = storageBuffer(this.device, positionValues.byteLength, 'positions');
      owned.push(positionsBuffer);
      this.device.queue.writeBuffer(positionsBuffer, 0, positionValues);
      const aevInputs = new Map();
      const aevStarted = performance.now();
      const aevEncoder = this.device.createCommandEncoder({ label:'ANI-2x AEV batch' });
      for (const [element, atomIndices] of this.groups) {
        const rows = batchCount * atomIndices.length;
        const output = storageBuffer(this.device, rows * AEV_LENGTH * 4, `${element} AEV batch`);
        const dims = uniformBuffer(this.device, new Uint32Array([
          this.atomCount, atomIndices.length, batchCount, 0,
        ]));
        owned.push(output, dims);
        const bindings = bindGroup(this.device, this.aevPipeline, [
          dims, positionsBuffer, this.speciesBuffer, this.rowAtomBuffers.get(element), output,
        ]);
        encodeDispatch(aevEncoder, this.aevPipeline, bindings, rows, 64);
        aevInputs.set(element, output);
      }
      this.device.queue.submit([aevEncoder.finish()]);
      await this.device.queue.onSubmittedWorkDone();
      this.timings.aevBuildMs += performance.now() - aevStarted;

      const networkStarted = performance.now();
      for (const [element, atomIndices] of this.groups) {
        const rows = batchCount * atomIndices.length;
        const inputBuffer = aevInputs.get(element);
        const inputTensor = this.ort.Tensor.fromGpuBuffer(inputBuffer, {
          dataType:'float32', dims:[rows, AEV_LENGTH],
        });
        let outputs;
        try {
          outputs = includeForces
            ? await loaded.get(element).session.run({ aev:inputTensor })
            : await loaded.get(element).session.run(
              { aev:inputTensor }, ['member_atomic_energies']);
        } finally {
          // fromGpuBuffer treats this as an external resource: disposal releases
          // ORT's registration without destroying our buffer.
          inputTensor.dispose();
        }
        const energyTensor = outputs.member_atomic_energies;
        const gradientTensor = outputs.aev_gradients;
        validateOutputTensor(energyTensor, rows, ENSEMBLE_SIZE, `${element} atomic energies`);
        if (includeForces)
          validateOutputTensor(gradientTensor, rows, AEV_LENGTH, `${element} AEV gradients`);
        const atomicEnergies = await energyTensor.getData();
        if (!(atomicEnergies instanceof Float32Array)
            || atomicEnergies.length !== rows * ENSEMBLE_SIZE)
          throw new Error(`ANI-2x ${element} returned invalid atomic energies`);
        positionBatch.forEach((_, batch) => atomIndices.forEach((atom, localRow) => {
          const row = batch * atomIndices.length + localRow;
          for (let member = 0; member < ENSEMBLE_SIZE; member++)
            memberEnergies[batch][member] += atomicEnergies[row * ENSEMBLE_SIZE + member];
        }));
        energyTensor.dispose();
        if (includeForces) gradientOutputs.push({ element, atomIndices, tensor:gradientTensor });
      }
      this.timings.networkMs += performance.now() - networkStarted;

      if (!includeForces) return null;

      const contractionStarted = performance.now();
      const fullGradientBytes = batchCount * this.atomCount * AEV_LENGTH * 4;
      const fullGradients = storageBuffer(this.device, fullGradientBytes, 'full AEV gradients');
      const partialBytes = batchCount * this.atomCount * this.atomCount * 3 * 4;
      const partial = storageBuffer(this.device, partialBytes, 'partial Cartesian gradients');
      const coordinateBytes = batchCount * this.atomCount * 3 * 4;
      const coordinateGradients = storageBuffer(this.device, coordinateBytes, 'Cartesian gradients');
      const readback = this.device.createBuffer({
        label:'ANI-2x Cartesian gradient readback', size:bufferSize(coordinateBytes),
        usage:GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      owned.push(fullGradients, partial, coordinateGradients, readback);
      const encoder = this.device.createCommandEncoder({ label:'ANI-2x gradient contraction' });
      for (const { element, atomIndices, tensor } of gradientOutputs) {
        const dims = uniformBuffer(this.device, new Uint32Array([
          this.atomCount, atomIndices.length, batchCount, 0,
        ]));
        owned.push(dims);
        const bindings = bindGroup(this.device, this.scatterPipeline, [
          dims, tensor.gpuBuffer, this.rowAtomBuffers.get(element), fullGradients,
        ]);
        encodeDispatch(encoder, this.scatterPipeline, bindings,
          batchCount * atomIndices.length * AEV_LENGTH, 128);
      }
      const dims = uniformBuffer(this.device, new Uint32Array([
        this.atomCount, 0, batchCount, 0,
      ]));
      owned.push(dims);
      encodeDispatch(encoder, this.contractionPipeline,
        bindGroup(this.device, this.contractionPipeline,
          [dims, positionsBuffer, this.speciesBuffer, fullGradients, partial]),
        batchCount * this.atomCount, 64);
      encodeDispatch(encoder, this.reducePipeline,
        bindGroup(this.device, this.reducePipeline, [dims, partial, coordinateGradients]),
        batchCount * this.atomCount * 3, 128);
      encoder.copyBufferToBuffer(coordinateGradients, 0, readback, 0, coordinateBytes);
      this.device.pushErrorScope('validation');
      this.device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const validationError = await this.device.popErrorScope();
      if (validationError) throw new Error(`ANI-2x WebGPU contraction: ${validationError.message}`);
      const coordinateGradient = new Float32Array(
        readback.getMappedRange().slice(0, coordinateBytes));
      readback.unmap();
      this.timings.forceContractionMs += performance.now() - contractionStarted;
      return Array.from({ length:batchCount }, (_, batch) => coordinateGradient.slice(
        batch * this.atomCount * 3, (batch + 1) * this.atomCount * 3));
    } finally {
      for (const { tensor } of gradientOutputs) tensor.dispose?.();
      this.destroyBuffers(owned);
    }
  }
}
