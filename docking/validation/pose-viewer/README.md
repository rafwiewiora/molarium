# 7KPA Mol* pose review

This is a read-only visual validation artifact for the preregistered 7KPA analogue panel. It
uses a pinned local Mol* 5.11.0 initialization path: raw PDB/MOL data builders, a hidden Mol*
control layout, a disabled axis helper, and resize observation.
There is no CDN or external request.

Build a site from the shortlisted pose packet and independent local validation results:

```sh
node docking/validation/pose-viewer/build_pose_review.mjs \
  --poses /tmp/molarium-7kpa-panel-full.shortlist.json \
  --validation /tmp/molarium-7kpa-panel-full.cpu-validation.json \
  --pdb docking/benchmark/fixtures/pdb/7kpa.pdb \
  --output /tmp/molarium-7kpa-pose-review
```

Serve the generated directory over a local HTTP server. The artifact shows one candidate at a
time over the prepared 7KPA reference ligand, receptor cartoon, and the immediate 3.5 Å residue
contact shell. It
reports the browser score and the independent OpenMM Reference/RDKit checks, but it does not
rescore, refine, modify, or approve a pose. Absolute energies must not be compared across
different analogue graphs.

The vendored Mol* files have SHA-256 digests
`7fad5561c74bc900930fb57d6ab028d1aafdda82223a901bf932b1098e84f1f3` (JavaScript) and
`5b68ceb6d3642549b4e9b2c071e58e41b98a5350ae269180587b39da86925d55` (CSS).
