# Desktop app

The desktop app is the easiest way to run xopc locally. It includes the Gateway console, starts the local service when needed, and lets you manage models, Agents, channels, logs, and updates without keeping a terminal open.

![xopc desktop app demo](/xopc-desktop.gif)

## Install

1. Open [GitHub Releases](https://github.com/xopcai/xopc/releases).
2. Download the newest package for your computer.
3. Install and launch **xopc**.

| Platform | Package |
| --- | --- |
| macOS | `.dmg` |
| Windows | `.exe` matching your x64 or ARM64 system |
| Linux | `.AppImage` or `.deb` |

On macOS, move xopc to **Applications**. On Windows, run the installer. On Linux, install the `.deb` or allow the `.AppImage` to run.

## First run

<!-- Screenshot placeholder: /screenshots/desktop-first-run.png -->

1. Wait for the local Gateway to become ready.
2. Follow the model setup screen and connect one provider.
3. Open **Chat** and keep the default Agent selected.
4. Send: `Reply with “xopc is ready” and tell me which model you are using.`

<!-- Screenshot placeholder: /screenshots/first-chat.png -->

Once that reply succeeds, the core setup is complete. Add channels, remote access, browser automation, or more Agents one at a time.

For provider choices and credential methods, see [Configure a model](./how-to/configure-first-model.md).

## Find common features

| You want to… | Open |
| --- | --- |
| Start or resume a conversation | **Chat** |
| Create and edit assistants | **Agents** |
| Organize ongoing work | **Projects** or **Tasks** |
| Connect Telegram, Weixin, or Feishu | **Channels** |
| Create repeated work | **Workflows** or **Automations** |
| Inspect a problem | **Settings → Logs** |
| Pair another device | **Settings → Remote access** |
| Check for updates | **Settings → Gateway** |

The desktop app and terminal commands use the same xopc data by default, so you can start in the app and later run `xopc`, `xopc agent`, or `xopc gateway` without creating a separate setup.

## Data and privacy

xopc stores its configuration, local database, Agents, and workspaces under `~/.xopc/` by default. Model requests still go to the provider you choose unless you use a local model.

Read [Data and file locations](./workspace.md) for backup and path details. Do not include keys, tokens, private chats, or personal paths in screenshots.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| The Gateway does not start | Close other xopc windows, relaunch, and check whether the configured port is already in use |
| Model setup fails | Re-enter the credential, check the selected model, then follow [Configure a model](./how-to/configure-first-model.md) |
| The window opens but content stays blank | Restart the app; on Windows, install current graphics drivers |
| A channel or phone cannot connect | Confirm local chat works, then review [Channels](./channels/index.md) or [Remote access](./remote-access.md) |

If the problem remains, run `xopc doctor` in a terminal and follow [Troubleshooting](./how-to/diagnose-broken-setup.md).
