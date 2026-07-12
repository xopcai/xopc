# PC Desktop App

The PC desktop app is the easiest first path for most users. It starts a local xopc gateway for you, opens the gateway console in a native window, and lets you configure models, agents, memory, channels, logs, and updates without keeping a terminal open.

Use this page when you want to install and use xopc as a desktop application. Use [First 5 Minutes](./first-5-minutes.md) when you prefer a terminal-first setup.

## Quick Path

1. Open [GitHub Releases](https://github.com/xopcai/xopc/releases).
2. Download the package for your platform.
3. Install and launch **xopc**.
4. Complete model setup in the app.
5. Open **Chat** and send a short test message.

| Platform | Package |
| --- | --- |
| macOS | `.dmg` |
| Windows | `xopc-<version>-x64.exe` or `xopc-<version>-arm64.exe` |
| Linux | `.AppImage` or `.deb` |

::: tip
Start with one working model provider before enabling channels, browser tools, mobile pairing, or extra agents. That keeps the first failure mode small and easy to diagnose.
:::

## What You Get

- **No terminal loop after install** - open the app, finish model setup, and start chatting.
- **Shared local gateway** - the app connects to the configured local gateway when it is already running, otherwise it starts the same gateway against `~/.xopc`.
- **Visible settings** - manage models, agents, channels, memory, logs, and updates in the console UI.
- **Local-first state** - config, sessions, agents, credentials, and workspaces are stored under `~/.xopc`, not in a hosted xopc cloud.
- **Same product surface** - the desktop window loads the same gateway console used by `xopc gateway`.

## First Run

### 1. Install the App

Download the latest release for your operating system and install it using the normal platform flow.

- On macOS, open the `.dmg` and move xopc to Applications.
- On Windows, run the `.exe` installer.
- On Linux, run the `.AppImage` directly or install the `.deb`.

### 2. Open xopc

Launch xopc from your applications menu. The app starts a local gateway in the background and then loads the console.

If the app shows a gateway startup error, close any old xopc desktop windows and relaunch. If it still fails, see [Troubleshooting](#troubleshooting).

### 3. Configure a Model

Open the model or credentials setup screen and add one provider. For the recommended default path, use DeepSeek with `deepseek/deepseek-v4-flash`.

You can configure credentials in the UI using supported provider auth modes:

| Auth mode | Use when |
| --- | --- |
| OAuth | The provider supports browser-based sign-in from the console |
| API key | You want to paste and save a provider key in the app |
| Environment variable | You already launch xopc with keys such as `DEEPSEEK_API_KEY` |

See [Models](./models.md) and [Configure your first model](./how-to/configure-first-model.md) for provider details.

### 4. Send the First Message

Open **Chat**, keep the default agent selected, and send a small prompt such as:

```text
Summarize what xopc can help me do in three bullets.
```

After that works, move on to agents, memory, channels, mobile pairing, or workflow setup.

## Daily Use

| Task | Where to go |
| --- | --- |
| Start a conversation | **Chat** |
| Switch or edit agents | **Agents** |
| Review remembered context | **Memory** |
| Change model credentials | **Settings -> Credentials** or the model setup panel |
| Check runtime problems | **Settings -> Logs** |
| Connect Telegram, WeChat, or Feishu/Lark | **Channels** |
| Pair the mobile app | **Settings -> Remote access** |
| Configure the desktop pet | **Settings -> Pet** |
| Update xopc | **Settings -> Gateway / Update** or the release installer |

The desktop app is meant to be the primary local control surface. You can still use `xopc` for the TUI, `xopc agent -m` for scripts, and `xopc gateway` when you explicitly want a browser-hosted console.

Desktop pet customization is documented in [Desktop Pets](./desktop-pets.md).

## Desktop Gateway and CLI Gateway

The desktop app, `xopc gateway`, and `xopc tui` use the same xopc home by default: `~/.xopc`.

| Surface | Default behavior |
| --- | --- |
| Desktop app | Reuses the configured gateway on `gateway.port`, or starts it if the port is free |
| `xopc gateway` | Starts the same gateway against `~/.xopc/xopc.json` |
| `xopc` / `xopc tui` | Uses the same config, database, agents, and workspace defaults |

If the configured gateway port is already occupied by a process that does not accept the token from `~/.xopc/xopc.json`, the desktop app fails instead of choosing another port. Stop the other process or change `gateway.port`.

## Data and Configuration

The desktop app uses the same xopc state directory as the CLI. Internally it writes and reads:

- `~/.xopc/xopc.json` - shared xopc config
- `~/.xopc/xopc.db` - shared sessions and runtime state
- `~/.xopc/agents/` - shared agent profile and runtime data
- `~/.xopc/workspace/main/` - default workspace created on first desktop launch when needed

Electron-specific shell data, such as window preferences, crash logs, updater metadata, and tray/system integration state, remains in the operating system's Electron app data directory. The app also sets runtime environment variables for the embedded gateway, including `XOPC_CONFIG_PATH`, `XOPC_WORKSPACE`, and `XOPC_STATE_DIR`.

## Build From Source

Use this only when you are developing xopc or when a release package is not available for your platform.

```bash
pnpm install
pnpm run electron:build
```

Artifacts are written to `dist/release/`.

For development:

```bash
pnpm run build
pnpm run electron:dev
```

## Media Placeholders

Put desktop app screenshots, GIFs, and videos under `docs/public/desktop/`. The docs intentionally do not embed missing files yet, so pages will not show broken images before assets are captured.

| Asset | Put file here | Use |
| --- | --- | --- |
| First launch screenshot | `docs/public/desktop/desktop-first-launch.png` | First window after opening the app |
| Model setup screenshot | `docs/public/desktop/desktop-model-setup.png` | Provider/API key or OAuth setup |
| Chat ready screenshot | `docs/public/desktop/desktop-chat-ready.png` | Successful first chat |
| Agents page screenshot | `docs/public/desktop/desktop-agents.png` | Agent switch/edit entry point |
| Memory page screenshot | `docs/public/desktop/desktop-memory.png` | Memory and recall review entry point |
| Settings screenshot | `docs/public/desktop/desktop-settings.png` | Credentials, gateway, logs, and system settings |
| Quick-start GIF | `docs/public/desktop/desktop-quick-start.gif` | Install/open/setup/chat flow |
| Overview video | `docs/public/desktop/desktop-overview.mp4` | Optional docs or release-page video |

After adding files, embed them with paths such as:

```md
![Desktop first launch](/desktop/desktop-first-launch.png)
```

## Troubleshooting

- **Gateway startup error** - check whether `gateway.port` in `~/.xopc/xopc.json` is occupied by a non-xopc process or by a gateway using a different token.
- **Port conflict** - stop the other process or change `gateway.port`; the desktop app will not silently choose another port.
- **Model setup fails** - verify the provider key or OAuth session, then check [Models](./models.md).
- **App opens but the console stays blank** - restart the app. On locked-down Windows machines, update GPU drivers and try again.
- **Channels or mobile pairing do not work** - confirm the shared local gateway is the one exposed to the phone or messenger integration.
