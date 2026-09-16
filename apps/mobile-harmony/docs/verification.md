# Verification record — 2026-09-17

This is a development-preview evidence record, not a parity certification.

## Passed

| Check | Evidence |
| --- | --- |
| ArkTS debug build | `assembleHap entry@default`, API 26, successful |
| ArkTS release-mode build | Successful unsigned HAP; no signing configuration |
| Instrument build | `assembleHap entry@ohosTest`, successful |
| CodeLinter | 0 diagnostics under configured recommended type/security/performance/correctness/compatibility rules |
| Gateway types | Root `pnpm run typecheck` passed |
| Client host tests | 13 files / 51 tests: protocols, fixtures, real Gateway auth handlers, refresh/completion recovery, Asset chunking, WS state/cursors, workspace contracts, Markdown, notification routing, voice lifecycle, chat request isolation, attachment picker/limits/history/idempotency |
| Backend regression | 9 files / 47 tests: SQLite migration and references, HarmonyOS platform parsing, pairing/notes/push routes, provider separation, Huawei PS256/V3 requests, existing delivery storage |
| Existing Expo regression | 170 files / 946 tests passed |
| Native crypto/storage | 3 tests on Pura 90 Pro API 26 emulator: Unicode/chunk/empty/delete Asset operations, P-256 compact signatures and key restore, Ed25519 verification/tamper rejection |
| Native TLS pairing | 1 test: NetworkKit HTTPS → real isolated Hono pairing/auth routes → native P-256/Ed25519 → durable credentials → new session instance → refresh rotation → authenticated request |
| Native UI | 1 smoke test: reject invalid link, enter settings, Chinese/English switch, dark/system appearance, return to connection page |

Native tests use independent credential aliases. The TLS integration test does not install a system CA or relax production TLS. Its custom CA is confined to the ohosTest transport. No production/user database was migrated.

## Defects found and corrected during verification

- Asset Store per-record size limit broke large pairing journals: atomic, generation-based chunking added.
- Native empty-string UTF-8 encoding returned undefined: explicitly handle empty values.
- ArkTS checking of portable `.ts` modules caused invalid inference: native runtime modules use `.ets` and host tests transpile them separately.
- Nonrecoverable realtime gaps and subscription ACK cursors needed rebasing; revoked/protocol-incompatible connections must stop retrying.
- A completed pairing/refresh with a lost response must resume with its original durable identity.
- Automation edits must preserve timezone/action options instead of overwriting unseen fields.
- Slow history responses must not overwrite a new conversation or a newer snapshot; repeated older-page requests are deduplicated.
- Attachment-only messages remain visible in history, and changed attachment bytes get a new input identity while unchanged retries retain the previous one.
- Explicit local disconnect clears both persisted private-key aliases and in-memory key caches; ordinary background/ability lifecycle stops do not erase device identity.
- First-run simulator keyboard setup, test timeout and screenshot sandbox path were corrected in UI test prerequisites/code.
- TestKit legacy Context cannot be mechanically replaced with a Stage-only application API; see the [diagnosis](../diagnosis/diagnosis_20260917_154345.md). This compatibility exception is test-only.

## Not yet verified / release blockers

1. Real signed installation, cold start/update/data preservation on physical API-26 phones; earlier API support is not configured.
2. Full native WSS → Gateway → real model streaming/abort/background-resume journey, weak-network loss, revocation and server restart on device.
3. Cross-client tasks/projects/automations/notes CRUD, large collections, conflict handling, file picker upload/download and duplicate-submit scenarios on device.
4. Real microphone permission-denial/regrant, audio interruption/playback, actual speech transcription, camera scanning.
5. Huawei Push Kit credentials, signing identity, category approval, real notification delivery and cold/warm tap routing.
6. Foldable/tablet layouts, landscape, large fonts, screen reader, keyboard/avoid areas across all signed-in pages; performance, freeze and long-running memory measurements.
7. Complete product parity review beyond the explicitly scoped preview (advanced Markdown/media presentation, multi-Gateway management and live voice are not implied supported). Chat file/image input is implemented; physical-device picker and actual agent consumption remain unverified.

Compiler warnings are distinct from CodeLinter diagnostics: native capability/throw annotations remain, and the test-only Context helper has a documented deprecation warning. A green CodeLinter report is not a claim of a warning-free compiler or production readiness.
