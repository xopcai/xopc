# Phone Use V2: local video and continuous control

Implementation and acceptance: 2026-10-23/24. The earlier `phone-use-interaction-v2.md` preserves the screenshot baseline and research; this document describes the implemented video path.

## Delivered architecture

- `LocalScrcpyProvider` starts the official, SHA-256 pinned scrcpy 3.3.3 server. Long edge 960, H.264, up to 30 FPS, 2 Mbps, no audio or clipboard synchronization. It allocates its own random scid and ADB forwarding port. Closing removes only its own forward, remote jar and matching Android process; it does not kill other scrcpy clients.
- `PhoneInteractiveSession` shares one source among up to four viewers. Media, model observations, and human input are independent. It stages bounded video packets until foreground checks succeed. Slow WebSocket clients disconnect instead of dropping H.264 reference frames. A new viewer requests encoder refresh and waits for configuration plus IDR. Geometry versions travel with their packets; old-generation packets are discarded.
- The browser decodes Annex B H.264 with WebCodecs into Canvas. Unsupported browsers and transport/decoder errors explicitly fall back to snapshots. Retry video is available. Hidden/unmounted panels disconnect and release manual control. Static Settings pages may produce zero frames until something changes; this is not a promised constant-rate recording.
- Human DOWN is sent immediately. MOVE samples the newest position every 24 ms and, after the cloud extension, coalesces behind transport ACKs; UP/CANCEL is immediate. A persistent scrcpy control socket injects the actual gesture while the pointer remains down. No per-MOVE screenshot, model request, ADB subprocess or SQLite write occurs. The supported capability is one pointer; multi-touch and arbitrary keyboard forwarding are not advertised.
- Browser text submission commits one string after checking a focused non-password native editable field. Enter respects IME composition. ASCII uses the existing driver; Unicode requires the user-enabled ADB Keyboard path. This is a semantic text commit, not key-by-key forwarding or a claim of tested Chinese IME support. Text failures preserve the draft.
- The runtime serializes ownership changes independently of media. Epoch changes fence queued old input; handback waits for touch revocation and a new semantic observation before resuming main. Disconnect, expiry, blur, geometry change and explicit exit release held touches. Disconnect/exit keeps the task paused. Pointer failures close the input channel rather than replaying uncertain input.
- Only complete gestures are summarized in bounded metadata. Human actions have their own budget (1200), separate from the Agent action limit. MOVE packets and submitted text are not persisted.

## Authentication and policy

An administrator POSTs `/api/phone/conversations/:conversationId/:sessionId/video-ticket`. The one-use 30-second ticket binds principal, page client, conversation, phone session and exact origin. The WebSocket uses subprotocols at `/api/phone/live/v1/ws`; credentials are not placed in URLs. Session/binding/principal validity is rechecked during the connection. Viewing grants no input lease, including no right to cancel another viewer's touch. Frames, tickets and captures use private/no-store handling.

The existing device/app scope remains in effect. Foreground sampling is staged before publishing video and fails closed; this is not device-side per-app media isolation. A brief leave-and-return entirely between sampling checks cannot be proven absent. Strict per-app isolation requires a device-side capture boundary or an equivalent vendor capability. Returning from a refused app requires the explicit existing allowlisted recovery action.

## Installation and local development

```sh
pnpm exec tsx scripts/setup-phone-video.mts
```

This downloads only the official server asset to the Gateway state directory (`tools/scrcpy/scrcpy-server-v3.3.3`) and verifies SHA-256 `7e70323ba7f259649dd4acce97ac4fefbae8102b2c6d91e2e7be613fd5354be0`. Runtime verifies it again before push. It never downloads software silently on screen viewing. The server is not committed to the repository. Its [upstream Apache-2.0 license](https://github.com/Genymobile/scrcpy/blob/v3.3.3/LICENSE) and [release](https://github.com/Genymobile/scrcpy/releases/tag/v3.3.3) apply.

Start Gateway normally, ask main to open a control session and pause, then open the phone panel. No AutoGLM key is required for media or manual input. The existing dedicated phone-model provider configuration is used only for Agent phone inference.

For the scoped emulator benchmark, exit takeover and keep the session paused:

```sh
pnpm exec tsx scripts/benchmark-phone-video.mts <conversationId> /tmp/phone-video.json
PHONE_BENCH_DIRECTION=up pnpm exec tsx scripts/benchmark-phone-video.mts <conversationId> /tmp/phone-video-up.json
```

The benchmark only accepts a local emulator whose app scope is exactly Android Settings. It opens an authorized video connection, acquires control, navigates to the allowed Settings root, injects one real held gesture, checks the native layout **before UP**, and finally releases to paused. It does not save settings or send a model request. No text or pixels are recorded in its report. Use alternating directions to avoid measuring a gesture that has already hit a list edge.

## Cloud extension boundary

`live-provider.ts` defines media descriptors (`scrcpy-h264`, `vendor-sdk`, `snapshot`), normalized pointer messages, versioned geometry, subscription, refresh and explicit control revocation. `PhoneRuntime` injects an interactive-provider factory. The chat panel is independent of the phone model provider. A cloud adapter can use vendor media and input without converting its SDK into ADB or forwarding its long-term credentials to the browser.

`revoke()` must resolve only after accepted touches are released and old input is fenced. A vendor that can only expire a token must keep handback pending/paused until confirmed expiry; frontend SDK destroy alone is insufficient. Vendor SDK renderers and account/instance lifecycle management require their own acceptance. The subsequent Alibaba ADB video implementation and live cloud acceptance are documented in [Alibaba Cloud video](phone-use-aliyun-video.md); the measurements below remain the earlier local-emulator record.

## Acceptance record

The measured samples and browser E2E results are summarized below; per-run JSON and temporary screenshots are not retained in the repository. ACK is explicitly **transport-written**, not an Android injection acknowledgement or glass-to-glass latency. Packet FPS and browser presentation are reported separately. The production P95 target is not inferred from a few local samples.

| Observed item | Local result |
| --- | --- |
| GPU-enabled direct source, 960 long edge | 28.03 / 28.01 FPS during two opposite held gestures |
| Authenticated Gateway video during two held gestures | 24.1 / 25.1 packet FPS; native layouts changed before UP |
| Pointer messages | 42 per gesture, all acknowledged; ACK P95 6.54 / 1.57 ms |
| Paused takeover confirmation | 12 / 6 ms; not a measurement with in-flight Agent input |
| Browser cold first **presented** frame | 1015.7 ms, including ticket/connection/source startup/decode |
| Browser native pointer drag | Presented-frame counter 55 → 89 and visible Settings list movement |
| Text commit | ASCII test text visible in focused native editable field, then Cancel; saved device name unchanged |
| Latest main handback | Same phone session resumed; real AutoGLM made 2 requests, scrolled to Android 15, then closed |
| Teardown | No remaining test scrcpy process or ADB forward |

The test AVD originally had `hw.gpu.enabled=no`. Direct scrcpy trials also rendered poorly with that configuration (roughly 6–15 FPS for valid gestures). Host GPU was enabled and the emulator restarted without clearing app data. Original configuration is backed up at `~/.android/avd/XOPC_Android_Test_API_35.avd/config.ini.xopc-phone-v2-backup-20261023`. The 960/2Mbps default was selected after comparing 1280, 960 and 640. Model captures retain native screenshot resolution.

Earlier trials included intermittent input refusals and one invalid AutoGLM response. Review found that queued packets could otherwise be labelled with a newer geometry generation; packets now carry their own geometry and stale generations are discarded. Three subsequent viewer reconnections succeeded. The original refusals' precise cause was not independently isolated. Later complete main handbacks succeeded without model protocol errors; strict parsing still fails closed on invalid future model output.

Verification: 95 targeted tests, core/web TypeScript checks, web production build and targeted ESLint passed. Tests cover fragmented/malformed video framing, touch encoding, ownership/epoch fencing, queue revocation, one-use/origin tickets, view-only cancellation rejection, MOVE coalescing before ACK, blur release and separate manual action budgets. Browser testing used the real Gateway, emulator, Canvas decoder and main conversation.
