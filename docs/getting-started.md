# Getting Started

Use this page as the full map: what runs, setup modes, surfaces, and where to go next.

If you have not tried xopc yet, start with the **[PC Desktop app](./desktop-app.md)** for the friendliest path, or **[First 5 Minutes](./first-5-minutes.md)** for a terminal-first path — both cover the actual install commands step by step.

## What xopc runs

xopc is one package with several surfaces:

| Surface | Entry point | Requires gateway |
| --- | --- | --- |
| CLI one-shot | `xopc agent -m "..."` | No |
| Interactive CLI | `xopc agent -i` | No |
| Local TUI | `xopc` or `xopc tui` | No |
| PC Desktop app | GitHub Releases | Bundled gateway |
| Gateway console | `xopc gateway`, then open the printed URL | Yes |
| Gateway TUI | `xopc tui --gateway` or `xopc tui --url ...` | Yes |
| Channels | Telegram, Weixin, Feishu/Lark configs under `channels.*` | Yes |

## Requirements

- Node.js **22** or newer for the CLI package.
- At least one model provider key, local model server, or configured OpenAI-compatible endpoint.
- `pnpm` only when building from this repository.

## Setup modes

| Goal | Command | Notes |
| --- | --- | --- |
| Fast local trial | `xopc onboard --quick` | Model credentials only; skips gateway and channels |
| Guided first run | Web console onboarding or `xopc onboard` | Model first, optional personal profile, then chat |
| Create base files | `xopc setup` | Creates config/workspace skeleton only |
| Configure a model later | `xopc providers set-key <provider>` and `xopc models set <provider>/<model>` | See [Configure your first model](./how-to/configure-first-model.md) |

Configuration is stored in `~/.xopc/xopc.json` by default. Override it with `XOPC_CONFIG` or `XOPC_CONFIG_PATH`.

## Choose the next surface

| Need | Start here |
| --- | --- |
| Easiest first run | [PC Desktop app](./desktop-app.md) |
| Fastest terminal first run | [First 5 Minutes](./first-5-minutes.md) |
| Browser chat, settings, logs | [Gateway](./gateway.md) |
| Telegram bot | [Connect Telegram](./how-to/connect-telegram.md) |
| Mobile access | [Mobile app](./mobile-app.md) and [Remote access](./remote-access.md) |
| Another dedicated agent | [Create a second agent](./how-to/create-second-agent.md) |
| Gateway on another device | [Expose the gateway safely](./how-to/expose-gateway-safely.md) |
| Broken setup | [Diagnose setup issues](./how-to/diagnose-broken-setup.md) |

## Core paths

| Topic | Page |
| --- | --- |
| CLI commands | [CLI](./cli.md) |
| TUI behavior | [Terminal UI](./tui.md) |
| Configuration fields | [Configuration](./configuration.md) and [Configuration reference](./reference/configuration.md) |
| Models and providers | [Models](./models.md) |
| Channels | [Channels](./channels/index.md) |
| Tools | [Tools](./tools.md) |
| Skills | [Skills](./skills.md) |
| Extensions | [Extensions](./extensions.md) |
| Session routing | [Routing system](./routing-system.md) |

## Development from source

```bash
git clone https://github.com/xopcai/xopc.git
cd xopc
pnpm install
pnpm run dev -- --help
pnpm run dev:init        # optional: create isolated ~/.xopc-dev state
pnpm run dev:gateway     # gateway from source using ~/.xopc-dev and info logs
pnpm run build
```

Use `pnpm run dev:gateway -- --port 18791` (or another option after `--`) if your normal gateway is already using the default port.

Common checks:

```bash
pnpm test
pnpm run typecheck
pnpm run docs:build
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Config does not load | `xopc config validate` |
| Model calls fail | `xopc models status` and provider credentials |
| Gateway does not respond | `xopc gateway status` and `xopc gateway health` |
| Channel does not reply | `xopc channels show <channel>` and gateway logs |
| Unknown local failure | `xopc doctor`, then `xopc logs tail` |
