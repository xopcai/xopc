# Get started with xopc

Give xopc something that matters. Start with the desktop app, connect one model, and let it help you find the next credible step.

## Choose how to start

| If you prefer… | Start with |
| --- | --- |
| A normal desktop application | [Download from xopc.ai](https://xopc.ai/en#download) |
| A terminal | [Terminal quick start](./first-5-minutes.md) |
| A self-hosted container | [Docker](./docker.md) |

The desktop app is the simplest choice for most people. See the [desktop guide](./desktop-app.md) for installation details. Terminal and Docker use the same configuration and can be added later.

## What you need

- A supported model account and its API key, or a local model server such as Ollama.
- Node.js 22 or newer only when installing the command-line package.
- Docker only when choosing the container installation.

You do not need to configure channels, tools, extra Agents, or remote access before the first chat.

## Your first successful setup

1. [Download](https://xopc.ai/en#download), install, and open xopc using one of the options above.
2. Add one model provider. In the desktop or web console, follow the model setup screen. In a terminal, run `xopc onboard --quick`.
3. Open **Chat** or run `xopc`.
4. Send: `Reply with “xopc is ready” and tell me which model you are using.`

The setup is complete when the assistant replies without a credential or connection error.

If it does not, run `xopc doctor` and continue with [Troubleshooting](./how-to/diagnose-broken-setup.md).

## Give it something real

Once the connection works, skip the feature tour and give xopc one meaningful direction:

```text
One thing I want to move forward this week is ____.
Help me clarify the outcome and choose the smallest credible next step.
Do not remember anything long-term unless I can review it.
```

When user understanding is enabled, proposed understanding can be reviewed in **You** or **User context**. Confirm only what is accurate and useful; correct, reject, or delete the rest. See [User understanding](./user-understanding.md).

Some desktop releases also offer experimental **Connect recent work** onboarding. It analyzes only folders you select, within a bounded read-only scope, and shows evidence-backed next steps. On macOS it may separately request access to Apple Notes, Calendar, and Reminders. Skip it if you prefer to begin with conversation.

## Learn the main parts as you need them

| Part | What it is for | Guide |
| --- | --- | --- |
| User understanding | Reviewable goals, preferences, relationships, focus, and collaboration rules | [User understanding](./user-understanding.md) |
| Session | A conversation you can return to from any connected client | [Chat and sessions](./session.md) |
| Agent | A named assistant with its own role, model choices, tools, and workspace | [Agents](./routing-system.md) |
| Project and Task | Long-running work with an explicit result, status, and next action | [Projects, Tasks, and Notes](./projects-tasks-notes.md) |
| Workflow | A reusable sequence for multi-step work | [Workflows](./workflows.md) |
| Automation | A schedule, webhook, or manual trigger that starts work | [Automations](./automations.md) |
| Channel | Telegram, Weixin, or Feishu access to the same assistant | [Channels](./channels/index.md) |

You can use xopc as a normal chat assistant without creating Projects, Workflows, or Automations. Add them only when work needs to continue or repeat.

## Recommended next steps

1. Read [Product philosophy](./product.md) to understand the intended trust and initiative model.
2. Review [Data and file locations](./workspace.md) so you know what is stored locally.
3. Read [Models and providers](./models.md) before adding a second model, especially if personal context may be sent to a cloud provider.
4. Configure [remote access](./remote-access.md) only if another device must reach the Gateway.
5. Connect a [channel](./channels/index.md) after local chat works.

## Where configuration lives

The default xopc state directory is `~/.xopc/`. The main configuration file is `~/.xopc/xopc.json`. Use these commands instead of finding the file manually:

```bash
xopc config path
xopc config validate
xopc config show
```

`config show` masks sensitive values. Never paste API keys, Gateway tokens, or bot tokens into an issue or screenshot.
