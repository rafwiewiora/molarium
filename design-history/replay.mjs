import { CHEMIST_ACTION_DEFINITIONS, CHEMIST_ACTIONS_SCHEMA } from '../chemist-actions.mjs';
import { cloneRecord, sha256Object } from './integrity.mjs';

export const ACTION_SCRIPT_SCHEMA = 'molarium.chemist-action-script/v1';
export const REPLAY_SCHEMA = 'molarium.chemist-action-replay/v1';

const FORBIDDEN_BOUNDARY_KEYS = new Set([
  'directCoordinates', 'internalCallback', 'module', 'eval', 'sourceCode', 'privateRoute',
]);

function assertNoBoundaryShortcut(value, path = 'step') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoBoundaryShortcut(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_BOUNDARY_KEYS.has(key))
      throw new Error(`${path}.${key} crosses the Chemist Actions boundary`);
    assertNoBoundaryShortcut(entry, `${path}.${key}`);
  }
}

function bindingReferences(value, result = []) {
  if (Array.isArray(value)) value.forEach((entry) => bindingReferences(entry, result));
  else if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$binding === 'string')
      result.push(value.$binding);
    else Object.values(value).forEach((entry) => bindingReferences(entry, result));
  }
  return result;
}

function resolveBindings(value, bindings) {
  if (Array.isArray(value)) return value.map((entry) => resolveBindings(entry, bindings));
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$binding === 'string') {
      if (!bindings.has(value.$binding)) throw new Error(`Replay binding ${value.$binding} is unavailable`);
      return cloneRecord(bindings.get(value.$binding));
    }
    return Object.fromEntries(Object.entries(value)
      .map(([key, entry]) => [key, resolveBindings(entry, bindings)]));
  }
  return value;
}

function resultAtPath(result, path) {
  const parts = String(path).split('.').filter(Boolean);
  let value = result;
  for (const part of parts) value = value?.[part];
  if (value === undefined) throw new Error(`Replay capture path ${path} is unavailable`);
  return cloneRecord(value);
}

export function validateActionScript(script) {
  if (script?.schema !== ACTION_SCRIPT_SCHEMA || !Array.isArray(script.actions) || !script.actions.length)
    throw new Error(`Expected ${ACTION_SCRIPT_SCHEMA} with at least one action`);
  const declaredBindings = new Set();
  script.actions.forEach((step, index) => {
    if (!step || typeof step !== 'object') throw new Error(`Action step ${index + 1} must be an object`);
    if (!Object.hasOwn(CHEMIST_ACTION_DEFINITIONS, step.action))
      throw new Error(`Action step ${index + 1} uses unavailable route ${step.action}`);
    cloneRecord(step.args || {});
    assertNoBoundaryShortcut(step, `Action step ${index + 1}`);
    for (const reference of bindingReferences(step.args || {}))
      if (!declaredBindings.has(reference))
        throw new Error(`Action step ${index + 1} uses undeclared replay binding ${reference}`);
    if (step.capture != null) {
      if (typeof step.capture !== 'object' || Array.isArray(step.capture))
        throw new Error(`Action step ${index + 1} capture must be an object`);
      for (const [name, path] of Object.entries(step.capture)) {
        if (!/^[a-z][a-z0-9._-]*$/i.test(name) || typeof path !== 'string' || !path)
          throw new Error(`Action step ${index + 1} has an invalid replay capture`);
        if (declaredBindings.has(name))
          throw new Error(`Action step ${index + 1} redeclares replay binding ${name}`);
        declaredBindings.add(name);
      }
    }
  });
  return script;
}

export async function actionScriptSha256(script) {
  return sha256Object(validateActionScript(cloneRecord(script)));
}

export async function replayActionScript(api, script, { onStep = null,
  now = () => new Date().toISOString(), monotonicNow = () => performance.now() } = {}) {
  validateActionScript(script);
  if (!api || api.schema !== CHEMIST_ACTIONS_SCHEMA || typeof api.execute !== 'function')
    throw new Error('Replay requires the frozen public Molarium Chemist Actions API');
  const replay = { schema:REPLAY_SCHEMA, scriptSha256:await actionScriptSha256(script),
    startedAt:now(), completedAt:null, status:'running', steps:[] };
  const bindings = new Map();
  for (const [index, step] of script.actions.entries()) {
    const startedAt = now(), started = monotonicNow();
    const args = resolveBindings(step.args || {}, bindings);
    const record = { index, action:step.action, args:cloneRecord(args),
      caption:String(step.caption || ''), startedAt, status:'running' };
    replay.steps.push(record); await onStep?.({ phase:'before', step:cloneRecord(record) });
    try {
      const envelope = await api.execute({ requestId:`story-${replay.scriptSha256.slice(0, 12)}-${index + 1}`,
        action:step.action, args });
      record.status = 'completed'; record.result = cloneRecord(envelope.result);
      if (step.capture) {
        record.captured = {};
        for (const [name, path] of Object.entries(step.capture)) {
          const captured = resultAtPath(envelope.result, path);
          bindings.set(name, captured); record.captured[name] = cloneRecord(captured);
        }
      }
    } catch (error) {
      record.status = 'failed'; record.error = String(error?.message || error);
      replay.status = 'failed'; replay.completedAt = now();
      record.completedAt = replay.completedAt;
      record.durationMs = Math.max(0, monotonicNow() - started);
      await onStep?.({ phase:'after', step:cloneRecord(record) });
      return replay;
    }
    record.completedAt = now(); record.durationMs = Math.max(0, monotonicNow() - started);
    await onStep?.({ phase:'after', step:cloneRecord(record) });
  }
  replay.status = 'completed'; replay.completedAt = now();
  replay.bindings = Object.fromEntries([...bindings].map(([key, entry]) => [key, cloneRecord(entry)]));
  return replay;
}
