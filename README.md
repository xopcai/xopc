<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center"><a href="https://xopc.ai">xopc</a></h1>

<p align="center">
  <strong>Keep what matters moving.</strong><br />
  A personal AI on your computer that remembers your goals and context—<br />
  and picks up where you left off.
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
  <a href="https://xopc.ai/en#download"><strong>Download the desktop app →</strong></a> ·
  <a href="#quick-start"><strong>Install in 30 seconds</strong></a> ·
  <a href="https://xopcai.github.io/xopc/">Read the docs</a>
</p>

<p align="center">
  <a href="https://xopcai.github.io/xopc/desktop-app">
    <img src="docs/public/xopc-desktop.gif" alt="xopc desktop app demo" width="1200">
  </a>
</p>

> After setup, try: **“One thing I want to move forward this week is ____. Help me find the smallest credible next step.”**

<details>
<summary><strong>Table of Contents</strong></summary>

- [Why try xopc](#why-try-xopc)
- [Get started](#get-started)
- [Where to chat](#where-to-chat)
- [Channels](#channels)
- [Extensions &amp; skills](#extensions--skills)
- [Configuration](#configuration)
- [Documentation](#documentation)
- [FAQ](#faq)
- [Security](#security)
- [Contributing](#contributing)

</details>

---

## Why try xopc

- **Start before it is organized.** Drop in text, voice, files, links, or a thought you cannot explain clearly yet.
- **Stop repeating yourself.** Sessions, projects, tasks, and correctable user understanding keep the context that matters.
- **Move beyond advice.** xopc can use tools, run workflows, verify results, and continue the work later.
- **Stay in control.** It is local-first, sources are authorized separately, and high-impact actions such as sending or deleting require confirmation.

**Keep what matters moving.** xopc keeps context, the next action, evidence, and follow-up together, so important work does not disappear when a chat ends.

xopc works from desktop, web, terminal, mobile, Telegram, WeChat, and Feishu/Lark, with your choice of cloud or local models.

For the full product philosophy, trust model, and roadmap, read [Product philosophy](https://xopcai.github.io/xopc/product).

---

<a id="desktop-app"></a>
<a id="get-started"></a>
<a id="quick-start"></a>

## Get started

### Easiest start: desktop app

For most users, the **desktop app** is the easiest way to start: install the app, finish model setup in the UI, then chat in the built-in console. It starts the local gateway for you.

1. Open **[xopc.ai](https://xopc.ai/en#download)** and choose macOS, Windows, or Linux.
2. Open xopc and complete model setup.
3. Start chatting.

See **[Desktop app](https://xopcai.github.io/xopc/desktop-app)** for install notes, first-run guidance, and build-from-source commands.

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

Large optional runtimes are installed only when you enable the related feature:

```bash
npm install -g @huggingface/transformers@3.8.1 sherpa-onnx-node@1.13.4
npm install -g @composio/core@0.14.0 @composio/experimental@0.2.0
npm install -g @larksuiteoapi/node-sdk@1.66.0 playwright-core@1.60.0
```

Use the same command without `-g` when xopc is installed as a project dependency.

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

## Where to chat

| Surface | How | Best for |
| --- | --- | --- |
| **Desktop app** | [Download from xopc.ai](https://xopc.ai/en#download) | Easiest start: native app + embedded gateway console |
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
xopc extensions install store:<id>  # or npm:<package> / ./local-directory
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
| [The Continuous Work Model](https://xopcai.github.io/xopc/concepts/loops) | How state, execution, and triggers form resumable, inspectable work loops |
| [Projects, Tasks, and Notes](https://xopcai.github.io/xopc/projects-tasks-notes) | Keep long-running work in one verified Task model with optional shared project context |
| [Share a conversation](https://xopcai.github.io/xopc/session-sharing) | Publish a reviewed, read-only Session snapshot with expiration and view limits |
| [Configuration](https://xopcai.github.io/xopc/configuration) | `xopc.json` reference |
| [CLI](https://xopcai.github.io/xopc/cli) | Commands and flags |
| [Channels](https://xopcai.github.io/xopc/channels) | Telegram, WeChat, Feishu |
| [Architecture](https://xopcai.github.io/xopc/architecture) | How pieces fit together |
| [Workflows](https://xopcai.github.io/xopc/workflows) | Fan-out subagents, board UI, scripts |

Also: [Tools](https://xopcai.github.io/xopc/tools) · [Mobile app](https://xopcai.github.io/xopc/mobile-app) · [Voice](https://xopcai.github.io/xopc/voice) · [Remote access](https://xopcai.github.io/xopc/remote-access)

---

## FAQ

**Is xopc a hosted service?** — No. xopc runs on your machine, with configuration and state stored under **`~/.xopc/`** by default. You can self-host the gateway for access from other devices.

**Does local-first mean data never leaves my computer?** — Not necessarily. If you select a cloud model, conversation content and context relevant to the request are sent to that model provider. Use a local model and review source and tool permissions for work that must remain on-device.

**Does xopc remember everything about me automatically?** — No. User understanding can be reviewed, confirmed, corrected, and deleted, and an unconfirmed inference should not become an authoritative fact. Passwords, keys, and other highly sensitive information do not belong in the memory system.

**Do I need a paid cloud model?** — No. Bring your own keys, or use local models (Ollama, LM Studio, vLLM).

**What is the fastest way to try it?** — [Desktop app](#get-started) for GUI users, or `xopc onboard --quick && xopc` for terminal.

**How is this different from another chat UI?** — Chat is only one surface. xopc preserves understanding, long-term goals, projects, tasks, decisions, and run history so the same assistant can continue working across time and surfaces.

**Can I use it from my phone or messengers?** — Yes. Pair the [mobile app](./apps/mobile-expo) by QR code, or configure Telegram, WeChat, or Feishu/Lark via the gateway.

**Have a question?** — Ask on [GitHub Discussions](https://github.com/xopcai/xopc/discussions/categories/q-a).

---

## Security

xopc handles personal context and may be given execution tools, so capability boundaries matter as much as model choice:

- enable only the data sources, tools, and channels you currently need;
- before using a cloud model, understand what context may be sent to the provider;
- treat all inbound messenger content as **untrusted input** and prefer **pairing** or **allowlist** for DMs;
- keep gateway bind addresses, access tokens, and API keys private;
- preserve human confirmation for sending, deleting, purchasing, and other high-impact actions.

See [User understanding and privacy](./docs/user-understanding.md), [channel security](https://xopcai.github.io/xopc/channels), and the [configuration reference](https://xopcai.github.io/xopc/configuration).

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
- User understanding: inspired by [OpenWiki](https://github.com/langchain-ai/openwiki)'s evidence-to-knowledge approach, reimplemented as a native XOPC capability with governed synthesis and per-turn context planning — see [User understanding](./docs/user-understanding.md)
- Inspired by [openclaw/openclaw](https://github.com/openclaw/openclaw) and [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

---

<p align="center"><sub>Made with care by <a href="https://github.com/xopcai">xopcai</a> · <a href="https://xopc.ai">xopc.ai</a></sub></p>
