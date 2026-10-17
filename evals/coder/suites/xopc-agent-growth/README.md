# xopc agent growth — first six scenarios

`xopc-agent-growth@0.1.0` is the first development slice toward benchmark v2. It is separate from frozen `xopc-core@1.0.2`; it does not replace or pool scores with v1. All six scenarios use exactly v1's 300,000ms, 40 model requests and 300,000 provider-reported total tokens (including cache). Required graders remain deterministic behavior checks plus protected-path checks; failed execution and budget violations cannot pass through artifact checks alone.

| Case | Contract | Hidden checks |
| --- | --- | --- |
| I01-active-dependency | Follow a registry to the active settlement manifest, relative data dependency and contract; ignore archive/sample distractors | Exact net/refund arithmetic, included count and evidence paths; all source files unchanged |
| I02-current-release | Select the deployed release and interpret retry semantics from its contract | Exact milliseconds, additional retries vs total attempts and active evidence paths; older/example inputs unchanged |
| E01-verified-stop | Existing delivery is complete; verify it and finish, adding only the requested execution report | Existing artifact facts and implementation behavior correct; all existing files byte-for-byte unchanged |
| E02-green-incomplete | Public smoke is green but limited export totals violate the documented contract | Full eligible total before limit, zero/invalid limits, cancellation, input immutability; added regression tests reject original code |
| P01-inventory-cache | Repair stale stock across repository/catalog/reservation modules | Primed cache, repeated reserves, no overselling, failure state, independent instances and API compatibility |
| P02-ticket-labels | Add all-label filtering to a multi-module listing API without breaking pagination | Filter before limit, intersection with status, missing/empty labels, invalid types, cursor/default/zero limit and immutable inputs |

P01/P02 use dependency-free multi-module application fixtures, not a full production repository. E01/E02/P01/P02 also require a successful standalone check observed in the evaluator-owned tool trace; written completion claims alone do not pass. Trace snapshots are injected only during grading and removed afterward. New regression coverage must pass on the submitted source and fail against the original implementation in a separate process. The existing smoke test, package metadata and written requirements are protected. Hidden checks use multiple input values and directly exercise exported APIs, rather than relying on the agent's own tests or written claims. `report.md` has the v1 80-character completeness check; this is not prose-semantic grading.

Each case has its own deterministic source commit in one restorable fixture bundle. The sandbox checks out that commit and strips its original history before running the agent. Other scenario trees, reference solutions and hidden graders are absent from the model workspace. Graders are copied in only after execution. Git isolation is not an OS security boundary.

## Run

```sh
# Oracle positive/negative calibration, no model requests:
pnpm run eval:benchmark --suite xopc-agent-growth --mode calibration

# Reuse the existing isolated live Gateway bootstrap:
pnpm run eval:benchmark:live --suite xopc-agent-growth \
  --model qwen-token-plan-cn/qwen3.8-flash --repetitions 1

# Existing Gateway with explicit isolated state:
pnpm run eval:benchmark --suite xopc-agent-growth --mode live \
  --base-url http://127.0.0.1:18791 --model provider/model --reasoning medium

pnpm -C evals/coder run check
```

Live credentials remain local. State, sessions and Gateway are provisioned and cleaned up by the existing bootstrap. The default suite remains xopc-core; all original suite inputs, graders and budgets are unchanged. Both commands refuse to overwrite earlier experiment directories.

Results reuse evals.db, normalized trajectories, content-addressed payloads, fixture.bundle, source hashes and drift detection. The manifest additionally records `fixtureCaseCommits`. Summary cases include descriptive tool diagnostics: explicit read paths, counts by tool, exact repeated successful arguments at an observed stable revision, and explicit read/edit starts after a successful check at the same observed revision. Large trace payloads are recovered from their content-addressed artifacts; unavailable completions make dependent totals null. These are model-visible events, not exhaustive filesystem audits. Exact repeats can be necessary; edits after a check may address genuine requirements. No arbitrary tool order or count is a hidden pass/fail rule. E01 enforces the explicit no-change user contract; timely completion is measured through usage and traces rather than a prescribed tool sequence.

All six scenarios are development cases. None is a holdout after inspection and tuning. A single live repetition is an initial baseline, not a reliability estimate, cross-model ranking, authenticated attachment-delivery score or asynchronous Personal workflow score. Preserve failed attempts and report v1 and growth results separately.
