# Computer Use bounded rescue

Rescue stays inside the existing Runtime → endpoint transport → desktop Broker → native driver path. It does not add a tool, route, provider, permission, fallback driver or background job.

## Positive evidence before another proposal

Only a validated Broker reply with `status: ready`, `errorCode: COMPUTER_OBSERVATION_CHANGED` and **no receipt** authorizes rescue. The Broker produces this reply after revalidating the same target and detecting a changed observation, before creating a dispatch receipt or calling the native driver. The old proposal is discarded; its action budget reservation is refunded because no input was dispatched.

The Runtime reserves a rescue, resets the model adapter (including Responses continuation IDs and queued batch actions), obtains a fresh observation and predicts a new proposal with a fresh action ID. The session keeps its original target, permission mode, pinned model recipient and credentials. Existing approval, target/freshness validation, action/model budgets, session expiry, cancellation and control-gate checks still apply. No new access is granted. A stale proposal resumed after local approval follows the same path using its **original goal and expectation**; a replacement goal supplied by an approval poll cannot change it. The newly predicted action requires fresh local approval.

`computer.maxRescuesPerSession` defaults to 1, accepts integers 0–3, and 0 disables rescue. The allowance is shared across all `step` calls, including suspended/resumed approvals. Its ceiling is captured at session open; increasing configuration cannot raise that ceiling, while a lower current setting constrains the next rescue. `budget.rescuesRemaining` exposes the effective allowance. Exhaustion closes the session through the existing release path and reports `COMPUTER_UI_UNSTABLE`. An unconfirmed release retains the control gate.

## Cases that stop or return without rescue

- Lost RPC replies, timeouts, transport errors and malformed/mismatched replies.
- Any receipt, including `started`, `unknown` or `completed`, even if paired with an observation-change error.
- Native action failures, semantic refusals, post-action capture failures, no-progress detection and unchanged screenshots. A screenshot cannot prove that typing, saving, sending or a remote effect did not happen.
- Permission or scope errors, model HTTP/network errors, user stops, cancellation and expired budgets.

A refused semantic action never falls back to coordinates. The Runtime never automatically replays an envelope or switches models to bypass a refusal. Existing model-format correction remains separate: at most one format-only correction before dispatch, under the same model budget. It is not evidence that an action was executed or that a task succeeded.

## Diagnosis and evaluation

Metadata-only reports add `rescueAttempts` and `rescueExhaustions`. An attempt counts when the Runtime reserves a fresh observation/planning cycle; later observation/model failure still consumes it. Exhaustion counts a change that cannot be rescued, including when disabled. Recoverable pre-dispatch changes do not set a terminal failure; eventual failure is attributed to its actual phase and dispatch evidence. Completed inputs, verified conditions, model claims and full task success stay distinct.

The report exporter, executor harness, aggregate evaluator and paired comparisons carry the two metrics. Older evaluation rows may omit them or use null: missing measurements stay unknown. Fewer rescues do not constitute a success or override the independent oracle, safety measurements or real-app quality gate.

## Validation scope

Runtime tests exercise the real Broker with deterministic native-driver and model fixtures: session-wide exhaustion, disabled/0–3 bounds, configuration changes, suspended approvals and original-goal preservation, fresh action IDs and approvals, Responses queue invalidation, model/time budgets, cancellation and pixel clearing. Negative cases cover lost delivery, receipts with uncertain/completed dispatch, native refusal, model errors, read-only sessions and no-progress protection. Evaluation tests cover metric export, executor acceptance and paired comparison without invented zeros or success claims.

These fault-injection checks validate rescue decisions and non-replay behavior; they do not certify unattended desktop work or a real-app task success rate. Existing TextEdit native semantic/context-menu evidence remains documented separately.
