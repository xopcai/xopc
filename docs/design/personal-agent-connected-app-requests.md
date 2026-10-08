# Personal AI connected-app requests

## Behavior

Personal AI performs a local capability preflight, submits a durable read-only request,
and returns control to the user. A missing connection or ambiguous account is handled
by the existing connection action area in the originating chat. Authorization starts
the specialist Task directly; it does not enqueue another main-model turn.

The implementation reuses the Task lifecycle, account policy, connection recovery,
and `task_result_delivery` history projection. Ordinary Agent conversations do not
create Personal requests and keep their existing connection-resume behavior.

## Entry points

- `personal_capability`: local discovery of connector capabilities, account state,
  specialist tool permissions and chat-model availability. `ready` is a local
  preflight, not proof that a remote tool contract or service is healthy.
- `personal_request`: submit, list, inspect and cancel Personal requests.
- `personal_request_result`: a request-scoped worker tool for publishing verified
  summaries and mail items with coverage, partial results and source links.
- `personal_request_connection`: a request-scoped worker tool for recovering an
  expired/disconnected selected account in the originating main chat.

The first two tools are included only in the Personal AI allowlist. Existing Personal
profiles gain the tools and connected-app guidance through the existing idempotent
profile refresh; custom instructions and unrelated permissions are preserved.

## Persistence

Migration 232 adds `personal_requests`, including original conversation/transcript/
input identity, objective, selected connector/account/executor, absolute time range,
idempotency hash, connection wait, Task, structured result and delivery marker.

Submission, connection association, Task creation and state transitions are SQLite
transactions. Conflicting reuse of an idempotency key is rejected. Request identity
is stable across authorization callbacks and reconnects.

Mail requests without an explicit time range use the seven days preceding the
original input time. The tool returns this explicit default and instructs the main
Agent to disclose it. A stored user timezone is used when valid, otherwise UTC.

## Connection and account recovery

The existing `queueConnectionResolution` accepts an optional Personal resolver.
`ConnectionRecoveryService` supplies it. Unrelated waits take the original branch.
An initial Personal wait creates one Task and closes the wait without an additional
main-chat input. Account and executor permissions are checked again at this point.

An execution-time connection failure creates a main-chat wait against the original
input, pauses the existing TaskRun, and preserves the selected account. Reauthorization
resolves its Task wait; the dispatcher resumes that same TaskRun. Changing the account
or connector of an already running request is rejected. Missing contracts and transient
network errors are not interpreted as a reason to authorize again.

Cancellation is logical cancellation; its response explicitly does not certify that
an already issued remote read has stopped. Subsequent tool operations are denied.

## Read-only enforcement

The request worker's tools are narrowed to external search/describe/execute and the
two request-specific publication/recovery tools. Shell, browser, messaging, delegation
and other write tools are excluded for that execution.

External execution requires the selected connector and exact `xopcAccountId`. Composio
actions additionally require host-curated read metadata. The external service enforces
its read-only contract checks. Ordinary Agent execution does not enter this branch.

A worker session retains a Personal request marker. If the originating conversation
is deleted and its request is removed, this marker makes subsequent external calls
fail closed. Deletion also logically cancels the associated active TaskRuns.

## Result delivery

Mail publication requires query coverage; a narrower range is automatically marked
partial. Mail items accept HTTPS source links on Gmail and supported Outlook hosts.
Titles, sender information and item explanations are escaped before Markdown rendering.

The request row acts as a durable outbox. A local delivery timer checks completed
requests every second, independently of connector network polling and main-chat
availability. It appends a custom `task_result_delivery` row and commits the delivery
marker atomically. Client notification follows persistence. Notification failure retries
without appending another message, with exponential backoff and at most eight attempts.

The main Agent's progress/result/failure notification path is suppressed for these
requests, avoiding a second model-generated result. Worker questions retain the existing
collaboration path. The main Agent can refer to the bounded delivered summary in later
conversation context; it is marked as background reference data.

Mail results render as inline summaries and linked message lists using the shared chat
Markdown renderer. Dedicated mail-card styling is not required for the protocol. File
and image artifacts continue using the separate shared Task result-delivery pipeline.

If a reset changes the active transcript, the result stays available in the request
snapshot instead of being appended to the new conversation history.

## HTTP and clients

After a verified connection resumes a Personal request, the host immediately appends
an assistant status message to the originating chat and publishes the existing
session refresh event. This requires no main-model turn. Closed connection waits
retain an append/notification marker, allowing recovery after restart without duplicate
messages. Reset transcripts never receive delayed feedback. Status messages are
display-only and excluded from model input; completion or failure follows through
the result delivery path.

- `GET /api/personal-agent/requests`: latest 50 owner requests.
- `GET /api/personal-agent/requests/:requestId`: request state and saved result.
- `POST /api/personal-agent/requests/:requestId/cancel`: requires `expectedVersion`.

Routes use the existing Personal route bundle and owner/mobile-device access checks.
Lazy route mapping and real authenticated localhost HTTP requests are tested.

Web, Android and HarmonyOS reuse their existing connection action areas. iOS adds a
Personal-only connection area with browser authorization, account selection, range
review, refresh and cancellation; it refreshes only while the app is active. Results
use the shared assistant-history projection and existing background-result observation.

## Validation

Tests cover local preflight, connected submission, idempotency conflicts, main-chat
authorization, no additional main-model input on resume, multiple accounts, permission
restrictions, skip/cancel, partial mail publication, delivery deduplication, reset,
execution-time reauthorization, deletion and real authenticated request routes.

Live Gmail/OAuth and physical-device acceptance require a configured account and are
not implied by mocked connector tests or simulator compilation. No P50/P95 response
latency measurements have been made; the one-second delivery interval is a scheduling
bound, not an end-to-end latency guarantee.
