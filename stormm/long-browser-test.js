import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const steps = Number(Bun.argv[2] || 100_000);
const replicas = Number(Bun.argv[3] || 16);
const frames = Number(Bun.argv[4] || 251);
const method = String(Bun.argv[5] || 'stormm');
if (!['stormm', 'openmm', 'tune'].includes(method)) throw new Error('Method must be stormm, openmm, or tune');
const suffix = Math.floor(Math.random() * 1000);
const appPort = 56000 + suffix;
const debugPort = 58000 + suffix;
const externalAppUrl = Bun.env.MOLARIUM_TEST_URL;
const appUrl = externalAppUrl || `http://localhost:${appPort}/`;
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = await mkdtemp(join(tmpdir(), 'molarium-stormm-long-'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let server;
let chrome;

async function waitFor(check, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch { /* Retry while the process starts. */ }
    await delay(100);
  }
  throw new Error('Timed out waiting for browser dependency');
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

try {
  if (!externalAppUrl) server = Bun.spawn(['bun', 'server.js', '--test-api', '--port', String(appPort)], {
    cwd:join(import.meta.dir, '..'), stdout:'ignore', stderr:'inherit',
  });
  await waitFor(async () => (await fetch(appUrl)).ok);
  chrome = Bun.spawn([
    chromePath, '--headless', '--disable-extensions', '--no-first-run',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, appUrl,
  ], { stdout:'ignore', stderr:'ignore' });
  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    return pages.find((item) => item.type === 'page' && item.url === appUrl);
  });
  const client = new DevToolsClient(page.webSocketDebuggerUrl);
  await client.open();
  await waitFor(async () => {
    const ready = await client.call('Runtime.evaluate', {
      expression:'Boolean(window.molariumTest)', returnByValue:true,
    });
    return ready.result.value;
  });
  const expression = method === 'tune' ? `(async () => {
    await window.molariumTest.loadRosemaryExample();
    const started = performance.now();
    const result = await window.molariumTest.tuneStormmReplicas({
      stormmSystem:'current', implicitSolvent:'obc2', constraintMode:'hbonds'
    });
    return { result, options:window.molariumTest.stormmReplicaOptions(),
      wallElapsedMs:performance.now() - started };
  })()` : `(async () => {
    await window.molariumTest.loadRosemaryExample();
    const started = performance.now();
    const result = await window.molariumTest.calculateCurrent('dynamics', '${method}', {
      stormmSystem:'current', replicaCount:${replicas}, steps:${steps},
      savedFrameCount:${frames}, implicitSolvent:'obc2', constraintMode:'hbonds'
    });
    result.forces = null;
    const trajectory = window.molariumTest.trajectoryDiagnostics();
    return { result, trajectory, render:window.molariumTest.renderDiagnostics(),
      wallElapsedMs:performance.now() - started };
  })()`;
  const evaluation = await client.call('Runtime.evaluate', {
    expression, awaitPromise:true, returnByValue:true,
  });
  client.close();
  if (evaluation.exceptionDetails)
    throw new Error(evaluation.exceptionDetails.exception?.description
      || evaluation.exceptionDetails.text);
  console.log(JSON.stringify(evaluation.result.value, null, 2));
} finally {
  chrome?.kill();
  server?.kill();
  await rm(profile, { recursive:true, force:true });
}
