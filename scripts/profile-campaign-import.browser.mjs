import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const root = resolve(import.meta.dirname, '..');
const scriptPath = resolve(root,
  'design-history/examples/sos1-prediction-checkpoint-review.action-script.json');
const script = JSON.parse(await readFile(scriptPath, 'utf8'));
const actionIndex = Math.max(0, Math.min(script.actions.length - 1,
  Number(process.argv[2] || 0)));

const browser = await startMolariumBrowser({ root, appPath:'?blank=1',
  width:1280, height:800 });

try {
  await waitFor(async () => browser.evaluate(
    `Boolean(window.MolariumChemistActionsReady)`), 30000, 'Molarium API');

  await browser.client.call('Profiler.enable');
  await browser.client.call('Profiler.setSamplingInterval', { interval:500 });
  await browser.client.call('Profiler.start');

  const profile = await browser.evaluate(`(async (script, actionIndex) => {
    const records = [];
    const summarize = (value) => value && typeof value === 'object'
      && typeof value.campaignId === 'string' ? {
        campaignId:value.campaignId,
        snapshots:Object.keys(value.objects?.snapshots || {}).length,
        commits:Object.keys(value.objects?.commits || {}).length,
        events:value.events?.length || 0,
      } : null;
    const record = (name, started, details = {}) => records.push({
      name, durationMs:performance.now() - started, ...details,
    });

    const originalClone = globalThis.structuredClone;
    globalThis.structuredClone = function(value, options) {
      const started = performance.now();
      const result = originalClone.call(this, value, options);
      record('structuredClone', started, { campaign:summarize(value) });
      return result;
    };

    const originalParse = JSON.parse;
    JSON.parse = function(value, reviver) {
      const started = performance.now();
      const result = originalParse.call(this, value, reviver);
      record('JSON.parse', started, {
        inputBytes:typeof value === 'string' ? value.length : null,
        campaign:summarize(result),
      });
      return result;
    };

    const originalStringify = JSON.stringify;
    JSON.stringify = function(value, replacer, space) {
      const started = performance.now();
      const result = originalStringify.call(this, value, replacer, space);
      record('JSON.stringify', started, {
        outputBytes:typeof result === 'string' ? result.length : null,
        campaign:summarize(value),
      });
      return result;
    };

    const subtlePrototype = Object.getPrototypeOf(crypto.subtle);
    const originalDigest = subtlePrototype.digest;
    subtlePrototype.digest = async function(algorithm, data) {
      const started = performance.now();
      const result = await originalDigest.call(this, algorithm, data);
      record('crypto.subtle.digest', started, { inputBytes:data?.byteLength ?? null });
      return result;
    };

    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      const started = performance.now();
      const result = originalPut.call(this, value, key);
      record('IDBObjectStore.put', started, {
        campaignJsonBytes:typeof value?.campaignJson === 'string'
          ? value.campaignJson.length : null,
      });
      return result;
    };

    const api = await window.MolariumChemistActionsReady;
    const timings = {};
    let started = performance.now();
    await api.execute({ action:'designerScript.load', args:{ script } });
    timings.loadScriptMs = performance.now() - started;

    started = performance.now();
    await api.execute({ action:'interface.presentDesignerStep',
      args:{ index:actionIndex, phase:'before' } });
    timings.presentBeforeMs = performance.now() - started;

    started = performance.now();
    const response = await api.execute(script.actions[actionIndex]);
    timings.importMs = performance.now() - started;

    started = performance.now();
    await api.execute({ action:'interface.presentDesignerStep',
      args:{ index:actionIndex, phase:'after' } });
    timings.presentAfterMs = performance.now() - started;

    const totals = Object.values(Object.groupBy(records, (entry) => entry.name))
      .map((entries) => ({ name:entries[0].name, calls:entries.length,
        totalMs:entries.reduce((sum, entry) => sum + entry.durationMs, 0),
        maximumMs:Math.max(...entries.map((entry) => entry.durationMs)),
        totalInputBytes:entries.reduce((sum, entry) => sum
          + Number(entry.inputBytes || 0), 0),
        totalOutputBytes:entries.reduce((sum, entry) => sum
          + Number(entry.outputBytes || 0), 0),
      })).sort((a, b) => b.totalMs - a.totalMs);
    return { actionIndex, action:script.actions[actionIndex].action,
      timings, totals,
      expensiveCalls:records.filter((entry) => entry.durationMs >= 5)
        .sort((a, b) => b.durationMs - a.durationMs).slice(0, 30),
      importSummary:response.result?.campaignImport || null,
      resources:performance.getEntriesByType('resource')
        .filter((entry) => entry.name.includes('campaign'))
        .map((entry) => ({ name:entry.name, durationMs:entry.duration,
          encodedBodySize:entry.encodedBodySize,
          decodedBodySize:entry.decodedBodySize })),
    };
  })(${JSON.stringify(script)}, ${actionIndex})`);
  const cpu = (await browser.client.call('Profiler.stop')).profile;
  const nodes = new Map(cpu.nodes.map((node) => [node.id, node]));
  const selfMicroseconds = new Map();
  for (let index = 0; index < (cpu.samples || []).length; index += 1) {
    const nodeId = cpu.samples[index];
    selfMicroseconds.set(nodeId, (selfMicroseconds.get(nodeId) || 0)
      + Number(cpu.timeDeltas?.[index] || 0));
  }
  profile.cpuTop = [...selfMicroseconds].map(([nodeId, microseconds]) => {
    const frame = nodes.get(nodeId)?.callFrame || {};
    return { functionName:frame.functionName || '(anonymous)',
      url:frame.url || '', lineNumber:Number(frame.lineNumber || 0) + 1,
      selfMs:microseconds / 1000 };
  }).filter((entry) => entry.selfMs >= 1)
    .sort((a, b) => b.selfMs - a.selfMs).slice(0, 30);
  console.log(JSON.stringify(profile, null, 2));
} finally {
  await browser.close();
}
