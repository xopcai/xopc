"""Use upstream FollowBench prompts and the unchanged EQ-Bench conversation runner."""
import argparse
import shutil
import uuid
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

from request_pools import shared_lease, is_transport_error

from protocol import follow_cases, follow_summary, official_function, parse_verdicts, select_eq, validate_traits, validate_dialogue_fixtures

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True)
parser.add_argument("--upstream", required=True)
parser.add_argument("--eq-cases", type=int, default=12)
parser.add_argument("--follow-cases", type=int, default=150)
parser.add_argument("--concurrency", type=int, default=2)
parser.add_argument("--dialogue-fixtures")
parser.add_argument("--eq-case-id")
args = parser.parse_args()
out = Path(args.out)
upstream = Path(args.upstream)
(out / "cases").mkdir()
(out / "request-failures").mkdir()
(out / "case-attempts").mkdir()
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
    body = {"caseId": local.case_id, "suite": local.suite, "role": role, "messages": messages, **options}
    context = {"owner": out.name, "caseId": local.case_id, "role": role,
               "inputSha256": hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()}
    for attempt in range(2 if role != "evaluated" else 1):
        try:
            with shared_lease("judge" if role == "judge" else "generation", {**context, "attempt": attempt + 1}):
                return bridge("/complete", body)
        except Exception as error:
            save(out / "request-failures" / (uuid.uuid4().hex + ".json"), {
                **context, "attempt": attempt + 1, "error": str(error), "input": body,
                "policy": "Retry only transport failures; evaluator roles reuse exact input. Candidate retries restart only the failed case in fresh state."})
            if role == "evaluated" and is_transport_error(error):
                raise RuntimeError("CandidateTransportFailure: " + str(error)) from error
            if attempt or not is_transport_error(error):
                raise
            time.sleep(1)


def finish(result):
    if local.case_id != result["caseId"]:
        result["captureCaseId"] = local.case_id
    save(out / "cases" / (result["caseId"] + ".json"), result)
    bridge("/finish", {"caseId": local.case_id, "suite": local.suite, "result": result})
    return result


def run_with_restart(function, doc):
    local.capture_override = None
    result = function(doc)
    if result.get("error") and "CandidateTransportFailure:" in result["error"]:
        original = out / "cases" / (result["caseId"] + ".json")
        retained = out / "case-attempts" / (result["caseId"] + ".first.json")
        shutil.copyfile(original, retained)
        recovery = {"originalSource": str(retained), "originalSha256": hashlib.sha256(retained.read_bytes()).hexdigest(),
                    "originalError": result["error"], "policy": "One fresh-state restart of an unscored candidate transport failure; new trajectory, no valid score replaced."}
        local.capture_override = result["caseId"] + "-transport-retry1"
        result = function(doc)
        result["transportRecovery"] = recovery
        save(out / "cases" / (result["caseId"] + ".json"), result)
    return result


style_prompt = official_function(upstream / "followbench/code_zh/gpt4_based_evaluation.py", "style_evaluation_prompt")
scripted = validate_dialogue_fixtures(json.loads(Path(args.dialogue_fixtures).read_text())) if args.dialogue_fixtures else []
if args.dialogue_fixtures and args.eq_case_id:
    raise ValueError("Scripted capture and single EQ capture are mutually exclusive")
follow = [] if args.dialogue_fixtures or args.eq_case_id else follow_cases(upstream / "followbench/data_zh/style_constraints.json", args.follow_cases)
eq_data = json.loads((upstream / "eqbench4/src/eqbench/datasets/test.json").read_text())
eq = [] if args.dialogue_fixtures else select_eq(eq_data["docs"], args.eq_cases)
if args.eq_case_id:
    eq = [doc for doc in eq_data["docs"] if doc["id"] == args.eq_case_id.removeprefix("EQ4-")]
    if len(eq) != 1:
        raise ValueError("Single EQ capture requires one exact scenario ID")
selection = {"follow": [{"caseId": r["caseId"], "example_id": r["example_id"], "level": r["level"]} for r in follow],
             "eq": [{"caseId": "EQ4-" + r["id"], "id": r["id"], "category": r.get("category") or r.get("assistant_relationship"), "relationship": r.get("assistant_relationship")} for r in eq],
             "selectionRule": "FollowBench all levels 1–5, ordered by example_id/level; EQ relationship/category round-robin, SHA-256(id) within category"}
save(out / "selection.json", selection)
if args.dialogue_fixtures:
    save(out / "selection.json", {"scripted": [{"caseId": r["id"], "category": r["category"]} for r in scripted],
                                  "fixtureSha256": hashlib.sha256(Path(args.dialogue_fixtures).read_bytes()).hexdigest(),
                                  "selectionRule": "All pre-registered fixed user scripts, one repetition; expectations not sent to Personal"})

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


def run_scripted(doc):
    local.case_id, local.suite = getattr(local, "capture_override", None) or doc["id"], "personal-p0-scripted"
    started = time.monotonic()
    result = {"caseId": doc["id"], "category": doc["category"], "transcript": []}
    try:
        for user_text in doc["userTurns"]:
            result["transcript"].append({"role": "user", "content": user_text})
            answer = completion("evaluated", result["transcript"])["content"]
            result["transcript"].append({"role": "assistant", "content": answer})
        result["assistantTurns"] = len(doc["userTurns"])
    except Exception as error:
        result["error"] = str(error)
    result["durationMs"] = round((time.monotonic() - started) * 1000)
    return finish(result)


def run_follow_generate(row):
    local.case_id, local.suite = getattr(local, "capture_override", None) or row["caseId"], "followbench-zh-style"
    started = time.monotonic()
    result = {"caseId": row["caseId"], "example_id": row["example_id"], "level": row["level"], "instruction": row["instruction"]}
    try:
        answer = completion("evaluated", [{"role": "user", "content": row["instruction"]}])["content"]
        result.update(answer=answer, judgePrompt=style_prompt(row["evolution"], answer),
                      generationDurationMs=round((time.monotonic() - started) * 1000))
        if local.case_id != row["caseId"]:
            result["captureCaseId"] = local.case_id
        return result
    except Exception as error:
        result.update(error=str(error), hardSatisfied=False, durationMs=round((time.monotonic() - started) * 1000))
        return finish(result)


def run_follow_judge(result):
    local.case_id, local.suite = result.get("captureCaseId", result["caseId"]), "followbench-zh-style"
    started = time.monotonic()
    try:
        judged = completion("judge", [{"role": "user", "content": result["judgePrompt"]}], temperature=0, max_tokens=4096)
        result["judgeResponse"] = judged["content"]
        verdicts = parse_verdicts(judged["content"], result["level"])
        result.update(verdicts=verdicts, hardSatisfied=all(v == "YES" for v in verdicts), softScore=verdicts.count("YES") / len(verdicts))
    except Exception as error:
        result.update(error=str(error), hardSatisfied=False)
    result["durationMs"] = result["generationDurationMs"] + round((time.monotonic() - started) * 1000)
    return finish(result)


def run_eq(doc):
    local.case_id, local.suite = getattr(local, "capture_override", None) or "EQ4-" + doc["id"], "eqbench4-personal-profile"
    started = time.monotonic()
    result = {"caseId": "EQ4-" + doc["id"], "scenarioId": doc["id"], "category": doc.get("category") or doc.get("assistant_relationship"), "relationship": doc.get("assistant_relationship")}
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

if args.dialogue_fixtures:
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        for result in pool.map(lambda doc: run_with_restart(run_scripted, doc), scripted):
            results.append(result)
            save(out / "scripted-summary.json", {"expected": len(scripted), "attempted": len(results),
                 "errors": sum(bool(r.get("error")) for r in results), "scored": False})
    errors = sum(bool(r.get("error")) for r in results)
    save(out / "summary.json", {"expected": len(scripted), "attempted": len(results), "errors": errors,
         "complete": len(results) == len(scripted) and not errors, "scored": False})
    raise SystemExit(1 if errors else 0)

def run_eq_in_slot(doc):
    with shared_lease("scene", {"owner": out.name, "caseId": "EQ4-" + doc["id"]}):
        return run_with_restart(run_eq, doc)


def run_parallel(follow, eq):
    results_follow, results_eq = [], []
    summary = {"expected": len(eq), "attempted": 0, "scored": 0, "errors": 0, "complete": not eq, "traits": {}}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as generation_pool, \
         concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as judge_pool, \
         concurrent.futures.ThreadPoolExecutor(max_workers=min(3, args.concurrency)) as scene_pool:
        pending = {generation_pool.submit(run_with_restart, run_follow_generate, row): "generation" for row in follow}
        pending.update({scene_pool.submit(run_eq_in_slot, doc): "eq" for doc in eq})
        while pending:
            done, _ = concurrent.futures.wait(pending, return_when=concurrent.futures.FIRST_COMPLETED)
            for future in done:
                kind = pending.pop(future)
                result = future.result()
                if kind == "generation" and not result.get("error"):
                    pending[judge_pool.submit(run_follow_judge, result)] = "follow"
                elif kind in ("generation", "follow"):
                    results_follow.append(result)
                    save(out / "follow-summary.json", follow_summary(results_follow, len(follow)))
                else:
                    results_eq.append(result)
                    scored = [r for r in results_eq if not r.get("error")]
                    summary = {"expected": len(eq), "attempted": len(results_eq), "scored": len(scored), "errors": len(results_eq) - len(scored),
                               "complete": len(results_eq) == len(eq) and len(scored) == len(eq),
                               "traits": {d: sum(r["traits"][d] for r in scored) / len(scored) for d in dimensions} if scored else {},
                               "officialLeaderboardScore": None, "qualityPassRate": None,
                               "note": "Neutral style tendencies, not quality scores; a higher score is not always better."}
                    save(out / "eq-summary.json", summary)
    return results_follow, results_eq, summary


results_follow, results_eq, summary = run_parallel(follow, eq)
errors = sum(bool(r.get("error")) for r in results_follow + results_eq)
save(out / "summary.json", {"followbench": follow_summary(results_follow, len(follow)) if follow else None, "eqbench4": summary, "errors": errors, "officialLeaderboardComparable": False})
raise SystemExit(1 if errors else 0)
