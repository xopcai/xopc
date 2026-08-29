<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center"><a href="https://xopc.ai">xopc</a></h1>

<p align="center">
  <strong>It lives on your computer—and slowly gets to know you.</strong><br />
  xopc is a local-first personal AI assistant that gets to know you over time.<br />
  It builds a reviewable, correctable understanding from the parts of your digital life you choose to share, catches every thought, and helps you move what truly matters forward.
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
  <a href="https://xopcai.github.io/xopc/desktop-app">
    <img src="docs/public/xopc-desktop.gif" alt="xopc desktop app demo" width="1200">
  </a>
</p>

<details>
<summary><strong>Table of Contents</strong></summary>

- [What xopc is](#what-xopc-is)
- [From first meeting to trust](#from-first-meeting-to-trust)
- [Four things it must learn](#four-things-it-must-learn)
- [How trust is earned](#how-trust-is-earned)
- [What exists today](#what-exists-today)
- [First product horizon](#first-product-horizon)
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

## What xopc is

xopc is not an AI employee, not an agent confined to one task or codebase, and not merely a productivity tool. It is a **private AI assistant** designed to live on your computer for the long term: starting from zero, learning what matters to you, and gradually helping you move it forward as trust grows.

It does not pretend to know you the moment it is installed. Its understanding should come from sources you explicitly authorize, the work you do together, and the conclusions you confirm or correct.

> **Meet → Explore → Understand → Assist → Earn trust → Become gradually proactive**

Chat is only one place where this relationship appears. Models, agents, tasks, projects, memory, workflows, and automations are supporting capabilities. The actual product promise is simpler: **it understands me better than it did yesterday, and it helped me advance something important.**

## From first meeting to trust

xopc's ideal first experience is not a wall of tool toggles. It is a restrained and transparent process of getting acquainted:

1. It introduces itself, then asks: **“Where may I begin to understand you?”**
2. You choose, one source at a time, whether to share local files, mail, calendar, or something else.
3. Exploration stays visible: what it is looking at, what it found, and what it proposes to remember.
4. It turns scattered evidence into an early understanding of goals, relationships, projects, commitments, and blockers.
5. You can confirm, correct, delete, or ask it to forget any part of that understanding.
6. Instead of trying to process everything, it finds one thing worth advancing now and helps you take the first step.

The real **aha moment** is not “it can access Gmail.” It is:

> “I think I'm beginning to know you. The most important thing right now may not be clearing every unread email, but moving this project that has been stuck for two weeks. Shall we finish the first step tonight?”

## Four things it must learn

### 1. Understand a person

xopc should maintain a living model that you can inspect and correct—not put everything into a vector database forever:

- your goals, preferences, and habits;
- the people and relationships that matter;
- active projects;
- past decisions and the reasons behind them;
- promises that remain unfulfilled;
- recent pressures, blockers, and directions of attention.

It must also decide what is worth remembering, what should be forgotten, and what may no longer be true.

### 2. Hold complex, messy work

Give it text, voice, a screenshot, an email, a file, a link, or a thought you have not made clear yet. Being organized is not a prerequisite for using xopc; making the mess clear is work you do together:

```text
A thought appears
→ connect it to a goal or project
→ add context
→ form a next action
→ identify dependencies and blockers
→ bring it back at the right time
→ preserve decisions made along the way
→ turn the experience into something reusable
```

### 3. Solve problems with you

It needs to understand why the work matters, then help clarify the problem, investigate, read context, make a plan, use tools, verify the result, and record what happened. Complex work can span conversations, surfaces, and long periods without requiring you to explain it all again.

### 4. Earn initiative

Initiative does not mean more notifications. It means noticing a forgotten commitment, sensing that a project has stalled, connecting new information to an existing goal, and knowing when not to interrupt.

Permission should unlock gradually with trust:

```text
Observe only
→ offer reminders
→ propose an action
→ act after confirmation
→ automatically handle explicitly authorized, low-risk work
```

## How trust is earned

Exploring someone's digital life can feel magical or frightening. xopc must keep that exploration visible and under the user's control:

- authorize each data source separately, with permission that can be revoked;
- show what is being examined and why;
- preserve the relationship between evidence and conclusions;
- distinguish **observed facts** from **inferences**;
- let users confirm, correct, delete, or prohibit a memory;
- keep data on-device by default and make cloud-model context sharing clear;
- separately confirm high-impact actions such as sending, deleting, or purchasing.

Trust is not a paragraph in a privacy policy. It is accumulated through every act of restraint.

## What exists today

xopc already provides the local foundation for this relationship:

| Capability | Current foundation |
| --- | --- |
| **Local operation & ownership** | Desktop app, self-hosted gateway, local state, BYOK, and cloud or local models |
| **Durable understanding** | User understanding that can be reviewed, confirmed, corrected, and deleted; relevance-based context selection; stale and conflicting-item review |
| **Long-running work** | Persistent sessions, tasks, projects, notes, workspaces, run history, and resumable context |
| **Execution & follow-up** | Tools, skills, workflows, scheduled/manual/webhook automations, and inspectable run history |
| **Multiple surfaces** | Desktop, web, CLI, TUI, iOS/Android, Telegram, WeChat, Feishu/Lark, and APIs |

These foundations are still converging into one coherent personal-assistant experience. For the exact capabilities of the current release, see [Releases](https://github.com/xopcai/xopc/releases) and the [documentation](https://xopcai.github.io/xopc/).

## First product horizon

The first product horizon now being built is intentionally small and complete:

1. Make the local macOS app the primary experience.
2. Provide one universal entry point for text, voice, files, and links.
3. Begin with three sources: local files, Gmail, and Calendar.
4. Make the personal understanding model inspectable, traceable, and correctable.
5. Manage long-running work through projects and tasks.
6. Find one genuinely important thing each day and help the user move it forward.
7. Require confirmation before every external action.

Success is not measured by message volume or the number of tasks completed automatically. The more important question is:

> **After seven days, how many people feel: it understands me better than it did on day one, and it genuinely helped me advance something important?**

For builders, the foundation remains a self-hosted, extensible personal AI runtime. See how tasks, state, execution, and triggers form resumable, inspectable loops in [The Continuous Work Model](https://xopcai.github.io/xopc/concepts/loops).

---

<a id="desktop-app"></a>
<a id="get-started"></a>
<a id="quick-start"></a>

## Get started

### Easiest start: desktop app

For most users, the **desktop app** is the easiest way to start: install the app, finish model setup in the UI, then chat in the built-in console. It starts the local gateway for you.

1. Download from **[GitHub Releases](https://github.com/xopcai/xopc/releases)** — macOS `.dmg`, Windows `.exe`, Linux `.AppImage` / `.deb`.
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
| **Desktop app** | [GitHub Releases](#desktop-app) | Easiest start: native app + embedded gateway console |
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
