import { mkdtemp, rm } from 'node:fs/promises';
import { arch, cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';

const argument = (name) => {
  const inline = Bun.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
};
const csv = (value, fallback) => String(value || fallback).split(',').map((item) => item.trim()).filter(Boolean);
const integer = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const positiveNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const suffix = process.pid % 5000;
const appPort = 45000 + suffix;
const debugPort = 50000 + suffix;
const externalAppUrl = Bun.env.MOLARIUM_BENCH_URL;
const appUrl = new URL(externalAppUrl || `http://localhost:${appPort}/`).href;
const chromePath = Bun.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome');
const config = Object.freeze({
  fixtureUrl: argument('fixture') || Bun.env.ROSEMARY_BENCH_FIXTURE || './openff/rosemary-trp-cage.json',
  implicitSolvent: argument('implicit-solvent') || Bun.env.ROSEMARY_BENCH_IMPLICIT_SOLVENT || 'vacuum',
  constraintMode: argument('constraints') || Bun.env.ROSEMARY_BENCH_CONSTRAINTS || 'none',
  cutoffNm: positiveNumber(argument('cutoff-nm') || Bun.env.ROSEMARY_BENCH_CUTOFF_NM, 0),
  backends: csv(argument('backends') || Bun.env.ROSEMARY_BENCH_BACKENDS, 'openmm,webgpu'),
  energyRepeats: integer(argument('energy-repeats') || Bun.env.ROSEMARY_BENCH_ENERGY_REPEATS, 3),
  mdRepeats: integer(argument('md-repeats') || Bun.env.ROSEMARY_BENCH_MD_REPEATS, 1),
  mdSteps: csv(argument('md-steps') || Bun.env.ROSEMARY_BENCH_MD_STEPS, '250,1000').map(Number)
    .filter((value) => Number.isInteger(value) && value > 0),
  savedFrameCount: integer(argument('saved-frames') || Bun.env.ROSEMARY_BENCH_SAVED_FRAMES, 2),
  webgpuTimestepFs: positiveNumber(
    argument('webgpu-timestep-fs') || Bun.env.ROSEMARY_BENCH_WEBGPU_TIMESTEP_FS,
  ),
});

if (!config.backends.length || !config.mdSteps.length)
  throw new Error('At least one backend and one positive MD step count are required');
if (config.backends.some((backend) => !['openmm', 'webgpu'].includes(backend)))
  throw new Error('Backends must be openmm and/or webgpu');

const profile = await mkdtemp(join(tmpdir(), 'molarium-rosemary-benchmark-'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server;
let chrome;
let client;

async function waitFor(check, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch { /* Processes and their HTTP endpoints may still be starting. */ }
    await delay(100);
  }
  throw new Error('Timed out waiting for a browser benchmark dependency');
}

class DevToolsClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket.close(); }
}

const browserSuite = String.raw`(async (config) => {
  const api = window.molariumTest;
  if (!api) throw new Error('Molarium test API is unavailable');

  const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const summarize = (samples, steps) => {
    const workerStepsPerSecond = steps ? steps * 1000 / median(samples.map((sample) => sample.elapsedMs)) : null;
    const wallStepsPerSecond = steps ? steps * 1000 / median(samples.map((sample) => sample.wallElapsedMs)) : null;
    const timestepFs = samples[0]?.timestepFs ?? null;
    return {
      sampleCount: samples.length,
      workerElapsedMs: {
        min: Math.min(...samples.map((sample) => sample.elapsedMs)),
        median: median(samples.map((sample) => sample.elapsedMs)),
        max: Math.max(...samples.map((sample) => sample.elapsedMs)),
      },
      wallElapsedMs: {
        min: Math.min(...samples.map((sample) => sample.wallElapsedMs)),
        median: median(samples.map((sample) => sample.wallElapsedMs)),
        max: Math.max(...samples.map((sample) => sample.wallElapsedMs)),
      },
      stepsPerSecond: steps ? {
        workerMedian: workerStepsPerSecond,
        wallMedian: wallStepsPerSecond,
      } : null,
      simulatedNanosecondsPerDay: steps && timestepFs ? {
        workerMedian: workerStepsPerSecond * timestepFs * 86400 / 1e6,
        wallMedian: wallStepsPerSecond * timestepFs * 86400 / 1e6,
      } : null,
      samples,
    };
  };

  const browserMetadata = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGiB: navigator.deviceMemory || null,
    crossOriginIsolated: self.crossOriginIsolated,
    webgpu: null,
    webgl: null,
  };
  if (navigator.userAgentData?.getHighEntropyValues) {
    try {
      browserMetadata.userAgentData = await navigator.userAgentData.getHighEntropyValues([
        'architecture', 'bitness', 'fullVersionList', 'model', 'platformVersion', 'wow64',
      ]);
    } catch { /* Metadata is optional. */ }
  }
  try {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (adapter) {
      const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
      browserMetadata.webgpu = {
        vendor: info.vendor || null,
        architecture: info.architecture || null,
        device: info.device || null,
        description: info.description || null,
        fallbackAdapter: info.isFallbackAdapter ?? null,
        limits: {
          maxBufferSize: adapter.limits.maxBufferSize,
          maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
          maxComputeWorkgroupsPerDimension: adapter.limits.maxComputeWorkgroupsPerDimension,
        },
      };
    }
  } catch (error) {
    browserMetadata.webgpu = { error: error.message };
  }
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const debug = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && debug) browserMetadata.webgl = {
      vendor: gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),
      renderer: gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
    };
  } catch { /* Metadata is optional. */ }

  const fixture = await api.loadPreparedFixture(config.fixtureUrl);
  const measure = async (backend, job, steps = null) => {
    await api.loadPreparedFixture(config.fixtureUrl);
    const options = steps == null ? {
      implicitSolvent: config.implicitSolvent,
      constraintMode: config.constraintMode,
      nonbondedCutoffNm: config.cutoffNm,
    } : {
      steps,
      savedFrameCount: Math.min(config.savedFrameCount, steps + 1),
      implicitSolvent: config.implicitSolvent,
      constraintMode: config.constraintMode,
      nonbondedCutoffNm: config.cutoffNm,
    };
    if (backend === 'webgpu' && config.webgpuTimestepFs)
      options.dt = config.webgpuTimestepFs / 1000;
    const started = performance.now();
    const result = await api.calculateCurrent(job, backend, options);
    const wallElapsedMs = performance.now() - started;
    const frames = api.calculationFrames();
    return {
      backend: result.backend,
      platform: result.platform,
      openmmVersion: result.openmmVersion || null,
      elapsedMs: result.elapsedMs,
      wallElapsedMs,
      steps,
      initialEnergyKcalMol: result.initialEnergy,
      finalEnergyKcalMol: result.finalEnergy,
      timestepFs: result.timestepFs,
      constraintCount: result.constraintCount,
      constraintError: result.constraintError,
      cutoffNm: result.cutoffNm,
      neighborRadiusNm: result.neighborRadiusNm,
      frameCount: result.frameCount,
      finalStep: frames.steps.at(-1) ?? null,
      includesFinalForceReadback: true,
    };
  };

  const results = Object.fromEntries(config.backends.map((backend) => [backend, {
    status: 'ok', warmup: null, energy: null, dynamics: {},
  }]));
  // Warm every requested runtime before collecting any timed sample. This loads
  // WASM modules and compiles WebGPU pipelines, but execution still includes the
  // fresh System/simulation construction performed by the production workers.
  for (const backend of config.backends) {
    const entry = results[backend];
    try {
      entry.warmup = await measure(backend, 'energy');
    } catch (error) {
      entry.status = 'error';
      entry.error = error instanceof Error ? error.message : String(error);
    }
  }
  for (const backend of config.backends) {
    const entry = results[backend];
    if (entry.status !== 'ok') continue;
    try {
      const energySamples = [];
      for (let repeat = 0; repeat < config.energyRepeats; repeat++)
        energySamples.push(await measure(backend, 'energy'));
      entry.energy = summarize(energySamples, null);
      for (const steps of config.mdSteps) {
        const samples = [];
        for (let repeat = 0; repeat < config.mdRepeats; repeat++)
          samples.push(await measure(backend, 'dynamics', steps));
        entry.dynamics[String(steps)] = summarize(samples, steps);
      }
    } catch (error) {
      entry.status = 'error';
      entry.error = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    schema: 1,
    benchmark: 'Molarium Rosemary browser execution',
    fixture: {
      atoms: fixture.atoms,
      bonds: fixture.bonds,
      residues: fixture.residues,
      forcefield: fixture.forcefield,
      chargeModel: fixture.chargeModel,
      sourceSha256: fixture.sourceSha256,
      parameterCounts: fixture.parameterCounts,
    },
    configuration: config,
    timingScope: {
      warmup: 'Loads worker runtime/assets and compiles WebGPU pipelines; each timed job still creates a fresh simulation/System.',
      workerElapsedMs: 'Measured inside the calculation worker after message receipt.',
      wallElapsedMs: 'Measured in the page around the public calculation API.',
      energy: 'Single-point potential energy plus final force readback.',
      dynamics: 'Integration plus requested snapshots and final force readback.',
    },
    browser: browserMetadata,
    results,
  };
})(${JSON.stringify(config)})`;

let output;
try {
  if (!externalAppUrl) {
    server = Bun.spawn(['bun', 'server.js', '--test-api', '--port', String(appPort)], {
      cwd: import.meta.dir,
      stdout: 'ignore',
      stderr: 'ignore',
    });
  }
  await waitFor(async () => (await fetch(appUrl)).ok);
  chrome = Bun.spawn([
    chromePath,
    '--headless',
    '--disable-extensions',
    '--no-first-run',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,1000',
    appUrl,
  ], { stdout: 'ignore', stderr: 'ignore' });
  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    return pages.find((item) => item.type === 'page' && item.url === appUrl);
  });
  client = new DevToolsClient(page.webSocketDebuggerUrl);
  await client.open();
  await waitFor(async () => {
    const ready = await client.call('Runtime.evaluate', {
      expression: 'Boolean(window.molariumTest)', returnByValue: true,
    });
    return ready.result.value;
  });
  const browserVersion = await client.call('Browser.getVersion');
  const evaluation = await client.call('Runtime.evaluate', {
    expression: browserSuite,
    awaitPromise: true,
    returnByValue: true,
  });
  if (evaluation.exceptionDetails)
    throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text);
  output = {
    ...evaluation.result.value,
    generatedAt: new Date().toISOString(),
    browserProtocol: browserVersion,
    host: {
      platform: platform(), release: release(), architecture: arch(),
      logicalCpus: cpus().length, cpuModel: cpus()[0]?.model || null,
      totalMemoryGiB: totalmem() / 2 ** 30,
    },
  };
  if (Object.values(output.results).some((entry) => entry.status !== 'ok')) process.exitCode = 1;
} catch (error) {
  output = {
    schema: 1,
    benchmark: 'Molarium Rosemary browser execution',
    generatedAt: new Date().toISOString(),
    configuration: config,
    error: error instanceof Error ? error.message : String(error),
  };
  process.exitCode = 1;
} finally {
  client?.close();
  chrome?.kill();
  server?.kill();
  await rm(profile, { recursive: true, force: true });
}

console.log(JSON.stringify(output, null, 2));
