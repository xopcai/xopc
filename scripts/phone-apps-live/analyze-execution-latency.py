"""Recalculate Phone Use latency from frozen traces without model or device calls."""

import argparse
import collections
import hashlib
import json
import math
import tarfile
from pathlib import Path


def stats(values):
    values = sorted(values)
    count = len(values)
    return {
        "n": count,
        "sumMs": sum(values),
        "p50Ms": round((values[(count - 1) // 2] + values[count // 2]) / 2, 1)
        if count else None,
        "p95Ms": values[math.ceil(count * 0.95) - 1] if count else None,
        "maxMs": max(values) if count else None,
    }


def new_arm():
    return {
        "trials": 0,
        "events": collections.Counter(),
        "model": [],
        "failedModel": [],
        "successfulModel": [],
        "preDispatchObservationProxy": [],
        "dispatch": [],
        "errors": collections.Counter(),
        "responseMetadata": [],
    }


def accumulate(arm, trace):
    arm["trials"] += 1
    pending_model = None
    pending_decision = None
    pending_dispatch = None
    for event in trace:
        kind = event["event"]
        arm["events"][kind] += 1
        if kind == "predict":
            pending_model = event["at"]
        if kind in ("decision", "model_error") and pending_model is not None:
            duration = event["at"] - pending_model
            arm["model"].append(duration)
            bucket = "failedModel" if kind == "model_error" else "successfulModel"
            arm[bucket].append(duration)
            pending_model = None
        if kind == "model_error":
            arm["errors"][event.get("code", "unknown")] += 1
        if kind == "decision" and event.get("kind") == "action":
            pending_decision = event["at"]
        if kind in ("observe", "dispatch_attempt") and pending_decision is not None:
            arm["preDispatchObservationProxy"].append(event["at"] - pending_decision)
            pending_decision = None
        if kind == "dispatch_attempt":
            pending_dispatch = event["at"]
        if kind in ("dispatch_completed", "dispatch_error") and pending_dispatch is not None:
            arm["dispatch"].append(event["at"] - pending_dispatch)
            pending_dispatch = None
        if kind == "model_response_metadata":
            arm["responseMetadata"].append({
                key: value for key, value in event.items() if key not in ("event", "at")
            })


def analyze_panel(root, version):
    path = root / f"phone-real-app-{version}-traces-2026-10-24.tar.gz"
    arms = {}
    with tarfile.open(path) as archive:
        for member in archive.getmembers():
            if not member.isfile() or not member.name.endswith(".json"):
                continue
            # Read archive members directly; never extract untrusted paths.
            with archive.extractfile(member) as stream:
                trial = json.load(stream)
            if not isinstance(trial, dict) or "trace" not in trial:
                continue
            arm = arms.setdefault(trial["arm"], new_arm())
            accumulate(arm, trial["trace"])
    for arm in arms.values():
        for key in ("model", "failedModel", "successfulModel", "preDispatchObservationProxy", "dispatch"):
            arm[key] = stats(arm[key])
    return {
        "version": version,
        "source": str(path),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "arms": arms,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", type=Path, default=Path("docs/design/technical/evidence"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = {
        "method": (
            "Frozen historical traces, not new model runs. predict->decision/model_error is whole "
            "adapter latency including API/network/parse. decision->first observe/dispatch_attempt "
            "is a proxy for pre-dispatch observation (not isolated instrumentation). "
            "dispatch_attempt->dispatch_completed includes driver internal confirmation and settle. "
            "No stage percentages inferred from whole trial durations, which include independent "
            "oracles. Quantiles: median and nearest-rank P95."
        ),
        "panels": [analyze_panel(args.evidence_dir, version) for version in ("v1", "v2")],
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    for panel in result["panels"]:
        for name, arm in panel["arms"].items():
            print(
                f"{panel['version']} {name}: requests={arm['model']['n']} "
                f"model P50={arm['model']['p50Ms']}ms P95={arm['model']['p95Ms']}ms "
                f"errors={dict(arm['errors'])}"
            )


if __name__ == "__main__":
    main()
