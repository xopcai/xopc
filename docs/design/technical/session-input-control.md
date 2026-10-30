# Session input control

Abort, turn replacement and follow-up editing share a server-owned input control plane.

## User-visible rules

- Stop pauses the conversation queue durably before cancelling its active execution. Pending messages remain in their original order. The UI stays in “Stopping” until execution has settled.
- Editing the latest user turn stops execution and pauses the queue. Replacing it authorizes only the replacement input. Existing follow-ups stay paused and require review.
- Editing a queued follow-up pauses consumption without stopping the active reply. Saving updates the same input, with optimistic version checks. Cancelling restores the ordinary unsent draft and leaves the queue paused.
- Enter and the primary button share submit precedence: save follow-up, replace turn, queue during execution, otherwise send. Queue length never overrides an editor's target.
- “Send this message” authorizes one input while leaving the rest paused. “Resume queue” independently enables ordered consumption; it does not submit editor text.
- Editing targets are mutually exclusive. Failed saves and target consumption preserve the editor and its draft. Explicit conversion to a new message is available. Drafts, editor identity and drafts belonging to other edit targets persist in the existing scoped composer store.
- Steering operates on the original queued input and its captured run. It never clones a queue row. Uncertain delivery is retained without automatic replay; explicit retry is a separate user action.

## Control protocol

`POST /api/sessions/:conversationId/input-control` accepts an operation ID, transcript ID, expected control version, action (`stop`, `pause`, `resume`, `send`, `steer`) and optional input identity/version or turn identity.

`input-state` includes `control: { paused, version, phase, reviewRequired }`. REST responses and realtime snapshots use the same projection. The UI retains the operation ID for retries within an attempt; stop requests are retried only against their captured execution. An old completed stop cannot recapture a new run.

The control state and operation receipts are SQLite tables introduced by schema v262. The complete historical migration chain remains bundled. A restarted gateway clears orphaned execution ownership using existing recovery, preserving the pause and never replaying inputs whose delivery is unknown.

The queue claim transaction checks both the durable stop fence and pause. A single-input permission filters the claim to its exact input, is consumed atomically and disables coalescing. Input acceptance checks its control version and grants single execution in the same transaction as input/receipt insertion. Legacy appends can still enqueue, but cannot release a paused queue.

Stopping persists its captured run before asynchronous cancellation. Execution preflight checks the stop fence again before entering the agent. Finishing that run clears only its matching stop fence. Pausing follow-up editing atomically checks its row version and queued status, so a consumer either wins before editing or is blocked afterward.

Turn replacement retains transcript validation and atomic deletion/insertion. Paused queued inputs are allowed; active or ambiguously delivered inputs still block replacement. The replacement is granted single execution, and follow-ups remain paused for review.

Per-run abort remains an internal execution primitive. The Web stop and editing flows use session control. Independent delegated tasks retain their own lifecycle.

## Verification

- Listening authenticated Gateway tests cover lazy routing, stop, replay, stale resume and single-input delivery.
- Coordinator/repository tests cover stop versus successor claim, stop during asynchronous preflight, persistence/recovery, stale controls, edit versus claim, replacement with a preserved queue, steering identity and uncertain delivery.
- Embedded run tests reject steering into a newer or cancelled run.
- Web tests cover unified Enter dispatch, submission precedence, rejected/late saves, editor exclusivity, external consumption and persisted editor metadata.
- Existing full historical schema-upgrade tests cover every supported starting version.

## Concurrency review follow-up

The review found and corrected additional interleavings:

- Control snapshots advance the runtime revision even before a conversation has received its first input. Completed edit-stop receipts replay without revalidating a target that has since become historical.
- An editor and every outstanding control/save/refresh response belong to a particular browser-session and conversation incarnation. Leaving and returning to the same conversation does not revive an earlier request. Transport retries retain the exact operation ID and cannot cross an authentication scope change.
- A late save acknowledges only the version returned by that save. It never adopts a newer version announced by another device, so subsequent local changes still conflict correctly.
- Stopped-run presentation cleanup checks both the captured presentation generation and run identity. A successor announced during stop acknowledgement keeps its subscription, bubble and presence.
- Each resumed subscription owns its controller and cleanup closure. A predecessor completion cannot clear a successor subscription or cursor. Fallback run abort targets the sender's own run, not a newer ID stored for reconnect recovery.
- Conflicting realtime start notifications are checked against a fresh authoritative snapshot. Snapshots begun before intervening lifecycle events are retried; they cannot overwrite the newer event's state. Reconnecting to a successor retires the predecessor bubble before hydrating successor output.
- Hydration observes editor identity changes as well as text/attachment changes. A late local read cannot restore an editor the user has already cancelled or switched. Editor draft maps and submission guards include the browser-session namespace.
- If another device resumes the queue, a restored editor keeps its draft but cannot save until the user explicitly pauses again. Queued-input mutation also rejects rows bound to a previous transcript.

Deterministic tests use delayed HTTP responses, independent row versions, predecessor/successor subscriptions, stale lifecycle snapshots and delayed draft hydration to exercise these boundaries.

## Real-browser acceptance

Run `pnpm run build:node && pnpm run build:web`, then
`pnpm exec tsx scripts/verify-chat-input-control-browser.mts` from the repository root.
The script opens headed Chrome in two isolated browser contexts, starts an isolated production
Gateway and SQLite database, and uses a local controlled SSE model to hold and release actual
agent execution. UI, REST, realtime subscriptions and persistence use production code. It does
not contact a live inference provider or use the user's database. Set
`XOPC_INPUT_CONTROL_HEADLESS=1` for unattended runs and `XOPC_INPUT_CONTROL_EVIDENCE` to choose
the screenshot, trace, Gateway log and JSON result directory.

The scenarios cover Abort during output with queued follow-ups, Enter-based turn replacement,
follow-up save and draft restoration across reload, concurrent version conflicts, a delayed
stop acknowledgement crossing a successor start, another window resuming an edited row,
actual WebSocket closure followed by reconnect, refreshing a running successor, and a lost
HTTP acceptance response followed by reload and retry.

Browser testing found three additional gaps:

- A new page retained its persisted realtime sequence cursor without the corresponding
  in-memory output. A fresh presentation now replays from sequence zero; reconnecting with
  an existing matching presentation keeps its cursor.
- Queued submission regenerated its identity after an ambiguous HTTP failure. It now stores
  the complete command before POST, recovers accepted receipts before retrying, and reuses
  the original identity and versions only when the server reports `NOT_RECEIVED`. Confirmation
  removes only that command's identity, preserving a newer submission from another window.
  Background session hydration leaves append confirmation to the submit path so it cannot
  erase the command while the composer still displays an unconfirmed draft.

- A superseded stop reply reported its control conflict through the global agent failure
  banner. Control failures now use transient action feedback and cannot label a running
  successor as a failed AI request.
