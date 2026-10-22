import copy
import unittest

from chinese import build_worlds
from prepare import TYPES, normalize, select, time_consistent


class FixturesTest(unittest.TestCase):
    def test_world_splits_and_referential_integrity(self):
        cases = build_worlds()
        self.assertEqual(len(cases), 192)
        self.assertEqual(len({c['id'] for c in cases}), 192)
        groups = {}
        for case in cases:
            groups.setdefault(case['split'], set()).add(case['worldId'])
            visible = {m['id'] for s in case['sessions'] for m in s['messages']}
            self.assertTrue(set(case['gold']['evidenceRefs']) <= visible)
            self.assertTrue(all(m['timestamp'] <= case['knowledgeCutoff'] <= case['queryTime']
                                for s in case['sessions'] for m in s['messages']))
        self.assertEqual([len(s) for s in groups.values()], [8, 8, 8])
        self.assertFalse(groups['development'] & groups['validation'])
        self.assertFalse(groups['development'] & groups['final'])
        for case in cases:
            if case['split'] != 'development':
                source = str(case['sessions'])
                for identity in ['王敏', '陈宇', '小王', '青禾', '远帆']:
                    self.assertNotIn(identity, source)

    def test_fixture_versions_preserve_undeclared_content(self):
        old, new = build_worlds(1), build_worlds(2)
        changed = []
        for before, after in zip(old, new):
            before, after = copy.deepcopy(before), copy.deepcopy(after)
            before.pop('suite'); after.pop('suite')
            if before != after:
                changed.append(before['id'])
                self.assertTrue((before['category'] == 'project-continuity' and before['id'].endswith(('q3', 'q7')))
                                or (before['category'] == 'correction-forgetting' and before['id'].endswith('q8')))
        self.assertEqual(len(changed), 9)
        with self.assertRaises(ValueError): build_worlds(3)

    def test_future_and_gold_are_not_imported(self):
        row = {'question_id': 'test', 'question_type': TYPES[0], 'question': 'what?', 'answer': 'secret',
               'question_date': '2023/05/21 (Sun) 10:40', 'answer_session_ids': ['answer_target'],
               'haystack_session_ids': ['answer_target', 'future'],
               'haystack_dates': ['2023/05/20 (Sat) 10:40', '2023/05/22 (Mon) 10:40'],
               'haystack_sessions': [[{'role': 'user', 'content': 'old fact', 'has_answer': True}],
                                    [{'role': 'user', 'content': 'future fact'}]]}
        result = normalize(row)
        self.assertFalse(time_consistent(row))
        self.assertEqual(result['excludedFutureSessionIds'], ['future'])
        self.assertEqual(result['gold']['evidenceRefs'], ['history-0001:0'])
        self.assertEqual(result['sessions'][0]['id'], 'history-0001')
        self.assertEqual(result['gold']['originalSessionIds'], {'history-0001': 'answer_target'})
        self.assertNotIn('has_answer', result['sessions'][0]['messages'][0])
        self.assertEqual(result['sessions'][0]['messages'][0]['role'], 'user')
        self.assertNotIn('answer_', str(result['sessions']))
        bad = copy.deepcopy(row); bad['haystack_dates'].pop()
        with self.assertRaises(ValueError): normalize(bad)

    def test_selection_is_deterministic_and_abstention_is_cross_cutting(self):
        rows = [{'question_id': f'{i}{suffix}', 'question_type': kind} for kind in TYPES
                for i in range(6) for suffix in ['', '_abs']]
        selected = select(rows, 3)
        self.assertEqual(selected, select(list(reversed(rows)), 3))
        self.assertEqual(len(selected), 18)
        for kind in TYPES:
            group = [r for r in selected if r['question_type'] == kind]
            self.assertEqual(sum(r['question_id'].endswith('_abs') for r in group), 2)
        with self.assertRaises(ValueError): select([], 3)


if __name__ == '__main__': unittest.main()
