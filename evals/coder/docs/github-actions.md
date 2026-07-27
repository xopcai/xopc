# Manual paid evaluation with GitHub Actions

The `Coder Evals` workflow can run the full xopc CBM baseline/candidate
experiment on a GitHub-hosted Ubuntu runner. It starts an isolated loopback
Gateway, runs the experiment, evaluates the promotion gate, and uploads the
SQLite database and evidence artifacts.

## One-time GitHub configuration

In repository settings, create an Environment named `coder-evals`. Adding
required reviewers is recommended because every approved run can consume model
credits. Restrict its deployment branches to the protected default branch so a
modified workflow on an arbitrary branch cannot receive evaluation secrets.

Add these environment secrets:

- `XOPC_EVAL_CONFIG_JSON` — a complete xopc JSON configuration containing the
  source coder agent manifest. Copying the local `~/.xopc/xopc.json` is the
  simplest starting point. Remove channels, bindings, Gateway credentials, and
  provider API keys before storing it when they are not needed.
- `XOPC_EVAL_PROVIDER_API_KEY` — the API key used by the selected model. This
  is optional only when authentication is already supplied safely by the
  configuration or runner environment.

The workflow creates a fresh Gateway token for every run. Generated
configuration, Gateway logs, and provider credentials are not uploaded as
artifacts.

## Run the workflow

Open **Actions → Coder Evals → Run workflow**, then:

1. Enable **Run the paid xopc CBM A/B experiment**.
2. Set `source_agent` to the agent id present in
   `XOPC_EVAL_CONFIG_JSON`.
3. Optionally set `model` to an exact `provider/model` reference. Leave it
   blank to use the agent manifest's configured model.
4. Select a reasoning level or keep `configured`.
5. Choose repetitions. One repetition performs ten model sessions: five cases
   times two variants.
6. Set `provider_key_env` to the environment variable expected by the
   provider.

Common mappings:

| Provider | `provider_key_env` |
|---|---|
| OpenAI | `OPENAI_API_KEY` |
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| DashScope | `DASHSCOPE_API_KEY` |

Providers that require several independent secret values should use a
self-hosted runner or a dedicated workflow extension; the generic manual job
maps one protected provider secret to one environment variable.

## Results

The job summary contains the paired comparison. The promotion gate fails the
job when candidate pass rate regresses or execution-failure rate increases
beyond the supplied thresholds.

The uploaded `coder-eval-*` artifact is retained for 14 days and contains:

- `evals.db`
- content-addressed grader and trajectory artifacts
- run, comparison, trend, and gate reports

The database may contain model responses and source diffs. Treat it as private
evaluation evidence.
