# Recording 1B: recovery, local export and interrupted continuation

Implementation: 2026-10-16. Builds on the P0 projection and durable source store. HarmonyOS device testing remains excluded.

## Delivered behavior

- Web Notes has a recovery entry and a scrollable list of all local drafts. Each recording has its own recovery, continuation, original export and local discard actions. Dates, Gateway, saved prefix, recording duration and interruptions remain visible. An unavailable known server recording never falls back to creating a different Note.
- HarmonyOS Notes exposes pending sessions, retained duration, Gateway, recovery/sync, continuation, export and local discard. Operations are serialized; recovery always restores the selected session. Existing consent, markers, Note identity and committed WAVs survive continuation.
- Discard affects the selected device copy. It no longer cancels a server capture or changes an already generated Note.
- Web microphone interruption stops capture and retains the draft for a user decision. It does not automatically seal the source and thereby disable continuation.

## Source and identity invariants

Continuation retains the recording UUID/clientRequestId, server capture and Note. New browser recorder instances append at the committed chunk boundary and receive distinct epochs. Late events from an old recorder are fenced by recorder identity. IndexedDB uses insert-only audio keys; competing writers cannot overwrite an original chunk. Browser Web Locks cover capture, recovery, export and discard, and release when the process dies. Browsers without Web Locks still retain insert-only protection.

Independent WebM/Opus containers are never concatenated as one WebM. Sealing validates epoch boundaries and checks every uploaded source hash. It decodes each independent source in bounded segments, retains each source as an immutable Note attachment, and publishes a versioned source manifest with hashes, attachment identities and interruption timestamps. A derived mono WAV supports the existing player and STT recovery pipeline. Source attachments and manifests use stable idempotency keys and reach file synchronization before the upload chunks can be cleaned up. Partial attachment failures retain upload chunks and can replay without duplicating Note or source attachments.

HarmonyOS continues to append independent PCM WAV commits. Persistent start/interruption/resume/seal events accompany export and sealing. The server retains the event manifest alongside the assembled WAV. Audio deletion removes the derived resource, independent sources and their manifests.

After continuation the continuous saved-prefix projection stops at the original interruption; it never sums independent periods into an apparently continuous recording. The UI explicitly states that interruptions contain no captured audio. Actual recording input must be observed again before showing active capture. Web continuation currently reports live transcription as unavailable and rebuilds text from the sealed original; it never reuses an earlier live segment sequence number.

## Export

A proven, normally finalized single browser container exports unchanged bytes. Interrupted, uncertain or multiple containers export a TAR recovery package: immutable chunk bytes, per-chunk SHA-256, explicit missing indices, epoch boundaries and reconstruction instructions. Missing chunks are never silently bridged. Chrome/Edge file saving streams bounded chunks to disk. The compatibility download path caps buffered export at 64 MiB and retains source audio if exceeded.

HarmonyOS uses the existing document picker and writes one original WAV at a time into a TAR package with session identity, markers, chunk timing and interruption events. Picker cancellation, short writes and read failures leave local audio intact; partial exports are closed.

## Scope boundary

Continuation applies before source sealing. A persisted seal intent blocks further append, including when its HTTP response was lost. Recovery retries the exact manifest and existing Note. Already sealed audio is immutable; appending to a completed recording would require a subsequent source-version workflow. A confirmed source is required before local cleanup. No two-hour physical-device recording or HarmonyOS device run is claimed here.

## Verification

- Web hook and orchestration tests: selected recovery among multiple drafts, same-identity continuation, actual input reconfirmation, immutable old chunks, late old callbacks, interrupted capture not auto-sealing, Gateway mismatch, no fallback Note creation, local-only discard, cross-tab ownership and atomic insert conflicts.
- Export tests: byte-for-byte original export, bounded demand reads, hashes, epoch/gap manifest, missing chunks, disk read/short-write failure and picker cancellation.
- Service tests: real independent WebM decode, malformed epoch rejection, sealed-manifest fencing, interrupted attachment persistence and idempotent replay, source hash preservation, same Note identity, and complete original deletion. Existing authenticated HTTP/lazy-dispatch tests continue to cover the seal route family.
- HarmonyOS SQLite-backed host tests: interrupted continuation with immutable original WAVs and markers; lost seal response; identical event manifest on retry; no duplicate capture or Note creation; local discard without server cancellation.
- Real Chrome acceptance: offline recording, browser SIGKILL, same profile restart, source-prefix SHA-256 preservation, continuation into two independently decodable containers, and a valid TAR package. Evidence: `technical/note-1b-browser-2026-10-16.json`. Synthetic microphone, short smoke duration; no long-duration claim.
