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

---

## Built for

- **People who start simple** — open a local chat first, then grow into projects, notes, channels, connectors, and automations when the work needs them.
- **Long-running projects** — keep goals, decisions, blockers, next actions, feedback, and recalibration connected across chats.
- **Private agents you can reach anywhere** — run xopc on your computer, pair the mobile app by QR code, and keep chatting or capturing notes while your data stays in your own runtime.
- **One-person companies and solo builders** — use the same assistant from CLI, TUI, Web, Desktop, mobile, Telegram, WeChat, and Feishu/Lark.
- **Local-first AI workflows** — bring your own keys, mix cloud/local models, add skills/extensions, and keep data under **`~/.xopc/`**.

## From chat to loops

You do not need a perfect system on day one. xopc is designed to become more useful as you keep using it.

| Stage | What you do | What xopc starts to do |
| --- | --- | --- |
| **Chat** | Ask questions, think through work, make decisions. | Gives you a local AI assistant that uses your model keys and local state. |
| **Project** | Ask it to keep track of one active goal. | Carries the goal, current state, blockers, and next actions across sessions. |
| **Notes & ideas** | Drop rough notes, progress updates, links, and feedback as they happen. | Turns scattered inputs into context the assistant can reuse. |
| **Connectors** | Pair the mobile app by QR code, or bring the same assistant to desktop, terminal, messengers, and gateway APIs. | Lets you chat and capture notes from anywhere while the agent and data stay in your xopc runtime. |
| **Automations** | Schedule reviews, reminders, summaries, and workflow runs. | Keeps important work resurfacing and closes the loop without you starting every turn manually. |

That is the loop: context comes in, xopc helps decide the next move, you act, feedback comes back, and the system gets better at keeping the project moving.

## What you can do after install

- **Day 1:** chat locally, configure one model, and ask xopc to track a real project.
- **This week:** feed it notes, blockers, decisions, links, and progress updates.
- **When it sticks:** add the surfaces you actually use: desktop, terminal, browser, mobile QR pairing, Telegram, WeChat, or Feishu/Lark.
- **As work repeats:** add automations for reviews, reminders, summaries, and workflow runs.

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

### Fastest terminal path

```bash
curl -fsSL https://xopc.ai/install.sh | bash
xopc onboard --quick
xopc
```

This path starts the embedded terminal UI: no gateway, desktop app, or messenger setup required.

### One-liner (recommended)

**Linux, macOS, WSL2, Termux**

```bash
curl -fsSL https://xopc.ai/install.sh | bash
```

**Windows (native, PowerShell)**

> **Heads up:** Native Windows runs xopc without WSL — CLI, gateway, TUI, and tools all work natively. Prefer WSL2? Use the bash one-liner above there too.

Run this in PowerShell:

```powershell
iex (irm https://xopc.ai/install.ps1)
```

The installer detects your OS, installs **Node.js ≥ 22** when needed, and installs **`@xopcai/xopc`**. China mirror: add `--cn` (bash) or `-Cn` (PowerShell), or pass `--registry https://registry.npmmirror.com`.

> **30-second start:** this is the homepage-recommended path, including Node setup on macOS, Linux, and Windows.

### Onboard & chat

```bash
xopc onboard          # faster: xopc onboard --quick
xopc                  # same as xopc tui; opens the local TUI
```

> **New here?** Use the **PC desktop app** for the easiest setup, or run **`xopc`** for the fastest terminal path. Run **`xopc gateway`** when you want the browser console or messengers without the desktop shell.

### npm (already have Node.js 22+)

```bash
npm install -g @xopcai/xopc
```

Or with pnpm: `pnpm add -g @xopcai/xopc` · China: `npm install -g @xopcai/xopc --registry=https://registry.npmmirror.com`

### More commands

```bash
xopc agent -i                              # classic interactive CLI
xopc agent -m "Summarize the last 5 commits" # one-shot

xopc init                                  # full ~/.xopc state tree (first install / repair)
xopc gateway                               # local web server + React console (URL in logs)
xopc gateway service install               # OS service; xopc gateway stop | status | logs
xopc profile list                          # optional isolated state profiles
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

- 🔁 **A path from chat to momentum** — Start with a normal conversation, then let projects, notes, connectors, and automations compound into durable loops.

- 🏠 **Your machine** — Data and config under **`~/.xopc/`**. No mandatory cloud or surprise bills.
- 🔑 **Bring your own keys** — OpenAI, Anthropic, Google, DeepSeek, Ollama, LM Studio, vLLM, and **20+** providers. Mix cloud and local; switch catalog models in one config line. See **[Models](https://xopcai.github.io/xopc/models)**.
- 📱 **Your agent, reachable anywhere** — Run xopc on your computer, pair the [mobile app](./apps/mobile-expo) by QR code, and keep talking or capturing notes on the go without moving your project data into a hosted chat account.
- 🧩 **Grows with you** — **`xopc skills install`** · **`xopc extensions install`** for tools, channels, and UI panels; multi-agent routing per context.
- ⏰ **Proactive** — **Automations** for scheduled summaries, reminders, and workflow runs; **workflows** for fan-out subagent tasks; **multi-agent** routing with isolated workspaces, tools, and prompts.

## How xopc compares

xopc is not trying to replace every coding agent or office agent. It is the local-first system layer for people who want one assistant to remember goals, keep state, run automations, and stay reachable across surfaces.

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

Default: **`~/.xopc/xopc.json`**.

```json
{
  "agents": {
    "default": "main",
    "list": [
      {
        "id": "main",
        "identity": { "name": "Main", "role": "General assistant" },
        "responsibilities": { "primary": ["Help the user complete tasks"] },
        "workspace": { "root": "~/.xopc/workspace/main" },
        "models": {
          "defaultRole": "deep",
          "roles": {
            "deep": { "model": "deepseek/deepseek-v4-flash" }
          }
        },
        "tools": { "builtin": {} },
        "skills": { "mode": "all" },
        "memory": { "mode": "confirmWrite", "sources": ["session"] },
        "workflows": {},
        "boundaries": { "requiresConfirmation": [], "forbidden": [], "escalation": [] }
      }
    ]
  },
  "providers": {
    "deepseek": "${DEEPSEEK_API_KEY}"
  }
}
```

Add **`channels.telegram`**, **`channels.weixin`**, or **`channels.feishu`** when you need IM — see **[configuration](https://xopcai.github.io/xopc/configuration)**.

Optional tools (e.g. browser) stay **off until enabled**; use Playwright Chromium if you turn on browser tools.

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

**Is xopc a hosted service?**  
No. xopc runs on your machine. Config, workspace files, credentials, and local state live under **`~/.xopc/`** by default.

**Do I need a paid cloud model?**  
No. Bring your own keys for cloud providers, or use local/model-server options such as Ollama, LM Studio, and vLLM.

**What is the fastest way to try it?**  
For most users, install the **PC desktop app** from GitHub Releases and complete model setup in the UI. For terminal users, use **`xopc onboard --quick`** and then run **`xopc`**.

**How is this different from another chat UI?**  
xopc can start as a chat UI, but it is organized to grow into goal loops: project context, notes, outside signals, next actions, feedback, and automations across multiple surfaces.

**Can I use it from my phone or messengers?**  
Yes. Start with local TUI first; when ready, run the gateway and use the [mobile app](./apps/mobile-expo) on iOS/Android, or configure Telegram, WeChat, or Feishu/Lark.

<a id="desktop-app"></a>
<a id="electron-desktop"></a>

## Desktop app

The PC desktop app is the easiest way to start for most users: it launches an embedded local gateway and opens the gateway console in a native window.

1. Download from **[GitHub Releases](https://github.com/xopcai/xopc/releases)** — macOS `.dmg`, Windows `xopc-<version>-x64.exe` or `xopc-<version>-arm64.exe`, Linux `.AppImage` / `.deb`.
2. Open the app, complete model setup, and start chatting.
3. Or use **`xopc gateway`** + the npm CLI until a build exists for your OS.

**Build from source:** `pnpm install && pnpm run electron:build` → `dist/release/`

Docs and media placeholders: **[PC Desktop app](https://xopcai.github.io/xopc/desktop-app)**.

---

## Security

Treat inbound IM messages as **untrusted**. Prefer **pairing** or **allowlist** for DMs. Keep gateway bind addresses and tokens secret — **[Channels](https://xopcai.github.io/xopc/channels)**.

---

## Contributing

```bash
pnpm install && pnpm run dev    # CLI via tsx
pnpm run dev:gateway            # dev gateway uses ~/.xopc-dev + info logs
pnpm run build && pnpm test && pnpm run lint
```

**[AGENTS.md](./AGENTS.md)** · **[CONTRIBUTING.md](./CONTRIBUTING.md)**

**Issues:** [bug](https://github.com/xopcai/xopc/issues/new?template=bug_report.yml) · [feature](https://github.com/xopcai/xopc/issues/new?template=feature_request.yml) · [Q&A Discussions](https://github.com/xopcai/xopc/discussions/categories/q-a) · [security advisory](https://github.com/xopcai/xopc/security/advisories/new) (not public issues)

## Credits

- LLM layer: [@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono) · Agent runtime: [@earendil-works/pi-agent-core](https://github.com/earendil-works/pi-mono)
- Inspired by [openclaw/openclaw](https://github.com/openclaw/openclaw) and [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

---

<p align="center"><sub>Made with care by <a href="https://github.com/xopcai">xopcai</a> · <a href="https://xopc.ai">xopc.ai</a></sub></p>
