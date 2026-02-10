# AGENTS.md - xopcbot Development Guide

_This file guides AI assistants working on the xopcbot codebase._

## Project Overview

**xopcbot** is an ultra-lightweight personal AI assistant built with Node.js + TypeScript. It provides a CLI-based interface to LLMs with multi-channel support (Telegram, WhatsApp).

### Key Stats
- ~6,000 lines of TypeScript
- 99+ unit tests
- 20+ LLM providers via `@mariozechner/pi-ai`

## Architecture

```
src/
├── agent/              # Core agent logic (pi-agent-core based)
│   ├── service.ts      #   Main AgentService class
│   ├── memory/         #   Session persistence
│   └── tools/          #   Built-in tools (Typebox schemas)
├── bus/                # Event bus for message routing
├── channels/           # Telegram & WhatsApp integrations
├── cli/                # CLI commands with self-registration
├── config/             # Configuration management
├── cron/               # Scheduled tasks
├── heartbeat/          # Proactive monitoring
├── providers/          # LLM provider registry
├── session/            # Conversation session management
└── types/              # Shared TypeScript types
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js >=22 |
| Language | TypeScript 5.x |
| AI Framework | `@mariozechner/pi-agent-core` |
| CLI | `commander` |
| Validation | `zod` (config), `@sinclair/typebox` (tools) |
| Testing | `vitest` |

## Development Workflow

### Running Locally

```bash
# Install dependencies
npm install

# Run CLI command (no build needed)
npm run dev -- <command>

# Example: Interactive agent
npm run dev -- agent -i

# Example: Single message
npm run dev -- agent -m "Hello"
```

### Building

```bash
# Type check and compile
npm run build

# Output goes to dist/
```

### Testing

```bash
# Run all tests
npm test

# Run specific test file
npx vitest run src/agent/tools/__tests__/filesystem.test.ts

# Watch mode
npx vitest --watch
```

## Key Patterns

### 1. Command Self-Registration

Commands register themselves via side-effect imports:

```typescript
// src/cli/commands/mycommand.ts
import { register } from '../registry.js';

function createCommand(ctx: CLIContext): Command {
  return new Command('mycommand')
    .description('My command')
    .action(async () => { ... });
}

register({
  id: 'mycommand',
  factory: createCommand,
  metadata: { category: 'utility' },
});
```

### 2. Tool Definition (pi-agent-core)

Tools use Typebox schemas:

```typescript
import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';

const MyToolSchema = Type.Object({
  param: Type.String({ description: 'Parameter description' }),
});

export const myTool: AgentTool<typeof MyToolSchema, {}> = {
  name: 'my_tool',
  description: 'What this tool does',
  parameters: MyToolSchema,
  label: '🔧 My Tool',

  async execute(toolCallId, params, signal, onUpdate) {
    // Return AgentToolResult
    return {
      content: [{ type: 'text', text: 'Result' }],
      details: {},
    };
  },
};
```

### 3. AgentService Usage

```typescript
import { AgentService } from './agent/index.js';
import { MessageBus } from './bus/index.js';

const bus = new MessageBus();
const agent = new AgentService(bus, {
  workspace: '/path/to/workspace',
  model: 'minimax/minimax-m2.1',
  braveApiKey: process.env.BRAVE_API_KEY,
});

// Start processing messages
await agent.start();
```

## Configuration

Config location: `~/.xopcbot/config.json`

Key sections:
- `providers` - LLM API keys
- `agents.defaults` - Default model, tokens, temperature
- `channels` - Telegram/WhatsApp settings
- `gateway` - HTTP server settings

## Common Tasks

### Adding a New CLI Command

1. Create `src/cli/commands/<name>.ts`
2. Use the self-registration pattern
3. Import it in `src/cli/index.ts`

### Adding a New Tool

1. Add to `src/agent/tools/<category>.ts`
2. Export from `src/agent/tools/index.ts`
3. Add to `AgentService` constructor

### Adding a New Provider

1. Update `src/config/schema.ts` - add to `ProvidersConfigSchema`
2. Update `src/providers/registry.ts` - add provider details
3. Update environment variable handling if needed

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI authentication |
| `ANTHROPIC_API_KEY` | Anthropic authentication |
| `XOPCBOT_CONFIG` | Custom config file path |
| `XOPCBOT_WORKSPACE` | Custom workspace directory |

## Testing Guidelines

- Tests live alongside source: `src/**/__tests__/*.test.ts`
- Use `vitest` APIs: `describe`, `it`, `expect`, `vi.mock`
- Mock filesystem operations with `vi.mock('fs')`

## Dependencies to Know

| Package | Purpose |
|---------|---------|
| `@mariozechner/pi-agent-core` | Agent loop, tools, events |
| `@mariozechner/pi-ai` | LLM providers, streaming |
| `@sinclair/typebox` | JSON Schema generation |
| `commander` | CLI framework |
| `zod` | Config validation |

## When Making Changes

- **Agent logic** → Check `src/agent/service.ts`
- **Tools** → Update `src/agent/tools/`
- **CLI** → Add to `src/cli/commands/`
- **Config** → Update `src/config/schema.ts`
- **Tests** → Add to `__tests__/` alongside source

## Build & Deploy

```bash
# Full verification
npm run build && npm test

# The compiled output in dist/ is not committed to git
```

---

_Last updated: 2025-02-10_
