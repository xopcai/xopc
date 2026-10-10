# Computer Use preview

Use the macOS desktop app to ask xopc to read or operate one application window. This preview requires a compatible GUI model and native permissions. Start with a small, supervised task.

## Set up

1. Install a signed macOS desktop build that includes Computer Use.
2. Open **Settings → Integrations → Computer use** (`#/settings/computer-use`). Enable computer control and grant macOS Accessibility and Screen Recording permissions to xopc.
3. Allow the applications you intend to use. Start with individual applications rather than unrestricted app access.
4. Choose a compatible GUI model from the connected catalog and save it. For your own key, connect the appropriate provider first; for XOPC Cloud, sign in, refresh the catalog, and select `xopc-cloud/computer` (XOPC Cloud Computer / XOPC 云端电脑操作). Ordinary chat selection does not configure this capability.
5. In desktop Chat, ask: `Read the current page in Feishu; do not click.` If the app needs to be opened, explicitly ask: `Open Feishu and read the current page.`

Verify that the answer matches the intended application and window before authorizing changes. If several windows or processes match, select the intended one rather than guessing.

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

A model saying it finished is not proof that a save or remote transaction succeeded. Review the actual output. Stop computer control before switching to another browser or application tool.

For website-only work, see [Browser automations](./browser-automations.md). For provider connection, see [Models and providers](./models.md).
