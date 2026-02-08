# 🐈 xopcbot: Ultra-Lightweight Personal AI Assistant

<div align="center">
  <p>
    <a href="https://github.com/xopcai/xopcbot"><img src="https://img.shields.io/badge/xopcai-xopcbot-blue" alt="GitHub"></a>
    <a href="#"><img src="https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen" alt="Node"></a>
    <a href="#"><img src="https://img.shields.io/badge/TypeScript-5.x-blue" alt="TypeScript"></a>
    <a href="#"><img src="https://img.shields.io/badge/tests-99%20passing-success" alt="Tests"></a>
    <a href="#"><img src="https://img.shields.io/badge/License-MIT-green" alt="License"></a>
  </p>
</div>

**xopcbot** is an ultra-lightweight personal AI assistant built with Node.js + TypeScript. A spiritual successor to [nanobot](https://github.com/HKUDS/nanobot), inspired by [OpenClaw](https://github.com/openclaw/openclaw).

✨ Delivers full agent functionality in ~6,000 lines of TypeScript.

## ✨ Features

| Feature | Description |
|---------|-------------|
| **🤖 Unified LLM API** | 20+ providers via `@mariozechner/pi-ai` (OpenAI, Anthropic, Google, Groq, MiniMax, etc.) |
| **🔧 Command Registry** | Self-registering CLI commands with metadata support |
| **📱 Multi-Channel** | Telegram and WhatsApp support |
| **⏰ Scheduled Tasks** | Cron-based message scheduling |
| **💓 Heartbeat** | Proactive wake-up and monitoring |
| **💬 Session Management** | Persistent conversations with context |
| **🔨 Built-in Tools** | Filesystem, shell, web search/fetch, and more |
| **🧪 Test Coverage** | 99+ unit tests with Vitest |

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

## 🛠️ CLI Commands

| Command | Description |
|---------|-------------|
| `onboard` | Initialize config and workspace |
| `configure` | Interactive configuration wizard |
| `agent -m "..."` | Single message to agent |
| `agent -i` | Interactive chat mode |
| `gateway --port <port>` | Start HTTP gateway |
| `config get <path>` | Get config value (e.g., `agents.defaults.model`) |
| `config set <path> <value>` | Set config value |
| `config show` | Show full configuration |
| `models list` | List available models |
| `cron list` | List scheduled tasks |
| `cron add --schedule "0 9 * * *" --message "..."` | Add task |
| `cron remove <id>` | Remove task |

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
│   │   ├── loop.ts     #   Agent loop (LLM ↔ tools)
│   │   ├── tools/      #   Built-in tools (read, write, exec, web, etc.)
│   │   ├── skills.ts   #   Skill system
│   │   └── subagent.ts #   Background tasks
│   ├── bus/            # 🚌 Event bus
│   ├── channels/       # 📱 Chat channels (Telegram, WhatsApp)
│   ├── cli/            # 🖥️ CLI commands
│   │   ├── registry.ts #   Command registry (self-registration)
│   │   └── commands/   #   Individual commands
│   ├── config/         # ⚙️ Configuration loader
│   ├── cron/           # ⏰ Scheduled tasks
│   ├── heartbeat/      # 💓 Proactive monitoring
│   ├── plugins/        # 🔌 Plugin system
│   ├── providers/      # 🤖 LLM providers (pi-ai)
│   ├── session/        # 💬 Conversation sessions
│   └── types/          # 📝 TypeScript types
├── docs/               # 📚 Documentation
└── src/**/__tests__/   # 🧪 Unit tests (by module)
```

### Command Registry Pattern

xopcbot uses a self-registration pattern for CLI commands:

```typescript
// src/cli/commands/mycommand.ts
import { register } from '../registry.js';

function createMyCommand(ctx: CLIContext): Command {
  return new Command('mycommand')
    .description('My command')
    .action(async () => { ... });
}

register({
  id: 'mycommand',
  name: 'mycommand',
  description: 'My command',
  factory: createMyCommand,
  metadata: { category: 'utility' },
});
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test -- --coverage

# Run specific test file
npx vitest run src/config/__tests__/loader.test.ts
```

### Test Structure

Tests are organized alongside source files:

```
src/
├── __tests__/core.test.ts              # Integration tests
├── agent/tools/__tests__/              # Tool tests
├── cli/__tests__/                      # CLI tests
├── config/__tests__/                   # Config tests
├── cron/__tests__/                     # Cron tests
└── session/__tests__/                  # Session tests
```

**Current Coverage:** 99 tests across 8 test files

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
| [Models](docs/models.md) | LLM model setup for 20+ providers |
| [Channels](docs/channels.md) | Telegram & WhatsApp setup |
| [Tools](docs/tools.md) | Built-in tool reference |

## 📝 License

MIT License. See [LICENSE](LICENSE) for details.

## 🙏 Credits

- [nanobot](https://github.com/HKUDS/nanobot) - Original inspiration
- [OpenClaw](https://github.com/openclaw/openclaw) - Plugin architecture inspiration
- [@mariozechner/pi-ai](https://github.com/badlogic/pi-mono) - Unified LLM API
