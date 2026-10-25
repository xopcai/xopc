# Android and iOS conversation phone workspace

## Product behavior

The conversation stays selected when Phone Use first appears. A phone icon in the existing chat header opens a second horizontal page; a small attention dot indicates assistance. The phone page shows the device name and execution/control state, a contained live phone image, and one persistent bottom action: Take control / Return to AI. More contains Back, text entry, release while keeping paused, pause/resume, reconnect, and confirmed Stop. Text input belongs in a separate sheet. Chat draft and scroll state remain mounted when paging. Opening the phone dismisses the chat keyboard.

Manual control disables outer horizontal paging so a swipe is delivered to the cloud phone. The explicit return action and Android system Back remain available. Returning to chat or backgrounding releases human control and keeps execution paused. Return to AI uses the existing handback/assistance-continuation contract.

## Native implementation

- Android: `PhoneRepository` uses the existing verified `GatewaySession` and device request signing. A composition-owned controller exposes immutable `PhoneUiState` through StateFlow; foreground polling is owned by `repeatOnLifecycle`. The previewable content receives state, actions and a video slot. `HorizontalPager` preserves chat composition. `PhoneVideo` confines MediaCodec and its bounded packet queue to a decoder looper, rendering into TextureView.
- iOS: `PhoneRepository` reuses signed `GatewayClient` requests. A main-actor observable model owns discovery, foreground polling, commands and video lifetime. A two-page SwiftUI container keeps chat mounted; UIKit bridges are limited to native video rendering and touch delivery. AVSampleBufferDisplayLayer consumes AVCC samples converted from the Gateway's Annex-B H.264 packets. The chat composer's FocusState relinquishes focus on phone entry.
- Both use the existing mobile workspace compatibility flag, summary/state endpoints, per-session control commands, frame fallback and single-use WebSocket tickets. Existing Gateways without the capability do not advertise an entry.
- Viewer and controller use separate UUIDs. Closing a former viewing stream must not release a newly acquired control lease, including local administrative acceptance configurations.
- Video gestures use the continuous input channel. One pointer remains outstanding until ACK; MOVE coalesces while preserving final UP. Stale ACKs after cancellation do not revive input. Back/text use signed control commands with geometry; snapshot gestures require a fresh frame sequence.
- Video first-frame, receive and input-ACK timeouts bound stalled streams. Android packet count and total queued bytes are bounded. A failed stream clears the live surface and falls back to signed, noncached frames; reconnect is available in More.

## Identity and lifecycle

Discovery does not request pixels. Native devices need explicit `phone.view` / `phone.control` grants. Ticket requests bind conversation, transcript, client, purpose and (for control) epoch; WebSocket upgrades carry the device connection proof. Commands use a unique operation ID and expected transcript/epoch. Android scopes repository calls to the captured Gateway identity. Conversation, Gateway, foreground and page changes invalidate asynchronous work; late successful takeover results are released. No token or ticket is placed in a URL or log. State polling ignores replies that predate a newer control operation; media readiness is published once rather than on every decoded frame. Phone pixels are kept in memory and cleared on loss of access.

## Acceptance

See `mobile-phone-workspace-simulator-acceptance-2026-10-25.md` for the executed simulator coverage and outstanding checks. The HarmonyOS reference is the 2026-10-25 single-control workspace, supplemented by the mobile parity skill's baseline for general native behavior. This change does not claim a full five-tab product acceptance.
