# RCF-12: preserve the alignment when recovering native cofolding

Preparing recovery of the provided-MSA controls exposed two input-lineage
defects in `folding/comparison/native_cohort.py`. The missing-only planner
retained alignment metadata in each retry specification but did not copy the
referenced `msa/colabfold_main.a3m`. Its parent-cohort check also accepted a
descendant with a different alignment if the protein, ligand and protocol
matched. A retry could therefore fail before inference or combine scientifically
different inputs under one cohort.

The planner now checks the declared SHA-256 and writes those exact alignment
bytes into every generated retry input directory. Recovery requires the full
alignment declaration to match the parent. Existing source-file checks and
full unique seed coverage remain required.

Two regressions use frozen output coordinates as fixtures, with explicitly
hypothetical alignment metadata. They verify portable path resolution inside
the retry and rejection of a changed alignment before a retry directory is
created. Both reject the unmodified parent implementation; all eight recovery
tests pass after the fix. The existing public six-saved/42-missing non-MSA
recovery retains its original generated input digest. These are input/lineage
tests, not new inference or evidence of MSA pose accuracy.

The operational trigger was WDR5 control `15126_6`: a Spot interruption left
all three native model files and timings intact while its original CLI receipt
still said `running`. Its pending automatic requeue was held. Those saved poses
must be inventoried and assembled as interrupted-source evidence, retaining
the original receipt status; they must not be recalculated. This case needs
zero missing-pose retries. The alignment fix protects other partial recoveries
and does not change folding mathematics, precision, sampling or scoring.

Source: [recovery implementation](../folding/comparison/native_cohort.py),
[regressions](../folding/comparison/test_native_cohort.py). The broader
[recent-PDB findings](cofold-recent-pdb-2026-11-13/findings.md) keep protocol
comparisons separate from numerical implementation parity.
