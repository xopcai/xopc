# xopcbot

**xopcbot** is a personal AI assistant you run yourself: a **CLI**, an **HTTP/WebSocket gateway** with a **React console**, and **bundled channel plugins** for **Telegram** and **WeChat (Weixin)** so the same agent reaches you in those apps (plus the browser console). Other chat platforms are not shipped in core—you can add them with a custom `ChannelPlugin` extension. It is built on **Node.js 22+** and **TypeScript**, with **20+ LLM providers** via [@mariozechner/pi-ai](https://github.com/mariozechner/pi-ai) and an **extension** + **skills** (SKILL.md) model for growing capabilities without forking core.

If you want something **lightweight**, **local-first**, and easy to script from the terminal or wire to a small always-on gateway, this is it.

[GitHub](https://github.com/xopcai/xopcbot) · [Documentation](https://xopcai.github.io/xopcbot/) · [Models](https://xopcai.github.io/xopcbot/models) · [Configuration](https://xopcai.github.io/xopcbot/configuration) · [CLI](https://xopcai.github.io/xopcbot/cli)

<p align="center">
  <a href="https://github.com/xopcai/xopcbot"><img src="https://img.shields.io/badge/GitHub-xopcai/xopcbot-blue" alt="GitHub"></a>
  <a href="https://xopcai.github.io/xopcbot/"><img src="https://img.shields.io/badge/Docs-Documentation-brightgreen" alt="Docs"></a>
  <a href="#"><img src="https://img.shields.io/badge/Node-%3E%3D22.0.0-brightgreen" alt="Node"></a>
  <a href="#"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
</p>

---

## Highlights

| | |
| --- | --- |
| **Terminal-first** | Interactive `agent` mode, one-shot `-m` messages, cron-backed automations. |
| **Gateway + Web UI** | REST, SSE, and WebSocket APIs; React console (Vite + Tailwind v4) for chat and ops. |
| **Channels** | **Telegram** (multi-account, streaming, voice, documents) and **WeChat (Weixin)** (QR login, policies); **Web** console with the gateway. |
| **Models** | OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, Ollama, Bedrock, Vertex, OAuth flows, and more — switch in config, no code change. |
| **Extensions & skills** | Install or author extensions; skills via SKILL.md and hub-style workflows (see docs). |
| **Workspace tools** | File search/read/edit, web search, browser tools (optional), progress feedback for long tasks. |

---

## Quick install

**Runtime:** Node.js **≥ 22**.

```bash
npm install -g @xopcai/xopcbot
# or: pnpm add -g @xopcai/xopcbot
```

**Recommended first run:** interactive onboarding (models, keys, channels).

```bash
xopcbot onboard
# quick path: xopcbot onboard --quick
```

Then chat in the terminal or start the gateway for the Web UI and channel bots.

---

## Quick start (TL;DR)

```bash
# Interactive CLI chat
xopcbot agent -i

# One message
xopcbot agent -m "Summarize the last 5 commits"

# Gateway (REST/SSE + static console); default dev URL depends on config
xopcbot gateway

# From a dev clone (TypeScript entry, no prior build)
pnpm install && pnpm run dev -- agent -i
```

From source builds use **pnpm** (`pnpm run build`). See [AGENTS.md](./AGENTS.md) for contributor layout.

---

## CLI vs gateway (quick reference)

| Goal | Command / flow |
| --- | --- |
| Chat in the terminal | `xopcbot agent -i` or `xopcbot agent -m "…"` |
| Open the Web console | Run `xopcbot gateway`, open the URL from logs or your `gateway` config |
| Use Telegram / WeChat | Configure `channels.telegram` / `channels.weixin` in `~/.xopcbot/config.json`, run gateway; WeChat: `xopcbot channels login --channel weixin` on the gateway host |
| Onboarding / model setup | `xopcbot onboard` |
| Scheduled jobs | Enable `cron` in config; see [docs](https://xopcai.github.io/xopcbot/) |

Full flags and subcommands: [CLI reference](https://xopcai.github.io/xopcbot/cli).

---

## Security (DMs and the gateway)

Inbound messages from chat apps are **untrusted input**. Prefer **pairing** or **allowlist** policies for DMs and restrict who can trigger the bot in groups until you understand the risk surface.

- Defaults and options: [Channels](https://xopcai.github.io/xopcbot/channels) and configuration docs.
- Gateway token and network exposure: treat the gateway like any admin API — bind appropriately and keep tokens secret.

---

## Documentation

| Guide | Description |
| --- | --- |
| [Getting started](https://xopcai.github.io/xopcbot/getting-started) | Install, onboard, first chat |
| [Configuration](https://xopcai.github.io/xopcbot/configuration) | `config.json` reference |
| [CLI](https://xopcai.github.io/xopcbot/cli) | Commands and flags |
| [Channels](https://xopcai.github.io/xopcbot/channels) | Telegram, WeChat (Weixin), policies |
| [Extensions](https://xopcai.github.io/xopcbot/extensions) | Extension system |
| [Tools](https://xopcai.github.io/xopcbot/tools) | Built-in tools |
| [Skills](https://xopcai.github.io/xopcbot/skills) | Skills and SKILL.md |
| [Architecture](https://xopcai.github.io/xopcbot/architecture) | How pieces fit together |

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

Powered by **pi-ai** — common (OpenAI, Anthropic, Google, Groq, DeepSeek, …), specialty (OpenRouter, Mistral, xAI, …), enterprise (Bedrock, Azure, Vertex, Vercel AI Gateway), OAuth (e.g. Copilot, Codex), and local (Ollama, LM Studio, vLLM). Details: [Models](https://xopcai.github.io/xopcbot/models).

---

## Development

```bash
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot
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
xopcbot extension install xopcbot-extension-weather
xopcbot extension create my-extension --kind tool
```

[Extensions guide](https://xopcai.github.io/xopcbot/extensions)

### Skills

```bash
xopcbot skills list
xopcbot skills install <name>
```

[Skills guide](https://xopcai.github.io/xopcbot/skills)

### Voice (e.g. Telegram)

Configure `stt` / `tts` in `config.json`. [Voice docs](https://xopcai.github.io/xopcbot/voice).

---

## Configuration

Default config path: **`~/.xopcbot/config.json`** (override with `XOPCBOT_CONFIG`).

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

[Full configuration reference](https://xopcai.github.io/xopcbot/configuration)

---

## Credits

- LLM layer: [@mariozechner/pi-ai](https://github.com/mariozechner/pi-ai)
- Agent runtime: [@mariozechner/pi-agent-core](https://github.com/mariozechner/pi-mono)

---

<p align="center"><sub>Made with care by <a href="https://github.com/xopcai">xopcai</a></sub></p>
