# Discussion Capture MVP technical design

> Status: implemented MVP (phases 1–5), with automated and browser acceptance coverage.

## 1. Summary

Discussion Capture turns an ad-hoc workplace conversation into durable project context:

1. The user starts recording from the Web or Electron UI.
2. The client preserves audio locally while recording and uploads it after stop.
3. The gateway stores the audio as a note attachment and processes it asynchronously.
4. STT produces a transcript; a tool-free analyzer produces a structured draft.
5. The user reviews decisions and action items before they become committed project state.
6. Accepted action items can become project work items.
7. A reviewed discussion emits a minimal proactive event so follow-up suggestions can be generated without exposing the full transcript in the event stream.

The MVP deliberately treats a discussion as a workflow attached to a normal note. The note remains the user-facing and editable source of truth; the discussion record stores processing state, raw artifacts, and versioned machine projections.

## 2. Goals and non-goals

### 2.1 Goals

- Start a recording in at most two interactions from the global UI or a project page.
- Avoid losing an in-progress recording because a dialog closes, the route changes, or the renderer refreshes.
- Make transcription and analysis resumable after gateway or worker restart.
- Preserve the original audio and raw transcript independently of the generated summary.
- Let the user correct the summary, decisions, owners, and due dates before committing them.
- Attach the resulting note to a project using the canonical object-link model.
- Create project work items exactly once from accepted action items.
- Feed only reviewed, bounded metadata into proactive follow-up.
- Reuse the current Notes, STT, project work-item, activity, SSE, and proactive infrastructure.

### 2.2 Non-goals for MVP

- Live captions or streaming transcription.
- Speaker diarization, voice identity, or a durable people/relationship graph.
- Automatic attendee resolution from calendar or contacts.
- Recording system audio or a remote meeting stream.
- Mobile capture.
- Automatic external messages, task assignment notifications, or calendar writes.
- Recordings longer than 30 minutes.
- Word-level timestamps or transcript-to-audio seeking.

These exclusions keep the first release focused on a complete and reliable capture-to-context loop.

## 3. Existing capabilities to reuse

| Capability | Existing implementation | MVP use |
|---|---|---|
| Browser recording | `web/src/features/notes/quick-capture-bar.tsx` | Reuse MediaRecorder patterns, but replace the 30-second in-memory path with a discussion recorder and IndexedDB persistence. |
| Voice notes | `web/src/features/notes/notes-api.ts` and `src/notes/service.ts` | Store the recording as a normal note attachment. |
| Note metadata | `src/notes/types.ts` | Continue using `kind: "voice"`, attachment duration, and transcript-compatible fields. |
| Note Markdown patches | `src/notes/note-markdown.ts` | Build deterministic pending-review and reviewed note sections. |
| STT provider fallback | `src/voice/stt/transcribe-core.ts` | Call `transcribe()` internally from the discussion processor. |
| Project work items | Project domain services | Create accepted actions as work items when a project is selected. |
| Object relationships | `src/activity/service.ts` and `object_links` | Create `note belongs_to project` and `work_item created_from note` links. |
| Gateway SSE | `src/gateway/service/sse-hub.ts` | Notify clients that a discussion changed; clients refetch canonical state. |
| Proactive event spine | `src/proactive/` | Publish a bounded completion event into the `discussion_follow_up` scenario. |
| Electron quick capture | `electron/menu.ts` and `electron/preload.ts` | Open the same shared capture dialog from the existing menu action. |

Project Notes use the canonical `note belongs_to project` object link. Discussion Capture does not add synthetic compatibility tags or maintain a second project-association path.

## 4. Product-to-system flow

```mermaid
sequenceDiagram
    actor U as User
    participant UI as Web/Electron renderer
    participant IDB as IndexedDB draft store
    participant API as Gateway API
    participant N as Notes service
    participant W as Discussion worker
    participant STT as STT provider chain
    participant LLM as Analysis model
    participant P as Project/work-item service
    participant PA as Proactive pipeline

    U->>UI: Start recording
    UI->>IDB: Persist metadata and 5-second chunks
    U->>UI: Stop recording
    UI->>API: Create discussion (idempotent)
    API->>N: Create placeholder voice note
    API-->>UI: discussionId + noteId
    UI->>API: Upload assembled audio
    API->>N: Add attachment
    API->>W: Persist queued state
    API-->>UI: Upload acknowledged
    UI->>IDB: Delete local draft chunks
    W->>STT: Transcribe stored attachment
    STT-->>W: Raw transcript
    W->>LLM: Tool-free structured analysis
    LLM-->>W: Versioned JSON draft
    W->>N: Write pending-review Markdown
    W-->>UI: SSE discussion.updated
    UI->>API: Refetch and show review panel
    U->>API: Confirm edited decisions/actions
    API->>N: Write reviewed Markdown
    API->>P: Create accepted work items exactly once
    API->>PA: Publish discussion.completed.v1
    API-->>UI: Completed discussion and links
```

## 5. Core design decisions

### 5.1 A discussion is a workflow around a note

The system does not introduce a second user-facing document type. On creation it makes a placeholder voice note, then progressively enriches that note.

- Note Markdown is the canonical user-editable representation.
- The audio attachment is the evidence artifact.
- The discussion row is the workflow state and retry ledger.
- `analysis_json` is a versioned machine proposal, not committed project truth.
- Project association is represented only by `object_links`.

This lets existing note lists, search, export, and project surfaces benefit without duplicating document behavior.

### 5.2 Recording safety is client-side; processing durability is server-side

The client writes chunks to IndexedDB while MediaRecorder is running. The server becomes authoritative only after it acknowledges the uploaded attachment. The client must not remove local chunks before that acknowledgement.

The gateway persists processing state in SQLite. STT and model calls happen outside database transactions and can resume by stage after a crash.

### 5.3 User review is the commitment boundary

The analyzer may suggest decisions, owners, due dates, and actions, but it does not create work items or trigger proactive action before review. Only `discussion.completed.v1` is eligible to trigger the proactive follow-up scenario.

### 5.4 SSE is invalidation, not storage

The server emits `discussion.updated`; the Web client receives `discussion-updated` and refetches `GET /api/discussions/:id`. Missing an SSE event cannot cause state loss.

## 6. User experience and client states

### 6.1 Entry points

- Global app shell: microphone action labeled “Record discussion”.
- Project detail Notes tab: the same action, with `projectId` preselected.
- Notes workbench: adjacent to the existing short voice-note capture.
- Electron File menu quick-capture action: open the shared dialog.
- Optional MVP shortcut: `Cmd/Ctrl+Shift+R` while the app is focused. A system-global shortcut is deferred.

The existing 30-second voice-note action remains useful for quick personal dictation. Discussion Capture is a separate, longer-running workflow with explicit review.

### 6.2 Dialog states

```text
idle
  -> requesting_permission
  -> recording <-> paused
  -> preparing_upload
  -> uploading
  -> submitted

Any pre-submit state -> recoverable_error or discarded
```

The dialog uses a fixed responsive outer size with a fixed header/footer and an internally scrolling body. Project and language selectors use the project-owned select components. Data restoration and processing views use skeletons rather than page-level spinners.

### 6.3 Recording behavior

- Use `MediaRecorder.start(5_000)` to receive bounded chunks.
- Preferred MIME order:
  1. `audio/webm;codecs=opus`
  2. `audio/mp4`
  3. `audio/ogg;codecs=opus`
- Request 48–64 kbps audio where supported.
- Hard-stop at 30 minutes for MVP.
- Persist each chunk with a monotonically increasing index.
- Update elapsed time in memory; periodically persist duration metadata.
- Check `navigator.storage.estimate()` before recording and fail early when available space is clearly insufficient.
- Show explicit states for denied permission, missing microphone, interrupted device, quota exhaustion, and upload failure.

At 64 kbps, a 30-minute recording is approximately 14.4 MB before container overhead, below the existing 25 MB note media limit. The server remains authoritative and rejects payloads above its configured limit.

### 6.4 IndexedDB draft store

Create a database named `xopc-discussion-drafts` with two stores:

```typescript
interface DiscussionDraft {
  id: string;
  projectId?: string;
  title?: string;
  language: string;
  mimeType: string;
  startedAt: number;
  updatedAt: number;
  durationMs: number;
  chunkCount: number;
  state: 'recording' | 'stopped' | 'upload_failed';
  serverDiscussionId?: string;
}

interface DiscussionDraftChunk {
  draftId: string;
  index: number;
  blob: Blob;
  createdAt: number;
}
```

On application startup, stopped or interrupted drafts are surfaced as “unfinished recording found”. The user may submit, replay, or discard them. Draft deletion is explicit or happens only after the server confirms attachment persistence.

For Electron MVP, the renderer uses the same implementation. A later native capture sink can stream chunks to an Electron main-process file without changing the gateway contract.

## 7. Gateway API

All routes require the same gateway authentication as existing note routes. Responses should use existing gateway JSON/error conventions.

### 7.1 Create an upload target

`POST /api/discussions`

```json
{
  "clientRequestId": "01J...",
  "projectId": "project-id-or-null",
  "title": "Optional working title",
  "language": "auto",
  "captureMode": "conversation",
  "consentConfirmed": true
}
```

- `clientRequestId` is unique per local draft and makes retries idempotent.
- `consentConfirmed` is required when `captureMode` is `conversation`.
- The route creates the discussion row and placeholder note in one SQLite write transaction.
- If a project is selected, it creates the canonical `note belongs_to project` link.

Response:

```json
{
  "discussion": { "id": "...", "status": "awaiting_upload", "noteId": "..." },
  "note": { "id": "...", "kind": "voice" }
}
```

### 7.2 Upload audio

`POST /api/discussions/:id/audio`

Multipart fields:

- `file`: required audio blob.
- `durationMs`: required integer.
- `mimeType`: optional override; the server validates against the uploaded file.

The route:

1. Streams or reads the bounded upload according to the existing gateway body-limit pattern.
2. Computes byte size and SHA-256.
3. Adds the attachment to the placeholder note.
4. Moves the discussion from `awaiting_upload` to `queued`.
5. Returns only after the attachment and queued state are durable.

Repeated uploads with the same discussion and audio hash return the existing result. A conflicting second hash returns `409` unless the caller explicitly replaces audio before processing starts.

The worker reads this stored attachment directly. The client does not call `/api/voice/transcriptions`, avoiding a second audio upload and preserving resumability.

### 7.3 Read and list

- `GET /api/discussions/:id`
- `GET /api/discussions?status=active&projectId=...&limit=...&offset=...`

The detail response includes processing status, note and project identifiers, bounded error information, transcript/analysis only when the caller is authorized to read the note, and the current review version.

### 7.4 Retry and cancel

- `POST /api/discussions/:id/retry`
- `POST /api/discussions/:id/cancel`

Retry is stage-aware:

- Existing transcript: resume at analysis.
- Existing audio but no transcript: resume at transcription.
- Missing audio: return a permanent `audio_missing` error.

Cancel prevents new processing but does not silently delete the note or audio.

### 7.5 Review

`PUT /api/discussions/:id/review`

```json
{
  "expectedRevision": 0,
  "analysis": {
    "summary": "...",
    "keyPoints": [],
    "decisions": ["Adopt staged rollout"],
    "actionItems": [{ "id": "a1", "title": "Add p95 latency dashboard", "owner": "Alex" }],
    "risks": [],
    "openQuestions": []
  }
}
```

Saving review data updates the managed note section with optimistic concurrency. Finalization is a separate idempotent request:

`POST /api/discussions/:id/complete`

```json
{ "expectedRevision": 1, "actionItemIds": ["a1"] }
```

Completion:

1. Verify status and optimistic review revision.
2. Persist the reviewed projection.
3. Replace generated note sections deterministically.
4. For a project-associated discussion, create one work item per accepted action when requested.
5. Record each action-to-work-item conversion under a uniqueness constraint.
6. Create `work_item created_from note` links.
7. Mark the note processed and the discussion complete.

After commit, publish SSE and proactive events. Retrying completion does not duplicate work items or events. Without a selected project, actions remain in the note and work-item selection is disabled.

Project work items are created through a transaction-aware form of `WorkItemService.createProjectWorkItem`. The existing work-item owner field represents an xopc agent, not an arbitrary coworker, so an unresolved human `ownerLabel` must remain in the note and work-item description; it must not be copied into `ownerAgentId`. A confirmed due date may be converted to `dueAt`.

Each work-item, conversion record, and object link is committed in one SQLite transaction. Cross-system `discussion.completed.v1` publication occurs only after final state persistence.

### 7.6 Audio deletion

`DELETE /api/discussions/:id/audio`

Audio may be removed whenever the worker is not actively processing it. The note and transcript remain, and `audio_deleted_at` records the explicit privacy action. Deletion is idempotent and removes the attachment reference from Markdown.

### 7.7 Operational metrics

`GET /api/discussions/metrics` returns total and per-status counts plus average time to review and completion. It contains no transcript, analysis text, or recording metadata.

## 8. Persistence model

Add the next available SQLite migration, currently expected to be `078`, and update `src/storage/sqlite/schema.sql` so clean databases and upgraded databases match.

### 8.1 `discussion_captures`

```sql
CREATE TABLE discussion_captures (
  id TEXT PRIMARY KEY,
  client_request_id TEXT NOT NULL UNIQUE,
  note_id TEXT NOT NULL UNIQUE,
  project_id TEXT,
  audio_attachment_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'awaiting_upload',
    'queued',
    'transcribing',
    'analyzing',
    'review_required',
    'completed',
    'failed',
    'cancelled'
  )),
  failed_stage TEXT,
  capture_mode TEXT NOT NULL,
  consent_confirmed INTEGER NOT NULL DEFAULT 0,
  language_hint TEXT,
  duration_ms INTEGER,
  mime_type TEXT,
  audio_size_bytes INTEGER,
  audio_sha256 TEXT,
  transcript_raw TEXT,
  transcript_sha256 TEXT,
  transcript_language TEXT,
  stt_provider TEXT,
  analysis_json TEXT,
  analysis_version INTEGER NOT NULL DEFAULT 0,
  analysis_input_hash TEXT,
  analyzer_model_ref TEXT,
  review_json TEXT,
  review_revision INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  reviewed_at INTEGER,
  audio_deleted_at INTEGER
);

CREATE INDEX idx_discussion_captures_queue
  ON discussion_captures(status, next_attempt_at, created_at);

CREATE INDEX idx_discussion_captures_project
  ON discussion_captures(project_id, updated_at DESC);
```

`project_id` is intentionally a logical reference rather than a new ownership model. Project membership remains canonical in `object_links`, and service-level validation confirms the project exists.

### 8.2 `discussion_action_conversions`

```sql
CREATE TABLE discussion_action_conversions (
  discussion_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  work_item_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (discussion_id, action_id)
);

CREATE UNIQUE INDEX idx_discussion_action_work_item
  ON discussion_action_conversions(work_item_id);
```

This table is the exactly-once barrier for review retries. Action IDs are stable inside one analysis version and are preserved when the user edits text.

## 9. Server-side architecture

Add a new domain module:

```text
src/discussions/
  analyzer.ts
  events.ts
  markdown.ts
  processor.ts
  repository.ts
  service.ts
  types.ts
  worker.ts
```

### 9.1 Responsibilities

| Component | Responsibility |
|---|---|
| `DiscussionRepository` | CRUD, optimistic revisions, queue claims, leases, and stage transitions. |
| `DiscussionService` | Create/upload/retry/cancel/review commands and cross-domain invariants. |
| `DiscussionProcessor` | Orchestrate one claimed row through STT and analysis. |
| `DiscussionWorker` | Poll, lease, retry with backoff, and recover expired leases. |
| `DiscussionAnalyzer` | Convert untrusted transcript text to validated versioned JSON without tools. |
| `discussion-markdown` | Deterministically render pending-review and reviewed note sections. |
| `discussion-events` | Build activity and proactive envelopes without transcript payloads. |

Gateway routes live with the existing Hono routes, for example `src/gateway/hono/routes/discussions.ts`. Gateway startup owns one worker instance, similar to other durable workers.

### 9.2 Durable state machine

```mermaid
stateDiagram-v2
    [*] --> awaiting_upload
    awaiting_upload --> queued: audio stored
    queued --> transcribing: lease acquired
    transcribing --> analyzing: transcript stored
    analyzing --> review_required: analysis and note stored
    review_required --> completed: user review committed

    queued --> failed: permanent/retry exhausted
    transcribing --> failed: permanent/retry exhausted
    analyzing --> failed: permanent/retry exhausted

    failed --> queued: retry transcription
    failed --> analyzing: retry with existing transcript

    awaiting_upload --> cancelled
    queued --> cancelled
    review_required --> cancelled
```

Every transition uses a conditional update from the expected prior state. The worker claims eligible rows with a bounded lease. Expired `transcribing` or `analyzing` leases are reclaimed on startup or the next poll.

Do not hold a write transaction during file IO, STT, or model calls. Persist the output of each expensive stage before proceeding to the next one.

### 9.3 Retry policy

- Retry transient provider, network, timeout, and rate-limit failures with exponential backoff and jitter.
- Default to three automatic attempts per failed stage.
- Treat unsupported media, empty audio, invalid project, deleted attachment, and explicit provider authentication failures as permanent until configuration or input changes.
- Store a bounded user-safe error message and structured error code.
- Preserve raw provider errors in structured logs only after normal redaction.
- Hash stage inputs to avoid recomputing an already persisted equivalent result.

### 9.4 STT execution

The processor reads the stored note attachment and calls `transcribe()` from `src/voice/stt/transcribe-core.ts`, preserving configured provider fallback. It does not use the public voice route and does not pin one provider.

The existing short-voice default timeout is not sufficient for a 30-minute discussion. Add a discussion-specific configurable timeout, initially 10 minutes, without changing short voice-note behavior. Abort the provider request when a job is cancelled or its lease is no longer valid.

MVP stores a full raw transcript only. The current STT result does not expose stable timestamp segments, so the UI must not imply word-level playback alignment or speaker identity.

### 9.5 Structured analysis

The analyzer is tool-free and initially uses the agent manifest's `small` typed model role, with a dedicated configuration override for deployments that need another role.

Version 1 output:

```typescript
interface DiscussionAnalysisV1 {
  schemaVersion: 1;
  title: string;
  summary: string;
  participants: Array<{
    label: string;
    personId: string | null;
  }>;
  decisions: Array<{
    id: string;
    text: string;
    confidence: number;
    evidence?: string;
  }>;
  actionItems: Array<{
    id: string;
    text: string;
    ownerLabel: string | null;
    personId: string | null;
    dueDate: string | null;
    confidence: number;
    evidence?: string;
  }>;
  risks: Array<{ id: string; text: string; evidence?: string }>;
  openQuestions: Array<{ id: string; text: string; evidence?: string }>;
}
```

Rules enforced by prompt and validation:

- Transcript content is untrusted data, not model instruction.
- Do not invent names, decisions, owners, or dates.
- Distinguish suggestions from agreed decisions.
- Use `null` when an owner or due date is not explicit.
- Keep evidence excerpts bounded and never publish them to proactive events.
- Return JSON matching the schema, with no Markdown wrapper.

Validate with Zod. Allow one bounded schema-repair attempt, then move to a recoverable analysis failure. Render Markdown in code from validated JSON; do not ask the model to author the canonical note body.

### 9.6 Note rendering

After upload, the note contains an audio attachment and a processing banner. After analysis, generated sections are marked as pending review:

```markdown
# API latency investigation

> Discussion analysis pending confirmation.

## Summary
...

## Decisions
- [ ] ...

## Action items
- [ ] ... — Owner: unconfirmed — Due: unconfirmed

## Risks and open questions
...

## Transcript
...
```

On review, replace only the managed generated sections, remove the pending banner, and preserve user-authored content outside those sections. The renderer must be deterministic and idempotent.

## 10. Project, activity, and object-link integration

### 10.1 Project association

For a project-associated capture:

- Create `note belongs_to project` with source `user`.
- Add stable project scope to activity events.
- Project note queries resolve membership through `object_links`.
- When accepted actions become work items, create `work_item created_from note`.

The MVP should not create a new Activity object kind for discussion. The note is the primary object.

### 10.2 Activity events

Recommended activity event types:

- `note.discussion_recorded`
- `note.discussion_analyzed`
- `note.discussion_reviewed`

The primary object is the note. Related objects include the project and created work items. Payloads contain counts and processing metadata, not full transcript or audio.

## 11. Proactive integration

The `discussion_follow_up` scenario is separate from `meeting_preparation`: one prepares before a scheduled event, while the other identifies missing ownership, deadlines, unresolved questions, and stalled follow-up after a reviewed discussion.

Gateway startup creates one enabled workspace subscription when none exists for the current workspace. An existing subscription, including a disabled one, is preserved so user preference remains authoritative.

Only a successful review publishes the canonical trigger:

```json
{
  "type": "discussion.completed.v1",
  "schemaVersion": 1,
  "source": { "kind": "internal", "id": "discussions" },
  "subject": { "kind": "discussion", "id": "discussion-id" },
  "actor": { "kind": "system" },
  "scope": { "workspaceId": "/workspace", "agentId": "main", "projectId": "optional-project-id" },
  "occurredAt": "2026-08-15T10:00:00.000Z",
  "dedupeKey": "product-event:discussion.completed:discussion-id:1786762800000",
  "sensitivity": "personal",
  "payload": {
    "discussionId": "discussion-id",
    "noteId": "note-id",
    "projectId": "optional-project-id",
    "actionCount": 3,
    "unownedActionCount": 1,
    "undatedActionCount": 2,
    "riskCount": 1,
    "openQuestionCount": 2
  }
}
```

The event does not carry transcript, summary text, participant names, or evidence excerpts. An authorized context provider may resolve the note or discussion record when the scenario runs.

Scenario policy:

- Dedupe the completion event and emit at most one insight per completion.
- Prefer suggestions such as confirming an owner, adding a deadline, resolving an open question, or checking progress later.
- Never send a message, assign a person, or change a deadline automatically.
- Respect existing proactive suppression, deduplication, sensitivity, and user preference policies.

`discussion.analysis_ready.v1` may be emitted for internal observability, but it must not trigger proactive user-facing action.

## 12. Web and Electron implementation layout

```text
web/src/features/discussions/
  discussion-api.ts
  discussion-capture-dialog.tsx
  discussion-draft-store.ts
  discussion-processing-card.tsx
  discussion-review-panel.tsx
  discussion-types.ts
  use-discussion-recorder.ts
```

Integration points:

- App shell owns one global dialog host so route changes do not close the recorder.
- Project detail supplies the current project as the default.
- Notes workbench can open the dialog without enabling every existing media-capture control.
- Electron's existing `menu:quick-capture` event opens this dialog.
- Gateway SSE bridge listens for `discussion-updated` and invalidates relevant detail, note, project, and work-item queries.

The recording hook owns MediaRecorder and IndexedDB writes. The dialog owns user interaction. API code owns idempotency identifiers, upload progress, and refetch. Keeping these concerns separate makes a future Electron native sink possible.

Electron packaging must include an understandable microphone usage description on macOS and validate microphone permission behavior in signed builds.

## 13. Privacy and security

- Conversation mode requires an explicit acknowledgement that participants have been informed or consent was obtained as required by the user's jurisdiction and workplace policy.
- Mark discussion-derived proactive events as `personal` and keep their payload text-free.
- Never log raw audio, full transcripts, provider authorization, or complete model prompts.
- Use bounded previews only when operationally necessary and apply existing logger redaction.
- Audio is sent only to the configured STT provider chain; the UI should disclose that configured providers may be remote.
- Treat transcripts as prompt-injection-capable untrusted input.
- Analysis uses no tools and cannot write external systems.
- Review is required before creating work items or proactive triggers.
- Provide explicit audio deletion after transcription and make deletion state visible.
- Enforce authentication, body limits, MIME validation, and project access on every route.

MVP default retention is to keep audio until the user deletes it. A configurable automatic retention policy can follow after the initial release, once deletion semantics and audit requirements are agreed.

## 14. Observability

Use stable logger prefixes such as `DiscussionService`, `DiscussionWorker`, and `DiscussionAnalyzer`. Follow object-first structured logging.

Useful fields:

- `discussionId`, `noteId`, `projectId`
- `status`, `stage`, `attemptCount`
- `audioSizeBytes`, `durationMs`
- `provider`, `modelRef`
- `transcriptionDurationMs`, `analysisDurationMs`, `endToEndDurationMs`
- `errorCode`, `phase`

Metrics:

- Recording starts, stops, permission failures, and recovered drafts.
- Upload success/failure and byte distribution.
- Queue depth and age.
- STT and analysis latency by provider/model.
- Stage retries, permanent failures, and expired leases.
- Review completion rate and time-to-review.
- Accepted/edited/rejected action counts.
- Work items created per reviewed discussion.
- Follow-up insights produced and dismissed.

Audio and transcript content must never be metric labels.

## 15. Testing strategy

### 15.1 Unit tests

- Valid and invalid state transitions.
- Lease claim, expiration, and stage-aware retry.
- Analysis schema parsing and one-time repair behavior.
- Deterministic Markdown rendering and preservation of user sections.
- Review optimistic concurrency.
- Action conversion uniqueness.
- Proactive event redaction and dedupe-key stability.

### 15.2 Gateway and integration tests

- Idempotent create with the same `clientRequestId`.
- Audio body limit, MIME validation, hash deduplication, and unauthorized access.
- Upload acknowledgement occurs only after durable attachment and queued state.
- Worker restart after transcript persistence resumes at analysis.
- Repeated review creates no duplicate work items or events.
- Project deletion or missing project produces a safe conflict.
- Audio deletion preserves note and transcript.
- Migration works for existing databases; bootstrap schema matches migrated schema.

### 15.3 Web tests

- Recorder state transitions and permission failures.
- Five-second chunk persistence and ordered reassembly.
- Renderer reload restores an unfinished draft.
- Local chunks remain after upload failure and disappear after acknowledgement.
- SSE invalidation refetches discussion state.
- Project-prefilled capture and review editing behavior.

### 15.4 Manual release checks

- Chrome, Edge, Safari where supported, and packaged Electron.
- macOS microphone permission before and after denial.
- Route changes and dialog close while recording.
- Gateway restart during transcription and analysis.
- A synthetic 5-minute recording through the full note/project/work-item path.

## 16. Rollout and delivery plan

The feature is delivered as five independently reviewed phases:

### Phase 1 — Durable domain and API

- Add migrations, repository, types, state machine, and route skeletons.
- Create placeholder notes and canonical project links.
- Add authenticated create/read/upload/retry/cancel APIs.
- Add migration, state transition, and route tests.

### Phase 2 — Safe Web/Electron capture

- Implement the shared recorder, IndexedDB draft store, upload progress, and recovery UI.
- Integrate app shell, project page, notes workbench, and Electron menu.
- Validate the 30-minute size envelope and microphone permissions.

### Phase 3 — Transcription and analysis worker

- Add durable worker leases and stage-aware retries.
- Reuse STT fallback with a discussion-specific timeout.
- Add tool-free structured analysis and deterministic note rendering.
- Emit `discussion.updated` and implement client refetch.

### Phase 4 — Review and project actions

- Add review UI and optimistic versioning.
- Create accepted project work items exactly once.
- Add object links and activity events.

### Phase 5 — Proactive follow-up and hardening

- Publish `discussion.completed.v1`.
- Add the `discussion_follow_up` scenario through migration 079.
- Add privacy copy, explicit recording deletion, bounded metrics, and failure recovery.

Each phase is independently deployable. Disabling the worker leaves queued records durable; disabling the UI does not delete notes, audio, or completed analysis.

## 17. MVP acceptance criteria

- A user can record up to 30 minutes from Web or Electron and see upload progress.
- Closing the dialog or refreshing the renderer does not silently lose locally persisted chunks.
- A successful upload creates a visible voice note and survives gateway restart.
- Transcription and analysis run asynchronously and resume from the last completed stage.
- The note contains audio, raw transcript, summary, decisions, actions, risks, and open questions.
- Suggested owners and dates are visibly unconfirmed unless explicit in the transcript.
- The user can edit and confirm the generated structure.
- Confirmed project actions create work items once, even after request retry.
- The note is linked to its project canonically and appears in the current project Notes UI.
- Only reviewed discussions trigger proactive follow-up.
- No proactive or activity event contains the full transcript or audio.
- The user can delete original audio without deleting reviewed note content.

## 18. Deferred evolution

The design leaves room for later additions without making them MVP dependencies:

- Timestamped transcript segments and audio seeking.
- Speaker diarization and user-confirmed speaker labels.
- A person/relationship graph with confidence and provenance.
- Calendar-based project and participant suggestions.
- Native Electron background recording and global shortcuts.
- Mobile capture and resumable multipart uploads.
- Configurable audio retention and local-only transcription providers.
- Long-running meeting support and streaming STT.

Person identity fields are therefore nullable and unresolved in v1. The system should never infer a durable coworker identity from a speaker label without explicit user confirmation.
