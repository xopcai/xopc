"""Pure dataset selection and strict grading for the Personal dialogue adapter."""
import ast
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path


def official_function(path, name):
    """Load an unchanged upstream pure function without its plotting dependencies."""
    tree = ast.parse(Path(path).read_text(encoding="utf-8"))
    function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)
    scope = {}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(path), "exec"), scope)
    return scope[name]


def follow_cases(path, limit=150):
    rows = json.loads(Path(path).read_text(encoding="utf-8"))
    groups = defaultdict(dict)
    for row in rows:
        if row["level"] in groups[row["example_id"]]:
            raise ValueError("Duplicate FollowBench level")
        groups[row["example_id"]][row["level"]] = row
    result = []
    for example_id, levels in sorted(groups.items()):
        if set(levels) != set(range(6)):
            raise ValueError("FollowBench example must contain levels 0–5")
        for level in range(1, 6):
            row = dict(levels[level])
            row["caseId"] = f"FB-ZH-S{example_id:02d}-L{level}"
            row["evolution"] = [levels[i]["instruction"] for i in range(level + 1)]
            result.append(row)
    if not 1 <= limit <= len(result):
        raise ValueError(f"FollowBench limit must be 1..{len(result)}")
    return result[:limit]


def select_eq(docs, count):
    """Pre-register a deterministic category-balanced sample, independent of scores."""
    if not 1 <= count <= len(docs):
        raise ValueError(f"EQ case count must be 1..{len(docs)}")
    buckets = defaultdict(list)
    for doc in docs:
        category = doc.get("category") or doc.get("assistant_relationship") or doc.get("source_type", "unknown")
        buckets[category].append(doc)
    for group in buckets.values():
        group.sort(key=lambda doc: hashlib.sha256(doc["id"].encode()).hexdigest())
    result = []
    while len(result) < count:
        for category in sorted(buckets):
            if buckets[category]:
                result.append(buckets[category].pop(0))
                if len(result) == count:
                    break
    return result


def parse_verdicts(text, level):
    """Never turn malformed judge output into a valid grade."""
    text = text.replace("“", chr(34)).replace("”", chr(34))
    lines = [line.strip() for line in text.strip().splitlines() if line.strip() and line.strip() != "```"]
    try:
        verdicts = ast.literal_eval(lines[-1])
    except (ValueError, SyntaxError, IndexError) as error:
        raise ValueError("Judge did not end with a YES/NO list") from error
    if not isinstance(verdicts, list) or len(verdicts) != level or any(x not in ("YES", "NO") for x in verdicts):
        raise ValueError(f"Expected exactly {level} YES/NO verdicts")
    return verdicts


def follow_summary(results, expected):
    scored = [r for r in results if not r.get("error")]
    by_level = {}
    for level in range(1, 6):
        subset = [r for r in results if r["level"] == level]
        by_level[str(level)] = {
            "total": len(subset), "errors": sum(bool(r.get("error")) for r in subset),
            "HSR": sum(bool(r.get("hardSatisfied")) for r in subset) / len(subset) if subset else None,
            "SSR": sum(r.get("softScore", 0) for r in subset) / len(subset) if subset else None,
        }
    groups = defaultdict(dict)
    for row in results:
        groups[row["example_id"]][row["level"]] = row
    streaks = []
    for levels in groups.values():
        if set(levels) == set(range(1, 6)):
            streak = 0
            for level in range(1, 6):
                if not levels[level].get("hardSatisfied"):
                    break
                streak += 1
            streaks.append(streak)
    return {
        "expected": expected, "attempted": len(results), "scored": len(scored),
        "errors": len(results) - len(scored), "complete": len(results) == expected and len(scored) == expected,
        "HSR": sum(bool(r.get("hardSatisfied")) for r in results) / expected,
        "SSR": sum(r.get("softScore", 0) for r in results) / expected,
        "CSL": sum(streaks) / len(streaks) if streaks else None, "CSLGroups": len(streaks), "byLevel": by_level,
    }


def validate_traits(scores, dimensions):
    if set(scores) != set(dimensions):
        raise ValueError("EQ judge omitted or invented rubric dimensions")
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 10 for value in scores.values()):
        raise ValueError("EQ traits must be finite numbers in [0, 10]")
    return scores


def validate_dialogue_fixtures(data):
    """Validate fixed user scripts before any live requests are scheduled."""
    if not isinstance(data, dict) or data.get("schemaVersion") != 1 or not isinstance(data.get("cases"), list) or not data["cases"]:
        raise ValueError("Expected versioned nonempty dialogue fixtures")
    ids = set()
    for row in data["cases"]:
        case_id = row.get("id", "")
        if not isinstance(case_id, str) or not case_id.startswith("P0-") or not case_id.replace('-', '').isalnum() or case_id in ids:
            raise ValueError("Dialogue IDs must be unique safe P0- identifiers")
        ids.add(case_id)
        if not isinstance(row.get("category"), str) or not row["category"]:
            raise ValueError("Missing dialogue category")
        turns = row.get("userTurns")
        if not isinstance(turns, list) or not 1 <= len(turns) <= 8 or any(not isinstance(t, str) or not t.strip() for t in turns):
            raise ValueError("Expected 1–8 nonempty user turns")
        if not isinstance(row.get("expectations"), str) or not row["expectations"].strip():
            raise ValueError("Missing evaluator-only expectations")
    return data["cases"]


def aggregate_p0_pair(forward, reverse):
    """Map swapped displays back to conditions without choosing a preferred call."""
    if forward.get("error") or reverse.get("error"):
        raise ValueError("Cannot silently aggregate a failed judge call")
    dimensions = ["overinterpretation", "unnecessary_question", "repeated_closing", "premature_resolution", "required_content_or_boundary"]
    f, r = forward["judgment"], reverse["judgment"]
    f_winner = {"left": "control", "right": "patched", "tie": "tie"}[f["winner"]]
    r_winner = {"left": "patched", "right": "control", "tie": "tie"}[r["winner"]]
    result = {"outcome": f_winner if f_winner == r_winner else "discordant", "orderOutcomes": [f_winner, r_winner], "conditions": {}}
    for condition, first_side, second_side in [("control", "left", "right"), ("patched", "right", "left")]:
        result["conditions"][condition] = {}
        for dimension in dimensions:
            first, second = f[first_side][dimension], r[second_side][dimension]
            first_turns, second_turns = {v["turn"] for v in first}, {v["turn"] for v in second}
            first_major = {v["turn"] for v in first if v["severity"] == "major"}
            second_major = {v["turn"] for v in second if v["severity"] == "major"}
            result["conditions"][condition][dimension] = {
                "bothOrders": sorted(first_turns & second_turns), "eitherOrder": sorted(first_turns | second_turns),
                "majorBothOrders": sorted(first_major & second_major), "majorEitherOrder": sorted(first_major | second_major)}
    return result
