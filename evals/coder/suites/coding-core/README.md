# Coding core v1

Eight independent repair tasks cover pagination, CSV parsing, TTL boundaries, bounded concurrency, path traversal, cancellation, multi-file money calculation and transactional rollback. Each has hidden behavioral assertions, an unchanged existing test, and protected configuration/instructions. No dependency installation or network is needed inside a fixture.

`pnpm -C evals/coder test` calibrates all eight: the original code must fail its hidden check while preserving public behavior; the reference repair must pass every grader. Reference repairs and hidden checks never enter the agent's repository. These are small regression tasks, not evidence of parity with commercial products or a representative production success rate.

For an actual model run:

1. Run `node evals/coder/suites/coding-core/create-fixture.mjs`. Set `EVAL_FIXTURE_REPO` and `EVAL_FIXTURE_COMMIT` to the returned path and immutable commit.
2. Set `XOPC_EVAL_BASE_URL` to the gateway being measured, `XOPC_EVAL_MODEL` to a fixed provider/model, and `XOPC_EVAL_TOKEN` if required. Use a gateway on the same host with access to the temporary workspaces.
3. Run `pnpm eval:coder run --suite evals/coder/suites/coding-core/suite.yaml --experiment evals/coder/suites/coding-core/experiment.yaml` (see CLI help for output options).
4. Compare experiments with identical fixture commits, models, reasoning levels, budgets and repetition counts. Keep gateway source revision and runtime identity in each run's artifacts. Report success rate, required-grader failure, timeout/budget failure, requests, token cost and duration separately.

The example experiment repeats one candidate three times. To compare harnesses, run fixed revisions on separate gateway URLs and declare two variants with identical model/budget settings. Do not treat the deterministic reference adapter as a model baseline. Remove the generated fixture repository when done.
