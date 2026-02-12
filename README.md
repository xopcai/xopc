# 🐈 xopcbot: Ultra-Lightweight Personal AI Assistant

<div align="center">
  <p>
    <a href="https://github.com/xopcai/xopcbot"><img src="https://img.shields.io/badge/xopcai-xopcbot-blue" alt="GitHub"></a>
    <a href="#"><img src="https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen" alt="Node"></a>
    <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.x-blue" alt="TypeScript"></a>
    <a href="#"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
  </p>
</div>

**xopcbot** is an ultra-lightweight personal AI assistant built with Node.js + TypeScript. Inspired by [OpenClaw](https://github.com/openclaw/openclaw).

✨ Delivers full agent functionality in ~5,000 lines of TypeScript.

## ✨ Features

| Feature | Description |
|---------|-------------|
| **🤖 Unified LLM API** | 20+ providers via `@mariozechner/pi-ai` (OpenAI, Anthropic, Google, Groq, MiniMax, etc.) |
| **🔌 Plugin System** | TypeScript-first plugins with jiti hot-loading, hooks, tools, and custom commands |
| **📁 Memory System** | Semantic memory search via `memory_search` / `memory_get` tools |
| **🔧 Command Registry** | Self-registering CLI commands |
| **📱 Multi-Channel** | Telegram support |
| **⏰ Scheduled Tasks** | Cron-based task scheduling |
| **💓 Heartbeat** | Proactive wake-up and monitoring |
| **💬 Session Management** | Persistent conversations with context |
| **🧠 Built-in Tools** | Filesystem, shell, web search/fetch, grep, find, and more |

## 🚀 Quick Start

### 1. Install

```bash
git clone https://github.com/xopcai/xopcbot.git
cd xopcbot
npm install
```

### 2. Initialize

```bash
npm run dev -- onboard
```

Follow the prompts to configure your LLM provider.

### 3. Chat

```bash
# Single message
npm run dev -- agent -m "Hello, world!"

# Interactive mode
npm run dev -- agent -i
```

### 4. Start Gateway (with channels)

```bash
npm run dev -- gateway --port 18790
```

### 5. Install Plugins

```bash
# List installed plugins
npm run dev -- plugin list

# Install from npm
npm run dev -- plugin install xopcbot-plugin-telegram

# Or install from local directory
npm run dev -- plugin install ./my-custom-plugin

# Create your own plugin
npm run dev -- plugin create my-plugin --kind tool
```

Enable plugins in `~/.xopcbot/config.json`:

```json
{
  "plugins": {
    "enabled": ["my-plugin"]
  }
}
```

## 🛠️ CLI Commands

| Command | Description |
|---------|-------------|
| `onboard` | Initialize config and workspace |
| `configure` | Interactive configuration wizard |
| `agent -m "..."` | Single message to agent |
| `agent -i` | Interactive chat mode |
| `gateway --port <port>` | Start HTTP gateway |
| `config get <path>` | Get config value |
| `config set <path> <value>` | Set config value |
| `config show` | Show full configuration |
| `models list` | List available models |
| `cron list` | List scheduled tasks |
| `cron add --schedule "0 9 * * *" --message "..."` | Add task |
| `cron remove <id>` | Remove task |
| `plugin list` | List installed plugins |
| `plugin install <name>` | Install plugin from npm/local |
| `plugin remove <id>` | Remove a plugin |
| `plugin create <id>` | Create plugin scaffold |

## ⚙️ Configuration

Configuration is stored in `~/.xopcbot/config.json`:

```json
{
  "providers": {
    "openai": { "apiKey": "sk-..." },
    "anthropic": { "apiKey": "sk-ant-..." }
  },
  "agents": {
    "defaults": {
      "model": "anthropic/claude-sonnet-4-5",
      "maxTokens": 8192,
      "temperature": 0.7,
      "maxToolIterations": 20
    }
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN",
      "allowFrom": []
    }
  }
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `XOPCBOT_CONFIG` | Custom config file path |
| `XOPCBOT_WORKSPACE` | Custom workspace directory |

## 🏗️ Architecture

```
xopcbot/
├── src/
│   ├── agent/          # 🧠 Core agent logic
│   │   ├── service.ts  #   Agent service (main entry)
│   │   ├── prompt/     #   Prompt builder & memory system
│   │   │   ├── index.ts
│   │   │   ├── memory/  #   Memory search tools
│   │   │   ├── modes.ts #   Prompt modes
│   │   │   └── skills.ts #   Skills loading
│   │   ├── tools/      #   Built-in tools
│   │   │   ├── memory-tool.ts
│   │   │   ├── communication.ts
│   │   │   ├── filesystem.ts
│   │   │   ├── shell.ts
│   │   │   ├── web.ts
│   │   │   └── ...
│   │   └── memory/      #   Session memory store
│   ├── bus/            # 🚌 Event bus
│   ├── channels/        # 📱 Chat channels (Telegram)
│   ├── cli/            # 🖥️ CLI commands
│   ├── config/         # ⚙️ Configuration
│   ├── cron/           # ⏰ Scheduled tasks
│   ├── gateway/        # 🌐 HTTP gateway
│   ├── heartbeat/      # 💓 Proactive monitoring
│   ├── plugins/        # 🔌 Plugin system
│   ├── providers/      # 🤖 LLM providers (pi-ai)
│   └── types/          # 📝 TypeScript types
├── docs/               # 📚 Documentation
└── src/**/__tests__/   # 🧪 Unit tests
```

### Agent Architecture

```
src/agent/
├── service.ts          # AgentService - Main orchestration
├── prompt/
│   ├── index.ts       # PromptBuilder - Modular prompt construction
│   ├── memory/        # Memory search (memory_search, memory_get)
│   ├── modes.ts       # Prompt modes (full/minimal/none)
│   └── skills.ts      # Skills loading
├── tools/
│   ├── memory-tool.ts # Memory tools implementation
│   ├── communication.ts # Message sending
│   ├── filesystem.ts  # read/write/edit/list_dir
│   ├── shell.ts       # Shell execution
│   ├── web.ts         # web_search, web_fetch
│   ├── grep.ts        # grep, find tools
│   └── ...
└── memory/
    ├── store.ts       # Session memory store
    └── compaction.ts  # Context compaction
```

### Core Data Flow

```
User Message
     │
     ▼
┌─────────────────┐
│ Session Manager │ ← Load conversation history
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ AgentService    │
│  ┌───────────┐  │
│  │ Build     │  │ ← SOUL.md, USER.md, TOOLS.md, AGENTS.md
│  │ Prompt    │  │ ← memory_search/memory_get
│  └─────┬─────┘  │
│        ▼        │
│  ┌───────────┐  │
│  │ LLM Call  │  │ ← pi-ai (20+ providers)
│  └─────┬─────┘  │
│        ▼        │
│  ┌───────────┐  │
│  │ Execute   │  │ ← Tools (filesystem, shell, web, memory...)
│  │ Tools     │  │
│  └─────┬─────┘  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Response        │
└────────┬────────┘
         │
         ▼
User Reply
```

## 🔌 Supported LLM Providers

| Provider | Example Models | Env Var |
|----------|----------------|---------|
| OpenAI | gpt-4o, gpt-4o-mini | `OPENAI_API_KEY` |
| Anthropic | claude-sonnet-4-5, claude-opus-4-5 | `ANTHROPIC_API_KEY` |
| Google | gemini-2.5-pro, gemini-2.5-flash | `GOOGLE_API_KEY` |
| DeepSeek | deepseek-chat, deepseek-reasoner | - |
| MiniMax | minimax-m2.1 | `MINIMAX_API_KEY` |
| Qwen | qwen-plus, qwen3-235b-a22b | - |
| Kimi | kimi-k2.5, kimi-k2-thinking | - |
| Groq | llama-3.3-70b-versatile | `GROQ_API_KEY` |
| xAI | grok-4, grok-4-fast | `XAI_API_KEY` |
| + More | via pi-ai (20+ providers) | - |

## 🛠️ Development

```bash
# Run without compilation (tsx)
npm run dev -- <command>

# Type check
npm run build

# Lint
npm run lint

# Test
npm run test
```

## 📖 Documentation

| Topic | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | First-time setup guide |
| [Configuration](docs/configuration.md) | Complete config reference |
| [CLI Reference](docs/cli.md) | All CLI commands |
| [Models](docs/models.md) | LLM model setup for 20+ providers |
| [Channels](docs/channels.md) | Telegram setup |
| [Plugins](docs/plugins.md) | Plugin development guide |
| [Tools](docs/tools.md) | Built-in tool reference |
| [Architecture](docs/architecture.md) | System architecture |
| [Cron](docs/cron.md) | Scheduled tasks |
| [Heartbeat](docs/heartbeat.md) | Proactive monitoring |
| [Skills](docs/skills.md) | Skills system |

## 📝 License

MIT License. See [LICENSE](LICENSE) for details.

## 🙏 Credits

- [OpenClaw](https://github.com/openclaw/openclaw) - Architecture inspiration
- [@mariozechner/pi-ai](https://github.com/badlogic/pi-mono) - Unified LLM API
