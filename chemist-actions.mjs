export const CHEMIST_ACTIONS_SCHEMA = 'molarium.chemist-actions/v1';

const ACTIONS = Object.freeze({
  'session.inspect': Object.freeze({ description:'Inspect the current chemist-visible molecular state.',
    arguments:Object.freeze({ scope:'ligand | selection | pocket | all', includeCoordinates:'boolean', maximumAtoms:'integer 1–500' }) }),
  'session.loadStructure': Object.freeze({
    description:'Load PDB, XYZ, MOL, or SMILES text through the same parser used by Paste and Upload.',
    arguments:Object.freeze({ content:'structure text', format:'auto | pdb | xyz | mol | smiles',
      name:'optional display name', polish:'boolean' }) }),
  'session.loadIdentifier': Object.freeze({
    description:'Load a library name, SMILES string, or PDB identifier through the visible Identifier workflow.',
    arguments:Object.freeze({ value:'identifier text', kind:'auto | library | smiles | pdb' }) }),
  'session.loadFixture': Object.freeze({
    description:'Load one prepared example exposed in the interface.',
    arguments:Object.freeze({ fixtureId:'trp-cage | ubiquitin' }) }),
  'session.clear': Object.freeze({ description:'Clear the visible molecular scene and transient results.',
    arguments:Object.freeze({}) }),
  'session.share': Object.freeze({ description:'Return the same stable share URL exposed by Share.',
    arguments:Object.freeze({}) }),
  'interface.setPanelOpen': Object.freeze({
    description:'Expand or collapse a named Molarium interface panel.',
    arguments:Object.freeze({ panelId:'public panel ID', open:'boolean' }) }),
  'interface.openProjectInfo': Object.freeze({
    description:'Open or close a Methods, Validation, Credits, or Privacy information panel.',
    arguments:Object.freeze({ panel:'methods | validation | credits | privacy | closed' }) }),
  'interface.presentDesignerStep': Object.freeze({
    description:'Present or clear one installed Designer Moves step using the same visible cue, layout, caption, result, and checkpoint treatment as playback.',
    arguments:Object.freeze({ index:'zero-based installed-script action index',
      phase:'before | after | clear' }) }),
  'view.setMode': Object.freeze({ description:'Choose the View, Design, or Simulate workspace. Serialized mode values remain view, build, and run.',
    arguments:Object.freeze({ mode:'view | build | run' }) }),
  'view.focusComponent': Object.freeze({
    description:'Use the visible Components control to zoom to one molecular component.',
    arguments:Object.freeze({ kind:'ligand | protein | water | ion | molecule', ordinal:'non-negative integer', isolate:'boolean' }) }),
  'view.focusAtoms': Object.freeze({
    description:'Focus and visibly emphasize a changed molecular region by persistent atom IDs.',
    arguments:Object.freeze({ atomIds:'array of 0–64 persistent atom IDs',
      contextRadiusAngstrom:'number 2…8', highlight:'boolean',
      residueLabels:'array of 0–8 { chain, residueIndex, insertionCode, label, tone?: gold | blue | slate } callouts' }) }),
  'view.highlightAtoms': Object.freeze({
    description:'Visibly emphasize atoms by persistent IDs without changing the camera, representation, or displayed molecular context.',
    arguments:Object.freeze({ atomIds:'array of 0–64 persistent atom IDs',
      residueLabels:'optional array of 0–8 { chain, residueIndex, insertionCode, label, tone?: gold | blue | slate } callouts' }) }),
  'view.setDisplay': Object.freeze({
    description:'Set the same representation and visibility options available in Display Options.',
    arguments:Object.freeze({ representation:'ball-stick | cartoon | both', showHydrogens:'boolean',
      showInteractions:'boolean', showPocketAtoms:'boolean', showHulls:'boolean', showVdw:'boolean',
      showStericClashes:'boolean',
      pocketMode:'radius | contacts', colorTheme:'standard | design-hit | design-prediction | design-validation',
      changeMarkers:'rings | halo | none', autoRotate:'none | vertical | diagonal', playing:'boolean' }) }),
  'view.setComponentVisibility': Object.freeze({
    description:'Show or hide one molecular component through the visible Components list.',
    arguments:Object.freeze({ kind:'ligand | protein | water | ion | molecule', ordinal:'non-negative integer',
      visible:'boolean' }) }),
  'view.showAllComponents': Object.freeze({ description:'Show every molecular component and clear component focus.',
    arguments:Object.freeze({}) }),
  'view.reset': Object.freeze({ description:'Restore default component visibility, focus, projection, zoom, and pan.',
    arguments:Object.freeze({}) }),
  'view.focusResidue': Object.freeze({
    description:'Focus one protein residue, or clear residue focus, through the same viewer interaction.',
    arguments:Object.freeze({ chain:'chain identifier', residueIndex:'integer', insertionCode:'optional code',
      clear:'boolean' }) }),
  'view.clearFocus': Object.freeze({
    description:'Clear atom-region, residue, component, or all molecular focus state.',
    arguments:Object.freeze({ kind:'atoms | residue | component | all' }) }),
  'view.setCamera': Object.freeze({
    description:'Set the reproducible molecular camera used by orbit, pan, and zoom gestures.',
    arguments:Object.freeze({ rotation:'optional quaternion {x,y,z,w}', pan:'optional {x,y}',
      zoom:'optional number 0.45–2.6' }) }),
  'build.setTool': Object.freeze({ description:'Choose the same Add, Select, or Move tool available in Design.',
    arguments:Object.freeze({ tool:'add | select | move' }) }),
  'protein.prepare': Object.freeze({
    description:'Prepare and parameterize the loaded protein complex through the visible preparation workflow.',
    arguments:Object.freeze({ pH:'number 0…14', histidine:'auto | hid | hie | hip',
      repairMissingHeavy:'boolean', ligandPolicy:'ccd | exclude',
      waterPolicy:'crucial | retain | exclude', gapPolicy:'cap | block' }) }),
  'protein.parameterize': Object.freeze({
    description:'Assign force-field parameters to the current edited complex without moving coordinates.',
    arguments:Object.freeze({}) }),
  'protein.predict': Object.freeze({
    description:'Run the visible local protein-structure prediction workflow after the configured MSA search.',
    arguments:Object.freeze({ sequence:'amino-acid sequence or FASTA', msaEndpoint:'HTTPS endpoint' }) }),
  'protein.cancelPrediction': Object.freeze({ description:'Cancel the active protein prediction workflow.',
    arguments:Object.freeze({}) }),
  'selection.replace': Object.freeze({ description:'Select a connected atom path by persistent atom IDs, in click order.',
    arguments:Object.freeze({ atomIds:'array of 1–256 persistent atom IDs' }) }),
  'selection.clear': Object.freeze({ description:'Clear the atom selection.', arguments:Object.freeze({}) }),
  'chemistry.setAtom': Object.freeze({ description:'Change the selected atom element and formal charge.',
    arguments:Object.freeze({ element:'supported element symbol', formalCharge:'integer −4…4' }) }),
  'chemistry.setBond': Object.freeze({ description:'Create or change the selected atom-pair bond.',
    arguments:Object.freeze({ order:'1 | 1.5 | 2 | 3' }) }),
  'chemistry.addAtom': Object.freeze({
    description:'Add one heavy atom to an editable atom, or place one atom on a blank canvas.',
    arguments:Object.freeze({ attachedToAtomId:'optional persistent atom ID',
      positionAngstrom:'required {x,y,z} when no attachment atom exists',
      element:'supported element symbol (attached hydrogens use chemistry.addHydrogen)' }) }),
  'chemistry.createBond': Object.freeze({
    description:'Create a bond between two editable atoms through the same 2D Bond operation.',
    arguments:Object.freeze({ atomIds:'exactly two persistent atom IDs', order:'1 | 1.5 | 2 | 3' }) }),
  'chemistry.deleteAtom': Object.freeze({ description:'Delete the selected editable atom.', arguments:Object.freeze({}) }),
  'chemistry.deleteBond': Object.freeze({ description:'Delete the selected editable bond.', arguments:Object.freeze({}) }),
  'chemistry.addHydrogen': Object.freeze({ description:'Add one explicit hydrogen to the selected atom.', arguments:Object.freeze({}) }),
  'chemistry.removeHydrogen': Object.freeze({ description:'Remove one explicit hydrogen from the selected atom.', arguments:Object.freeze({}) }),
  'ligand.enumerateProtonation': Object.freeze({
    description:'Enumerate bounded ligand protonation states through the visible pH workflow.',
    arguments:Object.freeze({ pH:'number 0–14', smiles:'optional SMILES', pHSpread:'number',
      precision:'number', maximumStates:'integer 1–64' }) }),
  'ligand.applyProtonation': Object.freeze({
    description:'Apply one enumerated protonation state and rebuild its three-dimensional geometry.',
    arguments:Object.freeze({ index:'zero-based state index' }) }),
  'geometry.setInternalCoordinate': Object.freeze({
    description:'Set a bond length, angle, or torsion for a connected atom path.',
    arguments:Object.freeze({ atomIds:'array of 2–4 persistent atom IDs', value:'finite number',
      moveConnected:'boolean' }) }),
  'geometry.translateAtoms': Object.freeze({
    description:'Translate selected atoms by a bounded Cartesian displacement, matching the Design Move gesture.',
    arguments:Object.freeze({ atomIds:'array of 1–256 persistent atom IDs',
      deltaAngstrom:'{x,y,z}, each component −20…20' }) }),
  'fragment.stage': Object.freeze({
    description:'Stage a built-in or custom fragment in the visible Design fragment library.',
    arguments:Object.freeze({ fragmentId:'optional built-in fragment ID', smiles:'optional custom SMILES',
      name:'optional custom name', attachmentIndex:'optional non-negative atom index' }) }),
  'fragment.attach': Object.freeze({
    description:'Attach the currently staged fragment to a persistent atom, or place it as a disconnected component.',
    arguments:Object.freeze({ attachedToAtomId:'optional persistent atom ID',
      positionAngstrom:'optional {x,y,z}' }) }),
  'chemistry.finish': Object.freeze({ description:'Validate and commit all pending chemistry changes.', arguments:Object.freeze({}) }),
  'chemistry.discard': Object.freeze({ description:'Discard all pending chemistry changes.', arguments:Object.freeze({}) }),
  'history.undo': Object.freeze({ description:'Undo the last committed chemist action.', arguments:Object.freeze({}) }),
  'history.redo': Object.freeze({ description:'Redo the last undone chemist action.', arguments:Object.freeze({}) }),
  'pose.captureReference': Object.freeze({ description:'Capture the current ligand pose as the reference.',
    arguments:Object.freeze({ mode:'propagate | selected-core' }) }),
  'pose.updateReceptorReference': Object.freeze({
    description:'Update moved receptor-site coordinates while retaining the captured ligand-core lineage.',
    arguments:Object.freeze({}) }),
  'pose.setContact': Object.freeze({ description:'Require or omit one captured contact hypothesis.',
    arguments:Object.freeze({ contactId:'captured contact ID', required:'boolean' }) }),
  'pose.addContact': Object.freeze({ description:'Add an H-bond hypothesis by selecting one ligand and one receptor atom.',
    arguments:Object.freeze({ ligandAtomId:'persistent ligand atom ID', receptorAtomId:'persistent receptor atom ID', ligandRole:'auto | acceptor | donor' }) }),
  'pose.forgetContact': Object.freeze({ description:'Forget a manual or unavailable contact hypothesis while retaining its audit record.',
    arguments:Object.freeze({ contactId:'contact ID' }) }),
  'pose.setEditCleanup': Object.freeze({
    description:'Choose whether analogue edits preserve inherited coordinates or permit local cleanup.',
    arguments:Object.freeze({ mode:'preserve-reference | free-local' }) }),
  'pose.clearReference': Object.freeze({ description:'Clear the captured reference pose and its transient candidates.',
    arguments:Object.freeze({}) }),
  'pose.remapContact': Object.freeze({
    description:'Choose one role-compatible contact remapping candidate.',
    arguments:Object.freeze({ contactId:'contact ID', candidateId:'candidate ID' }) }),
  'pose.refine': Object.freeze({ description:'Run reference-guided pose refinement with the visible search-chain setting.',
    arguments:Object.freeze({ searchChains:'8 | 16 | 32 | 64',
      execution:'auto | serial (optional; auto uses a bounded deterministic worker ensemble)',
      featureSeedingProtocol:'v3 | v4 (optional; default v4; v3 omits affected-existing-rotor seeding)' }) }),
  'pose.apply': Object.freeze({
    description:'Apply one returned refined pose by zero-based result index; infeasible poses fail closed unless explicitly overridden.',
    arguments:Object.freeze({ index:'non-negative integer',
      allowInfeasible:'optional boolean; false by default and recorded when true' }) }),
  'pose.enumerateSidechainRotamers': Object.freeze({
    description:'Enumerate bounded canonical rotamers for one receptor side chain and rank them against the current complex.',
    arguments:Object.freeze({ receptorAtomId:'persistent receptor atom ID', maximumCandidates:'integer 1–64' }) }),
  'pose.applySidechainRotamer': Object.freeze({
    description:'Apply exactly one returned side-chain rotamer selected by legacy result index, normalized chi angles, or coordinate hash, with optional fail-closed coordinate guards.',
    arguments:Object.freeze({ index:'optional legacy non-negative result index; exactly one selector',
      chiDegrees:'optional array of chi angles in degrees; circularly normalized and uniquely matched; exactly one selector',
      coordinateSha256:'optional lowercase SHA-256 of an enumerated candidate; exactly one selector',
      expectedInputCoordinateSha256:'optional lowercase SHA-256; abort unless it matches the enumerated and current input coordinates',
      expectedSelectedCoordinateSha256:'optional lowercase SHA-256; abort unless it matches the selected and applied coordinates' }) }),
  'optimization.run': Object.freeze({ description:'Run one optimization method exposed in the Design method menu.',
    arguments:Object.freeze({ method:'ligand-rdkit | pocket-webgpu | induced-fit-webgpu | webgpu | rdkit | ani2x' }) }),
  'calculation.run': Object.freeze({
    description:'Run a Simulate calculation through the same installed engines and bounded settings as the interface.',
    arguments:Object.freeze({ job:'geometry | energy | dynamics | conformers',
      method:'openmm | webgpu | stormm | rdkit | ani2x', options:'bounded calculation options' }) }),
  'calculation.tuneReplicas': Object.freeze({
    description:'Measure and select a bounded STORMM replica count through the visible autotuner.',
    arguments:Object.freeze({}) }),
  'calculation.selectFrame': Object.freeze({
    description:'Select a saved calculation frame and apply its coordinates to the current molecule.',
    arguments:Object.freeze({ index:'zero-based frame index' }) }),
  'calculation.selectReplica': Object.freeze({
    description:'Select one ensemble replica and apply its current saved frame.',
    arguments:Object.freeze({ index:'zero-based replica index' }) }),
  'calculation.selectConformer': Object.freeze({
    description:'Select one ranked conformer and apply its final coordinates.',
    arguments:Object.freeze({ rank:'zero-based rank in the active filtered order' }) }),
  'calculation.setPlayback': Object.freeze({
    description:'Play or pause the visible saved-frame trajectory.',
    arguments:Object.freeze({ playing:'boolean' }) }),
  'calculation.setConformerView': Object.freeze({
    description:'Set the Conformer Arena axes, filter, and sort controls.',
    arguments:Object.freeze({ x:'optional axis ID', y:'optional axis ID',
      filter:'optional filter ID', sort:'optional sort ID' }) }),
  'designRoute.load': Object.freeze({
    description:'Load the coordinate-bearing hit of a registered design route.',
    arguments:Object.freeze({ routeId:'registered design-route ID' }) }),
  'designRoute.resume': Object.freeze({
    description:'Resume a registered graph-edit route from a provenance-labelled campaign snapshot.',
    arguments:Object.freeze({ routeId:'registered design-route ID',
      stateId:'registered hit or product state ID' }) }),
  'designRoute.applyStep': Object.freeze({
    description:'Stage one registered design-route graph step, preserving any designer-selected exit vector.',
    arguments:Object.freeze({ stepId:'persistent design-step ID',
      attachmentAtomId:'persistent atom ID selected as the growth attachment point when required' }) }),
  'designRoute.inspect': Object.freeze({
    description:'Inspect the active route boundary, hit, and current graph-only design step.',
    arguments:Object.freeze({}) }),
  'campaign.create': Object.freeze({
    description:'Start a locally persisted design campaign and commit the current Molarium molecule in the same action.',
    arguments:Object.freeze({ campaignId:'stable campaign ID', title:'campaign title',
      description:'optional campaign description', actorId:'optional stable actor ID',
      actorName:'optional actor display name',
      initialCommitMessage:'optional message for the atomic first molecular commit' }) }),
  'campaign.inspect': Object.freeze({
    description:'Inspect the active campaign, branch heads, commits, decisions, and uncommitted public actions.',
    arguments:Object.freeze({}) }),
  'campaign.commitCurrent': Object.freeze({
    description:'Commit the current molecular state and public Chemist Actions since the preceding commit.',
    arguments:Object.freeze({ message:'commit message', label:'optional molecular snapshot label',
      tags:'optional array of stable tags' }) }),
  'campaign.createBranch': Object.freeze({
    description:'Create and switch to a named design branch at a selected commit or the current branch head.',
    arguments:Object.freeze({ branch:'stable branch name', fromCommitId:'optional commit ID' }) }),
  'campaign.switchBranch': Object.freeze({
    description:'Switch the active design branch and restore the exact molecule at its head commit.',
    arguments:Object.freeze({ branch:'existing branch name' }) }),
  'campaign.mergeBranch': Object.freeze({
    description:'Merge a selected source branch into a target branch while retaining both parents.',
    arguments:Object.freeze({ sourceBranch:'source branch name', targetBranch:'optional target branch name',
      message:'optional merge message' }) }),
  'campaign.recordDecision': Object.freeze({
    description:'Record a design disposition and rationale against a committed molecular state.',
    arguments:Object.freeze({ targetCommitId:'optional commit ID; defaults to current branch head',
      disposition:'progressed | not-progressed | deferred | failed | duplicate | superseded | archived',
      reasonCodes:'optional array of controlled reason codes', rationale:'decision rationale',
      evidenceIds:'optional array of evidence event IDs' }) }),
  'campaign.verify': Object.freeze({
    description:'Verify the active campaign content hashes, event chain, commits, and branch heads.',
    arguments:Object.freeze({}) }),
  'campaign.close': Object.freeze({
    description:'Close the active local campaign without deleting its persisted commits.',
    arguments:Object.freeze({}) }),
  'campaign.import': Object.freeze({
    description:'Verify, persist, and restore a canonical serialized design campaign.',
    arguments:Object.freeze({ serialized:'canonical campaign JSON string' }) }),
  'campaign.export': Object.freeze({
    description:'Return canonical JSON for the active design campaign.', arguments:Object.freeze({}) }),
  'designerScript.load': Object.freeze({
    description:'Validate and install a Chemist Actions replay script on a blank canvas.',
    arguments:Object.freeze({ script:'chemist-action script object' }) }),
  'designerScript.loadRegistered': Object.freeze({
    description:'Resolve, integrity-check, transform, and install a registered Designer Moves story on a blank Design canvas.',
    arguments:Object.freeze({ storyId:'registered Designer Moves story ID' }) }),
  'designerScript.play': Object.freeze({
    description:'Start, resume, or pause the visible Designer Moves replay.',
    arguments:Object.freeze({ playing:'boolean' }) }),
  'designerScript.step': Object.freeze({
    description:'Review the previous, next, or final completed replay checkpoint without rerunning calculations.',
    arguments:Object.freeze({ direction:'previous | next | final' }) }),
  'designerScript.restart': Object.freeze({ description:'Return the installed script to its blank starting canvas.',
    arguments:Object.freeze({}) }),
  'designerScript.inspect': Object.freeze({ description:'Inspect the installed script and replay progress.',
    arguments:Object.freeze({}) }),
  'designerScript.export': Object.freeze({
    description:'Serialize the recorded public actions, execution log, or installed replay script for download or agent use.',
    arguments:Object.freeze({ kind:'recorded-actions | execution-log | installed-script' }) }),
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
// Saved action scripts legitimately contain request -> args -> script -> actions ->
// step -> expect -> array/object values.  Twelve levels admit that public format
// while the independent node and byte ceilings still bound traversal and memory.
const MAX_INPUT_DEPTH = 12;
const MAX_INPUT_NODES = 2048;
// A complete coordinate-bearing PDB is intentionally accepted as one string by
// session.loadStructure.  Keep the structural JSON guards below, but do not
// impose the much smaller limit that is appropriate only for ordinary control
// envelopes.  Eight MiB covers the browser's current structure-upload limit
// without turning Chemist Actions into an unbounded ingestion endpoint.
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

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
      record.result = snapshot(result);
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
      guarantee:'Every mutating route is a chemist-visible Molarium action; every saved replay and visible playback control executes only public routes; no arbitrary code or internal callback route is exposed.',
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
