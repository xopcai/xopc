# xopc Coder Evals

Private monorepo tooling for continuously improving the xopc coder agent. It runs versioned tasks against black-box coding agents, records normalized trajectories, executes deterministic hidden graders, and compares baseline and candidate variants.

The evaluator lives in the xopc repository but stays outside the production runtime. Evaluated workspaces are sanitized before agent execution: `evals/`, local evaluator state, and the original Git history are removed, then setup changes are committed as the fixture baseline.

The proposed [benchmark-driven harness evolution plan](../../docs/design/benchmark-driven-harness-evolution-plan.md) defines unified evidence, concurrent validation, a developer dashboard, and the initial execution-convergence and reliable-delivery pilot. The [stage-one implementation ledger](../../docs/design/benchmark-driven-harness-evolution-stage-one.md) records the shipped local control plane and remaining validation; see [control-plane operations](../control/README.md) for imports, concurrent pilots and the dashboard.

## Architecture

```text
Suite / Experiment
        |
     EvalRunner ---- GitCloneSandbox
        |
   AgentAdapter ---- xopc Gateway / mock / future agents
        |
 Trace events + artifacts + deterministic graders
        |
        SQLite ---- CLI / local dashboard
```

The target agent never receives the suite directory or hidden grader definitions. Only the isolated repository clone and task prompt are passed to the adapter.

## xopc benchmark v1

The [ten-scenario xopc-core suite](suites/xopc-core/README.md) reuses this framework for frozen research, data files, requirement changes and recovery. Run `pnpm run eval:benchmark` from the repository root for evaluator calibration, or use its explicit live mode against an isolated Gateway. Calibration results are not model scores. For a built-in API-key model, `pnpm run eval:benchmark:live --model provider/model` automatically starts and cleans up an isolated Gateway, resolves the configured key without writing it to reports, and selects a supported reasoning level.

See the [context and tool overhead investigation](../../docs/design/technical/benchmark-context-overhead-2026-10-17.md) for the unchanged-budget Qwen comparison. The original baseline, candidate results, and unsuccessful development trials are retained separately under `baselines/`.

The follow-up [execution convergence and delivery report](../../docs/design/technical/benchmark-execution-convergence-2026-10-17.md) records the C01/C02 fixes and the complete 10/10 Qwen run with the same suite, budget and graders. It preserves every unsuccessful development revision and the original 8/10 baseline.

## Agent growth scenarios

The [first six agent-growth scenarios](suites/xopc-agent-growth/README.md) add information location, execution convergence and multi-module project changes in a separate `xopc-agent-growth@0.1.0` development suite. It retains v1 budgets and deterministic scoring; v1 remains frozen. Select it with `--suite xopc-agent-growth` on `eval:benchmark` or `eval:benchmark:live`. The original suite is still the default. The [initial Qwen report](../../docs/design/technical/benchmark-agent-growth-2026-10-17.md) records all 18 live attempts, including one scope failure and one budget breach; versioned results are under `baselines/xopc-agent-growth-v0.1.0-*.json`.

## Quick start

Requirements: the same Node.js and pnpm versions as the xopc monorepo.

```bash
pnpm install

# Point the smoke suite at any local Git repository.
EVAL_FIXTURE_REPO=/path/to/git/repository \
  pnpm run eval:coder run \
  --suite evals/coder/suites/smoke/suite.yaml \
  --experiment evals/coder/suites/smoke/experiment.yaml

pnpm run eval:coder:web
```

Open `http://127.0.0.1:4310` for experiment summaries.

## xopc adapter

The xopc adapter treats xopc as a black box. For each run it creates a session, binds that session to the run's isolated Git clone through the public agent-config API, registers a signed endpoint, submits `POST /api/sessions/:sessionKey/inputs`, and captures the `run:<runId>` realtime replay, and removes the session after trajectory capture. Start an isolated xopc gateway separately, then define a variant:

```yaml
name: xopc comparison
variants:
  - id: xopc-default
    adapter: xopc
    agentId: coder
    model: candidate-model
    config:
      baseUrl: http://127.0.0.1:3000
      thinking: high
```

Prefer passing `XOPC_EVAL_TOKEN` through the environment rather than committing it. Run the gateway with a temporary `XOPC_STATE_DIR`, `XOPC_CONFIG_PATH`, and `XOPC_WORKSPACE` when strict isolation is required.

When present, `model` and `reasoning` are applied as session overrides before
the first turn; evaluation `reasoning` maps to xopc's model-effort
`thinkingLevel`. The adapter captures xopc's runtime identity—including the
effective model and hashes of the manifest, prompt configuration, tool policy,
and skill policy—so configuration drift is visible in stored results. Use
separate agent IDs or isolated gateways for broader configuration comparisons.

## Commands

### Manual real-model evaluation in GitHub Actions

`Coder Evals (Live)` is a separate, **manual-only** workflow. The existing Coder
Evals CI continues to run deterministic framework tests without model credentials.

1. Push `.github/workflows/coder-evals-live.yml` and its supporting script to the
   default branch so GitHub exposes its **Run workflow** button.
2. In **Settings → Secrets and variables → Actions**, create the repository secret
   **`CODER_EVAL_API_KEY`** with the model provider's API key. This is not a Gateway
   token or a GitHub personal access token. Do not enter credentials into workflow inputs.
3. Open **Actions → Coder Evals (Live) → Run workflow**. Select the source branch,
   enter a model already registered by that xopc version (`provider/model`), select
   a supported reasoning level, and choose 1–3 repetitions (default: 1).
4. Read the job summary and download `coder-eval-<run-id>-<attempt>` from **Artifacts**.

The key must match the selected provider. This workflow supports single API-key
providers such as `deepseek`, `openai`, `anthropic`, `google`, and `openrouter`.
It uses a fresh state directory and the provider's built-in endpoint; local custom
`models.json`, OAuth/subscription logins, Azure deployments, and cloud credential
bundles are not imported. Skills and background understanding/heartbeat work are
disabled for this coding-core baseline. The checked-out source runs as the Gateway;
no connection to your personal machine or existing Gateway is required.

Each invocation runs all eight coding-core tasks against the real model. One
repetition means 8 task runs; three means 24. Each task has a 5-minute timeout,
40-model-request limit and 100k reported-token budget. Tokens are checked from
reported usage; this is not a hard provider billing cap. The job has a 150-minute
timeout. Model requests incur provider usage charges. Live jobs do not overlap;
GitHub's concurrency queue may replace an older pending invocation.

Any non-passing task makes the evaluation step fail **after** results are saved.
The summary separates `failed`, `error`, `timed_out`, and `budget_exceeded`; a green
job means every run passed its required graders. Artifacts are kept for 14 days:

- `summary.md` and `results.json`: experiment ID and per-task results.
- `manifest.json`: source commit, fixture commit, model, reasoning, repetitions and suite hash.
- `fixture.bundle`: the exact input Git repository, restorable with `git clone fixture.bundle fixture`.
- `evals.db` and `artifacts/`: trajectories, runtime identities, diffs and grader logs.
- `gateway.log` and, on setup failure, `error.txt`: diagnostic output.

Gateway state, credentials, and full workspaces are not uploaded. The script
scrubs the supplied key and generated Gateway token from its diagnostic log and
refuses artifact upload if their literal/JSON-escaped/URL-encoded values remain
in any artifact. Runs execute on an ephemeral hosted runner with host command
execution; the sanitized fixture clone is not a security boundary. Run trusted
source branches only. Cancellation can stop the process before artifact export.

After extracting the artifact into `coder-eval-results/`, inspect it locally:

```bash
pnpm run eval:coder compare --db coder-eval-results/evals.db --experiment-id <id>
pnpm run eval:coder run-show --db coder-eval-results/evals.db --run-id <id>
```

For a local startup-only check, set `CODER_EVAL_MODEL` and a placeholder
`CODER_EVAL_API_KEY`, then run
`node --import tsx evals/coder/scripts/run-github-eval.mjs --preflight-only`.
It starts and authenticates to a temporary Gateway without requesting a model
response. The output directory must not already exist; move previous results
aside before running again.

GitHub references: [manual workflow execution](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow),
[repository secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

### Local evaluator commands

```bash
pnpm run eval:coder run --suite <suite.yaml> --experiment <experiment.yaml>
pnpm run eval:coder list
pnpm run eval:coder show --experiment-id <id>
pnpm run eval:coder run-show --run-id <id>
pnpm run eval:coder compare --experiment-id <id>
pnpm run eval:coder gate --experiment-id <id>
pnpm run eval:coder trend --suite-id <suite>
pnpm run eval:coder reproduce --run-id <id>
pnpm run eval:coder annotate --run-id <id> --category retrieval --note "Relevant symbol was missed"
pnpm run eval:coder:web --db .xopc-evals/evals.db --port 4310
```

Metadata is stored in `.xopc-evals/evals.db`. Large diffs and grader logs are content-addressed under `.xopc-evals/artifacts/`.

The local dashboard includes recent per-variant pass, execution-failure, score,
and duration trends. `trend` exposes the same history in a CI-friendly table.

## Security

- Suite and setup commands are trusted code. Run untrusted repositories in a container or VM.
- The agent workspace never includes suite definitions or hidden grader configuration.
- Tokens are read from the environment and must not be placed in Suite YAML.
- The xopc adapter stores normalized realtime payloads; configure artifact retention before using production conversations.
- The sanitized Git clone hides evaluator sources and history, but it is not a process or security boundary. Use a container or VM for untrusted agents or repositories.

## Development

```bash
pnpm run eval:coder:check
pnpm run eval:coder:smoke
```

The Coder Evals workflow runs the cross-platform control-plane tests on relevant
changes and every Monday. Its deterministic smoke job verifies the evaluator's
runner, xopc adapter, and sandbox behavior.

See [docs/architecture.md](docs/architecture.md) and [docs/case-authoring.md](docs/case-authoring.md).
