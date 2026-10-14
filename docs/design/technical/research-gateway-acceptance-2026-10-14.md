# Research Gateway acceptance — 2026-10-14

Status: passed. A full run passed 14 end-to-end assertions; a separate search/quota run passed 11 assertions, including the newly corrected quota boundary. The related regression suite passed 140 tests in 26 files.

## Execution boundary

The test launches the real built Gateway CLI in a separate process, with isolated config, SQLite, workspaces, synthetic credentials and a random loopback port. Inputs enter authenticated `POST /api/sessions/:conversationId/inputs`; one-time tickets and the real realtime client observe run/tool completion. SQLite is inspected read-only for durable evidence. The Gateway is stopped and restarted before the research resume.

The model and search services are controlled local HTTP servers. They exercise actual OpenAI-compatible streaming, HTTP errors, aborts and provider transports without invoking paid models or real vendor APIs. An acceptance-only preload supplies the optional host batch adapter and blocks non-loopback fetches. That adapter is not installed in production. This verifies Gateway integration and injected failure recovery, not live vendor availability or accuracy of vendor research. All source evidence is synthetic.

Production budgets are unchanged: `light` remains 120,000 ms, with 20% reserved for handoff. Test gateways are shut down after each run; successful test state is removed. Existing Gateway/config/credentials are not reused. The normal CLI config-specific lock is acquired and released by each test process.

## Results

| Scenario | Observed result |
| --- | --- |
| Gateway authentication | Unauthenticated agent API returns 401; bearer-token REST and realtime tickets succeed. |
| Explicit batch-only permission refusal | One bulk request returns a host-verified batch-only 403; two unique queries fall back to singles. A duplicated query adds no transport. |
| Partial bulk response | Successful item is retained; only the failed second item is queried individually: one bulk request and one single. |
| Bulk rate limit | 429 with `Retry-After: 1`; subsequent singles wait at least 900 ms before dispatch. |
| Single rate limit | First response is 429; exactly one retry succeeds after the declared cooldown. |
| Provider-wide bulk refusal | One 403 request; zero individual or HTML requests. Typed permission evidence is retained. |
| Single permission refusal | One refused query; no retry or HTML bypass. Incomplete research is not labeled complete. |
| Bulk timeout | A real hanging HTTP response is aborted at the transport deadline; two unique unfinished queries use singles. |
| Research deadline | A real held model stream is aborted after 95,939 ms. Result is `partial` / `deadline_exceeded`, with a handoff and persisted findings, search cache and unfinished steps. |
| Cold restart and resume | Same `resumeId` resumes in a new child; attempt count is 2, unfinished steps become empty and status becomes completed. Search service is visited only once across both attempts. |
| Cached provenance | The original search `capturedAt` is unchanged after resume. |
| Cache isolation | A different task performs its own backend search for the same query. |
| Permission revocation | Changing `web_search` to deny rejects resume with `parent_policy`; no child attempt or search is added. |
| Query quota boundary | With parent quota 3, batches containing three logical queries succeed. A four-query batch stops with `parent_policy` before any search transport. |
| Delivery | Parent run completion, realtime `delegate_task` completion and SQLite tool results are present. |

## Corrections made during acceptance

1. `data_batch` was missing from delegated capabilities, making the research batch path unreachable. It is now a composite read wrapper: only available with permitted underlying sources, and its executor is confined to the child's tool subset. Implementation delegations rebind it to the isolated workspace.
2. A batch was expanded again when its wrapper reached the parent authorization policy, double-charging query quotas. Host-owned context provenance now prevents repeated expansion; the wrapper and every underlying operation still receive authorization checks. New tests cover the exact quota boundary and direct executor confinement.

The initial real Gateway run reproduced the missing declaration. Failing regression tests reproduced both capability and quota issues before the fixes. The corrected Gateway passed the full run and the additional quota run.

## Reproduction

```sh
pnpm run build:node
node --import tsx/esm scripts/verify-research-gateway.mjs
```

The full test takes about two minutes because it waits for the real research deadline. Set `XOPC_RESEARCH_GATEWAY_SEARCH_ONLY=1` for the shorter search/quota run. Set `XOPC_RESEARCH_GATEWAY_REPORT=/absolute/path/report.json` to choose the report location. The script preserves failed test state for diagnosis; successful state is cleaned up unless `XOPC_RESEARCH_GATEWAY_KEEP_STATE=1`.

Machine evidence: [initial failure](./research-gateway-failure-before-fix-2026-10-14.json), [full run](./research-gateway-acceptance-2026-10-14.json), [search/quota run](./research-gateway-quota-acceptance-2026-10-14.json). Reports include source hashes, request counts, timestamps and observed model tool results.
