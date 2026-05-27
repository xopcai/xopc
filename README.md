<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center">xopc</h1>

<p align="center">
  <strong>The OPC workstation that grows with you.</strong><br />
  A local-first personal AI for one-person companies — CLI, desktop, browser, mobile, and your favorite messengers.<br />
  Bring your own keys. Extend without forking.
</p>

<p align="center">
  <a href="https://github.com/xopcai/xopc"><img src="https://img.shields.io/badge/GitHub-xopcai%2Fxopc-181717?style=for-the-badge&amp;logo=github" alt="GitHub"></a>
  <a href="https://xopcai.github.io/xopc/"><img src="https://img.shields.io/badge/Docs-Documentation-228B22?style=for-the-badge" alt="Documentation"></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/Quick_Start-CLI-blue?style=for-the-badge" alt="Quick Start"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node.js-%E2%89%A522-339933?logo=nodedotjs&amp;logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/pnpm-package_manager-F69220?logo=pnpm&amp;logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/LLM_providers-20%2B-5865F2" alt="LLM providers">
  <a href="https://www.npmjs.com/package/@xopcai/xopc"><img src="https://img.shields.io/npm/v/@xopcai/xopc?label=npm&amp;color=teal" alt="npm version"></a>
</p>

<p align="center">
  <a href="https://xopc.ai">Website</a> ·
  <a href="https://github.com/xopcai/xopc">GitHub</a> ·
  <a href="https://xopcai.github.io/xopc/">Documentation</a> ·
  <a href="https://xopcai.github.io/xopc/models">Models</a> ·
  <a href="https://xopcai.github.io/xopc/configuration">Configuration</a> ·
  <a href="https://xopcai.github.io/xopc/cli">CLI</a>
</p>

**xopc** is a self-hosted agent stack: **CLI**, full-screen **terminal UI (TUI)**, **HTTP/SSE gateway** (REST JSON APIs plus Server-Sent Events for streaming and live updates) with a **React** console, optional **Electron** desktop (**macOS**, **Windows**, **Linux**), and bundled **channel** plugins (Telegram, WeChat, Feishu/Lark). LLMs are wired through **[@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono)** (20+ providers). Add **extensions** (tools, channels, providers) and **SKILL.md** skills — plus **gateway UI** extensions via the extension UI SDK.

---

## Why xopc

| | |
| --- | --- |
| **Your machine. Your rules.** | xopc runs on your hardware. Conversations stay local. API keys stay in your config. No mandatory cloud, no surprise bills, no data leaving without your say — everything under **`~/.xopc/`**. |
| **Bring your own keys. Any model.** | DeepSeek (recommended), OpenAI, Anthropic, Google, Ollama, LM Studio, vLLM, Bedrock, Azure — 20+ providers built in. Run fully offline with local inference, or mix cloud and local. Switch models in one config line. |
| **One brain, every screen** | The same assistant — in your terminal, browser, desktop app, phone, and messengers. No sync needed. It's all one system. |
| **Grows with you. Never outgrow it.** | Install Skills with one command. Add Extensions for new tools, channels, and UI panels. Multi-agent routing for different contexts. **`xopc skills install`** · **`xopc extensions install`** — and it just works. |
| **Cron scheduling** | Summaries, reminders, and reports pushed on a timetable. Your agent doesn't only reply; it runs while you focus elsewhere. |
| **Multi-agent routing** | Route different contexts to different agents — each with its own model, workspace, tools, and system prompt. Fully isolated contexts for work, creativity, and code. |

---

## Up and running in 30 seconds

Install the CLI, run onboarding, and start chatting in the terminal — three steps:

```bash
npm install -g @xopcai/xopc
xopc onboard          # faster path: xopc onboard --quick
xopc tui --local
```

**Requirements:** Node.js **≥ 22**. **pnpm** is recommended when working from a git clone.

**China / slow access to `registry.npmjs.org`:** add `--registry=https://registry.npmmirror.com` to `npm install`, or set `npm config set registry https://registry.npmmirror.com`.

---

<a id="quick-start"></a>

## Quick start

```bash
# Full-screen terminal UI (embedded agent; no gateway required)
xopc tui --local

# Classic interactive CLI chat
xopc agent -i

# One-shot message
xopc agent -m "Summarize the last 5 commits"

# Gateway: REST/SSE + static web console (URL from logs or gateway config)
xopc gateway

# Same gateway, detached (prints PID/URL; stop with `xopc gateway stop`)
xopc gateway --background
```

**From source (development):**

```bash
git clone https://github.com/xopcai/xopc.git && cd xopc
pnpm install && pnpm run dev -- agent -i   # no build needed for dev CLI
pnpm run build                              # Node + web console → dist/
```

---

## Demo

![tui](docs/public/xopc-tui.gif)

---

<a id="electron-desktop"></a>

## Electron desktop app

### Install from GitHub Releases

1. Open **[GitHub Releases](https://github.com/xopcai/xopc/releases)** for this repo.
2. Pick the asset for your OS (typical names: **`.dmg`** / **`.zip`** on macOS, **`.exe`** on Windows, **`.AppImage`** / **`.deb`** on Linux).
3. Install or run it like any desktop application. On macOS, first launch may ask for **microphone** access if you use voice in chat.

If your platform has no published build yet, use **`xopc gateway`** + npm CLI, or build from source below.

### Build from source (developers)

```bash
pnpm install
pnpm run electron:build   # artifacts under dist/release/
```

---

## Chat surfaces (pick one)

| Surface | Command / how | Best for |
| --- | --- | --- |
| **TUI** | `xopc tui`, `xopc tui --local`, or `xopc tui --url …` | Full keyboard control, streaming output, zero perceived latency |
| **CLI** | `xopc agent -i` / `xopc agent -m "…"` | Scripting and minimal TTY |
| **Web** | `xopc gateway` (foreground) or `xopc gateway --background`, then open the console URL | Full console in the browser — chat, settings, logs |
| **Desktop** | **[Install from Releases](#electron-desktop)** or build from source | Native desktop experience across macOS, Windows, and Linux |
| **Mobile** | Scan to pair with your gateway | Your assistant on the go |
| **Messengers** | Telegram, WeChat, Feishu/Lark — configure `channels.*`, run gateway | Chat directly in your favorite IM |

---

## Bundled channels (config keys)

Enable and configure under **`channels.*`** in **`~/.xopc/xopc.json`** (override path with `XOPC_CONFIG` / `XOPC_CONFIG_PATH`). The gateway must run for IM bots; WeChat needs login on the gateway host.

| Channel | Config section | Notes |
| --- | --- | --- |
| **Telegram** | `channels.telegram` | Multi-account, streaming, voice, documents; DM/group policies |
| **WeChat (Weixin)** | `channels.weixin` | QR login on gateway host; DM/group policies |
| **Feishu / Lark** | `channels.feishu` | Bot / webhook style setup per docs |
| **Web** | *(gateway)* | React SPA served with the gateway — not a separate IM |

Full field reference and security defaults: **[Channels](https://xopcai.github.io/xopc/channels)** and **[Configuration](https://xopcai.github.io/xopc/configuration)**.

---

## Local-first & BYOK

- **You control credentials:** set `providers.*` in config and/or provider env vars (see [Models](https://xopcai.github.io/xopc/models)).
- **On-prem inference:** point the default model at **Ollama**, **LM Studio**, **vLLM**, or other OpenAI-compatible bases — no cloud LLM required.
- **Optional tools** (e.g. browser automation) are **off until you enable** them; install Playwright Chromium if you use browser tools.

---

## CLI vs gateway

| Goal | Command / flow |
| --- | --- |
| Terminal chat | `xopc tui --local` or `xopc agent -i` |
| Web console | `xopc gateway` → open the URL from logs / config |
| Gateway in background | `xopc gateway --background` — then `xopc gateway status`, `xopc gateway stop`, `xopc gateway restart`, `xopc gateway logs` as needed |
| Telegram / WeChat / Feishu | Configure `channels.*`, run gateway; WeChat: `xopc channels login --channel weixin` on the gateway host |
| Onboarding | `xopc onboard` |
| Schedules | Enable `cron` in config |

CLI reference: **[CLI](https://xopcai.github.io/xopc/cli)**.

---

## Security

Treat inbound chat messages as **untrusted input**. Prefer **pairing** or **allowlist** for DMs until you understand exposure. Bind the gateway appropriately and keep gateway tokens secret — see **[Channels](https://xopcai.github.io/xopc/channels)**.

---

## Documentation

| Guide | Description |
| --- | --- |
| [Getting started](https://xopcai.github.io/xopc/getting-started) | Install, onboard, first chat |
| [Configuration](https://xopcai.github.io/xopc/configuration) | `xopc.json` reference |
| [CLI](https://xopcai.github.io/xopc/cli) | Commands and flags |
| [Channels](https://xopcai.github.io/xopc/channels) | All bundled channels |
| [Extensions](https://xopcai.github.io/xopc/extensions) | Extension system |
| [Tools](https://xopcai.github.io/xopc/tools) | Built-in tools |
| [Skills](https://xopcai.github.io/xopc/skills) | SKILL.md skills |
| [Voice](https://xopcai.github.io/xopc/voice) | STT/TTS |
| [Architecture](https://xopcai.github.io/xopc/architecture) | How pieces fit together |

---

## LLM providers (overview)

**DeepSeek** (recommended), OpenAI, Anthropic, Google, Groq, OpenRouter, Mistral, xAI, Bedrock, Azure, Vertex, Vercel AI Gateway, OAuth flows (e.g. Copilot/Codex), and local stacks via pi-ai. Details: **[Models](https://xopcai.github.io/xopc/models)**.

---

## Extensions & skills

```bash
xopc skills install <name>     # teach your assistant new domains via SKILL.md
xopc extensions install <pkg>  # tools, channels, and UI panels
xopc extensions dev ./my-extension
xopc skills list
```

Backend extensions can ship **tools**, **channels**, and **model bridges**. Gateway **UI** extensions use **`@xopcai/xopc/extension-ui-sdk`** (see `packages/extension-ui-sdk/`). Guides: **[Extensions](https://xopcai.github.io/xopc/extensions)**, **[Skills](https://xopcai.github.io/xopc/skills)**.

---

## Configuration snippet

Default path: **`~/.xopc/xopc.json`**.

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5",
      "max_tokens": 8192,
      "temperature": 0.7
    }
  },
  "providers": {
    "openai": "${OPENAI_API_KEY}",
    "anthropic": "${ANTHROPIC_API_KEY}"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "YOUR_TOKEN",
      "dmPolicy": "allowlist",
      "allowFrom": [123456789]
    }
  }
}
```

Add **`channels.weixin`** and **`channels.feishu`** as needed — see the **[configuration](https://xopcai.github.io/xopc/configuration)** and **[channels](https://xopcai.github.io/xopc/channels)** docs for full schemas.

---

## Repository layout

```
src/
├── agent/       # Agent service, tools, memory, prompts
├── channels/    # Channel plugin host
├── cli/         # Commands
├── config/      # Schema and loader
├── cron/        # Scheduled tasks
├── gateway/     # HTTP + SSE gateway server
├── providers/   # Model registry
├── session/     # Sessions
├── tui/         # Terminal UI (pi-tui)
└── …
web/             # Gateway console (React + Vite)
```

Contributor notes: **[AGENTS.md](./AGENTS.md)** · **[CONTRIBUTING.md](./CONTRIBUTING.md)** (issues, labels, PRs).

---

## Reporting issues

Use the [bug report](https://github.com/xopcai/xopc/issues/new?template=bug_report.yml) or [feature request](https://github.com/xopcai/xopc/issues/new?template=feature_request.yml) templates. For configuration and usage questions, prefer [Discussions → Q&A](https://github.com/xopcai/xopc/discussions/categories/q-a). Security issues: [private advisory](https://github.com/xopcai/xopc/security/advisories/new), not a public issue. See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for labels and triage.

---

## Development

```bash
pnpm install
pnpm run dev          # CLI via tsx
pnpm run build        # Node + web → dist
pnpm test
pnpm run lint
```

---

## Credits

- LLM layer: [@earendil-works/pi-ai](https://github.com/earendil-works/pi-mono)
- Agent runtime: [@earendil-works/pi-agent-core](https://github.com/earendil-works/pi-mono)
- Inspired by [openclaw/openclaw](https://github.com/openclaw/openclaw) and [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

---

<p align="center"><sub>Made with care by <a href="https://github.com/xopcai">xopcai</a></sub></p>
