"""Sequential, pinned OSWorld V1 evaluation. Run only after GPT-6.1 authorization."""
import argparse
import hashlib
import json
import math
import os
import signal
from pathlib import Path
import subprocess
import sys
import time

from agent import XopcAgent, DEFAULT_MODEL, REPO
from report import fingerprint, summarize


def checkpoint(path, report):
    report["summary"] = summarize(report)[0]
    temporary = path.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        os.chmod(temporary, 0o600)
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def verify_tasks(root, suite, split):
    settings = suite["settings"]
    if (suite["version"] != 1 or settings["maxOutputTokens"] != 2048
            or settings["actionSpace"] != "pyautogui" or settings["observationType"] != "screenshot_a11y_tree"
            or type(settings["maxSteps"]) is not int or not 1 <= settings["maxSteps"] <= 100
            or len(settings["screenSize"]) != 2
            or any(type(v) is not int or not 1 <= v <= 4096 for v in settings["screenSize"])
            or any(type(settings[k]) not in (int, float) or not math.isfinite(settings[k]) or not 0 <= settings[k] <= 120
                   for k in ("sleepAfterExecution", "setupWaitSeconds", "evaluationWaitSeconds"))):
        raise ValueError("OSWORLD_UNSUPPORTED_SETTINGS")
    commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    dirty = subprocess.check_output(["git", "-C", str(root), "status", "--porcelain", "--untracked-files=no"], text=True).strip()
    if commit != suite["commit"] or dirty:
        raise ValueError("OSWORLD_CHECKOUT_MISMATCH")
    tasks = suite["splits"][split]
    ids = [task["id"] for task in tasks]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError("OSWORLD_INVALID_PLAN")
    configs = {}
    for task in tasks:
        path = (root / "evaluation_examples" / "examples" / task["domain"] / (task["id"] + ".json")).resolve()
        if root.resolve() not in path.parents or hashlib.sha256(path.read_bytes()).hexdigest() != task["sha256"]:
            raise ValueError("OSWORLD_TASK_HASH_MISMATCH")
        config = json.loads(path.read_text())
        if config["id"] != task["id"]:
            raise ValueError("OSWORLD_TASK_ID_MISMATCH")
        configs[task["id"]] = config
    return tasks, configs


def checked_controller(env):
    # Upstream env.step discards the controller's result. Refuse silent/uncertain input failures.
    original = env.controller.execute_python_command
    def execute(command):
        result = original(command)
        if not isinstance(result, dict) or result.get("status") != "success" or result.get("returncode") != 0:
            raise RuntimeError("OSWORLD_INPUT_UNCONFIRMED")
        return result
    env.controller.execute_python_command = execute


def select_tasks(tasks, task_ids=None, limit=None):
    if task_ids:
        selected = {task["id"]: task for task in tasks}
        if limit is not None or len(task_ids) != len(set(task_ids)) or any(key not in selected for key in task_ids):
            raise ValueError("OSWORLD_INVALID_TASK_SELECTION")
        return [selected[key] for key in task_ids]
    return tasks[:limit] if limit is not None else tasks


def close_environment(env):
    provider = getattr(env, "provider", None)
    container = getattr(provider, "container", None)
    client = getattr(provider, "client", None)
    env.close()
    if container is not None and client is not None:
        # The upstream Docker provider logs and swallows stop/remove errors.
        # Its cleared container reference is not evidence that the VM is gone.
        from docker.errors import NotFound
        try:
            client.containers.get(container.id)
        except NotFound:
            return
        raise RuntimeError("OSWORLD_CLEANUP_UNCONFIRMED")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--osworld-root", type=Path, required=True)
    parser.add_argument("--suite", type=Path, default=Path(__file__).with_name("suite.json"))
    parser.add_argument("--split", choices=("development", "holdout"), default="development")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--provider", choices=("docker", "vmware", "aws"), default="docker")
    parser.add_argument("--vm-path")
    parser.add_argument("--environment-id", required=True, help="Immutable guest image digest + snapshot revision; keep constant between A/B runs.")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--limit", type=int, help="Explicit smoke subset; cannot compare with the full suite.")
    parser.add_argument("--task-id", action="append", help="Select an exact task from this split; repeat for multiple tasks.")
    parser.add_argument("--preflight", action="store_true", help="Verify checkout/tasks only. No model, VM, desktop or cloud calls.")
    args = parser.parse_args()
    if not 1 <= args.repetitions <= 20 or args.limit is not None and args.limit < 1:
        parser.error("repetitions must be 1..20; limit must be positive")
    if not args.environment_id.strip():
        parser.error("environment-id must identify the guest image and snapshot")
    suite = json.loads(args.suite.read_text())
    root = args.osworld_root.resolve()
    tasks, configs = verify_tasks(root, suite, args.split)
    tasks = select_tasks(tasks, args.task_id, args.limit)
    if args.preflight:
        print(json.dumps({"status": "offline-preflight-passed", "tasks": len(tasks), "modelRef": args.model,
                          "commit": suite["commit"], "vmVerified": False, "credentialsVerified": False}))
        return
    if args.output.exists():
        parser.error("output already exists; use a new directory to preserve baseline evidence")
    agent = XopcAgent(args.model)
    env = None
    report = report_path = None
    def interrupt(_signal, _frame):
        raise KeyboardInterrupt
    previous_sigterm = signal.signal(signal.SIGTERM, interrupt)
    # Fail credentials before allocating a VM. User must explicitly invoke this non-preflight path.
    try:
        model_info = agent.preflight()
        agent.close()
        sys.path.insert(0, str(root))
        from desktop_env.desktop_env import DesktopEnv
        host_adapter = "upstream"
        if args.provider == "docker":
            from docker_host import install_macos_docker_provider
            host_adapter = install_macos_docker_provider()
        args.output.mkdir(parents=True, mode=0o700)
        plan = {"benchmark": "OSWorld-V1", "commit": suite["commit"], "tasks": tasks, "split": args.split,
                "modelRef": args.model, "modelIdentity": model_info["modelIdentity"], "provider": args.provider, "environment": args.environment_id,
                "repetitions": args.repetitions, "hostAdapter": host_adapter, **suite["settings"]}
        report = {"version": 1, "plan": plan, "fingerprint": fingerprint(plan), "runs": [], "interrupted": False,
                  "executionPath": "shared-model-adapter/pyautogui-vm", "nativeCertified": False, "cleanupConfirmed": False,
                  "codeRevision": subprocess.check_output(["git", "-C", str(REPO), "rev-parse", "HEAD"], text=True).strip(),
                  "dirty": bool(subprocess.check_output(["git", "-C", str(REPO), "status", "--porcelain"], text=True).strip()),
                  "sourceHashes": {name: hashlib.sha256((REPO / name).read_bytes()).hexdigest() for name in (
                      "src/computer/model-adapter.ts", "src/computer/keyboard.ts", "scripts/osworld/agent.py",
                      "scripts/osworld/model-bridge.mts", "scripts/osworld/run.py", "scripts/osworld/report.py",
                      "scripts/osworld/pipeline.py", "scripts/osworld/suite.json", "scripts/osworld/docker_host.py")}}
        report_path = args.output / "report.json"
        checkpoint(report_path, report)
        try:
            env = DesktopEnv(provider_name=args.provider, path_to_vm=args.vm_path, action_space="pyautogui",
                             screen_size=tuple(plan["screenSize"]), headless=True, require_a11y_tree=True,
                             os_type="Ubuntu", client_password=os.environ.get("OSWORLD_CLIENT_PASSWORD", "password"))
            for task in tasks:
                for repetition in range(args.repetitions):
                    agent.reset()
                    started, steps = time.monotonic(), 0
                    phase = "setup"
                    row = {"taskId": task["id"], "repetition": repetition, "score": None, "status": "error",
                           "steps": 0, "durationMs": 0, "modelRequests": 0, "claimedSuccess": False, "takeover": False}
                    directory = args.output / task["id"] / str(repetition)
                    directory.mkdir(parents=True, mode=0o700)
                    try:
                        env.reset(task_config=configs[task["id"]])
                        checked_controller(env)
                        time.sleep(plan["setupWaitSeconds"])
                        obs = env._get_obs()
                        phase = "model"
                        for step in range(plan["maxSteps"]):
                            (directory / f"step-{step:03d}.png").write_bytes(obs["screenshot"])
                            proposal, actions = agent.predict(configs[task["id"]]["instruction"], obs)
                            if len(actions) != 1:
                                raise ValueError("OSWORLD_EXPECTED_ONE_ACTION")
                            with (directory / "trajectory.jsonl").open("a", encoding="utf-8") as stream:
                                stream.write(json.dumps({"step": step, "proposal": proposal}, ensure_ascii=False) + "\n")
                            phase = "dispatch"
                            obs, _, done, _ = env.step(actions[0], plan["sleepAfterExecution"])
                            steps += 1
                            phase = "model"
                            if done:
                                break
                        (directory / "final.png").write_bytes(obs["screenshot"])
                        phase = "oracle"
                        time.sleep(plan["evaluationWaitSeconds"])
                        score = env.evaluate()
                        if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
                            raise ValueError("OSWORLD_INVALID_SCORE")
                        row.update(status="completed", score=score)
                    except (Exception, KeyboardInterrupt):
                        # A failed dispatch may already have changed the guest. Never retry or resume it.
                        row["errorPhase"] = phase
                        report["interrupted"] = True
                    finally:
                        row.update(steps=steps, durationMs=(time.monotonic() - started) * 1000,
                                   modelRequests=None if agent.requests_unknown else agent.model_requests,
                                   claimedSuccess=agent.claimed_success, takeover=agent.takeover)
                        report["runs"].append(row)
                        checkpoint(report_path, report)
                        agent.close()
                    print(json.dumps({"taskId": task["id"], "repetition": repetition, "status": row["status"], "score": row["score"]}), flush=True)
                    if report["interrupted"]:
                        return 1
        except (Exception, KeyboardInterrupt):
            report["interrupted"] = True
            checkpoint(report_path, report)
            return 1
        print(json.dumps(report["summary"], indent=2))
        return 0
    finally:
        try:
            agent.close()
            if env is not None:
                try:
                    close_environment(env)
                    report["cleanupConfirmed"] = True
                except (Exception, KeyboardInterrupt):
                    report["interrupted"] = True
                    report["cleanupError"] = "OSWORLD_CLEANUP_UNCONFIRMED"
                    checkpoint(report_path, report)
                    return 1
            if report is not None:
                checkpoint(report_path, report)
        finally:
            signal.signal(signal.SIGTERM, previous_sigterm)


if __name__ == "__main__":
    raise SystemExit(main())
