# Personal dialogue style evaluation

This adapter reuses Coder Evals' `EvalStore`, content-addressed `ArtifactStore`,
`TraceEmitter`, and authenticated realtime input client. Conversation workloads have
no code repository to modify, so a dialogue runner creates isolated production
Personal sessions instead of using the coding runner's Git-clone sandbox. No
production runtime API or prompt is changed.

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
