# Local pose-strain validation

Export the exact original and edited D84 ligand coordinates produced by the real 7KPA browser
preparation and the public Chemist Actions sequence:

```bash
MOLARIUM_EXPORT_STRAIN_FIXTURE=/tmp/molarium-7kpa-strain.json npm run test:7kpa-contacts
```

Then run the matched MMFF94 control in any local Python environment containing RDKit:

```bash
python docking/validation/measure-7kpa-strain.py /tmp/molarium-7kpa-strain.json
```

The full relaxation compares each bound geometry with its own isolated-ligand local minimum. The
transformed-ring relaxation fixes every atom except the changed ring and its attached hydrogens.
Neither calculation includes the receptor or estimates binding affinity. An ANI-2x comparison must
use the same exported pair; scoring only the edited ligand would confound edit-induced strain with
the ordinary strain of the crystallographic parent pose.

The independent hash-gated browser/native panel runner is documented in
[`cloud-panel/README.md`](cloud-panel/README.md). Its first high-disruption 7KPA result, including an
explicit failed cross-runtime Sage gate, is retained in
[`cloud-panel/RESULTS-2026-08-23.md`](cloud-panel/RESULTS-2026-08-23.md).
