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

## 4. Try a goal-loop prompt

Paste this:

```text
Help me keep my side project moving this week. Track the goal, next actions, blockers, and feedback after each step.
```

What to look for:

- xopc should treat the work as a continuing goal, not just a one-shot answer.
- Your local state and config live under `~/.xopc/` by default.
- You can continue from terminal now and add Web/mobile/messenger surfaces later.

## 5. Add surfaces later

When the local path works, choose the next surface:

| Surface | Command | Use it for |
| --- | --- | --- |
| PC Desktop | GitHub Releases | Easiest start; native app with embedded gateway |
| CLI | `xopc agent -i` | Minimal terminal chat |
| Web console | `xopc gateway` | Browser chat, settings, logs |
| Mobile | [mobile app](https://github.com/xopcai/xopc/tree/main/apps/mobile-expo) + gateway pairing | iOS/Android client for your gateway; see [Mobile app](./mobile-app.md) |
| Messengers | Open `Channels` after the gateway is running | Telegram, WeChat, Feishu/Lark |

For the full guide, continue to [Getting Started](./getting-started.md).
