# Molarium

Molarium is a local-first molecular viewer, builder, and simulation workbench.
Most calculations run inside the browser with WebAssembly or WebGPU.

Molarium's original code is available under the [MIT License](./LICENSE). Bundled software,
model parameters, force fields, and scientific data remain under their respective licenses.
The original vector identity is available as a reusable [logo](./assets/molarium-logo.svg) and
[mark](./assets/molarium-mark.svg).

## Quick start

Large ONNX models are served as versioned, hash-checked release assets rather than stored in the
public Git repository.

```sh
bun install
bun run assets:download
bun run dev
```

Open the local URL printed by Bun. A recent Chrome build is recommended for WebGPU.

### Local Lab for proprietary structures

The normal development server is **connected mode**: calculations are local, while an explicit
PDB/CCD lookup or MSA search contacts the destination shown in the interface. For a browser-enforced
same-device session, start Local Lab instead:

```sh
bun run start:local
```

Local Lab sends a restrictive Content Security Policy with every response. It permits fetches,
workers, WASM, ONNX weights, and other runtime assets only from the server's own localhost origin;
external PDB/CCD retrieval and MSA controls are disabled. The header's green **Local Lab · network
locked** indicator opens the active policy and a build verifier.

RDKit's Emscripten/Embind loader requires runtime JavaScript function construction, so the script
policy includes `unsafe-eval`. This does not relax `connect-src`, image, frame, form, or worker
destinations; reviewed-file hashes and the egress canary cover the resulting trust boundary.

Generate and test the reviewed-file manifest with:

```sh
bun run manifest:local
bun run test:local-lab
```

The test puts a synthetic proprietary-data canary into fetch and image-beacon attempts while Chrome
DevTools intercepts requests before the network. It fails if any external request reaches that
interceptor and also verifies that the loaded executable files match
[`local-lab-manifest.json`](./local-lab-manifest.json).

This creates an auditable technical control, not a promise from a label. A hosted page still controls
the code it delivers on each visit. For the strongest trust boundary, review or independently hash a
versioned checkout, run that checkout with `start:local`, and disconnect the machine after local
models are available. Large ONNX artifacts retain their separate pinned hashes in their model
manifests and model cards.

## What you can do

- Load SMILES, PDB, XYZ, and prepared molecular fixtures.
- Fetch a PDB entry by its four-character RCSB identifier.
- View proteins, ligands, waters, ions, hydrogen bonds, and aromatic stacking contacts.
- Draw and edit a small molecule in 2D while the same atoms and bonds remain visible in 3D.
- Add atoms and fragments without creating bonds from visual proximity.
- Edit bond lengths, bond angles, and torsions with undo and redo.
- Run energies, minimization, molecular dynamics, and conformer searches.
- Dock edited ligands to a captured reference core with optional required H-bonds.
- Play saved trajectories and follow a selected residue.
- Export structures, trajectories, clustered conformers, and preparation reports.

## Calculation engines

| Engine | Main use | Notes |
| --- | --- | --- |
| Direct Sage WebGPU | Small-molecule and prepared-System calculations | Experimental f32 implementation of the same numeric Sage/OpenMM terms. This is not an OpenMM GPU platform. |
| STORMM-style WebGPU | Many copies of one system | Runs homogeneous replicas together. Supports dynamics and conformer search. |
| RDKit 2025.03.4 WASM | SMILES, 3D embedding, and ligand geometry | Uses ETKDGv3 and MMFF94. Reports a real UFF fallback when MMFF94 is unavailable. |
| RDKit + Dimorphite-DL sites | Small-molecule protonation states | Enumerates empirical pH-dependent states locally, then rebuilds the selected state with ETKDGv3. Reported populations are labelled independent-site estimates, not microscopic pKa predictions. |
| ANI-2x | ML potential energies and minimization | Official eight-model TorchANI ensemble through ONNX Runtime WebGPU, with a WASM fallback. WGSL builds AEVs and forces, and conformer work is batched. |

Prepared Rosemary alpha fixtures use their exported OpenMM System and NAGL charges.
They are not retyped with Sage or Gasteiger charges in the browser.

RDKit conformer embedding uses up to four independent WebAssembly workers for searches of
32 or more requested seeds. Small jobs stay on one worker to avoid startup overhead. Molarium
merges and symmetry-prunes the worker results before STORMM advances them together on WebGPU.

## Conformer search

### Default search

The default search is one fast STORMM WebGPU workflow:

1. A small RDKit worker pool creates ETKDGv3 3D seeds.
2. MMFF94 or UFF gives each seed a short cleanup.
3. STORMM advances all seeds together with OpenFF Sage on WebGPU.
4. The schedule uses minimization, 600 K exploration, cooling, 300 K settling, and final minimization.
5. Molarium removes symmetry-equivalent structures and clusters the remaining conformers.

The Sage/STORMM conformer lane fixes OBC2/ACE implicit water, X–H constraints, a 2 fs dynamics
step, and no nonbonded cutoff. ANI-2x refinement is a separate vacuum ML potential with no OBC
term. Molecular-dynamics selectors do not change either lane's conformer-search settings.

The result is an interactive energy landscape. Cluster representatives can be exported as SDF.
For viewing, every conformer and search stage is symmetry-aware rigidly aligned on heavy atoms to
the judged minimum. This affects only display coordinates; calculations and SDF exports stay raw.

### Compare methods

**Compare methods** uses the same seed set for three candidate generators:

- vacuum MMFF-polished seeds;
- STORMM Sage/OBC2 WebGPU refinement;
- vacuum ANI-2x refinement.

ANI-2x groups matching atoms from all active conformers into shared GPU inference calls.
Each conformer still has independent coordinates, forces, line search, and convergence state.

Molarium gives every candidate one common Sage/OBC2 score in a batched STORMM WebGPU pass. It also gives every
final candidate a vacuum ANI-2x single-point score when ANI is available. The conformer map can plot
either score, or put Sage on one axis and ANI on the other. Rank-versus-rank axes compare the two
orderings without conflating their different absolute energy scales. These are separate energy
models; their absolute values are not subtracted from each other. Dot colors identify the candidate
generator.

STORMM's Sage energy is not treated as a third scoring model. Molarium checks the refinement lane
against the separate batched rescore on identical saved coordinates and stops if the two paths
disagree. Independent OpenMM Reference comparisons remain in the validation suite, not the UI.

ANI-2x is skipped when the molecule is outside its supported domain.

Run the Arena without the UI:

```sh
bun run arena:conformers -- \
  --smiles CCCCCCOCCNCC --conformers 32 --effort quick
```

## Molecular dynamics

Molarium supports vacuum and experimental OBC2/ACE implicit water. OBC2 uses mbondi2 radii.

- Flexible dynamics use a 1 fs time step.
- X–H constraints allow a 2 fs time step.
- Direct WebGPU and STORMM use SHAKE with RATTLE velocity projection.
- Direct WebGPU and STORMM evaluate the complete nonbonded range in user-facing workflows.
- The direct WebGPU engine retains a validation-only nonperiodic cutoff implementation, but it is
  not exposed in the UI because its current all-pairs neighbor-list builder is slower on the tested
  304- and 1,231-atom protein fixtures.

The UI defaults to the best currently implemented practical browser protocol: OBC2/ACE implicit
water, X–H constraints for dynamics, and no nonbonded cutoff. Adjustable solvent and constraint
settings live behind a collapsed disclosure. OBC2 is a mature lightweight implicit-solvent model,
not a claim to be the newest solvent model available in native simulation packages.

The current browser engines do not support periodic boundaries or PME. STORMM accepts
nonperiodic systems with at most 512 atoms per replica. Replicas must share one topology
and one parameter set. The UI runs replicas of the current molecule; synthetic alkane and water
demo systems remain test fixtures only. Simulation requests support up to 100,000 steps.

## Viewer and builder

The viewer uses a quaternion trackball, so rotation does not change the camera fit. Right-drag,
or Ctrl/Cmd plus left-drag, pans the scene. The mouse wheel zooms.

For small molecules, a collapsible RDKit diagram and editor sits at the lower-left of the molecular canvas.
In a protein–ligand scene it follows the active ligand rather than attempting to flatten the
protein. Selected atoms are highlighted in both representations, and clicking the 2D diagram maps
back to the original 3D atom index.

The 2D editor is another view of the same molecular graph, not a second sketch that later needs to
be merged. Its Select, Atom, Bond, and Erase tools use the same atom identities, staged chemistry
transaction, valence checks, Undo history, and Finish/Discard controls as the 3D builder. Existing
3D coordinates do not jump when topology changes. A newly drawn atom starts along an available 3D
valence direction. Bond-order changes move no coordinates until **Finish changes**, when hydrogens
are reconciled and one local 3D cleanup moves only the edited neighborhood. RDKit independently
lays out the 2D diagram again after each graph edit; those display coordinates never overwrite the
3D conformation.
MD playback uses a fixed atom-identity heavy-atom fit to each trajectory's first saved frame. This
removes whole-molecule translation and rotation from the display without changing raw coordinates,
energies, diagnostics, or exported results. Each STORMM replica receives its own reference fit.

Bonds always come from explicit topology. Adding an atom can replace an available hydrogen or
create a separate component. Molarium never creates a bond only because two atoms are close.

Build mode can change an atom's element and formal charge, create or delete a bond, and set a
single, double, triple, or aromatic ring bond. It can also add or remove an explicit hydrogen and
delete an atom. Chemistry edits are staged by default: the topology drawing updates immediately, but
automatic hydrogen reconciliation, validation, and coordinate refinement wait until **Finish changes**. This lets coupled edits such
as a tautomeric bond/H transfer reach one complete chemical state before RDKit sanitization and
one local refinement. **Discard** restores the pre-edit structure, and one Undo reverses a finished
batch. An advanced option restores finish-and-refine-after-every-edit behavior. Formal charge is
user-editable; force-field partial charges are still derived by the selected parameterization
method. Canonical protein atoms stay protected and are handled by Protein Preparation, while
ligands and small molecules remain editable.

After a finished chemistry batch, Molarium runs one local MMFF94/UFF cleanup. It moves the edited
atoms, their first bonded shell, attached hydrogens, and complete touched ring systems; atoms
outside that neighborhood remain fixed. Fragment addition retains its existing two-shell cleanup.
In a protein–ligand structure, cleanup is applied to the edited ligand component and every protein
atom stays fixed. Build offers separate ligand-only and pocket-aware optimization actions. OpenMM
Reference remains an internal numerical validation oracle and is not exposed as a calculation method.
An explicit protein–ligand optimization retains up to 26 real optimizer snapshots, opens View when
complete, and exposes the same energy curve, slider, play, and final-frame controls as other
minimization trajectories. Ligand-only snapshots are expanded back into the complete complex with
the protein coordinates held exactly fixed.

Protein cartoon mode can show a complete 5 Å ligand pocket or only residues involved in the
current hydrogen bonds and aromatic stacking contacts. Clicking a protein atom can keep that
residue centered during trajectory playback.

## Reference-guided pose refinement and constrained docking

For a ligand edited inside Molarium, **Pose Propagation-1** is the default. Capture the prepared
reference pose, edit the ligand, and refine: every surviving heavy atom is identified from the
recorded graph-edit lineage and remains fixed at its exact reference coordinate unless the edit
changes existing ring chemistry. A changed ring is released as one audited unit, including a direct
carbonyl, while the external reference scaffold remains fixed. Added or replaced graph branches
undergo deterministic-seed acyclic-torsion and protected-ring search. Moves touching a
perceived stereocenter, ring carbonyl/multiple bond, or lactam geometry are excluded. Required
contacts drive a dedicated pharmacophore-capture stage before ordinary physical scoring is allowed
to act; explicit relative-strain and steric-clash sanity gates prevent a geometrically satisfied but
chemically broken structure from being called captured.
The edited ligand then
receives a fixed-scaffold OpenFF Sage relaxation; a relaxed result is kept only when it preserves
required-contact feasibility and improves the complete pose-ranking objective. No manual core
selection is needed.

**Optimize** and **Refine edited group** are deliberately different. Optimize performs one local
force-field descent from the coordinates currently on screen; ligand-only Optimize does not include
the receptor in its energy. Refine launches the selected number of independently seeded
internal-coordinate search chains, first generates against the selected contact potentials,
physically refines only captured poses against the rigid receptor, applies
guarded fixed-scaffold relaxation, clusters duplicate heavy-atom geometries, and reports distinct
poses. It therefore perceives the receptor; it is still a local analogue-pose method, not global
docking.

This follows established congeneric/RBFE pose-preparation practice: preserve a trusted reference
common region, sample modified substituents, resolve local clashes, and audit alternate binding
modes rather than beginning with unconstrained global docking. Required D–H–A contacts remain hard
feasible states during search. When an R-group replacement removes a contact atom, Molarium maps it
automatically when the sanitized edit contains one donor/acceptor-role-compatible feature at the
same recorded edit boundary. Carbonyl, sulfonyl, nitrile, and other bioisosteric feature classes may
therefore transfer the same interaction intent. Multiple candidates remain an explicit any-of
restraint and are evaluated during generation; geometry is never used to manufacture eligibility.
The immutable receptor participant and complete decision are recorded in the hash-linked labbook.

**ConstraintDock-1** remains an expert selected-core search. It accepts any connected,
non-collinear selection of at least three ligand heavy atoms, generates deterministic ETKDGv3
conformers, snaps the selected stable identities to the reference, and runs the same constrained
torsion search. Independently imported analogues do not yet receive an automatic MCS; that future
path needs symmetry-aware chemical mapping rather than a JavaScript graph guess.

The receptor stays rigid. Ranking combines captured receptor/edited-ligand numeric Lennard-Jones
and Coulomb cross terms (8 Å site, relative dielectric 4), relative vacuum OpenFF Sage 2.1 intramolecular
ligand energy, and explicit restraint penalties. The strain reference is
relative to the lowest fixed-core starting seed. Pose propagation begins from the recorded edit;
only the expert selected-core search uses MMFF94/UFF-prepared ETKDG conformers. Both paths omit
receptor relaxation, solvent displacement, macrocycle/fused-ring concerted search, entropy, and
binding-free-energy estimation. Treat the result as an experimental pose rank, not an affinity.

Every run can export readable Markdown notes and a coordinate-free JSON audit containing exact
input hashes, the immutable protocol snapshot, selections, seed, ordered hash-linked events, scores,
and a final SHA-256. Method lineage, exclusions, tests, and the engineering decision ledger live in
[`docking/`](./docking/). The exact implementation-independent procedure, equations, random-number
vector, failure rules, and validation contract are frozen in
[`docking/POSE-PROPAGATION-PROTOCOL.md`](./docking/POSE-PROPAGATION-PROTOCOL.md).

## Chemist Actions API

Molarium exposes a versioned in-browser API for agent and scripted use, but only at the same action
boundary available to a chemist in the interface. It can inspect persistent atom IDs, select bonded
paths, edit atoms and bonds, finish or discard chemistry, undo/redo, capture a reference pose,
choose required contacts, refine/apply a pose, and run a visible Build optimization method. It does
not expose fixture injection, arbitrary JavaScript callbacks, internal scoring functions, direct
coordinate replacement, or network actions. Commands execute serially and are appended to the
current molecule's audit ledger. See [`CHEMIST-ACTIONS-API.md`](./CHEMIST-ACTIONS-API.md).

Production loads `app.js` as a module and does not install the privileged regression harness.
Automation hosts must grant agents only the frozen JSON action object, not an arbitrary JavaScript
console; local test servers expose the synthetic harness only with the explicit `--test-api` flag.

## Protein input and preparation

The browser PDB path can:

- select one model and resolve alternate locations;
- use residue templates, CCD records, and `CONECT` records for bonds;
- rebuild supported missing side-chain atoms;
- add standard hydrogens and choose common protonation states;
- orient rotatable polar hydrogens while heavy atoms stay fixed;
- keep all, remove all, or automatically retain and protonate likely crucial crystallographic waters;
- produce a downloadable preparation audit.

`Prepare structure` runs repair, audit, and experimental parameterization as one action. A clean
audit continues automatically. If the audit finds a blocker, Molarium stops and opens the
collapsed **Preparation details** panel; successful reports stay folded but remain downloadable.

The recommended crystal-water policy is geometry based. It retains deposited waters with occupancy
at least 0.5 (or unspecified occupancy) when the oxygen is 2.2–3.5 Å from both a ligand and a protein
polar atom, or when it connects a multi-residue protein polar network. The preparation report lists
the contacts and reason for every retained water. This is a conservative reproducible screen, not a
free-energy claim; **Retain all** remains available for curated water networks.

Preparation stops on unsupported chemistry, missing backbone atoms, severe generated-atom
clashes, and other unsafe cases. It does not build missing loops, membranes, metal coordination,
covalent ligands, or periodic solvent boxes.

After preparation and parameterization succeed, the applied audit is authoritative. Residues that
were absent from the deposited coordinate model and accepted chain breaks remain visible as
provenance warnings; they are not counted again as new blockers.

This path is for browser design and cleanup. It is not a replacement for a production protein
preparation workflow. Arbitrary proteins currently use experimental Sage/Gasteiger parameters.
Use an officially prepared numeric System for quantitative simulation.

The bundled Trp-cage and ubiquitin fixtures are hydrogen-complete protein Systems prepared outside
the browser with the official OpenFF Rosemary/NAGL stack. They demonstrate that Molarium's browser
engines can correctly execute a properly prepared protein System; they do not demonstrate
browser-native Rosemary parameterization of an arbitrary protein. Trp-cage is available in the
**Fold Protein** panel, and ubiquitin is available as a benchmark fixture in [`openff/`](./openff/).

## ANI-2x limits

The ANI-2x lane supports one neutral, closed-shell, hydrogen-complete molecule containing only
H, C, N, O, F, S, and Cl. The current browser limit is 96 atoms. ANI-2x is not a protein force
field or a solvent model. The UI disables it for unsupported structures.

Model export code, hashes, reference values, and the TorchANI license are in [`mlip/`](./mlip/).

## OpenFold 2

Molarium includes a trained, template-free OpenFold 2 browser predictor for one protein chain
up to 128 residues. It sends the sequence to a configured ColabFold/MMseqs2-compatible MSA
service, then runs model inference locally with ONNX Runtime WebGPU or WASM.

The predictor uses 64- and 128-residue model buckets. The large model files are downloaded as
versioned, hash-checked runtime assets. It uses one checkpoint, three recycles, no templates, and
no Amber relaxation.

Model provenance is in
[`openfold-export-results/trained/MODEL-CARD.md`](./openfold-export-results/trained/MODEL-CARD.md).

## Scientific status

Molarium is experimental software.

The prioritized roadmap, measured speed ledger, implementation lineage, and acceptance checks for
new calculation engines are maintained in
[`NEXT-BEST-IDEAS.md`](./NEXT-BEST-IDEAS.md).

The proposed local workstation, Modal, and Colab CUDA connection protocol is documented in
[`REMOTE-CUDA-DESIGN.md`](./REMOTE-CUDA-DESIGN.md).

- Gasteiger charges are a browser MVP, not Sage's preferred AM1-BCC or NAGL workflow.
- Direct WebGPU uses single-precision arithmetic.
- OBC2/ACE, WebGPU constraints, and cutoff kernels have OpenMM comparison tests, but remain experimental.
- GFN1-xTB and GFN2-xTB are unavailable because no browser engine is installed.
- Energies from scientific methods are shown in kcal/mol.

Normal calculation engines run in the browser and do not send coordinates to a server. Connected
mode can retrieve PDB/CCD records and sends a protein sequence to the selected MSA service when the
user starts a search. Local Lab blocks all of those external requests at the browser-policy layer.

## Tests

Run the main browser and chemistry suite:

```sh
bun run test
```

It checks OpenMM, direct WebGPU, STORMM, RDKit, ANI-2x, OBC2, constraints, conformer search,
protein import, preparation, trajectory controls, and viewer behavior.

Other useful commands:

```sh
bun run test:sage-golden -- /path/to/goldens.zip
bun run test:ani-webgpu
bun run benchmark:rosemary
bun run benchmark:conformer-value -- --conformers 64 --effort thorough
bun run test:stormm-webgpu
bun run test:stormm-openmm
bun run test:openfold-features
```

The study is isolated in [`independent-layout-study.css`](./independent-layout-study.css) and
does not change application behavior or the primary interface.

An optional real-complex preparation test accepts these environment variables:

```sh
MOLARIUM_PREPARATION_PDB=/path/to/complex.pdb \
MOLARIUM_PREPARATION_CCD=/path/to/ligand.cif \
MOLARIUM_PREPARATION_CCD_ID=LIG \
MOLARIUM_PREPARATION_PARAMETERIZE=1 bun browser-test.js
```

## Project layout

- [`openff/`](./openff/) — Sage data, parameterization, implicit solvent, and prepared fixtures.
- [`openmm/`](./openmm/) — OpenMM WebAssembly bridge and build files.
- [`webgpu/`](./webgpu/) — direct Sage WebGPU kernels and validation notes.
- [`stormm/`](./stormm/) — fixed-point replica engine and OpenMM comparisons.
- [`rdkit/`](./rdkit/) — RDKit WebAssembly bridge and license.
- [`mlip/`](./mlip/) — ANI-2x export, models, tests, and license.
- [`openfold/`](./openfold/) — OpenFold feature and prediction code.
- [`paper/`](./paper/) — preprint source.

Build the preprint after installing TeX Live, `latexmk`, and Biber:

```sh
make -C paper
```

Third-party licenses are stored beside the corresponding engine or model files. The consolidated
component, data, model, design-inspiration and citation record is in
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md). The distribution includes ONNX Runtime
Web 1.27.0's complete, version-pinned [`ThirdPartyNotices.txt`](./licenses/ONNXRUNTIME-1.27.0-THIRD-PARTY-NOTICES.txt).
