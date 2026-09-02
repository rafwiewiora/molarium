# Molarium Chemist Actions API

Schema: `molarium.chemist-actions/v1`

The Chemist Actions API lets a browser agent operate Molarium without receiving privileged access
to Molarium's implementation. Its security and scientific boundary is behavioral: every mutating
route is the same validated operation available to a person in the interface. The API does not
accept code, callbacks, indices into private arrays, force-field objects, score functions, or raw
coordinate replacement.

The automation host must grant an agent only this JSON API, not an arbitrary JavaScript console or
Chrome DevTools `Runtime.evaluate`. No in-page API can constrain a caller that already has general
code execution in the page. In production, `app.js` is module-scoped and the privileged regression
harness is absent; local test servers expose that harness only when started with `--test-api`.

## Access

After the page has loaded:

```js
const molarium = await window.MolariumChemistActionsReady;
molarium.describe();
```

`window.MolariumChemistActions` is the same frozen object. `describe()` is the authoritative action
manifest for the running build. Molarium exposes a scoped manifest: the molecular editor advertises
editor actions, while the structure-story viewer advertises only its timeline actions.

## Example: a staged bond edit

```js
const molarium = await window.MolariumChemistActionsReady;

await molarium.execute({ action: 'view.setMode', args: { mode: 'build' } });
await molarium.execute({ action: 'build.setTool', args: { tool: 'select' } });

const graph = (await molarium.inspect({
  scope: 'ligand',
  maximumAtoms: 200,
})).result;

await molarium.execute({
  action: 'selection.replace',
  args: { atomIds: ['persistent-id-a', 'persistent-id-b'] },
});
await molarium.execute({ action: 'chemistry.setBond', args: { order: 1 } });
await molarium.execute({ action: 'chemistry.finish' });
```

Selections use persistent `designAtomId` values returned by `session.inspect`, never mutable array
indices. `selection.replace` applies selections in click order and enforces the UI rule that each
additional atom must bond to the existing connected path. Chemistry edits enter the ordinary
pending transaction. Hydrogens, valence, aromaticity, sanitization, local refinement, contact
feature transfer, Undo, and Redo therefore behave exactly as they do for an interactive user.

## Available routes

- `session.inspect`
- `view.setMode`, `view.focusComponent`, `view.focusAtoms`, `view.highlightAtoms`, `view.setDisplay`
- `build.setTool`
- `protein.prepare`, `protein.parameterize`
- `selection.replace`, `selection.clear`
- `chemistry.setAtom`, `chemistry.setBond`, `chemistry.addAtom`, `chemistry.createBond`
- `chemistry.deleteAtom`, `chemistry.deleteBond`
- `chemistry.addHydrogen`, `chemistry.removeHydrogen`
- `chemistry.finish`, `chemistry.discard`
- `history.undo`, `history.redo`
- `pose.captureReference`, `pose.updateReceptorReference`, `pose.setContact`, `pose.addContact`, `pose.forgetContact`,
  `pose.refine`, `pose.apply`, `pose.enumerateSidechainRotamers`,
  `pose.applySidechainRotamer`
- `optimization.run`
- `designRoute.load`, `designRoute.applyStep`, `designRoute.inspect`

Registered design routes use schema `molarium.registered-design-route/v1` and enforce a
prospective coordinate boundary. They are input protocols, not append-only campaign ledgers.
`designRoute.load` loads only the hash-pinned hit complex. `designRoute.applyStep` accepts a persistent registered
step ID and supplies its molecular graph plus a reference/product atom map. Designer-directed steps
also require `attachmentAtomId`, the same persistent ligand atom ID that an interactive chemist
selects as the exit vector; the route rejects a symmetry-equivalent map attached anywhere else.
Later protein or ligand coordinates are not available to the route. Evaluation holdouts remain
locked until prediction coordinates and their action audit have been frozen.

There is no alternate or compatibility alias for these actions. Saved scripts, interactive replay,
and agent calls all use the same `designRoute.*` names and `routeId` argument.

`protein.parameterize` assigns a new numeric force-field System after a registered graph edit and
reports a coordinate-displacement audit. It does not minimize or otherwise move the molecule. This
lets a frozen predicted intermediate become the reference for the next registered design step
without importing a later crystal or conflating parameter assignment with relaxation.

`optimization.run` also exposes `induced-fit-webgpu` for registered hit-only replays. It releases
the ligand and every atom of protein residues entering a 6 Å pocket shell, including local
backbone atoms, while the outer complex remains fixed. This is an experimental local induced-fit
minimization, not an ensemble or a binding-affinity calculation.

`pose.enumerateSidechainRotamers` is the discrete move that precedes that minimization when a
receptor side chain may need to cross a rotamer barrier. It accepts one persistent receptor atom
ID, generates a bounded canonical chi-angle ensemble from the current coordinates, and ranks the
branches with a deterministic steric screen against the current complex. It does not read or
accept a later protein structure. `pose.applySidechainRotamer` commits one returned branch through
the same visible Build control, records the input and selected-coordinate hashes, and participates
in ordinary Undo. The chosen branch should then be physically refined and compared with the other
branches; the steric pre-rank is not an affinity score.

`pose.updateReceptorReference` accepts a moved receptor-site branch without replacing the captured
ligand reference or its persistent atom lineage. It refreshes the receptor coordinates and any
captured receptor contact descriptors, records before/after coordinate hashes, and leaves ligand
placement to a subsequent `pose.refine`. This permits auditable joint side-chain/ligand branch
search rather than forcing every ligand pose against only the starting receptor rotamer.

Mutating pose, rotamer, graph-growth, and optimization responses report the persistent IDs of
heavy atoms that changed. `view.focusAtoms` accepts those IDs, fits the camera to that local region
with a bounded pocket context, marks the reported atoms in red, and exposes a visible
“Changed region” chip that a chemist can clear. Optional residue callouts identify a small,
chemist-chosen context without asserting an interaction. `view.highlightAtoms` changes only those
red marks: it preserves camera, scale, representation, and the previously selected molecular
context so adjacent prediction and relaxation frames remain directly comparable. Saved stories
use ordinary replay captures to pass one action's `changedAtomIds` result into the next view
request; they do not smuggle coordinates or private viewer state through the script. An empty list is valid when an
optimization was restored by a safeguard or no heavy atom exceeded the 0.08 Å display threshold.

Candidate generation is deliberately distinct from coordinate application. `pose.refine` fills
the visible pose list but leaves the 3D molecule fixed until `pose.apply`;
`pose.enumerateSidechainRotamers` likewise fills the branch list but leaves the receptor fixed until
`pose.applySidechainRotamer`. Replay result cues state this explicitly and hold on the result card
at human reading speed before the corresponding Apply action.

`pose.refine` accepts `execution: "auto"` (the default) or `execution: "serial"`. Auto execution
partitions independent, deterministically seeded pose chains over a bounded browser Worker ensemble
and restores results to conformer-index order before ranking. The response and hash-linked labbook
record the worker count, elapsed search time, throughput, and any serial fallback. Serial mode is a
reproducibility control: it uses the same seeds, restraint and physical objectives, and candidate
ordering on the browser main thread.

Pose propagation has three separate relaxation concepts. Restraint-biased internal-coordinate
search first uses selected flat-bottom hydrogen-bond potentials to generate contact-feasible poses;
required contacts then remain hard feasibility conditions while the rigid-receptor physical score is
optimized. A ligand-only OpenMM/WASM pass repairs local Sage valence geometry with inherited heavy
atoms fixed; it contains no receptor or explicit restraint force, so its output is accepted only if
the complete receptor-aware restrained objective remains feasible and improves. The later
`optimization.run({method:"induced-fit-webgpu"})` action is a distinct 6 Å complex minimization and
does not currently include the docking interaction restraints as force terms.

For pose propagation, `pose.refine` now seeds a single-anchor grown region across deterministic
attachment-bond torsions even when no explicit hydrogen-bond target was captured. Target-directed
regions keep their pharmacophore-axis seeds, multi-anchor regions remain rigid, and every surviving
reference heavy atom stays exact. This includes a ring grown around a conserved junction atom: the
new ring rotates about the junction's external scaffold bond while the junction itself remains
fixed. Untargeted edit axes use a deterministic 30° scan; captured pharmacophore axes retain their
coarser directional scan. The `pose.refine` response and labbook record the unique seed count,
target variants, untargeted edit rotors, angle grid, and the audit record of the winning seed.

The structure-story viewer exposes a separate scope of the same public API:

- `structureStory.load`
- `structureStory.selectCue`
- `structureStory.selectFrame`
- `structureStory.inspect`

`structureStory.load` accepts only a registered story ID backed by locally bundled, provenance-pinned
assets. It does not accept a URL, path, coordinates, or an arbitrary data object. Cue selection uses
persistent IDs; frame selection is bounded by the loaded story's public timeline. The visible
timeline controls call these same routes.

The exact argument contract is returned by `describe()`. Unknown actions and unexpected arguments
fail closed. Inputs must be finite, plain JSON values; prototype-bearing objects, functions,
cycles, over-deep inputs, and payloads larger than 32 KiB are rejected. Commands are serialized, so
two agent calls cannot interleave one chemistry transaction.

## Inspection and privacy

Inspection defaults to the current ligand, omits coordinates, and returns at most 100 atoms. A
caller may explicitly request ligand, current-selection, captured-pocket, or all-molecule scope,
coordinates, and a limit no larger than 500 atoms. Pocket inspection lists captured contact
participants first, followed by the ligand and rigid receptor site, so an agent can choose the same
visible atoms as a person without receiving private state or mutable array indices. This is an
in-page API: it performs no network request. Loading a PDB identifier or using another connected
feature remains a separate user-visible action governed by Molarium's network policy.

`pose.addContact` is the agent equivalent of the compact `+` control under Required contacts: pass
one persistent ligand atom ID and one persistent receptor atom ID. Molarium perceives complementary
donor/acceptor roles, deterministically chooses an explicit donor hydrogen, and either creates one
audited hypothesis or asks the caller to choose the ligand role when both interpretations are
possible. `pose.forgetContact` removes a manually asserted or currently unavailable hypothesis from
the active reference while retaining the amendment in the molecule ledger and run labbook.

## Audit

Every recognized action records sequence, request ID, arguments, start/completion times, duration,
status, public result, and a compact outcome-state summary. `history()` returns a defensive copy of the current
session history. The current molecule also carries the bounded
`source.chemistActionAudit` ledger, including failed recognized actions. Unknown/internal route
requests are rejected before execution and are not accepted into the scientific ledger.

This v1 action ledger is an execution audit, not the calculation labbook. A reference-guided pose
run still produces its independent hash-linked protocol labbook with input and result hashes. The
action ledger proves how the browser was operated; the run labbook proves which numerical protocol
was executed.

Structure-story rendering is also an API client. Every captured frame is selected with
`structureStory.selectFrame`; render output includes `chemist-action-audit.json`, and the render
manifest pins the audit hash and associates each frame with its API sequence number. Direct private
viewer hooks are not part of this path.

## Saved designer moves

The Build panel can import, replay, and export `molarium.chemist-action-script/v1` JSON. A script is
the portable action-and-arguments procedure; `molarium.chemist-action-replay/v1` is the separate
result of executing it in a new session. Replay calls only this public API and rejects private
routes, embedded code, callbacks, and direct coordinate replacement. See
[`DESIGNER-MOVES.md`](./DESIGNER-MOVES.md) for the schema, converter, and the provenance-pinned SOS1
Phe890 examples. Paused back/forward controls inspect cached application checkpoints only; they do
not issue Agent/API calls or rewrite the append-only execution audit.

## Explicit exclusions

The public API intentionally does not expose the privileged `window.molariumTest` fixture harness.
That harness can inject synthetic objects and reduce search settings for regression tests; it exists
only when a local server is explicitly started with `--test-api` and must not be used as an agent
modeling route. The public API also does not expose module imports, arbitrary JavaScript, direct
state access, user credentials, filesystem access, cloud execution, or third-party services.

Run the API gates with:

```sh
npm run test:chemist-actions
npm run test:chemist-actions-browser
npm run test:chemist-actions-production
```
