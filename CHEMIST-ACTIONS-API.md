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
manifest for the running build.

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
- `view.setMode`
- `build.setTool`
- `selection.replace`, `selection.clear`
- `chemistry.setAtom`, `chemistry.setBond`
- `chemistry.deleteAtom`, `chemistry.deleteBond`
- `chemistry.addHydrogen`, `chemistry.removeHydrogen`
- `chemistry.finish`, `chemistry.discard`
- `history.undo`, `history.redo`
- `pose.captureReference`, `pose.setContact`, `pose.refine`, `pose.apply`
- `optimization.run`

The exact argument contract is returned by `describe()`. Unknown actions and unexpected arguments
fail closed. Inputs must be finite, plain JSON values; prototype-bearing objects, functions,
cycles, over-deep inputs, and payloads larger than 32 KiB are rejected. Commands are serialized, so
two agent calls cannot interleave one chemistry transaction.

## Inspection and privacy

Inspection defaults to the current ligand, omits coordinates, and returns at most 100 atoms. A
caller may explicitly request ligand, current-selection, or all-molecule scope, coordinates, and a
limit no larger than 500 atoms. This is an in-page API: it performs no network request. Loading a
PDB identifier or using another connected feature remains a separate user-visible action governed
by Molarium's network policy.

## Audit

Every recognized action records sequence, request ID, arguments, start/completion times, duration,
status, and a compact outcome-state summary. `history()` returns a defensive copy of the current
session history. The current molecule also carries the bounded
`source.chemistActionAudit` ledger, including failed recognized actions. Unknown/internal route
requests are rejected before execution and are not accepted into the scientific ledger.

This v1 action ledger is an execution audit, not the calculation labbook. A reference-guided pose
run still produces its independent hash-linked protocol labbook with input and result hashes. The
action ledger proves how the browser was operated; the run labbook proves which numerical protocol
was executed.

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
