"""Launcher guards only: these tests do not run or qualify a folding model."""
import json
import unittest
from run_stock_localfold import observed_controls, validate_job


class StockPageGuards(unittest.TestCase):
    def test_single_seed_and_inline_input_are_required(self):
        job = {"name": "guard", "modelSeeds": [0], "sequences": [
            {"protein": {"id": "A", "sequence": "ACDE", "unpairedMsa": ">q\nACDE\n"}},
            {"ligand": {"id": "B", "smiles": "c1ccccc1"}}]}
        self.assertEqual(validate_job(json.dumps(job))["modelSeeds"], [0])
        job["modelSeeds"] = [0, 1]
        with self.assertRaisesRegex(ValueError, "exactly one"):
            validate_job(json.dumps(job))
        job["modelSeeds"] = [0]
        job["sequences"][0]["protein"]["unpairedMsaPath"] = "external.a3m"
        with self.assertRaisesRegex(ValueError, "inline inputs"):
            validate_job(json.dumps(job))

    def test_multiple_jobs_are_not_silently_truncated(self):
        with self.assertRaisesRegex(ValueError, "one job"):
            validate_job('[{}, {}]')

    def test_actual_page_controls_must_match(self):
        log = 'controls: {"model":"boltz2","af3count":"25","recycles":"2"}\n'
        self.assertEqual(observed_controls(log, "boltz2", 25, 2)["model"], "boltz2")
        with self.assertRaisesRegex(ValueError, "differ"):
            observed_controls(log, "boltz2", 200, 2)
        with self.assertRaisesRegex(ValueError, "one original-page"):
            observed_controls(log + log, "boltz2", 25, 2)


if __name__ == '__main__':
    unittest.main()
