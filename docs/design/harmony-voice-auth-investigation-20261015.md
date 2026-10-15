# Harmony voice authentication investigation

Date: 2026-10-15 (Asia/Shanghai).

## Message read aloud: confirmed missing request proof

`XopcChatReadAloud.requestChunk()` sent `/api/voice/speech` through the native HTTP client directly. It included the device access token but bypassed `signedHttpRequest`, omitting `X-Xopc-Proof`. The Gateway requires this proof for devices enrolled with request proof version 1. Refreshing the token cannot repair a missing proof.

On `qm.xopc.io`, Harmony requests to this endpoint returned HTTP 401 at 09:19, 12:58 and 18:35:23. Other requests from the same client succeeded. The 55-byte error response size matches `REQUEST_PROOF_INVALID`; the access log does not retain the response body, so this is corroboration rather than direct capture of its error code.

The client now uses `signedHttpRequest` for initial and prefetched chunks. The regression test verifies real P-256 signatures against the exact request body, method, path and content type, and checks that prefetch uses a distinct nonce.

Validation: 47 tests passed across chatReadAloud, requestProof, voiceCall, voiceCallTransport and voiceRecovery. Debug HAP compilation passed. The produced HAP is unsigned; no phone was connected, and installation and acoustic acceptance were not performed.

## Realtime voice entry: traced, failure not reproduced

The extension panel's second page exposes `voice-no-tools` (实时语音) and `voice-with-tools` (语音助手). `ChatView.chooseAction()` maps these to `natural` and `assistant`; Personal AI uses assistant mode. The entry is disabled without a selected conversation or while a call is active.

`XopcVoiceCall.start()` proceeds through:

1. Cancel recording and stop read aloud.
2. Materialize a local draft through `XopcChatRepository.materialize()` if necessary.
3. Fetch `/api/voice/realtime/status` and check the requested capability.
4. POST `/api/voice/realtime/preflight`.
5. POST `/api/voice/realtime/sessions` to obtain a one-use ticket.
6. Initialize native audio and obtain the verified active origin.
7. Connect `/api/voice/realtime/v3/ws` with `connectionProof`; use the proxy fallback only before sending `session.start`.
8. Wait for `session.ready`, ready playback, and then enable microphone input.

The REST operations use `gatewaySession.request()` and its signed transport. The WebSocket binds the ticket and upgrade path to the device key. Neither path has the read-aloud bypass.

Remote observations:

- HTTPS access and the nginx WebSocket forwarding configuration were checked. Remote realtime voice is enabled; the local development configuration with voice disabled does not describe this server.
- On 2026-10-15 around 19:10, the running remote Gateway returned HTTP 200 with all voice capabilities available. Both assistant and natural preflight requests for an existing conversation returned HTTP 200. These probes used the existing server owner credential locally on the server, not the phone's device credential, and did not allocate a voice session.
- Morning Harmony logs contain successful status, preflight and session requests, followed by HTTP 101 WebSocket upgrades. An upgrade alone does not establish successful audible playback.
- The afternoon logs inspected in this investigation did not contain realtime session startup requests from the phone. The observed 401 failures were speech/read-aloud requests.

There is no confirmed realtime-entry root cause yet. A failed phone attempt must be correlated with its timestamp and device logs, especially if it fails before the first voice REST request. No production configuration or deployed package was changed.
