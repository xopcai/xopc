# Phone Use (Android preview)

Phone Use lets an xopc Agent operate a registered Android device using a dedicated phone model. The first version uses an ADB runner on the Gateway host. Local emulators, USB phones and devices already connected to that ADB server can be discovered. Existing Alibaba Cloud Phones can also connect directly with an ADB endpoint and private key; cloud account provisioning and remote runners are not included yet.

For an existing cloud phone, start with the [Alibaba Cloud Phone setup guide](how-to/connect-aliyun-cloud-phone.md) to obtain its ADB address and private key.

## Set up a local emulator

1. Start an Android emulator with Android Studio or `android emulator start <AVD name>`.
2. Open **Settings → Phone Use** and enable Phone Use.
3. Select a configured real phone model and save it; see **Configure a phone model** below.
4. Refresh devices and add the emulator. New connections allow all applications by default; choose **Only selected apps** to restrict access using the installed app list. Agents with the phone_use tool enabled can use it without a separate device Agent list.
5. Open an allowed app manually, select the phone, enter a small goal and click **Start test run**.

The Gateway host must have Android SDK Platform Tools. The runner searches `ANDROID_HOME`, `ANDROID_SDK_ROOT`, common SDK directories and PATH. A custom executable can be set through `phone.adbPath` in `xopc.json`. The browser running the console does not provide USB access to a remote Gateway.

## Configure a phone model

After connecting to XOPC Cloud, an unset global phone model defaults to `xopc-cloud/phone`, using your existing Cloud authorization. It routes to hosted AutoGLM Phone; no separate BigModel key is needed on the client. Existing phone selections and Agent overrides are preserved. Cloud availability and account quotas apply.

Select a supported phone model in Phone Use and save it. The page shows its provider and credential status. Add or edit providers, API keys, model IDs and Phone Use action profiles centrally under **Intelligence → Models**.

For BigModel, configure Zhipu GLM China with model ID `autoglm-phone`, image input and the AutoGLM Phone action profile. Vision support alone does not qualify a model for Phone Use. The phone model selection is separate from the chat model. The mock model is reserved for internal development tests and is not listed in model settings.

Select AutoGLM and save it as the phone model. **Test model connection** sends a synthetic test image, not the current phone screen, and reports protocol validity and button grounding separately. This is a real model request and may incur provider charges. A successful connection test is not a task-success benchmark.

Other compatible models can be added in Models settings using image input, OpenAI Chat Completions and an explicit Phone Use profile. Supported profiles are `autoglm-phone-v1` and `structured-phone-v1`. No automatic model fallback is performed. Agent settings can override the global phone model without changing the chat model.

When native UI text is empty, `observe` automatically makes a read-only screenshot transcription request to the configured phone model. Supply an optional `goal` on `observe` to read a specific value missing from otherwise populated native nodes. Unverified model completion in `run` / `step` also attempts one screenshot reading for the original goal. Reading uses the existing model-request and active-time budgets and never dispatches device input.

`facts` remains native-only. `readings` labels each result with `source` (`native_ui` or `screenshot`), `verification` (`observed`, `unverified` or `unavailable`), `frameId` and `capturedAt`. Visual readings never satisfy native completion predicates or upgrade task verification. Unreadable screens, exhausted budgets and password fields produce an unavailable reason instead of invented values. The chat Agent must attribute screenshot readings and their unverified status. Reading text is transient in operational reports; screenshot bytes never enter the chat transcript.

## Manage and operate a phone

Each registered device has a name, an enabled flag and an application access policy. New local and cloud connections default to **Allow all apps**. **Only selected apps** reads native application names from the phone and supports search and checkboxes, without entering package names. Existing allowlists remain selected-only until explicitly changed. Changing to selected-only requires at least one app. The app list uses the same pinned scrcpy server dependency as live video. Agents with the phone_use tool enabled can use authorized devices without a separate device Agent list. Changing access or removing the registration stops existing control. Removing a registration does not delete the emulator or its apps. A default device avoids repeated selection; disconnected devices are never silently replaced.

First open an allowed app, then enter one small authorized goal and optional expected completion text. Task controls support pause, resume, continue, stop and release. Resume clears held predictions; the next execution observes the screen again. A screen preview is temporary and available when execution is idle or paused.

The Agent tool is `phone_use`: `discover` → `open` (`observe` or `control`, optional allowed `appPackage`) → `observe` / `run` / `step` → `close`. `run` executes up to 6 actions by default, at most 12, and uses a configurable active execution budget (`phone.maxOperationDurationMs`, default 300,000 ms). Human intervention pauses this budget. On expiry it returns `operation_timeout` with the session paused and its facts/steps intact, rather than reporting user cancellation. Inspect and hand back before continuing. The session also has separate action, model-request and duration limits.

`verified=true` confirms the specified native UI condition, not an unrelated business result. A model's finish claim remains unverified without evidence. Exhausted budgets yield an unfinished result. Unknown dispatch outcomes require inspection before retrying. Stopping cannot undo an input already delivered to Android.

## Current boundaries

Two experimental execution capabilities can be enabled independently in the top-level `phone` configuration:

```json
{
  "phone": {
    "enabled": true,
    "semanticControls": true,
    "hierarchicalPlanning": true
  }
}
```

Both default to `false`. Semantic execution supports observation-scoped exact native selectors and resolves a unique, fully visible non-password node to a tap immediately before the existing freshness and dispatch checks. AutoGLM retains its original prompt and observation payload for semantic-only execution; structured models receive the explicit selector protocol. Ordinary coordinate taps can also be anchored to a unique bounded native control without requiring a new model action format; ambiguous targets keep their original coordinates. Hierarchical execution compiles observable phases from explicit completion conditions and adds bounded execution recovery. AutoGLM keeps its original request protocol; the host handles risky Back replanning, missing focus and supported numeric input. Structured models can also receive the active phase. A Back boundary is a conservative native-UI heuristic, not Android back-stack proof. A model-requested Type can receive one focus tap only for the unique declared non-password field and matching intended value; a fresh observation must confirm focus and unchanged source text before that original input is sent once. An absent field produces bounded replanning feedback. Pending input is discarded on cancellation or control handoff, and an unknown dispatch is never retried. Stopped Clock-style keypads support canonical `HHh MMm SSs` entry only for a fully recognized direct setting command, an explicit matching completion app and duration, and a complete unique native keypad. Unknown or descriptive command clauses stay model-driven; completion values alone never authorize a write. Every key is confirmed from a new observation before the next key; a mismatch pauses for inspection. No timer is started by this controller. All generated actions share the existing action, request and time budgets. Final task verification is independent of phase progress. Plans and pending intents last for one `run` or `step` and are not persisted.

The four-arm real-app harness compares baseline, semantic execution, planning and their combination separately. See the [semantic execution and planning report](https://github.com/xopcai/xopc/blob/main/docs/design/technical/phone-use-semantic-planning-benchmark-2026-10-24.md) for measured completion rates and limitations.

- Device control is exclusive within the Gateway's SQLite state. Use one Gateway/runner for a phone; separate Gateway state directories are not coordinated.
- App permissions are enforced before model requests and before dispatch. An app can still transition after a check; this is not an OS sandbox or a guarantee against all UI races.
- Unicode text on Android 7+ uses a control-only scrcpy clipboard paste channel, without installing or switching input methods. Supplied text may remain on the phone clipboard; existing clipboard contents are never read or synced. Receipt ACKs are followed by native UI verification. Missing dependencies or unconfirmed insertion pauses for manual inspection; no automatic retry or APK installation occurs. Device settings can disable automatic text input. Password fields remain protected.
- Arbitrary shell, APK installation, file extraction, cloud provisioning, vendor cloud SDKs, HDC and iOS control are outside this version.
- Screenshots are not stored in chat transcripts, attachments, durable reports or ordinary logs. UI facts are transient, and only bounded operational metadata is stored. Screenshots go to the selected phone model; returned UI text can also reach the main Agent model.
- Active sessions do not automatically resume after a process restart. Reopen and observe before continuing.

## Verify development changes

```sh
pnpm exec vitest run src/phone/__tests__ src/gateway/hono/routes/__tests__/phone.test.ts
pnpm exec tsx scripts/verify-phone-use.mts
```

The verification script creates an isolated temporary Gateway state, uses authentication and the real lazy route path, and only operates a local emulator. It resets the emulator's Settings task without clearing app data. Explicit test screenshots and metadata go to `/tmp/xopc-phone-use-evidence` by default. Override with `XOPC_PHONE_EVIDENCE`.

For browser verification after `pnpm run build:web`, set `XOPC_PHONE_BROWSER=1`. To opt into real AutoGLM requests with an exported key, set `XOPC_PHONE_REAL_MODEL=1`. The default verification never calls a paid model.

## Live phone in chat

Chat sessions expose a Phone button and a conversation-scoped workspace tab. Wide layouts can open it automatically; narrow layouts use the full workspace with Back to chat.

Install the official pinned video server once with `pnpm exec tsx scripts/setup-phone-video.mts`. The chat panel then uses scrcpy H.264 video and WebCodecs; unsupported browsers explicitly fall back to snapshots. The Settings preview modal remains read-only snapshots. View only never injects input. Take over waits for outstanding device input before granting this browser exclusive control. Continuous single-pointer DOWN/MOVE/UP supports click, held drag and long press through a persistent connection. Back and non-password text remain within the app scope. Unicode uses the independent control-only clipboard channel, even when video falls back to snapshots.

Release keeps the task paused. Hand back re-observes the phone and continues the pending tool. If the Agent has already ended its reply, a deduplicated continuation input resumes the original conversation objective. Closing or hiding the phone tab releases human control; disconnect timeout keeps the task paused. Stop cancels execution and releases the phone.

Only Gateway administrators can access this live surface. Pixels are transient and excluded from stored reports and conversation sharing. Passwords and verification codes should be handled on the local device before returning to a non-sensitive screen.

The panel labels its snapshot fallback explicitly and offers video retry. Text input and Agent handback inspect native UI. Disconnect, hidden panels, geometry changes and handback release held touches; main resumes only after revocation. Human input has a separate action budget. If navigation leaves the allowed apps, pixels are cleared; recovery does not broaden permissions. Foreground sampling is not device-side per-app capture isolation.

The tested AVD uses an enabled host GPU. A disabled GPU can limit Android rendering despite a fast control socket. Cloud media/input adapters have a shared contract, but no cloud SDK is bundled or verified yet. Alibaba Cloud Phone ADB connections reuse scrcpy video and continuous touch over a dedicated authenticated TCP transport; see the setup guide below.

## Alibaba Cloud Phone over ADB

Follow the [Alibaba Cloud Phone setup guide](how-to/connect-aliyun-cloud-phone.md) for console entry points, key pair creation and binding, private key downloads, public/private endpoint selection, xopc setup and troubleshooting.

Choose **Settings → Phone Use → Add phone → Alibaba Cloud Phone**, enter a name and `host:port`, and upload the matching private key. Test the connection, check the device information and screenshot, then confirm Add phone. No Alibaba account AccessKey is required; configure the phone model separately in Models.

Cloud connections use direct TCP ADB with scrcpy video and continuous touch, with snapshot fallback, without modifying host ADB services or keys. Removing a connection only cleans up xopc registration and credentials; it does not destroy the paid instance or close the cloud-side endpoint.

### Reliability and UI evidence

Phone predictions include a bounded, in-memory action trajectory and native UI facts. AutoGLM retains the validated single-user JSON observation format; experimental dialogue, coordinate and sampling changes were withdrawn after real-app regressions. Recent action parameters, observed changes and recovery hints help the model avoid repeating failed paths. Screenshots, typed text and trajectory facts are not persisted in operational reports. A protocol failure can receive one format repair per run; that request counts toward the existing model budget. Repeating the same action at the same semantic screen state pauses with `no_progress`; inspect the phone and explicitly hand back before continuing.

AutoGLM `Type` and `Type_Name` replace the focused non-password field. The driver checks field identity, selects existing text when supported, sends input once and verifies the exact final value. Structured `typeText` keeps insertion as its default and accepts `mode: "replace"`. Verification may poll the screen but never resends uncertain input.

`run` and `step` accept optional `completion` conditions:

```json
{
  "op": "run",
  "goal": "Open About phone and read the Android version",
  "completion": {
    "appPackage": "com.android.settings",
    "textAny": ["Android version", "Android 版本"],
    "textAll": ["15"],
    "requireChange": true
  },
  "maxActions": 8
}
```

All supplied conditions must hold. Choose stable page identity and task-relevant evidence; do not add unrelated simultaneous-row requirements. `textAny` supports visible alternatives; `textAll` requires every string. Optional `field: { "resourceId": "package:id/query", "value": "coffee" }` checks an exact editable-field value. Existing `expectText` remains supported and is combined with these conditions. Conditions inspect all collected native nodes, independently of the shortened display facts. `requireChange` means an observed UI change during this run, not proof of a particular backend transaction. Completion must match two consecutive fresh observations, with cancellation, control ownership and authorization rechecked before publication. Model `finish` remains unverified.

For regression comparison, run `pnpm exec tsx scripts/benchmark-phone-reliability.mts --baseline <commit> --repeats 3 --output /tmp/phone-reliability.json`. This uses simulated devices and a scripted policy, comparing the old runtime with current orchestration; it does not measure real-model success. The opt-in `scripts/benchmark-phone-reliability-live.mts` performs bounded, paid AutoGLM calls on a local test emulator only. See the [optimization report](https://github.com/xopcai/xopc/blob/main/docs/design/technical/phone-use-reliability-optimization-2026-10-24.md) for evidence and limitations.

Real-app follow-up results and rejected experiments are documented in the [real-app optimization report](https://github.com/xopcai/xopc/blob/main/docs/design/technical/phone-use-real-app-optimization-2026-10-24.md).

### Cloud and independent-model device acceptance

With a registered Aliyun test phone and an exported `ZHIPU_API_KEY`, run
`XOPC_PHONE_REAL_MODEL=1 node --import tsx scripts/verify-phone-cloud-e2e.mts`.
This operates the selected cloud phone's Settings app through an isolated,
authenticated Gateway and checks Cloud → independent BigModel → Cloud switching.
The default device name is `阿里云测试手机`; override it with
`XOPC_PHONE_DEVICE_NAME`. It uses existing Cloud credentials, makes real model
requests, and saves test-only screenshots and metadata under
`/tmp/xopc-phone-cloud-e2e-evidence`.
