# xopc CBM A/B pilot

## Goal

Measure whether managed codebase-memory-mcp improves xopc coder outcomes under the same model, prompt profile, repository commit, task, budget, and graders.

The pilot contains five seeded regressions:

1. CBM binary override precedence
2. Trace direction parameter forwarding
3. Change-impact count normalization
4. Per-agent code-intelligence tool gating
5. Agent invalidation after session workspace rebinding

Each run receives a separate detached Git clone. Dependency preparation reuses
the local pnpm content store in offline mode, then setup injects the regression
before the agent starts. The task does not reveal the grader command or exact
source location. Behavior tests are copied into the clone only after the agent
has stopped and are removed after verification.

## Prepare xopc

Run from the xopc repository:

```bash
pnpm run eval:coder:xopc:prepare \
  --source ~/.xopc/xopc.json \
  --source-agent coder \
  --port 4321
```

The command creates:

- `.xopc-evals/xopc-cbm-ab/xopc.json`, mode `0600`
- `.xopc-evals/xopc-cbm-ab/state/agents/eval-coder-baseline/profile/`
- `.xopc-evals/xopc-cbm-ab/state/agents/eval-coder-cbm/profile/`

Both manifests are cloned from the same source agent. Their profile Markdown is copied from the same directory. Only `eval-coder-cbm` is included in `codeIntelligence.agentIds`. Channels and bindings are disabled, the Gateway is forced to loopback, and the source Gateway auth/provider configuration is retained in the private generated config.

Review the generated file before starting the Gateway. It may contain the same provider credentials as the source config; it is gitignored and permission-restricted, but remains sensitive local data.

## Start the isolated Gateway

From the xopc repository:

```bash
XOPC_STATE_DIR="$PWD/.xopc-evals/xopc-cbm-ab/state" \
XOPC_CONFIG_PATH="$PWD/.xopc-evals/xopc-cbm-ab/xopc.json" \
  pnpm run dev -- gateway
```

Pass the generated Gateway token as `XOPC_EVAL_TOKEN` if token auth is enabled. The evaluator never reads xopc internals; it uses these public endpoints:

1. `POST /api/sessions`
2. `PATCH /api/sessions/:key/agent-config`
3. `GET /api/eval/runtime-identity`
4. `POST /api/agent` (SSE)
5. `POST /api/agent/abort` when a budget is exceeded
6. `DELETE /api/sessions/:key`

The session patch binds xopc tools and CBM indexing to the evaluator's clone rather than the manifest's default workspace. If a variant declares `model` or `reasoning`, the same request applies those overrides before the run. Runtime identity hashes are stored with the result so comparisons can detect accidental configuration drift.

## Run the pilot

```bash
XOPC_EVAL_REPO=/absolute/path/to/xopc \
XOPC_EVAL_BASE_URL=http://127.0.0.1:4321 \
XOPC_EVAL_TOKEN='<gateway-token>' \
  pnpm run eval:coder run \
  --suite evals/coder/suites/xopc-cbm-pilot/suite.yaml \
  --experiment evals/coder/suites/xopc-cbm-pilot/experiment.yaml
```

This performs ten model runs and may incur provider cost. The command is intentionally never invoked by `pnpm test` or `pnpm run check`.

Compare the result:

```bash
pnpm run eval:coder compare --experiment-id <experiment-id>
pnpm run eval:coder gate --experiment-id <experiment-id>
pnpm run eval:coder trend --suite-id xopc-cbm-pilot
pnpm run eval:coder:web
```

`gate` exits non-zero if the candidate pass rate regresses or its execution-failure rate increases. Use `--max-pass-regression` and `--max-failure-rate-increase` (rates from `0` to `1`) only when a reviewed policy intentionally allows tolerance.

## Interpretation

Version 1 is a cold-index test. Each candidate run indexes a fresh clone, so duration includes CBM startup and indexing. Compare both correctness and duration; do not interpret a score improvement as a latency improvement.

Run at least three repetitions before making a product decision. A useful promotion gate is:

- Candidate pass rate is not lower than baseline.
- Candidate mean score improves on discovery/call-graph cases.
- Candidate timeout and error rate do not increase materially.
- Review trajectories to confirm the gain comes from grounded retrieval rather than grader gaming.

Variant order is deterministically randomized by default. Warm-cache evaluation is not implemented yet, so do not treat small score differences as statistically meaningful.
