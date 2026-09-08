# Readable SOS1 protocol review (a25)

This targeted review checked the new figure-linked annotations without changing
the scientific procedure. All six `sosreadable` listing bodies concatenate to
the a24 plain pseudocode byte-for-byte. All figure assets and both full API
scripts remain unchanged. Colors supplement, rather than replace, descriptive
headings and panel letters.

The correct Figure 2 mapping is A/1, B/2, C/3, D/5, E/6, F/7. Graph-only AWW
checkpoint 4 has no separate panel. The new state trace preserves this distinction:
checkpoint 4 to 5 changes 27 ligand coordinates and no receptor coordinates;
checkpoint 5 to 6 changes 13 Phe890 coordinates and no ligand coordinates.
The molecular graph is identical across these three snapshots. These checks use
the exact hash-verified published snapshots, not visual inference alone.

The seven published campaign exports share one campaign and have real parentage.
The final export contains nine commits, including two extra AXH intermediate
states between movie checkpoints 6 and 7. Every earlier exported object remains
unchanged in the final export. However, attached public-action segments explicitly
declare incomplete coverage; the segments for checkpoints 4 and 5 also declare
truncation. Commit `evidenceIds` and `hypothesisIds` are empty. Numerical audits
are separately listed in the release. The annotation therefore describes
parent-linked states, partial action records, and separate evidence, not complete
automatic capture of every action or decision.

The writing change positions the example as readable intent linked to explicit
operations, checks, and inspectable states. Scriptability alone is not a new
capability: [ChimeraX's official scripting documentation](https://www.cgl.ucsf.edu/chimerax/docs/devel/modules/core/scripting.html)
describes both Python and command scripts, including access to the current session.
That comparison supports avoiding a uniqueness claim; it does not establish a
head-to-head evaluation or imply that other systems lack reviewable workflows.
The defensible emphasis is the demonstrated connection between the human-readable
design account, the shared molecular interface/API, and the saved execution evidence.
Readability, repeatability, and preserved hashes do not guarantee correct source
chemistry or experimentally correct results.

No further prose edits were made by this reviewer. The existing distinction
between a reference-informed hypothesis and the original chemists' documented
intentions remains necessary, as does the previously recorded AWW source-graph
discrepancy. No experimental novelty, blinded prediction, affinity improvement,
unique receptor solution, or complete automatic provenance is established by
this presentation change.

Run the independent regression checks from the repository root:

```sh
node --test paper/review/readable-protocol.test.mjs
```

Compilation, final PDF layout inspection, and delivery are performed separately
by the main manuscript workflow. The review did not alter manuscript, figures,
frozen calculations, or packaging.
