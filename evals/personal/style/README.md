# Personal dialogue style evaluation

This adapter reuses Coder Evals' `EvalStore`, content-addressed `ArtifactStore`,
`TraceEmitter`, and authenticated realtime input client. Conversation workloads have
no code repository to modify, so a dialogue runner creates isolated production
Personal sessions instead of using the coding runner's Git-clone sandbox. The adapter
does not mutate production runtime APIs or prompts at execution time.

## Prepare and run

```sh
pnpm run eval:personal:style:prepare
pnpm run eval:personal:style:check
pnpm run eval:personal:style --dry-run --out .xopc-evals/personal-style/preview
pnpm run eval:personal:style --out .xopc-evals/personal-style/baseline
# Full EQ dataset, one repetition per scenario:
pnpm run eval:personal:style --eq-cases 120 --out .xopc-evals/personal-style/eq-full
```

To freeze a checkout that other chats are editing, run
`node evals/personal/style/snapshot.mjs NEW_DIRECTORY`. This copies tracked and
non-ignored local sources into a separate Git snapshot and installs the locked
dependencies offline with lifecycle scripts disabled. Run the same entry point
from that directory with absolute `--upstream` and `--out` paths. The manifest
records the original dirty checkout identity and the independent snapshot hash.
It never commits or resets the original checkout.

The first requested GPT baseline uses these explicit overrides:

```sh
pnpm run eval:personal:style \
  --model xopc-cloud/openai-codex/gpt-5.6-sol \
  --judge xopc-cloud/openai-codex/gpt-6.1-sol \
  --persona xopc-cloud/openai-codex/gpt-6.1-sol \
  --out .xopc-evals/personal-style/gpt56-gpt61
```

Live mode spends configured model quota; the user must authorize running a real
baseline. There is no automatic model fallback. Default candidate selection is the
existing Personal session model, then the configured fast intent, then chat default.
Judge and simulated user default to review and reasoning intents. Explicit `--model`,
`--judge`, and `--persona` override these. `--concurrency` defaults to 2 (maximum 4).
Use `--fresh-profile` for comparisons against a fresh-default baseline; otherwise an
existing Personal profile is copied when available. Check `personalProfile` and the
saved runtime profile before interpreting any comparison.
Every invocation refuses existing output directories; development probes remain
separate from the frozen baseline. Preparation requires Git, uv and network access;
Python dependencies come from the pinned EQ upstream lockfile, outside pnpm/runtime.

The two upstream Git commits are fixed in `upstreams.json`. Preparation and execution
reject modified tracked upstream files. FollowBench is Apache-2.0. EQ-Bench 4 is
source-available under BSD-3-Clause **with Commons Clause**, rather than unrestricted
open source. Upstream sources and datasets are downloaded to ignored local state;
they are not vendored or distributed with xopc. Check upstream license terms for
uses beyond internal evaluation.

## Frozen protocol

- FollowBench: all 150 Chinese `style` items (30 groups × levels 1–5). Level 0 supplies
  evaluator context but is not a scored task, matching upstream. Each item starts a
  fresh Personal conversation; evolution instructions and judgments stay evaluator-side.
- The Chinese upstream `style_evaluation_prompt` function is loaded unchanged using
  Python AST, avoiding unrelated plotting dependencies. Its source commit is pinned.
  Judge output is parsed with `ast.literal_eval`, never `eval`; malformed, missing,
  extra or uncertain verdicts are explicit errors. Smart quotation marks are normalized.
- HSR: fraction satisfying every constraint. SSR: mean per-item constraint satisfaction.
  CSL: mean consecutive fully satisfied levels starting at level 1, over complete
  five-level groups. Failed calls remain in the denominator, with errors separately
  reported. An incomplete/error run is not labeled a complete baseline.
- EQ-Bench 4: default 12/120 scenarios, selected before inference by relationship/category round-robin
  and SHA-256(id) order within categories. `selection.json` fixes exact IDs. Use 120 for
  the complete dataset. The unchanged upstream `run_conversation` handles eight turns,
  hidden persona monologue, response parsing, and pointwise judging.
- Candidate replies go through real production Personal prompt/tool factories and
  authenticated HTTP/realtime input. EQ's public evaluated-system context is supplied
  as a labeled user prefix each turn so the production Personal system prompt remains
  authoritative. The hidden persona card, inner thoughts, and judge rubric are never
  sent to Personal. This is a **product-adapted protocol**, not the official model-only
  protocol. Default Personal language/preferences remain unchanged, including on EQ.
- EQ pointwise traits are neutral 0–10 tendencies (including naturalness). They are not
  averaged into a quality score, assigned a pass threshold, or substituted for the
  official blind pairwise ability ranking/Bradley–Terry leaderboard. Single-model
  baseline reports contain a trait profile only. The sample cannot establish user
  satisfaction or Chinese conversational quality. One judge and one simulator can
  share biases and possibly the same routed backend as the candidate.
- One repetition, no result-based retries or replacement of failures. Upstream persona
  format correction attempts are retained in the call ledger and result traces.
  Individual requests time out at 240 seconds; each case has a 30-minute / 48 bridge
  request budget. Production auxiliary requests are not represented as bridge requests.

## Isolation and provenance

A temporary Gateway/database/workspace is provisioned with production Personal
creation. Existing catalog defaults and, when present, the Personal profile are read
without changing them. Existing history, user memory, skills, connectors and channels
are not copied. The OAuth credential directory and refresh lock are shared, never
cloned. The synthetic state/config is removed on shutdown. Ordinary default Personal
capabilities remain available in this isolated environment; tool calls are captured.

An initial isolated preflight checks candidate, judge and persona availability; it is
excluded from both benchmark scores. `manifest.json` stores configured models, pins,
lock/source fingerprint, dirty checkout state and protocol deviations. A final source
fingerprint rejects comparisons if production/evaluator source changes mid-run.
Runtime identities and all candidate realtime events, judge/simulator inputs, responses,
usage, errors and per-turn synthetic transcripts are retained. Cloud route aliases are
recorded as aliases; they do not establish a pinned underlying model version. Unknown
billing costs are `null`, never inferred as free from zero catalog pricing.

## Results and existing dashboard

Each run writes `evals.db`, `artifacts/`, `cases/`, immutable selection, incremental
`follow-summary.json` / `eq-summary.json`, and final `summary.json` / `completion.json`.
The existing eval CLI can read this database:

```sh
pnpm run eval:coder list --db .xopc-evals/personal-style/baseline/evals.db
pnpm run eval:coder show --db .xopc-evals/personal-style/baseline/evals.db --experiment-id ID
pnpm run eval:coder run-show --db .xopc-evals/personal-style/baseline/evals.db --run-id ID
```

FollowBench writes `external_model_judge` grade records. EQ stores pointwise profiles
as artifacts with `completed` capture status and no quality grades. The generic coder
CLI's scalar score/pass-rate columns do not represent EQ quality; use `eq-summary.json`.
The code-specific `reproduce` command does not support this dialogue adapter: rerun with
this entry point and a fresh output directory instead.

## Focused P0 dialogue regression

`p0-dialogues.json` contains 30 fixed Chinese scripts: eight each for overinterpretation,
unnecessary clarification and repeated closing, plus six controls for necessary
authorization clarification, full-detail delivery and grounded disagreement. Expectations
remain evaluator-side. These are diagnostic regression cases authored from the failure
analysis, not an independent holdout or a representative user-distribution benchmark.

Capture each condition from its frozen checkout with the same harness:

```sh
pnpm run eval:personal:style --fresh-profile \
  --dialogue-fixtures /absolute/path/to/p0-dialogues.json \
  --model xopc-cloud/openai-codex/gpt-5.6-sol \
  --judge xopc-cloud/openai-codex/gpt-6.1-sol \
  --persona xopc-cloud/openai-codex/gpt-6.1-sol \
  --out /absolute/path/to/new-capture
```

This flag captures only the fixed scripts; it does not also run FollowBench or EQ.
Each script gets an isolated fresh conversation and generated assistant history. Fixed
user continuations do not establish how a real or adaptive simulated user would react.
Captures reuse the existing trace/database/artifact stores, without assigning quality
grades before separate judging. One repetition; no score-based replacement of cases.

`compare-p0.mts` accepts complete frozen captures with matching model, profile and fixture
identity. It judges both presentation orders with GPT-6.1 Sol, hides condition identity,
and validates each claimed violation against an exact quote and assistant turn number.

```sh
pnpm exec tsx evals/personal/style/compare-p0.mts \
  --left /absolute/path/to/control --right /absolute/path/to/patched \
  --fixtures /absolute/path/to/p0-dialogues.json --kind scripted \
  --out /absolute/path/to/new-judgments
```

Use `--kind eq` for the same selected EQ scenes or `--kind follow` for the audited
S11-L5 clarification case, with the corresponding full benchmark run directories.
The custom rubric is separate from official upstream scoring. It measures unsupported
interpretation, unnecessary questions, repeated closing, premature resolution, and
content/boundary regressions. Both orders, raw judgments, exact inputs, usage and source
hashes are retained. Swapped-order judgments are correlated calls from one model, not
independent judges. Disagreement is retained; no discretionary tiebreak calls are made.
The planned diagnostic gate and limitations are in `p0-comparison-plan.json`.

The first P0 variant failed its diagnostic gate and is retained separately. The refined
variant uses new fixed scripts in `p0-validation-dialogues.json`, with the changed plan
and the original negative finding disclosed in `p0-refinement-plan.json`. The old scripts
are development data; they must not be relabeled as held-out validation. No partial
benchmark results from the first variant are spliced into the refined full run.

`report-p0.py` aggregates both-order evidence and outcomes, retaining discordance and
the original source manifests. `recover-follow.mts` can make one supplemental official
judge call for answers that were captured but lack a valid grade after a service error.
It reuses the exact saved prompt, does not regenerate candidates, and never overwrites
the original failure. Report original and supplemented summaries separately.

If an EQ candidate call fails before a complete conversation/score exists, retain
the partial capture and record a transport-recovery plan before retrying. Use
`--fresh-profile --eq-case-id EXACT_SCENARIO_ID --out NEW_DIRECTORY` for one separately
retained full-scene retry with the same frozen production source and model parameters.
This runs zero FollowBench cases. Do not use this to replace an already scored scene.
`compare-p0.mts --kind eq --right-supplement RECOVERY_DIRECTORY` accepts only failed
slots, checks matching model/profile/pins and frozen-source ancestry, and records both
the original error source and the supplemental capture. Raw and supplemented cohort
sizes/means must be reported separately. `report-p0.py --eq-recovery RECOVERY_DIRECTORY`
performs that aggregation without altering either capture. A restarted scene has newly
generated history, so disclose the restart rather than implying an identical-prefix resume.

### EQ residual refinement

`eq-refinement-plan.json` freezes the comparison against the previous P0 condition.
`eq-refinement-dialogues.json` contains residual-inspired development regressions;
these are not unseen representative validation data. Run both sources with fresh
profiles and identical fixtures, then use `compare-p0.mts --style-focus` to add
concrete didactic-expression evidence and a separate naturalness preference.
Both versions are rejudged under the same extended rubric. Do not combine counts
from this rubric with older judgments as though they were identical measurements.

`--left-supplement` works like `--right-supplement` for a retained transport recovery
on the older condition. Both require source lineage, identical profile/model/pins,
and an originally failed slot. Existing scored conversations cannot be replaced.

`python3 evals/personal/style/report-eq-refinement.py` builds the retained round's
JSON and Markdown comparison from frozen captures and complete dual-order judgments.
It preserves order disagreement, union sensitivity, exact evidence, raw source
completions, neutral EQ traits, and FollowBench regressions.

When the shared checkout changes during development, freeze from the previous control
source and overlay only the intended patch. Audit every `src/` byte and verify the
actual default profile before final capture; do not attribute a concurrent profile
or tool change to the style candidate. Preserve and exclude confounded captures.
The retained isolated round has 12 final-source EQ scenes plus a creative control;
the earlier v2 150-case Follow run is explicitly adjacent-source evidence.

For a failed blind-judge call, retain the original folder and use `--recover-call
/absolute/path/to/CASE.forward.json` with the identical comparison arguments and
a new output directory. The command accepts only an original error with identical
rubric, judge, and exact payload, and makes one supplemental call. Do not use it
for a valid low score or display-order disagreement. The report retains both
original error and supplemental evidence instead of overwriting the failed call.

### Focused style round 2

`eq-style-round2-plan.json` and `eq-style-round2-dialogues.json` freeze the next
comparison before model calls. The control is the previous final isolated EQ
candidate, not the earlier P0 condition. The new source runs all150 FollowBench
and the same12 EQ scenes without changing source between suites.

Use `--style-focus --tone-scale` with `compare-p0.mts` to retain the six violation
dimensions and add anchored0–4 motive-menu, relationship-generalization and
coaching-register ratings. Each positive score requires a validated exact quote;
a zero requires null turn and an empty quote. Scores describe tone, separately
from task failures and naturalness/overall preference. Both versions are rejudged
under the identical extended rubric, and both display orders are retained.

`python3 evals/personal/style/report-style-round2.py` produces the complete retained
round's JSON and Markdown report. FollowBench comparisons use the historical full
P0 run because the previous final EQ candidate has no complete150-case capture.
The report keeps this distinction, per-order scores and evidence, recovery records,
exposure denominators, and each predeclared gate.

### Focused style round 3: ablation before final regression

`eq-style-round3-variants.json` fixes the facts-only, style-only and combined rule
modules and their selection order. All variants retain the same examples and the
same other production sources. `eq-style-round3-development.json` supplies eight
development scripts; `eq-style-round3-validation.json` supplies eight separately
frozen scripts that must not be used to choose or substitute a candidate.

Capture control and all three variants with fresh profiles, concurrency 1 and the
development fixtures. Compare each variant against the same control with both
`--style-focus --tone-scale`. `select-style-round3.py` writes an immutable selection
from the retained `style-round3-comparison-v1/judgments-dev-*` folders. It prioritizes
content errors before coaching intensity and closure/naturalness preferences.
Do not rerun valid low scores or use the final validation to change that selection.

After selecting, run the unchanged source through all 150 FollowBench cases and the
same 12 EQ scenes, and separately capture both sources on the validation fixtures.
The final full-run control is round 2, which now has all 150 FollowBench cases;
this is a direct full-cohort comparison rather than the earlier historical proxy.
`report-style-round3.py` aggregates the ablation choice, validation, full FollowBench,
EQ blind judgments, raw evidence, order disagreement and preregistered failed gates.
`style_analysis.py` shares the dual-order aggregation and preserves protocol-recovery
records. Scripted blind context honors the supplied language and role, including
English roleplay fixtures. An initially malformed ID run is retained separately;
only correctly validated fixtures can schedule candidate requests.

### Focused style round 4: implied evidence and conversational state

`eq-style-round4-plan.json` fixes two experimental modules: evidence/interpretation
and current-request/closure behavior. Each module changes one rule and two relevant
examples. Run control, facts-only, style-only and combined sources on the ten frozen
development scripts, then use the immutable `select-style-round4.py` ranking.
Content and overinterpretation take priority over coaching and preference scores.
The eight independent validation scripts run only after selection, and complete
before the unchanged selected source starts the full 150 FollowBench and 12 EQ run.
Do not substitute another candidate after validation or full-run results.

`compare-p0.mts --style-focus --tone-scale --evidence-focus` adds a registered
clarification for misleading implications of private testimony or sources. It does
not change the anchored tone scale. General privacy policies and clearly hypothetical
statements are not automatically violations. Rejudge both conditions under this
same clarification; do not splice counts from earlier rubric batches. The flag and
full rubric are recorded in each comparison registration and checked on recovery.

`report-style-round4.py` preserves the development selection, independent validation,
full comparisons, raw and supplemented Follow scores on both conditions, exact
source hashes and evidence, and all failed gates. The control is the previous round3
final source, whose two retained original-answer judge recoveries remain part of its
valid full cohort. S06-L5 and S11-L5 separately protect actual creative delivery and
requested style. All captured answers and initial protocol/service failures remain
available; one identical-input supplementary judge call is allowed for a failure,
never for an unfavorable grade or display-order disagreement.

Round4 retained a methodology correction before full capture. The first blind batch
omitted candidate-visible inbound date envelopes and penalized a correctly resolved
Friday date. Keep that whole `style-round4-comparison-v1` batch for diagnosis; the
primary batch is `style-round4-comparison-v2`, reusing the exact candidate answers.
Use `--runtime-context` to extract timestamp envelopes from retained user-message
trace receipts, validate one per assistant reply, and swap their side mapping with
the displayed histories. No hidden persona or internal thought is supplied. Rejudge
all development conditions under this same public context, then independently
validate before the full run. Do not pool the original and corrected score batches.

### Round5: retain the baseline and gate the expensive regression

`eq-style-round5-plan.json` freezes an append-only ablation against the round3 final
source. All six baseline rules and its complete examples remain verbatim. The facts
module handles source challenges and correction; the closure module uses settled
conversation decisions without reopening them. Their combination is a third candidate.
Twelve development scripts select exactly one candidate; ten independent scripts cannot
change it. `round5_gates.py` requires no new major failure, preserved positive guards,
nonincreasing target defects, nonnegative stable overall/naturalness preference, and
positive improvement evidence. If validation fails, no full regression starts. A fresh
round3 control is used under the same new scheduling if full regression is authorized
by that gate; the historical113/150 is a separate reference.

`request_pools.py` coordinates all processes through authenticated loopback leases:
generation4 (candidate and simulated-user requests), judge4 (Follow, pointwise, blind),
and EQ scene3. Follow generation and grading use separate executors and grade as soon
as an answer exists; Follow and EQ can overlap. A single EQ scene advances sequentially.
Blind display orders are independent jobs, using `compare-p0.mts --concurrency 4`. Limit targets halve on transport
failures such as overload, with floor1; the initial and actual targets are retained.

All original failed request inputs/errors are saved. Evaluator transport requests may
retry once with the same input; a candidate transport failure may restart only that
unscored case in a new session, retaining the first capture and its SHA-256. Such results
carry `captureCaseId`, which the blind reader uses to select the actual timestamp
receipts. Valid low scores and order disagreements are never retried. A restarted
multi-turn case has a new trajectory and must be reported separately. Before inference,
`test_request_pools.py` exercises pool independence, adaptive limits, early grading,
fresh retry state and non-retry of valid failures; `tsconfig.check.json` checks the
TypeScript evaluator. Model calls retain the specified GPT-5.6 Sol candidate and
GPT-6.1 Sol judge/simulated user. A fixed6Follow+1EQ control-only pilot is excluded from
all quality aggregates.
