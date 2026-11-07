"""Recompute OSWorld scores from the fixed matrix; never trust stored summaries."""
import argparse
import hashlib
import json
import math
from pathlib import Path


def fingerprint(plan):
    return hashlib.sha256(json.dumps(plan, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def summarize(report):
    plan = report["plan"]
    tasks = plan["tasks"]
    ids = [task["id"] for task in tasks]
    repetitions = plan["repetitions"]
    if not ids or len(ids) != len(set(ids)) or type(repetitions) is not int or not 1 <= repetitions <= 20:
        raise ValueError("OSWORLD_INVALID_PLAN")
    seen, scores, steps, durations = {}, [], [], []
    completed = passed = false_successes = errors = 0
    for row in report["runs"]:
        repetition = row["repetition"]
        key = (row["taskId"], repetition)
        if type(repetition) is not int or not 0 <= repetition < repetitions or key[0] not in ids or key in seen:
            raise ValueError("OSWORLD_INVALID_RUN")
        score = row["score"]
        if row["status"] not in ("completed", "error"):
            raise ValueError("OSWORLD_INVALID_RUN")
        if type(row["claimedSuccess"]) is not bool or type(row["takeover"]) is not bool:
            raise ValueError("OSWORLD_INVALID_RUN")
        if row["status"] == "completed":
            if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
                raise ValueError("OSWORLD_INVALID_SCORE")
            completed += 1
            scores.append(score)
            passed += score == 1 and not row["takeover"]
        elif score is not None:
            raise ValueError("OSWORLD_INVALID_SCORE")
        else:
            errors += 1
        for name in ("steps", "modelRequests", "durationMs"):
            value = row[name]
            if name == "modelRequests" and value is None:
                continue
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                raise ValueError("OSWORLD_INVALID_RUN")
        steps.append(row["steps"])
        durations.append(row["durationMs"])
        false_successes += row["claimedSuccess"] and score != 1
        seen[key] = row
    expected = len(ids) * repetitions
    return {"expectedRuns": expected, "recordedRuns": len(seen), "completedRuns": completed,
            "missingRuns": expected - len(seen), "errors": errors, "passed": passed,
            "successRate": passed / expected, "meanScore": sum(scores) / expected,
            "falseSuccesses": false_successes,
            "steps": sum(steps), "modelRequests": (sum(row["modelRequests"] for row in seen.values())
                if all(row["modelRequests"] is not None for row in seen.values()) else None),
            "p95DurationMs": sorted(durations)[math.ceil(len(durations) * .95) - 1] if durations else None,
            "cost": None, "inputTokens": None, "outputTokens": None,
            "nativeCertified": False, "safetyMeasured": False}, seen


def compare(baseline, candidate):
    before, b = summarize(baseline)
    after, c = summarize(candidate)
    if baseline["plan"] != candidate["plan"]:
        raise ValueError("OSWORLD_INCOMPARABLE_PLANS")
    keys = b.keys() & c.keys()
    def success(row):
        return row["status"] == "completed" and row["score"] == 1 and not row["takeover"]
    wins = sum(success(c[key]) and not success(b[key]) for key in keys)
    losses = sum(success(b[key]) and not success(c[key]) for key in keys)
    regressed = sorted({key[0] for key in keys if success(b[key]) and not success(c[key])})
    score_regressions = sorted({key[0] for key in keys if b[key]["score"] is not None
                                and (c[key]["score"] is None or c[key]["score"] < b[key]["score"])})
    complete = (len(keys) == before["expectedRuns"] and before["errors"] == 0 and after["errors"] == 0
                and all(value.get("interrupted") is False and value.get("cleanupConfirmed") is True
                        for value in (baseline, candidate)))
    return {"baseline": before, "candidate": after, "pairedRuns": len(keys), "complete": complete,
            "wins": wins, "losses": losses, "ties": len(keys) - wins - losses,
            "regressedTasks": regressed, "scoreRegressions": score_regressions,
            "successRateDelta": after["successRate"] - before["successRate"],
            "meanScoreDelta": after["meanScore"] - before["meanScore"],
            "regressionGatePassed": complete and not losses and not score_regressions and not after["falseSuccesses"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compare same-model, same-budget OSWorld reports.")
    parser.add_argument("baseline", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = compare(json.loads(args.baseline.read_text()), json.loads(args.candidate.read_text()))
    print(json.dumps(result, indent=2))
    raise SystemExit(1 if not result["complete"] or args.check and not result["regressionGatePassed"] else 0)
