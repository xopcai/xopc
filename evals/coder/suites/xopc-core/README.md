# xopc benchmark v1

`xopc-core@1.0.2` is a frozen ten-scenario benchmark for direct xopc agents. It reuses the existing Coder Evals runner, Git-clone isolation, Gateway/realtime adapter, hidden command graders, SQLite history, content-addressed artifacts and dashboard. It adds same-conversation follow-ups and measured between-turn file deletion without changing production runtime APIs.

This first suite measures bounded research facts, data artifacts, conversational requirement changes and recovery. It does **not** certify asynchronous Personal → Task → worker → delivery workflows, authenticated attachment downloads, live web research or general conversational quality. Keep the existing Personal P0/P1/P2 suites alongside it.

## Scenario contract

| ID | Category | Independent result checks |
| --- | --- | --- |
| R01-price-comparison | Research | Convert per-minute/hour prices, compare 120-minute totals, preserve primary source IDs and date |
| R02-conflicting-source | Research | Reject an explicitly unverified conflicting secondary source |
| R03-missing-evidence | Research | Preserve unknown TTS/total as null and identify the missing component; honest abstention is the correct answer |
| D01-monthly-sales | Data | Four rows, monthly totals, 40% growth, executable reproduction against original and modified input |
| D02-quoted-csv | Data | Quoted comma, escaped quotes, embedded newline, exact cents and modified-input reproduction |
| D03-exact-money | Data | Exact line and invoice integer cents; modified-quantity reproduction |
| C01-add-deliverable | Change | A second input adds row count and a new notes file while retaining prior results |
| C02-replace-scope | Change | A second input replaces all-region scope with east-only totals and growth |
| F01-lost-artifact | Recovery | After the first turn, delete actual nonempty result/report files; request verification in the same conversation and check restored outputs |
| F02-transient-read | Recovery | A local reader actually fails once with exit 75; obtain its receipt with 2–3 reads |

Every case requires `result.json` and a regular `report.md` of at least 80 characters; all original input files must remain unchanged. Research outputs are graded as closed-world structured facts and evidence IDs. Report length is only an artifact completeness proxy, **not** semantic grading. The data graders delete and regenerate outputs and perturb inputs to reject hardcoded reproduction scripts.

Changes occur **between completed turns**, not while a background task is running. F01 recovery is explicitly prompted, not autonomous recovery. F02 simulates a retryable tool/source failure, not an actual provider 502 or Gateway restart. Fault removal refuses absolute paths, traversal, symlinks, missing files, empty files and non-regular files, and records removed byte hashes in the trajectory.

## Run calibration (no model or accounts)

From the repository root:

```sh
pnpm run eval:benchmark:check
pnpm run eval:benchmark
# Optional fresh output directory and repetitions:
pnpm run eval:benchmark --mode calibration --repetitions 3 --output .xopc-evals/core-calibration-3
```

The command uses explicit reference and deliberately broken adapters. A passing calibration requires all ten reference outcomes to pass and all ten broken outcomes to fail. The test suite additionally corrupts one key outcome for each scenario and requires every corruption to fail. Calibration does not simulate the actual Gateway conversation: separate authenticated HTTP/realtime adapter tests verify follow-up order, usage accumulation, failure propagation and actual fault deletion.

**Reference 10/10 is evaluator calibration, never an xopc model score.** The output labels it `harness-calibration`; real model performance remains unmeasured until live execution.

## Run a real model

For a built-in API-key model with existing local credentials, the isolated launcher reuses the existing live-evaluation Gateway bootstrap, creates temporary state and a provisioned coder agent, and cleans up the Gateway afterward. It preflights the model's supported reasoning options and defaults to its initial supported level. Credentials are resolved locally and passed only to the Gateway process; no production conversation history is copied.

```sh
pnpm run eval:benchmark:live --model qwen-token-plan-cn/qwen3.8-flash --repetitions 1
```

For OAuth/custom model registration, use a separately configured isolated Gateway with the direct adapter below.


Start a dedicated Gateway with temporary state, workspace, configuration and a provisioned agent; select a model registered by that Gateway. Keep channels and background work disabled. The Gateway and evaluator must share access to the temporary fixture paths (run on the same machine). Never point this suite at personal production state.

```sh
# XOPC_EVAL_TOKEN must already contain the isolated Gateway's token.
pnpm run eval:benchmark --mode live \
  --base-url http://127.0.0.1:18791 \
  --agent coder --model provider/model --reasoning off \
  --repetitions 3 --output .xopc-evals/core-live-v1
```

One repetition means ten scenario runs and thirteen foreground turns. Each scenario shares a 5-minute, 40-model-request, 300k reported-token budget across its turns. Usage is provider-reported; it is not a hard billing cap. The adapter grades final workspace artifacts only after all turns succeed. Turn failure stops later follow-ups. Model usage accumulates across turns; only the last turn's answer is considered final. Session/endpoint cleanup reuses the existing adapter.

The direct live adapter expects direct execution. An agent that merely delegates asynchronously cannot pass on the submission turn; its final deliverables would still be missing. Supporting final Personal workflow delivery requires a dedicated adapter in a later suite version, not reinterpretation of these scores.

## Evidence and interpretation

Each fresh output directory contains:

- `manifest.json`: evidence class, source commit, source file hashes (including dirty tracked runtime files and benchmark sources), suite hash, fixture commit, model/settings, Node version and drift detection.
- `fixture.bundle`: restorable exact fixture repository (`git clone fixture.bundle restored-fixture`).
- `evals.db`, `artifacts/`, `results.json`: per-run statuses, usage, runtime identity, normalized trajectories, output diffs and hidden-grader logs.
- `summary.json`, `summary.md`: per-variant/category pass counts with expected-run denominators, failure statuses, durations and reported cost/token coverage. Runtime cost values are catalog estimates, not verified provider billing; subscription catalogs may report zero. Actual cost per success remains unknown without billing coverage. Incomplete cost coverage stays null; failed-attempt costs are included when known.
- `error.json` on harness failure: no success summary is produced; partial database evidence remains available.

A failed scenario, harness error or detected source drift exits nonzero. Outputs are never overwritten. Calibration exits zero only when both expected positive and negative controls behave correctly. Preserve the evidence class in downstream comparisons. Do not infer p95, production reliability, false-completion rate or prose quality from ten tasks or a single repetition. False-completion semantics remain unmeasured rather than being inferred from an arbitrary success phrase.

Use the existing tools to inspect and compare experiments:

```sh
pnpm run eval:coder:web --db .xopc-evals/core-live-v1/evals.db
pnpm run eval:coder compare --db .xopc-evals/core-live-v1/evals.db --experiment-id <id>
```

For matched model/config comparisons, use `suite.yaml` through the existing `eval:coder run` experiment interface, with the same fixture commit, budgets and repetitions. Supply `EVAL_FIXTURE_REPO` and `EVAL_FIXTURE_COMMIT` from `node evals/coder/suites/xopc-core/create-fixture.mjs`. Keep judge definitions and reference answers outside evaluated workspaces. Git-clone isolation is not an OS security boundary; tools and network are not sandboxed by this harness.

## Budget calibration history

The initial 1.0.0 live trial used the inherited 100k total-token budget. xopc's approximately 20k-token per-request context, including cached input, exhausted that budget after roughly five responses, often before follow-up scenarios could execute. Version 1.0.1 uniformly raises the budget to 300k per scenario, retaining the original five-minute and 40-request limits and every original grader. Preserve the complete 1.0.0 diagnostic trial separately; do not pool its success rate with 1.0.1 results. An earlier unsupported `off` thinking configuration was rejected before model execution and remains a setup-error trial.

## Regrade preserved outputs

Version 1.0.2 fixes an overly strict R03 citation assertion. Its prompt did not restrict `sourceIds` to directly supporting primary sources, so additional known consulted fixture IDs are valid. The grader still requires `primary-a`, rejects invented source IDs and preserves every numeric/unknown/partial check. The original 1.0.1 verdict and grader logs remain unchanged.

```sh
pnpm run eval:benchmark:regrade \
  --input .xopc-evals/qwen-core-v1-300k/benchmark \
  --output .xopc-evals/qwen-core-v1-regraded
```

Regrading restores the exact input fixture bundle, verifies the saved output-diff hash, applies that diff in an isolated clone and uses the existing hidden graders. It refuses changed prompts, follow-ups, budgets or setup, and never upgrades a timeout, execution error or budget breach. No new model requests are made. Reports use `regraded-live-direct-agent`, retain the source experiment/trajectory and preserve original statuses alongside new verdicts. Use original execution durations from the summary; SQLite timestamps in the regrade database measure grading work, not agent speed. Never combine original and regraded attempts into additional reliability samples.
