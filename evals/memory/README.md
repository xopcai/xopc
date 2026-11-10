# Memory evaluation

Run deterministic storage/policy tests with root Vitest. Real-model runs are opt-in and use synthetic data in temporary databases, with existing provider credentials shared rather than copied.

## Active acquisition and sparse observations

```sh
XOPC_MEMORY_LIVE=1 \
XOPC_MEMORY_LIVE_MODEL=qwen-token-plan-cn/qwen3.8-max \
XOPC_MEMORY_REPORT=reports/memory/acquisition-qwen-max.json \
pnpm run eval:memory:acquisition
```

`acquisition-cases.json` compares cross-session observations disabled/enabled through the actual persistent worker, closing and reopening SQLite between conversations. Three positive patterns and four negative controls check original message provenance, scoped observational authority, persistence and execution-context usability. Additional checks cover a declared invalid-ref fault followed by real-model repair, 26 synthetic legacy-routing receipts, and authorized source learning followed by revocation. There is no production-data backfill or account opt-in in this harness.

This is a small acquisition-component ablation, not a Gateway answer-quality benchmark. Failures remain failures, and relevant source changes during a run invalidate it. See [the design and results note](../../docs/design/technical/memory-acquisition-2026-11-10.md).

## Evidence review and lesson learning

```sh
XOPC_MEMORY_LIVE=1 \
XOPC_MEMORY_LIVE_MODEL=qwen-token-plan-cn/qwen3.8-flash \
XOPC_MEMORY_BENCH_REPEATS=3 \
XOPC_MEMORY_REPORT=reports/memory/work-review-qwen-flash.json \
pnpm run eval:memory:review

pnpm exec tsc -p scripts/tsconfig.memory-live.json
```

Use an actually configured provider/model reference to compare GPT or another Qwen model. The default model is read from the local Agent catalog without loading personal transcripts. Missing credentials fail explicitly.

- `work-review-cases.json`: twelve Chinese/English cases for lost qualifiers, corrected facts, failed verification, correct memory preservation, source attribution, protected explicit records, project isolation, changed sources, and deletion during model execution.
- `lesson-cases.json`: four cases separating verified conditional outcomes from a failed proposed fix or an assistant's unverified success claim.
- The review ablation uses the production planner, review prompt, schemas, admission and SQLite revision functions. The lesson arm uses the production maintainer prompt and semantic parser.
- Answer evaluation freezes the same target memory before review and compares it with the reviewed target. It deliberately excludes other retrieved memories and current chat history. This measures a repair component, not whole-product retrieval or Gateway performance.
- One schema repair is allowed and recorded; cases are not silently rerun until successful. Correct memories may be kept explicitly or left unchanged. A failed verification may become a supported failure fact or be withheld; both rubrics are declared in the dataset.
- A conservative abstention does not count as recovering an available fact. A qualifier-repair case that ends with withheld memory and an unknown answer fails the repair/answer gates.
- Reports retain model output, answers, token usage, reported cost, latency, dataset hash, commit and source fingerprint. Missing custom-provider prices are not a zero-cost bill. A source change, missing case, failed repair, failed reviewed answer, or failed lesson case produces a nonzero exit code.

The final 2026-11-10 comparison and remaining failure are recorded in [the implementation and benchmark note](../../docs/design/technical/memory-evidence-review-2026-11-10.md).

## Existing authenticated Gateway acceptance

```sh
XOPC_MEMORY_LIVE=1 \
XOPC_MEMORY_LIVE_MODEL=qwen-token-plan-cn/qwen3.8-flash \
XOPC_MEMORY_LIVE_CASES=learning \
XOPC_MEMORY_REPORT=reports/memory/memory-learning-qwen.json \
pnpm exec tsx scripts/personal-memory-live-smoke.mts
```

This route uses authenticated HTTP, a signed browser endpoint and the actual persistent learning worker. The harness chooses a supported thinking level from model capabilities. `learning-cases.json` version 5 accepts “title” as a synonym for “heading” in the short-heading case; provenance, observed authority, scope, privacy and replay checks are unchanged.

Raw reports live under ignored `reports/memory/`; no real personal memory is copied into fixtures.
