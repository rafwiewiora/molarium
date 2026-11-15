# Hosted compound-set cofolding

Open **Run this set on a server** in the folding library panel, or open
[Server cofolding](../server-cofolding.html). Supply one protein sequence and
SMILES/name lines, choose the NVIDIA-hosted Boltz-2 or OpenFold3 method, and enter
your own NVIDIA API key. The providers' free development allowances and rate
limits apply; this is not a shared Molarium compute account.

The optional ColabFold search runs once per protein. It retains the query and up
to 255 unique aligned rows, UniRef before environmental rows, and shares that
alignment across the compounds. Provided A3M and single-sequence inputs are also
available. Every compound is a separate protein–ligand complex, not an extra
ligand competing within one multi-ligand complex.

Boltz-2 receives explicit diffusion steps and recycling count. OpenFold3's hosted
API exposes sample count (1–5) and chooses its other sampling settings internally;
the UI hides controls it cannot honor. Random seeds are provider-managed and are
not labelled as Molarium's browser seed. These hosted protocols are separate from
the pinned WebGPU implementations and from the experimental reconstruction studies.

## Submit, return, review

The page saves a submission marker before each POST, then saves the accepted
NVIDIA request ID before moving on. All accepted jobs continue at the provider
when the page closes. **Continue / retrieve** polls those IDs with GET requests;
it never silently submits an accepted or uncertain job again. The provider's
result-retention period limits how long retrieval remains possible. Keep the page
open until all jobs are accepted, and export downloaded results as a backup.

If a POST response disappears, the local job is marked **submission-unknown**.
Check its status with the provider and enter the request ID to recover it. A
browser pause cannot claim to cancel provider compute. Credential, quota, network
or local storage failures stop the coordinator before another submission.

Every returned structure and the complete provider JSON are saved locally. The
viewer loads the original provider file directly; it does not fabricate a native
input conformer or force the structure into Molarium's input-atom naming. Human
preferences, rejections, notes and “none of these” decisions identify exact
structure hashes. The export format is `molarium.hosted-library.v1`, distinct
from a WebGPU Foldarium library with its independently preserved input graph.
Imported exports may retrieve known requests and review poses, but never submit
their unstarted entries to a new account automatically.

## Data and credentials

Submission sends sequence, SMILES and the chosen alignment to NVIDIA through
Molarium's stateless relay. Alignment search additionally sends the sequence to
ColabFold. The key is passed in an Authorization header and is not written to
IndexedDB, application logs, local storage, exports or shared server configuration.
Results and decisions are stored in this browser. Local Lab blocks the feature
in both its client and server; no private credential or molecular data is embedded
in the public repository.

The relay accepts only the two fixed NVIDIA prediction paths and UUID-shaped
status IDs. It rejects foreign origins, arbitrary destinations and oversized
transfers. It does not follow result redirects with credentials. An external
download response remains an explicit provider-download requirement. A request
uses the caller's key; Molarium has no account-wide inference key or GPU pool.

## Agent interface

On the server-folding page, `window.MolariumHosted` exposes `start(input)`,
`resume(runId)`, `pause()`, `status(runId)`, `export(runId)` and `import(bundle)`.
`input` includes `sequence`, `compounds`, `name`, `model: "boltz2" | "openfold3"`,
`samples`, `msaMode`, optional `a3m`, and Boltz-2 `steps`/`recycles`.
Configure the credential in the page's password field; keep it out of recorded
action arguments. `start` waits until results arrive or the local coordinator
stops; use `status` independently for progress. The core module is also importable
for a caller that supplies its own credential and storage adapter. Credentials
must remain outside saved run inputs and event logs.

## Evidence and validation

Implementation references: [NVIDIA Boltz-2](https://docs.api.nvidia.com/nim/reference/mit-boltz2-infer),
[OpenFold3 requests and results](https://docs.nvidia.com/nim/bionemo/openfold3/example-requests),
and NVIDIA's [official Boltz client](https://github.com/NVIDIA/digital-biology-examples/tree/c9c815320d25671a4dccb7da315907b0eba822df/examples/nims/boltz-2).
NVIDIA's current [Boltz-2](https://build.nvidia.com/mit/boltz2) and
[OpenFold3](https://build.nvidia.com/openfold/openfold3) pages describe free,
rate-limited development access; that is not an unlimited production guarantee.

`server/hosted-cofold.test.mjs`, `folding/hosted-library.test.mjs` and
`scripts/hosted-cofold.browser.test.mjs` cover authenticated route restrictions,
key redaction, no Local Lab egress, durable IDs, interrupted POST responses,
duplicate provider IDs, storage failures, both response formats and retrieval
after reload. Network-contract fixtures are synthetic and are not counted as
real provider inference. An authenticated live model run remains a separate check
requiring the user's own NVIDIA key.
