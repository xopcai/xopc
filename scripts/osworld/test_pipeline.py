import json
from pathlib import Path
import tempfile
import types
import unittest

from pipeline import run_pipeline, smoke_passed
from run import select_tasks


def fixture_report(tasks, repetitions=1, score=1, cleanup=True):
    return {"plan": {"tasks": [{"id": task} for task in tasks], "repetitions": repetitions},
            "interrupted": False, "cleanupConfirmed": cleanup,
            "runs": [{"taskId": task, "repetition": repetition, "score": score, "status": "completed",
                      "steps": 2, "durationMs": 10, "modelRequests": 1, "claimedSuccess": True, "takeover": False}
                     for task in tasks for repetition in range(repetitions)]}


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.output = Path(self.root.name) / "pipeline"
        self.common = ["--model", "openai/gpt-6.1-sol", "--osworld-root", self.root.name,
                       "--environment-id", "offline-fixture", "--provider", "docker"]

    def executor(self, smoke_score=1):
        self.calls = []
        def execute(args, **kwargs):
            self.calls.append(args)
            directory = Path(args[args.index("--output") + 1])
            directory.mkdir()
            report = (fixture_report(["smoke-a", "smoke-b"], score=smoke_score) if len(self.calls) == 1
                      else fixture_report([str(i) for i in range(24)], repetitions=3))
            (directory / "report.json").write_text(json.dumps(report))
            return types.SimpleNamespace(returncode=0)
        return execute

    def test_runner_exit_zero_with_failed_oracle_cannot_start_baseline(self):
        code = run_pipeline(self.output, self.common, ["smoke-a", "smoke-b"], self.executor(smoke_score=0))
        self.assertEqual(code, 1)
        self.assertEqual(len(self.calls), 1)
        state = json.loads((self.output / "pipeline.json").read_text())
        self.assertEqual(state["stage"], "smoke-failed")
        self.assertIsNone(state["baselineReport"])

    def test_exactly_two_smoke_successes_gate_the_full_24_by_3_matrix(self):
        code = run_pipeline(self.output, self.common, ["smoke-a", "smoke-b"], self.executor())
        self.assertEqual(code, 0)
        self.assertEqual(len(self.calls), 2)
        baseline = self.calls[1]
        self.assertEqual(baseline[baseline.index("--repetitions") + 1], "3")
        self.assertNotIn("--limit", baseline)
        self.assertNotIn("--task-id", baseline)
        state = json.loads((self.output / "pipeline.json").read_text())
        self.assertEqual(state["modelRef"], "openai/gpt-6.1-sol")
        self.assertEqual(state["stage"], "baseline-completed")
        self.assertEqual(state["summary"]["completedRuns"], 72)

    def test_cleanup_uncertainty_or_protocol_preflight_cannot_count_as_two_passed_tasks(self):
        self.assertFalse(smoke_passed(fixture_report(["a", "b"], cleanup=False)))
        self.assertFalse(smoke_passed(fixture_report(["a"])))
        with self.assertRaises((KeyError, ValueError)):
            smoke_passed({"ok": True, "modelRef": "openai/gpt-6.1-sol"})

    def test_task_selection_cannot_add_unknown_duplicate_or_conflicting_tasks(self):
        tasks = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
        self.assertEqual(select_tasks(tasks, ["c", "a"]), [{"id": "c"}, {"id": "a"}])
        for ids, limit in ((["x"], None), (["a", "a"], None), (["a"], 2)):
            with self.assertRaisesRegex(ValueError, "INVALID_TASK_SELECTION"):
                select_tasks(tasks, ids, limit)


if __name__ == "__main__":
    unittest.main()
