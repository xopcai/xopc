# xopc Coder Evals

Private monorepo tooling for continuously improving the xopc coder agent. It runs versioned tasks against black-box coding agents, records normalized trajectories, executes deterministic hidden graders, and compares baseline and candidate variants.

The evaluator lives in the xopc repository but stays outside the production runtime. Evaluated workspaces are sanitized before agent execution: `evals/`, local evaluator state, and the original Git history are removed, then setup changes are committed as the fixture baseline.

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

The xopc adapter treats xopc as a black box. For each run it creates a session, binds that session to the run's isolated Git clone through the public agent-config API, calls `POST /api/agent`, and removes the session after trajectory capture. Start an isolated xopc gateway separately, then define a variant:

```yaml
name: xopc comparison
variants:
  - id: xopc-cbm
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
`thinkingLevel`. The legacy `config.thinking` override remains supported. The
adapter then captures xopc's runtime identity—including the effective model and
hashes of the manifest, prompt configuration, tool policy, skill policy, and
code-intelligence configuration—so configuration drift is visible in stored
results. Use separate agent IDs or isolated gateways for broader configuration
comparisons.

## CBM A/B pilot

The included pilot seeds five regressions into fresh xopc clones and compares identical coder profiles with and without managed CBM tools. It does not call a model during setup:

```bash
pnpm run eval:coder:xopc:prepare

# Start xopc in another terminal using the generated private config/state.
XOPC_STATE_DIR="$PWD/.xopc-evals/xopc-cbm-ab/state" \
XOPC_CONFIG_PATH="$PWD/.xopc-evals/xopc-cbm-ab/xopc.json" \
  pnpm run dev -- gateway

# This command performs 10 paid agent runs (5 cases x 2 variants).
XOPC_EVAL_REPO="$PWD" \
XOPC_EVAL_BASE_URL=http://127.0.0.1:4321 \
XOPC_EVAL_TOKEN="$XOPC_GATEWAY_TOKEN" \
  pnpm run eval:coder run \
  --suite evals/coder/suites/xopc-cbm-pilot/suite.yaml \
  --experiment evals/coder/suites/xopc-cbm-pilot/experiment.yaml
```

See [docs/xopc-cbm-ab.md](docs/xopc-cbm-ab.md) for isolation, fairness, and interpretation details.

The same paid pilot can be launched manually from GitHub Actions after adding
protected model configuration and credentials. See
[docs/github-actions.md](docs/github-actions.md).

## Commands

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
- The xopc adapter stores normalized SSE payloads; configure artifact retention before using production conversations.
- The sanitized Git clone hides evaluator sources and history, but it is not a process or security boundary. Use a container or VM for untrusted agents or repositories.

## Development

```bash
pnpm run eval:coder:check
pnpm run eval:coder:smoke
pnpm run eval:coder:xopc:fixture-check --case cbm-binary-precedence
```

The Coder Evals workflow runs the cross-platform control-plane tests on relevant
changes and every Monday. Its deterministic smoke job also executes all five
hidden CBM behavior contracts. Paid model experiments require an explicit
checked manual dispatch.

See [docs/architecture.md](docs/architecture.md) and [docs/case-authoring.md](docs/case-authoring.md).
