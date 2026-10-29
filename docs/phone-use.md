# Phone Use (Android preview)

Phone Use lets an xopc Agent operate a registered Android device using a dedicated phone model. The first version uses an ADB runner on the Gateway host. Local emulators, USB phones and devices already connected to that ADB server can be discovered. Existing Alibaba Cloud Phones can also connect directly with an ADB endpoint and private key; cloud account provisioning and remote runners are not included yet.

For an existing cloud phone, start with the [Alibaba Cloud Phone setup guide](how-to/connect-aliyun-cloud-phone.md) to obtain its ADB address and private key.

## Share your current location with a cloud phone

In the Web phone panel, choose **Share current location**, select approximate or precise location, and click **Agree and share**. Your browser then asks for location permission. This uses the device running the UI even when Gateway runs in the cloud. The browser requires HTTPS or another secure context. Pause a running Agent before the first location application.

Choose a single sample (valid for 30 seconds) or foreground sharing for up to five minutes, refreshed every ten seconds. **Stop sharing**, leaving the view, permission withdrawal, source loss, sample expiry and task completion trigger restoration of the cloud phone's previous GPS location. If restoration cannot be verified, **Retry location cleanup** becomes available and dependent Agent actions remain blocked. Native mobile sharing screens and background tracking are not included yet.

The Wuying adapter uses the registered ADB connection and verifies both the location property and Android GPS. Unsupported image formats are rejected. Apps with location permission can read the location, and task models may see it on screen. Raw source samples do not enter chat or long-term memory; previously collected third-party app data cannot be recalled. Restoring GPS does not change the cloud phone's network address or account information.

## Set up a local emulator

1. Start an Android emulator with Android Studio or `android emulator start <AVD name>`.
2. Open **Settings → Phone Use** and enable Phone Use.
3. Select a configured real phone model and save it; see **Configure a phone model** below.
4. Refresh devices and add the emulator. New connections allow all applications by default; choose **Only selected apps** to restrict access using the installed app list. Agents with the phone_use tool enabled can use it without a separate device Agent list.
5. Open an allowed app manually, select the phone, enter a small goal and click **Start test run**.

The Gateway host must have Android SDK Platform Tools. The runner searches `ANDROID_HOME`, `ANDROID_SDK_ROOT`, common SDK directories and PATH. A custom executable can be set through `phone.adbPath` in `xopc.json`. The browser running the console does not provide USB access to a remote Gateway.

## Connect a phone wirelessly (Android 11+)

Open **Add phone → Wireless Android phone**. The phone and the **Gateway host** must share a local network; sharing a network with only the browser is insufficient. This version supports private IPv4 LAN addresses. A remote connector is not included.

For **QR pairing**, enable Developer options → Wireless debugging on the phone, choose **Pair device with QR code**, and scan the displayed code. Codes expire after 90 seconds. Status distinguishes pairing from connecting. Once connected, confirm the phone name and application access to save it.

For **Pairing code**, open **Pair device with pairing code** on the phone. Select a discovered pairing endpoint or enter its IP, pairing port and six-digit code. The connection port is discovered automatically; if mDNS is blocked, enter the port shown on the main Wireless debugging screen. Pairing and connection ports are different and dynamic; do not assume port 5555. **Already paired** connects with the current IP and connection port without pairing again.

Saved wireless phones retry connection during device discovery, at most once every 30 seconds per phone. The device menu also offers **Reconnect**, with manual address recovery. Reconnection checks the authenticated phone identity before updating its address and preserves the registration, default selection and app permissions. It never resumes an Agent task automatically. If the phone forgot this Gateway, pair again first, then reconnect the existing registration. Removing an xopc registration does not revoke Android's ADB trust; use the phone's Wireless debugging settings to forget the Gateway.

ADB and mDNS run on the Gateway host. If discovery fails, check Platform Tools, firewall and Wi-Fi client isolation, or use manual addresses. Pairing secrets and QR contents are transient and are not logged or stored in the database.

## Configure a phone model

After connecting to XOPC Cloud, an unset global phone model defaults to `xopc-cloud/phone`, using your existing Cloud authorization. It routes to hosted AutoGLM Phone; no separate BigModel key is needed on the client. Existing phone selections and Agent overrides are preserved. Cloud availability and account quotas apply.

Select a supported phone model in Phone Use and save it. The page shows its provider and credential status. Add or edit providers, API keys, model IDs and Phone Use action profiles centrally under **Intelligence → Models**.

For BigModel, configure Zhipu GLM China with model ID `autoglm-phone`, image input and the AutoGLM Phone action profile. Dedicated phone models must declare a matching action profile. The phone model selection is separate from the chat model. The mock model is reserved for internal development tests and is not listed in model settings.

Select AutoGLM and save it as the phone model. **Test model connection** sends a synthetic test image, not the current phone screen, and reports protocol validity and button grounding separately. This is a real model request and may incur provider charges. A successful connection test is not a task-success benchmark.

General visual models with image input and function tools are discovered automatically for OpenAI Chat Completions and Responses APIs, unless `supportsTools: false` excludes them. They use `structured-tools-phone-v1`; no dedicated phone training or native computer tool is required. In xopc, sign in with ChatGPT under the OpenAI provider, then select an image-capable GPT model in Phone Use and save. This reuses the existing credentials and OAuth refresh, with no separate phone key. Chat and vision selections remain available. Managed services and dedicated desktop models still require explicit phone support.

Dedicated phone models can be added with image input, OpenAI Chat Completions and an explicit Phone Use profile. Supported profiles are `autoglm-phone-v1`, `structured-phone-v1`, `doubao-seed-phone-v1`, `gui-owl-phone-v1`, and `structured-tools-phone-v1` (also supports Responses). No automatic model fallback is performed. Agent settings can override the global phone model without changing the chat model.

### Cloud models with your own key (BYOK)

In **Intelligence → Models**, add **Volcengine Ark** or **Alibaba Bailian · Phone Use**. Enter your own API key, save the provider, then select the model in Phone Use. The presets retain image input and the native phone action profile. Existing providers can add these models manually. Existing phone selections are not changed.

| Provider | Base URL | Preset model IDs | Phone profile |
|---|---|---|---|
| Volcengine Ark | `https://ark.cn-beijing.volces.com/api/v3` | `doubao-seed-2-1-pro-260915` | `doubao-seed-phone-v1` |
| Bailian Phone Use | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `gui-plus-2026-02-26` | `gui-owl-phone-v1` |

For Ark, sign in to the [Volcengine Ark console](https://console.volcengine.com/ark/), choose your project, create an API key under **API Key management**, and activate the chosen Seed model under model activation management. Follow the [official quick start](https://docs.volcengine.com/docs/ark/quick-start?lang=en). Use the exact model ID available to your account, or replace it with your `ep-...` inference endpoint ID while retaining the phone profile. Use the standard model service endpoint, not a Coding Plan credential/endpoint. The Gateway can also read `ARK_API_KEY` or `VOLCENGINE_API_KEY`.

The unavailable ModelScope GUI-Owl presets and unverified Seed Lite preset were
removed on 2026-10-27. ModelScope credentials remain usable for general inference.
The phone list now retains only the verified Seed Pro and Bailian GUI-Plus routes.

The [official GUI-Owl project](https://github.com/X-PLUG/MobileAgent/blob/main/README_zh.md)
links its Bailian hosted API to `gui-plus-2026-02-26`. This is the vendor's
GUI-Plus service name, not an alias for a particular open-weight 8B checkpoint.
Its native mobile action prompt passed screenshot grounding and real Android
navigation with xopc. Local BYOK uses
`dashscope-phone/gui-plus-2026-02-26`; the managed service is
`xopc-cloud/phone-gui-plus`. Use a **Beijing-region Bailian API key**, as required
by the [GUI-Plus documentation](https://help.aliyun.com/zh/model-studio/gui-automation).
The phone provider is separate from the existing computer provider so their
control protocols remain scoped to the chosen capability. Obtain a key through
the [Bailian API key guide](https://help.aliyun.com/zh/model-studio/get-api-key).

Keys are resolved through the existing Gateway provider credential flow. BYOK requests go to the configured provider; they do not require XOPC Cloud. Adding a provider/model does not switch an active session. Run **Test model connection** first: it sends a synthetic image and dispatches no device input. Native GUI adapters accept one action, reject malformed/batched/truncated output, and preserve host app restrictions and completion verification. Account access, latency, cost and real-app success require validation with your key; catalog cost placeholders do not mean inference is free.

When native UI text is empty, `observe` automatically makes a read-only screenshot transcription request to the configured phone model. Supply an optional `goal` on `observe` to read a specific value missing from otherwise populated native nodes. Unverified model completion in `run` / `step` also attempts one screenshot reading for the original goal. Reading uses the existing model-request and active-time budgets and never dispatches device input.

`facts` remains native-only. `readings` labels each result with `source` (`native_ui` or `screenshot`), `verification` (`observed`, `unverified` or `unavailable`), `frameId` and `capturedAt`. Visual readings never satisfy native completion predicates or upgrade task verification. Unreadable screens, exhausted budgets and password fields produce an unavailable reason instead of invented values. The chat Agent must attribute screenshot readings and their unverified status. Reading text is transient in operational reports; screenshot bytes never enter the chat transcript.

## Manage and operate a phone

Each registered device has a name, an enabled flag and an application access policy. New local and cloud connections default to **Allow all apps**. **Only selected apps** reads native application names from the phone and supports search and checkboxes, without entering package names. Existing allowlists remain selected-only until explicitly changed. Changing to selected-only requires at least one app. The app list uses the same pinned scrcpy server dependency as live video. Agents with the phone_use tool enabled can use authorized devices without a separate device Agent list. Changing access or removing the registration stops existing control. Removing a registration does not delete the emulator or its apps. A default device avoids repeated selection; disconnected devices are never silently replaced.

First open an allowed app, then enter one small authorized goal and optional expected completion text. Task controls support pause, resume, continue, stop and release. Resume clears held predictions; the next execution observes the screen again. A screen preview is temporary and available when execution is idle or paused.

The Agent tool is `phone_use`: `discover` → `open` (`observe` or `control`, optional allowed `appPackage`) → `observe` / `run` / `step` → `close`. `run` executes up to 6 actions by default, at most 12, and uses a configurable active execution budget (`phone.maxOperationDurationMs`, default 300,000 ms). Human intervention pauses this budget. On expiry it returns `operation_timeout` with the session paused and its facts/steps intact, rather than reporting user cancellation. Inspect and hand back before continuing. Each task retains action and model-request limits; its active time budget is capped by maxOperationDurationMs and maxSessionDurationMs. Connection lifetime is separate.

`verified=true` confirms the specified native UI condition, not an unrelated business result. A model's finish claim remains unverified without evidence. Exhausted budgets yield an unfinished result. Unknown dispatch outcomes require inspection before retrying. Stopping cannot undo an input already delivered to Android.

## Current boundaries

`phone.modelRequestTimeoutMs` sets the deadline for one phone-model response, including reading its body. It defaults to 45,000 ms and accepts 1,000–300,000 ms. A slow local vision model can use a longer deadline while the existing task active-time budget still bounds execution. Deadline expiry returns `PHONE_MODEL_TIMEOUT`; no action from that timed-out prediction is dispatched. Caller cancellation remains separate.

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
- If a requested exact input field is absent while its target value appears in other visible content, the next prediction receives a bounded reminder that the task is still unfinished. This does not generate input or add a model request. When explicit native completion conditions remain unmet, a model finish claim triggers a fresh observation and up to two bounded corrections. A delayed UI result can be verified without another prediction. Repeated unsupported finish claims pause the task as `completion_unmet`, without an extra reading request or automatic device input. Inspect before resuming.
- Android observation reuses a device-side accessibility process during an operation. Each snapshot reads the current native tree; screenshots and pre-dispatch freshness checks remain required. Completion, cancellation, human takeover and temporary previews send an explicit helper shutdown and wait for exit before handing off accessibility ownership. Another automation owner can prevent connection; xopc does not stop that owner automatically.
- Explicit replacement of one focused, identifiable non-password native field uses a short accessibility transaction: check app, node identity, bounds and old value, set the requested value once, and verify the same native node. An unknown outcome pauses for inspection. Insert operations and legacy driver integrations retain the clipboard/input path.
- Unicode text through the legacy path on Android 7+ uses a control-only scrcpy clipboard paste channel, without installing or switching input methods. Supplied text may remain on the phone clipboard; existing clipboard contents are never read or synced. Receipt ACKs are followed by native UI verification. Missing dependencies or unconfirmed insertion pauses for manual inspection; no automatic retry or APK installation occurs. Device settings can disable automatic text input. Password fields remain protected.
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

The Phone entry and phone workspace belong to the current chat. Only chats with an active Phone Use session or a recoverable assistance request show a phone entry. The workspace reads that conversation’s phone state, never a global device selection; switching chats or leaving chat removes the previous screen, including floating windows. Each chat keeps its own workspace tabs. Switching chats, completing a task, or hiding the panel keeps the connection open. Task completion releases operation ownership so another conversation can use the device. `close` finishes the current tool task; it does not disconnect the phone.

Connections remain open until explicitly disconnected or the Gateway stops. `phone.idleDisconnectMs` defaults to `0` (manual disconnect); Phone settings also offers 15, 30 or 60 idle minutes. Active tasks, manual control and foreground viewing do not count as idle. Video viewers and manual input permissions are released when the panel is hidden; the device connection remains.

Control is exclusive. If another chat or human owns the device, `PHONE_DEVICE_BUSY` returns HTTP 409 with `executionStarted: false`, occupancy information and `retryPolicy: user_initiated`. No task is queued or retried automatically. The source chat offers explicit takeover and confirmed task stopping. Phone settings remains the device-management entry. Stopping keeps the phone connected; disconnecting is a separate confirmed action. Uncertain dispatch outcomes require inspection and cannot be bypassed by reopening or cancelling.

Install the official pinned video server once with `pnpm exec tsx scripts/setup-phone-video.mts`. The chat panel then uses scrcpy H.264 video and WebCodecs; unsupported browsers explicitly fall back to snapshots. The Settings preview modal remains read-only snapshots. View only never injects input. Take over waits for outstanding device input before granting this browser exclusive control. Continuous single-pointer DOWN/MOVE/UP supports click, held drag and long press through a persistent connection. Back and non-password text remain within the app scope. Unicode uses the independent control-only clipboard channel, even when video falls back to snapshots.

Release keeps the task paused. Hand back re-observes the phone and continues the pending tool. If the Agent has already ended its reply, a deduplicated continuation input resumes the original conversation objective. Closing or hiding the phone tab releases human control; disconnect timeout keeps the task paused. Stop cancels the task and releases operation ownership while keeping the phone connected. Disconnect is a separate confirmed action. Isolated setup verification still closes its test session to confirm cleanup.

The main Agent can call `phone_use({ op: "request_user", reason: "Complete login on the phone" })` to request help; a plain `pause` only pauses the task. The task and remaining budgets are checkpointed in SQLite, without screenshots, credentials, verification codes or action coordinates. The Agent explains the required action in normal chat text. The existing phone entry shows a small unread dot; opening the phone loads a view and clears the dot on this client, without acquiring control or completing the request. The panel does not open automatically. Open the source chat to inspect or continue its phone task.

On the phone page, click **Take over phone** explicitly. Complete the action, then click **Done, continue task**; alternatively, return to chat and explicitly say “logged in, continue”. Direct physical-phone operation can be followed by **Already done, continue** without remote takeover. Ordinary questions and viewing do not resume the task. The phone page keeps task explanations in chat and shows only device/control state, the screen and the primary action; Back and text entry are available during manual control.

Authorized clients may watch simultaneously within the viewer limit, but only one client controls a phone. A competing takeover is rejected rather than stealing control. Returning to chat, hiding the phone or backgrounding releases manual control and keeps the task paused. A disconnected client loses its lease after expiry; reconnecting never restores control automatically. Video loss can fall back to snapshots without implicitly returning control to AI. A completion message cannot resume while another client is operating.

Completion is durably queued once, even if the previous turn is closing. Continuation observes the current screen and uses the original task and remaining budgets. Refresh preserves the request and this client's viewed marker. After Gateway restart, reconnecting revalidates the device and Agent. Interrupted continuation requires another explicit handback and never automatically replays device input.

Only Gateway administrators can access this live surface. Pixels are transient and excluded from stored reports and conversation sharing. Passwords and verification codes should be handled on the local device before returning to a non-sensitive screen.

The panel labels its snapshot fallback explicitly and offers video retry. Text input and Agent handback inspect native UI. Disconnect, hidden panels, geometry changes and handback release held touches; main resumes only after revocation. Human input has a separate action budget. If navigation leaves the allowed apps, pixels are cleared; recovery does not broaden permissions. Foreground sampling is not device-side per-app capture isolation.

The tested AVD uses an enabled host GPU. A disabled GPU can limit Android rendering despite a fast control socket. Cloud media/input adapters have a shared contract, but no cloud SDK is bundled or verified yet. Alibaba Cloud Phone ADB connections reuse scrcpy video and continuous touch over a dedicated authenticated TCP transport; see the setup guide below.

## Alibaba Cloud Phone over ADB

Follow the [Alibaba Cloud Phone setup guide](how-to/connect-aliyun-cloud-phone.md) for console entry points, key pair creation and binding, private key downloads, public/private endpoint selection, xopc setup and troubleshooting.

Choose **Settings → Phone Use → Add phone → Alibaba Cloud Phone**, enter a name and `host:port`, and upload the matching private key. Test the connection, check the device information and screenshot, then confirm Add phone. No Alibaba account AccessKey is required; configure the phone model separately in Models.

Cloud connections use direct TCP ADB with scrcpy video and continuous touch, with snapshot fallback, without modifying host ADB services or keys. Removing a connection only cleans up xopc registration and credentials; it does not destroy the paid instance or close the cloud-side endpoint.

### Reliability and UI evidence

Alibaba Cloud phones use a bundled, read-only accessibility helper that does not wait for global UI idle. Animated Settings pages can otherwise make `uiautomator dump` fail. The helper runs temporarily over the authenticated ADB transport and is removed after capture; it does not install an APK. The Gateway also checks that the hierarchy and screenshot belong to the same foreground application. Local ADB dumps use one consistent compressed hierarchy mode and bounded retries. Failed acquisition reports `PHONE_UI_UNAVAILABLE` instead of masquerading as a changed or empty UI; action freshness checks remain in place. To rebuild the bundled helper after source changes, run `node scripts/build-phone-ui.mjs <Android SDK directory>` with JDK 17, Android platform 36 and build-tools 36.0.0.

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


### Multiple phones and device-bound chats

Phone management's View screen action opens the shared global read-only component, including when another conversation controls the phone. It never acquires another operation lease. Global viewers cannot inject input or take over; video tickets use a separate viewer identity, and device-address control requests are rejected server-side. The source chat's entry uses the same component with that conversation's controls.

Multiple registered phones can stay connected at once. Ordinary chats use the system default unless the user explicitly selects another phone by its unique registered name/deviceId. Control in chat creates an empty conversation with customData.phoneDeviceId set to the selected device. This becomes that conversation's effective default, without submitting a task or taking control. Different chats can control different phones concurrently; operation ownership of each individual phone remains exclusive.

## Execution strategies and task results

Settings → Phone Use → Default execution strategy defaults to **Main Agent collaboration** (`phone.executionMode: "collaborative"`). The main Agent plans and sends meaningful small goals, records returned information, and decides the next goal. **Direct execution** (`"direct"`) delegates the complete authorized phone goal to the existing phone model. Both use the same Runtime, model, authorization, verification, takeover and dispatch checks. No separate Planner is created. The experimental `hierarchicalPlanning` flag is independent.

The source chat's phone panel selects the **next task** strategy; this preference persists for that chat. An explicit per-task `executionMode` overrides the chat preference, which overrides the global default. Changing settings does not mutate a running task. `discover` returns the effective strategy, while reports expose `executionMode` and `nextExecutionMode`. The Agent must follow the user's selection and must not switch strategies autonomously.

Use a returned `task.taskId` across related goals and continuation. Each run has a fresh `feedback.segmentId`. Omit taskId for a new task, never merely to reset a budget. Collaborative mode submits a small goal; direct mode submits the entire phone goal. For example:

```json
{
  "op": "run",
  "goal": "Inspect the displayed delivery-inclusive total; do not submit the order",
  "constraints": ["Do not submit, purchase or send anything"],
  "requestedOutputs": [{"key": "total", "description": "Read the displayed delivery-inclusive total"}],
  "maxActions": 6,
  "budget": {"maxActions": 24, "maxModelRequests": 30, "maxActiveDurationMs": 120000}
}
```

`constraints` are bounded model instructions and accumulate across fragments of the same task. They are not a claim that arbitrary natural-language restrictions are mechanically enforced. `completion` and `requestedOutputs` never independently authorize input. Task budgets span fragments and mode switches and can only be tightened. Runtime configuration remains a hard upper bound; manual intervention pauses active execution time.

Named `requestedOutputs` accept unique keys, descriptions and optional exact native `selector` objects (`resourceId`, `text`, `description`). A unique fully visible non-password native match returns an observed value without extra inference. Ambiguous or missing selectors return unavailable with a reason. Without a selector, each field uses a targeted read-only screenshot request within shared budgets. Screenshot fields are unverified, never proof of task completion. Task text, outputs and feedback are transient and excluded from durable operational reports.

`feedback` contains task/segment identity, strategy, outcome, stop reason, verification, runtime-derived progress, outputs with source/frame/time, evidence, per-fragment resource usage and nextAction. Outcomes are `running`, `completed`, `partial`, `blocked`, `needs_user`, `failed` and `cancelled`. Model finish without UI evidence is partial. Completion verifies the current fragment's declared UI conditions, not the entire user task or a business transaction. Missing output values remain explicitly unavailable. Action/request/time exhaustion does not authorize automatic retries or unlimited continuation.

To switch a current task, first select the next strategy and choose **Switch current task → Pause and switch**. The Runtime pauses, waits for dispatched input, discards predictions and coordinates, and observes again. It preserves taskId, restrictions and consumed budgets, and remains paused until the user explicitly hands back in the phone panel. Continue using the same taskId after handback. Human takeover, stale control epochs and unknown dispatch cannot be bypassed by switching. The read-only global viewer cannot change the source chat's strategy.

For an explicit user request through chat, `set_mode` sets `executionMode` for subsequent tasks; `applyCurrent: true` invokes the same pause-and-switch flow. `resume` cannot bypass the post-switch panel handback.

## HarmonyOS phone workspace

On a compatible Gateway, the HarmonyOS conversation header shows a phone icon when that conversation has Phone Use. Discovery stays in the conversation; tap the icon or swipe left to view the phone. Swipe right to return while viewing. During manual control, gestures operate the remote phone and the header returns to chat.

New Android, iOS and HarmonyOS pairings include cloud phone viewing and control by default; no separate phone authorization is needed. In Gateway paired-device details, **Cloud phone access** can be changed to **View only** or **Not allowed** while preserving other device capabilities. Revoking the device also disconnects its phone streams and invalidates its credentials. Explicitly disabled or restricted existing grants remain unchanged. Registration, ADB keys and phone settings remain administrator-only. Permission to control does not acquire ownership: the user still selects **Take over** to pause the Agent and operate the phone.

The phone page uses native H.264 video with an explicit snapshot fallback. Takeover pauses the Agent and waits for outstanding input. **Done, continue task** hands back and re-observes before continuing. Returning to chat or backgrounding releases manual ownership and leaves the task paused. A persisted assistance request can be reconnected with Take over. Reconnect does not reboot a cloud instance or replay inputs. Text entry remains subject to the existing non-password-field policy.

## Execution diagnostics and controlled model experiments

Phone operation reports expose bounded `performance` details: an operation ID, elapsed time, phase counts/durations, and numeric model-request metadata. The `PhoneRuntime` log entry with `phase=execution_timing` carries the same timing summary. UI hierarchy, capture, model requests, dispatch, input confirmation and settling are measured separately. Phases can overlap or nest; do not sum them as wall-clock percentages. JSON responses provide first-byte timing; token timing is available when the service streams tokens. Screen text, prompts, raw model responses and credentials are excluded from these diagnostics. Timing stays in tool details and logs instead of the main Agent's planning context.

Advanced experiments can be configured in `xopc.json` without changing the selected phone model:

```json
{
  "phone": {
    "autoGlmPrompt": "current",
    "autoGlmProtocol": "current",
    "autoGlmSampling": "current",
    "modelResponseMode": "json",
    "modelRepetitionGuard": false,
    "batchReadings": false
  }
}
```

These are the defaults. Each AutoGLM option can independently use `upstream`: the pinned upstream Chinese prompt with xopc host rules, image-first conversation turns, or upstream sampling defaults. Conversation history contains at most eight confirmed action turns in volatile adapter memory; rejected proposals and human actions are not represented as successful model actions. Task changes and human takeover clear that history. Host permissions, cancellation, text confirmation and completion validation continue to apply. This is a bounded host adaptation, not the unchanged standalone Python runtime.

`modelResponseMode: "stream"` requests SSE and records token timing. The service must support the streaming contract; incomplete streams never dispatch an action. `modelRepetitionGuard: true` can terminate substantial exact repetition while reading a stream. Both settings are experimental and remain opt-in. Compare real task completion, protocol errors, costs and latency before changing defaults; streaming alone does not establish faster action execution.

Cloud UI helpers are deployed by content hash and verified before reuse. Unicode input reuses its text-only channel within an operation and releases it on operation completion, takeover or cancellation. The experimental `batchReadings` option can combine visual outputs into one read-only request and defaults to false; missing values remain unavailable, and visual readings remain unverified.

Developers can use `scripts/benchmark-phone-apps-live.mts` with `baseline`, `efficiency`, `prompt`, `protocol`, `sampling`, `upstream`, or `stream` arms. It requires the dedicated test emulator, explicit real-model opt-in and a request cap. `scripts/verify-phone-efficiency-live.mts` checks helper deployment and Unicode input on that same dedicated emulator; its local ADB bridge does not measure cloud-network latency.
