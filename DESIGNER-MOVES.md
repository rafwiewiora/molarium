# Saving and replaying designer moves

Molarium represents a designer move as a call to the same public Chemist Actions API used by the
visible interface. A saved route is ordinary JSON with schema
`molarium.chemist-action-script/v1`; it contains action names, explicit JSON arguments, and optional
human captions. It contains no executable code, private callbacks, force-field objects, or direct
coordinate replacement.

Three related JSON records remain separate:

- a registered input protocol uses `molarium.registered-design-route/v1`;
- a replayable sequence uses `molarium.chemist-action-script/v1`;
- an append-only molecular history uses `molarium.design-campaign/v1`.

The public actions retain the `designCampaign.*` namespace so existing saved scripts continue to
replay, but those actions load and apply a registered design route, not a campaign ledger.

```json
{
  "schema": "molarium.chemist-action-script/v1",
  "label": "SOS1 selected Phe890 route",
  "actions": [
    {
      "action": "designCampaign.load",
      "args": { "campaignId": "sos1-hit-only" },
      "caption": "Load the coordinate-bearing 5OVE/AXE hit only"
    },
    {
      "action": "designCampaign.applyStep",
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
      "args": { "index": 5 },
      "caption": "Apply the selected Phe890 branch"
    }
  ]
}
```

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
imports the same JSON through the visible Build panel, presses **▶ Play story**, and records the
real Molarium interface while the public actions run. The transport changes to **❚❚ Pause**
during execution and pauses at the next action boundary, after the current scientific operation
finishes. **↺ Restart** returns to the blank canvas. Presentation-only `view.setDisplay` and
`view.focusComponent` actions select a clean chemist pocket view and keep the active ligand in
frame; they do not change molecular coordinates or replace any scientific action.

Importing a valid script clears the existing molecule before installing the story. This guarantees
that the first molecular state is produced by the first recorded action, rather than inherited
from the viewer's launch molecule or a previous session.

Replay uses only `api.execute({ action, args })`; the script cannot invoke private application
routes. Arguments should use persistent design atom IDs rather than array indices. Values returned
by one action can be captured and referenced by later actions with the existing `capture` and
`{ "$binding": "name" }` fields supported by `molarium.chemist-action-script/v1`.

## SOS1 growth-clash-v7 example

The paper-facing permalink is `https://molarium.org/sos1-hit-to-bay293`. It opens Molarium on a
blank canvas with the selected route preloaded at move 0; the reader explicitly presses
**▶ Play story** to begin. The registered presentation retains all 33 scientific actions and
adds the same 15 view/focus actions used by the interface movie. The deployment redirects this
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
rotamer basins, jointly refined ligand poses for each tested branch, selected rotamer index 5 under
the registered criterion, and propagated the predicted receptor state to BAY-293. The smooth movie
motion between endpoints is visualization, not molecular dynamics. Tyr884 was **not** predicted in
this run: its structural difference is a historical comparison between deposited structures.

Flexible complex relaxation is guarded at the ligand valence boundary. Molarium snapshots every
ligand heavy-atom bond before the optimizer and rejects/restores an output if a bond is stretched
or compressed beyond both an absolute and equilibrium-relative tolerance. This prevents a bad
complex relaxation from being presented as a chemically plausible saturated-ring conformer while
retaining the rejected result in the Chemist Actions replay outcome.
