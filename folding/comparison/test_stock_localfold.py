"""Launcher guards only: these tests do not run or qualify a folding model."""
import json
import hashlib
from pathlib import Path
import tempfile
import zipfile
import shutil
import unittest
from run_stock_localfold import observed_controls, validate_job
from check_stock_benchmark import check
from compare_stock_native import compare as compare_native_poses
from assemble_stock_benchmark import assemble


class StockPageGuards(unittest.TestCase):
    def review(self):
        return Path(__file__).resolve().parents[2] / 'reviews/cofold-stock-localfold-2026-11-13/initial-snapshot'

    def test_all_eighty_final_predictions_and_actual_sampling_budget(self):
        review = self.review().parent / 'results-200x10'
        result = check(review)
        self.assertEqual((result['recomputedPredictions'], result['plannedPredictions']), (80, 80))
        self.assertEqual(result['scope'], 'complete')
        self.assertEqual(result['observedDiffusionFrames'], [200])
        self.assertEqual(result['actualGpuVendors'], ['apple'])
        report = json.loads((review / 'scores.json').read_text())
        self.assertEqual(len({r['caseId'] for r in report['summary']}), 7)
        self.assertTrue(all(r['complete'] == r['planned'] == 10 and r['nativeBestA'] < 2 for r in report['summary']))
        agreement = json.loads((review / 'native-agreement.json').read_text())
        self.assertEqual(len(agreement['pairs']), 80)
        self.assertEqual(sum(len(r['nativeDistances']) for r in agreement['pairs']), 240)

    def test_actual_saved_predictions_recompute_from_public_evidence(self):
        result = check(self.review())
        self.assertEqual(result['recomputedPredictions'], 22)
        self.assertEqual(result['plannedPredictions'], 80)
        self.assertEqual(result['neuralForwards'], 0)

    def test_direct_native_agreement_recomputes_without_inference(self):
        repository = Path(__file__).resolve().parents[2]
        actual = compare_native_poses(self.review(), repository)
        expected = json.loads((self.review() / 'native-agreement.json').read_text())
        self.assertEqual(len(actual['pairs']), 22)
        self.assertEqual(sum(len(r['nativeDistances']) for r in actual['pairs']), 66)
        self.assertEqual(actual['neuralForwards'], 0)
        for left, right in zip(actual['pairs'], expected['pairs']):
            self.assertEqual((left['caseId'], left['model'], left['stockSeed']),
                             (right['caseId'], right['model'], right['stockSeed']))
            self.assertAlmostEqual(left['nearestNativeRmsdA'], right['nearestNativeRmsdA'], delta=1e-8)
        for row in actual['summary']:
            if row['sameIntegerSeedPairs'] != 3:
                self.assertIsNone(row['meanSameIntegerSeedFirstThreeRmsdA'])

    def test_single_batch_layout_reassembles_real_preserved_predictions(self):
        # Change storage layout only. All coordinates are the real saved runs;
        # this is not a synthetic model result or another inference attempt.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            batch = root / 'preserved-layout'
            with zipfile.ZipFile(self.review() / 'evidence.zip') as archive:
                archive.extractall(batch)
            (batch / 'source').mkdir()
            for path in (batch / 'consumed-batch-source').iterdir():
                if path.name == 'source-manifest.json':
                    shutil.copyfile(path, batch / path.name)
                else:
                    shutil.copyfile(path, batch / 'source' / path.name)
            progress = json.loads((batch / 'progress-at-snapshot.json').read_text())
            progress['scope'] = 'Storage-layout replay of real preserved poses; zero inference.'
            progress['records'] = []
            for path in sorted((batch / 'predictions').iterdir()):
                shutil.copyfile(path / 'initial-score.json', path / 'score.json')
                progress['records'].append({'index': int(path.name), 'status': 'complete',
                                            'directory': str(path.relative_to(batch))})
            (batch / 'progress.json').write_text(json.dumps(progress))
            report = assemble(batch / 'frozen-plan/plan.json', batch / 'reference-evidence',
                              None, batch, root / 'reanalysis')
            self.assertEqual(report['completed'], 22)
            self.assertEqual(check(root / 'reanalysis')['recomputedPredictions'], 22)

    def test_split_evidence_reconstructs_and_rejects_corruption(self):
        review = self.review()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scores.json').write_bytes((review / 'scores.json').read_bytes())
            evidence = json.loads((review / 'evidence.json').read_text())
            raw = (review / 'evidence.zip').read_bytes()
            split = len(raw) // 2
            parts = []
            for index, data in enumerate([raw[:split], raw[split:]]):
                name = f'evidence.part-{index + 1:02d}.bin'
                (root / name).write_bytes(data)
                parts.append({'file': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
            evidence['archiveParts'] = parts
            (root / 'evidence.json').write_text(json.dumps(evidence))
            self.assertEqual(check(root)['recomputedPredictions'], 22)
            (root / parts[-1]['file']).write_bytes(raw[split:-1])
            with self.assertRaisesRegex(ValueError, 'Archive part is incomplete'):
                check(root)

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
