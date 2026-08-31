# Voice capture product and reliability contract

Voice capture is a note-taking action first and an AI transcription action second. The user must not lose the original recording because the gateway, network route, decoder, or STT provider is unavailable.

## Product flow

1. Entering voice mode requests microphone permission before the first hold gesture.
2. Holding starts a native recording and shows live level, elapsed time, and the active release target.
3. Releasing in the center saves the original voice memo. Swiping left cancels; swiping right converts the recording to editable text.
4. A voice memo is written to the durable app document directory and immediately entered in the workspace offline queue.
5. The queue uploads the original audio with a stable idempotency key. A lost response or route change may retry without creating a duplicate note or attachment.
6. After the raw recording is stored, transcription runs as optional enrichment. STT failure never rolls back the playable voice memo.
7. The local recording is deleted only after confirmed sync, or when the user explicitly removes the pending/failed operation.

This is the expected model for a dependable notes or ideas product: capture is local-first, the source artifact is authoritative, syncing is retryable, and AI processing is non-destructive enrichment.

## Failure behavior

| Failure | User-visible outcome | Data behavior |
| --- | --- | --- |
| No LAN/tunnel route | Saved offline | Durable queue retries after route recovery |
| Request times out after server accepted it | Saved offline | Same idempotency key returns the existing note/attachment |
| Decoder or STT unavailable | Voice memo remains playable | Transcription is skipped; original audio stays stored |
| App closes after capture | Pending sync remains visible | Recording URI and operation survive restart |
| Recording reaches eight minutes | Recording is finalized and saved | Keeps the file below the mobile attachment-read ceiling |
| User cancels or deletes a queued capture | Capture is discarded | Local recording is deleted intentionally |

## Technical invariants

- Capture recordings use `expo-audio` with `directory: 'document'`; chat-only transient recordings may use cache.
- Recorder polling must stop before native release, and polling races must not escape as unhandled errors.
- The audio session returns to playback mode after stop, cancel, or start failure.
- Mobile multipart upload prefers materialized bytes over a native `file://` URI.
- Replay of a write is enabled only when the request carries an idempotency key.
- The gateway derives deterministic note and attachment IDs from that key and coalesces concurrent duplicates.
- Queue journal metadata never stores raw audio bytes, while the queue payload keeps the persistent local URI needed for retry.
- Successful sync, explicit removal, and queue clearing own local-file cleanup; ordinary network errors do not.

## Release smoke test

Run on one physical iOS device and one physical Android device:

1. First-use permission: switch to voice, grant permission, then verify the first hold records normally.
2. LAN: record, save, play the note, and confirm a transcript appears when STT is configured.
3. Offline: disable connectivity, capture, restart the app, reconnect, and verify exactly one playable note syncs.
4. Route handoff: start on LAN, make LAN unreachable while tunnel remains available, and verify automatic recovery.
5. STT unavailable: disable STT and verify the raw voice memo still saves without a connectivity error.
6. Gesture edges: verify too-short, cancel, convert-to-text, eight-minute finalization, and interruption by another audio app.
