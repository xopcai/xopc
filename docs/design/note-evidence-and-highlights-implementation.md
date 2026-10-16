# Note batch 2A/2B: source evidence and durable highlights

Implemented 2026-10-16. Builds on recording P0/1B; no HarmonyOS physical-device validation.

## User path

Web Note review has summary, transcript and My highlights views with a shared player and persisted playback position, query, transcript page and selected anchor. Opening evidence does not replace the player. Restoring a position does not autoplay. Each conclusion's referenced segments are displayed separately, with the original transcript revision and independently playable ranges; playback pauses at the selected range boundary. Current-version evidence can reveal a segment beyond the first transcript page. Historical evidence never locates a reused sequence number in the current transcript.

HarmonyOS has the same three views, a versioned evidence sheet and a fixed playback bar in Note detail. Selecting evidence uses the requested transcript revision. Playback, tab and position survive tab switches; returning to a Note offers an explicit resume action. Late responses after changing Note or playback ownership are fenced. Device-proof authentication stays on every clip request; credentials are never passed to an unprotected media URL. Native playback downloads bounded, at-most-120-second WAV derivatives, closes handles and removes temporary files on failure or release. This is segment playback, not a claim of word-level timing.

Recording a highlight is one click and requires no model/network success. Feedback follows a durable local annotation commit. Web also requests a recorder flush at the click and resolves the anchor from newly committed encoded packets. Mark storage and positioning run independently of the original-audio write queue; mark failures cannot stop healthy capture. Native marks use actual PCM sample position and encrypted SQLite. Existing native timestamp markers are migrated with stable IDs before local recording cleanup.

In review, a whole transcript segment can be highlighted explicitly. Highlight, question and personal context are distinct types. User explanations are displayed as personal context and are not included in model analysis as recording facts. Highlights can be edited or removed. Pending synchronization, conflicts, missing source audio and unavailable timing remain visible. Conflicts preserve local text and offer explicit merging or adopting the server version.

## Time and version contracts

- Transcript sequence numbers are only meaningful inside a transcript revision. Evidence reads snapshot the current revision when needed and reject missing revisions/IDs; they never fall back to a current row with the same number.
- Existing corrected text and prior analyses remain available. The UI marks analyses/evidence based on earlier text as updated/stale. New key points and overview outputs can include explicit source references. Unsupported references are rejected; legacy results without timing are not assigned invented citations.
- Browser media timestamps can include pause gaps or small overlaps. RecordingMediaCoverageReader retains its conservative continuous prefix separately from a verified packet-duration clock. Time highlights store the packet clock and epoch, rather than assuming UI elapsed time is a source timestamp. An empty flush anchors to the next saved packet boundary, not an arbitrary later callback.
- Sealing records a bounded packet-timestamp-to-decoded-audio map, keyed by the immutable audio SHA-256. Independent recording epochs retain separate mappings and canonical offsets. Evidence uses that map to translate decoded transcript ranges into original player ranges, splitting discontinuities. Ambiguous old encoded points are not guessed. Failed timing inspection remains conservative and can retry; source audio saving is independent of timing availability.
- Native WAV and derived multi-epoch PCM playback use the canonical audio clock directly. Existing original hashes, source attachments and transcript snapshots are preserved.
- Real validation covers Chrome WebM/Opus and native PCM WAV. Other containers or unsupported codec padding remain explicitly unverified when a trustworthy mapping cannot be produced. Full audio and readable text remain available; unverified seek controls do not invent precision.

## Storage and synchronization

Migration 254 adds discussion_annotations and discussion_media_timeline. Annotation IDs are client-generated and stable. The original anchor is immutable except for the one-time resolution of a pending time point. Revision checks reject stale writes; replaying an identical mutation is idempotent. Deleted annotations are tombstones, preventing a stale creation retry from resurrecting a removed mark.

Web uses a separate strict-durability IndexedDB outbox. Native uses an encrypted S2 SQLite outbox with FULL synchronization, scoped to Gateway identity. Server acknowledgements cannot erase edits made while the request was in flight. Synchronizers drain subsequent changes, preserve response-loss retries and stop on conflicts. Native Gateway connection changes prevent acknowledgement into a different namespace. Original-audio sealing continues even when annotation synchronization temporarily fails.

Original-audio cleanup does not delete an annotation outbox. Recovery export includes highlight anchors, pending state and user context. An unreadable separate annotation store does not block export of retained audio; the recovery manifest explicitly records the metadata read failure.

## Routes

The existing authenticated discussion lazy bundle covers these additions; positive mapping assertions and real authenticated HTTP tests include them:

- GET /api/discussions/:id/evidence?revision=…&segments=…
- GET /api/discussions/:id/annotations
- PUT /api/discussions/:id/annotations/:annotationId
- GET /api/discussions/:id/audio-clip?startMs=…&endMs=…

Reads require workspace.read; annotation writes require workspace.write. Clip decoding has bounded output, a timeout, client cancellation and a two-operation concurrency limit. It does not load a complete long recording into application memory. ffprobe is used for compressed-media timeline verification; XOPC_FFPROBE_PATH can select its executable alongside XOPC_FFMPEG_PATH.

## Verification

- Service/HTTP tests: idempotent annotation replay, stale edits, immutable anchors, deletion fencing, historical evidence after correction, missing/unsaved audio, retained text after audio deletion, bounded native clips, scope checks and lazy dispatch.
- Web tests: local commit/reopen, offline and lost responses, acknowledgement/edit races, conflicting tabs, packet-clock and pause/overlap mapping, independent source write failures, selected range boundaries, distant transcript location, stable player across tabs, restored position without autoplay and deleted-source behavior.
- Native host tests: real SQLite outbox persistence, synchronization retries/conflicts, Gateway namespaces, connection-change fencing, tab/position persistence, source-relative clip position, stale playback response rejection, short-write cleanup and source sealing during annotation sync failure.
- Real Chrome: offline highlight followed by SIGKILL and same-profile reopen preserves the highlight ID and packet anchor. Recording continuation and export still pass. The paused recording is ingested through the real recording sealer, annotation/evidence resolver and bounded clip decoder. The real SQLite database is then closed and reopened to verify annotations and historical references. Evidence: technical/note-evidence-browser-2026-10-16.json; executable checks: scripts/note-recording-browser-acceptance.mjs and scripts/note-evidence-media-acceptance.mts.
- Web production build/type checks, related ESLint, root TypeScript, HarmonyOS Release compilation and configured CodeLinter are checked. Physical HarmonyOS devices and a real two-hour device recording remain outside this batch.

The next independent package is 2C (candidate action confirmation); this batch does not add new automatic Task creation or model-dependent search.
