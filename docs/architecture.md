# Architecture Design

This document describes xopcbot's overall architecture and module relationships.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      xopcbot                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    CLI Layer                         │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │   │
│  │  │ setup   │ │ onboard │ │ agent   │ │ gateway │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                     Core                             │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │              AgentService                    │   │   │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐       │   │   │
│  │  │  │ Prompt  │ │ Memory  │ │ Skills  │       │   │   │
│  │  │  │ Builder │ │ Search  │ │         │       │   │   │
│  │  │  └─────────┘ └─────────┘ └─────────┘       │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Providers                          │   │
│  │            @mariozechner/pi-ai (20+ providers)      │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
  ┌──────────┐        ┌──────────┐        ┌──────────┐
  │ Telegram │        │   Cron   │        │ Gateway  │
  │ Channel  │        │ Scheduler│        │   API    │
  └──────────┘        └──────────┘        └──────────┘
```

## Project Structure

```
src/
├── agent/              # Core agent logic (pi-agent-core based)
│   ├── service.ts      #   Main AgentService class
│   ├── memory/         #   Session persistence & compaction
│   ├── prompt/         #   Prompt builder system
│   ├── tools/          #   Built-in tools (Typebox schemas)
│   └── progress.ts     #   Progress feedback system
├── infra/
│   └── bus/            # Message bus primitives (queue, etc.)
├── channels/           # Channel integrations (ChannelPlugin + manager)
│   ├── plugin-types.ts #   ChannelPlugin interface & adapters
│   ├── manager.ts      #   Channel lifecycle manager
│   ├── plugins/
│   │   ├── bundled.ts  #   Built-in workspace plugins (Telegram)
│   │   ├── registry.ts #   Plugin registry / lookup
│   │   └── types.*.ts  #   Registry type helpers
│   ├── telegram/
│   │   └── index.ts    #   Re-exports from @xopcai/xopcbot-extension-telegram (compat)
│   ├── outbound/       #   Outbound delivery pipeline
│   ├── security.ts     #   Access control helpers
│   ├── draft-stream.ts #   Streaming message preview
│   └── format.ts       #   Markdown to HTML formatter
├── extensions/         # Extension runtime (loader, hooks); `sdk/` → @xopcai/xopcbot/extension-sdk
├── routing/            # Session keys, bindings, route resolution
├── acp/                # Agent Control Protocol (optional multi-runtime bridge)
├── cli/                # CLI commands with self-registration
│   ├── commands/       #   Individual command modules
│   ├── registry.ts     #   Command registration system
│   └── index.ts        #   CLI entry point
├── config/             # Configuration management (Zod schemas)
├── cron/               # Scheduled tasks
├── gateway/            # HTTP/WebSocket gateway server
├── heartbeat/          # Proactive monitoring
├── providers/          # LLM provider registry (pi-ai wrapper)
├── session/            # Conversation session management
├── types/              # Shared TypeScript types
└── utils/              # Shared utilities
    ├── logger.ts       #   Logging barrel → `logger/` (context, log-store, …)
    └── helpers.ts      #   Misc helpers

web/                    # Gateway console SPA (React + Vite + Tailwind v4)
└── src/                #   App source; production build → dist/gateway/static/root

extensions/
└── telegram/           # Workspace package: Telegram channel (@xopcai/xopcbot-extension-telegram)
```

## Core Modules

### Agent Service (`src/agent/service.ts`)

AgentService is the core orchestrator responsible for:

1. **Message Processing** - Receive user messages, call LLM, handle tool calls
2. **Prompt Building** - Build system prompt from SOUL.md/USER.md/AGENTS.md/TOOLS.md
3. **Memory Management** - Session message storage and context compression
4. **Tool Execution** - Unified execution of built-in tools + extension tools
5. **Progress Feedback** - Real-time updates for long-running tasks

### Prompt Builder (`src/agent/prompt/`)

Modular prompt building system:

```
src/agent/prompt/
├── index.ts         # PromptBuilder - main builder
├── modes.ts         # Prompt modes (full/minimal/none)
├── memory/
│   └── index.ts     # memory_search, memory_get tools
└── skills.ts        # Skills loading system
```

**Prompt Sections**:

| Section | Description |
|---------|-------------|
| Identity | "You are a personal assistant running in xopcbot" |
| Version | xopcbot version info |
| Tool Call Style | Tool calling style (verbose/brief/minimal) |
| Safety | Safety principles |
| Memory | memory_search/memory_get usage guide |
| Workspace | Working directory |
| Skills | Skills system |
| Messaging | Message sending |
| Heartbeats | Heartbeat monitoring |
| Runtime | Runtime info |

### Built-in Tools (`src/agent/tools/`)

| Tool | Name | Description |
|------|------|-------------|
| 📄 Read | `read_file` | Read file content (truncated to 50KB/500 lines) |
| ✍️ Write | `write_file` | Create or overwrite file |
| ✏️ Edit | `edit_file` | Replace text in file |
| 📂 List | `list_dir` | List directory contents |
| 💻 Shell | `shell` | Execute shell commands (5min timeout) |
| 🔍 Search | `grep` | Text search in files |
| 📄 Find | `find` | Find files by pattern |
| 🔍 Web Search | `web_search` | Web search via Brave Search |
| 📄 Web Fetch | `web_fetch` | Fetch web page content |
| 📤 Message | `send_message` | Send messages to channels |
| 🔍 Memory Search | `memory_search` | Search memory files |
| 📄 Memory Get | `memory_get` | Read memory snippets |

### Progress Feedback (`src/agent/progress.ts`)

Real-time progress tracking for long-running tasks:

```typescript
// Tool execution feedback
manager.onToolStart('read_file', { path: '/file.txt' });
// → Shows: 📖 读取中...

// Heartbeat for tasks > 30s
manager.onHeartbeat(elapsed, stage);
// → Shows: ⏱️ 已进行 45 秒
```

**Progress Stages**:

| Stage | Emoji | Trigger |
|-------|-------|---------|
| thinking | 🤔 | LLM reasoning |
| searching | 🔍 | web_search, grep |
| reading | 📖 | read_file |
| writing | ✍️ | write_file, edit_file |
| executing | ⚙️ | shell commands |
| analyzing | 📊 | Data analysis |

### Session Memory (`src/agent/memory/`)

```
src/agent/memory/
├── store.ts       # MemoryStore - session message storage
└── compaction.ts  # SessionCompactor - context compression
```

**Compaction Modes**:
- `extractive` - Summarize using key sentences
- `abstractive` - LLM-based summarization
- `structured` - Preserve structured data

### Channel plugins (`src/channels/`)

Channels are implemented as **`ChannelPlugin`** instances. The core **`ChannelManager`** loads plugins from `bundledChannelPlugins` in `src/channels/plugins/bundled.ts` (Telegram is provided by the workspace package `extensions/telegram`). Each plugin exposes `init` / `start` / outbound delivery and optional adapters (config, security, streaming, gateway, etc.).

**Features** (Telegram):
- Multi-account support
- Access control (allowlist, group policies)
- Streaming message preview
- Voice messages (STT/TTS)
- Document/file support

**Imports** (extension or core code):

```typescript
import { telegramPlugin } from '@xopcai/xopcbot-extension-telegram';
// Re-exported for stable paths: import { telegramPlugin } from './channels/telegram/index.js';
```

### Extension System (`src/extensions/`)

```
src/extensions/
├── types.ts       # Extension type definitions
├── api.ts         # Extension API
├── loader.ts      # Extension loader
├── hooks.ts       # Hook system
└── index.ts       # Exports
```

**Hook Lifecycle**:

```
before_agent_start → agent_end → message_received → 
before_tool_call → after_tool_call → message_sending → session_end
```

**Three-tier Storage**:
1. **Workspace** (`workspace/.extensions/`) - Project-private
2. **Global** (`~/.xopcbot/extensions/`) - User-level shared
3. **Bundled** (`xopcbot/extensions/`) - Built-in

## Data Flow

### Conversation Flow

```
User (Telegram/Gateway/CLI)
        │
        ▼
┌─────────────────────┐
│   Channel Handler   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   AgentService      │
│  ┌───────────────┐  │
│  │ Load Bootstrap │  │ ← SOUL.md, USER.md, TOOLS.md, AGENTS.md
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ Build Prompt  │  │ ← memory_search/memory_get
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ LLM (pi-ai)   │  │
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ Execute Tools │  │ ← Tools + Extensions
│  │ + Progress    │  │ ← Progress feedback
│  └───────┬───────┘  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Response          │
└──────────┬──────────┘
           │
           ▼
User Reply / Channel Response
```

## CLI Command Registration

xopcbot uses self-registration pattern:

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
  factory: createMyCommand,
  metadata: { category: 'utility' },
});
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 22+ |
| Language | TypeScript 5.x |
| LLM SDK | @mariozechner/pi-ai |
| Agent Framework | @mariozechner/pi-agent-core |
| CLI | Commander.js |
| Validation | Zod (config) + TypeBox (tools) |
| Logging | Pino |
| Cron | node-cron |
| HTTP Server | Hono |
| Web UI | React + Vite + Tailwind v4 (gateway console in `web/`) |
| Testing | Vitest |

## Extension Points

### Adding New Tools

1. Create `src/agent/tools/<name>.ts`
2. Implement `AgentTool` interface with Typebox schema
3. Export from `src/agent/tools/index.ts`
4. Add to tools array in `AgentService`

### Adding Hooks

```typescript
api.registerHook('before_tool_call', async (event, ctx) => {
  // Intercept tool calls
  return { modified: true };
});
```

### Adding channel plugins

1. Implement `ChannelPlugin` in a package or under `extensions/<name>/` (see `src/channels/plugin-types.ts` and `defineChannelPluginEntry` in `@xopcai/xopcbot/extension-sdk`).
2. Export the plugin object and add it to `bundledChannelPlugins` in `src/channels/plugins/bundled.ts` if it should ship with the core binary.
3. Ensure `ChannelManager` startup loads your plugin (bundled plugins are registered automatically when listed in `bundled.ts`).
