import json
import math
import tempfile
import unittest
from pathlib import Path
from protocol import follow_cases, follow_summary, parse_verdicts, select_eq, validate_traits, validate_dialogue_fixtures, aggregate_p0_pair


class ProtocolTests(unittest.TestCase):
    def test_swapped_pair_maps_winners_and_evidence_back_to_the_same_condition(self):
        dimensions = ['overinterpretation', 'unnecessary_question', 'repeated_closing', 'premature_resolution', 'required_content_or_boundary']
        blank = lambda: {d: [] for d in dimensions}
        first = {'judgment': {'left': blank(), 'right': blank(), 'winner': 'right'}}
        second = {'judgment': {'left': blank(), 'right': blank(), 'winner': 'left'}}
        first['judgment']['left']['overinterpretation'] = [{'turn': 2, 'severity': 'major'}, {'turn': 2, 'severity': 'minor'}]
        second['judgment']['right']['overinterpretation'] = [{'turn': 2, 'severity': 'major'}, {'turn': 3, 'severity': 'minor'}]
        summary = aggregate_p0_pair(first, second)
        self.assertEqual(summary['outcome'], 'patched')
        evidence = summary['conditions']['control']['overinterpretation']
        self.assertEqual(evidence['bothOrders'], [2])
        self.assertEqual(evidence['eitherOrder'], [2, 3])
        self.assertEqual(evidence['majorBothOrders'], [2])
        self.assertEqual(summary['conditions']['patched']['overinterpretation']['eitherOrder'], [])
        second['judgment']['winner'] = 'right'
        self.assertEqual(aggregate_p0_pair(first, second)['outcome'], 'discordant')
        with self.assertRaises(ValueError):
            aggregate_p0_pair({'error': 'judge unavailable'}, second)

    def test_scripted_fixtures_reject_unsafe_duplicate_or_empty_cases(self):
        row = {"id": "P0-M01", "category": "overinterpretation", "userTurns": ["Hello"], "expectations": "Stay grounded"}
        self.assertEqual(validate_dialogue_fixtures({"schemaVersion": 1, "cases": [row]}), [row])
        for cases in [[], [row, row], [{**row, "id": "P0-../escape"}], [{**row, "userTurns": [""]}], [{**row, "userTurns": ["a"] * 9}], [{**row, "expectations": ""}]]:
            with self.assertRaises(ValueError):
                validate_dialogue_fixtures({"schemaVersion": 1, "cases": cases})

    def test_grading_rejects_missing_extra_uncertain_and_executable_output(self):
        for text in ["['YES']", "['YES','NO','YES']", "['YES','MAYBE']", "__import__('os').system('false')", "['YES', True]"]:
            with self.assertRaises(ValueError):
                parse_verdicts(text, 2)
        self.assertEqual(parse_verdicts("Reasoning\n['YES','NO']", 2), ['YES', 'NO'])

    def test_errors_remain_in_denominator_and_csl_stops_at_first_failure(self):
        rows = [{"example_id": 1, "level": level, "hardSatisfied": level != 2, "softScore": 0 if level == 2 else 1} for level in range(1, 6)]
        rows[1]['error'] = 'judge unavailable'
        result = follow_summary(rows, 5)
        self.assertEqual(result['HSR'], .8)
        self.assertEqual(result['CSL'], 1)
        self.assertEqual(result['errors'], 1)
        self.assertFalse(result['complete'])

    def test_eq_selection_is_order_independent_and_covers_categories(self):
        docs = [{"id": str(i), "category": str(i % 3)} for i in range(12)]
        selected = select_eq(docs, 6)
        self.assertEqual(selected, select_eq(list(reversed(docs)), 6))
        self.assertEqual({doc['category'] for doc in selected}, {'0', '1', '2'})
        self.assertEqual(len({doc['id'] for doc in selected}), 6)

    def test_missing_level_cannot_silently_change_follow_evolution(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'data.json'
            path.write_text(json.dumps([{"example_id": 1, "level": 1, "instruction": 'test'}]))
            with self.assertRaises(ValueError):
                follow_cases(path, 1)

    def test_eq_traits_require_exact_finite_rubric(self):
        for scores in [{}, {'naturalness': 11}, {'naturalness': math.nan}, {'naturalness': True}, {'naturalness': 5, 'quality': 10}]:
            with self.assertRaises(ValueError):
                validate_traits(scores, ['naturalness'])
        self.assertEqual(validate_traits({'naturalness': 5}, ['naturalness']), {'naturalness': 5})


if __name__ == '__main__':
    unittest.main()
