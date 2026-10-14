# Delegate task budgets

`delegate_task` runs a bounded child with a fresh context. Supply a precise goal,
relevant facts and a stopping condition. Search first, then read targeted ranges;
continue truncated reads using the returned `next` position.

| `budgetTier` | Tool calls | Cumulative tokens | Time |
| --- | ---: | ---: | ---: |
| `light` | 15 | 50,000 | 2 minutes |
| `standard` (default) | 30 | 100,000 | 5 minutes |
| `deep` | 60 | 200,000 | 10 minutes |

`maxIterations` overrides only the tool-call limit (1–60). Each tier also allows
one more model turn than its resolved tool-call limit and five cumulative tool
failures. Tokens sum usage across model requests, including repeated input;
they are not the model context-window size. Tool-call usage counts budgeted
authorization attempts, including each underlying `data_batch` operation, rather
than just executed wrapper calls. Model turns count completed turn-policy checks.

At tool admission when 80% of wall time is used, or after a tool-bearing turn
reaches 80% of any limit, the child stops admitting new
tools and receives one continuation asking for evidence, unfinished work and
precise next steps. The result is `partial`; use the handoff to resume the missing
work rather than repeating discovery. A naturally final answer below the hard
limit does not trigger an extra summary request.

Every provider dispatch rechecks the budget, cancellation and inherited Credit
stop state. The handoff permits one dispatch only, including failed attempts;
generic retry or recovery paths cannot issue another handoff request.

Hard limits, parent policy termination, cancellation and Cloud Credit exhaustion
prevent further continuation within the attempt. Research runs reserve the final
20% of wall time for handoff: reads are bounded by the research deadline, and an
already-dispatched handoff may use the remaining reserve once. If a long model
request hits the research deadline before handoff dispatch, the host aborts and
waits for settlement, then starts one tool-free summary using saved findings and
the same cumulative budget. An unsettled request never starts another attempt.
Other delegation modes preserve available assistant text and bounded recent tool
evidence when a long request reaches the hard deadline. Token limits are enforced at request/turn boundaries; one response may
take reported usage above the limit.

Tool result `details` includes:

- `stopReason`: `completed`, `tool_calls`, `total_tokens`, `model_turns`,
  `tool_failures`, `timeout`, `cancelled`, `parent_policy`, `credit_budget`,
  `runtime_error`, or `verification`. Child results distinguish `deadline_exceeded`,
  `user_cancelled`, `parent_cancelled`, and `provider_error`; `timeout` and
  `cancelled` remain accepted budget reason values for existing callers.
- `budget`: selected tier, limits, actual usage, stopping reason and handoff trigger.
- `handoff`: whether a summary was requested, whether a final tool-free summary
  was received, and the available summary/evidence.
- Existing `status`, `iterations`, granted/rejected tools and verification data.

The text result also reports budget usage and limits. `DelegateChild` logs one
completion record with the same diagnostics.

Cloud Credit accounting is independent of these local budgets. Children and
their summary continuation retain the parent's Credit scope; choosing `deep`
does not create another Credit budget or raise the configured Credit limit.

Example:

```json
{
  "goal": "Locate the session reset path and report its SQLite writes with file/line evidence",
  "mode": "inspect",
  "budgetTier": "standard",
  "context": "Focus on reset behavior; stop once the gateway handler and storage writes are identified."
}
```

## Durable research and resume

For `mode: "research"` (the default) with a parent conversation, the host stores
research checkpoints in SQLite. Research without a parent conversation retains
the existing ephemeral behavior. No transcript save is added to the turn path.
The child receives a scoped `research_checkpoint` tool; it cannot write arbitrary
files, perform external writes, or obtain additional parent capabilities.

Save after each verified source. An update contains `findings` and `nextSteps`:

```json
{
  "findings": [{
    "id": "vendor-a-realtime-price",
    "subject": "Vendor A",
    "field": "realtime voice price",
    "status": "not_disclosed",
    "conclusion": "The public price page requires contacting sales.",
    "sources": [{ "url": "https://example.com/pricing", "title": "Official pricing" }]
  }],
  "nextSteps": ["Verify domestic calling eligibility"]
}
```

Stable finding ids update existing fields; omitted findings are retained.
Statuses are `confirmed`, `not_disclosed`, `conflicting`, and `unverified`.
Confirmed findings require HTTP(S) source URLs; the host stamps `checkedAt`.
These are sourced model assertions, not independently certified facts.
`not_disclosed` is a valid deliverable, not a reason to invent values or search
indefinitely. `nextSteps` replaces the unfinished-work list. Clear it only once
every requested field is addressed. A text answer without saved findings, a
nonempty unfinished-work list, or an unverified finding cannot complete research.

The host also saves bounded tool evidence immediately after tool completion,
even when the model never reaches its next checkpoint call. Limits are 100
findings, 20 findings per update, 30 next steps, and the latest 30 tool excerpts
of up to 2,000 characters each. Saving a checkpoint does not consume read-call
quota; model-turn, token, failure and hard time limits still apply.

`details.resumeId` identifies the checkpoint. Resume with the same goal:

```json
{
  "mode": "research",
  "goal": "Check Vendor A realtime pricing and domestic calling eligibility",
  "resumeId": "<resumeId from the previous result>",
  "maxAttempts": 2
}
```

Only the owning conversation and workspace can resume the checkpoint. Every
resume invocation resolves current parent tools again; tool dispatches recheck
live parent authorization. Completed
checkpoints return their saved result without launching a model. A lease prevents
simultaneous resumes and fences late callbacks; after a process crash an expired
lease can be claimed again (tier deadline plus a 10-second cleanup allowance).
Deleting the owning conversation deletes its checkpoints.

`maxAttempts` bounds research attempts per tool invocation: default 2, maximum 3,
including the first attempt. Automatic continuation applies only to partial
results stopped by time, read-call, token or model-turn budget exhaustion with
unfinished work. Parent permission refusals, cancellation, Credit exhaustion,
provider/runtime failures, tool-failure limits and failed verification do not
trigger automatic retries. Each new attempt has a fresh local tier budget and
inherits the same parent Credit and cancellation scope. Explicit later resume
calls can continue the retained work.

Research details include `checkpoint`, `resumeId`, `attempts` (this invocation),
`totalAttempts` (persisted), and `attemptBudgets`. The existing `budget` describes
the last attempt; `iterations` sums read-call usage across attempts in this call.
The tool's outer timeout accommodates at most three deep attempts plus cleanup;
a stricter configured parent tool or run deadline still takes precedence.

## Search fallback and retained queries

`web_search` retains structured failure information rather than turning a failed
provider chain into a successful empty result. `details.failure` contains:

- `permission_denied`: HTTP 401/403 or an explicit access-policy refusal.
- `rate_limited`: HTTP 429, including the provider's `Retry-After` when supplied.
- `timeout`: HTTP 408/504 or an elapsed request/caller deadline.
- `cancelled`: caller cancellation; it never starts another transport.
- `unsupported_batch` and `provider_error`: unsupported batch transport and
  other provider failures.

Permission refusals stop the search provider chain; switching to another provider
or HTML cannot bypass them. Rate limits and per-request timeouts permit at most
one retry on the same provider, with a bounded, abortable backoff. A cooldown
longer than two seconds skips same-provider retries instead of ignoring the
server's instruction. Later queries in that registry also respect the cooldown.
Other configured providers and the existing region-aware HTML fallback remain
within the existing `web_search` permission. Every transport has a 10-second
ceiling and retains any stricter caller deadline.

`data_batch` coordinates its authorized `web_search` items through a host-only
batch method. It preserves each operation id, exact query, count, success/error
and original capture time. Duplicate queries are fetched once, and unfinished
queries use sequential singles. The built-in search providers currently expose
single-query transports; the coordinator uses those directly. A host adapter may
optionally implement `SearchProvider.searchBatch` and return successes/errors by
id. No unsupported external batch endpoint is guessed or added.

A native batch failure permits individual fallback only when it is transient,
unsupported, or explicitly classified by the host adapter as **batch-only**.
An ambiguous 403, provider-wide refusal or denied individual query does not
permit splitting that refused access. A provider-wide refusal also stops the
remaining uncached queries instead of repeating denied requests. Explicit
query-level refusals affect only that query. Successful native batch items are retained;
only missing or retryable items are fetched again. Caller cancellation stops all
further requests. Existing approval and call-limit policies still see every
underlying operation, and live read permission is checked before reads, cached
responses and fallback dispatches. Denial of the `data_batch` tool itself does
not invoke its optimization or silently run another tool.

Successful query results (including genuine empty results) are saved under the
same research checkpoint lease in `checkpoint.searches`. Errors are not query
cache entries. Reuse is limited to the owning research task, exact query/count,
provider configuration and region, with a 10-minute TTL. Configuration keys are
hashed for cache identity and are never saved in the checkpoint. Original
`capturedAt` remains visible when a result is reused. Other conversations/tasks
cannot read that cache; ordinary non-research calls only deduplicate within their
own registry/batch. No account-wide cache is created.

At most 20 retained queries fit within the checkpoint's 200,000-character
envelope. Findings take precedence: adding findings may evict old cached queries.
Previously completed queries remain durable even if a later search or the batch
hits its deadline; a research resume can reuse them. No SQLite schema migration
beyond the existing research checkpoint table is needed for this optional field.

Batch operation metadata includes `failureKind` and `cached`. `sourceRequests`
counts actual search-provider attempts, including retries, and excludes cache
hits. A batch with a denied or failed item must still be treated as an incomplete
research result even when other items succeeded.

## Gateway acceptance

Run `node --import tsx/esm scripts/verify-research-gateway.mjs` after `pnpm run build:node`
for authenticated HTTP/realtime acceptance with isolated SQLite and controlled HTTP
upstreams. The full run uses the unchanged light deadline; the search-only run
(`XOPC_RESEARCH_GATEWAY_SEARCH_ONLY=1`) also verifies the query quota boundary.

Delegated `data_batch` is a composite wrapper. Its executor is restricted to the
child's underlying tool set, including when inherited from the parent. Parent
authorization evaluates the wrapper and every operation; forwarding an already
expanded batch through another policy does not charge the operations twice.
