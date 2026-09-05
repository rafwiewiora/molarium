# SOS1 crystal-series diagnosis — 2026-09-04

## Status and scope

Reference-informed diagnostic analysis, **not a prospective result or publication acceptance**.
The user explicitly authorized inspecting the target crystals on September 4:
“analyze the xtals we're actually trying to reproduce” and “5OVG and series.”
Prediction work was paused for this inspection. The existing a010 checkpoint and
placement-proxy attempts a011–a016 were not changed. Those proxy attempts predate
this inspection; subsequent choices informed by this analysis must not be called
blind to the later structures. No crystal ligand coordinates were fitted to a
prediction, injected into a campaign, or used to run a new prediction here.

## Existing notes and visual references

- [September 2 episode, including September 3 supersession](2026-09-02-sos1-interface-replay.md):
  the AWW distal ring was already misplaced; the large final AXH motion was
  compensating for that upstream error. Earlier renders and numerical results
  are not current accepted results.
- [Existing AWW/AXH measurements](../../../outputs/design-history/sos1-hit-only-growth-clash-v7/pymol-aww-axh-comparison/measurements.txt):
  the crystal-to-crystal comparison separates proximal and distal spatial
  components instead of forcing a single connected graph match.
- [Five-ligand crystal overlay](../../../outputs/design-history/sos1-preapproval/sos1-five-ligand-overlay.jpg)
  and [switch overlay](../../../outputs/design-history/sos1-preapproval/sos1-switch-overlay.jpg).
- [Native structure-review builder](../../../scripts/build-sos1-structure-review.mjs)
  records the structure, compound, component, and residue identities.

## What the structures actually show

| Structure | Component / compound | Role in the series |
| --- | --- | --- |
| 5OVE | AXE / 1 | Starting hit; original receptor coordinate source |
| 5OVF | AWT / 17 | Scaffold rewrite; Phe890 remains in |
| 5OVG | AWZ / 18 | Thiophene-linked merge; Phe890 remains in |
| 5OVH | AWW / 21 | Benzyl-alcohol arm; Phe890 out; alcohol contacts Tyr884 carbonyl |
| 5OVI | AXH / 23, BAY-293 | Attachment rewrite and terminal amine; Phe890 remains out |

The previously saved H-to-I crystal comparison used 24 shared pocket C-alpha
anchors, with receptor-fit RMSD 0.211 Å. It found:

- 11-atom proximal component: 0.261 Å RMSD.
- Seven-carbon distal phenyl/benzylic component: 0.884 Å RMSD, centroid shift
  0.877 Å, and ring-plane change 7.6 degrees.
- These are two disconnected correspondence components. The intervening
  thiophene attachment changes; a single connected 15-atom MCS gives 1.118 Å RMSD
  and obscures the spatial conservation.

These are **crystal-to-crystal observations**, not achieved prediction accuracy.
The distal ring need not make the large excursion shown in the superseded movie.

## Fresh coordinate measurements

The fresh measurements below use a different, fixed frame: the registered eight
chain-A C-alpha anchors 874, 876, 880, 885, 893, 899, 904, and 906, excluding
Phe890. Every structure and the a010 receptor were independently aligned to
5OVE with the existing evaluator's receptor-only Kabsch transform. There was no
ligand rigid-body fit. Do not silently combine these measurements with the older
24-anchor comparison above.

Ligand correspondence used the registered product SMILES and exact chemical-graph
matching through RDKit and `evaluate-sos1-holdouts.py`. Equivalent mappings were
resolved by proximal-core RMSD to a010 in the receptor frame. That is an analysis
mapping choice, not a coordinate transformation or a blind selection claim.
Dihedrals use `build-sos1-designer-validation.py` conventions.

| Measurement | 5OVG / AWZ | 5OVH / AWW | 5OVI / AXH |
| --- | ---: | ---: | ---: |
| Receptor anchor RMSD to 5OVE, Å | 0.095 | 0.187 | 0.222 |
| Phe890 chi1, degrees | −75.640 | 175.764 | −166.550 |
| Phe890 chi2, degrees, raw atom naming | −87.852 | 76.328 | 71.736 |
| Linker N7–Asn879 OD1 distance, Å | 2.747 | 2.702 | 2.717 |
| Upstream C3–N7–C12–C15 torsion, degrees | 88.744 | 104.436 | 82.923 |
| N7–C12–C15–CX2 torsion, degrees | 83.636 | −111.064 | 86.699 |

Raw chi2 values are not symmetry-adjusted. AXH changes the ring attachment, so
identically spelled CX atom names are not a blanket cross-state correspondence.

The 5OVH alcohol OX3 is 2.863 Å from the Tyr884 backbone O; the carbonyl
C–O–donor angle is 152.476 degrees. The 5OVI terminal NX1 is 2.569 Å from that
Tyr884 O and 3.134 Å from Asp887 OD1. These heavy-atom contacts support keeping
the intended Tyr884 interaction; they do not establish an observed hydrogen
orientation in these X-ray models.

### The +150-degree primary move is not the main error

In the saved a010 graph-only checkpoint:

- C3–N7–C12–C15 is 67.705 degrees, versus 104.436 degrees in 5OVH: a
  **36.730-degree upstream torsional difference**, about the N7–C12 bond.
- N7–C12–C15–CX2 is 99.278 degrees. Adding the declared +150 degrees yields
  −110.722 degrees, only **0.341 degrees** from the 5OVH value.
- The source C12–C15 axis nevertheless points **26.460 degrees** away from the
  5OVH axis in the receptor frame. The source C12 position differs by only
  0.268 Å and the 11-atom proximal-core RMSD is 0.492 Å.

Interpretation: twisting around an incorrectly directed axis cannot correct that
axis. The current primary-plus-two-distal-rotor search leaves an important
upstream exit-direction degree of freedom fixed. A designer-authorized upstream
internal-coordinate move is the next hypothesis to test; copying the measured
crystal torsion into the prediction and calling it blind would be incorrect.
This analysis does not establish that one additional rotor alone guarantees a
feasible or accurate solution.

### Keep the CB gate; distinguish exchangeable waters

As a diagnostic only, placing the *observed* 5OVH ligand in the aligned 5OVE
receptor frame gives a closest ligand-heavy-atom/Phe890-CB distance of 3.373 Å
(CX14). The equivalent closest distance to 5OVG CB is 3.354 Å. Thus the actual
crystal pose does not require the approximately 1.05 Å CB overlap in failed a010.
CB remains immovable under chi1/chi2-only response and must retain its clash gate.

The observed 5OVH ligand was also compared with the aligned full a010 receptor
(source receptor alignment RMSD 0.051 Å). Under the existing severe-clash rule,
distance below 0.62 times the sum of van der Waals radii, it has:

- Ten clashes with Phe890 ring atoms that can move under the declared response.
- Three clashes with retained source waters: OX3–HOH1267 O at 1.542 Å,
  OX3–HOH1507 O at 1.506 Å, and CX16–HOH1507 O at 1.955 Å.
- No other fixed-heavy-atom severe clashes in this diagnostic comparison.

Consequently, this overlay does not establish that water displacement is part of
the designer brief. It only shows that transporting the deposited 5OVH pose into
the 5OVE solvent model creates a cross-structure solvent conflict. The current
model should retain its starting waters unless a candidate generated from the
designer brief actually collides with them; only then should we decide whether
the solvent model permits exchange. These water identifiers locate an overlay
comparison, not a pre-registered deletion list.

### Local protein motion is not exactly a pure Phe rotamer

In the fixed eight-anchor frame, 5OVG-to-5OVH Phe890 CA moves 0.624 Å, CB
0.973 Å, and CG 3.113 Å; Tyr884 backbone O moves 0.158 Å. From 5OVE to 5OVH,
Phe890 CA and CB move 0.566 and 0.922 Å, respectively. This is a limitation of
an exactly fixed-backbone/chi-only reproduction, not permission to exempt CB
from clashes. The clash diagnostic above does not demonstrate that backbone
motion is necessary to obtain a feasible ligand pose. These are differences
between deposited models, not uncertainty-free measurements of a trajectory.

## Consequence for the paper, movie, and next experiment

1. Keep the pre-inspection attempts immutable and retain their failure status.
2. Express the upstream exit direction as an explicit visible designer action;
   preserve the remaining precursor pose and the Asn879 anchor by default.
3. Keep the Tyr884-contact objective and atom-level Phe response gate. Retain
   starting waters by default; treat any candidate/water clash as a separately
   audited solvent-model question, not an inferred crystal requirement.
4. After placement, lock the ligand, predict receptor response, and freeze and
   evaluate the result with honest reference-informed provenance. Do not label
   post-inspection method development as untouched holdout validation.
5. Make the movie explain the G-to-H ligand orientation/Phe switch and the
   H-to-I attachment rewrite with approximate distal spatial conservation.
   No new accepted result, final movie, or final paper is claimed by this note.

## Input fingerprints

All PDB files are the existing local copies under
`outputs/design-history/sos1-preapproval/source/`.

```text
5OVE.pdb  e782d27d017b572ca52f850a35a649439f3cdc5bb3e5c9d59e31aeb175a4bd7d
5OVF.pdb  1cf352dbdd1a80ae9b87d8f9d160217123e120c28169f74df33810f2234b9449
5OVG.pdb  771a3401446c0966926541fae833d9354555bbc376c084957f6d3ab93c15938d
5OVH.pdb  74571d3931b17ab2ad9b980c294ca2d9968cd59e4751e7e085fa57555d2f7261
5OVI.pdb  ddd941a276272051b4bab1a4159d24fc6caf56dece86cee980aa95df6b59773f
a010 graph checkpoint
  c0672efabc8da255de45a6d8b41f3f1a2bb0652ac2e683a70a9ed33b8692b3b1
registered evaluation protocol
  b787b96d2b885c2e16e2df5409542623817aa56e4d257e30a5e821332fb651a0
```

Checkpoint:
`outputs/design-history/sos1-aww-receptor-only-c46d8e5-a010/aww-graph-only-campaign.json`.
Analysis used the existing evaluator and designer-validation helpers with
NumPy 2.5.2 and RDKit 2026.03.5 from the existing local `dodock` environment.
