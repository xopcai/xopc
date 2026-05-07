<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<h1 align="center">xopc</h1>

<p align="center">
  <strong>The OPC workstation that grows with you.</strong><br />
  Ultra-lightweight <strong>personal AI assistant</strong> for <strong>One Person Companies</strong>.
</p>

<p align="center">
  <a href="https://github.com/xopcai/xopc"><img src="https://img.shields.io/badge/GitHub-xopcai%2Fxopc-181717?style=for-the-badge&amp;logo=github" alt="GitHub"></a>
  <a href="https://xopcai.github.io/xopc/"><img src="https://img.shields.io/badge/Docs-Documentation-228B22?style=for-the-badge" alt="Documentation"></a>
  <a href="#quick-start-tldr"><img src="https://img.shields.io/badge/Quick_Start-CLI-blue?style=for-the-badge" alt="Quick Start"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge" alt="License"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node.js-%E2%89%A522-339933?logo=nodedotjs&amp;logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/pnpm-package_manager-F69220?logo=pnpm&amp;logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/LLM_providers-20%2B-5865F2" alt="LLM providers">
  <a href="https://www.npmjs.com/package/@xopcai/xopc"><img src="https://img.shields.io/npm/v/@xopcai/xopc?label=npm&amp;color=teal" alt="npm version"></a>
</p>

<p align="center">
  <a href="https://github.com/xopcai/xopc">GitHub</a> ·
  <a href="https://xopcai.github.io/xopc/">Documentation</a> ·
  <a href="https://xopcai.github.io/xopc/models">Models</a> ·
  <a href="https://xopcai.github.io/xopc/configuration">Configuration</a> ·
  <a href="https://xopcai.github.io/xopc/cli">CLI</a>
</p>

**CLI**, **HTTP/WebSocket gateway** with a **React** console, bundled **Telegram** & **WeChat (Weixin)** channel plugins (plus web console). Other chat surfaces: custom `ChannelPlugin` extensions. **20+ LLM providers** via [@mariozechner/pi-ai](https://github.com/mariozechner/pi-ai), plus **extensions** and **SKILL.md** skills—extend without forking core.

---

## Highlights

| | |
| --- | --- |
| **OPC-native** | One Person Company AI workstation: from solo founder to scale—agent, gateway, channels, cron, skills, all in your control. |
| **Grow with you** | Start with a single CLI command; add channels, extensions, and cron as your needs evolve—no vendor lock-in. |
| **Gateway + Web UI** | REST, SSE, and WebSocket APIs; React console (Vite + Tailwind v4) for chat and ops. |
| **Channels** | **Telegram** (multi-account, streaming, voice, documents) and **WeChat (Weixin)** (QR login, policies); **Web** console with the gateway. |
| **Models** | OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, Ollama, Bedrock, Vertex, OAuth flows, and more — switch in config, no code change. |
| **Extensions & skills** | Install or author extensions; skills via SKILL.md and hub-style workflows (see docs). |
| **Workspace tools** | File search/read/edit, web search, browser tools (optional), progress feedback for long tasks. |

---

## Quick install

**Runtime:** Node.js **≥ 22**.

```bash
npm install -g @xopcai/xopc
# or: pnpm add -g @xopcai/xopc
```

**Recommended first run:** interactive onboarding (models, keys, channels).

```bash
xopc onboard
# quick path: xopc onboard --quick
```

Then chat in the terminal or start the gateway for the Web UI and channel bots.

---

<a id="quick-start-tldr"></a>

## Quick start (TL;DR)

```bash
# Interactive CLI chat
xopc agent -i

# One message
xopc agent -m "Summarize the last 5 commits"

# Gateway (REST/SSE + static console); default dev URL depends on config
xopc gateway

# From a dev clone (TypeScript entry, no prior build)
pnpm install && pnpm run dev -- agent -i
```

From source builds use **pnpm** (`pnpm run build`). See [AGENTS.md](./AGENTS.md) for contributor layout.

---

## CLI vs gateway (quick reference)

| Goal | Command / flow |
| --- | --- |
| Chat in the terminal | `xopc agent -i` or `xopc agent -m "…"` |
| Open the Web console | Run `xopc gateway`, open the URL from logs or your `gateway` config |
| Use Telegram / WeChat | Configure `channels.telegram` / `channels.weixin` in `~/.xopc/xopc.json`, run gateway; WeChat: `xopc channels login --channel weixin` on the gateway host |
| Onboarding / model setup | `xopc onboard` |
| Scheduled jobs | Enable `cron` in config; see [docs](https://xopcai.github.io/xopc/) |

Full flags and subcommands: [CLI reference](https://xopcai.github.io/xopc/cli).

---

## Security (DMs and the gateway)

Inbound messages from chat apps are **untrusted input**. Prefer **pairing** or **allowlist** policies for DMs and restrict who can trigger the bot in groups until you understand the risk surface.

- Defaults and options: [Channels](https://xopcai.github.io/xopc/channels) and configuration docs.
- Gateway token and network exposure: treat the gateway like any admin API — bind appropriately and keep tokens secret.

---

## Documentation

| Guide | Description |
| --- | --- |
| [Getting started](https://xopcai.github.io/xopc/getting-started) | Install, onboard, first chat |
| [Configuration](https://xopcai.github.io/xopc/configuration) | Main JSON config (`xopc.json`) reference |
| [CLI](https://xopcai.github.io/xopc/cli) | Commands and flags |
| [Channels](https://xopcai.github.io/xopc/channels) | Telegram, WeChat (Weixin), policies |
| [Extensions](https://xopcai.github.io/xopc/extensions) | Extension system |
| [Tools](https://xopcai.github.io/xopc/tools) | Built-in tools |
| [Skills](https://xopcai.github.io/xopc/skills) | Skills and SKILL.md |
| [Architecture](https://xopcai.github.io/xopc/architecture) | How pieces fit together |

---

## Supported channels

Core ships **two** messaging integrations (see `extensions/telegram`, `extensions/weixin`):

| Channel | Notes |
| --- | --- |
| Telegram | Multi-account, streaming preview, voice (STT/TTS), files, allowlist / group policies |
| WeChat (Weixin) | QR login on the gateway host, DM / group policies; config under `channels.weixin` |
| Web | Gateway console (React SPA)—not a third-party IM, but the primary browser UI |

There is **no** bundled Feishu, Slack, Discord, etc.; those would be separate extensions.

---

## Supported LLM providers (overview)

Powered by **pi-ai** — common (OpenAI, Anthropic, Google, Groq, DeepSeek, …), specialty (OpenRouter, Mistral, xAI, …), enterprise (Bedrock, Azure, Vertex, Vercel AI Gateway), OAuth (e.g. Copilot, Codex), and local (Ollama, LM Studio, vLLM). Details: [Models](https://xopcai.github.io/xopc/models).

---

## Development

```bash
git clone https://github.com/xopcai/xopc.git
cd xopc
pnpm install
pnpm run dev          # CLI via tsx
pnpm run build        # Node + web console → dist
pnpm test
pnpm run lint
```

### Repository layout

```
src/
├── agent/       # Agent service, tools, memory, prompts
├── channels/    # Channel plugins and integrations
├── cli/         # Commands
├── config/      # Schema and loader
├── cron/        # Scheduled tasks
├── gateway/     # HTTP/WebSocket server
├── providers/   # Model registry
├── session/     # Sessions
└── …
web/             # Gateway console (React + Vite)
```

---

## Key features (deeper)

### Extensions

```bash
xopc extension install xopc-extension-weather
xopc extension create my-extension --kind tool
```

[Extensions guide](https://xopcai.github.io/xopc/extensions)

### Skills

```bash
xopc skills list
xopc skills install <name>
```

[Skills guide](https://xopcai.github.io/xopc/skills)

### Voice (e.g. Telegram)

Configure `stt` / `tts` in your main config (`xopc.json` by default). [Voice docs](https://xopcai.github.io/xopc/voice).

---

## Configuration

Default config path: **`~/.xopc/xopc.json`** (override with `XOPC_CONFIG`).

Minimal example:

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

[Full configuration reference](https://xopcai.github.io/xopc/configuration)

---

## Credits

- LLM layer: [@mariozechner/pi-ai](https://github.com/mariozechner/pi-ai)
- Agent runtime: [@mariozechner/pi-agent-core](https://github.com/mariozechner/pi-mono)

---

<p align="center"><sub>Made with care by <a href="https://github.com/xopcai">xopcai</a></sub></p>
