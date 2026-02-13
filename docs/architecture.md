# Architecture Design

This document describes xopcbot's overall architecture and module relationships.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      xopcbot                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    CLI Layer                         │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │   │
│  │  │ onboard │ │ agent   │ │ gateway │ │ cron    │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                     Core                              │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │              AgentService                    │   │   │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐      │   │   │
│  │  │  │ Prompt  │ │ Memory  │ │ Skills  │      │   │   │
│  │  │  │ Builder │ │ Search  │ │         │      │   │   │
│  │  │  └─────────┘ └─────────┘ └─────────┘      │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Providers                          │   │
│  │            @mariozechner/pi-ai (20+ providers)       │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
  ┌──────────┐        ┌──────────┐        ┌──────────┐
  │Telegram │        │  Cron    │        │ Gateway  │
  │ Channel │        │ Scheduler │        │   API    │
  └──────────┘        └──────────┘        └──────────┘
```

## Core Modules

### Agent Service (`src/agent/service.ts`)

AgentService is the core orchestrator responsible for:

1. **Message Processing** - Receive user messages, call LLM, handle tool calls
2. **Prompt Building** - Build system prompt from SOUL.md/USER.md/AGENTS.md/TOOLS.md
3. **Memory Management** - Session message storage and context compression
4. **Tool Execution** - Unified execution of built-in tools + plugin tools
5. **Plugin Integration** - Load plugin tools and hooks

### Prompt Builder (`src/agent/prompt/`)

Modular prompt building system:

```
src/agent/prompt/
├── index.ts         # PromptBuilder - main builder
│                    # buildIdentitySection, buildMemorySection, etc.
├── modes.ts         # Prompt modes (full/minimal/none)
├── memory/
│   └── index.ts     # memory_search, memory_get tools
│                    # Semantic search of MEMORY.md and memory/*.md
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

| Tool | File | Description |
|------|------|-------------|
| `read_file` | read.ts | Read file content |
| `write_file` | write.ts | Create/overwrite file |
| `edit_file` | edit.ts | Precise file editing |
| `list_dir` | list-dir.ts | List directory contents |
| `shell` | shell.ts | Execute shell commands |
| `grep` | grep.ts | Text search |
| `find` | find.ts | File search |
| `web_search` | web.ts | Web search |
| `web_fetch` | web.ts | Web scraping |
| `send_message` | communication.ts | Send messages |
| `memory_search` | memory-tool.ts | Search memory files |
| `memory_get` | memory-tool.ts | Read memory snippets |

### Session Memory (`src/agent/memory/`)

```
src/agent/memory/
├── store.ts       # MemoryStore - session message storage
└── compaction.ts  # SessionCompactor - context compression
                  # Supports extractive/abstractive/structured modes
```

### Plugin System (`src/plugins/`)

```
src/plugins/
├── types.ts       # Plugin type definitions
├── api.ts         # Plugin API
├── loader.ts      # Plugin loader
├── hooks.ts       # Hook system
└── index.ts      # Exports
```

**Hook Lifecycle**:

```
before_agent_start → agent_end → message_received → 
before_tool_call → after_tool_call → message_sending → session_end
```

## Data Flow

### Conversation Flow

```
User (Telegram/Gateway)
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
│  │ Execute Tools │  │ ← Tools (filesystem, shell, web, memory...)
│  │ + Plugins     │  │
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

## CLI Command Registration Pattern

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
  name: 'mycommand',
  description: 'My command',
  factory: createMyCommand,
  metadata: { category: 'utility' },
});
```

## Extension Points

### Adding New Tools

1. Create new file in `src/agent/tools/`
2. Implement `AgentTool` interface
3. Export and register in `src/agent/tools/index.ts`
4. Add to tools array in `AgentService`

### Adding Hooks

```typescript
api.registerHook('before_tool_call', async (event, ctx) => {
  // Intercept tool calls
  return { modified: true };
});
```

### Adding Plugins

1. Create `xopcbot.plugin.json` manifest
2. Implement `register(api)` function
3. Publish or load locally

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 22+ |
| Language | TypeScript 5.x |
| LLM SDK | @mariozechner/pi-ai |
| CLI | Commander.js |
| Telegram | node-telegram-bot-api |
| Validation | Zod + TypeBox |
| Logging | Pino |
| Cron | node-cron |
| HTTP Server | Hono |
