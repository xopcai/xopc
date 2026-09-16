# HarmonyOS mobile parity

Status: confirmed by the user's instruction to implement the presented design autonomously, stage by stage.

## Scope and architecture

Add `apps/mobile-harmony`, a native ArkUI/ArkTS Stage application using MVVM and state management V2. Existing Expo iOS/Android behavior is the reference. Gateway remains authoritative; do not run the Node agent locally on the phone.

Scope: secure pairing, credential refresh, verified HTTPS/WSS routes, conversation history and realtime chat, tasks, projects, automations, notes with Markdown editing, files, sessions, push notifications, basic audio recording/playback, Chinese/English and system theme. Cards, live activities, advanced rich-text and distributed-device features are deferred.

Flow: pairing invitation -> Ed25519 gateway verification -> P-256 device proof -> explicit gateway approval -> secure refresh-token storage -> REST and realtime ticket -> WS topic subscriptions -> repository -> observed view model -> ArkUI.

## Contract decisions

TS/Zod schemas remain authoritative. Generate JSON Schema and deterministic cryptographic fixtures for portable validation. ArkTS DTOs and parsers are explicit, without Zod or arbitrary TS imports. Protocol versions, signing bytes, cursor semantics and HTTP retry behavior must match existing clients.

Extend accepted device platforms to `harmonyos` end to end. Keep Expo and web behavior compatible. Huawei push requires a distinct provider; never send Huawei device tokens to Expo. Gateway installation routes must remain reachable through authenticated lazy bundles.

## Security and failure handling

Only HTTPS origins from validated invitations; reject credentials, paths, fragments and cleartext routes. Verify Ed25519 signatures before trusting routes, bind refresh proofs to gateway/device/request identity. Access tokens stay in memory; persist private keys and refresh credentials using platform secure facilities. Serialise refresh; retry writes only under existing idempotency contracts. Clear local sensitive state on unpair.

Realtime: ticket authentication, v2 hello, explicit topic subscriptions, bounded reconnect with jitter, per-topic sequence cursors, snapshot resync on gaps. Lifecycle resumes reconnect and refresh snapshots; background execution is not assumed.

## Delivery and acceptance

1. Buildable project and contract support.
2. Pairing/auth/network/realtime with deterministic protocol tests.
3. Chat and session workflows.
4. Tasks/projects/automations.
5. Notes/files/search.
6. Native notifications, audio, settings/accessibility/localisation.
7. Integrated tests and release preparation.

Each stage must compile. Tests cover security rejection, contract fixtures, reconnect and mutation behavior. Device validation covers phone layout, keyboard/avoid areas, lifecycle, permissions, weak network, attachments and audio. Absence of device testing must be recorded, never reported as passed.

## Rollout, monitoring and recovery

Develop against isolated test data. Internal signed builds precede staged public rollout. Monitor pairing/auth failures, request latency/errors, reconnect/gap counts, crash/freeze rates and push delivery without credentials or message payload logging. Stop expansion on regressions; disable affected optional capabilities, retain server backward compatibility and distribute a corrective build. Signing, Huawei project credentials, real-device approval and store submission may require the user's participation.
