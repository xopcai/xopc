# Prompt behavior v1.0.1

This suite extends the existing coder evaluation framework. It does not replace or modify xopc-core or xopc-agent-growth contracts. Every new case has a fixed 180-second, 12-model-request, 30,000-total-token budget, including cached input and auxiliary requests.

The 15 cases cover standing language and style preferences, identity changes, single-turn overrides and restoration, explicit preference changes and revocation, real compaction, eight restricted tool inventories, and prose-only artifact delivery. Existing frozen cases supply hidden code assertions, exact data processing, multi-turn requirement changes and failure recovery.

Run `node --import tsx evals/coder/scripts/run-prompt-ab.mjs OUTPUT --preflight-only` for a synthetic configuration probe, then omit the final flag for the frozen live experiment. Source archives and two prepared isolated worktrees are prerequisites; see the experiment manifest and provenance records. Synthetic probe responses are never model evidence.

The live experiment pins two exact models, thinking off and no fallback, with three matched repetitions and seeded interleaved arms. Two provider cohorts run concurrently, with at most two active cases. The runtime, verification, tool execution and compaction implementations are common. The authorized isolated singleton-skill exposure fixture is also identical in both arms. All source and control-plane hashes freeze before upstream requests and are checked at completion. Original failed runs are retained; failed items are not selectively rerun.

`hidden/check.mjs` emits separate language, style, restoration, illegal-tool, false-success, artifact-correctness and requirement-completeness dimensions. Deterministic failures fail the command. Reserved formal versus relaxed casual tone always requires blind review; ambiguous claims or style remain `manual_review`. A successful command with unresolved dimensions is not a confirmed full pass. The exact blind rubric is frozen in the manifest. Review packets hide arm labels; the mapping is stored separately.

Actual provider wire requests, prompt hashes, response identifiers, responses, usage/cache data, tool calls and results, per-turn transcript exports and final workspaces are retained per run. Catalog-based cost estimates are not invoices. Shared buffered forwarding, uncontrolled provider cache state, small samples, and changing upstream model aliases limit inference; no observed regression is not proof of complete non-regression.

Version 1.0.1 fixes only the S06 declared grader command routing from S01 to S06; tasks, expectations, budgets and grader implementations are unchanged. The 2026-10-17 experiment retains its original frozen 1.0.0 records and a separately manifested full 186-run artifact/trace reassessment. No model was called for reassessment. Calibration now executes each declared command and asserts the returned case id.
