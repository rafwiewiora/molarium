"""Actual checkpoint guards and report wording; no predictions or synthetic science."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

from prepare_rnp_publication import require_final, render_summary, prepare


ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / 'reviews/cofold-rnp-spectrum-2026-11-15'


class PublicationPreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = json.loads((REPORT / 'frozen-stock-plan.json').read_bytes())
        cls.partial = json.loads((REPORT / 'checkpoint-288/scores.json').read_bytes())
        cls.analysis = json.loads((REPORT / 'checkpoint-288/selection-analysis.json').read_bytes())

    def test_partial_checkpoint_cannot_be_promoted_by_changing_a_status_label(self):
        with self.assertRaisesRegex(ValueError, 'unfinished predictions'):
            require_final(self.plan, self.partial)
        changed = copy.deepcopy(self.partial)
        changed['status'] = 'complete'
        changed['completed'] = 480
        with self.assertRaisesRegex(ValueError, 'unfinished predictions'):
            require_final(self.plan, changed)

    def test_altered_sample_protocol_is_not_a_final_result_for_this_experiment(self):
        plan = copy.deepcopy(self.plan)
        plan['seeds'] = list(range(6))
        with self.assertRaisesRegex(ValueError, '480-prediction protocol'):
            require_final(plan, self.partial)

    def test_rendering_actual_six_sample_results_keeps_denominators_and_scope(self):
        text = render_summary(self.plan, self.partial, self.analysis, 6)
        self.assertIn('# Recorded results at 6 samples per case', text)
        self.assertIn('25/48 (52.08%)', text)
        self.assertIn('17/48 (35.42%)', text)
        self.assertIn('23/41 (56.10%)', text)
        self.assertIn('7 selected cases lack a native hit', text)
        self.assertIn('20/48 native-qualified cases have no browser geometric <2 Å hit', text)
        self.assertIn('18/41 cases with a passing native hit have no passing browser hit', text)
        self.assertIn('43 exact protein sequences and 36 published clusters', text)
        self.assertIn('not sequence identity', text)
        self.assertIn('not full physical validation', text)
        self.assertIn('not isolated GPU', text)
        with self.assertRaisesRegex(ValueError, 'unfinished uniform sample budget'):
            render_summary(self.plan, self.partial, self.analysis, 10)

    def test_missing_confidence_suppresses_a_selected_hit_rate(self):
        analysis = copy.deepcopy(self.analysis)
        analysis['allSelected'][5]['confidenceSelectionFullyObserved'] = False
        text = render_summary(self.plan, self.partial, analysis, 6)
        self.assertIn('| Highest reported ipTM, passing <2 Å pose | unavailable |', text)

    def test_waiting_finalizer_creates_no_publication_output(self):
        with tempfile.TemporaryDirectory() as directory:
            finalizer = Path(directory)
            (finalizer / 'progress.json').write_text('{"status":"waiting"}')
            output = finalizer / 'forbidden-publication'
            with self.assertRaisesRegex(ValueError, 'not complete'):
                prepare(finalizer, output, ROOT)
            self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
