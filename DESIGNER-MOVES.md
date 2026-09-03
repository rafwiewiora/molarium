# Saving and replaying designer moves

Molarium represents a designer move as a call to the same public Chemist Actions API used by the
visible interface. A saved route is ordinary JSON with schema
`molarium.chemist-action-script/v1`; it contains action names, explicit JSON arguments, and optional
human captions. It contains no executable code, private callbacks, force-field objects, or direct
coordinate replacement.

This is a hard boundary. The story builder validates the complete transformed script—including
presentation steps—against the exported public action manifest. A deep link invokes
`designerScript.loadRegistered`, which resolves the registry entry, verifies the pinned source
hash, builds and hashes the interface presentation, installs it on a blank canvas, and enters
Design mode as one audited action. The visible Play/Pause, Previous/Next, and Restart controls invoke
`designerScript.play`, `designerScript.step`, and `designerScript.restart`. The replay runner then
executes every constituent move with `api.execute({ action, args })`. There is no movie-only
scientific operation or private coordinate setter. An agent operating the API can perform every
operation shown in the replay and receives the same structured results used by later steps.
Before and after each constituent move, playback calls public
`interface.presentDesignerStep { index, phase }`; this route owns the visible control cue, compact
layout, central caption, result treatment, and review checkpoint without changing the scientific
request. `designerScript.export` is the single serializer used by agents and the human export
buttons for recorded actions, the execution log, and the installed script.

Three related JSON records remain separate:

- a registered input protocol uses `molarium.registered-design-route/v1`;
- a replayable sequence uses `molarium.chemist-action-script/v1`;
- an append-only molecular history uses `molarium.design-campaign/v1`.

Registered routes use the `designRoute.*` action namespace and a `routeId`. Campaign ledgers are a
different artifact and do not share these action names.

```json
{
  "schema": "molarium.chemist-action-script/v1",
  "label": "SOS1 selected Phe890 route",
  "actions": [
    {
      "action": "designRoute.load",
      "args": { "routeId": "sos1-hit-only" },
      "caption": "Load the coordinate-bearing 5OVE/AXE hit only"
    },
    {
      "action": "designRoute.applyStep",
      "args": { "stepId": "open-phe890-pocket" },
      "caption": "Grow compound 21, creating the Phe890-in clash"
    },
    {
      "action": "pose.enumerateSidechainRotamers",
      "args": {
        "receptorAtomId": "reference-5OVE:ATOM:A:PHE:890::CG:2679",
        "maximumCandidates": 32
      }
    },
    {
      "action": "pose.applySidechainRotamer",
      "args": { "chiDegrees": [-180, 90] },
      "caption": "Apply the selected Phe890 branch"
    }
  ]
}
```

The chi-angle selector identifies the intended physical branch even if a later implementation ranks
the same deterministic candidates in a different order. A caller can use the returned
`coordinateSha256` and optional input/selected-coordinate guards within one numerical execution to
ensure that nothing changed between enumeration and application. Those byte-level coordinate hashes
are not portable checkpoints after GPU relaxation: different conforming WebGPU adapters can end at
scientifically equivalent but byte-different floating-point coordinates. Cross-adapter replays should
pin the residue identity and select the unique normalized chi-angle branch. `index` remains available
for immediate choices from the visible list, but it is not a stable branch identity.

The example is shortened for readability. A real script must include preparation, reference
capture, pose refinement, parameterization, and any requested optimization in their execution
order. The complete examples linked below do so.

## Audit, script, and replay are different artifacts

- The **audit** is the lossless execution record. It includes completed and failed requests,
  sequence and request IDs, timestamps, durations, explicit arguments, and compact outcomes.
- The **action script** is the portable instruction list. It retains completed actions, arguments,
  and captions but omits timing and calculated results. Failed calls are never turned into replay
  instructions. Read-only inspections may be retained for a complete protocol trace or omitted
  for a concise operational route.
- The **replay result** is a new execution record with schema
  `molarium.chemist-action-replay/v1`. It identifies the action-script hash and records the outcome
  of each action in the new session.

Keeping these separate matters scientifically: the audit establishes what was explored; a compact
selected-route script establishes that the chosen operations can be repeated. A compact script
must not be presented as evidence that alternatives were explored.

## Saving a session

`actionScriptFromAudit` in `design-history/replay.mjs` is the canonical converter. The simplest
in-application export is:

```js
import { actionScriptFromAudit } from './design-history/replay.mjs';

const api = await window.MolariumChemistActionsReady;
const audit = {
  schema: api.schema,
  records: api.history()
};

const saved = actionScriptFromAudit(audit, {
  label: 'My hit-to-lead route',
  includeReadOnly: false
});
```

The converter also accepts `includeSequences` for a provenance-linked subset,
`captionsBySequence` for edited narrative captions, and `includeAuditMetadata: true` when each
step should carry its original audit sequence and request ID. Its default output keeps all
completed calls—including read-only inspections—and emits steps as `{ action, args, caption? }`.
Campaign bookkeeping calls are always omitted, because replaying them inside a
molecule script would recursively create or mutate a history container.

For an existing audit file:

```sh
node scripts/audit-to-action-script.mjs \
  --input outputs/design-history/sos1-hit-only-growth-clash-v7/chemist-action-audit.json \
  --output route.action-script.json \
  --omit-read-only \
  --caption-from-request-id
```

Use `--sequences 1-12,20,24-30` to select an explicit source subsequence. The converter validates
the result against the currently available public action manifest before writing it.

## Committing a live molecular history

The main Design workspace exposes a separate **Design History** card for
`molarium.design-campaign/v1`. **Start & commit** records the exact current graph
and coordinates as the first content-addressed molecular commit. Subsequent
commits can be branched, checked out, merged with an explicit visible molecular
result, assigned a design disposition, verified, exported, and restored from
browser-local IndexedDB. Main-workbench import requires the selected branch head
to contain a complete molecular graph and coordinates; reference-only campaign
records remain readable in the standalone history viewers.

The optional action script attached to a live commit is deliberately marked
`coverage.kind: "public-actions-only"` and `coverage.complete: false`. It contains
completed Chemist Actions observed since the prior commit, but it does not claim
that direct canvas or form interactions were replayable API calls. Accordingly,
live scripts do not assert `expectedStartSnapshotId` or
`expectedEndSnapshotId`; the hashed molecular snapshot remains the authoritative
record of what was committed.

## Replaying a saved route

```js
import { replayActionScript } from './design-history/replay.mjs';

const api = await window.MolariumChemistActionsReady;
const replay = await replayActionScript(api, saved, {
  onStep: ({ phase, step }) => {
    // A UI can select the corresponding button/control and show step.caption here.
  }
});

if (replay.status !== 'completed') throw new Error(replay.steps.at(-1).error);
```

For a product-facing movie, `npm run render:designer-moves-interface` starts from a blank canvas,
imports the same JSON through the visible Design panel, presses **▶ Play story**, and records the
real Molarium interface while the public actions run. The transport changes to **❚❚ Pause**
during execution and pauses at the next action boundary, after the current scientific operation
finishes. While paused, **◀** and **▶** invoke the public `designerScript.step` action to review
already-computed application checkpoints. That action restores the molecular coordinates, camera,
active panels, pose results, and calculation display without re-executing or deleting a scientific
constituent action. **Continue** first returns to the live
execution frontier and then resumes. **↺ Restart** returns to the blank canvas. Presentation-only `view.setDisplay` and
`view.focusComponent` actions select a clean chemist pocket view and keep the active ligand in
frame; they do not change molecular coordinates or replace any scientific action.

The interface renderer writes its MP4, audit, manifest, and synchronized QA frames into a private
staging directory. It publishes that directory only after every public action and every `expect`
check has completed, FFmpeg and FFprobe have succeeded, and the manifest is marked complete. Any
failure exits nonzero, deletes the staged artifacts, and leaves the previous movie and paper-frame
sources unchanged. The paper figure builder accepts only a complete manifest with replay status
`completed` and verifies each selected frame's SHA-256 before updating the figure.

Importing a valid script clears the existing molecule before installing the story. This guarantees
that the first molecular state is produced by the first recorded action, rather than inherited
from the viewer's launch molecule or a previous session.

Replay uses only `api.execute({ action, args })`; the script cannot invoke private application
routes. Optional `expect` entries compare named result fields with exact JSON values and stop the
replay before the next move on any mismatch. Arguments should use persistent design atom IDs rather
than array indices. Values returned
by one action can be captured and referenced by later actions with the existing `capture` and
`{ "$binding": "name" }` fields supported by `molarium.chemist-action-script/v1`.

## SOS1 growth-clash-v7 example

The paper-facing permalink is `https://molarium.org/sos1-hit-to-bay293`. It opens Molarium on a
blank canvas with the selected route preloaded at move 0; the reader explicitly presses
**▶ Play story** to begin. The registered presentation retains all 33 scientific actions and
adds the same 18 view/focus actions used by the interface movie. The deployment redirects this
stable path to the registered story ID, so the paper URL does not expose an asset path or require
a manual JSON import.

The example is pinned to the successful run whose audit SHA-256 is
`38d8fbd3e2675fd1203a13a7e235ff848eaf627a0d7c8450865a762f9fbe5e5b`:

- [`sos1-growth-clash-v7.full.action-script.json`](design-history/examples/sos1-growth-clash-v7.full.action-script.json)
  contains all 89 completed calls: preparation, four graph steps, inspections, three explored
  Phe890 rotamer/pose branches, undo operations, deterministic reselection, and checkpoint freezes.
- [`sos1-growth-clash-v7.selected-route.action-script.json`](design-history/examples/sos1-growth-clash-v7.selected-route.action-script.json)
  is a 33-action replay of the already-selected path. It omits the discarded branches and
  read-only inspections.
- [`sos1-growth-clash-v7.provenance.json`](design-history/examples/sos1-growth-clash-v7.provenance.json)
  records source, script, manifest, campaign, runner, and frozen-checkpoint hashes.

The defensible methods statement is: starting from the coordinate-bearing 5OVE/AXE hit, Molarium
grew the ligand until compound 21 clashed with Phe890-in; public actions enumerated three Phe890
rotamer basins, jointly refined ligand poses for each tested branch, selected the
χ1/χ2 = −180°/90° branch under the registered criterion, and propagated the predicted receptor
state to BAY-293. The selected-route replay pins the v3 pose-seeding protocol, the persistent Phe890
identity, and the unique χ1/χ2 = −180°/90° branch; it retains same-execution coordinate
guards and refuses infeasible pose application. The smooth movie
motion between endpoints is visualization, not molecular dynamics. Tyr884 was **not** predicted in
this run: its structural difference is a historical comparison between deposited structures.

Flexible complex relaxation is guarded at the ligand valence boundary. Molarium snapshots every
ligand heavy-atom bond before the optimizer and rejects/restores an output if a bond is stretched
or compressed beyond both an absolute and equilibrium-relative tolerance. This prevents a bad
complex relaxation from being presented as a chemically plausible saturated-ring conformer while
retaining the rejected result in the Chemist Actions replay outcome.
