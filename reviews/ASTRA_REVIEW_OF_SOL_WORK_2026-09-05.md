# Astra review of Sol work — 5 September 2026

## Verdict and scope

The numerical work has useful positive evidence, but the software does not yet consistently
enforce its own fail-closed rules. Unsupported requests, malformed results, and an untested
local-server boundary can get past the normal green checks. Harden those boundaries before
expanding performance claims or treating the current validation as a general certification.

This is the user-requested review label, not an independently verified attribution of every
commit to a particular model. The review includes the latest benchmark release as well as
older work; the manifest and benchmark-score defects below include issues in that latest release.

Reviewed public Molarium commit: `995f9fd539b3c86eb698472e3aa9a88afbb6bd44` (PR #18 merged).
An isolated worktree was used. No production sources, thresholds, published measurements,
permissions, or deployed resources were changed during this review. Only this report and its
diagnostic artifacts were added. Nothing was pushed or published.

The pass covered the repository inventory, TODO/lessons/backlog, both classical WebGPU
workers, STORMM topology/engine boundaries, native/WASM benchmark provenance and scorers,
CI wiring, Local Lab/server/build integrity, and selected campaign, asset-transfer, and
public-action boundaries. Existing broad scientific tests were rerun. This was a risk-led
first pass, not a line-by-line audit of all 940 tracked files, third-party binaries, model
weights, every docking search path, or long-time simulation behavior.

## Confirmed findings

P1 means address before relying on the affected scientific boundary or exposing the local
service. P2 means a concrete reliability, validation, or reporting defect. These priorities
are review judgments, not CVSS scores.

### R1 — P1: unsupported force content and cutoff requests are silently discarded

`stormm/core.mjs:745` checks that the seven familiar System arrays exist but does not reject
additional force-bearing keys. A synthetic `customExternalForces` entry was accepted, and
both packed topology buffers were byte-identical to the System without that force. This is
not an allegation that any published fixture contains this extra term: it demonstrates that
an unsupported imported System can silently become a different Hamiltonian.

There is a separate, directly reachable option problem at `stormm-worker.js:41`: the worker
overwrites the caller's cutoff with `nonbondedCutoffNm:0`. A real Chrome worker accepted
`cutoffNm:0.8` and returned a normal result, identical to the no-cutoff control. The engine
does not implement this requested mode and should reject it rather than discard it.

Remedy: version and validate the entire numeric-System schema; explicitly reject unsupported
force classes, periodic settings, and nonzero cutoff requests at the worker boundary. Keep
these as negative tests. Share a schema contract, not an implementation of the physics, with
the independent oracle. The existing independent cloud-panel Python validator already has
an unknown-System-key rejection pattern worth reusing conceptually.

Evidence: `unsupportedForce` in the [CPU probes](astra-2026-09-05-probes.results.json), and
`unsupportedCutoff` in the [source-hashed browser probes](astra-2026-09-05-browser-probes.a03.results.json).

### R2 — P1: the development server exposes repository files and defaults to all interfaces

`server.js:99` serves any existing path beneath the checkout, without an asset allowlist or
dotfile denial. The isolated loopback probe fetched `/.git` successfully (HTTP 200, 70 bytes;
contents were not retained in the report). In a worktree this is a Git metadata pointer.
Other repository-local files would be reachable by known path under the same rule, including
private calculation inputs or environment files if present.

`server.js:65` sets a loopback hostname only in Local Lab mode. The normal `bun run dev` and
`bun run start` omit it; Bun documents the default as `0.0.0.0`, making the service potentially
reachable beyond localhost depending on the host firewall/network. This is a source-supported
exposure risk, not evidence that someone accessed files. No LAN scan or secret-file request
was performed. [Bun server configuration](https://bun.sh/docs/runtime/http/server#changing-the-port-and-hostname).

Remedy: default to loopback in both modes, make LAN sharing an explicit choice, serve an
allowlisted runtime tree, and reject dotfiles/private artifact paths. Check resolved paths
against symlink escape as well. The Cloudflare production build uses an explicit asset list;
this finding does not establish exposure of the checkout on molarium.org.

Evidence: `gitMetadataRoute` in the browser probes; `server.js:65` and `server.js:99`.

### R3 — P1: the standalone scorer can pass an empty suite or incomplete force vectors

With `cases:[]` in a consistently hashed packet/reference/result triple, `score.mjs` exits
zero and reports `gate.passed:true, total:0`. A two-atom case with only three Cartesian force
values in each result also passes. `metrics.mjs:15` checks equal, nonempty triple lengths,
but neither it nor `score.mjs:18` ties them to `3 × molecule.atoms.length`.

Remedy: validate schemas, nonempty and unique case IDs, expected case-set identity, and
exact `3N` force lengths for original, rounded, and actual results. Distinguish a valid
diagnostic subset from a full protocol pass. Validate the embedded protocol against the
declared protocol identity rather than accepting agreement between unverified labels.

Scope: these are false-pass opportunities in the standalone gate, not discovered omissions
in the released data. All six accepted result rows currently contain 47 cases and complete
`3N` vectors; the frozen-results tests also require 47 cases. Their existing energy/force
decisions remain supported.

Evidence: `emptySuite`, `truncatedForces`, and `publishedForceLengths` in the CPU probes.

### R4 — P2: invalid frame counts can produce a successful but empty STORMM result

`stormm-worker.js:216` converts `savedFrameCount` without checking finiteness. Passing
`savedFrameCount:'not-a-number'` makes the count NaN. Allocated output arrays have zero
length, and the frame-driven dynamics loop does not execute. Chrome returned `type:'result'`,
no coordinates, empty `frameSteps`, and absent energies; the serialized NaN frame count is
shown as JSON null. The two-step control returned six coordinates and steps `[0,2]`.

Remedy: reject invalid frame counts before GPU allocation, and validate every successful
result's requested step count, frame count, coordinate shape, and finite energies before
posting it. The public worker must enforce this even if the normal UI supplies valid values.

Evidence: `invalidFrames` and `control` in the browser probes; `stormm-worker.js:216`.

### R5 — P2: native original-input score JSON uses the wrong native evaluation

`benchmarks/simulation/score.mjs:21` selects `measured.result || measured.rounded` and uses
that same value for both packed-input and original-input comparisons. Native results contain
distinct `original` and `rounded` evaluations, so their `originalInputAgreement` field is
mislabelled. CUDA double's frozen score says 42 original-input cases pass; comparing the
actual original evaluations correctly gives 47.

The published README table is correct: `build-report.mjs:29` separately uses
`measured.result || measured.original`. Thus the human-readable table and a machine-readable
field disagree. The primary fixed-input 47/47 gate is unaffected.

Remedy: use distinct evaluation selections and test both. Regenerate corrected scores into
new provenance-separated artifacts; retain the superseded score files and their explanation.
Do not alter raw scientific results or loosen tolerances. No GPU rerun is needed merely to
correct this derived statistic when the original raw vectors are already available.

Evidence: `nativeOriginalScore` in the CPU probes.

### R6 — P2: the checked-in Local Lab manifest is stale

Four of its 240 entries disagree with the reviewed checkout: `package.json`,
`webgpu-worker.js`, `webgpu/molarium-webgpu.wgsl`, and `openff/implicit-solvent.js`.
The real Local Lab test exits 1, with 12/14 checks passing; its build verifier reports
`Verification failed: package.json: size mismatch`.

The other failing check is a test race, not a confirmed UI defect: `local-lab-test.js:159`
clicks an asynchronously handled action and checks the dialog immediately. A separate probe
found `immediate:false, afterWaiting:true`. The panel opens correctly after awaiting it.
External fetch/image canaries were blocked, with zero external requests reaching the
interceptor. A stale manifest is not evidence that the outbound-network lock failed.

Remedy: update the test to await the visible privacy panel, regenerate the source manifest
after the final source changes, and enforce freshness in CI. Keep source and generated
deployment manifests conceptually separate; regenerating a manifest is not itself a human
security review.

Evidence: `localLabManifest` in the CPU probes, `privacyPanel` in the browser probes, and
the `npm run test:local-lab` output recorded under verification below.

### R7 — P2: direct-worker parameter packing accepts invalid physical values

The actual `packSmirnoffModel` function accepts `mass_amu:Infinity` and packs zero inverse
mass (`webgpu-worker.js:199`); it checks positivity but not finiteness. It also accepts
negative Lennard–Jones epsilon values (`webgpu-worker.js:141`), because only finiteness is
checked there. These were isolated packing probes, not claims of successful full trajectories
with those inputs. Downstream non-finite checks do not replace a correct input contract.

Remedy: validate finite positive masses, valid LJ domains, coordinates, all valence parameter
domains and indices, and their representability after f32 conversion before dispatch. Use
the same explicit rejection contract across direct and replica workers.

Evidence: `infiniteMass` and `negativeLennardJones` in the CPU probes.

### R8 — P2: normal CI does not execute the dedicated GPU numerical or Local Lab suites

`package.json:119` defines `test:ci:webgpu`, but `.github/workflows/ci.yml` does not call it.
The default browser command runs interface/integration scopes; it is not the dedicated
STORMM force/NVE/constraint suite. Neither default job invokes `test:local-lab`.
The new simulation CI step validates frozen evidence and acceptance logic, not fresh GPU
force evaluation. All of those checks have value, but they establish different things.

Remedy: add an explicitly software-adapter-labelled numerical smoke job where practical
(never use it for hardware speed claims), a Local Lab integrity/privacy job, and a scheduled
physical-GPU release matrix. Log unsupported adapter availability as a skip/failure category,
not as a successful physical-GPU run.

Evidence: `.github/workflows/ci.yml:47`, `package.json:113`, and the successful dedicated
local reruns despite the separate adversarial failures above.

## What the STORMM/OpenMM comparisons actually establish

| Comparison | Evidence found | What it does not establish |
| --- | --- | --- |
| Molarium OpenMM WASM → native OpenMM | Five fixed Sage poses; vacuum, no cutoff, no constraints; same C bridge linked natively; near-roundoff energy/force agreement | All OpenMM benchmarks, all bridge options, OBC2/constraint coverage, or independent System construction |
| STORMM-style WebGPU → bundled WASM Reference | Five static fixtures, component energies/all forces, plus constrained-water dynamics; rerun passes | Broad native-OpenMM validation of the current replica worker |
| Direct WebGPU → independently built native OpenMM | Current 47-case suite; M1 Pro and L4; original/f32-separated references and native precision baselines | STORMM-style worker coverage; the two GPU engines are separate implementations |
| Historical STORMM-style kernels → upstream STORMM | Private `marco/stormm-study`: alanine dipeptide and Trp-cage regression energies/all forces; native CPU and same-L4 CUDA timings | Current production-worker certification or comprehensive upstream STORMM feature parity |
| Historical Rosemary short trajectories → native OpenMM | Native Reference/CUDA observable and constraint checks in `stormm-study` | Pointwise force parity on a broad frozen panel or long-time ensemble equivalence |

The five-pose WASM/native boundary is explicit in
`paper/development-log/episodes/2026-08-23-native-pose-validation.md:69` and
`docking/validation/cloud-panel/openmm-wasm-native-validation-2026-08-23.json`.
It must not be described as “WASM OpenMM has been compared to native over all benchmarks.”

The older STORMM study is tracked in the separate private `rafwiewiora/marco` repository,
not present as `stormm-study/` in the reviewed public Molarium tree. Its ten L4 checksum
entries all verified. It reports WebGPU reaching 0.39–0.73 times native STORMM CUDA aggregate
throughput for 16 alanine replicas, 10,000 steps, flexible/constrained vacuum/polar-only OBC2.
Those are historical Node/Dawn WebGPU kernel-engine measurements, not new production-browser
job timings. Alanine CMAP is explicitly omitted from supported-term comparisons, and the
matched STORMM model uses a different Coulomb constant, dielectric 78.5, and no ACE surface term.
Retain those qualifications if the study is brought into the public ledger. Inspecting and
hash-checking an old result is not rerunning it on the current implementation.

### Keep WASM, but give it the right role

WASM Reference remains useful as a local double-precision diagnostic reference, an offline
regression tool, and for actual features still using it. In particular, pose propagation
currently performs ligand-only fixed-atom Sage valence cleanup through OpenMM/WASM
(`CHEMIST-ACTIONS-API.md:361`). Removing the runtime outright would require migrating and
validating that behavior. The parameter-only branch in `openmm-worker.js:263`, however,
returns before `getOpenMM`; use of that worker's name does not imply that parameter assignment
requires WASM OpenMM execution.

WASM Reference is not a meaningful headline competitor for modern native GPU throughput.
The old replica benchmark advances one serial Reference Context for the equivalent aggregate
number of steps (`stormm/openmm-reference-validation.mjs:441`); it does not measure a tuned
native OpenMM ensemble. Keep those numbers labelled as historical in-browser baselines.

Yes: test the STORMM-style engine directly against independently constructed native OpenMM,
not merely “just in case.” The native route removes the WASM compilation and shared bridge
from the trust chain; matching against one limited intermediate is not proof for all other
inputs. Upstream OpenMM itself uses both per-platform Reference comparisons and independent
program comparisons. [OpenMM validation methods](https://docs.openmm.org/latest/userguide/library/07_testing_validation.html).

### Next benchmark tranche

1. Add a STORMM adapter to the frozen native-oracle protocol for its supported subset. Compare
   every force component, individual energy terms, original versus packed inputs, translated
   and near-minimum structures, constraints, and OBC2. Mark unsupported cases explicitly:
   the current 512-atom cap excludes ubiquitin and DHFR; do not silently drop or shrink them.
2. Test the production worker as well as the core engine: exact per-replica steps and frames,
   score-batch shape/order, independent streams, one-versus-many isolation, and failure paths.
3. Benchmark native OpenMM CUDA/OpenCL and native STORMM on the same physical GPU, with matched
   numeric models and clearly separated setup/readback/steady-state timing. Sweep molecule
   size and replica counts up to each actual cap. Compare legitimate native ensemble strategies,
   not just one serial Context, and report both aggregate and per-replica ns/day.
4. Preserve the older native STORMM evidence as historical and rerun where current claims
   require it. Add longer NVE and thermostat/distribution checks; different stochastic
   integrators should not be required to reproduce identical trajectories.
5. Keep WASM/native parity as a secondary compatibility gate across the bridge's supported
   features, particularly the constrained/implicit-solvent paths absent from the five-pose test.

These are recommendations from this review, not jobs submitted or results already obtained.

## TODO, lessons, and cleanup reconciliation

No existing backlog items were deleted or silently marked complete. Suggested edits:

| File | Needed update |
| --- | --- |
| `TODO.md` | It has one task and no link to the much larger backlog. Keep its reference-preserving restrained pocket-relax item open: the current induced-fit minimizer explicitly lacks the docking interaction restraints. Add a short pointer and prioritized boundary/benchmark follow-ups. |
| `LESSONS-LEARNED.md` | Preserve the dated cutoff measurements. Add the energy-reduction failure/fix, fixed-f32 versus original-coordinate precision limits, independent-oracle boundaries, exact `3N` output checks, and the distinction between a GPU smoke test and frozen-evidence verification. |
| `NEXT-BEST-IDEAS.md` | Mark P0 ledger and cross-device work partially delivered for the direct engine only. Link the 47-case release; leave three-vendor Gate I, STORMM-native expansion, and long-time gates open. Label the 10.3x/24.1x rows WASM Reference, not the ambiguous “Reference CPU.” |
| Replica tuning backlog | Basic tuning is already implemented (`runReplicaSmoke`, UI recommendation). Separate completed smoke/recommendation work from missing repeated samples, cache policy, and cross-device validation. |
| Final recommendation in `NEXT-BEST-IDEAS.md` | It still questions whether WGSL AEV work is the right next optimization even though the same document records that work as completed. Replace that stale recommendation with currently open gates. |
| Historical `stormm-study` | Reconcile the public backlog's native-STORMM numbers with their separately stored evidence; do not present those numbers as source-hashed current-worker results. |
| Development test plumbing | Keep Local Lab asynchronous UI checks synchronized with public actions. Do not suppress the manifest failure to make the test green. |

Relative-file links in the seven inspected top-level/engine documentation files all resolved.
The issues are status, scope, and evidence discoverability, not a reason for a bulk rewrite.
Do not delete failed benchmark attempts, historical measurements, scientific checkpoints, or
the WASM runtime merely to make the repository look cleaner.

## Verification and reproducibility

Fresh local runs on the unchanged reviewed source:

- `bun install --frozen-lockfile`: passed.
- `npm run test:simulation-benchmarks`: 44/44 passed.
- `npm run test:ci:scientific`: passed (including campaign/publication, docking, registry,
  WASM evidence, feature, and replay gates).
- `npm run test:stormm-webgpu`: passed on M1 Pro (energies, finite differences, NVE,
  overflow/range, replay, thermostat, constraints and existing guards).
- `npm run test:stormm-openmm`: passed on M1 Pro (five static fixtures plus constrained water).
- `npm run test:local-lab`: failed, 12/14; stale manifest plus immediate-dialog test race;
  zero external requests reached interception, and both CSP canaries were blocked.
- Historical L4 `stormm-study/results/l4-vws/SHA256SUMS`: 10/10 entries verified, read-only.
- Adversarial CPU and isolated Chrome probes: reproduced the findings above. No extra GPU
  infrastructure was started, and temporary browser/server processes were closed.

Reproduce the probes from the repository root:

```sh
node reviews/astra-2026-09-05-probes.mjs
bun reviews/astra-2026-09-05-browser-probes.mjs
```

An optional output argument writes a NEW JSON file exclusively; existing evidence cannot be
overwritten. The CPU program creates and removes only its own synthetic temporary fixtures.
The browser program uses an isolated profile, a loopback-only server, two synthetic atoms,
and a benign Git-metadata request; it does not inspect secret files. The first browser
result is retained alongside the source-hashed `a03` result. An intermediate probe used an
incorrect readiness symbol and timed out; correcting the probe to the real
`MolariumChemistActionsReady` API confirmed that the privacy-panel failure was a test race.

The probes record behavior, not assertions that it is correct. Convert each confirmed issue
into a failing regression test when implementing its fix. Keep this dated report unchanged
and append a remediation log linking later fixes and rerun evidence.

## Remediation log — September 5, 2026

The original findings above are preserved as the review of `995f9fd`; they are not a
claim that every defect remains in the source below this log. The user subsequently
authorized implementation and public publication.

First remediation increment:

- **R3 fixed:** the scorer validates packet/result schemas, the reviewed protocol content
  and hash, unique registered case IDs, nonempty coverage, declared atom counts, and exactly
  3N finite forces in every original/rounded/measured observation. The 46-case suite is
  explicitly named; diagnostic subsets never pass the acceptance gate. Regression tests
  cover the original false-pass cases and forged protocol tolerances.
- **R5 fixed:** native original-input agreement uses the native original-input observation.
  All six published datasets were re-scored from hash-verified, unchanged raw evidence.
  [New scores and provenance](../benchmarks/simulation/results/rescored-20260905-a03/manifest.json)
  coexist with the original score artifacts. The CUDA-double original-input score now
  correctly passes 47/47; fixed-input decisions and all timing samples are unchanged.
- **R6 fixed:** the curated manifest was regenerated, the privacy-button check now waits
  for its asynchronous public action, and `manifest:local:check` rejects stale committed
  hashes without regenerating them. Local Lab passes **14/14**, with both CSP canaries
  blocked and **zero** external requests reaching interception.
- **R8 partially fixed:** CI now runs the Local Lab freshness and browser enforcement gate.
  Fresh GPU numerical dispatch in CI remains open; archived-evidence tests are not a substitute.
- **R1, R2, R4, R7 and native STORMM expansion remain open** for the next implementation
  increment. [TODO](../TODO.md) retains these tasks and the unimplemented restrained relax.
- The **Design-tab/LSD bug and Reproductions index** were separately merged in
  [PR #19](https://github.com/rafwiewiora/molarium/pull/19). Source, production-bundle,
  and deployed-site regressions all preserve exact LSD coordinates/bonds with a real SOS1
  campaign saved; restoring it requires explicit `campaign.resume`.
- An intermittent local Chrome replay-route check hung during its first checkpoint
  import after rapid navigation. It reproduced on unchanged pre-fix source as well;
  the fixed-source rerun and Linux CI passed. Root cause is not yet established or fixed.

Verification for this increment: **63/63 simulation benchmark tests**, **14/14 Local Lab
checks**, and the deployed saved-campaign regression pass. Frozen-evidence tests now
recompute original-input and input-quantization metrics as well as the packed-input gate.

Second remediation increment (implementation and verification in progress):

- **R1/R7 fixed in source:** the versioned seven-array numeric System contract rejects
  unknown force-bearing fields, invalid indices/domains, non-finite numbers, and f32
  overflow. All 47 published input Systems validate without changes. Signed Rosemary
  torsion amplitudes remain valid. OpenMM WASM, direct WebGPU, and STORMM workers enforce
  the boundary; the native Python builder has an independent validator. STORMM rejects
  nonzero cutoffs under either alias, including conflicting aliases.
- **R2 fixed in source:** both local modes default to loopback, explicit connected LAN
  binding is opt-in, and exact public-path allowlisting plus canonical-path checks block
  dotfiles, private artifacts, and symlink escape. Foreign Host headers and non-read
  methods are rejected. Unit and live HTTP tests pass in both server modes.
- **R4 fixed in source:** malformed frame/work counts fail before GPU allocation; STORMM
  validates complete finite trajectory shapes and exact requested endpoints. The physical
  M1 production-worker regression rejects 30 invalid requests and verifies analytic
  energy/all forces, separate replica energies, and exact two-step frame output.
- **R8 advanced:** CI now dispatches production workers on explicitly labelled software
  WebGPU for correctness only. The physical M1 full STORMM suite passes, including force
  finite differences, NVE, thermostat, determinism, replica isolation, and SHAKE/RATTLE.
  A scheduled physical cross-vendor matrix and longer protein soaks remain open.
- **Additional fixed-pose defect:** STORMM score-batch formerly projected constrained
  input coordinates before scoring. Read-only evaluation now preserves the supplied pose,
  cannot advance/minimize it, and exposes `constraintsApplied:false`. A deliberately
  unsatisfied analytic bond constraint verifies unchanged coordinates, energy and forces.
- **Native STORMM expansion:** the production worker now exposes an energy/all-force job;
  a registered 22-case supported subset of the full 47-case native panel and a separate
  original-input scorer retain 25 explicit unsupported cases. Physical measurements are
  tracked separately from the existing direct-worker gate; do not equate STORMM Å/kcal
  packing with the direct worker's f32-nm oracle.
- **Replay startup remains unresolved:** the intermittent first-checkpoint import hang
  also occurred in a Linux post-merge CI rerun. Three instrumented rapid-navigation runs
  and an IndexedDB upgrade-navigation probe passed, so no root cause is established.
  `scripts/diagnose-replay-startup.browser.mjs` preserves operation-only traces. The server
  harness now uses OS-allocated ports and reports startup errors directly; this addresses
  ambiguous startup diagnostics, not the separately observed checkpoint hang.
