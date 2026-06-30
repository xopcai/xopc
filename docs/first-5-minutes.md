# First 5 Minutes

This page is the shortest path from “I saw xopc on GitHub” to a working local chat.

Use this path when you want to understand the product shape before setting up the Web console, desktop app, mobile app, or messengers.

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

`--quick` is the short guided path: choose a model/provider, save credentials, and skip gateway/channel setup for now.

You can use cloud providers with your own keys, or local/model-server options such as Ollama, LM Studio, and vLLM when configured.

## 3. Start the local TUI

```bash
xopc tui --local
```

This starts the embedded terminal UI. It does not require a gateway process.

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
| CLI | `xopc agent -i` | Minimal terminal chat |
| Web console | `xopc gateway` | Browser chat, settings, logs |
| Desktop | GitHub Releases or `pnpm run electron:build` | Native app |
| Mobile | [xopc-app](https://github.com/xopcai/xopc-app) + gateway pairing | iOS/Android client for your gateway; see [Mobile app](./mobile-app.md) |
| Messengers | `xopc onboard` then configure channels | Telegram, WeChat, Feishu/Lark |

## If it helped

Please star the repo so more developers can find xopc:

https://github.com/xopcai/xopc

For the full guide, continue to [Getting Started](./getting-started.md).
