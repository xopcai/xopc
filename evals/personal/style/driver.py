"""Use upstream FollowBench prompts and the unchanged EQ-Bench conversation runner."""
import argparse
import concurrent.futures
import dataclasses
import hashlib
import json
import os
import threading
import time
import traceback
import urllib.request
from pathlib import Path

from protocol import follow_cases, follow_summary, official_function, parse_verdicts, select_eq, validate_traits

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True)
parser.add_argument("--upstream", required=True)
parser.add_argument("--eq-cases", type=int, default=12)
parser.add_argument("--follow-cases", type=int, default=150)
parser.add_argument("--concurrency", type=int, default=2)
args = parser.parse_args()
out = Path(args.out)
upstream = Path(args.upstream)
(out / "cases").mkdir()
local = threading.local()


def save(path, data):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def bridge(path, body):
    request = urllib.request.Request(os.environ["XOPC_STYLE_BRIDGE"] + path, data=json.dumps(body).encode(), headers={
        "Authorization": "Bearer " + os.environ["XOPC_STYLE_TOKEN"], "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode()) from error


def completion(role, messages, **options):
    return bridge("/complete", {"caseId": local.case_id, "suite": local.suite, "role": role, "messages": messages, **options})


def finish(result):
    save(out / "cases" / (result["caseId"] + ".json"), result)
    bridge("/finish", {"caseId": result["caseId"], "suite": local.suite, "result": result})
    return result


style_prompt = official_function(upstream / "followbench/code_zh/gpt4_based_evaluation.py", "style_evaluation_prompt")
follow = follow_cases(upstream / "followbench/data_zh/style_constraints.json", args.follow_cases)
eq_data = json.loads((upstream / "eqbench4/src/eqbench/datasets/test.json").read_text())
eq = select_eq(eq_data["docs"], args.eq_cases)
selection = {"follow": [{"caseId": r["caseId"], "example_id": r["example_id"], "level": r["level"]} for r in follow],
             "eq": [{"caseId": "EQ4-" + r["id"], "id": r["id"], "category": r.get("category") or r.get("assistant_relationship"), "relationship": r.get("assistant_relationship")} for r in eq],
             "selectionRule": "FollowBench all levels 1–5, ordered by example_id/level; EQ relationship/category round-robin, SHA-256(id) within category"}
save(out / "selection.json", selection)

from eqbench.core import conversation_runner as cr
from eqbench.core.api_client import APIError, CompletionResult


def eq_completion(**kwargs):
    role = kwargs.get("request_role", "judge")
    options = {"max_tokens": kwargs.get("max_tokens", 10000), "temperature": kwargs.get("temperature", 0.7)}
    if role == "evaluated":
        # Product prompt remains authoritative. Only the public evaluator context is
        # passed as a labeled user prefix; private persona and judging prompts stay out.
        options["systemContext"] = "\n".join(m["content"] for m in kwargs["messages"] if m["role"] == "system")
    try:
        return CompletionResult(**completion(role, kwargs["messages"], **options))
    except Exception as error:
        raise APIError(str(error)) from error


cr.get_completion_with_metadata = eq_completion
rubric = (upstream / "eqbench4/src/eqbench/rubrics/eq_judging_rubric.txt").read_text()
dimensions = [line.split(":", 1)[0].strip() for line in rubric.splitlines() if ":" in line and not line.startswith("#")]


def run_follow(row):
    local.case_id, local.suite = row["caseId"], "followbench-zh-style"
    started = time.monotonic()
    result = {"caseId": row["caseId"], "example_id": row["example_id"], "level": row["level"], "instruction": row["instruction"]}
    try:
        answer = completion("evaluated", [{"role": "user", "content": row["instruction"]}])["content"]
        result["answer"] = answer
        prompt = style_prompt(row["evolution"], answer)
        result["judgePrompt"] = prompt
        judged = completion("judge", [{"role": "user", "content": prompt}], temperature=0, max_tokens=4096)
        result["judgeResponse"] = judged["content"]
        verdicts = parse_verdicts(judged["content"], row["level"])
        result.update(verdicts=verdicts, hardSatisfied=all(v == "YES" for v in verdicts), softScore=verdicts.count("YES") / len(verdicts))
    except Exception as error:
        result["error"] = str(error)
        result["hardSatisfied"] = False
    result["durationMs"] = round((time.monotonic() - started) * 1000)
    return finish(result)


def run_eq(doc):
    local.case_id, local.suite = "EQ4-" + doc["id"], "eqbench4-personal-profile"
    started = time.monotonic()
    result = {"caseId": local.case_id, "scenarioId": doc["id"], "category": doc.get("category") or doc.get("assistant_relationship"), "relationship": doc.get("assistant_relationship")}
    path = out / "cases" / (local.case_id + ".progress.json")
    try:
        judge = cr.JudgeConfig(model="configured-judge", api_key="local-bridge", base_url="local-bridge", backend="custom")
        conversation = cr.run_conversation(
            scenario=doc, persona_model="configured-persona", evaluated_model="personal", persona_api_key="local-bridge",
            persona_base_url="local-bridge", persona_backend="custom", evaluated_api_key="local-bridge", evaluated_base_url="local-bridge",
            evaluated_backend="custom", num_turns=8, max_retries=1, backoff_factor=0, judges=[judge], scenario_id=doc["id"],
            enable_pointwise_scoring=True, save_callback=lambda state: save(path, dataclasses.asdict(state)))
        result["conversation"] = dataclasses.asdict(conversation)
        if not conversation.completed or conversation.errors:
            raise ValueError("Incomplete EQ conversation or retained runner errors: " + json.dumps(conversation.errors))
        judged = conversation.performance_judge_results or {}
        if judged.get("error") or judged.get("judge_errors"):
            raise ValueError("EQ pointwise judge failed: " + json.dumps(judged))
        scores = {key: value for key, value in judged.items() if key not in ("per_judge", "num_judges", "judge_errors")}
        result["traits"] = validate_traits(scores, dimensions)
        result["assistantTurns"] = sum(m["role"] == "assistant" for m in conversation.transcript)
        result["userTurns"] = sum(m["role"] == "user" for m in conversation.transcript)
    except Exception as error:
        result["error"] = str(error)
        result["traceback"] = traceback.format_exc()
    result["durationMs"] = round((time.monotonic() - started) * 1000)
    return finish(result)


# One isolated preflight checks all roles before scheduling the frozen baseline.
local.case_id, local.suite = "preflight", "style-preflight"
try:
    for role in ["evaluated", "judge", "persona"]:
        completion(role, [{"role": "user", "content": "Reply with the single word ready."}], max_tokens=128)
    finish({"caseId": "preflight", "note": "Connectivity only; excluded from benchmark scores"})
except Exception as error:
    finish({"caseId": "preflight", "error": str(error)})
    raise SystemExit("Model preflight failed; no baseline cases scheduled")

results_follow, results_eq = [], []
with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
    futures = {pool.submit(run_follow, row): "follow" for row in follow}
    for future in concurrent.futures.as_completed(futures):
        results_follow.append(future.result())
        save(out / "follow-summary.json", follow_summary(results_follow, len(follow)))
    futures = {pool.submit(run_eq, doc): "eq" for doc in eq}
    for future in concurrent.futures.as_completed(futures):
        results_eq.append(future.result())
        scored = [r for r in results_eq if not r.get("error")]
        summary = {"expected": len(eq), "attempted": len(results_eq), "scored": len(scored), "errors": len(results_eq) - len(scored),
                   "complete": len(results_eq) == len(eq) and len(scored) == len(eq),
                   "traits": {d: sum(r["traits"][d] for r in scored) / len(scored) for d in dimensions} if scored else {},
                   "officialLeaderboardScore": None, "qualityPassRate": None,
                   "note": "Neutral style tendencies, not quality scores; a higher score is not always better."}
        save(out / "eq-summary.json", summary)
errors = sum(bool(r.get("error")) for r in results_follow + results_eq)
save(out / "summary.json", {"followbench": follow_summary(results_follow, len(follow)), "eqbench4": summary, "errors": errors, "officialLeaderboardComparable": False})
raise SystemExit(1 if errors else 0)
