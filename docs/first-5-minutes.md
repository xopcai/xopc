# First 5 Minutes

This page is the shortest terminal path from “I saw xopc on GitHub” to a working local chat.

For most users, the [PC Desktop app](./desktop-app.md) is the easiest way to start: install the app, complete model setup in the UI, and chat in the built-in console. Use this page when you prefer a terminal-first flow or when a desktop release is not available for your platform.

## 1. Install

macOS, Linux, WSL2, Termux:

```bash
curl -fsSL https://xopc.ai/install.sh | bash
```

If you already have Node.js 22+:

```bash
npm install -g @xopcai/xopc
```

Windows PowerShell:

```powershell
iex (irm https://xopc.ai/install.ps1)
```

## 2. Configure the model only

```bash
xopc onboard --quick
```

`--quick` is the short guided path: choose a model/provider and save credentials. Gateway, channels, skills, and extra agents can wait.

You can use cloud providers with your own keys, or local/model-server options such as Ollama, LM Studio, and vLLM when configured.

## 3. Start the local TUI

```bash
xopc
```

This starts the embedded terminal UI. It is the same as `xopc tui` and does not require a gateway process.

You should see a full-screen terminal chat. If it exits immediately, run `xopc doctor` and check the model status with `xopc models status`.

## 4. Complete one resumable task

xopc does not need a complex setup before it is useful. Start with one real task in the current Session and leave a clear state to resume.

Paste this:

```text
I am moving this project forward: <one-line description>. First clarify the goal and success criteria, then complete whatever can be acted on now. Before finishing, summarize completed work, open questions, and the next action.
```

What to look for:

- The current Session retains its conversation and tool-run context; local state and config live under `~/.xopc/` by default.
- If this is a temporary task, that may be all you need.
- If the work must continue across sessions, let xopc create an Task; add a Project only when several tasks need shared context.
- Add Notes / Workspace, a Workflow, or an Automation only when you need durable material or repeated execution.

## 5. Add only the components you need

Once the local chat works, grow only where the habit is useful:

| Next step | Add this when | Where to go |
| --- | --- | --- |
| Keep one result moving | Status and next actions must survive across sessions | Use Home and Tasks in the gateway console |
| Capture material anywhere | Ideas and updates happen away from the terminal | Use Notes on Web / mobile for text, voice, and attachments |
| Bring in outside signals | Work already lives in another surface or system | Use channels, gateway APIs, extensions, or MCP |
| Automate follow-up | Reviews, summaries, or reminders repeat | Use [Automations](./automations.md) and [Workflows](./workflows.md) |

Common surfaces:

| Surface | Command | Use it for |
| --- | --- | --- |
| PC Desktop | GitHub Releases | Easiest start; native app with embedded gateway |
| CLI | `xopc agent -i` | Minimal terminal chat |
| Web console | `xopc gateway` | Browser chat, settings, logs |
| Mobile | [mobile app](https://github.com/xopcai/xopc/tree/main/apps/mobile-expo) + QR gateway pairing | Capture notes, ideas, and project updates away from your computer while the agent keeps running on your machine; see [Mobile app](./mobile-app.md) |
| Messengers | Open `Channels` after the gateway is running | Telegram, WeChat, Feishu/Lark |

For the full guide, continue to [Getting Started](./getting-started.md). To understand how Conversations, Tasks, Projects, Workflows, and Automations work together, read [The Task Loop](./concepts/loops.md).
