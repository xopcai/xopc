# Get started with xopc

xopc gives you one locally operated AI assistant across desktop, terminal, browser, mobile, and messaging apps. To get a working first conversation, install one client, connect one model, and send a test message.

## Choose how to start

| If you prefer… | Start with |
| --- | --- |
| A normal desktop application | [Desktop app](./desktop-app.md) |
| A terminal | [Terminal quick start](./first-5-minutes.md) |
| A self-hosted container | [Docker](./docker.md) |

The desktop app is the simplest choice for most people. The terminal and Docker installations use the same configuration and can be added later.

## What you need

- A supported model account and its API key, or a local model server such as Ollama.
- Node.js 22 or newer only when installing the command-line package.
- Docker only when choosing the container installation.

You do not need to configure channels, tools, extra Agents, or remote access before the first chat.

## Your first successful setup

1. Install and open xopc using one of the options above.
2. Add one model provider. In the desktop or web console, follow the model setup screen. In a terminal, run `xopc onboard --quick`.
3. Open **Chat** or run `xopc`.
4. Send: `Reply with “xopc is ready” and tell me which model you are using.`

The setup is complete when the assistant replies without a credential or connection error.

If it does not, run `xopc doctor` and continue with [Troubleshooting](./how-to/diagnose-broken-setup.md).

## Learn the main parts as you need them

| Part | What it is for | Guide |
| --- | --- | --- |
| Session | A conversation you can return to from any connected client | [Chat and sessions](./session.md) |
| Agent | A named assistant with its own role, model choices, tools, and workspace | [Agents](./routing-system.md) |
| Project and Task | Long-running work with an explicit result, status, and next action | [Projects, Tasks, and Notes](./projects-tasks-notes.md) |
| Workflow | A reusable sequence for multi-step work | [Workflows](./workflows.md) |
| Automation | A schedule, webhook, or manual trigger that starts work | [Automations](./automations.md) |
| Channel | Telegram, Weixin, or Feishu access to the same assistant | [Channels](./channels/index.md) |

You can use xopc as a normal chat assistant without creating Projects, Workflows, or Automations. Add them only when work needs to continue or repeat.

## Recommended next steps

1. Read [Models and providers](./models.md) before adding a second model.
2. Review [Data and file locations](./workspace.md) so you know what is stored locally.
3. Configure [remote access](./remote-access.md) only if another device must reach the Gateway.
4. Connect a [channel](./channels/index.md) after local chat works.

## Where configuration lives

The default xopc state directory is `~/.xopc/`. The main configuration file is `~/.xopc/xopc.json`. Use these commands instead of finding the file manually:

```bash
xopc config path
xopc config validate
xopc config show
```

`config show` masks sensitive values. Never paste API keys, Gateway tokens, or bot tokens into an issue or screenshot.
