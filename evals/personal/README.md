# Personal delivery benchmarks

For Chinese style adherence and eight-turn conversational style profiles, see
[Personal dialogue style evaluation](style/README.md). It integrates FollowBench's
Chinese style subset and a pinned EQ-Bench 4 runner with existing eval storage,
artifacts and realtime input. These scores are separate from delivery invariants.

The first suite protects P0 invariants across submission, completion, result delivery and reply composition. It does not grade general research ability or conversational naturalness.

## Deterministic baseline

```sh
pnpm run eval:personal:p0
pnpm run eval:personal:p0 -- --output .xopc-evals/personal/candidate.json --label candidate
```

The runner executes eight frozen cases in `src/tasks/__tests__/personal-delivery-benchmark.test.ts`, using temporary SQLite state, scripted worker outcomes, and a real authenticated HTTP server for file download and access isolation. It emits a versioned JSON report containing per-case results, durations, the source commit, relevant source hashes, suite hash and lockfile hash. A failing case makes the command exit nonzero. No models or real accounts are used. The cases also run in the ordinary Vitest regression suite.

| Case | Invariant |
| --- | --- |
| D04-defaults | Omitted contract fields retain defaults; uncertain submission retries are idempotent |
| D04-explicit | Explicit outputs, criteria and constraints survive submission |
| B01-partial | Partial research remains partial through delivery and composition |
| B01-failed | A failed outcome is not upgraded by successful run completion |
| S02-reference | A model cannot introduce a host download link |
| S02-fallback | Worker paths do not reappear through fallback or count as published files |
| F02-download | A real report is downloadable through its original authenticated chat, and inaccessible to another chat |
| H03-policy | Concise default has explicit detail exceptions; published artifacts receive a short fallback |

`H03-policy` checks policy and deterministic fallback behavior; it does **not** prove that a live model expresses itself naturally. `F02-download` uses scripted completion and real HTTP delivery; it does **not** claim real specialist execution.

To evaluate an earlier revision, create a disposable checkout, install the same locked dependencies, copy the unchanged benchmark test into that checkout, and pass `--root <checkout> --label pre-p0`. Keep identical suite hashes across comparisons. Only the new test fixture is added to the baseline checkout; its production source remains unchanged. The checked-in reports reproduce pre-P0 `cb13eb3109ba22d0e5670b0774af2b8371221ff7` (2/8) versus the candidate (8/8). Durations are observations, not performance thresholds.

## Real-model workflow verification

```sh
XOPC_ALLOCATION_LIVE=1 \
XOPC_ALLOCATION_REPORT=.xopc-evals/personal/live.json \
node --import tsx scripts/personal-allocation-live-smoke.mts
```

This opt-in smoke uses the configured Personal, Router and worker models with isolated synthetic sales data. It starts a temporary Gateway and follows public inputs through asynchronous allocation, real worker execution, final reply, authenticated history and three actual artifact downloads. It checks known totals (150, 210, 40%), successful script execution, publication of every requested file, foreground responsiveness and lack of duplicate Task/run creation. Existing model credentials are used through their existing credential directory; production conversation history is not copied. Temporary config is removed at shutdown.

The script records file byte hashes, reply length, source hashes at startup, source drift at shutdown, stage timings, usage and composition fallback events. It retains a sanitized synthetic result report, not provider credentials. Review `compositionFallbackEvents` separately from transport success: the files can arrive successfully even when the reply model returns invalid JSON. A short extracted conclusion in fallback remains worker-reported, not independently verified by the Composer.

The live script is a **single-workflow smoke**, with private instrumentation for diagnosis and existing strict smoke latency budgets. It is not the future black-box multi-case adapter and its fixed `data-analyst` expectation is fixture-specific. `conciseReplyProxy` is only a length proxy. The first two implementation trials are retained as exploratory reports; the final candidate uses startup fingerprints and drift detection. Repeated trials with unchanged fingerprints and multiple frozen scenarios are still needed before drawing reliability or p95 conclusions.

## Next suite expansions

The [research plan](../../docs/design/technical/personal-task-delivery-benchmark-research-2026-10-14.md) contains the 40-case inventory. Add deterministic research source snapshots and claim-support graders, multi-turn requirement adoption, bounded repair, semantic faithfulness and calibrated human/LLM interaction grading next. Preserve hard-failure gates independently of style scores. Extend the adapter to wait for final workflow delivery instead of the Personal submission turn's `run_end`.

## P1 evidence and acceptance suite

```sh
pnpm run eval:personal:p1
XOPC_ALLOCATION_LIVE=1 XOPC_RESEARCH_LIVE=1 \
XOPC_ALLOCATION_REPORT=.xopc-evals/personal/live-research.json \
node --import tsx scripts/personal-allocation-live-smoke.mts
```

P1 runs the eight P0 cases plus twelve evidence/acceptance/format cases from `src/tasks/__tests__/task-research-result.test.ts`: real tool provenance, fabricated quotes and URLs, omitted/unexpanded criteria, unsupported and unknown claim references, durable receipt projection, review outages, superseded requirements, unverified fallback checks, prose/legacy JSON equivalence and acceptance-upgrade rejection. Its component reviewer is scripted; the [P1 baseline](baselines/p1-candidate.json) is a 20-case deterministic regression result, not a research model score. Startup and end hashes must match.

The real-model research workflow adds frozen synthetic ASR prices to the sales fixture, checks hourly/minute conversion, undisclosed TTS price handling, provenance and each substantive criterion, and verifies that the concise reply retains key numbers and limitations. It also submits a deliberately wrong 100.00/hour claim against the actual 1.00/hour quote to a real review-model call. That claim must not be supported and its criterion must not pass.

Live research suite v2 separates substantive completion from honest abstention about globally unobservable network absence. Core prices, calculations, evidence and files still have hard assertions. A network-absence claim may be uncertain only with an explicit unverified criterion and a disclosed gap; `acceptanceDisposition` records `completed` versus `honest_partial_network_audit`. This does not certify the absence of all socket activity. Recoverable source-binding errors are recorded rather than automatically failing an otherwise correct research workflow; no errors or trials are silently discarded.

The checked-in [successful live report](baselines/live-research-p1.json) records 12 sources, eight supported claims, ten passing concrete criteria, three authenticated downloads and a rejected wrong-price claim. The Personal reply contained 162 characters and used no composition fallback. Earlier development reports are retained with their failures and original suite versions; they are not a reliability estimate for the final version. A later additive URL-whitelist fix is covered by deterministic validation, not an additional charged model trial.

Program matching confirms that excerpts came from persisted successful tool results. Semantic support and coverage are a separately identified **model review**, not independent expert certification. Text reports and scripts are inspected within a bounded byte budget; unreviewed binary contents cannot prove report correctness. The sample is synthetic, not live vendor pricing or general web-research accuracy.

## P2 bounded repair and real scenario matrix

```sh
pnpm run eval:personal:p2
XOPC_ALLOCATION_LIVE=1 pnpm run eval:personal:live-repair -- \
  --rounds 2 --scenarios web,conflict,file,direction \
  --output-dir .xopc-evals/personal/p2-live
```

The deterministic P2 suite v2 contains 48 cases: P0/P1 plus same-run repair, no-progress stopping, the two-continuation budget, missing publications, requirement adoption checks, unknown external effects, legacy-judge ownership, persisted fetch URL metadata, failed fetch exclusion, bounded review-format correction and preservation of short webpage introductions, acceptance-count consistency, evidence amendments and circular-criterion exclusion. Reviewer/model responses in component cases are scripted. `J01–J03` do not make paid model calls.

The real adapter uses configured Personal/Router/worker/review models and a temporary authenticated Gateway. Every scenario includes actual CSV calculation, executable reproduction, frozen synthetic prices, research submission, original-chat history and byte downloads. The scenarios add:

| Scenario | Required observation |
| --- | --- |
| web | Actual `web_fetch` of MDN HTTP 404 documentation; retained public-source URL, provenance and the limit that 404 alone does not establish permanent removal |
| conflict | Read a deliberately incorrect secondary note and explain its disagreement with the live primary documentation |
| file | Delete only the isolated published `report.md` after review; same TaskRun must automatically repair and publish downloadable final bytes |
| direction | Submit a revised request through the main Personal Chat while execution is in progress; the same Task must deliver the additional `change_notes.md` with its unique marker, record count, months and per-instruction evidence review |

Fault injection does not delete production files or provide scripted worker outputs. Review-format correction happens at most once per audit within its original deadline. Acceptance repair reuses the TaskRun, execution conversation, transcript, grants and deadline; up to two continuations share the existing retry budget. An identical repair fingerprint stops further automatic work. Unknown external effects, unresolved waits and expired deadlines stop repair; successful publication and evidence submission can be repeated specifically for acceptance repair without replaying other completed operations.

Reports are never overwritten. Every round retains source hashes, model selection, failures, downloads, fault events, repair events, reply length and composition fallbacks. `summary.json` counts every attempted round; source drift is a hard failure. Compare unchanged source versions only. Interrupted development batches remain separate from the final frozen baseline. Small-sample percentiles are descriptive observations, not an SLA or a general research reliability claim. The 600-character proxy is recorded independently of correctness and does not prove conversational naturalness.

Sales and prices remain synthetic. The web scenario retrieves a real public documentation page, not live vendor pricing. The direction scenario adds a required deliverable through `personal_task instruct`; it does not certify every form of direct contract revision. File loss is injected before finalization; a later handoff race still degrades delivery honestly if bytes disappear after completion. Semantic verification remains identified as model review.

The current versioned live adapter is `scripts/personal-repair-live-smoke-v2.mts` (suite v6); the original adapter remains frozen for historical comparison. It accepts artifacts published by command outputs as well as `publish_artifacts`, and grades honest abstention about unobservable external-price-source use separately from substantive completion. It never excuses missing price/calculation/report evidence. The auxiliary wrong-price audit clears unrelated instruction checks so it tests only the price claim. Recovery may use a coordinator continuation or within-turn agent republication; either must replace the deleted artifact with authenticated downloadable bytes on the same TaskRun.

During repair, `publish_task_result(mode="amend")` retains earlier source/claim IDs, rechecks all evidence against current requirements, and can retire obsolete claims explicitly. Initial submission creates a ledger; later submissions default to amend. Explicit replace remains available for a complete new ledger. Main-model-generated criteria are no longer accepted through the advertised `personal_task` schema; complete user requirements stay in the brief for background planning, while explicit HTTP/internal contracts remain unchanged. Runtime self-review obligations are not research acceptance criteria.

The expanded adapter records related CSV pre-reading as a separate delegation-strategy metric, rather than treating it as a delivery failure: actual specialist execution, foreground latency, no unrelated main tools/writes, correct data/evidence/files and adopted requirements remain hard gates. The earlier stricter adapter and its failed rounds are retained with their original verdicts. See [validation history](baselines/p2-validation-history.json) for every development, stopped and final trial; never pool different versions into one reliability rate.

## Daily Gateway recovery baseline

The [2026-10-15 verification](../../docs/design/technical/personal-daily-gateway-recovery-2026-10-15.md) records an actual production-state Gateway trial after restart. [The frozen real report](baselines/DAILY-RESEARCH-f5fd39d7.json) passed all six substantive criteria and the changed requirement, restored the deliberately deleted test publication within the same TaskRun, and verified all four authenticated downloads again after delivery. Actual primary-model 502 failures recovered through the already configured backup. The Personal reply was 163 characters and three sentences. No runtime source changed during the trial.

Run with explicit authorization for real model usage and deletion of the tagged test publication:

```sh
XOPC_ALLOCATION_LIVE=1 pnpm exec tsx scripts/personal-daily-gateway-smoke.mts
```

[The recovery component baseline](baselines/p2-recovery-final-frozen.json) has 48 passing scripted cases. Additional SQLite/HTTP recovery regressions verify continuation model fallback without a new user message. Failed and source-drift trials remain separate from the frozen successful trial; one passing daily trial is not a reliability estimate.
