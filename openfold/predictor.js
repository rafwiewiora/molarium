import * as ort from '../vendor/onnxruntime-web/ort.webgpu.bundle.min.mjs';
import {
  buildOpenFoldFeatures, mergeA3mDocuments, normalizeProteinSequence, predictedAtoms,
  predictionToPdb, selectOpenFoldBucket,
} from './features.js';

const configuredAssetBase = globalThis.MOLARIUM_RUNTIME_CONFIG?.assetBase;
const DEFAULT_MODEL_ROOT = configuredAssetBase
  ? new URL('openfold-export-results/trained/models', configuredAssetBase).href
  : new URL('../openfold-export-results/trained/models', import.meta.url).href;
const ORT_WASM_ROOT = configuredAssetBase
  ? new URL('onnxruntime-web/1.27.0/', configuredAssetBase).href
  : new URL('../node_modules/onnxruntime-web/dist/', import.meta.url).href;
const sessionCache = new Map();

export function createProteinPredictionRequest(sequence, { id = 'A' } = {}) {
  return Object.freeze({
    schema: 'molarium.fold-request.v1',
    entities: Object.freeze([{ id, type: 'protein', sequence: normalizeProteinSequence(sequence) }]),
  });
}

function disposeTensor(tensor) {
  try { tensor?.dispose?.(); }
  catch { /* a released ORT tensor needs no further cleanup */ }
}

async function tensorValues(tensor) {
  try { return tensor.data; }
  catch { return tensor.getData(); }
}

function tensorFeeds(features) {
  return Object.fromEntries(Object.entries(features).map(([name, value]) =>
    [name, new ort.Tensor(value.type, value.data, value.dims)]));
}

function emptyRecyclingInputs(residues) {
  return {
    m_1_prev: new ort.Tensor('float32', new Float32Array(residues * 256), [1, residues, 256]),
    z_prev: new ort.Tensor('float32', new Float32Array(residues * residues * 128), [1, residues, residues, 128]),
    x_prev: new ort.Tensor('float32', new Float32Array(residues * 37 * 3), [1, residues, 37, 3]),
  };
}

function providerForBrowser(preferred) {
  if (preferred) return preferred;
  return typeof navigator !== 'undefined' && navigator.gpu ? 'webgpu' : 'wasm';
}

function modelFiles(residues) {
  return residues === 64
    ? { graph: 'iteration_L64.onnx', external: 'iteration.onnx.data' }
    : { graph: `iteration_L${residues}.onnx`, external: `iteration_L${residues}.onnx.data` };
}

async function createSession(modelRoot, provider, bucket, onProgress) {
  ort.env.logLevel = 'warning';
  ort.env.wasm.wasmPaths = ORT_WASM_ROOT;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const files = modelFiles(bucket.residues);
  onProgress({ stage: 'model', message: `Loading trained OpenFold L${bucket.residues} model (~540 MB) for ${provider.toUpperCase()}…` });
  return ort.InferenceSession.create(`${modelRoot}/${files.graph}`, {
    executionProviders: [provider],
    graphOptimizationLevel: 'all',
    externalData: [{ path: 'iteration.onnx.data', data: `${modelRoot}/${files.external}` }],
  });
}

function evictOtherBuckets(modelRoot, bucket) {
  const keepPrefix = `${modelRoot}|L${bucket.residues}|`;
  for (const [key, sessionPromise] of sessionCache) {
    if (!key.startsWith(`${modelRoot}|L`) || key.startsWith(keepPrefix)) continue;
    sessionCache.delete(key);
    sessionPromise.then((session) => session.release()).catch(() => {});
  }
}

async function getSession(modelRoot, preferredProvider, bucket, onProgress) {
  evictOtherBuckets(modelRoot, bucket);
  let provider = providerForBrowser(preferredProvider);
  const key = `${modelRoot}|L${bucket.residues}|${provider}`;
  if (!sessionCache.has(key)) sessionCache.set(key, createSession(modelRoot, provider, bucket, onProgress));
  try {
    return { session: await sessionCache.get(key), provider };
  } catch (error) {
    sessionCache.delete(key);
    if (provider !== 'webgpu') throw error;
    provider = 'wasm';
    onProgress({ stage: 'model', message: 'WebGPU initialization failed; falling back to WASM…' });
    const fallbackKey = `${modelRoot}|L${bucket.residues}|${provider}`;
    if (!sessionCache.has(fallbackKey)) sessionCache.set(fallbackKey, createSession(modelRoot, provider, bucket, onProgress));
    return { session: await sessionCache.get(fallbackKey), provider };
  }
}

export class BrowserOpenFoldBackend {
  constructor({ modelRoot = DEFAULT_MODEL_ROOT, provider, recycles = 3 } = {}) {
    this.modelRoot = modelRoot.replace(/\/$/, '');
    this.preferredProvider = provider;
    this.recycles = recycles;
  }

  async predict(request, msa, { signal, onProgress = () => {} } = {}) {
    const proteins = request?.entities?.filter((entity) => entity.type === 'protein') || [];
    if (proteins.length !== 1 || request.entities.length !== 1)
      throw new Error('This OpenFold 2 model accepts one protein entity. The API can add OpenFold3 entity types later.');
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    const sequence = normalizeProteinSequence(proteins[0].sequence);
    const bucket = selectOpenFoldBucket(sequence.length);
    const alignments = mergeA3mDocuments(msa.documents, sequence);
    const { session, provider } = await getSession(this.modelRoot, this.preferredProvider, bucket, onProgress);
    const started = performance.now();
    let previous = emptyRecyclingInputs(bucket.residues);
    let finalOutputs;
    try {
      for (let cycle = 0; cycle < this.recycles; cycle++) {
        if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
        const featureBundle = buildOpenFoldFeatures({ sequence, alignments, bucket,
          seed: 0x4f50464c + cycle * 0x9e3779b1 });
        const features = tensorFeeds(featureBundle.features);
        onProgress({ stage: 'folding', cycle: cycle + 1, cycles: this.recycles,
          message: `Folding locally · recycle ${cycle + 1}/${this.recycles}…`, provider });
        const outputs = await session.run({ ...features, ...previous });
        Object.values(features).forEach(disposeTensor);
        Object.values(previous).forEach(disposeTensor);
        if (cycle + 1 < this.recycles) {
          disposeTensor(outputs.atom_mask); disposeTensor(outputs.plddt);
          disposeTensor(outputs.ptm); disposeTensor(outputs.pae);
          previous = { m_1_prev: outputs.m_1_next, z_prev: outputs.z_next, x_prev: outputs.atom_positions };
        } else {
          finalOutputs = outputs;
          previous = {};
        }
      }

      onProgress({ stage: 'finalizing', message: 'Preparing coordinates and confidence…', provider });
      const [positionsRaw, maskRaw, plddtRaw, ptmRaw, paeRaw] = await Promise.all([
        tensorValues(finalOutputs.atom_positions), tensorValues(finalOutputs.atom_mask),
        tensorValues(finalOutputs.plddt), tensorValues(finalOutputs.ptm), tensorValues(finalOutputs.pae),
      ]);
      const positions = positionsRaw.slice();
      const mask = maskRaw.slice();
      const plddt = plddtRaw.slice(0, sequence.length);
      const paeFull = paeRaw;
      const pae = new Float32Array(sequence.length * sequence.length);
      for (let row = 0; row < sequence.length; row++)
        for (let column = 0; column < sequence.length; column++)
          pae[row * sequence.length + column] = paeFull[row * bucket.residues + column];
      const ptm = Number(ptmRaw[0]);
      const meanPlddt = [...plddt].reduce((total, value) => total + value, 0) / plddt.length;
      const elapsedMs = performance.now() - started;
      const result = {
        schema: 'molarium.fold-result.v1', model: 'OpenFold model_3_ptm · finetuning_no_templ_ptm_1',
        sequence, provider, recycles: this.recycles, bucketResidues: bucket.residues,
        msaDepth: alignments.length,
        positions, atomMask: mask, plddt, ptm, pae, meanPlddt, elapsedMs,
      };
      result.atoms = predictedAtoms(sequence, positions, mask, plddt);
      result.pdb = predictionToPdb(sequence, positions, mask, plddt);
      onProgress({ stage: 'complete', message: 'Local fold complete', provider });
      return result;
    } finally {
      Object.values(previous).forEach(disposeTensor);
      if (finalOutputs) Object.values(finalOutputs).forEach(disposeTensor);
    }
  }
}

export async function foldProtein({ sequence, msaProvider, backend = new BrowserOpenFoldBackend(), signal,
  onProgress = () => {} }) {
  const request = createProteinPredictionRequest(sequence);
  const msa = await msaProvider.search(request, { signal, onProgress });
  return backend.predict(request, msa, { signal, onProgress });
}

export function clearOpenFoldSessionCache() {
  for (const promise of sessionCache.values()) promise.then((session) => session.release()).catch(() => {});
  sessionCache.clear();
}
