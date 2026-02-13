# 🐈 xopcbot: Ultra-Lightweight Personal AI Assistant

<div align="center">
  <p>
    <strong>An ultra-lightweight, plugin-driven personal AI assistant built with Node.js and TypeScript.</strong>
  </p>
  <p>
    <a href="https://github.com/xopcai/xopcbot"><img src="https://img.shields.io/badge/xopcai-xopcbot-blue" alt="GitHub"></a>
    <a href="#"><img src="https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen" alt="Node"></a>
    <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.x-blue" alt="TypeScript"></a>
    <a href="#"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
  </p>
</div>

**xopcbot** provides the core functionality of a personal AI agent in a minimal footprint (~6,000 lines of TypeScript). It's designed to be simple, extensible, and easy to understand.

## ✨ Features

- **🤖 Unified LLM API**: Supports 20+ providers (OpenAI, Anthropic, Google, Groq, etc.) via `@mariozechner/pi-ai`.
- **🔌 Extensible Plugins**: Add custom tools, hooks, and commands with hot-reloading.
- **📱 Multi-Channel Support**: Interact via Telegram, with more channels planned.
- **🧠 Persistent Memory**: Maintains conversation history with automatic context compaction.
- **🔧 Rich Built-in Tools**: Filesystem access, shell execution, web search, and more.
- **⏰ Scheduled Tasks**: Automate actions with a cron-based scheduler.
- **🖥️ Powerful CLI**: Manage your agent, configuration, and plugins from the command line.

---

## 🚀 Getting Started

This guide will get you from zero to your first AI response in minutes.

### Prerequisites

- **Node.js**: Version 22.0.0 or higher.
- **npm** or **pnpm**: Package manager of your choice.

### 1. Installation

Clone the repository and install dependencies.

```bash
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot
npm install
# or: pnpm install
```

### 2. Configuration

Run the interactive setup command. This will create your configuration file at `~/.xopcbot/config.json` and prompt you to add an LLM provider API key.

```bash
npm run dev -- configure
# or: pnpm run dev -- configure
```

### 3. Chat!

You can now chat with your agent directly from the command line.

```bash
# Send a single message
npm run dev -- agent -m "Hello, world! What can you do?"

# Start an interactive session
npm run dev -- agent -i

# or use pnpm
pnpm run dev -- agent -m "Hello, world!"
```

---

## 📚 Learn More

For more detailed information, check out the full documentation:

- **[Getting Started Guide](docs/getting-started.md)**: A comprehensive walkthrough of setup and basic usage.
- **[Configuration](docs/configuration.md)**: Full reference for `config.json`.
- **[CLI Reference](docs/cli.md)**: Details on all available commands.
- **[Architecture](docs/architecture.md)**: A look under the hood.
- **[Plugin Development](docs/plugins.md)**: Learn how to build your own plugins.

## 🛠️ Development

- **Run Commands**: `npm run dev -- <command>` (or `pnpm run dev -- <command>`)
- **Type Check & Build**: `npm run build`
- **Run Tests**: `npm test`
- **Lint Code**: `npm run lint`

## 🙏 Credits

- Inspired by the architecture of [OpenClaw](https://github.com/openclaw/openclaw).
- LLM provider integration powered by [@mariozechner/pi-ai](https://github.com/badlogic/pi-mono).
