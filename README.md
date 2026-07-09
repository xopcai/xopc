<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center"><a href="https://xopc.ai">xopc</a></h1>

<p align="center">
  <strong>Turn goals into loops.</strong><br />
  Keep what matters moving.<br />
  Start with a chat. Keep a project alive. Capture notes from your phone. Let automations turn repeated follow-up into a private, local-first data flywheel.
</p>

<p align="center">
  <a href="https://xopc.ai"><img src="https://img.shields.io/badge/website-xopc.ai-0ea5e9?style=flat-square" alt="xopc.ai"></a>
  <a href="https://www.npmjs.com/package/@xopcai/xopc"><img src="https://img.shields.io/npm/v/@xopcai/xopc?label=npm&amp;color=teal" alt="npm version"></a>
  <img src="https://img.shields.io/badge/node.js-%E2%89%A522-339933?logo=nodedotjs&amp;logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License">
  <img src="https://img.shields.io/badge/LLM_providers-20%2B-5865F2" alt="LLM providers">
  <a href="https://github.com/xopcai/xopc/stargazers"><img src="https://img.shields.io/github/stars/xopcai/xopc?style=flat-square&amp;color=gold" alt="GitHub Stars"></a>
</p>

<p align="center">
  <a href="https://xopc.ai"><strong>xopc.ai</strong></a> ·
  <a href="https://github.com/xopcai/xopc"><strong>GitHub</strong></a> ·
  <a href="https://xopcai.github.io/xopc/">Documentation</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="https://github.com/xopcai/xopc/releases">Releases</a>
</p>

<p align="center">
  <img src="docs/public/xopc-tui.gif" alt="xopc terminal UI demo" width="720">
</p>

<details>
<summary><strong>Table of Contents</strong></summary>

- [Built for](#built-for)
- [From chat to loops](#from-chat-to-loops)
- [Get started](#get-started)
- [Why xopc](#why-xopc)
- [How xopc compares](#how-xopc-compares)
- [Where to chat](#where-to-chat)
- [Channels](#channels)
- [Extensions &amp; skills](#extensions--skills)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [FAQ](#faq)
- [Desktop app](#desktop-app)
- [Contributing](#contributing)

</details>

---

## Built for

- **People who start simple** — open a local chat first, then grow into projects, notes, channels, connectors, and automations when the work needs them.
- **Long-running goals, not one-shot chats** — carry goals, blockers, decisions, and next actions across sessions. Projects grow without starting over.
- **Your agent, reachable anywhere** — CLI, TUI, Web, Desktop, mobile, Telegram, WeChat, Feishu/Lark. Pair the mobile app by QR code; data stays in your runtime.
- **Local-first, your keys** — bring your own keys, mix cloud/local models, add skills/extensions, and keep everything under **`~/.xopc/`**.

## From chat to loops

You do not need a perfect system on day one. xopc is designed to become more useful as you keep using it.

| Stage | What you do | What xopc starts to do |
| --- | --- | --- |
| **Chat** | Ask questions, think through work, make decisions. | Gives you a local AI assistant that uses your model keys and local state. |
| **Project** | Ask it to keep track of one active goal. | Carries the goal, current state, blockers, and next actions across sessions. |
| **Notes & ideas** | Drop rough notes, progress updates, links, and feedback as they happen. | Turns scattered inputs into context the assistant can reuse. |
| **Connectors** | Pair the mobile app by QR code, or use the same assistant on desktop, terminal, messengers, and gateway APIs. | Lets you chat and capture notes from anywhere while the agent and data stay in your xopc runtime. |
| **Automations** | Schedule reviews, reminders, summaries, and workflow runs. | Keeps important work resurfacing and closes the loop without you starting every turn manually. |

**That is the loop:** context comes in, xopc helps decide the next move, you act, feedback comes back, and the system gets better at keeping the project moving.

**Your timeline:** Day 1 → chat and track a project. This week → feed it notes and progress. When it sticks → add mobile, messengers, desktop. As work repeats → add automations.

---

<a id="get-started"></a>
<a id="quick-start"></a>

## Get started

### Easiest start: PC desktop app

For most users, the **PC desktop app** is the easiest way to start: install the app, finish model setup in the UI, then chat in the built-in console. It starts the local gateway for you.

1. Download from **[GitHub Releases](https://github.com/xopcai/xopc/releases)** — macOS `.dmg`, Windows `.exe`, Linux `.AppImage` / `.deb`.
2. Open xopc and complete model setup.
3. Start chatting.

See **[PC Desktop app](https://xopcai.github.io/xopc/desktop-app)** for install notes, build-from-source commands, and reserved screenshot/GIF/video file locations.

### One-liner (30-second start — recommended)

**Linux, macOS, WSL2, Termux**

```bash
curl -fsSL https://xopc.ai/install.sh | bash
```

**Windows (native, PowerShell)**

> **Heads up:** Native Windows runs xopc without WSL — CLI, gateway, TUI, and tools all work natively. Prefer WSL2? Use the bash one-liner above there too.

```powershell
iex (irm https://xopc.ai/install.ps1)
```

The installer detects your OS, installs **Node.js ≥ 22** when needed, and installs **`@xopcai/xopc`**. China mirror: add `--cn` (bash) or `-Cn` (PowerShell), or pass `--registry https://registry.npmmirror.com`.

Then chat immediately:

```bash
xopc onboard --quick
xopc                    # opens the local TUI
```

### npm (already have Node.js 22+)

```bash
npm install -g @xopcai/xopc
```

Or with pnpm: `pnpm add -g @xopcai/xopc` · China mirror: `npm install -g @xopcai/xopc --registry=https://registry.npmmirror.com`

### More commands

```bash
xopc agent -i                               # interactive CLI
xopc agent -m "Summarize the last 5 commits"  # one-shot
xopc gateway                                # web server + React console
xopc gateway service install                # OS service
```

**From source** (installer or pnpm workspace):

```bash
# installer — clone, build, and add ~/.local/bin/xopc wrapper
curl -fsSL https://xopc.ai/install.sh | bash -s -- --install-method git

# or manual checkout
git clone https://github.com/xopcai/xopc.git && cd xopc
corepack enable && pnpm install && pnpm run build
pnpm exec xopc onboard
```

Windows git install: `& ([scriptblock]::Create((irm https://xopc.ai/install.ps1))) -InstallMethod git`

**Requirements:** Node.js **≥ 22** (the one-liner handles this). Use **pnpm** when hacking from a git clone. More install options on **[xopc.ai](https://xopc.ai)** and **[Getting started](https://xopcai.github.io/xopc/getting-started)**.

---

## Why xopc

- 🔁 **From chat to durable loops** — Projects, notes, connectors, and automations compound into momentum across sessions.
- 🏠 **Your machine** — Data and config under **`~/.xopc/`**. No mandatory cloud or surprise bills.
- 🔑 **Bring your own keys** — OpenAI, Anthropic, Google, DeepSeek, Ollama, LM Studio, vLLM, and **20+** providers. Mix cloud and local models.
- 📱 **Reachable anywhere** — Pair the [mobile app](./apps/mobile-expo) by QR code, or chat from desktop, terminal, browser, Telegram, WeChat, and Feishu/Lark. Data stays in your runtime.
- 🧩 **Grows with you** — **`xopc skills install`** / **`xopc extensions install`** for tools, channels, and UI panels; multi-agent routing per context.
- ⏰ **Proactive** — Automations for scheduled summaries, reminders, and workflow runs; subagent fan-out for parallel tasks.

## How xopc compares

xopc is not another chat UI. It is the local-first system layer for people who want one assistant to remember goals, keep state, run automations, and stay reachable across surfaces.

| Product | Best at | Why use xopc too |
| --- | --- | --- |
| **Codex** | Software development in terminal, IDE, and cloud tasks | xopc is broader than repo work: long-running goals, BYOK/local models, scheduled loops, gateway APIs, desktop/web/mobile, and messengers share one local state. |
| **Claude Code** | Project-level coding: codebase navigation, edits, tests, git workflows | xopc is a personal Agent OS for coding plus life/work loops; it can coordinate models, channels, skills, workflows, and automations outside one codebase. |
| **Qoder / QoderWork** | Agentic coding platform plus local-first office work companion | xopc is open-source and hackable, with explicit local state under **`~/.xopc/`**, configurable providers, self-hosted gateway, and extension points. |
| **WorkBuddy** | Office deliverables such as reports, decks, spreadsheets, research, and data analysis | xopc is for users who want to own the runtime: bring your own keys, mix local/cloud models, wire channels, and keep long-term project context locally. |

Choose xopc when you want a **self-hosted, long-term AI assistant** that is not locked to one vendor, one IDE, one chat surface, or one task type. See the full comparison in **[Comparison](https://xopcai.github.io/xopc/comparison)**.

---

## Where to chat

| Surface | How | Best for |
| --- | --- | --- |
| **PC Desktop** | [GitHub Releases](#desktop-app) | Easiest start: native app + embedded gateway console |
| **TUI** | `xopc` or `xopc tui` (remote: `xopc tui --url …`) | Full keyboard, streaming, fastest terminal path |
| **CLI** | `xopc agent -i` / `xopc agent -m "…"` | Scripts and minimal TTY |
| **Web** | `xopc gateway` → open console URL | Chat, settings, logs in the browser |
| **Mobile** | [mobile app](./apps/mobile-expo) + QR gateway pairing ([mobile app](https://xopcai.github.io/xopc/mobile-app), [remote access](https://xopcai.github.io/xopc/remote-access)) | Chat, record notes, and capture ideas from iOS/Android while the agent keeps running on your computer |
| **Messengers** | `channels.*` + gateway | Telegram, WeChat, Feishu/Lark |

---

## Channels

Configure under **`channels.*`** in **`~/.xopc/xopc.json`**. IM bots need a running gateway; WeChat login runs on the gateway host.

| Channel | Config | Notes |
| --- | --- | --- |
| **Telegram** | `channels.telegram` | Multi-account, streaming, policies |
| **WeChat** | `channels.weixin` | QR login on gateway host |
| **Feishu / Lark** | `channels.feishu` | Bot / webhook per docs |

Full reference: **[Channels](https://xopcai.github.io/xopc/channels)** · **[Configuration](https://xopcai.github.io/xopc/configuration)**.

---

## Extensions & skills

```bash
xopc skills install <name>       # SKILL.md domains
xopc extensions install <pkg>    # tools, channels, UI panels
xopc extensions dev ./my-extension
```

Guides: **[Extensions](https://xopcai.github.io/xopc/extensions)** · **[Skills](https://xopcai.github.io/xopc/skills)**. Gateway UI extensions: **`@xopcai/xopc/extension-ui-sdk`** (`packages/extension-ui-sdk/`).

---

## Configuration

Default: **`~/.xopc/xopc.json`**. A minimal skeleton:

```json
{
  "providers": { "deepseek": "${DEEPSEEK_API_KEY}" },
  "agents": { "default": "main", "list": [{ "id": "main", "models": { "roles": { "deep": { "model": "deepseek/deepseek-v4-flash" } } } }] }
}
```

Full reference: **[Configuration](https://xopcai.github.io/xopc/configuration)**. Add **`channels.*`** for IM, or browser tools (Playwright Chromium) when needed.

---

## Documentation

| Guide | Description |
| --- | --- |
| [Getting started](https://xopcai.github.io/xopc/getting-started) | Install, onboard, first chat |
| [From Chat to Loops](https://xopcai.github.io/xopc/concepts/loops) | How xopc grows from simple chat into project context, connectors, and automations |
| [Configuration](https://xopcai.github.io/xopc/configuration) | `xopc.json` reference |
| [CLI](https://xopcai.github.io/xopc/cli) | Commands and flags |
| [Channels](https://xopcai.github.io/xopc/channels) | Telegram, WeChat, Feishu |
| [Architecture](https://xopcai.github.io/xopc/architecture) | How pieces fit together |
| [Workflows](https://xopcai.github.io/xopc/workflows) | Fan-out subagents, board UI, scripts |

Also: [Tools](https://xopcai.github.io/xopc/tools) · [Mobile app](https://xopcai.github.io/xopc/mobile-app) · [Voice](https://xopcai.github.io/xopc/voice) · [Remote access](https://xopcai.github.io/xopc/remote-access)

---

## FAQ

**Is xopc a hosted service?** — No. Everything runs on your machine under **`~/.xopc/`**.

**Do I need a paid cloud model?** — No. Bring your own keys, or use local models (Ollama, LM Studio, vLLM).

**What is the fastest way to try it?** — [Desktop app](#get-started) for GUI users, or `xopc onboard --quick && xopc` for terminal.

**How is this different from another chat UI?** — xopc grows from chat into goal loops: project context, notes, connectors, and automations across multiple surfaces.

**Can I use it from my phone or messengers?** — Yes. Pair the [mobile app](./apps/mobile-expo) by QR code, or configure Telegram, WeChat, or Feishu/Lark via the gateway.

**Have a question?** — Ask on [GitHub Discussions](https://github.com/xopcai/xopc/discussions/categories/q-a).

---
<a id="desktop-app"></a>

## Security

Treat inbound IM messages as **untrusted**. Prefer **pairing** or **allowlist** for DMs. Keep gateway bind addresses and tokens private. See **[Security](https://xopcai.github.io/xopc/channels)** for details.

---

## Contributing

```bash
pnpm install && pnpm run dev    # CLI via tsx
pnpm run dev:gateway            # dev gateway uses ~/.xopc-dev + info logs
pnpm run build && pnpm test && pnpm run lint
```

**[AGENTS.md](./AGENTS.md)** · **[CONTRIBUTING.md](./CONTRIBUTING.md)**

**Issues:** [Bug report](https://github.com/xopcai/xopc/issues/new?template=bug_report.yml) · [Feature request](https://github.com/xopcai/xopc/issues/new?template=feature_request.yml) · [Q&A Discussions](https://github.com/xopcai/xopc/discussions/categories/q-a) · [Security advisory](https://github.com/xopcai/xopc/security/advisories/new) (not public issues)

**Tech stack:** TypeScript, Node.js ≥ 22, pnpm workspace. Built-in LLM layer via `@earendil-works/pi-ai`, React gateway console, Electron desktop.

## Credits

- LLM layer: [@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono) · Agent runtime: [@earendil-works/pi-agent-core](https://github.com/earendil-works/pi-mono)
- Inspired by [openclaw/openclaw](https://github.com/openclaw/openclaw) and [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

---

<p align="center"><sub>Made with care by <a href="https://github.com/xopcai">xopcai</a> · <a href="https://xopc.ai">xopc.ai</a></sub></p>
