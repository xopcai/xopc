# Alibaba Cloud Phone: live video and shared control

Implemented 2026-10-24. This builds on the existing Alibaba ADB connection form and credential store; onboarding is documented in [the setup guide](../../how-to/connect-aliyun-cloud-phone.md).

## Transport and ownership

`CloudPhones.interactive` loads a registered device's credential into a dedicated `CloudAdbConnection`. `CloudScrcpyProvider` verifies the same pinned scrcpy 3.3.3 server used locally, uploads it through ADB Sync, launches a random-scid process and opens two authenticated `localabstract` channels. Video and control are multiplexed on TCP ADB. No host ADB server, key replacement, port forwarding, cloud AccessKey or browser credential is involved. Semantic Agent observations use the existing cloud driver separately.

`ScrcpyProvider` shares H.264 parsing, geometry generations, pointer sequencing, cancel and close ordering between local and cloud transports. Close waits for pending startup before cleanup; cleanup revokes held input, closes sockets, removes only the matching scid process and jar, and clears the in-memory key. No cloud purchasing, provisioning, stopping or destruction APIs are called.

The existing `PhoneInteractiveSession`, video-ticket endpoint and WebSocket protocol serve both local and cloud phones. Frontend controls keep their existing view-only / takeover / release / handback semantics. Device leases, Agent pause, control epoch fencing, app scope, reconnect and snapshot fallback remain shared. Handback re-observes the device and submits the existing continuation to main.

## Cloud latency adaptations

- The browser sends DOWN immediately and coalesces MOVE positions while waiting for transport ACKs. It retains the newest point, not a backlog. UP and CANCEL do not wait for the MOVE sampling timer.
- Foreground sampling filters the dumpsys result on Android before sending it over the cloud link. If verification takes longer than the input freshness window, the ordered input queue waits for a fresh verification and checks the ownership epoch again before injection. It does not enlarge the authorization window.
- Native WebSocket PING/PONG detects dead viewers without depending on application timers running in a background browser. Hidden panels still explicitly disconnect and release manual control. Human control retains its independent heartbeat and expiry.
- Human heartbeat renewal bypasses the serialized operation queue, so a slow native observation cannot block its own lease renewal. Text preflight runs before dispatch metadata is written: a missing focus refuses the input while keeping takeover and the draft.
- Human text observation first reads the current Android IME editor. The active app, served view, active connection and input-type password variations must match; historical editor entries are ignored. Recognized native editors avoid a slow accessibility-idle dump while the keyboard is visible. Unknown Android dump formats retain the original accessibility check. Raw IME dumps and text values are not persisted.
- ADB serializer pipe failures are observed immediately, including cancellation before stream close. Expected disconnects must not generate unhandled rejections.
- Video-start errors and input refusals retain their error code for diagnostics. Initial video startup waits for an app-launch dispatch to finish instead of sampling the previous application.

## Scope and extension

The initial Alibaba adapter targets already-running Android instances with a reachable ADB endpoint and bound RSA 2048 key. `PhoneInteractiveProvider` remains the media/input boundary for future cloud SDK adapters. A different vendor can supply media, versioned geometry, input and confirmed revocation without changing Agent control ownership or phone-model configuration. Vendor SDK renderers and instance/account lifecycle management are separate work.

Snapshots remain available when scrcpy or WebCodecs is unavailable. The Settings preview modal and connection-test preview remain read-only snapshots. Unicode text uses a separate control-only scrcpy clipboard channel; ASCII text uses the standard Android input path. See [Unicode input](phone-unicode-input.md). Foreground sampling is not device-side per-app capture isolation.

## Acceptance

The acceptance results are summarized here; per-run JSON and temporary screenshots are not retained in the repository. Measurements count encoded Gateway video packets; transport ACK is not an Android injection acknowledgement or glass-to-glass latency. Static screens may emit zero frames. An initial unpaced cloud gesture reproduced queue backpressure. Review also identified brittle foreground freshness and browser-timer-dependent heartbeat handling; both were hardened and covered by regression checks. Earlier browser fallbacks did not retain a reliable root-cause code, so those observations alone do not prove which mechanism caused each fallback. A gesture at a list edge did not change layout and is excluded from movement acceptance.

Earlier onboarding acceptance used an isolated authenticated Gateway and a real Android 12 cloud phone. Uploading the bound key produced a screenshot and native hierarchy; saving the tested connection, selecting a default, reconnecting for diagnostics, credential mode 0600 and deleting the test device's credential all passed. Unauthenticated requests were refused through the real lazy route loader. The 111 relevant tests, core/web type checks, targeted ESLint and web build passed. That earlier phase used snapshots and no phone-model or device-input calls; its lack of video support was superseded by the acceptance below. Temporary state and credentials were removed after onboarding verification.

The existing benchmark supports a registered Alibaba phone scoped exactly to Android Settings with explicit opt-in:

```sh
PHONE_BENCH_CLOUD=1 PHONE_BENCH_DIRECTION=up pnpm exec tsx scripts/benchmark-phone-video.mts <paused-conversation-id> /tmp/cloud-up.json
PHONE_BENCH_CLOUD=1 pnpm exec tsx scripts/benchmark-phone-video.mts <paused-conversation-id> /tmp/cloud-down.json
```

It uses the saved Gateway credential, checks layout before UP, and always releases to paused. It records no phone pixels or text.

Final acceptance: the existing connection form tested and saved the supplied cloud phone; two valid opposite held gestures produced 17.3 encoded packet FPS with P95 transport ACK 53.58 / 61.66 ms and no unacknowledged input. The browser showed live video and manual taps; ASCII text reached the native device-name field, then Cancel restored the unchanged name. Panel handback submitted the existing main continuation; real AutoGLM made 9 model requests, returned native UI facts including Android version 12, and main closed the session. No `expectText` was supplied, so the runtime completion flag remained unverified; the recorded native facts and visible version row support the read result independently. Final status was closed, owner none, unchanged device name, and zero remaining scrcpy processes. 127 targeted tests, core TypeScript, web production build and targeted ESLint passed. The local emulator source was also reopened and closed successfully after sharing the scrcpy implementation.
