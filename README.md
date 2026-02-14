# 🐈 xopcbot: Ultra-Lightweight Personal AI Assistant

<div align="center">
  <p>
    <strong>An ultra-lightweight, plugin-driven personal AI assistant built with Node.js and TypeScript.</strong>
  </p>
  <p>
    <a href="https://github.com/xopcai/xopcbot">
      <img src="https://img.shields.io/badge/GitHub-xopcai/xopcbot-blue" alt="GitHub">
    </a>
    <a href="https://xopcai.github.io/xopcbot/">
      <img src="https://img.shields.io/badge/Docs-xopcai.github.io/xopcbot-brightgreen" alt="Docs">
    </a>
    <a href="#">
      <img src="https://img.shields.io/badge/Node-%3E%3D22.0.0-brightgreen" alt="Node">
    </a>
    <a href="#">
      <img src="https://img.shields.io/badge/TypeScript-5.x-blue" alt="TypeScript">
    </a>
    <a href="#">
      <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
    </a>
  </p>
</div>

**xopcbot** provides the core functionality of a personal AI agent in a minimal footprint (~6,000 lines of TypeScript). It's designed to be simple, extensible, and easy to understand.

## ✨ Features

- **🤖 Unified LLM API** - Supports 20+ providers (OpenAI, Anthropic, Google, Groq, DeepSeek, MiniMax, Qwen, Kimi, etc.)
- **🔌 Extensible Plugins** - Add custom tools, hooks, and commands with hot-reloading
- **📱 Multi-Channel Support** - Telegram, WhatsApp, Feishu/Lark, or Web UI
- **🧠 Persistent Memory** - Conversation history with automatic context compaction
- **📂 Session Management** - Browse, search, archive, and manage conversations via CLI or Web UI
- **🔧 Rich Built-in Tools** - Filesystem, shell, web search, grep, find, edit, and more
- **⏰ Scheduled Tasks** - Cron-based automation
- **🖥️ Powerful CLI** - Manage agent, config, and plugins from command line
- **🌐 Modern Web UI** - Chat, sessions, cron, subagents, logs, and settings

---

## 🚀 Quick Start

```bash
# Clone and install
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot
pnpm install

# Configure (interactive setup)
pnpm run dev -- configure

# Start chatting!
pnpm run dev -- agent -i
```

> **Tip:** Run `pnpm run dev -- configure` to set up your LLM provider API key interactively.

---

## 📖 Documentation

Full documentation is available at **[xopcai.github.io/xopcbot](https://xopcai.github.io/xopcbot/)**

| Guide | Description |
|-------|-------------|
| [Getting Started](https://xopcai.github.io/xopcbot/getting-started) | Setup and basic usage |
| [Configuration](https://xopcai.github.io/xopcbot/configuration) | Full config reference |
| [CLI Reference](https://xopcai.github.io/xopcbot/cli) | All available commands |
| [Channels](https://xopcai.github.io/xopcbot/channels) | Telegram, WhatsApp, Feishu setup |
| [Plugins](https://xopcai.github.io/xopcbot/plugins) | Build your own plugins |
| [Tools](https://xopcai.github.io/xopcbot/tools) | Built-in tools reference |
| [Architecture](https://xopcai.github.io/xopcbot/architecture) | Under the hood |

---

## 💬 Supported Channels

| Channel | Status | Description |
|---------|--------|-------------|
| Telegram | ✅ | Bot API with polling/webhook |
| WhatsApp | ✅ | Baileys WebSocket |
| Feishu/Lark | ✅ | WebSocket events |
| Web UI | ✅ | Modern browser interface |

---

## 🛠️ Development

```bash
# Development
pnpm run dev

# Build
pnpm run build

# Test
pnpm test

# Lint
pnpm run lint
```

---

## 🙏 Credits

- Inspired by [OpenClaw](https://github.com/openclaw/openclaw)
- LLM providers via [@mariozechner/pi-ai](https://github.com/badlogic/pi-mono)

---

<div align="center">
  <sub>Made with ❤️ by <a href="https://github.com/xopcai">xopcai</a></sub>
</div>
