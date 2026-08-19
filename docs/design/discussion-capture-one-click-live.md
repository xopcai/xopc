# One-click live discussion capture

> Status: implementation design for the next discussion-capture iteration.

## 1. Task

The normal path has exactly two user actions:

1. Click **Record discussion**.
2. Click **Finish**.

The application starts recording immediately, creates a note in the background,
shows a near-real-time transcript inside the note experience, and finalizes the
title, transcript, summary, decisions, actions, risks, and project association
after recording stops.

The initial topic, project, language, and recording-type form is removed. There
is no dedicated review workflow; the final note itself is the correction
surface.

## 2. Clean-cut implementation rule

This iteration is a direct replacement, not a compatibility release:

- Remove the old setup dialog, its form state, validation, and submit API.
- Remove old capture states and branches that the new state machine does not
  use. Do not retain aliases or state translation at runtime.
- Remove the dedicated discussion review route and action-selection workflow.
  Corrections happen through the normal note editor.
- Replace old request and response shapes in place. Do not version, dual-write,
  or keep alternate endpoints for the former UI.
- Rebuild development schema/data through one forward migration. Do not add
  runtime compatibility code for records created by the unreleased flow.
- Reuse a current primitive only when it directly serves the new design; remove
  wrappers and branches whose only purpose was the previous interaction.

Offline recording, retry, idempotency, and final-STT repair are required
reliability properties of the new path. They are not compatibility behavior.

## 3. Product boundaries

- Microphone permission is controlled by the browser or operating system and
  cannot be skipped.
- Participant-consent acknowledgement is shown once per policy version. It is
  not inferred by a model. Existing acknowledgement, including a later opt-out,
  remains authoritative.
- AI may automatically perform reversible internal actions: generate a title,
  update a note, and suggest or change a project association with Undo.
- External messages, calendar writes, person assignment, and other irreversible
  actions still require explicit confirmation.
- Speaker identity and a durable people graph remain out of scope.

## 4. User flow

```mermaid
sequenceDiagram
    actor U as User
    participant UI as Global capture host
    participant IDB as IndexedDB
    participant API as Gateway
    participant LIVE as Live segment worker
    participant NOTE as Notes
    participant FINAL as Finalization worker

    U->>UI: Click Record discussion
    UI->>UI: Request microphone and start immediately
    UI->>IDB: Persist original 5-second chunks
    UI->>API: Create recording session and placeholder note
    API-->>UI: discussionId and noteId
    loop Every 20 seconds
        UI->>IDB: Persist self-contained PCM segment
        UI->>API: Upload segment with sequence number
        API->>LIVE: Claim next ordered segment
        LIVE->>LIVE: Transcribe segment
        LIVE-->>UI: discussion.transcript.updated
        UI->>NOTE: Render persisted live transcript projection
    end
    U->>UI: Click Finish
    UI->>API: Upload final original recording
    UI->>API: Finish with final sequence fence
    API->>FINAL: Queue authoritative finalization
    FINAL->>FINAL: Full-audio STT and structured analysis
    FINAL->>NOTE: Write final title and managed Markdown once
    FINAL-->>UI: discussion.completed
```

## 5. Client architecture

### 5.1 Global host

`GlobalDiscussionCaptureHost` remains mounted under `AppShell`, so route changes
do not stop recording. The `openDiscussionCapture()` event becomes a start
command rather than a command to open a setup dialog.

The event may carry only passive context:

```ts
type DiscussionStartContext = {
  projectId?: string; // Present when invoked from a project page.
  source: 'web' | 'electron';
};
```

The global host renders a compact floating recorder with elapsed time, the last
few transcript lines, Pause, Finish, and a link to the note. It does not render
topic, project, language, or recording-type controls.

Delete `DiscussionCaptureDialog` once the compact recorder replaces it. Do not
keep two start flows or a compatibility switch.

### 5.2 Local recording and recovery

Keep the existing `MediaRecorder` path as the original evidence recording:

- 64 kbps where supported.
- Five-second chunks persisted to `xopc-discussion-drafts`.
- Local chunks are deleted only after the final audio upload and finish request
  are acknowledged.
- If the gateway is unavailable, recording continues locally and server session
  creation/upload is retried in order.

Simplify `useDiscussionRecorder.start()` to receive passive context only. It
always uses automatic language detection and begins with an inferred recording
mode of `unknown`.

### 5.3 Live STT audio path

Individual `MediaRecorder` timeslices are not guaranteed to be independently
decodable containers. Do not send arbitrary five-second WebM/MP4 chunks to STT.

Use a parallel `AudioWorklet` only for live transcription:

- Mono PCM, downsampled to 16 kHz, signed 16-bit.
- Emit a self-contained WAV segment every 20 seconds.
- Carry one second of overlap to reduce word loss at boundaries.
- Keep MediaRecorder running continuously; AudioWorklet does not own the
  authoritative recording.
- If AudioWorklet or live STT is unavailable, continue recording and fall back
  to final transcription without asking the user to choose a mode.

A 20-second WAV segment is about 640 KB. Only a small upload queue is kept in
memory; every pending segment is also stored in IndexedDB until acknowledged.

### 5.4 Client modules

```text
web/src/features/discussions/
  global-discussion-capture.tsx      # start command + compact recorder
  discussion-mini-recorder.tsx       # recording-only UI
  discussion-consent-sheet.tsx       # first use / policy change only
  use-discussion-recorder.ts          # MediaRecorder evidence path
  use-live-transcript.ts              # AudioWorklet + ordered upload queue
  discussion-draft-store.ts           # evidence and pending live segments
  discussion-api.ts
  discussion-events.ts
```

## 6. Server API

Replace the current UI-oriented create payload with a context-only contract:

### 6.1 Create recording

`POST /api/discussions`

```json
{
  "clientRequestId": "stable-local-draft-id",
  "source": "web",
  "contextProjectId": "optional-current-project-id",
  "consentPolicyVersion": 1
}
```

The request is idempotent. It creates:

- A discussion in `recording` state.
- A voice note with a deterministic placeholder such as
  `Discussion · 2026-08-15 14:30`.
- A canonical `note belongs_to project` link when project context is explicit.

No model call occurs on the click path.

### 6.2 Upload live segment

`PUT /api/discussions/:id/segments/:sequence`

Multipart fields:

- `file`: self-contained WAV segment.
- `startedAtMs`, `endedAtMs`.
- `sha256`.
- `isFinal`: optional boolean.

`discussionId + sequence` is unique. Repeating the same sequence and hash
returns the stored result; a different hash returns `409`.

The server accepts bounded out-of-order uploads but the worker transcribes and
publishes them strictly by sequence.

### 6.3 Finish

`POST /api/discussions/:id/finish`

```json
{
  "lastSequence": 17,
  "durationMs": 358000
}
```

The authoritative original is uploaded through the new
`PUT /api/discussions/:id/recording` endpoint. Uploading it does not start final
processing while the capture is still `recording`. `finish` is the fence that
verifies the original exists, records the expected last live sequence, and
moves the capture to `finalizing`.

### 6.4 Read live transcript

`GET /api/discussions/:id/transcript`

Returns ordered persisted segments and an assembled provisional transcript.
It never returns audio bytes.

### 6.5 Consent preference

- `GET /api/discussion-capture/settings`
- `PUT /api/discussion-capture/settings`

The setting records `consentPolicyVersion` and `consentAcknowledgedAt`. The
first click opens the consent sheet only when the current version has not been
acknowledged. Subsequent clicks start recording immediately.

## 7. Persistence

Use migration 080 and update the clean schema.

### 7.1 Discussion state

Rebuild `discussion_captures` around the new state model. Remove former setup
fields such as user-entered topic, language choice, capture mode, inline consent
checkbox, review status, and selected-action state. Keep only data used by the
new capture and finalization pipeline. Add:

```sql
recording_started_at       INTEGER,
recording_finished_at      INTEGER,
expected_last_sequence    INTEGER,
live_title_generated_at   INTEGER,
project_inference_score   REAL,
project_inference_source  TEXT,
finalization_revision     INTEGER NOT NULL DEFAULT 0
```

The state machine is:

```text
recording
  -> finalizing
  -> completed

recording/finalizing -> failed -> retry from persisted processing_stage
recording -> cancelled
```

`status` is limited to `recording | finalizing | completed | failed |
cancelled`. `processing_stage` records the resumable finalization step:
`original_upload | final_transcription | analysis | note_write`. There are no
`queued`, `transcribing`, or `review` compatibility states.

### 7.2 Transcript segments

```sql
CREATE TABLE discussion_transcript_segments (
  discussion_id   TEXT NOT NULL,
  sequence        INTEGER NOT NULL,
  audio_sha256    TEXT NOT NULL,
  started_at_ms   INTEGER NOT NULL,
  ended_at_ms     INTEGER NOT NULL,
  status          TEXT NOT NULL,
  transcript      TEXT,
  provider        TEXT,
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  lease_owner     TEXT,
  lease_expires_at INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (discussion_id, sequence),
  FOREIGN KEY (discussion_id) REFERENCES discussion_captures(id) ON DELETE CASCADE
);
```

Segment audio is temporary processing material. Delete it after authoritative
finalization or explicit original-audio deletion. Transcript rows remain as an
audit/recovery projection until the discussion is deleted.

### 7.3 Capture settings

Store one workspace-scoped settings record containing only policy version and
acknowledgement timestamp. Do not store this only in browser localStorage;
Electron and Web must share the same preference.

## 8. Live processing

Add `DiscussionLiveWorker`, separate from the finalization worker so a
long final transcription cannot block an active recording.

For each discussion, it claims only the lowest uploaded sequence after the last
completed sequence. It:

1. Runs the existing configured STT provider chain on the WAV segment.
2. Removes duplicated overlap using normalized suffix/prefix token matching.
3. Stores the provisional text on the segment row.
4. Emits `discussion.transcript.updated` containing IDs and sequence only.

The event carries no transcript text. Clients refetch canonical transcript
state through the authenticated API.

Failure of live transcription never stops recording. Retry each segment with a
bounded backoff; after exhaustion, mark that segment failed and continue. The
authoritative final pass repairs gaps.

## 9. Note projection

Do not update Note Markdown for every segment. `NotesService.updateNote()`
currently creates snapshot/activity/version effects for content changes, which
would create noisy history and concurrent-write conflicts.

During recording, the Note page renders a `LiveDiscussionTranscript` projection
from `discussion_transcript_segments` inside the note experience. It displays
“Draft live transcript” and the recording state.

Persist to the canonical note only twice at most:

1. Optional first title update after enough live text exists.
2. Final title plus final managed Markdown after full-audio processing.

The final writer keeps the existing managed-section markers so user-authored
content outside the section is preserved.

## 10. AI enrichment

### 10.1 Early title

After at least two completed live segments or 80 normalized characters, run one
small-model structured call:

```ts
type LiveEnrichment = {
  title: string;
  projectCandidateId?: string;
  projectConfidence?: number;
};
```

Do not call the model on every segment. The finalizer may replace the early
title once using the complete transcript.

### 10.2 Project inference

Use this precedence order:

1. Explicit project-page context: link immediately, confidence 1.0.
2. Exact normalized project-name mention: auto-link.
3. Model ranking over a bounded project catalog.

Model-ranked association is applied only when confidence is at least 0.85 and
the margin over the second candidate is at least 0.15. Emit a reversible toast:
“Linked to Project X · Undo”. Otherwise leave the note unassigned without
interrupting the user.

No compatibility tags are created. Association continues to use the canonical
object link and `discussion_captures.project_id`.

### 10.3 Finalization

The final original audio remains authoritative. On finish:

1. Run full-audio STT once.
2. Run structured discussion analysis once.
3. Generate the final title and project inference.
4. Replace the provisional projection with final managed Markdown.
5. Mark the note processed and discussion completed.
6. Emit the bounded `discussion.completed.v1` proactive event.

Completion is automatic. Users correct results directly in the normal note
editor; there is no discussion-specific review page or review status.

Do not automatically send messages or assign a human. Initially keep extracted
actions in the note; enable automatic task creation only after internal
data shows acceptable precision and Undo semantics are available.

## 11. Ordering, idempotency, and concurrency

- Local draft ID is the create idempotency key.
- Segment identity is `(discussionId, sequence, sha256)`.
- `finish.lastSequence` is a durable fence; finalization may start before every
  live segment succeeds because final audio is authoritative.
- Per-discussion user mutations use one mutation queue.
- Segment workers use SQLite leases and compare-and-set status transitions.
- Final note write is guarded by `analysis_input_hash` and
  `finalization_revision`.
- SSE is invalidation only; the database is authoritative.

## 12. Failure behavior

| Failure | User-visible behavior | Recovery |
|---|---|---|
| Microphone denied | Compact recorder shows permission action | Retry permission |
| Gateway offline | Recording continues locally | Ordered background upload |
| Live STT unavailable | “Recording; transcript after finish” | Final full-audio STT |
| One segment fails | Visible provisional gap, recording continues | Bounded retry; final repair |
| Early title fails | Timestamp placeholder remains | Final title generation |
| Project confidence low | Note stays unassigned | Optional later suggestion |
| Finalization fails | Note and audio remain, failure state shown | Retry from `processing_stage` |
| Renderer restarts | Recoverable draft is surfaced | Resume upload or discard |

## 13. Privacy and security

- Never log segment audio, transcript text, or model prompt contents.
- Keep live SSE payloads text-free.
- Validate authentication, MIME, duration, sequence bounds, and per-segment
  size on every endpoint.
- Conversation consent is a versioned user acknowledgement, never an AI claim.
- Provide one explicit original-recording deletion control.
- Deleting original audio also removes temporary live segment audio.
- Remote STT provider disclosure remains visible in Voice settings and the
  first-use consent sheet.

## 14. Metrics

Measure the simplified funnel:

- Click-to-recording latency, excluding native permission time.
- Recording start success rate.
- First live transcript latency.
- Live segment upload and STT failure rates.
- Finish-to-final-note latency.
- Early-title replacement rate.
- Project auto-link rate and Undo rate.
- AI-title overwrite, project unlink, and note correction rates.

Metrics contain counts, timings, status, and provider identifiers only.

## 15. Delivery phases

Every phase has the same exit gate before the next phase starts:

1. Run focused tests, Web typecheck/lint/build, and browser acceptance for the
   changed path.
2. Review state transitions, retry/idempotency, privacy, and Note version side
   effects.
3. Fix every discovered issue in the same phase.
4. Search for and delete superseded components, fields, routes, branches,
   translations, styles, and tests. A phase is not complete while both old and
   new implementations remain reachable or present without a current use.

### Phase A — One-click interaction

- Replace the setup dialog with the compact recorder.
- Delete the old form components, form-only API fields, and alternate start path
  in the same phase.
- Add server-backed one-time consent acknowledgement.
- Start with automatic language and passive project context.
- Preserve IndexedDB recovery and final upload.
- Review, test, and browser-verify before Phase B.

### Phase B — Live transcript projection

- Add AudioWorklet WAV segmentation and IndexedDB upload queue.
- Add segment API, repository, lease worker, and text-free SSE invalidation.
- Render persisted live transcript inside the Note page without Markdown churn.
- Test offline ordering, duplicate segments, gaps, restart, and provider failure.

### Phase C — Automatic enrichment

- Generate one early title.
- Add deterministic-first project inference with confidence thresholds and Undo.
- Add bounded model-output validation and failure fallbacks.
- Measure inference acceptance before expanding automation.

### Phase D — Automatic finalization

- Reconcile against authoritative full-audio STT.
- Write final title and managed Markdown once.
- Complete automatically and trigger proactive follow-up.
- Delete the dedicated review state/page; preserve corrections through Note.

### Phase E — Rollout hardening

- Run real meeting dogfood across Web and packaged Electron.
- Validate latency, interruption recovery, microphone permission, and retention.
- Audit and delete unused discussion types, endpoints, translations, tests, and
  CSS left by the former flow.
- Run full tests, production build, and real-browser acceptance.

## 16. Acceptance criteria

- After consent setup, one click starts recording without an application form.
- Route changes do not interrupt recording.
- A note is created automatically and is reachable while recording.
- Supported environments show persisted text within 30 seconds.
- Live-STT failure never loses or stops the original recording.
- Finish automatically produces a corrected title and complete structured note.
- Project-page capture links to that project without prompting.
- Global capture never blocks on ambiguous project inference.
- No per-segment Note snapshots or activity-event spam is created.
- Original audio and temporary segment audio can be deleted without deleting the
  final transcript or note.
- Repository search finds no old setup dialog, form-only field, obsolete state,
  review route, compatibility endpoint, dual-write, or alternate start path.
