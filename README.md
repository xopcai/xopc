# 🐈 xopcbot: Ultra-Lightweight Personal AI Assistant

<div align="center">
  <p>
    <strong>An ultra-lightweight, extension-driven personal AI assistant built with Node.js and TypeScript.</strong>
  </p>
  <p>
    <a href="https://github.com/xopcai/xopcbot">
      <img src="https://img.shields.io/badge/GitHub-xopcai/xopcbot-blue" alt="GitHub">
    </a>
    <a href="https://xopcai.github.io/xopcbot/">
      <img src="https://img.shields.io/badge/Docs-Documentation-brightgreen" alt="Docs">
    </a>
    <a href="#">
      <img src="https://img.shields.io/badge/Node-%3E%3D22.0.0-brightgreen" alt="Node">
    </a>
    <a href="#">
      <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
    </a>
  </p>
</div>

---

## ✨ What can xopcbot do?

xopcbot is your personal AI assistant that runs locally. It can help you with:

| Use Case | Example |
|----------|---------|
| **Coding assistant** | Debug code, explain snippets, write functions |
| **Task automation** | Schedule recurring tasks with cron |
| **File operations** | Search, read, edit files in your workspace |
| **Web research** | Search the web and summarize results |
| **Multi-channel chat** | Talk via Telegram, Feishu, or Web UI |
| **Voice messages** | Send/receive voice messages with STT/TTS |

```bash
# Chat interactively in your terminal
xopcbot agent -i

# Or send a single message
xopcbot agent -m "Explain what this code does: function foo() { return 42; }"

# Let xopcbot help with a git task
xopcbot agent -m "Show me the recent commits and create a PR summary"
```

---

## 🚀 Quick Start

### 1️⃣ Install

```bash
# From npm (recommended)
npm install -g @xopcai/xopcbot

# Or from source
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot && pnpm install && pnpm run build
```

> **Note:** This project uses `pnpm`. Do NOT use `npm` for package management.

### 2️⃣ Setup (interactive wizard)

```bash
xopcbot onboard
# or: pnpm run dev -- onboard
```

The wizard will guide you through:
- Choosing your preferred AI model (20+ providers supported)
- Configuring API keys
- Setting up chat channels (Telegram, etc.)

> **Tip:** Use `xopcbot onboard --quick` for quick model setup only.

### 3️⃣ Start chatting!

```bash
# Interactive chat mode
xopcbot agent -i

# Or use specific channels
xopcbot agent -m "Hello!" --channel telegram --chat-id 123456
```

---

## 📖 Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](https://xopcai.github.io/xopcbot/getting-started) | Setup and basic usage |
| [Configuration](https://xopcai.github.io/xopcbot/configuration) | Full config reference |
| [CLI Reference](https://xopcai.github.io/xopcbot/cli) | All available commands |
| [Channels](https://xopcai.github.io/xopcbot/channels) | Telegram, Feishu setup |
| [Extensions](https://xopcai.github.io/xopcbot/extensions) | Extension system guide |
| [Tools](https://xopcai.github.io/xopcbot/tools) | Built-in tools reference |
| [Skills](https://xopcai.github.io/xopcbot/skills) | Skills system guide |
| [Architecture](https://xopcai.github.io/xopcbot/architecture) | System architecture |

---

## 🔌 Supported Channels

| Channel | Status | Install |
|---------|--------|---------|
| Telegram | ✅ | [Setup Guide](https://xopcai.github.io/xopcbot/channels#telegram) |
| Feishu/Lark | ✅ | [Setup Guide](https://xopcai.github.io/xopcbot/channels#feishu) |
| Web UI | ✅ | Built-in, run `xopcbot gateway` |

### Telegram Features

- ✅ Multi-account support
- ✅ Streaming message preview
- ✅ Voice messages (STT/TTS)
- ✅ Document/file support
- ✅ Access control (allowlist, group policies)
- ✅ @mention handling

---

## 🤖 Supported LLM Providers

xopcbot supports 20+ LLM providers via [@mariozechner/pi-ai](https://github.com/mariozechner/pi-ai):

| Category | Providers |
|----------|-----------|
| **Common** | OpenAI, Anthropic, Google, Groq, DeepSeek, MiniMax, Kimi |
| **Specialty** | xAI (Grok), Mistral, Cerebras, OpenRouter, HuggingFace |
| **Enterprise** | Amazon Bedrock, Azure OpenAI, Google Vertex, Vercel AI Gateway |
| **OAuth** | GitHub Copilot, OpenAI Codex, Google Gemini CLI |
| **Local** | Ollama, LM Studio, vLLM |

See [Models Documentation](https://xopcai.github.io/xopcbot/models) for configuration details.

---

## 🛠️ Development

```bash
# Development (with hot reload)
pnpm run dev

# Build for production
pnpm run build

# Run tests
pnpm test

# Lint
pnpm run lint
```

### Project Structure

```
src/
├── agent/              # Core agent logic (pi-agent-core based)
├── channels/           # Channel integrations (Telegram, Feishu)
├── cli/                # CLI commands with self-registration
├── config/             # Configuration management
├── cron/               # Scheduled tasks
├── gateway/            # HTTP/WebSocket gateway server
├── providers/          # LLM provider registry
├── session/            # Conversation session management
├── ui/                 # Web UI components (Lit-based)
└── utils/              # Shared utilities
```

---

## 📦 Key Features

### Extension System

Extend xopcbot with custom extensions:

```bash
# Install extension
xopcbot extension install xopcbot-extension-weather

# Create your own
xopcbot extension create my-extension --kind tool
```

Learn more in the [Extensions Guide](https://xopcai.github.io/xopcbot/extensions).

### Skills System

Add domain-specific knowledge via SKILL.md files:

```bash
# List available skills
xopcbot skills list

# Install skill dependencies
xopcbot skills install weather
```

Learn more in the [Skills Guide](https://xopcai.github.io/xopcbot/skills).

### Progress Feedback

Real-time progress updates for long-running tasks:

```
🔍 搜索中...
⏱️ 已进行 45 秒
```

Configure feedback verbosity in `config.json`. See [Progress Documentation](https://xopcai.github.io/xopcbot/progress).

### Voice Messages

Send and receive voice messages via Telegram:

```json
{
  "stt": {
    "enabled": true,
    "provider": "alibaba"
  },
  "tts": {
    "enabled": true,
    "provider": "openai",
    "trigger": "auto"
  }
}
```

See [Voice Documentation](https://xopcai.github.io/xopcbot/voice).

---

## 🔧 Configuration

**Config location:** `~/.xopcbot/config.json`

### Quick Example

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
      "botToken": "BOT_TOKEN_HERE",
      "dmPolicy": "allowlist",
      "allowFrom": [123456789]
    }
  }
}
```

See [Configuration Reference](https://xopcai.github.io/xopcbot/configuration) for full details.

---

## 🙏 Credits

- LLM providers via [@mariozechner/pi-ai](https://github.com/mariozechner/pi-ai)
- Agent framework via [@mariozechner/pi-agent-core](https://github.com/mariozechner/pi-mono)

---

<div align="center">
  <sub>Made with ❤️ by <a href="https://github.com/xopcai">xopcai</a></sub>
</div>
