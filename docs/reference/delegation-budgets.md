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

After a tool-bearing turn reaches 80% of a limit, the child stops admitting new
tools and receives one continuation asking for evidence, unfinished work and
precise next steps. The result is `partial`; use the handoff to resume the missing
work rather than repeating discovery. A naturally final answer below the hard
limit does not trigger an extra summary request.

Every provider dispatch rechecks the budget, cancellation and inherited Credit
stop state. The handoff permits one dispatch only, including failed attempts;
generic retry or recovery paths cannot issue another handoff request.

Hard limits, parent policy termination, cancellation and Cloud Credit exhaustion
prevent further continuation. A single model response or long tool call can pass
the warning threshold and reach a hard limit before a summary is possible. In
that case, the result preserves available assistant text and bounded recent tool
evidence. Token limits are enforced at request/turn boundaries; one response may
take reported usage above the limit.

Tool result `details` includes:

- `stopReason`: `completed`, `tool_calls`, `total_tokens`, `model_turns`,
  `tool_failures`, `timeout`, `cancelled`, `parent_policy`, `credit_budget`,
  `runtime_error`, or `verification`.
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
