# Phone handback cancellation fix

## Cause

The old runtime used a hard-coded 90-second active operation timer. The Gateway log recorded `phone_use` failures at 90,008 and 90,009 ms, including the handback continuation. Timer expiry aborted a signal without an explicit reason. Runtime error handling interpreted the abort as `PHONE_CANCELLED`, made the session terminal, and required reopening it. This was an execution deadline, rather than a failed control transfer.

Cloud screenshot/accessibility observation and repeated model inference can exceed this limit while the task is progressing. Layout drift still invalidates predictions; this check has not been weakened.

Tool `pause` also aborts its session controller. Direct handback, without first taking over, could reuse this aborted controller. An observation failure during handback could leave the report stuck in `returning`.

## Changes

- `phone.maxOperationDurationMs` controls the active operation budget, default 300,000 ms, bounded to 1,000–900,000 ms. Existing action, model-request and session lifetime limits remain in force. Human intervention pauses active time.
- Expiry has the explicit reason `PHONE_OPERATION_TIMEOUT`. At a safe boundary, it returns an unfinished report (`status=paused`, `controlOwner=none`, `stopReason=operation_timeout`) with facts and steps intact. Continuing requires explicit user handback; the runtime does not retry or reopen automatically.
- An unresolved device dispatch retains terminal `outcome_unknown`, even on deadline. Ordinary caller cancellation remains `PHONE_CANCELLED`.
- Handback recreates an aborted session controller only after the prior operation has drained. Failed handback observation restores an idle, paused control state. It cannot grant control after the session ends.
- Runtime goal completion/failure logs contain duration, status and bounded operational counters. No screenshots, native UI text or credentials are logged.

## Real Alibaba Cloud E2E, 2026-10-24

Started a new main conversation through the Gateway chat UI and used the configured default Alibaba test phone and real AutoGLM model. The main Agent opened Settings and paused. The browser acquired human control and dragged the real Settings list. After pressing **Hand back to Agent**, the main Agent resumed from the changed screen and used AutoGLM to enter Android version details.

The native facts included `Android 版本`, `12` and `Android 安全更新`. The completion condition was satisfied with `verified=true` and `verificationLevel=ui`. The Agent reported Android 12, then closed the phone session, releasing control. No settings were changed. The post-handback chat turn took 163 seconds, exceeding the old limit; it used 9 model requests. Seven total input actions include the initial app launch and one human gesture, leaving five model actions. There was no `PHONE_CANCELLED` in this continuation.

Evidence: [metadata and filtered UI facts](evidence/phone-use-handoff-cancellation-2026-10-24.json). Conversation: `1adb2ac7-b82c-4f32-92ae-6aa6e0bb11fa`; phone session: `1abe1ff2-ed3b-47f0-821f-cb413be03c2a`.

## Regression coverage

139 tests passed across 16 phone, Gateway route and web test files. Added checks cover a 100-second model goal, active time excluding human pauses, recoverable deadline expiry, unknown dispatch preservation, real caller cancellation, direct handback after tool pause and failed observation cleanup. Core typecheck, web production build, targeted lint and diff whitespace checks passed.
