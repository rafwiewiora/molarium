# Inspect preserved stock predictions in Foldarium

Download a library JSON below, open the [Molarium Foldarium reviewer](https://molarium.org/vendor/foldarium/library-review.html), and choose **Import library JSON**. Preferences, rejections and notes remain in your browser; use **Export library + decisions** to save them.

Each case has a prediction-only file and a separate file including a clearly labelled experimental reference. The examples were selected after examining benchmark results; this is not a blinded or representative accuracy study. No RMSD, diagnostic category or preferred pose is embedded in the libraries. Every original prediction PDB and its explicit ligand graph is preserved; viewer alignment affects display only.

| Case | Predictions only | Include experimental reference |
| --- | --- | --- |
| 8px8__1__1-a__1-d | [JSON](8px8__1__1-a__1-d.predictions.library.json) | [JSON](8px8__1__1-a__1-d.with-reference.library.json) |
| 8u7x__1__1-a__1-c | [JSON](8u7x__1__1-a__1-c.predictions.library.json) | [JSON](8u7x__1__1-a__1-c.with-reference.library.json) |
| 8iqt__1__1-a__1-b | [JSON](8iqt__1__1-a__1-b.predictions.library.json) | [JSON](8iqt__1__1-a__1-b.with-reference.library.json) |
| 8a3a__1__1-a__1-b | [JSON](8a3a__1__1-a__1-b.predictions.library.json) | [JSON](8a3a__1__1-a__1-b.with-reference.library.json) |
| 8usm__1__1-a__1-c | [JSON](8usm__1__1-a__1-c.predictions.library.json) | [JSON](8usm__1__1-a__1-c.with-reference.library.json) |

These files contain original stock predictions and the existing experimental scoring reference, not native-prediction coordinates. The missing isolated inference time remains unavailable in the viewer; recorded launcher wall time is retained separately in provenance. References are display controls, and any human preference is an unscored decision rather than validation of a prediction.

[Manifest, source hashes and independent verification](manifest.json). No model was run to create these exports.

Source dataset: Peter Škrinjar, Jérôme Eberhardt, Gerardo Tauriello, Torsten Schwede, Janani Durairaj, *Have protein-ligand cofolding methods moved beyond memorisation? — Runs N’ Poses*. [CC BY 4.0](https://zenodo.org/records/18366081). Molarium selected a native-positive diagnostic cohort, prepared portable experimental scoring references, and generated original stock LocalFold browser predictions. These review exports preserve the existing prediction PDB strings and explicit ligand graphs; experimental references are separately labelled. No AlphaFold3 coordinate output is redistributed.
