"""Launcher guards only: these tests do not run or qualify a folding model."""
import json
import hashlib
from pathlib import Path
import tempfile
import zipfile
import unittest
from run_stock_localfold import observed_controls, validate_job
from check_stock_benchmark import check


class StockPageGuards(unittest.TestCase):
    def review(self):
        return Path(__file__).resolve().parents[2] / 'reviews/cofold-stock-localfold-2026-11-13/initial-snapshot'

    def test_actual_saved_predictions_recompute_from_public_evidence(self):
        result = check(self.review())
        self.assertEqual(result['recomputedPredictions'], 22)
        self.assertEqual(result['plannedPredictions'], 80)
        self.assertEqual(result['neuralForwards'], 0)

    def test_consistently_rehashed_wrong_score_is_rejected(self):
        review = self.review()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = json.loads((review / 'scores.json').read_text())
            first = next(r for r in report['poses'] if r['status'] == 'complete')
            first['ligandRmsdA'] += 0.5
            raw = (json.dumps(report, indent=2) + '\n').encode()
            (root / 'scores.json').write_bytes(raw)
            with zipfile.ZipFile(review / 'evidence.zip') as source:
                members = {name: source.read(name) for name in source.namelist()}
            members['independent-scores.json'] = raw
            manifest = json.loads(members['archive-manifest.json'])
            manifest['independent-scores.json'] = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
            members['archive-manifest.json'] = (json.dumps(manifest) + '\n').encode()
            with zipfile.ZipFile(root / 'evidence.zip', 'w', compression=zipfile.ZIP_DEFLATED) as target:
                for name, data in members.items():
                    target.writestr(name, data)
            evidence = json.loads((review / 'evidence.json').read_text())
            evidence['scoresSha256'] = hashlib.sha256(raw).hexdigest()
            evidence['archiveSha256'] = hashlib.sha256((root / 'evidence.zip').read_bytes()).hexdigest()
            (root / 'evidence.json').write_text(json.dumps(evidence))
            with self.assertRaisesRegex(ValueError, 'Independent crystal score differs'):
                check(root)

    def test_full_budget_plan_has_only_same_model_native_hits(self):
        repository = Path(__file__).resolve().parents[2]
        root = repository / 'reviews/cofold-stock-localfold-2026-11-13/benchmark-200x10'
        plan = json.loads((root / 'plan.json').read_text())
        self.assertEqual((plan['steps'], plan['recycles'], plan['seeds']), (200, 3, list(range(10))))
        self.assertEqual((len(plan['pairs']), len(plan['jobs'])), (8, 80))
        for pair in plan['pairs']:
            source = repository / pair['nativeScoreFile']
            self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), pair['nativeScoreSha256'])
            hits = [r for r in json.loads(source.read_text())['poses']
                    if r['caseId'] == pair['caseId'] and r.get('status') == 'complete'
                    and r['ligandRmsdA'] < 2]
            self.assertTrue(hits)
            self.assertTrue(all('native-' + pair['model'] in r['method'] for r in hits))
            self.assertEqual(min(r['ligandRmsdA'] for r in hits), pair['nativeBestA'])
            jobs = [j for j in plan['jobs'] if (j['caseId'], j['model']) == (pair['caseId'], pair['model'])]
            self.assertEqual(sorted(j['seed'] for j in jobs), list(range(10)))
            for job in jobs:
                raw = (root / job['input']).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), job['inputSha256'])
                self.assertEqual(json.loads(raw)['modelSeeds'], [job['seed']])

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
