# Computer Use preview

Use the macOS or Windows x64 desktop app to ask xopc to read or operate one application window. This preview requires local application access and either a compatible GUI model or a visual main model for programmable UI. Start with a small, supervised task.

## Programmable UI preview

Window preparation shares a five-second deadline across launch, restoration,
window discovery, geometry settling and screenshot checks. After restoration,
the original process and selected window must remain unchanged, two consecutive
window bounds must agree, and the selected window must provide a valid frame.
Pixels need not be identical during this readiness check; normal pre-input state
checks still apply. Cancellation stops the wait. A visible background window
does not require activation. In the current development build, authorized
`prepare:true` uses the macOS desktop host to start or restore an off-Space app,
then verifies the exact window. `prepare:false` leaves the desktop unchanged and
continues to refuse off-Space targets.

Failures distinguish hidden windows (`COMPUTER_WINDOW_HIDDEN`), readiness timeouts
(`COMPUTER_WINDOW_READY_TIMEOUT`), other Spaces (`COMPUTER_WINDOW_OTHER_SPACE`),
unavailable frames (`COMPUTER_CAPTURE_UNAVAILABLE`), and mismatched capture targets.
Only an explicit native unsupported-background code establishes
`COMPUTER_BACKGROUND_INPUT_UNSUPPORTED`; a generic refusal does not establish its
cause. Tool failures include a locally derived `recovery` action and retain
dispatch evidence. Settings shows localized explanations and preparation progress
with the existing stop action. These additions do not require new transport fields.
Capture retries never replay input; completed and uncertain receipts remain intact.

The target application does not need foreground keyboard focus. An already-visible
window uses background delivery, including when `prepare: true`; preparation only
launches or restores the app when needed. Keep the xopc desktop window shown and
not minimized. A target on another macOS Space, a hidden window, and an unfocused
window are different states. Authorized preparation can switch desktops automatically;
the input batch still requires a verified visible window with stable geometry.

The Agent can open `computer_use` with `planner: "agent"` and execute UI-only JavaScript through `op: "exec"`. This uses the current visual main model without a separate GUI model binding. The default GUI planner keeps `step` and `run`. Every exec that acts must first observe and use that snapshot within the same exec; snapshot IDs cannot be copied between model calls.

Programs reuse the existing broker and driver to observe controls, resolve exact labels, perform guarded inputs, wait for conditions and verify results. Operations remain sequential. JSON state survives calls in memory until close. Requested screenshots enter only the current model request; stored transcripts and diagnostic logs exclude pixels. Accessibility text and program source may appear in conversation history.

For predictable input, use mixed batches and explicit observation checkpoints:

```javascript
const s = await ui.observe({});
text(await ui.batch({ snapshotId: s.snapshotId, steps: [
  { kind: 'action', action: { kind: 'setValue', text: 'Draft' },
    target: { role: 'AXTextField', label: 'Title' } },
  { kind: 'action', action: { kind: 'setValue', text: 'Details' },
    target: { role: 'AXTextArea', label: 'Description' } },
  { kind: 'observe', expect: { kind: 'field', label: 'Title', value: 'Draft' } },
  { kind: 'action', action: { kind: 'activate' },
    target: { role: 'AXButton', label: 'Save' } },
  { kind: 'observe', expect: { kind: 'text', text: 'Saved successfully' },
    timeoutMs: 2000, visual: true }
] }));
```

Adjacent actions form one native dispatch. Each segment has one pre-dispatch
state check and one post-action observation, with no screenshots between inputs.
The driver still validates every target, checks native input identity, and honors
cancellation between inputs. Coordinate inputs also check native window geometry.
All primitive actions are supported; nested batches are refused. Every input
consumes the existing call/session budgets, including explicit waits. A batch
allows at most twelve inputs; exec defaults to six across all calls inside it.

A conditional checkpoint checks the current returned state first. Already-ready
conditions add no capture or delay; unmet conditions use bounded adaptive polling
(default two seconds, maximum five seconds and twenty resamples). An unmet or
unavailable condition stops before later inputs. A checkpoint without a condition,
or a visual checkpoint before more steps, yields `observation_required` for the
main model to inspect. Later targets after a conditional checkpoint must use
unique native role/label selectors resolved against the new complete snapshot;
stale refs and future-page coordinates are refused. Web/ambiguous targets require
a fresh model decision. A batch is sequential and does not make a focus or page
transition ready automatically.

`ui.act` also accepts `{kind:'batch',actions:[...]}` for one mixed segment. GUI
planners can propose mixed segments inside `run`; `step` remains one input.
`activateSequence` remains available for native button sequences. Authorization
is awaited directly; hosts retaining deferred decisions use an event-driven
`settle` command instead of fixed polling. Inputs no longer sleep for 200ms after
native acknowledgement. `ui.verify` and `ui.waitFor` can reuse the latest observation
within five seconds; `fresh:true` forces an independent read. Explicit `ui.observe`
always captures fresh state. Conditional waits and bounded capture recovery remain.

Check `status`, `nextStep`, verification and `receipts` before continuing.
`batch_completed` means the declared steps ended, not proof of unrelated business
outcomes. Per-input receipts preserve completed, unknown and unstarted portions
when a segment fails. Never replay a completed prefix or uncertain input.
No application-specific parsing, shortcuts or execution rules are used.

An opt-in macOS native candidate can execute a segment in one driver RPC when
the driver advertises `input.batch.exact.v1`. Older drivers and Windows keep the
existing guarded path; submitted native batches are never retried through it.
See [native batch implementation and local build](design/technical/computer-use-native-batch.md).

Initial macOS validation completed two real fixture inputs using a fixed script. It does not establish real-model task performance or certify the new mode on Windows. See the [validation record](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-programmable-ui-validation-2026-10-27.md).

Native input diagnostics separate identity checks, action validation, SDK calls and response validation; the legacy renderGraceMs field remains zero. SDK time includes RPC and OS work. Run opt-in fixture tests with `pnpm exec tsx scripts/benchmark-computer-input-live.mts 30`, or use `1 program` for the programmable path. The macOS live model/network comparison is `pnpm exec tsx scripts/benchmark-computer-paired-live.mts 3` (requires `DASHSCOPE_API_KEY`, sends only its disposable fixture window, and incurs real inference usage). See the [validation report](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-network-paired-validation-2026-10-27.md).

## Windows x64 preview

Windows supports window observation, native UIA button activation, text entry and keyboard input through the same local broker as macOS. Enable Computer Use, allow the application in Settings, and select a compatible model. Start with Calculator or a disposable native text field. Applications without a supported background input route may refuse actions; the runtime does not silently switch to foreground input.

Run in your signed-in interactive desktop. A service in Session 0, the lock screen, UAC prompts and higher-integrity targets are outside this preview's certified scope. Windows does not use the macOS Accessibility/Screen Recording settings.

Text entry requires one currently observed native field with `inputAllowed: true`. xopc supplements the pinned driver's observation with Windows UIA password/read-only metadata, uniquely matches native control bounds, and rechecks the runtime identity and safety state immediately before dispatch. Password, disabled, offscreen, read-only, ambiguous and unverified fields require manual input. Native `setValue` replaces the value; `typeText` appends on the Windows ValuePattern path rather than assuming caret insertion. Web-content fields retain the existing Browser Use workflow.

Keys require a verified non-password control focused inside the authorized window. The broker rechecks focus and targets that exact native token in background mode. Windows uses `ctrl`, not `cmd`; Backspace and Delete remain distinct. Global/window-escape shortcuts are refused. Some background chords are unsupported by the target toolkit and return a refusal. The runtime never retries a refused/uncertain input through foreground or global injection. Drag, context-menu, mixed-DPI and broad third-party application compatibility are not certified. ARM64 and a fully signed Windows installer remain separate release checks. The macOS feature set is unchanged.

For developers, run `node scripts/setup-computer-driver.mjs`, then `pnpm exec tsx scripts/run-computer-windows-validation.mts`. This opt-in check opens Windows Calculator, clears its current expression, computes 6 × 7, verifies 42, checks duplicate-action receipts, and stops the broker. It requires an interactive Windows x64 session, leaves Calculator open, and writes content-free evidence under `.cache/computer-windows-validation/result.json`. It does not call a model or certify Gateway/network integration or the installer.

For native text and real-model validation, run `pnpm exec tsx scripts/run-computer-windows-input-validation.mts [provider/model]`. It defaults to the existing `xopc-cloud/computer` route, creates and closes its own WinForms app, checks Unicode/multiline append, value replacement, End/Backspace and password/read-only refusals, then asks the actual model to replace an existing sample, press End and activate Verify through ComputerRuntime and the real broker. The app requires both the exact text and the key event before reporting PASS. GUI-Plus can use the bounded native `set_value` extension with a current field ref and complete replacement text. Only this disposable window is sent to the model; normal provider usage charges apply. Credentials remain in their existing store; session/config/database state and evidence are isolated under `.cache/computer-windows-input-validation/<run-id>/`. No model responses are stubbed. Endpoint transport is in-process, so this check does not certify Gateway networking, other apps or the installer.

See [Windows input validation evidence](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-windows-input-validation.md) for the tested build, model request counts and remaining scope.

The [installed Windows validation](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-windows-installed-validation.md) additionally exercises the production NSIS installer, normal packaged app and bundled Gateway, authenticated session input, signed desktop WebSocket, screenshot uploads, real chat/GUI models, restart and uninstall. Run `node --import tsx scripts/run-computer-windows-installed-validation.mts` after building the installer, in a clean interactive Windows account. Authenticode signing remains a separate release check.

The opt-in [Windows reliability matrix](https://github.com/xopcai/xopc/blob/main/docs/design/technical/windows-computer-reliability.md) covers lost action results, private-driver crashes, hidden control UI and abrupt Gateway exit, plus WinForms/WPF fixtures, Calculator and a limited Notepad case. It records phase timings and stops on unsupported native keys without retrying through global input. CI publishing requirements are unchanged.

## Set up

1. Install a desktop build that includes Computer Use for your platform.
2. Open **Settings → Integrations → Computer use** (`#/settings/computer-use`). Enable computer control. On macOS, grant Accessibility and Screen Recording permissions to xopc.
3. Allow the applications you intend to use. Start with individual applications rather than unrestricted app access.
4. Choose a compatible GUI model from the connected catalog and save it. For your own key, connect the appropriate provider first; for XOPC Cloud, sign in, refresh the catalog, and select `xopc-cloud/computer` (XOPC Cloud Computer / XOPC 云端电脑操作). Ordinary chat selection does not configure this capability.
5. In desktop Chat, ask: `Read the current page in Feishu; do not click.` If the app needs to be opened, explicitly ask: `Open Feishu and read the current page.`

Verify that the answer matches the intended application and window before authorizing changes. If several windows or processes match, select the intended one rather than guessing.

If the desktop returns `COMPUTER_WINDOW_OTHER_SPACE`, the target is on a different macOS desktop/Space and the operation has not been authorized to prepare it, or the host lacks preparation support. When the task authorizes opening/restoring the app, the current macOS development build can use `prepare:true` to recover it automatically. A five-second preparation timeout is a distinct failure: inspect its diagnostics before another attempt, and never replay input whose outcome is uncertain.

## Small goals in one call

Use `computer_use` with `op: "run"`, one authorized goal, and a native `expect` condition to perform several guarded inputs without returning to the main Agent after each one:

```json
{
  "op": "run",
  "goal": "Complete the Start → Continue → Finish workflow in this test window",
  "expect": { "kind": "text", "text": "PASS: Small goal complete" },
  "maxActions": 6
}
```

The loop stops on verified condition evidence, a model handoff, a refusal, or a budget boundary. `maxActions` defaults to 6 and accepts 1–12, including waits. It yields after 120 seconds between completed actions; existing session, model and rescue budgets still apply. `goal_limit` is unfinished, and a model success claim remains unverified. Already-visible text returns `condition_present` without input; use a page-specific result, exact field value, or selected state instead of a navigation label.

Only fresh post-action frames are reused, for up to five seconds and only inside this invocation. Each next action still passes local authorization and a fresh native target/state check. Cached frames are zeroed on consumption or exit and never retained across Agent turns. Actions on one window remain sequential. The existing `step` operation still performs at most one input; `observe` remains a fresh independent read.

For structured function-tool models, `run` can request a conditional plan of two to six native button presses. Before consuming a queued continuation, the executor takes up to three additional post-action observations until two consecutive snapshots agree. Unstable or failed capture hands off with the completed receipt; it never replays that input. These extra checks avoid mistaking an unfinished render for the next step's state. Before each press, the executor checks an exact expected native display value, resolves the button's current ref, and uses the ordinary broker authorization and fresh target/state check. It proceeds only after the previous dispatch completed and its post-action state matches the current observation. Ambiguous/missing/disabled targets, unexpected display values, changed state, read-only mode or a new call discard the plan. Coordinates, key sequences, arbitrary text entry and saved historical refs are excluded. Partial AX text can supply an exact positive static-text guard; it never proves absence or global uniqueness. Unsupported models continue using one decision per action. Model budgets count actual outbound requests, including corrections, rather than locally consumed plan steps.

`run` results include `actionsExecuted`, `modelRequests`, `observationsReused`, `stabilityObservations`, `elapsedMs`, `phaseMs`, `nativeMs` (fresh check, native input, and post-action capture), and `stopReason`. These describe the narrow goal, not proof of unrelated business outcomes. See the [live Calculator validation](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-small-goal-validation.md) for measured results and scope.

## Custom OpenAI-compatible models

Models using `openai-completions` or `openai-responses` with `input: ["text", "image"]` automatically appear in the Computer Use picker, regardless of provider name or model ID. They use standard function tools to propose actions for the local broker to validate and execute, and remain available for ordinary chat and vision.

OpenAI-compatible APIs are assumed to support function tools unless the model definition or `modelOverrides` in `models.json` sets `supportsTools: false`. Set `supportsTools: true` to declare support explicitly. Confirm that your service supports both images and function tools; appearing in the picker does not verify remote capability. Computer Use connections currently require HTTPS.

An explicit `computerUse.profile` takes precedence. Use `openai-responses-computer-v1` only for endpoints supporting the native `computer` tool. Other compatible visual models automatically use `structured-tools-v1` with function tools on their configured API.

The OpenAI provider can reuse its ChatGPT OAuth binding for Computer Use. `openai/gpt-6.1-sol` has passed real visual recognition and a native disposable-window button press; see [OAuth validation evidence](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-chatgpt-oauth-validation.md) for scope and reproduction.

## XOPC Cloud service

The hosted `computer` service retains the GUI-Plus Preview capability and its published limits. Upgrading to a client containing the public-service migration converts `xopc-cloud/computer-gui-plus-preview` to `xopc-cloud/computer`. Your own provider model references remain unchanged. `auto` and `advanced` do not replace this dedicated GUI model.

The public catalog supplies the Computer Use profile, service limits, and an opaque deployment revision. The client pins that revision for each computer session. If the deployment changes, refresh the catalog and reopen the session; stale requests are rejected before being sent to the model. Actual supplier model IDs and origins remain internal to the cloud service.

## Give a clear task

State the application, desired result and whether changes are allowed. A read-only request does not permit clicking or typing. For a control task, define an observable completion condition, such as a saved title, and inspect the final application state yourself.

Screenshots needed for visual reasoning may be sent to the selected hosted model. They are kept temporarily rather than as a desktop screenshot archive. Avoid exposing unrelated sensitive content in the target window.

Passwords, verification codes, payments and security changes require manual handling. Terminal and password-manager targets are refused. The preview is not certified for unattended work.

## Recover from a failure

| Symptom | What to do |
| --- | --- |
| Model is missing | Sign in or reconnect the provider, refresh Models, and select a compatible GUI model |
| Cannot read or control the window | Check macOS permissions and the application's allowlist entry |
| Multiple matching windows | Select or leave open only the intended target |
| Desktop and Gateway are incompatible | Update both to the same build and restart; stop an incompatible separately running Gateway |
| Desktop device was revoked | Use **Re-register desktop device** and approve the native dialog; app-control permissions are separate |
| Model or upload request fails | Keep the diagnostic/request ID, inspect logs, and fix the reported cause before retrying |
| An action may already have happened | Inspect the application before repeating it; an uncertain action is not automatically replayed |

The runtime may discard a proposal and observe/plan again only when the desktop explicitly confirms that the window changed **before dispatch**, without an execution receipt. This uses a shared session allowance: `computer.maxRescuesPerSession` defaults to 1, accepts 0–3, and 0 disables rescue. Raising it requires a new session; lowering it takes effect immediately. New proposals retain the original goal, target, model and local authorization checks. Uncertain delivery, native failures and unchanged screenshots never trigger rescue. See [bounded rescue](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-bounded-rescue.md).

A model saying it finished is not proof that a save or remote transaction succeeded. Review the actual output. Stop computer control before switching to another browser or application tool.

For failure diagnosis, ask for the current Computer Use report (`computer_use` with `op: "report"`). This reads local metadata without touching the desktop or model. It separates failure stage, actual model calls, completed or uncertain inputs and native condition checks. Errors and close also include the available report. Reports contain no screenshots or window/input text and expire from memory after thirty minutes; restarting clears them. See [diagnostics and paired evaluation](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-diagnostics-evaluation.md) for metrics, comparison commands and tested limits.

For website-only work, see [Browser automations](./browser-automations.md). For provider connection, see [Models and providers](./models.md).

## Native semantic controls

For native controls that advertise accessibility actions, xopc can activate the exact observed element or open its context menu without aiming at pixels. This includes buttons and supported checkbox, radio and disclosure controls. Native text fields retain direct value entry. Every action uses the existing application access policy, bound window, fresh observation and execution receipt.

Structured GUI models and the XOPC GUI-Plus prompt extensions can request these actions by element reference. GUI-Plus uses `activate` or `show_menu` with an exact current `ref`. Coordinate models also benefit: an unambiguous single click on a supported native control is converted before authorization into an element action. Double clicks, overlapping targets, incomplete accessibility observations and web content retain coordinate handling. A refused or uncertain semantic action is never automatically retried with coordinates. Observe the actual result before continuing; a successful native call does not prove that a save or submission succeeded.

Native activation and the real TextEdit context menu have been verified on macOS. See [validation evidence and reproduction](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-native-semantics-validation.md) for the tested scope and live test commands.

## Reuse verified navigation

Ask xopc to remember a successfully verified native navigation routine, such as opening a uniquely labelled tab. Saving is explicit: `computer_use` closes with `saveFlowAs`. It releases desktop control first and saves only a complete native activate/context-menu sequence ending with a verified selected condition or positive page-specific text. A model saying “done” is insufficient. Typing, coordinates, key shortcuts, ambiguous controls, failures, takeovers and uncertain execution are excluded from this first version.

`flows` lists saved titles/IDs for the same Agent and workspace; `step` accepts a returned `flowId` alongside the **current** goal and completion condition. Reuse supplies historical hints to the selected GUI model and re-grounds a new action using a fresh observation. It preserves local authorization, app/device scope, existing budgets and the rule against retrying uncertain input. It does not replay a script or certify a business outcome. `forget_flow` removes a saved record locally.

Flows survive restart in the existing private SQLite database, expire after thirty days and are capped at thirty-two per Agent/workspace. Only titles, native roles/labels, action kinds, historical condition, coverage and app/device identity are retained. No screenshots, typed values, goals, coordinates or old element refs are stored. Choose non-sensitive titles and controls. See [capture/reuse contract and validation](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-verified-flows.md).

The pinned macOS driver cannot certify complete accessibility coverage. Such snapshots retain their partial status: they can supply observed native hints plus positive page-specific text, but cannot prove absence, label uniqueness or selected-state conditions. Bare control labels and text already visible before input are rejected. See [real TextEdit validation](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-verified-flows-live-validation.md) for restart, local authorization and lost-reply evidence.

The opt-in [real hosted GUI-Plus validation](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-verified-flows-hosted-validation.md) additionally exercises capture, reuse in independent processes, ordinary local access checks and no replay after a lost reply using actual provider responses.

Newly captured flows bind the authenticated desktop device identity, so a new network connection after restart can reuse them with fresh authorization. Re-enrolling as a different device does not transfer those hints. Older flows without device identity retain their original endpoint restriction. See [real Gateway/desktop network validation](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-verified-flows-network-validation.md).

## Window preview in desktop chat

An authorized Computer Use session can show its current window in a local chat
preview card. Expand the card for a larger view, hide it to pause capture, or use
**Stop and take over** to wait for confirmed control release. Window previews
use a separate native capture pipeline and do not add model observations or
intermediate screenshots to input batches. Frames remain ephemeral and local;
browser-only and remote viewing are not included. See the
[technical design and validation](design/technical/computer-use-window-preview.md).

## Native text editing

Native editors use bounded stable capture before model decisions: up to six captures must produce a repeated identical full target/state snapshot (the matching samples need not be adjacent, so a blinking caret does not cause sampling aliasing). Before any input, the broker can take up to four fresh samples, but it dispatches only when the complete original target and unmasked state digest match exactly. Persistent changes still refuse input under the original rescue limit. Generic function-tool `typeText` proposals must include a point inside one currently exposed editable field; missing or ambiguous targets use the existing single format correction before dispatch. Text expectations can use positive multiline values from scoped native editable controls; partial coverage cannot prove absence, field uniqueness or full task completion.

Native capture recovery only re-reads the same exact process and window when the optional pixel frame is explicitly invalid: at most three captures with a 100 ms abortable delay between attempts. Identity mismatches and persistent invalid frames still stop control; no preceding input is replayed. SDK key and scroll error envelopes are treated as refusals, never completed inputs.
