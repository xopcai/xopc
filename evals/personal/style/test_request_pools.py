"""Exercise limits, failure handling, and streaming evaluation without model calls."""
import argparse
import ast
import concurrent.futures
import hashlib
import json
import shutil
import tempfile
import threading
import time
import unittest
from pathlib import Path

from request_pools import RequestPools


def driver_function(name, scope):
    source = Path(__file__).with_name('driver.py')
    tree = ast.parse(source.read_text())
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), 'exec'), scope)
    return scope[name]


class PoolTests(unittest.TestCase):
    def test_initial_downshift_preserves_independent_upper_limits(self):
        pools=RequestPools(targets={'generation':1,'judge':2})
        self.assertEqual(pools.snapshot()['limits']['generation'],4)
        self.assertEqual(pools.snapshot()['limits']['judge'],4)
        self.assertEqual(pools.snapshot()['targets']['generation'],1)
        self.assertEqual(pools.snapshot()['targets']['judge'],2)
        with self.assertRaises(ValueError): RequestPools(targets={'generation':5})

    def test_judge_pool_proceeds_while_generation_is_full(self):
        pools = RequestPools()
        generation = [pools.acquire('generation') for _ in range(4)]
        judge = pools.acquire('judge')
        self.assertEqual(pools.snapshot()['active'], {'generation': 4, 'judge': 1, 'scene': 0})
        pools.release(judge)
        for lease in generation:
            pools.release(lease)

    def test_overload_downshifts_and_never_restarts_successful_requests(self):
        pools = RequestPools()
        leases = [pools.acquire('judge') for _ in range(4)]
        pools.release(leases.pop(), '429 overloaded')
        self.assertEqual(pools.snapshot()['targets']['judge'], 2)
        granted = threading.Event()
        def waiting():
            lease = pools.acquire('judge')
            granted.set()
            pools.release(lease)
        thread = threading.Thread(target=waiting)
        thread.start()
        self.assertFalse(granted.wait(.05))
        pools.release(leases.pop())
        self.assertFalse(granted.wait(.05))
        pools.release(leases.pop())
        self.assertTrue(granted.wait(1))
        pools.release(leases.pop())
        thread.join(1)
        self.assertEqual(pools.snapshot()['targets']['generation'], 4)

    def test_unknown_pool_and_duplicate_release_are_rejected(self):
        pools = RequestPools()
        with self.assertRaises(ValueError):
            pools.acquire('invalid')
        lease = pools.acquire('generation')
        pools.release(lease)
        with self.assertRaises(ValueError):
            pools.release(lease)

    def test_follow_grading_starts_before_all_generation_finishes(self):
        judged = threading.Event()
        first_wave = threading.Barrier(4)
        def generate(doc):
            first_wave.wait(2)
            if doc['caseId'] != 'case0':
                if not judged.wait(2):
                    raise AssertionError('Judging waited for the full generation batch')
            return {**doc, 'answer': 'saved'}
        def judge(doc):
            judged.set()
            return {**doc, 'verdicts': ['YES']}
        scope = {'concurrent': __import__('concurrent'), 'args': argparse.Namespace(concurrency=4),
                 'run_with_restart': lambda function, doc: function(doc), 'run_follow_generate': generate,
                 'run_follow_judge': judge, 'run_eq_in_slot': lambda doc: doc,
                 'save': lambda *_args: None, 'out': Path('/unused'), 'follow_summary': lambda rows, expected: {}}
        function = driver_function('run_parallel', scope)
        rows, eq, _ = function([{'caseId': f'case{i}'} for i in range(4)], [])
        self.assertEqual(len(rows), 4)
        self.assertEqual(eq, [])

    def test_failed_candidate_restarts_with_fresh_capture_id_and_original_receipt(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder)
            (out / 'cases').mkdir()
            (out / 'case-attempts').mkdir()
            local = threading.local()
            seen = []
            def action(_doc):
                seen.append(local.capture_override)
                result = {'caseId': 'id', **({'error': 'CandidateTransportFailure: overloaded'} if len(seen) == 1 else {'answer': 'valid'})}
                (out / 'cases/id.json').write_text(json.dumps(result))
                return result
            scope = {'local': local, 'out': out, 'shutil': shutil, 'hashlib': hashlib,
                     'save': lambda path, data: path.write_text(json.dumps(data))}
            result = driver_function('run_with_restart', scope)(action, {})
            self.assertEqual(seen, [None, 'id-transport-retry1'])
            original = out / 'case-attempts/id.first.json'
            self.assertIn('CandidateTransportFailure', json.loads(original.read_text())['error'])
            self.assertEqual(result['transportRecovery']['originalSha256'], hashlib.sha256(original.read_bytes()).hexdigest())

    def test_valid_low_quality_case_is_not_retried(self):
        calls = []
        scope = {'local': threading.local()}
        result = driver_function('run_with_restart', scope)(lambda doc: calls.append(doc) or {'caseId': 'id', 'hardSatisfied': False}, {})
        self.assertFalse(result['hardSatisfied'])
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
