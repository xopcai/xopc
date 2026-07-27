# Case authoring

A case is a fixed task contract, not a conversational prompt example. Keep the task user-facing and put pass/fail logic in graders.

Required fields:

- `id`: stable within the Suite
- `repo`: local/Git source and immutable commit
- `task`: instruction shown to the agent
- `budget.timeoutMs`: wall-clock deadline
- `graders`: at least one deterministic assertion
- `tags`: task taxonomy

Optional lifecycle fields:

- `prepare`: dependency/bootstrap commands. They run before fixture seeding and
  must leave tracked and untracked source files clean. Package-manager caches
  may still be reused through ignored directories and their global stores.
- `setup`: trusted commands that seed the regression. Their changes are
  committed as the fixture baseline before the agent starts.

Available graders:

- `command`: passes when a trusted shell command exits with zero
- `unchanged`: passes when protected paths have no tracked diff
- `file_contains`: passes when a file contains expected text

All graders accept:

- `required`: whether failure blocks the run from passing; defaults to `true`
- `weight`: non-negative contribution to the aggregate score; defaults to `1`
- `category`: `correctness`, `regression`, `scope`, `quality`, or `security`

Prefer behavior-level command graders that run hidden tests. Use
`file_contains` only for deterministic smoke cases, not capability claims.

Command graders may declare `hiddenFiles`. Sources are resolved inside the
Suite directory and are copied under the reserved `.xopc-eval-hidden/`
workspace directory only after the agent stops. The entire directory is
removed immediately after verification:

```yaml
- type: command
  command: pnpm exec tsx .xopc-eval-hidden/check.ts
  hiddenFiles:
    - source: hidden/check.ts
      target: .xopc-eval-hidden/check.ts
```

Do not mention hidden test names or commands in `task`. The runner executes graders only after the agent has stopped.
