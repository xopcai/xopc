# Agent voice input identity and missing replay recovery

Date: 2026-10-09.

## Symptom and evidence

The Harmony physical device connected to `qm.xopc.io` recognized speech and received `response.created` / `task.created`, but remained in the thinking state without response text or audio. The server accumulated eight queued turns. The durable input store contained completed voice inputs whose IDs reused small ASR turn numbers across calls on the same transcript. The blocked client's timing report confirmed zero buffered/played audio.

## Cause

The broker's default durable input identity was `voice:<transcriptId>:<turnId>`. ASR turn numbers are local to an upstream session and can restart at the next call. Input deduplication therefore could return an earlier completed run instead of submitting the new utterance. After a Gateway restart the old run's in-memory realtime replay is absent; a subscription to that completed run would wait indefinitely.

## Fix

The Agent voice engine explicitly sends `voice:<transcriptId>:<voiceSessionId>:<inputGeneration>:<turnId>`. This preserves retry identity inside a call while separating new calls and input resets. System task updates retain their existing stable delivery identity.

The broker also rejects a terminal input whose subscribed history lacks the terminal run event. The engine's existing failure handling emits a recoverable error and finishes the response instead of holding the client in thinking state. The fix does not cancel an Agent task merely because playback is cancelled.

## Verification and deployment

- Broker and interruption suites: 30 tests passed, including repeated ASR turn numbers across two calls and completed runs with missing replay.
- Engine lifecycle and realtime runtime/media/playback suites: 21 tests passed.
- Root TypeScript typecheck and Node build passed.
- On `qm.xopc.io`, the installed version was 0.0.363. Only the two relevant built modules were patched; the engine patch was based on the installed file to avoid importing unrelated newer dependencies. Originals were saved in `/var/lib/xopc/voice-hotfix-20261009`.
- Gateway restarted; HTTPS health check returned 200. No database rows or phone application data were cleared.
- This is a server hotfix, not an npm release. Include the source change in the next regular release so a package update does not discard the repair.
- Physical-device speech and audible response acceptance must be reported separately from the tests and deployment checks.

## Physical-device observations after hotfix

The existing phone installation rejoined the repaired Gateway. New durable IDs include the new voice session UUID, and three new Agent runs were marked completed. The first two client responses reached `outcome: completed` with 4,800 ms and 4,080 ms buffered/played duration respectively; the next reply was correctly queued behind playback. This verifies event delivery and renderer progress on the phone. It does not independently confirm subjective acoustic quality.

For these two samples, client-observed speech-stop to first audio was 6,629 ms and 4,948 ms. Receipt-to-buffer was 47 ms and 29 ms; receipt-to-first observed playback progress was 149 ms and 55 ms. The remaining delay is predominantly upstream of client receipt in these samples; provider endpoint latency is excluded. Two samples are not a performance baseline or an SLO conclusion.
