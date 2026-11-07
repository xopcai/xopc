"""Run the 24 x 3 baseline only after two independently graded smoke successes."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

from report import summarize


def smoke_passed(report):
    summary, _ = summarize(report)
    return (report.get("interrupted") is False and report.get("cleanupConfirmed") is True
            and summary["expectedRuns"] == 2 and summary["completedRuns"] == 2
            and summary["passed"] == 2 and summary["falseSuccesses"] == 0
            and all(row["steps"] > 0 for row in report["runs"]))


def run_pipeline(output, common, smoke_ids, execute=subprocess.run):
    if output.exists():
        raise ValueError("OSWORLD_OUTPUT_EXISTS")
    if len(smoke_ids) != 2 or len(set(smoke_ids)) != 2:
        raise ValueError("OSWORLD_EXPECTED_TWO_SMOKE_TASKS")
    output.mkdir(parents=True, mode=0o700)
    state = {"modelRef": common[common.index("--model") + 1], "stage": "smoke", "smokePassed": False,
             "smokeReport": str(output / "smoke/report.json"), "baselineReport": None}
    def save():
        temporary = output / "pipeline.tmp"
        with temporary.open("w") as stream:
            os.chmod(temporary, 0o600)
            json.dump(state, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(output / "pipeline.json")
    save()
    runner = [sys.executable, str(Path(__file__).with_name("run.py")), *common]
    cwd = common[common.index("--osworld-root") + 1]
    smoke_args = [value for task_id in smoke_ids for value in ("--task-id", task_id)]
    smoke = execute([*runner, "--output", str(output / "smoke"), "--repetitions", "1", *smoke_args], check=False, cwd=cwd)
    smoke_report = output / "smoke/report.json"
    try:
        passed = not smoke.returncode and smoke_report.exists() and smoke_passed(json.loads(smoke_report.read_text()))
    except (KeyError, TypeError, ValueError):
        passed = False
    if not passed:
        state["stage"] = "smoke-failed"
        save()
        return 1
    state.update(stage="baseline", smokePassed=True, baselineReport=str(output / "baseline/report.json"))
    save()
    baseline = execute([*runner, "--output", str(output / "baseline"), "--repetitions", "3"], check=False, cwd=cwd)
    baseline_report = output / "baseline/report.json"
    if baseline.returncode or not baseline_report.exists():
        state["stage"] = "baseline-interrupted"
        save()
        return 1
    report = json.loads(baseline_report.read_text())
    summary, _ = summarize(report)
    complete = (summary["expectedRuns"] == 72 and summary["completedRuns"] == 72
                and report.get("interrupted") is False and report.get("cleanupConfirmed") is True)
    state.update(stage="baseline-completed" if complete else "baseline-interrupted", summary=summary)
    save()
    return 0 if complete else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--osworld-root", type=Path, required=True)
    parser.add_argument("--environment-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", default="openai/gpt-6.1-sol")
    parser.add_argument("--provider", choices=("docker", "vmware", "aws"), default="docker")
    parser.add_argument("--vm-path", type=Path)
    args = parser.parse_args()
    suite = json.loads(Path(__file__).with_name("suite.json").read_text())
    common = ["--osworld-root", str(args.osworld_root.resolve()), "--environment-id", args.environment_id,
              "--model", args.model, "--provider", args.provider]
    if args.vm_path:
        common += ["--vm-path", str(args.vm_path.resolve())]
    raise SystemExit(run_pipeline(args.output.resolve(), common, suite["smokeTaskIds"]))
