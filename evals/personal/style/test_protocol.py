import json
import math
import tempfile
import unittest
from pathlib import Path
from protocol import follow_cases, follow_summary, parse_verdicts, select_eq, validate_traits


class ProtocolTests(unittest.TestCase):
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
