import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitFor(check, timeout = 20000, label = 'browser dependency') {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch { /* retry while the browser or page starts */ }
    await delay(80);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export class DevToolsClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Chrome debugging connection closed'));
      }
      this.pending.clear();
    });
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once:true });
      this.socket.addEventListener('error', reject, { once:true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  call(method, params = {}, timeoutMs = 300000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chrome command ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket.close(); }
}

export async function startMolariumBrowser({ root, appPath, url = null, width = 1440, height = 900,
  localOnly = true } = {}) {
  if (!url && (!root || !appPath)) throw new Error('root and appPath are required for a local browser');
  if (url && !/^https?:\/\//.test(url)) throw new Error('url must use http or https');
  const seed = Math.floor(Math.random() * 1000);
  const appPort = 50000 + seed, debugPort = 52000 + seed;
  const chromePath = process.env.CHROME_PATH || (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : '/usr/bin/google-chrome');
  // GitHub's Linux runners have no physical GPU.  Opt in only for the
  // explicitly requested trusted local Molarium render job; ordinary browser
  // tests and user launches keep Chrome's normal adapter policy.
  const softwareWebgpuArguments = process.platform === 'linux'
    && process.env.MOLARIUM_HEADLESS_SOFTWARE_WEBGPU === '1'
    ? ['--enable-unsafe-webgpu', '--enable-features=UseSkiaRenderer,Vulkan',
      '--use-angle=swiftshader', '--use-vulkan=swiftshader',
      '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface',
      '--use-gpu-in-tests', '--enable-unsafe-swiftshader'] : [];
  const profile = await mkdtemp(join(tmpdir(), 'molarium-history-browser-'));
  const server = url ? null : Bun.spawn(['bun', 'server.js', ...(localOnly ? ['--local-only'] : []),
    '--port', String(appPort)], { cwd:root, stdout:'ignore', stderr:'pipe' });
  const appUrl = url || `http://127.0.0.1:${appPort}/${appPath.replace(/^\/+/, '')}`;
  let chrome = null, client = null;
  try {
    await waitFor(async () => (await fetch(appUrl)).ok, 15000,
      url ? 'Molarium deployment' : 'Molarium server');
    chrome = Bun.spawn([chromePath,
      ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
      ...softwareWebgpuArguments,
      '--headless=new', '--disable-extensions', '--no-first-run', '--hide-scrollbars',
      '--force-color-profile=srgb', `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`, `--window-size=${width},${height}`, appUrl,
    ], { stdout:'ignore', stderr:'ignore' });
    const page = await waitFor(async () => {
      const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
      return pages.find((entry) => entry.type === 'page' && entry.url.startsWith(appUrl));
    }, 15000, 'Chrome page');
    client = new DevToolsClient(page.webSocketDebuggerUrl);
    await client.open();
    await client.call('Page.enable');
    await client.call('Runtime.enable');
    await client.call('Page.bringToFront');
    await client.call('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor:1, mobile:false,
    });
    return {
      appUrl, client, chrome, server, profile,
      async evaluate(expression, { awaitPromise = true } = {}) {
        const result = await client.call('Runtime.evaluate', {
          expression, awaitPromise, returnByValue:true,
        });
        if (result.exceptionDetails)
          throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      },
      async capturePng() {
        const result = await client.call('Page.captureScreenshot', {
          format:'png', captureBeyondViewport:false, fromSurface:true,
        });
        return Buffer.from(result.data, 'base64');
      },
      async close() {
        client?.close(); chrome?.kill(); server?.kill();
        await Promise.allSettled([chrome?.exited, server?.exited]);
        await rm(profile, { recursive:true, force:true });
      },
    };
  } catch (error) {
    client?.close(); chrome?.kill(); server?.kill();
    await Promise.allSettled([chrome?.exited, server?.exited]);
    await rm(profile, { recursive:true, force:true });
    throw error;
  }
}
