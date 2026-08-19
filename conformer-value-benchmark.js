import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const argument = (name, fallback) => {
  const inline = Bun.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = Bun.argv.indexOf(`--${name}`);
  return index >= 0 ? Bun.argv[index + 1] : fallback;
};
const positiveInteger = (name, fallback) => {
  const value = Number(argument(name, fallback));
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
};
const conformerCount = positiveInteger('conformers', 64);
const conformerEffort = argument('effort', 'balanced');
if (!['quick', 'balanced', 'thorough'].includes(conformerEffort))
  throw new Error('--effort must be quick, balanced, or thorough');

const panel = Object.freeze([
  { name:'n-hexane', smiles:'CCCCCC' },
  { name:'n-octane', smiles:'CCCCCCCC' },
  { name:'1-octanol', smiles:'CCCCCCCCO' },
  { name:'ethyl butyl ether', smiles:'CCCCOCC' },
  { name:'ethyl hexyl ether', smiles:'CCCCCCOCC' },
  { name:'aspirin', smiles:'CC(=O)Oc1ccccc1C(=O)O' },
  { name:'ibuprofen', smiles:'CC(C)Cc1ccc(cc1)[C@@H](C)C(=O)O' },
  { name:'lidocaine', smiles:'CCN(CC)C(=O)c1c(C)cccc1C' },
]);

const suffix = process.pid % 5000;
const appPort = 42000 + suffix;
const debugPort = 48000 + suffix;
const appUrl = `http://localhost:${appPort}/`;
const chromePath = Bun.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'molarium-conformer-value-'));
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
    } catch { /* startup */ }
    await delay(100);
  }
  throw new Error('Timed out waiting for the conformer-value benchmark browser');
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

const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function summarize(raw) {
  const methods = Object.fromEntries(raw.methods.map((method) => [method.id, method]));
  const seeds = new Map();
  raw.methodIds.forEach((method, index) => {
    if (method !== 'etkdg-mmff' && method !== 'stormm-webgpu') return;
    const seed = raw.seedIndices[index];
    const entry = seeds.get(seed) || {};
    entry[method] = raw.energies[index];
    seeds.set(seed, entry);
  });
  const pairedImprovements = [...seeds.values()]
    .filter((entry) => Number.isFinite(entry['etkdg-mmff']) && Number.isFinite(entry['stormm-webgpu']))
    .map((entry) => entry['etkdg-mmff'] - entry['stormm-webgpu']);
  const clusterSets = { seeds:new Set(), stormm:new Set() };
  raw.methodIds.forEach((method, index) => {
    if (method === 'etkdg-mmff') clusterSets.seeds.add(raw.clusterIds[index]);
    if (method === 'stormm-webgpu') clusterSets.stormm.add(raw.clusterIds[index]);
  });
  const novelStormmClusters = [...clusterSets.stormm]
    .filter((cluster) => !clusterSets.seeds.has(cluster)).length;
  const globalBestEnergy = Math.min(...raw.energies.filter(Number.isFinite));
  const lowEnergyClusters = { seeds:new Set(), stormm:new Set() };
  raw.methodIds.forEach((method, index) => {
    if (!Number.isFinite(raw.energies[index]) || raw.energies[index] > globalBestEnergy + 3) return;
    if (method === 'etkdg-mmff') lowEnergyClusters.seeds.add(raw.clusterIds[index]);
    if (method === 'stormm-webgpu') lowEnergyClusters.stormm.add(raw.clusterIds[index]);
  });
  const stormmOnlyLowEnergyClusters = [...lowEnergyClusters.stormm]
    .filter((cluster) => !lowEnergyClusters.seeds.has(cluster)).length;
  const mmff = methods['etkdg-mmff'];
  const stormm = methods['stormm-webgpu'];
  const pairedImprovedCount = pairedImprovements.filter((value) => value > 1e-4).length;
  return {
    name:raw.name,
    smiles:raw.smiles,
    seedCount:raw.seedCount,
    bestEnergyGainKcalMol:mmff.bestEnergy - stormm.bestEnergy,
    pairedMedianGainKcalMol:median(pairedImprovements),
    pairedMeanGainKcalMol:pairedImprovements.reduce((sum, value) => sum + value, 0)
      / pairedImprovements.length,
    pairedImprovedCount,
    pairedImprovedFraction:pairedImprovedCount / pairedImprovements.length,
    pairedCount:pairedImprovements.length,
    seedClusterCount:mmff.clusterCount,
    stormmClusterCount:stormm.clusterCount,
    novelStormmClusters,
    stormmOnlyLowEnergyClusters,
    seedLowEnergyRecall:mmff.lowEnergyRecall,
    stormmLowEnergyRecall:stormm.lowEnergyRecall,
    rdkitMs:mmff.endToEndMs,
    stormmEndToEndMs:stormm.endToEndMs,
    stormmIncrementalMs:stormm.endToEndMs - mmff.endToEndMs,
    parity:raw.parity,
  };
}

try {
  server = Bun.spawn(['bun', 'server.js', '--port', String(appPort)], {
    cwd: import.meta.dir, stdout:'ignore', stderr:'pipe',
  });
  await waitFor(async () => (await fetch(appUrl)).ok);
  chrome = Bun.spawn([
    chromePath, '--headless', '--disable-extensions', '--no-first-run',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--window-size=1280,900', appUrl,
  ], { stdout:'ignore', stderr:'ignore' });
  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    return pages.find((candidate) => candidate.type === 'page' && candidate.url === appUrl);
  });
  client = new DevToolsClient(page.webSocketDebuggerUrl);
  await client.open();
  await waitFor(async () => {
    const result = await client.call('Runtime.evaluate', {
      expression:'Boolean(window.molariumTest)', returnByValue:true,
    });
    return result.result.value;
  });

  const rows = [];
  const failures = [];
  for (const molecule of panel) {
    const expression = `
      (async () => {
        try {
          window.molariumTest.load(${JSON.stringify(molecule.smiles)});
          const result = await window.molariumTest.calculateCurrent('conformers', 'stormm', ${JSON.stringify({
            conformerArena:true, conformerAni2x:false, conformerCount, conformerEffort,
            conformerWorkerCount:1,
          })});
          const analysis = window.molariumTest.calculationFrames().conformerAnalysis;
          return {
            name:${JSON.stringify(molecule.name)}, smiles:${JSON.stringify(molecule.smiles)},
            seedCount:result.conformerArenaSeedCount,
            methods:result.conformerArena.methods,
            parity:result.conformerArena.stormmOpenMMParity,
            methodIds:analysis.methodIds, seedIndices:analysis.seedIndices,
            energies:analysis.energies, clusterIds:analysis.clusterIds,
          };
        } catch (error) {
          return { name:${JSON.stringify(molecule.name)}, smiles:${JSON.stringify(molecule.smiles)},
            error:error instanceof Error ? error.message : String(error) };
        }
      })()`;
    const evaluation = await client.call('Runtime.evaluate', {
      expression, awaitPromise:true, returnByValue:true,
    });
    if (evaluation.exceptionDetails)
      throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text);
    const raw = evaluation.result.value;
    if (raw.error) failures.push(raw);
    else rows.push(summarize(raw));
  }

  const totalPairedComparisons = rows.reduce((sum, row) => sum + row.pairedCount, 0);
  const totalPairedImprovedComparisons = rows.reduce((sum, row) =>
    sum + row.pairedImprovedCount, 0);
  const aggregate = {
    schema:'molarium.conformer-value/v1',
    generatedAt:new Date().toISOString(),
    protocol:{ conformerCount, conformerEffort, seed:20260817,
      sageEnvironment:'OBC2/ACE', judge:'OpenFF Sage 2.1 / OpenMM Reference' },
    moleculeCount:rows.length,
    failureCount:failures.length,
    moleculesWhereStormmBestIsLower:rows.filter((row) => row.bestEnergyGainKcalMol > 1e-4).length,
    moleculesWhereSeedsBestIsLower:rows.filter((row) => row.bestEnergyGainKcalMol < -1e-4).length,
    medianBestEnergyGainKcalMol:median(rows.map((row) => row.bestEnergyGainKcalMol)),
    meanBestEnergyGainKcalMol:rows.reduce((sum, row) => sum + row.bestEnergyGainKcalMol, 0) / rows.length,
    meanPairedImprovedFraction:rows.reduce((sum, row) => sum + row.pairedImprovedFraction, 0) / rows.length,
    totalPairedComparisons,
    totalPairedImprovedComparisons,
    pairedImprovedFraction:totalPairedImprovedComparisons / totalPairedComparisons,
    totalNovelStormmClusters:rows.reduce((sum, row) => sum + row.novelStormmClusters, 0),
    totalStormmOnlyLowEnergyClusters:rows.reduce((sum, row) =>
      sum + row.stormmOnlyLowEnergyClusters, 0),
    rows,
    failures,
  };

  console.log(`Molarium STORMM value panel · ${rows.length}/${panel.length} molecules · ${conformerEffort} · up to ${conformerCount} seeds`);
  for (const row of rows) {
    const sign = row.bestEnergyGainKcalMol >= 0 ? '+' : '';
    console.log(`${row.name.padEnd(18)} best gain ${sign}${row.bestEnergyGainKcalMol.toFixed(3)} kcal/mol · paired median ${row.pairedMedianGainKcalMol.toFixed(3)} · ${(row.pairedImprovedFraction * 100).toFixed(0)}% improved · clusters ${row.seedClusterCount}→${row.stormmClusterCount} (+${row.novelStormmClusters} novel, ${row.stormmOnlyLowEnergyClusters} STORMM-only low-E) · +${(row.stormmIncrementalMs / 1000).toFixed(2)} s`);
  }
  failures.forEach((failure) => console.log(`${failure.name.padEnd(18)} FAILED · ${failure.error}`));
  console.log(`Summary · STORMM best lower on ${aggregate.moleculesWhereStormmBestIsLower}/${rows.length} · median best gain ${aggregate.medianBestEnergyGainKcalMol.toFixed(3)} kcal/mol · paired improved ${aggregate.totalPairedImprovedComparisons}/${aggregate.totalPairedComparisons} (${(aggregate.pairedImprovedFraction * 100).toFixed(1)}%) · ${aggregate.totalNovelStormmClusters} novel clusters · ${aggregate.totalStormmOnlyLowEnergyClusters} STORMM-only low-E clusters`);
  console.log(`REPORT_JSON ${JSON.stringify(aggregate)}`);
} finally {
  client?.close();
  chrome?.kill();
  server?.kill();
  await rm(profile, { recursive:true, force:true });
}
