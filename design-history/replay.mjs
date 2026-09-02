import { CHEMIST_ACTION_DEFINITIONS, CHEMIST_ACTIONS_SCHEMA } from '../chemist-actions.mjs';
import { cloneRecord, sha256Object } from './integrity.mjs';

export const ACTION_SCRIPT_SCHEMA = 'molarium.chemist-action-script/v1';
export const REPLAY_SCHEMA = 'molarium.chemist-action-replay/v1';

export const READ_ONLY_CHEMIST_ACTIONS = Object.freeze([
  'session.inspect', 'designRoute.inspect', 'structureStory.inspect',
]);

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

function auditRecords(audit) {
  if (Array.isArray(audit)) return audit;
  if (!audit || typeof audit !== 'object' || !Array.isArray(audit.records))
    throw new Error('Expected a Chemist Actions audit record array or an object with records');
  if (audit.schema != null && audit.schema !== CHEMIST_ACTIONS_SCHEMA
    && audit.schema !== 'molarium.chemist-action-audit/v1')
    throw new Error(`Unsupported Chemist Actions audit schema: ${audit.schema}`);
  return audit.records;
}

function selectedSequences(value) {
  if (value == null) return null;
  if (!Array.isArray(value) && !(value instanceof Set))
    throw new Error('includeSequences must be an array or Set of positive integers');
  const result = new Set(value);
  for (const sequence of result)
    if (!Number.isInteger(sequence) || sequence < 1)
      throw new Error('includeSequences must contain only positive integers');
  return result;
}

/**
 * Convert an execution audit into the public, replayable Chemist Actions script schema.
 * Results, timestamps and durations deliberately remain in the audit; a script contains only
 * the explicit action requests needed to repeat the operation. Failed/running records are never
 * replayed. Read-only inspections can be retained for a complete protocol trace or omitted for a
 * compact designer-move script.
 */
export function actionScriptFromAudit(audit, { label = 'Chemist Actions audit replay',
  includeReadOnly = true, includeSequences = null, captionsBySequence = {},
  captionFromRequestId = false, includeAuditMetadata = false, provenance = null } = {}) {
  const records = auditRecords(audit), requested = selectedSequences(includeSequences);
  if (!captionsBySequence || typeof captionsBySequence !== 'object'
    || Array.isArray(captionsBySequence))
    throw new Error('captionsBySequence must be an object keyed by audit sequence');
  const seenSequences = new Set(), readOnly = new Set(READ_ONLY_CHEMIST_ACTIONS);
  const actions = [];
  for (const [recordIndex, record] of records.entries()) {
    if (!record || typeof record !== 'object')
      throw new Error(`Audit record ${recordIndex + 1} must be an object`);
    const sequence = record.sequence;
    if (!Number.isInteger(sequence) || sequence < 1)
      throw new Error(`Audit record ${recordIndex + 1} requires a positive integer sequence`);
    if (seenSequences.has(sequence)) throw new Error(`Duplicate audit sequence ${sequence}`);
    seenSequences.add(sequence);
    if (record.status !== 'completed' || (requested && !requested.has(sequence))) continue;
    if (!includeReadOnly && readOnly.has(record.action)) continue;
    if (!Object.hasOwn(CHEMIST_ACTION_DEFINITIONS, record.action))
      throw new Error(`Audit sequence ${sequence} uses unavailable route ${record.action}`);
    const step = { action:record.action, args:cloneRecord(record.args || {}) };
    if (includeAuditMetadata) step.auditSequence = sequence;
    if (includeAuditMetadata && typeof record.requestId === 'string' && record.requestId)
      step.auditRequestId = record.requestId;
    const suppliedCaption = captionsBySequence[sequence];
    if (suppliedCaption != null && typeof suppliedCaption !== 'string')
      throw new Error(`Caption for audit sequence ${sequence} must be a string`);
    const caption = suppliedCaption ?? (typeof record.caption === 'string' ? record.caption : null)
      ?? (captionFromRequestId && typeof record.requestId === 'string' ? record.requestId : null);
    if (caption != null && caption !== '') step.caption = caption;
    actions.push(step);
  }
  if (requested) {
    const missing = [...requested].filter((sequence) => !seenSequences.has(sequence));
    if (missing.length) throw new Error(`Audit does not contain requested sequences: ${missing.join(', ')}`);
  }
  const script = { schema:ACTION_SCRIPT_SCHEMA, label:String(label),
    actions, sourceAudit:{ schema:Array.isArray(audit) ? null : audit.schema || null,
      routeId:Array.isArray(audit) ? null : audit.routeId || null,
      recordCount:records.length,
      includedRecordCount:actions.length,
      includedSequences:records.filter((record) => record?.status === 'completed'
        && (!requested || requested.has(record.sequence))
        && (includeReadOnly || !readOnly.has(record.action))).map((record) => record.sequence),
      failedRecordsExcluded:records.filter((record) => record?.status !== 'completed').length,
      readOnlyInspectionsIncluded:Boolean(includeReadOnly),
      ...(provenance == null ? {} : cloneRecord(provenance)) },
  };
  return validateActionScript(script);
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
