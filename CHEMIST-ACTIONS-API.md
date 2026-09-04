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
const graph = (await molarium.inspect({
  scope: 'ligand',
  maximumAtoms: 200,
})).result;

await molarium.execute({ action: 'chemistry.setEditPolicy', args: { mode: 'staged' } });
await molarium.execute({
  action: 'chemistry.setBond',
  args: { atomIds: ['persistent-id-a', 'persistent-id-b'], order: 1 },
});
await molarium.execute({ action: 'chemistry.finish' });
```

Chemistry targets and selections use persistent `designAtomId` values returned by
`session.inspect`, never mutable array indices. Target-dependent chemistry actions carry their own
`atomId` or `atomIds`; a saved publication replay is rejected if it relies on ambient selection.
`selection.replace` remains the public action used by both the 2D depiction and the 3D viewer for
visible selection. `chemistry.setEditPolicy` makes batching behavior part of the action audit:
`staged` waits for `chemistry.finish`, while `immediate-refine` validates, refines, and commits each
edit. Hydrogens, valence, aromaticity, sanitization, local refinement, contact feature transfer,
Undo, and Redo therefore behave exactly as they do for an interactive user.

## Available routes

- `session.inspect`, `session.loadStructure`, `session.loadIdentifier`, `session.loadFixture`,
  `session.clear`, `session.share`
- `interface.setPanelOpen`, `interface.openProjectInfo`, `interface.presentDesignerStep`
- `view.setMode`, `view.focusComponent`, `view.focusAtoms`, `view.highlightAtoms`,
  `view.setDisplay`, `view.setComponentVisibility`, `view.showAllComponents`, `view.reset`,
  `view.focusResidue`, `view.clearFocus`, `view.setCamera`
- `build.setTool`
- `protein.prepare`, `protein.parameterize`, `protein.predict`, `protein.cancelPrediction`
- `selection.replace`, `selection.clear`
- `chemistry.setEditPolicy`, `chemistry.setAtom`, `chemistry.setBond`, `chemistry.addAtom`, `chemistry.createBond`
- `chemistry.deleteAtom`, `chemistry.deleteBond`
- `chemistry.addHydrogen`, `chemistry.removeHydrogen`
- `chemistry.finish`, `chemistry.discard`
- `ligand.installRegisteredGraph`, `ligand.enumerateProtonation`, `ligand.applyProtonation`
- `geometry.setInternalCoordinate`, `geometry.translateAtoms`
- `fragment.stage`, `fragment.attach`
- `history.undo`, `history.redo`
- `pose.captureReference`, `pose.updateReceptorReference`, `pose.setContact`, `pose.addContact`, `pose.forgetContact`,
  `pose.setEditCleanup`, `pose.clearReference`, `pose.remapContact`, `pose.refine`, `pose.apply`,
  `pose.enumerateSidechainRotamers`, `pose.applySidechainRotamer`
- `optimization.run`
- `calculation.run`, `calculation.tuneReplicas`, `calculation.selectFrame`,
  `calculation.selectReplica`, `calculation.selectConformer`, `calculation.setPlayback`,
  `calculation.setConformerView`
- `designRoute.load`, `designRoute.applyStep`, `designRoute.inspect`
- `campaign.create`, `campaign.inspect`, `campaign.commitCurrent`
- `campaign.createBranch`, `campaign.switchBranch`, `campaign.mergeBranch`
- `campaign.recordDecision`, `campaign.verify`, `campaign.close`, `campaign.import`,
  `campaign.export`
- `designerScript.load`, `designerScript.loadRegistered`, `designerScript.play`,
  `designerScript.step`, `designerScript.restart`, `designerScript.inspect`,
  `designerScript.export`

## Live design campaigns

The Design workspace's **Design History** card is a public API client. A
`campaign.create` request starts a campaign and atomically places the exact
current graph and coordinates in its first commit; `initialCommitMessage`
overrides the default commit message.
`campaign.commitCurrent` makes later commits. Both operations assign persistent
atom IDs before hashing the snapshot.

`campaign.createBranch` creates a branch at an explicit commit or the current
head. `campaign.switchBranch` refuses to discard uncommitted molecular changes,
then reconstructs the graph and coordinates at the selected branch head.
`campaign.import` accepts either inline canonical JSON in `serialized`, or the
pair `sourcePath` and `sourceSha256`. The latter is restricted to a traversal-free
same-origin path and verifies the exact bytes before canonical campaign and
ledger verification; it keeps large checkpoint campaigns out of replay scripts.
`campaign.mergeBranch` records the molecule currently visible on the target
branch as the explicit merge result and retains the target and source commits as
ordered parents; it does not attempt an automatic chemical graph merge.
`campaign.recordDecision` attaches a controlled disposition and rationale to a
commit. `campaign.verify` checks object hashes, commit-event agreement, the event
hash chain, and branch heads derived from that chain.

Campaign JSON and the selected branch are stored locally in IndexedDB. Reloading
restores the active campaign and its head molecule. `campaign.close` removes the
active-workspace pointer without deleting the stored campaign, allowing another
campaign to be started. Import accepts a verified campaign whose selected branch
head contains a complete graph and coordinate snapshot; repository campaigns
that contain only external structure references remain inputs to the standalone
history viewers. Export and Verify remain visible in the same card, and a
finalized imported campaign is read-only.

A live commit may attach the completed public Chemist Actions since the previous
commit. Ordinary scientific and session controls in the interface execute these
same routes, so their successful clicks appear in the audit and in the next
campaign action script. The script is labelled `public-actions-only`, with
`complete: false` and no asserted start/end snapshot IDs: the campaign does not
claim that browser-native transport or presentation-only interactions constitute
a complete molecular replay. Campaign bookkeeping actions are excluded from
molecule scripts so replay cannot recursively create or mutate a campaign.

Registered design routes use schema `molarium.registered-design-route/v1` and enforce a
prospective coordinate boundary. They are input protocols, not append-only campaign ledgers.
`designRoute.load` loads only the hash-pinned hit complex. `designRoute.applyStep` accepts a persistent registered
step ID and supplies its molecular graph plus a reference/product atom map. The action derives and
returns a `molarium.pose-transfer-plan/v2`: only element- and bond-order-exact common atoms inherit
identity and hard coordinates; deleted, added, or chemically rewritten ring regions are released;
compatible donor/acceptor roles may transfer as soft restraints but never as atom identity. The v1
route policy requires complete-ring correspondence and explicitly rejects element-agnostic hard
matching. Thus a bioisosteric ring replacement keeps the unchanged external scaffold fixed while the
replacement ring is rebuilt and searched. Adding a substituent to an otherwise unchanged ring does
not release that ring. Designer-directed steps register required soft spatial features with
`molarium.registered-soft-spatial-feature-restraint/v1`. The restraint carries its tolerance,
weight, and a versioned pre-holdout parameter-decision record; this makes protocol changes visible in
the route hash and action audit rather than embedding an unreported acceptance exception. They also
require `attachmentAtomId`, the same persistent ligand atom ID that an interactive chemist
selects as the exit vector; the route rejects a symmetry-equivalent map attached anywhere else.
Later protein or ligand coordinates are not available to the route. Evaluation holdouts remain
locked until prediction coordinates and their action audit have been frozen.

## Installing reviewed ligand chemistry in Local Lab

`ligand.installRegisteredGraph` binds an exact registered graph to an explicitly located ligand
that already has coordinates. The request supplies the residue locator, the complete named graph,
and the SHA-256 of its canonical graph representation. Molarium rejects a hash mismatch, ambiguous
or incomplete atom-name mapping, element mismatch, disconnected graph, or any heavy-coordinate
movement. The completed action reports input and output molecular-state hashes and is recorded in
the ordinary action audit. It does not fetch a chemical-component record.

After installation, `protein.prepare` may use `ligandPolicy: "registered"`. That mode prepares the
installed graph from its pinned local definition, excludes other unregistered heterogens, and makes
no external CCD request; Local Lab permits only same-origin localhost requests. Figure 1 uses this
sequence with the bundled BQ5 definition: load 6EPM, install the BQ5 graph at chain S residue 1101,
prepare in registered-only mode, and inspect the result. RDKit WebAssembly then generates the
visible 2D layout from the installed chemistry; its coordinates are not used as molecular
coordinates.

There is no alternate or compatibility alias for these actions. Saved scripts, interactive replay,
and agent calls all use the same `designRoute.*` names. Only `designRoute.load` accepts `routeId`.
Once loaded, `designRoute.applyStep` accepts `stepId` and, when the registered step requires a
designer-selected exit vector, `attachmentAtomId`; `designRoute.inspect` accepts no arguments.

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
the same visible Design control and participates in ordinary Undo. Exactly one selector is required:
legacy `index`, `chiDegrees`, or `coordinateSha256`. Chi angles are compared circularly (so -180°
and +180° are equivalent) at 0.001° precision, and the match must be unique. Hash selection must
match exactly one enumerated branch. Optional `expectedInputCoordinateSha256` and
`expectedSelectedCoordinateSha256` guards abort before mutation if the caller is applying a branch
from the wrong input or a different selected result. These exact byte guards are intended for the
same numerical execution. They are deliberately not used as cross-adapter checkpoints after WebGPU
relaxation, where conforming devices can produce scientifically equivalent but byte-different
floating-point coordinates. The response records `selectedBy`, the actual candidate index and rank,
its normalized chi values, and the selected-coordinate hash. For a portable replay, pin the stable
residue identity and unique chi angles; use an index only for an immediate interactive selection.
The chosen branch should then be physically refined and compared with the other branches; the
steric pre-rank is not an affinity score.

Coupled side-chain/pose searches record both `seedChiDegrees`, measured when the enumerated branch
is applied, and `relaxedChiDegrees`, remeasured from the coordinate-bearing `session.inspect`
pocket response after induced-fit minimization. The final deterministic replay must reproduce the
relaxed ligand and pocket coordinate hashes and the remeasured chi vector. A seed rotamer label is
therefore never evidence that the relaxed side chain remained in the same conformational basin.

`pose.updateReceptorReference` accepts a moved receptor-site branch without replacing the captured
ligand reference or its persistent atom lineage. It refreshes the receptor coordinates and any
captured receptor contact descriptors, records before/after coordinate hashes, and leaves ligand
placement to a subsequent `pose.refine`. This permits auditable joint side-chain/ligand branch
search rather than forcing every ligand pose against only the starting receptor rotamer.

Mutating pose, rotamer, graph-growth, and optimization responses report the persistent IDs of
heavy atoms that changed. `view.focusAtoms` accepts those IDs, fits the camera to that local region
with a bounded pocket context, marks the reported atoms for review, and exposes a visible
“Changed region” chip that a chemist can clear. `changeMarkers` selects red atom rings, a quieter
cyan halo, or no marker; more than four changed atoms are summarized by one group halo instead of
dozens of rings. Optional residue callouts identify a small, chemist-chosen context without
asserting an interaction, and may use a `gold`, `blue`, or `slate` tone for both the label and its
residue carbons. `view.highlightAtoms` changes only those marks and optional labels: it preserves
camera, scale, representation, and the previously selected molecular context so adjacent prediction
and relaxation frames remain directly comparable. Saved stories
use ordinary replay captures to pass one action's `changedAtomIds` result into the next view
request; they do not smuggle coordinates or private viewer state through the script. An empty list is valid when an
optimization was restored by a safeguard or no heavy atom exceeded the 0.08 Å display threshold.

`view.setDisplay` also exposes the human-visible story palettes: `design-hit`,
`design-prediction`, and `design-validation` render ligand carbons in saturated teal, purple, and
orange respectively, while reducing ordinary pocket carbon and receptor-cartoon contrast. The
optional read-only `showStericClashes` layer reports and draws ligand–protein heavy-atom pairs below
`0.62 × (r_vdw,ligand + r_vdw,protein)` as small magenta connectors; its visible clash count is
returned by the same action. It never changes coordinates or contributes an energy term.

Candidate generation is deliberately distinct from coordinate application. `pose.refine` fills
the visible pose list but leaves the 3D molecule fixed until `pose.apply`;
`pose.enumerateSidechainRotamers` likewise fills the branch list but leaves the receptor fixed until
`pose.applySidechainRotamer`. Replay result cues state this explicitly and hold on the result card
at human reading speed before the corresponding Apply action.

`pose.apply` fails closed when the selected refined pose is marked infeasible. An agent may apply
such a negative-control result only by sending `allowInfeasible:true`; that override remains in the
action audit and the response reports `infeasibleOverride:true`. The visible Apply pose button is
disabled for infeasible results, so an ordinary human click cannot silently bypass required-contact
or physical-feasibility gates.

`pose.refine`, `pose.apply`, and `optimization.run` return both legacy coordinate fingerprints and
preferred `molarium.molecular-state-hash/v1` fingerprints. The versioned state hash binds persistent
atom identity, atom chemistry, molecular charge and multiplicity, bond topology, and exact
coordinates; atom-array order and bond direction are canonicalized. Pin it with
`expectedInputStateSha256`, `expectedSelectedStateSha256`, or `expectedOutputStateSha256`. Input and
selected-state mismatches abort before mutation. An output mismatch restores the complete
pre-action molecule, Undo/Redo history, pose or conformer ensemble, calculation results, selection,
view state, and corresponding interface controls atomically. `expected*CoordinateSha256` remains
accepted for saved pre-v1 records, but does not guard identity or topology and should not be used for
new publication replays. Neither digest is a tolerance-based scientific-equivalence test across
WebGPU adapters.

Saved action scripts must name the target of every selection-dependent chemistry operation:
`atomId` for atom edits and `atomIds` for bond edits. `selection.replace` remains a visible,
replayable interface action, but it is never accepted as an implicit scientific target in a saved
publication replay. When converting a legacy execution audit, `actionScriptFromAudit` can
materialize an unambiguous preceding `selection.replace` into the generated action arguments; the
resulting saved script is explicit and passes the same validator as a newly authored script.

Audit conversion uses `stateHashGuards: "auto"` by default. For each `pose.refine`, `pose.apply`, or
`optimization.run` result that identifies `molarium.molecular-state-hash/v1`, the converter copies
the recorded input, selected, and output hashes into the corresponding `expected*StateSha256`
request arguments. A partial v1 result or a conflict with an already supplied guard is rejected.
Publication builders should request `stateHashGuards: "required"`; conversion then fails if any
included scientific action lacks its complete v1 result hashes. `"off"` exists only for explicitly
unguarded historical export.

`pose.refine` accepts `execution: "auto"` (the default) or `execution: "serial"`. Auto execution
partitions independent, deterministically seeded pose chains over a bounded browser Worker ensemble
and restores results to conformer-index order before ranking. The response and hash-linked labbook
record the worker count, elapsed search time, throughput, and any serial fallback. Serial mode is a
reproducibility control: it uses the same seeds, restraint and physical objectives, and candidate
ordering on the browser main thread.

The optional `featureSeedingProtocol` pins the pose-seed generator. `v3` scans the edited
single-anchor region but leaves affected pre-existing rotors fixed. `v4` additionally samples
eligible pre-existing rotors in the declared edit environment. `v5` is the default for new work:
it deterministically covers every registered spatial-feature map and affected-rotor stratum before
allocating remaining chains round-robin across other torsions. A chain cap that cannot cover the
required strata fails closed. The response exposes `refinement.coverageComplete` and the complete
machine-readable `refinement.coverage` table; a prospective runner must require both rather than
publishing a partially covered search. The returned `refinement.featureGuidedSeeding.method`
records the effective version, allowing a replay `expect` guard to stop if implementation drift
changes it.

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
cycles, over-deep inputs, and action envelopes larger than 8 MiB are rejected. The larger cap permits
`session.loadStructure` to carry coordinate-bearing structure text without making the endpoint
unbounded. The browser file picker applies a separate, tighter rule to Designer Moves imports:
the selected JSON file must be smaller than 2 MB (2,000,000 bytes). Commands are serialized, so two
agent calls cannot interleave one chemistry transaction.

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

The Design panel can import, replay, and export `molarium.chemist-action-script/v1` JSON. A script is
the portable action-and-arguments procedure; `molarium.chemist-action-replay/v1` is the separate
result of executing it in a new session. Replay calls only this public API and rejects private
routes, embedded code, callbacks, and direct coordinate replacement. See
[`DESIGNER-MOVES.md`](./DESIGNER-MOVES.md) for the schema, converter, and the provenance-pinned SOS1
Phe890 examples. Registered paper/demo links call `designerScript.loadRegistered` once. That route
owns registry lookup, source-file SHA-256 verification, presentation transformation,
installed-script hashing, blank-canvas installation, Design-mode selection, and the visible
title/status update. It returns both source hashes and the installed action-script hash. During
playback, `interface.presentDesignerStep` owns each visible before/after/clear cue, panel layout,
caption, and checkpoint presentation. The paused back/forward arrows call the bounded
`designerScript.step` route; checkpoint review is recorded in the API audit but does not re-execute
the underlying scientific action. `designerScript.export` returns the filename and exact serialized
JSON used by the human download buttons for `recorded-actions`, `execution-log`, or
`installed-script`.
The audit converter excludes `campaign.*` bookkeeping actions from these
molecule scripts.

The public workspace names are **View**, **Design**, and **Simulate**. Versioned scripts continue
to serialize their modes as `view`, `build`, and `run`, and retain action names such as
`build.setTool`; changing those identifiers would invalidate existing saved actions.

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
npm run test:live-campaign-production
```
