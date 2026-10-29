"""Offline checks for nested and concurrent trace attribution."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('response_latency', Path(__file__).parents[1] / 'analyze-response-latency.py')
latency = importlib.util.module_from_spec(spec)
spec.loader.exec_module(latency)


def span(name, kind, start, end, run='main', identifier=None):
    return dict(name=name, type=kind, startedAt=start, endedAt=end,
                spanId=identifier or name, attributes={'xopc.runId': run})


class ResponseLatencyTest(unittest.TestCase):
    def test_nested_generation_is_not_counted_twice_and_background_run_is_excluded(self):
        root = span('agent.run', 'agent', 0, 100)
        spans = [root, span('model.attempt', 'span', 0, 100),
                 span('agent.answer', 'generation', 10, 40),
                 span('tool.image', 'tool', 40, 80),
                 span('media.image', 'generation', 45, 75),
                 span('agent.answer', 'generation', 0, 500, 'background', 'child')]
        self.assertEqual(latency.partition(root, latency.own_spans(root, spans)),
                         dict(model=30, tools=40, compaction=0, unattributed=30))

    def test_parallel_tools_use_union_and_intervals_are_clipped(self):
        root = span('agent.run', 'agent', 10, 100)
        spans = [span('tool.a', 'tool', 0, 60), span('tool.b', 'tool', 40, 120)]
        self.assertEqual(latency.partition(root, spans),
                         dict(model=0, tools=90, compaction=0, unattributed=0))

    def test_compaction_owns_its_nested_model_time(self):
        root = span('agent.run', 'agent', 0, 100)
        spans = [span('context.compaction', 'span', 10, 90),
                 span('session.compact', 'generation', 20, 80)]
        self.assertEqual(latency.partition(root, spans),
                         dict(model=0, tools=0, compaction=80, unattributed=20))

    def test_nearest_rank_percentiles_and_empty_samples(self):
        self.assertEqual(latency.distribution(list(range(1, 21)))['p95Ms'], 19)
        self.assertIsNone(latency.distribution([])['p50Ms'])


if __name__ == '__main__':
    unittest.main()
