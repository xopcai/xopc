# Mate 60 physical-device verification — 2026-09-17

## Environment

- Device: HUAWEI Mate 60, phone, API 24 (`OpenHarmony-6.1.1.120` reported by HDC).
- App: `ai.xopc.mobile`, version `0.1.0`, version code `1`.
- Packaged minimum API: `60100023`; target API: `260000026`.
- Tools: DevEco Studio / command-line-tools 26.0.0.821.
- Debug Profile updated with user approval; the connected device is included.
- Local signing backup: Git-ignored `signing/build-profile.mate60.local.json`.
- Build: `entry/build/default/outputs/default/entry-default-signed.hap`.

## Observed results

| Check | Result |
| --- | --- |
| USB authorization / HDC connection | Passed after phone-side authorization |
| Debug signed build | Passed; compiler capability/exception warnings remain |
| Installation using `hdc install -r` | Passed; no uninstall or data-clear command used |
| Start `EntryAbility` | Passed; `start ability successfully` and running app process |
| Initial connection page | UI tree contains title, invitation input, scan, connect and settings controls |
| Installed bundle version and minimum API | Confirmed through bundle manager |

Startup error-level logs include framework messages from WMS (`WindowInfoReporter` singleton) and UIAbility (`JsUIAbility call js, withResult failed: 5`). The app remained running and produced its initial UI tree; these messages are not yet classified as benign or resolved defects. No app crash was established by the sampled logs. This is not a crash-free certification.

## Pending

Interaction testing was paused when the captured screen no longer matched the previously observed connection-page tree. A screenshot unrelated to that page was removed from the host and phone; it is not part of this record. Settings interactions, cold restart, update/data preservation, native instrument tests, Gateway pairing, streaming/abort, files, microphone and push delivery are not claimed as passed.

## Later Chat / dock / drawer pass

An intermediate signed debug update installed with `hdc install -r` without a data-clear command. Launch returned `10106102` because the phone was locked. The user was asked to unlock the screen; no automated unlock or security-setting change was attempted.

The final signed debug package built successfully, but final installation returned `E001005 Device not found or connected`: the Mate 60 USB target was no longer available. This final package is not claimed as installed. Current host and paired-emulator results, plus explicit implementation/acceptance gaps, are in `chat-parity-checklist.md`.

Signing secrets and device identifiers are excluded from this document. The tracked build profile was restored to its portable, unsigned configuration after building; the signed output and local signing backup remain available. Existing unrelated web changes were left untouched. No production database was migrated and no application was published.

## Physical acceptance retry after session-management implementation

- The Mate 60 reconnected and reported model `BRA-AL00`, API 24. Existing app startup succeeded without a lock-screen error.
- Before the update, its UI tree showed the unpaired connection page with an empty invitation field. There was no paired Gateway available on this phone to exercise Chat.
- Rebuilt the latest sources with the previously authorized local debug signing Profile. Hvigor reported `BUILD SUCCESSFUL`; signing was injected in memory using `HARMONY_DEBUG_SIGNING_PROFILE`, without changing tracked build profiles or printing secrets.
- Latest signed HAP SHA-256: `5871a873de2b8965f962eb1d6f5b43bbe1ce59452e9ba5245f3effd5556fbd1a`.
- `hdc install -r` reported successful replacement, and `aa start` reported `start ability successfully`. No uninstall, data clearing, permission auto-grant or persistent test-mode change was performed.
- The post-update UI tree again contained the Chinese connection title, invitation input, scan/connect controls and Settings. Local evidence: ignored `.test/mate60-before.json` and `.test/mate60-latest.json`.
- USB disconnected before the screenshot and Settings interaction commands could execute. Those commands returned `E001005`; target-specific reconnect and an HDC server restart did not restore the connection (`list targets` was empty). No new screenshot or Settings interaction is claimed.

**Acceptance remains partial:** installation/startup/connection-page UI passed. Chat, dock, drawer, search/selection, keyboard behavior, pairing persistence, media, voice, push and runtime-log inspection still require a connected/unlocked phone and completed Gateway pairing. The user has been asked to complete pairing on the intended Gateway and reconnect USB debugging. No real conversations were mutated.
