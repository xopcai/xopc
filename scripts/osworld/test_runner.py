"""Offline runner/oracle integration with disposable fake boundaries, no inference."""
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import run
import docker_host


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.output = Path(self.root.name) / "evidence"
        self.tasks = [{"id": "a", "domain": "fixture", "sha256": "0" * 64},
                      {"id": "b", "domain": "fixture", "sha256": "1" * 64}]

    def execute(self, input_failure=False, cleanup_failure=False, preflight=False):
        class Agent:
            def __init__(self, model):
                if preflight:
                    raise AssertionError("Offline preflight must not construct a model agent")
                self.model_requests = 0
                self.requests_unknown = False
                self.claimed_success = False
                self.takeover = False

            def preflight(self):
                return {"modelIdentity": "a" * 64}

            def reset(self):
                self.model_requests = 0
                self.claimed_success = False

            def close(self):
                pass

            def predict(self, instruction, obs):
                self.model_requests += 1
                self.claimed_success = not input_failure
                return {"kind": "finished", "claimedSuccess": True}, ["fixed-generated-input" if input_failure else "DONE"]

        class Environment:
            instance = None

            def __init__(self, **kwargs):
                Environment.instance = self
                self.controller = types.SimpleNamespace()
                self.input_calls = self.resets = self.evaluations = self.closes = 0

            def reset(self, task_config):
                self.resets += 1
                def execute(command):
                    self.input_calls += 1
                    return None if input_failure else {"status": "success", "returncode": 0}
                self.controller.execute_python_command = execute

            def _get_obs(self):
                return {"screenshot": b"offline-fixture"}

            def step(self, action, pause):
                if action != "DONE":
                    self.controller.execute_python_command(action)
                return self._get_obs(), 0, True, {}

            def evaluate(self):
                self.evaluations += 1
                return 0  # An independent oracle overrides the agent's success claim.

            def close(self):
                self.closes += 1
                if cleanup_failure:
                    raise RuntimeError("offline-cleanup-failed")

        module = types.ModuleType("desktop_env.desktop_env")
        module.DesktopEnv = Environment
        args = ["run.py", "--osworld-root", self.root.name, "--environment-id", "offline-fixture",
                "--output", str(self.output), "--repetitions", "1"] + (["--preflight"] if preflight else [])
        configs = {task["id"]: {"instruction": "offline fixture"} for task in self.tasks}
        with patch.object(sys, "argv", args), patch.object(sys, "path", list(sys.path)), patch.object(run, "verify_tasks", return_value=(self.tasks, configs)), \
                patch.object(run, "XopcAgent", Agent), patch.dict(sys.modules, {"desktop_env.desktop_env": module}), \
                patch.object(docker_host, "install_macos_docker_provider", return_value="offline-fixture"), \
                patch.object(run.time, "sleep"), patch("builtins.print"):
            code = run.main()
        return code, Environment.instance

    def test_official_oracle_overrides_model_success_and_checkpoint_is_private(self):
        code, env = self.execute()
        self.assertEqual(code, 0)
        report = json.loads((self.output / "report.json").read_text())
        self.assertEqual(report["summary"]["passed"], 0)
        self.assertEqual(report["summary"]["falseSuccesses"], 2)
        self.assertTrue(report["cleanupConfirmed"])
        self.assertFalse(report["interrupted"])
        self.assertEqual((env.resets, env.evaluations, env.closes), (2, 2, 1))
        self.assertEqual((self.output / "report.json").stat().st_mode & 0o777, 0o600)

    def test_uncertain_input_stops_matrix_without_replay_and_preserves_denominator(self):
        code, env = self.execute(input_failure=True)
        self.assertEqual(code, 1)
        report = json.loads((self.output / "report.json").read_text())
        self.assertTrue(report["interrupted"])
        self.assertEqual(report["runs"][0]["errorPhase"], "dispatch")
        self.assertEqual(report["summary"]["missingRuns"], 1)
        self.assertEqual((env.input_calls, env.resets, env.evaluations, env.closes), (1, 1, 0, 1))

    def test_cleanup_failure_survives_checkpoint_and_nonzero_exit(self):
        code, env = self.execute(cleanup_failure=True)
        self.assertEqual(code, 1)
        report = json.loads((self.output / "report.json").read_text())
        self.assertTrue(report["interrupted"])
        self.assertFalse(report["cleanupConfirmed"])
        self.assertEqual(report["cleanupError"], "OSWORLD_CLEANUP_UNCONFIRMED")

    def test_offline_preflight_does_not_allocate_a_model_or_environment(self):
        code, env = self.execute(preflight=True)
        self.assertIsNone(code)
        self.assertIsNone(env)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
