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
4. Open the target application with one visible window. Start the task from the
   desktop app and explicitly identify the application's bundle ID.

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

The first native dialog identifies the application, model and screenshot
recipient. A separate native dialog approves each exact input action. Clicking
Continue in chat only resumes the task; it never grants native permission.
After action approval, the agent resumes the held action with `step`; `observe`
is read-only and will not dispatch it.

Use **Stop computer control** in settings or the tray. Hiding/minimizing the
xopc window, disconnecting, locking or suspending also revokes control. The
Ctrl+Alt+Esc shortcut is an additional path when successfully registered; the
settings button is the verified stop path in the current native smoke test.

Screenshots stay in bounded temporary memory and are not appended to chat
transcripts. Window accessibility text can appear in the transcript. Application
menu siblings and recent-item metadata are filtered out. Hosted inference still
transmits authorized window pixels/text to the disclosed model recipient, via
the current Gateway.

## Failure behavior

- If a desktop device identity has been revoked, open Settings → Integrations →
  Computer use and select **Re-register desktop device**. Only explicit approval
  in the native dialog replaces the device key and reconnects it. Cancelling
  preserves the revoked identity; you can retry from the same button. This does
  not grant Computer Use permissions.
- The configured action budget applies to both `step` and direct `act` calls.
  A held action reserves one slot; waiting for approval and resuming that exact
  action do not consume additional slots.
- Routes and credentials are frozen per control session. Managed calls pin the
  platform deployment fingerprint; a changed deployment requires a new session.
- One malformed model action can trigger at most one format re-prediction on the
  same image and model, before any input is dispatched. Both requests consume
  the model budget. No malformed JSON is repaired into an executable action.
- No automatic provider fallback, HTTP retry or replay of an uncertain native
  input. A changed target, expired observation or revoked grant fails closed.
- `model_finished` is not proof of success. Inspect the actual output; an input
  receipt can be completed while its business outcome remains unknown.
- Passwords, verification codes, payments and security changes require manual
  handling. Terminal and password-manager targets are refused.

## Verification and packaging

```sh
pnpm exec vitest run src/computer/__tests__ electron/computer/__tests__ src/endpoint-tools/__tests__
XOPC_COMPUTER_LIVE_TEST=1 pnpm exec vitest run src/computer/__tests__/model-live.test.ts
node --import tsx scripts/verify-managed-computer.mts
pnpm run electron:build
```

Live model tests generate synthetic pixels, never capture your desktop. The
native fixture source is `scripts/computer-fixture.swift`.

`build:node` cleans `dist`: always rebuild Node **before** the Electron server,
web resources and native helpers. Do not run it while relying on a package in
`dist/release`. The current local ARM64 directory package is signed but has not
been Apple-notarized or published as a public installer.

See [the implementation ledger](design/technical/computer-use-implementation-status.md)
for actual test evidence and remaining certification gaps, and
[the architecture RFC](design/technical/computer-use-architecture.md) for the
multi-platform, remote execution and quality-evaluation roadmap.
