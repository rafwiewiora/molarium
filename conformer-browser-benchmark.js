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
const rdkitWorkers = argument('rdkit-workers', null);

const config = Object.freeze({
  smiles: argument('smiles', 'CCCCCCOCC'),
  conformerCount: positiveInteger('conformers', 32),
  conformerEffort: argument('effort', 'quick'),
  conformerAni2x: !Bun.argv.includes('--no-ani'),
  ...(rdkitWorkers == null ? {} : { conformerWorkerCount:positiveInteger('rdkit-workers', 1) }),
});
if (!['quick', 'balanced', 'thorough'].includes(config.conformerEffort))
  throw new Error('--effort must be quick, balanced, or thorough');

const suffix = process.pid % 5000;
const appPort = 41000 + suffix;
const debugPort = 47000 + suffix;
const appUrl = `http://localhost:${appPort}/`;
const chromePath = Bun.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome');
const profile = await mkdtemp(join(tmpdir(), 'molarium-conformer-benchmark-'));
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
  throw new Error('Timed out waiting for the conformer benchmark browser');
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

const expression = `
(async () => {
  window.molariumTest.load(${JSON.stringify(config.smiles)});
  return window.molariumTest.calculateCurrent(
    'conformers',
    'stormm',
    ${JSON.stringify({ ...config, conformerArena: true })}
  );
})()`;

try {
  server = Bun.spawn(['bun', 'server.js', '--test-api', '--port', String(appPort)], {
    cwd: import.meta.dir, stdout: 'ignore', stderr: 'pipe',
  });
  await waitFor(async () => (await fetch(appUrl)).ok);
  chrome = Bun.spawn([
    chromePath, '--headless', '--disable-extensions', '--no-first-run',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--window-size=1280,900', appUrl,
  ], { stdout: 'ignore', stderr: 'ignore' });
  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    return pages.find((candidate) => candidate.type === 'page' && candidate.url === appUrl);
  });
  client = new DevToolsClient(page.webSocketDebuggerUrl);
  await client.open();
  await waitFor(async () => {
    const result = await client.call('Runtime.evaluate', {
      expression: 'Boolean(window.molariumTest)', returnByValue: true,
    });
    return result.result.value;
  });
  const evaluation = await client.call('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (evaluation.exceptionDetails)
    throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text);
  const report = evaluation.result.value;
  console.log(`Molarium Conformer Arena · ${config.smiles} · ${report.conformerArenaSeedCount} shared seeds · ${report.conformerCount} judged candidates`);
  console.log(`${report.conformerArena.judge} · ${report.conformerArena.clusterCount} union clusters · ${report.conformerArena.lowEnergyClusterCount} within 3 kcal/mol`);
  for (const method of report.conformerArena.methods) {
    console.log(`${method.label.padEnd(22)} +${method.regret.toFixed(3).padStart(7)} kcal/mol regret · ${(method.lowEnergyRecall * 100).toFixed(0).padStart(3)}% low-E recall · ${String(method.clusterCount).padStart(3)}/${report.conformerArena.clusterCount} clusters · ${(method.endToEndMs / 1000).toFixed(2)} s`);
  }
  const parity = report.conformerArena.stormmOpenMMParity;
  console.log(`STORMM/OpenMM parity · ${parity.sampleCount} identical-coordinate energies · max |ΔE| ${parity.maximumAbsoluteKcalMol.toExponential(3)} · RMS ${parity.rmsKcalMol.toExponential(3)} kcal/mol · ${parity.passed ? 'PASS' : 'FAIL'}`);
  console.log(`REPORT_JSON ${JSON.stringify(report)}`);
  process.exitCode = 0;
} finally {
  client?.close();
  chrome?.kill();
  server?.kill();
  await rm(profile, { recursive: true, force: true });
}
