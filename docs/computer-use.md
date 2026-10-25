# Computer Use preview

Use the macOS or Windows x64 desktop app to ask xopc to read or operate one application window. This preview requires a compatible GUI model and local application access. Start with a small, supervised task.

## Windows x64 preview

Windows supports window observation, native UIA button activation, text entry and keyboard input through the same local broker as macOS. Enable Computer Use, allow the application in Settings, and select a compatible model. Start with Calculator or a disposable native text field. Applications without a supported background input route may refuse actions; the runtime does not silently switch to foreground input.

Run in your signed-in interactive desktop. A service in Session 0, the lock screen, UAC prompts and higher-integrity targets are outside this preview's certified scope. Windows does not use the macOS Accessibility/Screen Recording settings.

Text entry requires one currently observed native field with `inputAllowed: true`. xopc supplements the pinned driver's observation with Windows UIA password/read-only metadata, uniquely matches native control bounds, and rechecks the runtime identity and safety state immediately before dispatch. Password, disabled, offscreen, read-only, ambiguous and unverified fields require manual input. Native `setValue` replaces the value; `typeText` appends on the Windows ValuePattern path rather than assuming caret insertion. Web-content fields retain the existing Browser Use workflow.

Keys require a verified non-password control focused inside the authorized window. The broker rechecks focus and targets that exact native token in background mode. Windows uses `ctrl`, not `cmd`; Backspace and Delete remain distinct. Global/window-escape shortcuts are refused. Some background chords are unsupported by the target toolkit and return a refusal. The runtime never retries a refused/uncertain input through foreground or global injection. Drag, context-menu, mixed-DPI and broad third-party application compatibility are not certified. ARM64 and a fully signed Windows installer remain separate release checks. The macOS feature set is unchanged.

For developers, run `node scripts/setup-computer-driver.mjs`, then `pnpm exec tsx scripts/run-computer-windows-validation.mts`. This opt-in check opens Windows Calculator, clears its current expression, computes 6 × 7, verifies 42, checks duplicate-action receipts, and stops the broker. It requires an interactive Windows x64 session, leaves Calculator open, and writes content-free evidence under `.cache/computer-windows-validation/result.json`. It does not call a model or certify Gateway/network integration or the installer.

For native text and real-model validation, run `pnpm exec tsx scripts/run-computer-windows-input-validation.mts [provider/model]`. It defaults to the existing `xopc-cloud/computer` route, creates and closes its own WinForms app, checks Unicode/multiline append, value replacement, End/Backspace and password/read-only refusals, then asks the actual model to replace an existing sample, press End and activate Verify through ComputerRuntime and the real broker. The app requires both the exact text and the key event before reporting PASS. GUI-Plus can use the bounded native `set_value` extension with a current field ref and complete replacement text. Only this disposable window is sent to the model; normal provider usage charges apply. Credentials remain in their existing store; session/config/database state and evidence are isolated under `.cache/computer-windows-input-validation/<run-id>/`. No model responses are stubbed. Endpoint transport is in-process, so this check does not certify Gateway networking, other apps or the installer.

See [Windows input validation evidence](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-windows-input-validation.md) for the tested build, model request counts and remaining scope.

The [installed Windows validation](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-use-windows-installed-validation.md) additionally exercises the production NSIS installer, normal packaged app and bundled Gateway, authenticated session input, signed desktop WebSocket, screenshot uploads, real chat/GUI models, restart and uninstall. Run `node --import tsx scripts/run-computer-windows-installed-validation.mts` after building the installer, in a clean interactive Windows account. Authenticode signing remains a separate release check.

## Set up

1. Install a desktop build that includes Computer Use for your platform.
2. Open **Settings → Integrations → Computer use** (`#/settings/computer-use`). Enable computer control. On macOS, grant Accessibility and Screen Recording permissions to xopc.
3. Allow the applications you intend to use. Start with individual applications rather than unrestricted app access.
4. Choose a compatible GUI model from the connected catalog and save it. For your own key, connect the appropriate provider first; for XOPC Cloud, sign in, refresh the catalog, and select `xopc-cloud/computer` (XOPC Cloud Computer / XOPC 云端电脑操作). Ordinary chat selection does not configure this capability.
5. In desktop Chat, ask: `Read the current page in Feishu; do not click.` If the app needs to be opened, explicitly ask: `Open Feishu and read the current page.`

Verify that the answer matches the intended application and window before authorizing changes. If several windows or processes match, select the intended one rather than guessing.

If the desktop returns `COMPUTER_WINDOW_OTHER_SPACE`, the target is on a different macOS desktop/Space. Leave full screen or place the chat and target window on the same desktop with both visible. Clicking the target and then returning to a full-screen chat on another Space makes it unavailable again; repeated foreground requests do not fix that layout.

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

`run` results include `actionsExecuted`, `modelRequests`, `observationsReused`, `stabilityObservations`, `elapsedMs`, `phaseMs`, `nativeMs` (fresh check, input including render grace, and post-action capture), and `stopReason`. These describe the narrow goal, not proof of unrelated business outcomes. See the [live Calculator validation](https://github.com/xopcai/xopc/blob/main/docs/design/technical/computer-small-goal-validation.md) for measured results and scope.

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

## Native text editing

Native editors use bounded stable capture before model decisions: up to six captures must produce a repeated identical full target/state snapshot (the matching samples need not be adjacent, so a blinking caret does not cause sampling aliasing). Before any input, the broker can take up to four fresh samples, but it dispatches only when the complete original target and unmasked state digest match exactly. Persistent changes still refuse input under the original rescue limit. Generic function-tool `typeText` proposals must include a point inside one currently exposed editable field; missing or ambiguous targets use the existing single format correction before dispatch. Text expectations can use positive multiline values from scoped native editable controls; partial coverage cannot prove absence, field uniqueness or full task completion.

Native capture recovery only re-reads the same exact process and window when the optional pixel frame is explicitly invalid: at most three captures with a 100 ms abortable delay between attempts. Identity mismatches and persistent invalid frames still stop control; no preceding input is replayed. SDK key and scroll error envelopes are treated as refusals, never completed inputs.
