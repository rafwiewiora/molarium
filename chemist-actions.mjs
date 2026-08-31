export const CHEMIST_ACTIONS_SCHEMA = 'molarium.chemist-actions/v1';

const ACTIONS = Object.freeze({
  'session.inspect': Object.freeze({ description:'Inspect the current chemist-visible molecular state.',
    arguments:Object.freeze({ scope:'ligand | selection | pocket | all', includeCoordinates:'boolean', maximumAtoms:'integer 1–500' }) }),
  'view.setMode': Object.freeze({ description:'Choose the View, Build, or Run workspace.',
    arguments:Object.freeze({ mode:'view | build | run' }) }),
  'build.setTool': Object.freeze({ description:'Choose the same Add, Select, or Move tool available in Build.',
    arguments:Object.freeze({ tool:'add | select | move' }) }),
  'protein.prepare': Object.freeze({
    description:'Prepare and parameterize the loaded protein complex through the visible preparation workflow.',
    arguments:Object.freeze({ pH:'number 0…14', histidine:'auto | hid | hie | hip',
      repairMissingHeavy:'boolean', ligandPolicy:'ccd | exclude',
      waterPolicy:'crucial | retain | exclude', gapPolicy:'cap | block' }) }),
  'protein.parameterize': Object.freeze({
    description:'Assign force-field parameters to the current edited complex without moving coordinates.',
    arguments:Object.freeze({}) }),
  'selection.replace': Object.freeze({ description:'Select a connected atom path by persistent atom IDs, in click order.',
    arguments:Object.freeze({ atomIds:'array of 1–256 persistent atom IDs' }) }),
  'selection.clear': Object.freeze({ description:'Clear the atom selection.', arguments:Object.freeze({}) }),
  'chemistry.setAtom': Object.freeze({ description:'Change the selected atom element and formal charge.',
    arguments:Object.freeze({ element:'supported element symbol', formalCharge:'integer −4…4' }) }),
  'chemistry.setBond': Object.freeze({ description:'Create or change the selected atom-pair bond.',
    arguments:Object.freeze({ order:'1 | 1.5 | 2 | 3' }) }),
  'chemistry.addAtom': Object.freeze({
    description:'Add one heavy atom to an editable atom through the same 2D Add operation.',
    arguments:Object.freeze({ attachedToAtomId:'persistent atom ID', element:'supported element symbol' }) }),
  'chemistry.createBond': Object.freeze({
    description:'Create a bond between two editable atoms through the same 2D Bond operation.',
    arguments:Object.freeze({ atomIds:'exactly two persistent atom IDs', order:'1 | 1.5 | 2 | 3' }) }),
  'chemistry.deleteAtom': Object.freeze({ description:'Delete the selected editable atom.', arguments:Object.freeze({}) }),
  'chemistry.deleteBond': Object.freeze({ description:'Delete the selected editable bond.', arguments:Object.freeze({}) }),
  'chemistry.addHydrogen': Object.freeze({ description:'Add one explicit hydrogen to the selected atom.', arguments:Object.freeze({}) }),
  'chemistry.removeHydrogen': Object.freeze({ description:'Remove one explicit hydrogen from the selected atom.', arguments:Object.freeze({}) }),
  'chemistry.finish': Object.freeze({ description:'Validate and commit all pending chemistry changes.', arguments:Object.freeze({}) }),
  'chemistry.discard': Object.freeze({ description:'Discard all pending chemistry changes.', arguments:Object.freeze({}) }),
  'history.undo': Object.freeze({ description:'Undo the last committed chemist action.', arguments:Object.freeze({}) }),
  'history.redo': Object.freeze({ description:'Redo the last undone chemist action.', arguments:Object.freeze({}) }),
  'pose.captureReference': Object.freeze({ description:'Capture the current ligand pose as the reference.',
    arguments:Object.freeze({ mode:'propagate | selected-core' }) }),
  'pose.setContact': Object.freeze({ description:'Require or omit one captured contact hypothesis.',
    arguments:Object.freeze({ contactId:'captured contact ID', required:'boolean' }) }),
  'pose.addContact': Object.freeze({ description:'Add an H-bond hypothesis by selecting one ligand and one receptor atom.',
    arguments:Object.freeze({ ligandAtomId:'persistent ligand atom ID', receptorAtomId:'persistent receptor atom ID', ligandRole:'auto | acceptor | donor' }) }),
  'pose.forgetContact': Object.freeze({ description:'Forget a manual or unavailable contact hypothesis while retaining its audit record.',
    arguments:Object.freeze({ contactId:'contact ID' }) }),
  'pose.refine': Object.freeze({ description:'Run reference-guided pose refinement with the visible search-chain setting.',
    arguments:Object.freeze({ searchChains:'8 | 16 | 32 | 64' }) }),
  'pose.apply': Object.freeze({ description:'Apply one returned refined pose by zero-based result index.',
    arguments:Object.freeze({ index:'non-negative integer' }) }),
  'optimization.run': Object.freeze({ description:'Run one optimization method exposed in the Build method menu.',
    arguments:Object.freeze({ method:'ligand-rdkit | pocket-webgpu | induced-fit-webgpu | webgpu | rdkit | ani2x' }) }),
  'designCampaign.load': Object.freeze({
    description:'Load the coordinate-bearing hit of a registered design campaign.',
    arguments:Object.freeze({ campaignId:'registered design-campaign ID' }) }),
  'designCampaign.applyStep': Object.freeze({
    description:'Stage one registered graph design step, preserving any designer-selected exit vector.',
    arguments:Object.freeze({ stepId:'persistent design-step ID',
      attachmentAtomId:'persistent atom ID selected as the growth attachment point when required' }) }),
  'designCampaign.inspect': Object.freeze({
    description:'Inspect the active campaign boundary, hit, and current graph-only design step.',
    arguments:Object.freeze({}) }),
  'structureStory.load': Object.freeze({
    description:'Load a registered, provenance-pinned molecular structure story.',
    arguments:Object.freeze({ storyId:'registered structure-story ID' }) }),
  'structureStory.selectCue': Object.freeze({
    description:'Select a named cue through the same timeline shown in the structure-story interface.',
    arguments:Object.freeze({ cueId:'persistent cue ID' }) }),
  'structureStory.selectFrame': Object.freeze({
    description:'Select a bounded movie frame through the same timeline shown in the structure-story interface.',
    arguments:Object.freeze({ frame:'integer 0…story frame count − 1' }) }),
  'structureStory.inspect': Object.freeze({
    description:'Inspect the current public structure-story, cue, frame, visible references, and camera.',
    arguments:Object.freeze({}) }),
});

const STRUCTURE_STORY_ACTION_NAMES = Object.freeze(Object.keys(ACTIONS)
  .filter((name) => name.startsWith('structureStory.')));
const APPLICATION_ACTION_NAMES = Object.freeze(Object.keys(ACTIONS)
  .filter((name) => !name.startsWith('structureStory.')));

export const CHEMIST_ACTION_SCOPES = Object.freeze({
  application:APPLICATION_ACTION_NAMES,
  structureStory:STRUCTURE_STORY_ACTION_NAMES,
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_INPUT_DEPTH = 8;
const MAX_INPUT_NODES = 2048;
const MAX_INPUT_BYTES = 32768;

function plainClone(value, state = { nodes:0 }, depth = 0) {
  if (depth > MAX_INPUT_DEPTH) throw new Error(`Chemist action input exceeds depth ${MAX_INPUT_DEPTH}`);
  if (++state.nodes > MAX_INPUT_NODES) throw new Error('Chemist action input is too large');
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new Error('Chemist action input numbers must be finite');
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => plainClone(entry, state, depth + 1));
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    throw new Error('Chemist action input must contain only plain JSON values');
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`Chemist action input key ${key} is forbidden`);
    result[key] = plainClone(entry, state, depth + 1);
  }
  return result;
}

function checkedInput(value) {
  const input = plainClone(value == null ? {} : value);
  const text = JSON.stringify(input);
  if (text.length > MAX_INPUT_BYTES) throw new Error(`Chemist action input exceeds ${MAX_INPUT_BYTES} bytes`);
  return input;
}

function publicError(error) {
  const message = String(error?.message || error || 'Chemist action failed').slice(0, 1000);
  const result = new Error(message);
  result.name = 'ChemistActionError';
  return result;
}

function snapshot(value) {
  return value == null ? value : structuredClone(value);
}

export function createChemistActionsApi({ routes, now = () => new Date().toISOString(),
  monotonicNow = () => performance.now(), historyLimit = 500, recordAudit = null,
  enabledActions = Object.keys(ACTIONS) } = {}) {
  if (!routes || typeof routes !== 'object') throw new TypeError('Chemist Actions requires a route adapter');
  if (recordAudit != null && typeof recordAudit !== 'function')
    throw new TypeError('Chemist Actions recordAudit must be a function');
  if (!Array.isArray(enabledActions) || !enabledActions.length)
    throw new TypeError('Chemist Actions enabledActions must be a non-empty array');
  const routeNames = [...new Set(enabledActions.map((name) => String(name)))];
  routeNames.forEach((name) => {
    if (!Object.hasOwn(ACTIONS, name)) throw new TypeError(`Unknown enabled Chemist Actions route ${name}`);
  });
  routeNames.forEach((name) => {
    if (typeof routes[name] !== 'function') throw new TypeError(`Chemist Actions route ${name} is missing`);
  });
  const enabledDefinitions = Object.freeze(Object.fromEntries(routeNames
    .map((name) => [name, ACTIONS[name]])));
  const audit = [];
  let sequence = 0;
  let queue = Promise.resolve();

  const run = async (request) => {
    const envelope = checkedInput(request);
    const action = String(envelope.action || '');
    const requestId = envelope.requestId == null ? null : String(envelope.requestId).slice(0, 160);
    if (!Object.hasOwn(enabledDefinitions, action))
      throw publicError(`Unknown chemist action: ${action || '(empty)'}`);
    const args = checkedInput(envelope.args || {});
    const startedAt = now(), started = monotonicNow();
    const record = { sequence:++sequence, schema:CHEMIST_ACTIONS_SCHEMA, requestId,
      action, args:snapshot(args), startedAt, status:'running' };
    audit.push(record);
    if (audit.length > Math.max(1, Number(historyLimit) || 500)) audit.splice(0, audit.length - historyLimit);
    try {
      const result = await routes[action](args);
      record.status = 'completed'; record.completedAt = now();
      record.durationMs = Math.max(0, monotonicNow() - started);
      recordAudit?.(snapshot(record));
      return { schema:CHEMIST_ACTIONS_SCHEMA, requestId, sequence:record.sequence,
        action, status:'completed', result:snapshot(result) };
    } catch (error) {
      record.status = 'failed'; record.completedAt = now();
      record.durationMs = Math.max(0, monotonicNow() - started);
      record.error = String(error?.message || error).slice(0, 1000);
      recordAudit?.(snapshot(record));
      throw publicError(record.error);
    }
  };

  const api = {
    schema:CHEMIST_ACTIONS_SCHEMA,
    describe() { return { schema:CHEMIST_ACTIONS_SCHEMA,
      guarantee:'Every mutating route is a chemist-visible Molarium action; no arbitrary code or internal callback route is exposed.',
      actions:snapshot(enabledDefinitions) }; },
    execute(request) {
      const operation = queue.then(() => run(request));
      queue = operation.catch(() => {});
      return operation;
    },
    inspect(args = {}) { return this.execute({ action:'session.inspect', args }); },
    history() { return snapshot(audit); },
  };
  return Object.freeze(api);
}

export const CHEMIST_ACTION_DEFINITIONS = ACTIONS;
