# Coder harness implementation

Baseline: `9473665e1`. Implement in dependency order, review each stage before proceeding. Reuse the existing embedded runtime, transcript store, task contracts, execution environments and evaluator. Remove replaced implementations rather than retaining compatibility paths.

## Stages

1. **Execution and verification** — one runtime event source; revision-bound verification evidence; bounded repair; accurate task receipts. Remove duplicate reminder trackers and command-keyword completion heuristics.
2. **Evaluation** — deterministic real coding fixtures and hidden checks; reproducible experiment configuration; evaluator regression coverage.
3. **Commands and repository context** — consistent foreground/background command lifecycle and policy; durable logs; nested repository instructions; fast ignore-aware search; progress-aware loop detection.
4. **Controlled development** — strengthen workspace isolation and recovery, expose verification evidence in the existing review experience, and integrate language diagnostics where supported.
5. **Complex tasks** — bounded delegation and independent review using existing execution environments; recovery from persisted evidence and current repository state.

## Validation

Each stage requires targeted behavioral tests, type checking, a diff review, and fixes for issues found during review. Harness control tests are not model-quality benchmarks. Real-model success rates must be measured separately with fixed models, budgets and fixtures.

## Progress

- Initial inspection: working tree clean; graph MCP tools unavailable, using source search.
- Stage 1: complete. Actual embedded runtime events drive observers; checks bind to Git content fingerprints, failed/stale checks cannot certify a receipt, and repair runs once within the existing budget. Removed both old reminder trackers and keyword-based task evidence. Self-review fixed canonical paths on macOS, continuation budget reset, repaired-check receipts, and missing-final-snapshot handling. Validation: 134 targeted tests; root typecheck; diff whitespace check.
- Stage 2: complete. Eight coding fixtures have hidden behavioral checks, protected public tests/config and evaluator-only reference repairs. Calibration executes 16 runs: all original implementations fail their hidden check, all repairs pass. Review fixed unresolved commit/model environment variables and included hidden-check contents in suite fingerprints. Evaluator typecheck and 13 tests pass. Actual model-quality comparisons remain an operational evaluation, not a claimed result.
- Stage 3: complete. One command registry implements foreground/yield/background jobs, bounded wait, pipe stdin, process-tree cancellation, durable output/receipts and explicit interrupted ownership. Both tools use the same deadline policy. Search now uses bounded asynchronous ripgrep and honors ignores; read_file supports offsets. Scoped AGENTS.md rules reload on edits and are acknowledged only at the next model request, so parallel calls cannot skip new rules. Loop detection examines current-turn results without hiding recovery tools. Review fixed cancellation vs timeout, process-close races, cross-directory check fingerprints and retained logs (7 days / 500 completed jobs per owner; 8 MiB per log). Validation: 282 targeted tests, root typecheck; final aggregate regression will cover subsequent changes.
- Stage 4: complete. Review receipts expose revision, duration and log path with a visible partial state; review_workspace includes untracked content. TypeScript diagnostics use the workspace compiler. Failed worktree cleanup retains the binding, and reattach reconciles its health. Optional Docker execution requires a digest-pinned existing image, isolates writes to the mounted workspace, denies network by default and never falls back to host. Removed the misleading container option from preflight-only policy. Validation: 60 targeted tests plus root/web typechecks; the Docker daemon is unavailable here, so real container success/cancellation remains an integration check (unavailable-image/no-host-fallback was verified).
- Stage 5: complete. Delegation now uses the same embedded harness; read-only inspection/review cannot obtain write or shell tools, while implementation requires a clean project and a separate managed worktree. Exact tool-call reservation, model-turn/usage limits and cancellation prevent unbounded child loops. Removed the direct child Agent runner, workflow snapshot rewriting and permanently disabled execute_code implementation. Restart checkpoints compare current file revisions before accepting old evidence. Final review also prevented task judges from overriding stale proof, kept ordinary artifact delivery outside mandatory coding checks, honored configured native command deadlines and supported unborn Git repositories.

## Final validation

- Cross-stage regression: 417 tests in 89 files passed.
- Real AgentSession integration: edit → early answer → bounded verification continuation → revision-bound receipt; child parallel-batch budget terminates after the permitted tool calls.
- Root TypeScript check, web TypeScript check and production web build pass. Existing build chunk-size/dynamic-import warnings remain.
- Coder evaluator: typecheck and 13 tests pass, including 16 calibrated fixture runs.
- No production configuration was changed, no gateway was restarted, and no commit or push was made.
- Operational limits and reproducible evaluation commands: [coder-harness-operations.md](./coder-harness-operations.md).
