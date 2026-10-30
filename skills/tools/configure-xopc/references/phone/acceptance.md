# Phone basic acceptance

After explaining the test and resolving the intended phone with the user, call phone_setup
begin_verification {setupId,deviceId,expectedRevision}, then get {setupId}. Only a verifying,
non-stale attempt is approved. Otherwise
explain the remaining owner action. Read tool_manual phone_use; discover that exact tool only
if not already declared. Use only the attempt's selected device, goal, completion and budget.

1. phone_use open {deviceId:<attempt.deviceId>,mode:"control",appPackage:<attempt.completion.appPackage>}.
   HarmonyOS uses com.huawei.hmos.settings and the real model opens About phone to read HarmonyOS version.
   For Android, the host opens About phone using Android’s standard Settings intent, avoiding stale subpages.
   The real model must still navigate to Android version details and produce changed native UI evidence.
2. observe. If login, password, verification code or sensitive business screen appears, stop
   and ask the user to prepare an appropriate screen; do not type into it.
3. run using exactly attempt.goal, attempt.completion and attempt.maxActions. Native verified
   UI evidence, real modelRequests and actual actions are required; mock/finish is not proof.
4. Always close this setup session, including on failure, then read phone_setup verification_report.
   Only completed, non-stale checks including released prove basic readiness.

For interruption, inspect status and saved setup before any action; do not open over an active
session or replay an uncertain action. A resumed test still uses the same pinned owner/device.
If already verified, only close and report. If paused, stopped, stale, expired, failed or a Gateway restart
lost the runtime session, use phone_setup release {setupId}, confirm lease expiry if
needed, then begin a new test after the cause is resolved and the user still wants to continue. Never adopt another phone or prior session report.

This test verifies screenshot observation, model-driven Settings navigation, native UI matching
and control release. It does not verify payment, login, arbitrary apps, typing or live video.
Explain those boundaries and suggest one small subsequent task with the intended app allowed.
