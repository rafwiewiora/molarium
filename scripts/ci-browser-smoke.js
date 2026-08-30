import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const suffix = Math.floor(Math.random() * 1000);
const appPort = 61000 + suffix;
const debugPort = 62500 + suffix;
const appUrl = `http://127.0.0.1:${appPort}/`;
const chromePath = Bun.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome');
const chromePlatformArgs = process.platform === 'linux'
  ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];
const profile = await mkdtemp(join(tmpdir(), 'molarium-ci-browser-'));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(label, check, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch { /* Retry while the server and browser start. */ }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
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

let server;
let chrome;
let client;
try {
  server = Bun.spawn(['bun', 'server.js', '--local-only', '--port', String(appPort)], {
    cwd:join(import.meta.dir, '..'), stdout:'ignore', stderr:'inherit',
  });
  await waitFor('the local server', async () => (await fetch(appUrl)).ok);
  chrome = Bun.spawn([
    chromePath, ...chromePlatformArgs, '--headless', '--disable-extensions', '--no-first-run',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--window-size=1440,1000', appUrl,
  ], { stdout:'ignore', stderr:'inherit' });
  const page = await waitFor('Chrome DevTools', async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    return pages.find((entry) => entry.type === 'page' && entry.url === appUrl);
  });
  client = new DevToolsClient(page.webSocketDebuggerUrl);
  await client.open();
  const result = await waitFor('the Molarium application', async () => {
    const response = await client.call('Runtime.evaluate', {
      expression:`(() => {
        const canvas = document.querySelector('#molecule-canvas');
        const modes = [...document.querySelectorAll('.mode-bar button')]
          .map((button) => button.textContent.trim());
        const api = window.molariumTest;
        if (!canvas || modes.length !== 3 || !api) return null;
        api.load('CCO');
        const molecule = api.current()?.molecule;
        return { title:document.title, modes, canvasWidth:canvas.width,
          atomCount:molecule?.atoms?.length, bondCount:molecule?.bonds?.length };
      })()`,
      returnByValue:true,
    });
    return response.result.value;
  });
  if (!result.title.includes('Molarium')
    || result.modes.join(',') !== 'View,Build,Run'
    || result.canvasWidth <= 0 || result.atomCount !== 9 || result.bondCount !== 8)
    throw new Error(`Browser smoke test failed: ${JSON.stringify(result)}`);
  console.log(`Molarium browser smoke: PASS (${result.atomCount} atoms; ${result.modes.join('/')})`);
} finally {
  client?.close();
  chrome?.kill();
  server?.kill();
  await Promise.allSettled([chrome?.exited, server?.exited].filter(Boolean));
  await rm(profile, { recursive:true, force:true });
}
