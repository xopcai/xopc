# Retained acceptance evidence

This directory retains records with audit details or cross-run comparisons that are not fully reproduced in the accompanying technical reports:

- `computer-use-flows*.json`: native dispatch, access checks and uncertain-delivery results for deterministic, hosted-model and network validation.
- `harness-stage-one*.json`: campaign hashes, immutable decisions, request and usage accounting, failures and independent comparisons.

Routine development runs belong outside the repository, for example under `/tmp` or the ignored `.xopc-evals/` directory. Summarize useful results, measurement definitions, failures and limitations in the relevant technical document rather than committing each run's JSON, local paths or temporary screenshots. Keep executable tests and reproduction scripts in their existing source directories.

The Phone Use, Workflow removal and historical compatibility cleanup reports contain their acceptance summaries. Their temporary or duplicate evidence files were removed on 2026-10-24; previously committed files remain available in Git history. This cleanup does not represent a new execution of those acceptance checks.
