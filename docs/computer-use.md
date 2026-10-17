# Computer Use preview

Use the macOS desktop app to ask xopc to read or operate one application window. This preview requires a compatible GUI model and native permissions. Start with a small, supervised task.

## Set up

1. Install a signed macOS desktop build that includes Computer Use.
2. Open **Settings → Integrations → Computer use** (`#/settings/computer-use`). Enable computer control and grant macOS Accessibility and Screen Recording permissions to xopc.
3. Allow the applications you intend to use. Start with individual applications rather than unrestricted app access.
4. Choose a compatible GUI model from the connected catalog and save it. For your own key, connect the appropriate provider first; for XOPC Cloud, sign in, refresh the catalog, and select `xopc-cloud/computer` (XOPC Cloud Computer / XOPC 云端电脑操作). Ordinary chat selection does not configure this capability.
5. In desktop Chat, ask: `Read the current page in Feishu; do not click.` If the app needs to be opened, explicitly ask: `Open Feishu and read the current page.`

Verify that the answer matches the intended application and window before authorizing changes. If several windows or processes match, select the intended one rather than guessing.

## Custom OpenAI-compatible models

Models using `openai-completions` or `openai-responses` with `input: ["text", "image"]` automatically appear in the Computer Use picker, regardless of provider name or model ID. They use standard function tools to propose actions for the local broker to validate and execute, and remain available for ordinary chat and vision.

OpenAI-compatible APIs are assumed to support function tools unless the model definition or `modelOverrides` in `models.json` sets `supportsTools: false`. Set `supportsTools: true` to declare support explicitly. Confirm that your service supports both images and function tools; appearing in the picker does not verify remote capability. Computer Use connections currently require HTTPS.

An explicit `computerUse.profile` takes precedence. Use `openai-responses-computer-v1` only for endpoints supporting the native `computer` tool. Other compatible visual models automatically use `structured-tools-v1` with function tools on their configured API.

The OpenAI provider can reuse its ChatGPT OAuth binding for Computer Use. `openai/gpt-6.1-sol` has passed real visual recognition and a native disposable-window button press; see [OAuth validation evidence](./design/technical/computer-use-chatgpt-oauth-validation.md) for scope and reproduction.

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
