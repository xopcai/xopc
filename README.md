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
      <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
    </a>
  </p>
</div>

## ✨ What can xopcbot do?

xopcbot is your personal AI assistant that runs locally. It can help you with:

| Use Case | Example |
|----------|---------|
| **Coding assistant** | Debug code, explain snippets, write functions |
| **Task automation** | Schedule recurring tasks with cron |
| **File operations** | Search, read, edit files in your workspace |
| **Web research** | Search the web and summarize results |
| **Multi-channel chat** | Talk via Telegram, WhatsApp, Feishu, or Web UI |

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
cd xopcbot && pnpm install && pnpm build
```

### 2️⃣ Setup (interactive wizard)

```bash
xopcbot onboard
# or: pnpm run dev -- onboard
```

The wizard will guide you through:
- Choosing your preferred AI model (20+ providers supported)
- Configuring API keys
- Setting up chat channels (Telegram, WhatsApp, etc.)

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
| [Channels](https://xopcai.github.io/xopcbot/channels) | Telegram, WhatsApp, Feishu setup |
| [Tools](https://xopcai.github.io/xopcbot/tools) | Built-in tools reference |

---

## 🔌 Supported Channels

| Channel | Status | Install |
|---------|--------|---------|
| Telegram | ✅ | [Setup Guide](https://xopcai.github.io/xopcbot/channels#telegram) |
| WhatsApp | ✅ | [Setup Guide](https://xopcai.github.io/xopcbot/channels#whatsapp) |
| Feishu/Lark | ✅ | [Setup Guide](https://xopcai.github.io/xopcbot/channels#feishu) |
| Web UI | ✅ | Built-in, run `xopcbot gateway` |

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

---

## 🙏 Credits

- Inspired by [OpenClaw](https://github.com/openclaw/openclaw)
- LLM providers via [@mariozechner/pi-ai](https://github.com/badlogic/pi-mono)

---

<div align="center">
  <sub>Made with ❤️ by <a href="https://github.com/xopcai">xopcai</a></sub>
</div>
