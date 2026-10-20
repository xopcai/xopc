# Compact versus full configuration guidance (v5)

Frozen before the first live comparison. Model: openai/gpt-5.6-sol, low thinking,
4096 output tokens/request, 10 request budget, 150 second turn deadline. No model fallback.
All main and coder data are isolated synthetic fixtures. Credentials use the existing shared
store/refresh lock; no everyday product data is modified.

## Arms and isolation

- full: exactly the original candidateGuide embedded in production buildSystemPrompt.
- compact: compactGuide v5, with conditional focused-manual routing, safe profile primitive and core scope/verification rules. V4 mandatory topic loading was rejected after 24 development samples: same reviewed quality but 4.39% more cumulative input. All v4 traces and source snapshots are retained.
- Both arms use the SAME production tool schemas, descriptions, focused manuals, settings
  validation and additive atomic patch_profile capability. This measures prompt delivery
  under identical backend conditions. Full is not the unchanged historical v3 deployment:
  the shared manuals and constraints have been improved. V3 results remain historical evidence.
- The production service builder is not used in the paired worker, to avoid adding the shipping
  guide on top of a counterfactual. Real Gateway acceptance subsequently validates that builder.
- No Gmail, audio or storage-write tools are registered in the paired test. Successful partial
  results are not claims of audio/mail integration success.

## Fixed sample plan and selection

- Main D01-D12: one paired run (24 samples).
- Main H01-H08: two paired runs (32 samples).
- Coder S01-S04: one paired run (8 samples): own name, own model, explicitly authorized
  cross-Agent name, rejected cross-Agent write. A real authorization callback rejects the
  last case; no invented prompt-only denial. Additional unit tests cover denied/absent tools.
- These H cases were previously used in v3. They are frozen regression paraphrases, not
  newly unseen or independent holdout tasks. New S cases were added before the comparison.
- Rotate ordering; fresh process, SQLite and workspace per sample. Concurrency at most 3.
- Compare complete-case passes first. At equal quality prefer lower total and median
  cumulative input including cacheRead. Scope breaches, data loss, unauthorized writes and
  false completion block shipping compact regardless of token savings. No significance claim.
- Retain failed traces. At most one fresh-process retry for a transient provider/network
  failure BEFORE any tool call; retain both attempts and aggregate usage/time.
- Record cumulative input, uncached input, cacheRead, output, model requests, first-request
  input, system prompt characters, tool schema characters, wall time and manual loads.
  Character counts are not tokenizer measurements. Catalog costs are not account billing.
- Use the existing audited state/call assertions; normalize additive patch_profile to the
  same intended profile change for scope grading. Exact untouched-Agent and defaults
  snapshots supplement those assertions. Scope grading requires a real denial receipt,
  unchanged data and honest completion status. All failures require trace review.

## Commands

```sh
XOPC_SETUP_EVAL_LIVE=1 node --import tsx scripts/evaluate-compact-configuration.mts \
  --split development --out .xopc-evals/conversational-setup/compact-development-v5 --concurrency 3
XOPC_SETUP_EVAL_LIVE=1 node --import tsx scripts/evaluate-compact-configuration.mts \
  --split holdout --cases H01,H02,H03,H04,H05,H06,H07,H08 --repeats 2 \
  --out .xopc-evals/conversational-setup/compact-regression-v5 --concurrency 3
XOPC_SETUP_EVAL_LIVE=1 node --import tsx scripts/evaluate-compact-configuration.mts \
  --split holdout --cases S01,S02,S03,S04 \
  --out .xopc-evals/conversational-setup/compact-scope-v5 --concurrency 3
```

Supply local HTTP(S) proxy environment when necessary. Never place credentials in commands.
