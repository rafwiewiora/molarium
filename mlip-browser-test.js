import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const suffix = process.pid % 5000;
const appPort = 43000 + suffix;
const debugPort = 49000 + suffix;
const appUrl = `http://localhost:${appPort}/`;
const chromePath = Bun.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'molarium-ani2x-test-'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server;
let chrome;
let client;

async function waitFor(check, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch { /* browser startup */ }
    await delay(100);
  }
  throw new Error('Timed out waiting for the ANI-2x browser test');
}

class DevToolsClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once:true });
      this.socket.addEventListener('error', reject, { once:true });
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

const suite = String.raw`
(async () => {
  const goldens = await (await fetch('./mlip/models/ani2x-goldens.json')).json();
  const elements = { 1:'H', 6:'C', 7:'N', 8:'O', 9:'F', 16:'S', 17:'Cl' };
  const bonds = {
    water:[[0,1], [0,2]],
    ethanol:[[0,1], [1,2], [0,3], [0,4], [0,5], [1,6], [1,7], [2,8]],
    methylamine:[[0,1], [0,2], [0,3], [0,4], [1,5], [1,6]],
    methanethiol:[[0,1], [0,2], [0,3], [0,4], [1,5]],
    fluoromethane:[[0,1], [0,2], [0,3], [0,4]],
    chloromethane:[[0,1], [0,2], [0,3], [0,4]],
  };
  const molecule = (record) => ({
    name:'ANI-2x ' + record.name, multiplicity:1,
    atoms:record.atomicNumbers.map((number, index) => ({
      element:elements[number], x:record.positionsAngstrom[index][0],
      y:record.positionsAngstrom[index][1], z:record.positionsAngstrom[index][2], charge:0,
    })),
    bonds:bonds[record.name].map(([a,b]) => ({ a,b,order:1 })),
  });
  const worker = new Worker('./mlip-worker.js', { type:'module' });
  let nextId = 1;
  const run = (message) => new Promise((resolve, reject) => {
    const id = nextId++;
    const listener = (event) => {
      if (event.data?.id !== id || event.data.type === 'progress') return;
      worker.removeEventListener('message', listener);
      if (event.data.type === 'result') resolve(event.data);
      else reject(new Error(event.data.message));
    };
    worker.addEventListener('message', listener);
    worker.postMessage({ type:'run', id, ...message });
  });
  const maximumDifference = (first, second) => {
    let maximum = 0;
    for (let index = 0; index < first.length; index++)
      maximum = Math.max(maximum, Math.abs(first[index] - second[index]));
    return maximum;
  };
  const goldenChecks = [];
  for (const record of goldens.records) {
    const result = await run({ job:'energy', molecule:molecule(record), options:{} });
    const cpuResult = await run({ job:'energy', molecule:molecule(record),
      options:{ forceCpuDescriptors:true } });
    const expectedForces = record.forcesHartreePerAngstrom.flat().map((value) => value * 627.5094740631);
    const energyError = Math.abs(result.finalEnergy - record.energyHartree * 627.5094740631);
    const forceMaximumError = maximumDifference(result.forces, expectedForces);
    const referenceRms = Math.sqrt(expectedForces.reduce((sum, value) => sum + value * value, 0)
      / expectedForces.length);
    const forceErrorRms = Math.sqrt(expectedForces.reduce((sum, value, index) =>
      sum + (result.forces[index] - value) ** 2, 0) / expectedForces.length);
    goldenChecks.push({ name:record.name, energyError, forceMaximumError,
      forceRelativeRms:forceErrorRms / Math.max(1e-12, referenceRms),
      gpuCpuEnergyDifference:Math.abs(result.finalEnergy - cpuResult.finalEnergy),
      gpuCpuForceMaximumDifference:maximumDifference(result.forces, cpuResult.forces),
      descriptorBackend:result.descriptorBackend, platform:result.platform });
  }

  const ethanol = goldens.records.find((record) => record.name === 'ethanol');
  const base = Float64Array.from(ethanol.positionsAngstrom.flat());
  const perturbed = base.slice();
  perturbed[0] += 0.017; perturbed[4] -= 0.011; perturbed[20] += 0.009;
  const translated = Float64Array.from(base, (value, index) => value + [2.25, -1.75, 0.4][index % 3]);
  const packed = (sets) => {
    const values = new Float64Array(sets.length * base.length);
    sets.forEach((set, index) => values.set(set, index * base.length));
    return values;
  };
  const validate = async (sets) => {
    const result = await run({ job:'batch-validation', molecule:molecule(ethanol),
      options:{ packedPositions:packed(sets) } });
    return { ...result, energiesHartree:Array.from(result.energiesHartree), forces:Array.from(result.forces) };
  };
  const single = await validate([base]);
  const batch = await validate([base, perturbed, base, translated]);
  const shuffled = await validate([translated, base, perturbed, base]);
  const forceSlice = (result, index) => result.forces.slice(index * base.length, (index + 1) * base.length);
  const comparisons = {
    singleBatchEnergy:Math.abs(single.energiesHartree[0] - batch.energiesHartree[0]),
    singleBatchForce:maximumDifference(single.forces, forceSlice(batch, 0)),
    duplicateEnergy:Math.abs(batch.energiesHartree[0] - batch.energiesHartree[2]),
    duplicateForce:maximumDifference(forceSlice(batch, 0), forceSlice(batch, 2)),
    translatedEnergy:Math.abs(batch.energiesHartree[0] - batch.energiesHartree[3]),
    translatedForce:maximumDifference(forceSlice(batch, 0), forceSlice(batch, 3)),
    shuffledEnergy:Math.max(
      Math.abs(batch.energiesHartree[3] - shuffled.energiesHartree[0]),
      Math.abs(batch.energiesHartree[0] - shuffled.energiesHartree[1]),
      Math.abs(batch.energiesHartree[1] - shuffled.energiesHartree[2]),
      Math.abs(batch.energiesHartree[2] - shuffled.energiesHartree[3])),
    shuffledForce:Math.max(
      maximumDifference(forceSlice(batch, 3), forceSlice(shuffled, 0)),
      maximumDifference(forceSlice(batch, 0), forceSlice(shuffled, 1)),
      maximumDifference(forceSlice(batch, 1), forceSlice(shuffled, 2)),
      maximumDifference(forceSlice(batch, 2), forceSlice(shuffled, 3))),
  };
  worker.terminate();
  return { goldenChecks, comparisons, stageTimings:{
    aevBuildMs:batch.aevBuildMs, networkMs:batch.networkMs,
    forceContractionMs:batch.forceContractionMs,
    descriptorBackend:batch.descriptorBackend, platform:batch.platform,
  } };
})()`;

try {
  server = Bun.spawn(['bun', 'server.js', '--port', String(appPort)], {
    cwd:import.meta.dir, stdout:'ignore', stderr:'pipe',
  });
  await waitFor(async () => (await fetch(appUrl)).ok);
  chrome = Bun.spawn([
    chromePath, '--headless', '--disable-extensions', '--no-first-run',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--enable-unsafe-webgpu', appUrl,
  ], { stdout:'ignore', stderr:'ignore' });
  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    return pages.find((candidate) => candidate.type === 'page' && candidate.url === appUrl);
  });
  client = new DevToolsClient(page.webSocketDebuggerUrl);
  await client.open();
  const evaluation = await client.call('Runtime.evaluate', {
    expression:suite, awaitPromise:true, returnByValue:true,
  });
  if (evaluation.exceptionDetails)
    throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text);
  const report = evaluation.result.value;
  const failures = [];
  for (const check of report.goldenChecks) {
    if (check.descriptorBackend !== 'WebGPU') failures.push(`${check.name}: ${check.descriptorBackend}`);
    if (check.energyError >= 0.03) failures.push(`${check.name}: energy ${check.energyError}`);
    if (check.forceRelativeRms >= 3e-3 || check.forceMaximumError >= 0.08)
      failures.push(`${check.name}: force ${check.forceRelativeRms}/${check.forceMaximumError}`);
    if (check.gpuCpuEnergyDifference >= 0.03 || check.gpuCpuForceMaximumDifference >= 0.01)
      failures.push(`${check.name}: GPU/CPU ${check.gpuCpuEnergyDifference}/${check.gpuCpuForceMaximumDifference}`);
  }
  for (const [name, value] of Object.entries(report.comparisons))
    if (value >= (name.includes('Energy') ? 2e-6 : 3e-4)) failures.push(`${name}: ${value}`);
  if (failures.length) throw new Error(`ANI-2x WebGPU validation failed: ${failures.join('; ')}`);
  console.log(`${report.goldenChecks.length} TorchANI goldens passed on ${report.stageTimings.platform}`);
  console.log(`Golden maxima: ${JSON.stringify({
    energyErrorKcalMol:Math.max(...report.goldenChecks.map((check) => check.energyError)),
    forceRelativeRms:Math.max(...report.goldenChecks.map((check) => check.forceRelativeRms)),
    forceMaximumError:Math.max(...report.goldenChecks.map((check) => check.forceMaximumError)),
  })}`);
  console.log(`Golden details: ${JSON.stringify(report.goldenChecks)}`);
  console.log(`Batch invariance: ${JSON.stringify(report.comparisons)}`);
  console.log(`Stage timings: ${JSON.stringify(report.stageTimings)}`);
} finally {
  client?.close();
  chrome?.kill();
  server?.kill();
  await rm(profile, { recursive:true, force:true });
}
