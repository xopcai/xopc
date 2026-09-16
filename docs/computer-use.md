# Computer Use preview

The current implementation is a locally approved, single-window macOS preview.
It combines a hosted GUI model with an application-owned Cua Driver; it does not
deploy model weights. It is not yet certified for unattended work or general
Codex-level task success.

## Setup

1. Use a signed macOS xopc desktop build containing Cua Driver 0.28.2. A browser
   tab alone cannot grant native desktop control.
2. In Settings → Integrations → Computer use (`#/settings/computer-use`), grant Accessibility and Screen
   Recording to xopc, then enable computer control.
3. Select and save one compatible GUI model from the shared selector in either
   Computer use or Settings → Models. Both edit the same global default:
   - BYOK: `dashscope-cn/gui-plus-2026-02-26`, using your existing Alibaba Beijing
     model connection (`DASHSCOPE_API_KEY` is also supported by the provider).
   - Managed: sign in to xopc Cloud, then use
     `xopc-cloud/computer-gui-plus-preview`.
4. Start the task from the desktop app using the application's name, for example
   “Read the current page in Feishu; do not click.” No bundle ID is required.
   To permit launching/restoring it, say “Open Feishu and read the current page.”

## App discovery and task scope

The public tool has five operations: `discover`, `open`, `observe`, `step`, `close`.
The built-in `tool_manual(computer_use)` describes the exact inputs. Discovery
returns names and running state, not screenshots or window contents. Its opaque
app references expire after five minutes and belong to one task and desktop host.
If a localized name is not found, the agent can list available apps rather than
guessing a bundle ID. Only genuinely ambiguous targets require a user choice.

`open` requires a discovered `appRef`, `mode` (`observe` or `control`) and an explicit
`prepare` boolean. Preparation can launch the app or bring a selected window forward,
including a visible window obscured by another app. Use preparation, not a model-driven
click or global shortcut, when the task only asks to bring the app forward;
it must be permitted by the user's task. It never accepts launch arguments or URLs.
Multiple windows are supported: native stacking order selects the front visible
window when unambiguous; otherwise the tool returns titled window references.
A window reference is tied to the process instance and cannot survive its restart.
Menu/proxy surfaces are distinguished using a bounded, screenshot-free AX root
check. Missing or incomplete selection metadata returns candidates instead of
guessing. Multiple independent processes with the same bundle ID currently
require the user to leave only the intended instance running.

Read-only sessions reject input in both the runtime and native broker, even with
Full control enabled. `observe` returns accessibility text; adding `question`
requests a visual answer from the same configured GUI model connection. The
answer is evidence, not verified business success. Screenshots remain ephemeral.
`step` is the only public input path, with raw actions confined to the broker.
If macOS provides no accessibility tree, the tool explicitly reports that
limitation; use a visual question to inspect valid pixels. It must not claim the
page is empty, invent controls or bypass the grounded-text-input checks.

The selector uses the connected model catalog, not a manually entered model ID.
If a Cloud model is missing, sign in and refresh the model catalog in Models.
The dedicated GUI model is separate from the chat/planning model; an empty
selection never inherits the chat model. Keys remain in existing provider
connections. Custom models expose a Computer Use protocol under Advanced in
the model editor. They must use the supported Chat Completions API and image
input; ordinary vision capability or a protocol declaration does not certify
GUI task quality.

Models shows a separate Computer Use capability card. Configured means the
binding and connection are available, not that this desktop has granted access
or a fresh inference test passed. Native access is managed only in Computer use.
Agent-specific model overrides still take precedence over the global default.
Changing the model affects new control sessions; stop and authorize again to
switch immediately. Directory refreshes never replace an explicit selection.
Withdrawn or incompatible selections are reported, not silently replaced.

Equivalent configuration fields (merge these into existing configuration):

```json
{
  "computer": { "enabled": true },
  "agents": {
    "defaults": {
      "models": {
        "computerUse": {
          "primary": "dashscope-cn/gui-plus-2026-02-26",
          "fallbacks": []
        }
      }
    }
  }
}
```

## Approval and stopping

By default, the first native dialog identifies the application, model and screenshot
recipient. A separate native dialog approves each exact input action. Clicking
Continue in chat only resumes the task; it never grants native permission.
After action approval, the agent resumes the held action with `step`; `observe`
is read-only and will not dispatch it.

To avoid repeated prompts, enable **Full control** in the local macOS Computer
use settings and accept its one-time native confirmation. This encrypted,
device-local consent survives restarts; it is not a Gateway config field and
cannot be enabled through tool arguments. It applies to all configured GUI
models, including agent overrides. Subsequent sessions and input actions run
without confirmation, including actions that may send or delete data. The app
does not reliably classify the business risk of arbitrary GUI actions.
Turning Full control off stops the active session and restores per-action
confirmation. OS permissions, single-window targeting, freshness/budget limits
and sensitive-app restrictions remain enforced. xopc cannot control its own
window to modify this permission. Browser permissions remain separate.

Use **Stop computer control** in settings or the tray. Hiding/minimizing the
xopc window, disconnecting, locking or suspending also revokes control. The
Ctrl+Alt+Esc shortcut is an additional path when successfully registered; the
settings button is the verified stop path in the current native smoke test.
Explicit Stop, screen lock and suspend pause new desktop control as well as
revoking the current session. Select **Resume desktop control** in settings
before starting a new task. Resuming does not revive an old grant or action.

Screenshots stay in bounded temporary memory and are not appended to chat
transcripts. Window accessibility text can appear in the transcript. Application
menu siblings and recent-item metadata are filtered out. Hosted inference still
transmits authorized window pixels/text to the disclosed model recipient, via
the current Gateway.

## Failure behavior

- Screenshot uploads use the endpoint-file route's dedicated request limit, then
  enforce the grant's 5MB frame limit and a 16-million-pixel decoded-image limit.
  Ordinary API requests remain limited to 1MB. Frames are memory-only and consumed
  once; cancellation and failed metadata validation clear retained pixel buffers.
- Upload failures carry a `COMPUTER_FRAME_UPLOAD_*` code, `phase`, `diagnosticId`
  and HTTP status when available. The diagnostic ID matches the Gateway request ID.
  Raw response bodies, credentials and image contents are not exposed. Uploads
  stop with their invocation and are never retried automatically. A failed
  verification upload preserves any already-completed input receipt.
- `GATEWAY_PROTOCOL_INCOMPATIBLE` means the desktop and Gateway have different
  realtime/endpoint protocols or Computer Use contracts, not bad model keys or
  missing macOS permissions. Update both to the same build and restart them.
  For a packaged app, stop an independently running incompatible Gateway, then
  retry startup so the app can launch its bundled service. The app never kills
  another service, rotates device identity, or relaxes tool validation to recover.
  Startup and desktop reconnects check the authenticated compatibility endpoint;
  incompatible handshakes close with 4409 instead of the authentication code 4401.
- If a desktop device identity has been revoked, open Settings → Integrations →
  Computer use and select **Re-register desktop device**. Only explicit approval
  in the native dialog replaces the device key and reconnects it. Cancelling
  preserves the revoked identity; you can retry from the same button. This does
  not grant Computer Use permissions.
- The configured action budget applies to each input dispatched by `step`.
  A held action reserves one slot; waiting for approval and resuming that exact
  action do not consume additional slots.
- Routes and credentials are frozen per control session. Managed calls pin the
  platform deployment fingerprint; a changed deployment requires a new session.
- One malformed model action can trigger at most one format re-prediction on the
  same image and model, before any input is dispatched. Both requests consume
  the model budget. No malformed JSON is repaired into an executable action.
- No automatic provider fallback, HTTP retry or replay of an uncertain native
  input. A revoked grant fails closed. If a pre-dispatch check positively confirms
  no input and detects changed evidence, the runtime takes one fresh observation
  and makes a new prediction. The old proposal/approval is discarded. Repeated
  changes stop with `COMPUTER_UI_UNSTABLE` rather than dispatching stale coordinates.
- Failed opens release their sessions and provide an error code, recovery hint,
  and window candidates where appropriate. Tool failures are reported as errors,
  not successful empty observations. Do not repeat a failure without a state change.
- `model_finished` is not proof of success. Inspect the actual output; an input
  receipt can be completed while its business outcome remains unknown.
- Passwords, verification codes, payments and security changes require manual
  handling. Terminal and password-manager targets are refused.

## Task continuity, verification and handoff

Each session keeps the last six completed input previews in bounded memory. The
GUI model receives those previews with the current window, not old screenshots.
Repeated identical input on an unchanged observed state stops before a third
dispatch. This is loop detection, not a guarantee against duplicate business writes.

`step` and `observe` accept an optional `expect`: either `{kind:"text",text:"Saved"}`
or `{kind:"field",label:"Title",value:"Expected title"}`. Native scoped accessibility
evidence returns `satisfied`, `not_met` or `unavailable`. A pre-existing satisfied
condition skips input. `verified:true` confirms that condition only, not the whole
task or a remote transaction. Missing/ambiguous accessibility evidence is unknown,
not success. Delayed application changes require a later observation.

Both GUI profiles support action, answer, finished claim and user takeover.
`structured-tools-v1` uses a single `computer_proposal` function for control
decisions and a separate read-only answer schema; no legacy action parser is kept.

Responses expose local session action/request budgets and expiry. Managed models
also expose available service ceilings from the platform catalog; these are not
remaining account balances or quota reservations. Single-request output is bounded
by the model/service ceiling and the runtime's 2048-token cap. Rate limits stop the
request without automatic retry or provider switching.

Close the desktop lease before using browser/application tools. Only a confirmed
`stopped` response permits the handoff; `stop_unconfirmed` retains the tool gate.
A successful close includes bounded factual recent actions. It does not authorize
bypassing a prior refusal. History is cleared on close. A disconnected endpoint
must reconnect (or confirm no such session) before the gate can be released.

The [acceptance matrix](design/technical/computer-use-acceptance.md) defines 60
real-application tasks and independent outcome checks. The report grader is not
itself a desktop benchmark runner. Unit fixtures and synthetic hosted grounding
tests do not certify unattended use or Codex-level success.

## Verification and packaging

```sh
pnpm exec vitest run src/computer/__tests__ electron/computer/__tests__ src/endpoint-tools/__tests__
XOPC_COMPUTER_LIVE_TEST=1 pnpm exec vitest run src/computer/__tests__/model-live.test.ts
node --import tsx scripts/verify-managed-computer.mts
pnpm run electron:build
```

The desktop and embedded Gateway now compile directly from current sources.
`electron:package` runs `node scripts/verify-electron-gateway-compatibility.mjs`
before staging an installer. This starts the built Gateway on a temporary port
with clean, isolated state and checks it using the built desktop preflight.
Missing or incompatible artifacts fail packaging; the verifier does not touch
your running Gateway, personal data, model credentials, or desktop applications.

Live model tests generate synthetic pixels, never capture your desktop. The
native fixture source is `scripts/computer-fixture.swift`; use
`scripts/computer-fixture.Info.plist` for its distinct test identity. The native
harness `scripts/verify-computer-native.mts` must be bundled with esbuild
(`--platform=node --format=esm --external:electron` and a Node `createRequire`
banner), then run as the Electron main entry with the verified driver path as
its first argument. Start the disposable fixture before running the harness.
It reads and writes only that fixture, never a personal app. Close the disposable
fixture afterwards. `XOPC_COMPUTER_NATIVE_DIAGNOSTICS=1` prints bounded structural
metadata for diagnosing native test failures, not screenshots or input values.

`build:node` cleans `dist`: always rebuild Node **before** the Electron server,
web resources and native helpers. Do not run it while relying on a package in
`dist/release`. The current local ARM64 directory package is signed but has not
been Apple-notarized or published as a public installer.

See [the implementation ledger](design/technical/computer-use-implementation-status.md)
for actual test evidence and remaining certification gaps, and
[the architecture RFC](design/technical/computer-use-architecture.md) for the
multi-platform, remote execution and quality-evaluation roadmap.
