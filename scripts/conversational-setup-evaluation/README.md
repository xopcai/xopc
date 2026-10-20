# Conversational xopc configuration evaluation

Current implementation and reproduction protocol: [COMPACT_PROTOCOL.md](COMPACT_PROTOCOL.md)
(v5 compact versus full, plus retained rejected v4 development). The four-arm v3 material
below is historical; running it on changed current tools is a new experiment, not a reproduction
of old hashes. V4/v5 source snapshots are preserved with their local artifacts.

Compares baseline guidance, an on-demand manual topic, an on-demand skill and inline
guidance. All three candidates receive the exact same `candidateGuide`; the baseline
uses the current production manual frozen in the output directory. No winner is
preselected. Model failures are infrastructure failures, not evidence for an arm.

## Protocol

- 12 development scenarios, then 8 held-out scenarios for the top two arms, repeated twice.
- Rotate arm order per scenario/repeat; use a fresh child process, SQLite database and
  workspace per sample. No trial is deleted, silently replaced or pooled with another revision.
- Real `runXopcEmbeddedTurn`, `xopc_use`, Agent catalog, AutomationService and persistence.
  The formal v3 comparison uses production `buildSystemPrompt` for Agent `main`, including
  its normal skill-selection rules. It does not test or change the default personal Agent.
- Skill packaging uses actual `skill_view` with an isolated skill index and file; manual
  packaging uses an experimental wrapper around the actual manual tool. The frozen candidate won the formal comparison and is now included in the tool-gated
  production service prompt; this harness still calls the base builder for counterfactual arms.
  No standalone skill or manual topic was shipped.
- Automated assertions inspect saved state, commands, account-independent scope, errors and
  replies. Human review of all failures and paired output is required before shipping.
- Full-case pass rate ranks first, then failed assertions, then median input plus cached
  input tokens. Small samples do not establish statistical significance.
- No external email, voice or browser tools are registered. Those cases evaluate truthful
  handling of missing capabilities, not successful end-to-end Gmail or audio configuration.
- The model's inability to call a nonexistent tool is intentional. A passing partial result
  must not be described in the report as a configured, connected or tested capability.

## Run

Use the configured OpenAI OAuth credential store through xopc. Refresh tokens are never
copied. If a proxy is required, supply the same HTTP(S) proxy environment used by the local
network; the harness imports xopc's proxy setup. Never pass credentials on the command line.

```sh
# Local harness and assertion check, no model calls and no ranking.
node --import tsx scripts/evaluate-conversational-setup.mts \
  --fixture-only --arms baseline --out .xopc-evals/conversational-setup/fixture-v1

# Preview the fixed live comparison manifest.
node --import tsx scripts/evaluate-conversational-setup.mts \
  --dry-run --out .xopc-evals/conversational-setup/development-v1

# Requires explicit authorization for model quota consumption.
XOPC_SETUP_EVAL_LIVE=1 node --import tsx scripts/evaluate-conversational-setup.mts \
  --out .xopc-evals/conversational-setup/development-v1

# Fill ARM_A,ARM_B only after the completed development ranking and manual review.
XOPC_SETUP_EVAL_LIVE=1 node --import tsx scripts/evaluate-conversational-setup.mts \
  --split holdout --arms ARM_A,ARM_B --repeats 2 \
  --out .xopc-evals/conversational-setup/holdout-v1
```

Default model: `openai/gpt-5.5`, low reasoning, maximum 4096 output tokens per request.
`--model` is available for an explicitly authorized model change; there is no automatic
fallback. An unavailable model stops scheduling new jobs; in-flight jobs retain receipts.

For the current account, GPT-5.5 and GPT-5.4 were rejected by ChatGPT OAuth. The user
authorized a supported replacement; `openai/gpt-5.6-sol` completed a real probe and is the
fixed model for the formal comparison. Add `--model openai/gpt-5.6-sol` to the live commands.
Transient connection/time-out failures may be retried once only before any tool execution;
both attempt files are retained. Product mistakes, assertion failures and uncertain writes
are never retried as fresh samples. Earlier exploratory prompt versions remain separate.

Each output directory contains a fixed manifest, baseline manual, individual JSON traces,
state locations, token usage and summary with paired wins/losses/ties. Existing trial files
are retained on resume. Changed manifests require a new directory. Local fixture mode is
explicitly labeled and never used to choose a guidance strategy.

The scenario set tests configuration and product use available today: Agent creation,
identity/model scope, default Agent changes, automation drafts/pause, revision conflicts,
duplicate prevention, voice/settings boundaries, missing Gmail tools and ordinary replies.
Future setup APIs and real external-service success need additional suites when implemented.

## Completed selection and production check

Formal artifacts: `development-main-v3` (48 logical samples) and `holdout-main-v3`
(32 logical samples). Inline won both raw and audited rankings. Audit corrections preserve
raw grades, recognize explicit negation/quoted instructions and validate real settings routes:

```sh
node --import tsx scripts/audit-conversational-setup.mts .xopc-evals/conversational-setup/development-main-v3
node --import tsx scripts/audit-conversational-setup.mts .xopc-evals/conversational-setup/holdout-main-v3
XOPC_SETUP_EVAL_LIVE=1 node --import tsx scripts/verify-conversational-main-gateway.mts \
  --full-tools --model openai/gpt-5.6-sol \
  --out .xopc-evals/conversational-setup/main-gateway-new-run.json
```

The Gateway check uses a real authenticated main conversation and production default tools,
with isolated synthetic data. It does not test the default personal Agent. Current production injection is gated by xopc_use registration across Agents; no tool permissions are widened. Review limitations,
original versus audited grades and source provenance in the final report before interpreting results.


Current Gateway acceptance commands (use fresh output names and the local proxy environment):

```sh
XOPC_SETUP_EVAL_LIVE=1 node --import tsx scripts/verify-conversational-main-gateway.mts --full-tools --out .xopc-evals/conversational-setup/new-main.json
XOPC_SETUP_EVAL_LIVE=1 node --import tsx scripts/verify-conversational-main-gateway.mts --full-tools --agent coder --cases rename --out .xopc-evals/conversational-setup/new-coder.json
XOPC_SETUP_EVAL_LIVE=1 node --import tsx scripts/verify-conversational-main-gateway.mts --agent coder --cases rename --no-manual --out .xopc-evals/conversational-setup/new-coder-no-manual.json
```

Language regexes can conservatively flag conditional future statements. Preserve failed receipts
and use a separate hash-bound semantic review; never overwrite a product-state assertion or replay
an uncertain write merely to obtain a different answer. Startup metadata changes are excluded by
taking scope snapshots immediately before the model input, after the Gateway has initialized.
