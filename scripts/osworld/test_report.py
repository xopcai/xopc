import copy
import json
import sys
import types
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from report import compare, summarize
from run import checked_controller, close_environment


def report():
    return {"interrupted": False, "cleanupConfirmed": True,
            "plan": {"tasks": [{"id": "a"}, {"id": "b"}], "repetitions": 1, "modelRef": "openai/gpt-6.1-sol",
                     "maxSteps": 30, "environment": "pinned-image"},
            "runs": [{"taskId": task, "repetition": 0, "score": 1, "status": "completed", "steps": 1,
                      "durationMs": 10, "modelRequests": 1, "claimedSuccess": True, "takeover": False} for task in ("a", "b")]}


class ReportTest(unittest.TestCase):
    def test_recomputes_scores_and_preserves_missing_denominator(self):
        value = report()
        value["runs"].pop()
        value["summary"] = {"successRate": 1}
        summary = summarize(value)[0]
        self.assertEqual(summary["successRate"], .5)
        self.assertEqual(summary["missingRuns"], 1)
        self.assertFalse(summary["nativeCertified"])
        self.assertIsNone(summary["cost"])
        self.assertFalse(compare(value, value)["regressionGatePassed"])

    def test_false_claim_error_or_partial_score_regression_fails_the_gate(self):
        before, after = report(), report()
        self.assertTrue(compare(before, after)["regressionGatePassed"])
        after["runs"][0]["score"] = .5
        result = compare(before, after)
        self.assertEqual(result["losses"], 1)
        self.assertEqual(result["candidate"]["falseSuccesses"], 1)
        self.assertEqual(result["scoreRegressions"], ["a"])
        before["runs"][0].update(score=.75, claimedSuccess=False)
        after["runs"][0]["claimedSuccess"] = False
        self.assertFalse(compare(before, after)["regressionGatePassed"])
        after["runs"][0].update(status="error", score=None)
        self.assertFalse(compare(before, after)["complete"])

    def test_different_budgets_models_or_environments_are_incomparable(self):
        for key, value in (("modelRef", "other/model"), ("maxSteps", 60), ("environment", "new-image")):
            before, after = report(), report()
            after["plan"][key] = value
            with self.assertRaisesRegex(ValueError, "INCOMPARABLE"):
                compare(before, after)

    def test_cleanup_or_interruption_cannot_pass_with_a_complete_success_matrix(self):
        for field, value in (("cleanupConfirmed", False), ("interrupted", True)):
            after = report()
            after[field] = value
            self.assertFalse(compare(report(), after)["regressionGatePassed"])

    def test_duplicate_samples_and_invalid_oracle_scores_cannot_inflate_results(self):
        value = report()
        value["runs"].append(copy.deepcopy(value["runs"][0]))
        with self.assertRaises(ValueError):
            summarize(value)
        for score in (float("nan"), float("inf"), True, 1.1):
            value = report()
            value["runs"][0]["score"] = score
            with self.assertRaises(ValueError):
                summarize(value)

    def test_silent_guest_input_failure_becomes_an_interruption_without_replay(self):
        for result in (None, {"status": "success", "returncode": 1}, {"status": "error", "returncode": 0}):
            original = Mock(return_value=result)
            env = Mock()
            env.controller.execute_python_command = original
            checked_controller(env)
            with self.assertRaisesRegex(RuntimeError, "INPUT_UNCONFIRMED"):
                env.controller.execute_python_command("fixed-generated-input")
            original.assert_called_once()

    def test_swallowed_docker_cleanup_failure_cannot_unlock_baseline(self):
        class NotFound(Exception):
            pass
        client = Mock()
        provider = types.SimpleNamespace(container=types.SimpleNamespace(id="owned-vm"), client=client)
        env = types.SimpleNamespace(provider=provider, close=lambda: setattr(provider, "container", None))
        errors = types.ModuleType("docker.errors")
        errors.NotFound = NotFound
        with patch.dict(sys.modules, {"docker.errors": errors}):
            with self.assertRaisesRegex(RuntimeError, "CLEANUP_UNCONFIRMED"):
                close_environment(env)
            provider.container = types.SimpleNamespace(id="owned-vm")
            client.containers.get.side_effect = NotFound()
            close_environment(env)
            self.assertEqual(client.containers.get.call_count, 2)
            client.containers.get.assert_called_with("owned-vm")

    def test_fixed_suite_splits_are_disjoint_and_model_budget_is_pinned(self):
        suite = json.loads(Path(__file__).with_name("suite.json").read_text())
        development = {task["id"] for task in suite["splits"]["development"]}
        holdout = {task["id"] for task in suite["splits"]["holdout"]}
        self.assertEqual((len(development), len(holdout)), (24, 8))
        self.assertFalse(development & holdout)
        self.assertEqual(len(set(suite["smokeTaskIds"])), 2)
        self.assertTrue(set(suite["smokeTaskIds"]) <= development)
        self.assertEqual(suite["defaultModel"], "openai/gpt-6.1-sol")
        self.assertEqual(suite["settings"]["maxOutputTokens"], 2048)


if __name__ == "__main__":
    unittest.main()
