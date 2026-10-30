# Web timeout and interrupted agent runs — 2026-10-30

## Incident evidence and limits

Reported window: 2026-10-30 11:24–11:34 GMT+8 (03:24–03:34 UTC). Four concurrent raw.githubusercontent.com reads timed out; later GitHub page/API tools still ran; the UI eventually showed `Request was aborted`, and a later “continue” produced the answer.

The local app log contains only two unrelated ComputerRuntime records in that window, without the incident run. No incident run/conversation ID, deployed version, effective runtime timeout, or provider request ID is available. This investigation cannot attribute that historical run to a deadline, provider disconnect, or user cancellation.

Codebase graph tools were unavailable in this session; source inspection used the repository search fallback.

## Confirmed behavior and defects

- `fetchPublicText` composes the caller signal with an independent 25-second timeout. Aborting the child signal does not abort its parents. `web_fetch` catches the failure and returns a tool result. This matches the report that subsequent tools could still execute.
- Model recovery previously accepted only `stopReason=error` and selected network error strings. An `aborted` model message was never retried; `Request was aborted` with `stopReason=error` also missed recovery classification.
- An aborted provider message with a live run signal was converted to `provider_error` with the generic message `aborted`. The outcome projector then classified that message as cancellation, losing the distinction between provider interruption and host cancellation.
- A regression test for bounded recovery exposed a deadline coordination gap: the per-attempt timer called `agent.abort()` without aborting the host run signal. A recovering model could therefore issue another request during timeout cleanup. The timer now synchronously marks the local deadline signal before abort cleanup.

These defects reproduce paths consistent with the report, but are not proof of the historical incident's cancellation initiator.

## Changes

- Recover an interrupted provider request only with a present, live host signal and confirmed preceding tool outcomes. Remove only trailing failed assistant rows from the in-memory retry projection; preserve completed tool results and persisted transcript rows. Keep the existing shared budget of at most two continuations and exponential backoff. Do not resume an incomplete tool call or replay an unconfirmed operation.
- Propagate the per-attempt timeout into the local run signal, including after a configured handoff deadline extension. Deadline/user/policy cancellation prevents provider recovery.
- Return explicit provider-interruption failure text if recovery cannot finish. Classify persisted cancellation from the host termination reason rather than the bare provider error string.
- Return `tool_timeout`, `run_cancelled`, or `fetch_failed` metadata for fetch failures. Tool timeout results advise trying another source or retrying the URL.
- Log fetch failures with tool call ID and scope; model failures with run/conversation/model/request number, provider stop reason and host signal state; run completion with termination reason and deadline. Existing async log context supplies request correlation.

## Verification

A scripted provider drives the real AgentSession/tool execution path. The real public-text fetch function uses a mocked HTTP transport and a shortened real child timeout; no external GitHub or provider request is required.

The integration regression covers four simultaneous fetch timeouts, successful alternative-source reads, final answer delivery, provider interruption reported as either `error` or `aborted`, exhausted bounded recovery, an actual per-attempt deadline, and explicit user cancellation. It asserts that the parent signal remains live after tool timeouts and that no additional model request occurs after host deadline/cancellation.

Validation passed: 137 tests across 18 test files, including the existing HTTP provider → streaming service → gateway regression for TaskRun deadline/error/cancellation status, plus `tsc --noEmit -p tsconfig.json` and `git diff --check`.

This does not constitute a live browser or affected-installation acceptance test. For the historical incident, collect the affected version, conversation/run ID, effective agent timeout, and matching gateway/provider logs. Correlate `web_fetch_end`, `model_request_end`, `model_request_recovery`, `embedded_run_end`, and `agent_run_end` to identify the last successful tool, cancellation scope, and terminal reason.
