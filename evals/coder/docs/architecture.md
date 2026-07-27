# Architecture

## Boundaries

Coder Evals owns suites, experiments, execution isolation, traces, graders, artifacts, reports, and the dashboard. Although it lives in the xopc monorepo, agent implementations remain independent and are accessed only through adapters.

An adapter may use a public HTTP API, CLI JSONL stream, or another stable external protocol. It must not import private source modules from the agent under test.

## Reproducibility identity

Every result is identified by:

- Suite id, version, and SHA-256
- Case id and repository commit
- Variant id, adapter, model, reasoning, and configuration
- Agent build or deployment selected by the adapter
- Effective runtime model and hashes of the xopc manifest, prompt configuration,
  tool policy, skill policy, and code-intelligence configuration
- Run id and repetition

Container image digests and dependency lock hashes should be added when container sandboxing is enabled.

## Same-repository isolation

The source checkout contains `evals/coder`, but the agent workspace must not.
The sandbox removes evaluator directories and the original Git history, creates
a fresh repository, and commits setup mutations as the fixture baseline.
Hidden graders execute from the evaluator process and are never copied into the
agent workspace.

## Event model

Adapters emit versioned `TraceEvent` records. The runner rewrites sequence numbers into one monotonic run-level order before persisting them. Large payloads belong in the artifact store; events contain summaries and artifact references.

## Storage

SQLite contains experiment, run, event, score, artifact metadata, and annotations. Artifact content is addressed by SHA-256 and stored outside SQLite so large diffs and command logs do not inflate the database.

## Fair comparisons

Baseline and candidate variants use separate repository clones. Model budgets, repository commits, environment policy, and graders are identical. The xopc adapter creates a fresh public session and binds its `workingDirectory` to that clone before the first turn. CBM or other index caches must be explicitly classified as cold or warm and applied equally to each variant.
