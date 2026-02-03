# 🐈 xopcbot: Ultra-Lightweight Personal AI Assistant

<div align="center">
  <p>
    <a href="https://github.com/xopcai/xopcbot">![GitHub](https://img.shields.io/badge/xopcai-xopcbot-blue)</a>
    <a href="#">![Node](https://img.shields.io/node/v/22.x)</a>
    <a href="#">![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)</a>
    <a href="#">![License](https://img.shields.io/badge/License-MIT-green)</a>
  </p>
</div>

**xopcbot** is an ultra-lightweight personal AI assistant built with Node.js + TypeScript. A spiritual successor to [nanobot](https://github.com/HKUDS/nanobot), inspired by [OpenClaw](https://github.com/openclaw/openclaw).

✨ Delivers full agent functionality in ~3,000 lines of TypeScript.

## ✨ Features

| Feature | Description |
|---------|-------------|
| **🤖 Unified LLM API** | 20+ providers via `@mariozechner/pi-ai` (OpenAI, Anthropic, Google, Groq, MiniMax, etc.) |
| **🔧 Plugin System** | Extensible architecture with 13 lifecycle hooks |
| **📱 Multi-Channel** | Telegram and WhatsApp support |
| **⏰ Scheduled Tasks** | Cron-based message scheduling |
| **💓 Heartbeat** | Proactive wake-up and monitoring |
| **💬 Session Management** | Persistent conversations with context |
| **🔨 Built-in Tools** | Filesystem, shell, web search/fetch, and more |
| **🎣 Plugin Hooks** | Intercept and modify behavior at 13 lifecycle points |

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

## 📖 Documentation

| Topic | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | First-time setup guide |
| [Configuration](docs/configuration.md) | Complete config reference |
| [Models](docs/models.md) | LLM model setup for 20+ providers |
| [Channels](docs/channels.md) | Telegram & WhatsApp setup |
| [Tools](docs/tools.md) | Built-in tool reference |
| [Plugins](docs/plugins.md) | Plugin system guide |
| [Gateway API](docs/gateway.md) | REST API documentation |

## ⚙️ Configuration

Edit `~/.config/xopcbot/config.json`:

```json
{
  "providers": {
    "openai": { "api_key": "sk-..." },
    "anthropic": { "api_key": "sk-ant-..." }
  },
  "agents": {
    "defaults": {
      "model": "gpt-4o",
      "max_tokens": 4096,
      "temperature": 0.7
    }
  },
  "channels": {
    "telegram": { "enabled": true, "token": "..." }
  }
}
```

## 🛠️ CLI Commands

| Command | Description |
|---------|-------------|
| `onboard` | Initialize config and workspace |
| `agent -m "..."` | Single message to agent |
| `agent -i` | Interactive chat mode |
| `gateway --port <port>` | Start HTTP gateway |
| `cron list` | List scheduled tasks |
| `cron add --schedule "0 9 * * *" --message "..."` | Add task |
| `cron remove <id>` | Remove task |

## 🏗️ Architecture

```
xopcbot/
├── src/
│   ├── agent/          # 🧠 Core agent logic
│   │   ├── loop.ts     #   Agent loop (LLM ↔ tools)
│   │   ├── context.ts  #   Context builder
│   │   ├── memory.ts   #   Memory system
│   │   ├── skills.ts  #   Skill system
│   │   ├── subagent.ts #   Background tasks
│   │   └── tools/      #   Built-in tools (write, exec, web, etc.)
│   ├── bus/            # 🚌 Event bus
│   ├── channels/       # 📱 Chat channels (Telegram, WhatsApp)
│   ├── cli/            # 🖥️ CLI commands
│   ├── config/         # ⚙️ Configuration loader
│   ├── cron/           # ⏰ Scheduled tasks
│   ├── heartbeat/      # 💓 Proactive monitoring
│   ├── plugins/        # 🔌 Plugin system (hooks, services)
│   ├── providers/      # 🤖 LLM providers (pi-ai)
│   ├── session/        # 💬 Conversation sessions
│   └── types/          # 📝 TypeScript types
├── docs/               # 📚 Documentation
└── scripts/            # 🔧 Build scripts
```

## 🧩 Plugin System

xopcbot features a powerful plugin system inspired by OpenClaw:

```typescript
// Register tools
api.registerTool({
  name: 'my_tool',
  description: 'Do something',
  parameters: { ... },
  async execute(params) { return 'result'; }
});

// Register hooks (13 lifecycle points)
api.registerHook('message_received', async (event, ctx) => {
  console.log('Message:', event.content);
});

// Register commands
api.registerCommand({
  name: 'status',
  description: 'Check status',
  handler: async () => ({ content: 'Running!', success: true });
});
```

See [Plugins Guide](docs/plugins.md) for details.

## 🔌 Supported LLM Providers

| Provider | Example Models | Env Var |
|----------|----------------|---------|
| OpenAI | gpt-5.2, o3, gpt-4o | `OPENAI_API_KEY` |
| Anthropic | claude-sonnet-4-5, claude-opus-4-5 | `ANTHROPIC_API_KEY` |
| Google | gemini-2.5-pro, gemini-2.5-flash | `GOOGLE_API_KEY` |
| DeepSeek | deepseek-chat, deepseek-reasoner | - |
| MiniMax | minimax-m2.1 | `MINIMAX_API_KEY` |
| Qwen | qwen-plus, qwen3-235b-a22b | - |
| Kimi | kimi-k2.5, kimi-k2-thinking | - |
| Groq | llama-3.3-70b-versatile | `GROQ_API_KEY` |
| xAI | grok-4, grok-4-fast | `XAI_API_KEY` |
| GLM | glm-4.7 | - |
| + More | via pi-ai (20+ providers) | - |

See [Models Guide](docs/models.md) for full list.

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

## 📝 License

MIT License. See [LICENSE](LICENSE) for details.

## 🙏 Credits

- [nanobot](https://github.com/HKUDS/nanobot) - Original inspiration
- [OpenClaw](https://github.com/openclaw/openclaw) - Plugin architecture inspiration
- [@mariozechner/pi-ai](https://github.com/badlogic/pi-mono) - Unified LLM API
