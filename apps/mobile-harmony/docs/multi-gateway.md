# HarmonyOS multi-Gateway support

Implemented on 2026-09-18. Device acceptance is still pending.

## Behavior

- Save multiple paired Gateways; only one is active. No cross-Gateway aggregation.
- Open management from the chat drawer, Personal → Connection, or Settings → Connection.
- Add through the existing QR/invitation flow, rename locally, switch, or remove a local connection with confirmation.
- Validate a candidate's identity, credentials and `/api/status` before publishing it. Failure retains the previous active profile.
- Persist the active selection and automatically migrate the legacy single profile, refresh token and pending refresh journal without re-pairing.
- Gateway-scoped credentials and identity pins use the existing encrypted Asset Store. Removing one profile does not clear shared device/endpoint keys or other profiles.
- Existing main-conversation, model-selection and chat-draft storage is already Gateway-scoped and remains in use.
- Opening management unmounts the old home; switching resets realtime subscriptions/cursors and push UI state. Returning recreates the home with the current profile.
- Old asynchronous requests cannot retry mutations with a new Gateway's token. Multi-step media resolution and file-picker uploads check the connection revision.
- Notification links continue to be accepted only for the active Gateway; this change does not automatically switch Gateways when a notification is tapped.

## Verification

Host tests cover legacy migration, repeated restore, multiple profiles, rename, identity-pin retention, removal/fallback, A/B/A switching, failed candidate verification, concurrent activation, old 401 responses, old authentication in flight, pairing cancellation, realtime orchestration, media resolution and file-picker isolation. Existing real Gateway pairing/auth route tests also run.

Local Debug/Release compilation and the repository CodeLinter configuration are used. Compiler SDK warnings are not equivalent to CodeLinter diagnostics.

Latest local results: 251 tests passed across 41 files; Debug and Release HAP builds succeeded; CodeLinter returned `[]`; `git diff --check` passed. HAP builds were unsigned. Device results must not be inferred from host tests.

No phone deployment, application-data clearing, live Gateway removal, commit or push was performed in this side conversation. The main thread's physical acceptance must not be interrupted.

## Remaining device acceptance

1. Upgrade an existing paired installation and verify the old Gateway remains available without scanning again.
2. Add a second real Gateway, approve pairing, switch A/B/A and restart the application.
3. Verify drawer/personal/settings entrances, long names, rename and return/back behavior.
4. Verify distinct conversations, drafts, model choices, images, files and realtime events after each switch.
5. Make B unreachable and confirm a failed switch leaves A selected and usable.
6. Cancel an added pairing; remove an inactive profile, the active profile, and the last profile using disposable test Gateways.
7. Check notification behavior, upload/download and voice operations during switching on the device.
