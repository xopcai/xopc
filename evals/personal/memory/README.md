# Personal memory benchmark

This evaluation-only adapter imports timestamped histories into isolated SQLite transcripts,
uses the checked-out production `runPersistentLearningJob`, and asks a fresh Personal session
through the authenticated Gateway/realtime interface. The adapter preserves the checked-out memory algorithms;
product changes under evaluation must be frozen with their source fingerprint and lockfile.
No existing history, memory, project files or connected-source business data are copied. Shared credentials
and OAuth refresh locks are reused; copied configuration is temporary and removed at shutdown.

```sh
python3 evals/personal/memory/prepare.py --chinese-version 1 --out .xopc-evals/memory-fixtures-v1
python3 -m unittest discover -s evals/personal/memory -p 'test_*.py'
node --import tsx --test evals/personal/memory/scoring.test.mts
pnpm exec tsc -p evals/personal/memory/tsconfig.json
pnpm exec tsx evals/personal/memory/run.mts \
  --fixtures .xopc-evals/memory-fixtures-v1 --out .xopc-evals/memory-baseline-v1 \
  --model xopc-cloud/openai-codex/gpt-5.6-sol \
  --judge xopc-cloud/openai-codex/gpt-6.1-sol
python3 evals/personal/memory/report.py .xopc-evals/memory-baseline-v1
```

`--dry-run` validates and registers selection without model calls. `--suite chinese|longmemeval`
and `--limit N` are protocol pilot controls; pilot cohorts are not merged into the baseline.
Output directories cannot be reused. Failures are retained, not automatically replaced.

## Fixed fixtures and leakage prevention

- LongMemEval cleaned S data is pinned to HF revision and SHA-256 in `prepare.py`.
  The HF dataset card declares MIT. Raw upstream data stays in ignored local state.
  Exclude histories containing sessions later than question time before selection.
  Select 20 questions from each of six types by hashed ID, first reserving up to two
  abstention questions per type. This is a stratified diagnostic, not the official 500-case score.
- Original roles/content/dates remain intact; `has_answer`, gold answers and evidence labels
  are stripped from candidate inputs. Gold exists only in parent fixtures and judge inputs.
- Original source IDs (including upstream `answer_` hints) are mapped to neutral history IDs;
  their reverse map is evaluator-only gold. Visible history/query titles have no category or
  abstention labels. Never infer which session is relevant from its original filename.
- Dates without timezone are interpreted as UTC. Sessions later than question time are
  rejected by selection and still guarded/listed by normalization. This intentional product-time adaptation differs from the
  official full-history protocol. Do not compare its accuracy to published leaderboard results.
- Chinese fixtures are independently authored: 24 worlds × 8 probes = 192. Development,
  validation and final use disjoint world IDs and people/project names per split.
  These remain template variants, not structurally independent acceptance worlds. Only 8 development
  worlds/64 probes enter this first baseline. No held-out fixture is used to pick a candidate.
- Forgetting a derived memory does not delete the original transcript. Chinese probes separate
  unsolicited resurrection from an explicit later request to re-read still-authorized original
  records; do not treat the latter as an automatic privacy violation or silently restore memory.
- Each probe uses an independent database and fresh query transcript. Source facts are
  learned before the question exists. A content-free assistant boundary permits learning
  a history ending in a user turn; no fictional assistant response is generated.
- Source history is imported, not regenerated. Imports use host transcript insertion and
  explicit source-date receipts. This is not a UI typing or natural scheduling latency test.
- The actual host clock is retained for authentication and runtime. Question time is explicit
  user-message context. Current-time eligibility vs historical knowledge is part of the test,
  not patched away by reactivating stale facts.

## Runtime and concurrency

Each case admits one historical session/event and drains every continuation batch before
admitting the next. Chinese updates/forget requests therefore operate on previously persisted
state. Each case processes its persistent learning jobs serially under current policies and default
batch limits. Force-flush provides a completed-state checkpoint, bypassing idle waiting and
daily scheduler throttling; this is disclosed, not a measurement of normal readiness.
The requested candidate model is also explicitly used for extraction. Current write policies,
sensitive policies, processing restrictions and default context budgets are preserved.

Queries deny new memory writes after learning but keep memory reads enabled, avoiding
question/answer contamination. Automatic selection, tool lookup and final answering run
unchanged. Current XOPC only is captured; no-memory, raw-transcript and oracle variants are
future comparison tracks. Synthetic project names test semantic separation, not real project
ACL isolation. Deletion probes test natural forget requests, not a direct UI deletion guarantee.

The supervisor has separate case-admission queues. Protocol v2 independently leases every
physical model HTTP request from shared generation=4 / judge=4 pools, including extraction,
schema repair and tool-internal calls. A streaming response keeps its lease until EOF/cancel.
Different variants share one pool endpoint. No outer turn holds a second generation lease.
Pool overload adaptation remains enabled. `request-protocol.test.mts` exercises actual streaming
concurrency, cleanup and foreign-model blocking. `model-requests.jsonl` and `protocol-audit.json`
reconcile physical calls with successful production usage rows; canceled and failed calls remain.

Before capture, config/defaults are frozen once in a private temporary snapshot. `--config-snapshot`
reuses it across A/B; `--endpoint` reuses their pool. The manifest records only its SHA-256, never
credentials. All model intents use the declared candidate; unexpected model bodies are blocked.
Unrelated autonomous Home/task dispatchers and the learning scheduler are stopped in this
completed-state track. Foreground tools and internal repair remain production code. Resolved
provider weights are not available from routing aliases; requested thinking and actual request
reasoning are separately recorded, not assumed equal. Async handoff is not final QA delivery.

## Results and attribution

`evals.db` reuses EvalStore; cases, artifacts, raw judge output, pool journals, source hashes,
learning receipts, synthetic SQLite databases, realtime events and incremental summaries are
retained. Temporary configs and secrets are never archived. The preserved runtime logs use
production redaction. Unknown billing costs are null; usage rows in each DB retain tokens.

Judge semantic correctness separately from support present in stored memories, injected
selection, and tool results. Every positive support claim must quote exact supplied text.
Attribution is deliberately coarse: learning/admission/update; retrieval/selection/tool choice;
or evidence available but answering failed. No claim that model judgment proves the precise
internal cause. Errors remain errors, and benchmark ambiguities are flagged for review.
Abstention is not permission to refuse answerable questions; all types remain in the denominator.

Inspect `learning.json`, `execution_context_*` audits and tool events before product changes.
Run source fingerprints must match. Valid low scores and schema failures are not retried into
passes. A failed preflight/pilot remains separate from the frozen baseline.


## Native rubric and deterministic revalidation

QA correctness from the upstream rubric and XOPC evidence diagnostics are separate metrics.
The upstream prompt source is pinned to an immutable commit and SHA-256, loaded by AST without
importing the upstream evaluator's dependencies. The requested gpt6.1sol judge differs from its
reference judge; the stratified, time-consistent 120 cases are not an official leaderboard score.

After capture completes, start a grading pool in a separate terminal, then grade saved answers:

```sh
python3 evals/personal/memory/prepare-native.py
python3 evals/personal/style/request_pools.py --out .xopc-evals/memory-native-pools
```

```sh
node --import tsx evals/personal/memory/grade-native.mts \
  --run .xopc-evals/memory-baseline-v1 --fixtures .xopc-evals/memory-fixtures-v1 \
  --out .xopc-evals/memory-native-v1 --endpoint .xopc-evals/memory-native-pools/endpoint.json
python3 evals/personal/memory/report-native.py --run .xopc-evals/memory-baseline-v1 \
  --native .xopc-evals/memory-native-v1 --out .xopc-evals/memory-native-summary --require-complete
```

`--prior DIR` permits a separately declared remaining cohort without rejudging existing IDs.
The combiner rejects duplicates, foreign capture manifests and changed candidate answers.
Reuse a shared endpoint for concurrent graders; do not start independent judge pools concurrently.
Stop the grading pool after its callers finish.

The v3 validator checks decoded, encoded and canonical JSON forms of actual tool `content.text`;
metadata-only quotes cannot count as visible support. Revalidate the same saved judgments with
zero model calls, preserving original records:

```sh
node --import tsx evals/personal/memory/revalidate.mts \
  --run .xopc-evals/memory-baseline-v1 --out .xopc-evals/memory-revalidated-v3
python3 evals/personal/memory/report.py .xopc-evals/memory-baseline-v1 \
  --summary .xopc-evals/memory-revalidated-v3/summary.json --output .xopc-evals/memory-report-v3.md
```

## Service failures and state auditing

`retry-judges.py --run RUN --out NEW_DIR` retries only empty judge outputs with a recorded
transport/service error, at most twice by default. It requires completed capture, accepts the first
valid result regardless of score, and never regenerates candidates or retries valid low grades.
Original errors remain. Run it after other grading pools finish, or pass `--endpoint` to share their
judge pool. Revalidation can import that declared retry artifact with `--judge-retries DIR`.
Use the first successful retry artifact; do not rerun resolved requests into new output directories.
Judge service-error responses are thrown inside their lease so overload can reduce the judge pool.
Production interpretation can hide transport errors behind generic invalid-output failures; its
usage/error receipts must still be inspected rather than treating every extraction error as overload.

`audit-baseline.py --run RUN --fixtures FIXTURES --output FILE` reads completed synthetic SQLite
snapshots. Optional `--summary`, `--native DIR...` and `--judge-retries DIR` include versioned grades
and all evaluation usage. Forgotten-date state checks are separate from QA: an answer refusing to
repeat a date does not prove it was removed. The audit reports active derived date claims and
suppression rows; absence may mean the original write never succeeded. This first replay uses
background historical ingestion and does not execute old foreground tool actions. It cannot prove
that live chat forgetting or UI deletion has the same behavior.

The worker sorts every fixture’s sessions by source timestamp before import, including the
temporal/update cases whose upstream lists may be shuffled. Both original and P0 captures use
this ordering. Results measure chronological historical ingestion, not natural arrival or eventual
background backoff/retry convergence.
Only production internal schema-format correction is retained in the original capture.

## Chinese versions and independent development diagnostics

`prepare.py --chinese-version 1` exactly reproduces the original 64 development fixture bytes.
The default v2 corrects two cross-date today/just-now questions and permits honest reporting when
prior forgetting did not actually complete. It must not be silently mixed with v1 results.

```sh
python3 evals/personal/memory/prepare-addendum.py \
  --baseline-fixtures .xopc-evals/memory-fixtures-v1 --out .xopc-evals/memory-addendum
pnpm exec tsx evals/personal/memory/run.mts --suite chinese \
  --fixtures .xopc-evals/memory-addendum --out .xopc-evals/memory-addendum-run
```

This prepares two clarified project questions and one uncued project-summary forgetting probe.
They are separate development diagnostics, not replacements for original grades or unseen validation.
For future acceptance, author new event structures in addition to changing entity names.

`reproduce-evidence.mts [OUTPUT_JSON]` reproduces the duplicate source-evidence link failure in
a disposable database with single-quote and distinct-source controls, without model calls.
`reproduce-search.mts --db CAPTURE_DB --conversation ID --query QUERY --out NEW_JSON`
works on an isolated copy of a closed/checkpointed capture. Optional `--term`, `--han-term` and
`--whole-token` expose phrase/keyword and Chinese substring differences. Neither changes product data.


## P0 development controls

```sh
python3 evals/personal/memory/prepare-p0-controls.py --out .xopc-evals/memory-p0-controls
pnpm exec tsx evals/personal/memory/run.mts \
  --fixtures .xopc-evals/memory-p0-controls --out .xopc-evals/memory-p0-controls-run \
  --model xopc-cloud/openai-codex/gpt-5.6-sol \
  --judge xopc-cloud/openai-codex/gpt-6.1-sol
```

These four public synthetic controls cover imported forgetting, a live foreground forget request,
an explicit original-record reread, and quoted deletion text that is not a user command. Their
historical IDs retain the original naming for byte reproducibility; they are development regressions,
not unseen validation. The optional fixture `liveTurns` path submits real Gateway/realtime turns,
then forces a completed learning checkpoint, restarts the isolated Gateway/database, and performs
fresh QA with memory writes denied. It does not measure immediate deletion or natural scheduler
latency. It reuses the same generation/judge pools and copies no connected business data.

For a paired product comparison, reuse frozen fixture bytes and selection hash, model refs, semantic
learning policy, Agent defaults and dependency lockfile. Keep a changed-SDK compatibility run
separate. Do not count a connector waiting-for-connection outcome as an LLM transport outage or
silently remove it from the denominator. Unknown usage cost remains null.

The write-enabled reread control is generated separately, with no change to the four original
control bytes:

```sh
python3 evals/personal/memory/prepare-p0-controls.py --write-reread \
  --out .xopc-evals/memory-p0-write-reread-controls
```

It performs both forgetting and source rereading as real foreground turns under ordinary
write policy, drains learning after each, then asks fresh QA under the standard write-denied
protocol. Inspect each `live-control.json` knowledge/suppression receipt and the actual live
answer; unchanged state during write-denied QA alone cannot establish non-restoration in
ordinary chat. This is a public development control, not an unseen acceptance set.

## Protocol-v2 writable P0 episodes and staged comparison

`prepare-episodes.py --out NEW_DIR` freezes eight development worlds and eight validation worlds
with different event structures. They are separate from the original 184 fixtures. Each world has
four checkpoint gates; worlds, not checkpoints, are the independent units. Live turns are writable,
learning is drained after each turn, same-chat ordinary queries follow the authorized read, and
fresh QA follows a Gateway/database restart. `initial-learning.json` is the positive admission
witness. `live-control.json` preserves actual roles/tools/actions and is included in judge evidence.

`score-episodes.mts` runs only in the parent with gold. It checks active facts, retained non-target
facts, successful single-turn reread, and actual model input payloads on ordinary turns. Original
at-rest audit provenance may retain source values; ordinary LLM-visible provenance may not.
A polite final answer cannot erase an earlier input leak. A fact never admitted cannot pass the
forget checkpoint. Quote-only deletion is a separate negative control. Regex-based checks are
synthetic-field diagnostics, with semantic QA judged separately; they are not a general DLP proof.

`run-p0-stages.mts --a BASE_WORKTREE --b CANDIDATE_WORKTREE --episodes NEW_DIR
--fixtures ORIGINAL_184_DIR --out NEW_RUN` requires identical A/B evaluator bytes and lockfiles,
freezes one config, and shares one physical 4+4 endpoint throughout. Development A/B precedes
candidate freeze and B-only independent validation. Only all eight B worlds passing all gates and
QA can unlock full184 A/B and native grading. Failure leaves raw artifacts and stops the expensive
stage. No candidate output is regenerated to improve score. Any analyzed validation failure loses
its unseen status. Source edits during capture invalidate that run.

The episode fixture generator currently defaults to v3. Exploratory v1/v2 runs are retained:
v1 had a broad unnamed-other query, an overbroad gold restriction, and a question-time collision;
v2 named both activities and separated the fields. V3 also changes held-out structures (two
real corrections, repeated single-turn permission, and fenced quoted deletion). The checkpoint
validator v2 normalizes English month dates before both admission/read and disclosure checks.
`revalidate-episodes.mts --run RUN --fixtures FIXTURES --out NEW_DIR` applies that validator to
saved payloads with zero model calls, preserving the original scores. This is a versioned
measurement correction, not a fresh candidate run or a hidden replacement of low grades.

The protocol-v2 runner retries only empty judge transport/service failures, at most twice,
into separate `judge-service-retry-N` folders. It records every attempt and the first valid
selected judgment; valid low grades and all candidate outputs are never resampled. The
revalidator follows this recorded selection. A/B capture fixtures and all final answer bytes
remain unchanged by retries and analysis.

The completed-state host uses `GatewayService({ taskDispatchEnabled:false })`, with the same
lifecycle option applied to both variants. It prevents lazy dispatchers from starting after a
foreground task submission; ordinary product Gateways keep dispatch enabled by default.
Home is disabled only in temporary evaluation config, the learning timer is stopped, and the
default Agent workspace is isolated. Foreground submissions still persist, but queued work is
not final delivery. Any successful task-allocation or Home model call invalidates this track.

The 2026-10-23 v6 holdout stopped at QA 7/8 despite all P0 checkpoints passing. Do not run the
expensive original184 on the strength of checkpoint scores alone. A zero-model query replay
matched the original query hash and showed that the evaluator time prefix plus host timestamp
exhausted the first32 FTS terms before the second event name. Raw grades remain unchanged.
`reproduce-query-selection.mts --run CLOSED_RUN --fixtures FIXTURES --case ID --out NEW_JSON`
compares the stored wire/author query, evaluator wrapper, and plain query on a disposable DB.
Run it from the intended frozen source checkout; network is forbidden and usage must not grow.
The next protocol should keep historical question time visible to the model separately from
retrieval input. The consumed validation worlds are development regressions after diagnosis;
a revised protocol needs newly sealed validation before full184. No runtime alteration was made
after opening this holdout to turn the failed case into a pass.

Protocol v3 separates historical question time at the evaluator's physical model adapter:
`question-context.mts` appends time-only system context without replacing product instructions.
The authenticated Gateway receives only the original question. Retrieval and current-author
permission matching retain ordinary production behavior, including the real host timestamp.
No clock, topK, FTS term limit, source permission or forgetting rule is changed. Saved physical
payloads include the appended context; payload hashes describe bytes actually sent.
`time-separation-audit.json` requires the original authored question (after the normal host
stamp), its matching planner query hash, and time context in every answer-phase model request.
This is evaluator transport metadata; it is not a product memory-retrieval improvement.

`prepare-time-separation.py --consumed V3_EPISODES --out NEW_ROOT` copies all 16 consumed
worlds verbatim into development regression and records archival split provenance in selection.
It seals eight new worlds with different combinations of date/price fields, permissions,
corrections, repeated reads and quoted non-deletion. Historical `split` values inside old case
files do not grant unseen status. Run `run-p0-stages.mts` with the new root; it freezes the
16/8 counts and requires every B QA/checkpoint plus protocol integrity before full184.
Protocol smoke checks use consumed development cases, stay separate from formal scores and
are never pooled into the new validation results.

The protocol-v3 run completed development B at QA16/16 and episode16/16, but the new holdout
was QA8/8 and episode7/8. Full184 was not started. A mixed-source session search exposed an
original price whose first fact admission had been rejected and whose source was absent from
the later forgotten target's evidence lineage. Answer omission does not negate input disclosure.
See [the completed report](../../../docs/design/technical/personal-memory-time-separation-comparison-2026-10-23.md).
These eight newly used validation worlds are now consumed development regressions.
