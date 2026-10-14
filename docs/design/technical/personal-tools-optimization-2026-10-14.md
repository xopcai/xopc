# Personal Agent tool optimization — 2026-10-14

## Implemented behavior

The Personal main conversation retains its twelve narrow tools. Ordinary work is submitted to `personal_task`; read-only connected-app work uses `personal_capability` and `personal_request`, with the background Task Router selecting the executor after account authorization.

- Personal tools retain their authoritative constructor descriptions. The factory applies brief overrides only to general local-read tools; duplicate Personal descriptions were removed from policy.
- Task, Request, Attention and local-object schemas declare command-specific required fields through JSON Schema conditions. Submit requires an objective and full brief. Optional structured fields need not repeat the brief. Empty optional requested executor IDs are normalized to absence; the model schema disallows empty IDs.
- Task submit returns a compact durable acknowledgement with identity, phase, allocation and operational state, preserving the product delivery envelope and current-state idempotent replay.
- `personal_task(cancel)` checks origin ownership, closes the Task, invalidates the allocation lease, requests embedded execution abort and finalizes the active run. A late router answer cannot start the closed Task. Cancellation is idempotent, and retries do not turn unconfirmed external execution into a confirmed stop.
- Connected Request cancellation also closes the Task and invalidates pending allocation. The Request cancellation flag is persisted even when the Task control plane has already finalized the run.
- Task, Request, Attention and selection reads support bounded pagination. Lists return small projections; selection reads omit full candidate assessments. Text output is capped at 8,000 characters and explicitly identifies omitted details. Pagination follows the items actually returned. Local object projections disclose nested omissions.
- Connected submissions do not expose executor selection parameters to the main model. The persisted Request uses `parameters.allocate` until allocation, and the model-visible snapshot omits the temporary router identity. Existing internal explicit-executor callers retain their established path.
- Account connection and selection remain in the main conversation. Authorization completion preserves the allocation flag and original result destination. Background assignment evaluates only permitted account executors, revalidates after the router decision and atomically records the selected executor in both Task and Request before queuing one execution.
- Account candidate permissions are computed once per discovery/revalidation phase instead of rescanning the complete catalog for each candidate. This removes the added quadratic scan; it is not a large-catalog performance benchmark. The existing 24-eligible-candidate router comparison budget remains.

## Validation

Related regression: 15 files / 170 tests passed. The final connected Request regression passed 22 tests, including delayed connection, account restrictions, revocation during routing and Request cancellation after Task cancellation. New tests also cover model schema validation with AJV, cancellation during selection, running executor abort, truthful cancellation replay, final factory descriptions and read-budget pagination. Root typecheck, targeted source ESLint and `git diff --check` passed.

Real-model verification used the current configuration: Personal `deepseek/deepseek-flash`; Router and executor `xopc-cloud/openai-codex/gpt-5.5`. The fixture and Gateway were isolated; existing credentials were shared through their normal provider lock. No real mailbox request was performed. Connected-app authorization paths were verified through deterministic local integration tests.

Final real-model run selected `data-analyst` in one actual Router model call. The executor published a report and reproducible analysis script; the verified totals were January 150, February 210, growth 40%. Allocation identity, execution status, result card and final answer appeared in the originating conversation. A concurrent input received its actual assistant reply while the worker was running.

| Stage | Duration |
| --- | ---: |
| Main HTTP acceptance | 13 ms |
| Input to persisted Task | 6,447 ms |
| Complete submit tool | 29.25 ms |
| Task creation host function, nested within submit | 2.29 ms |
| Initial main reply after submission | 1,591 ms |
| Background allocation | 2,465 ms |
| Execution queue | 13 ms |
| Executor, including verification | 45,741 ms |
| Result return to main conversation | 1,268 ms |
| Concurrent main input response | 916 ms |
| End-to-end total | 55,931 ms |

Durations are a single run, not evidence of a throughput or model-latency improvement. Result-return timing includes the harness observation interval. The fast persistence boundary and main conversation responsiveness are verified independently of worker duration.

Evidence: [final real-model report](./personal-tools-optimization-live-2026-10-14.json). Earlier reports preserve the empty-optional-ID recovery and pre-compaction receipt runs.

## Repeated stability verification

Follow-up testing tightened the read/submit boundary, clarified the worker shell contract and reduced redundant Task brief generation. The final version passed three consecutive real-model runs with no main or worker tool errors. See [stability verification and timings](./personal-tools-stability-2026-10-14.md).
