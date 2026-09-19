# Data acquisition evaluation

Create an isolated fixture with `node evals/coder/suites/data-acquisition/create-fixture.mjs`, then use its printed path as `EVAL_FIXTURE_REPO` with this suite and a normal xopc experiment configuration. No provider credentials are included.

Compare baseline (data_batch denied), same baseline with independent-call guidance, and candidate (data_batch allowed) using identical model and thinking settings. Run ordinary cases with the main agent as well as code cases with coder. Inspect the normalized trajectory for unnecessary tool calls in no-data-needed and single-document; answer assertions alone do not prove efficient behavior or semantic correctness.

`pnpm exec tsx scripts/bench-data-acquisition.ts` measures local tool latency and evidence retention without a model. Its sequential/parallel/batch times are not end-to-end model speed measurements.

These four cases are a smoke suite. Broader blind assessment, multi-turn/cross-project cases and sufficient repetitions are required before asserting non-regression or a 20–40% speedup. Git-history scenarios require synthetic history after sandbox sanitation; this suite does not pretend the original repository history survives sanitation.
