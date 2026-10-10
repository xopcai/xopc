# Personal AI idle compaction

Personal AI checks its context after a completed turn and generates a handover during idle time. It does not wait for soft-threshold compaction before answering. Provider preflight still checks the full context budget, including system instructions, tools, the pending input, images, and output reserve. Hard-limit and provider-rejection recovery remain synchronous.

The scheduler is owned by the SessionStore and permits one background provider request at a time. A new input invalidates the candidate and aborts its request immediately, without waiting for cancellation. A provider that ignores cancellation cannot commit its result; its outstanding request retains the background slot until it settles. It never owns the foreground generation queue.

Generation uses a fixed transcript snapshot outside the foreground compaction lock. Commit rechecks the session generation, active transcript, final sequence and a fingerprint of the source records. The same fingerprint is checked atomically when appending the boundary. Changed, edited, reset or restored histories invalidate the candidate. Original rows remain available for transcript recall. Successful commits evict the idle runtime so the next turn hydrates the new context.

Shutdown and configuration reload cancel timers and requests. Timers are not durable: a later completed turn evaluates the current budget again. Failed requests are not immediately retried. Existing structured handover validation and quality checks remain enabled; background progress does not share foreground recovery checkpoints.

Configuration is under `userContext.contextPlanning.compaction.personalIdle`:

```json
{
  "enabled": true,
  "idleMs": 10000,
  "triggerThreshold": 0.6,
  "cooldownMs": 60000,
  "timeoutMs": 30000,
  "keepRecentTokens": 20000,
  "summaryMaxTokens": 16000
}
```

Recent preservation and summary limits initially retain the existing quality defaults. Smaller limits such as 8000 recent tokens and 4000 summary tokens can be configured after validating important facts and unresolved requests on representative conversations. The existing recent-turn preservation policy still applies. `model` can specify a separate summary model; otherwise the configured global compaction model or chat model is used. Background requests have no immediate retries and a whole-job deadline. Setting `personalIdle.enabled` to false restores normal pre-turn compaction. Disabling global compaction also disables the scheduler.

Logs record generation and foreground-wait duration, before/after token counts, committed/skipped/stale outcomes and failures. `sessionStore.idleCompaction.getMetrics()` exposes aggregate outcome and cancellation counts. Ordinary specialist Agents retain the original pre-turn behavior. Actual first-token latency and summary quality must be evaluated with configured providers; unit tests do not measure provider performance.
