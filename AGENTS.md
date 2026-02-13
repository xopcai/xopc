# AGENTS.md - xopcbot Development Guide

_This file guides AI assistants working on the xopcbot codebase._

## Project Overview

**xopcbot** is an ultra-lightweight personal AI assistant built with Node.js + TypeScript. It provides a CLI-based interface to LLMs with multi-channel support (Telegram, WhatsApp).

### Key Stats
- ~6,000 lines of TypeScript
- 99+ unit tests
- 20+ LLM providers via `@mariozechner/pi-ai`

## Code Style Guidelines

### Comments
- **All comments must be in English** when used
- **Keep comments minimal** - only add when necessary:
  - Complex logic that isn't self-explanatory
  - Non-obvious business rules or edge cases
  - Public API documentation (JSDoc for exported functions)
- **Avoid obvious comments** - don't state what the code already shows
- Prefer self-documenting code with clear variable/function names

### Naming Conventions
- `camelCase` for variables, functions, methods
- `PascalCase` for classes, interfaces, types
- `UPPER_SNAKE_CASE` for constants
- Prefix unused params with underscore: `_unusedParam`

### Import Organization
1. External dependencies
2. Internal absolute imports
3. Relative imports (sibling files last)

## Architecture

```
src/
├── agent/              # Core agent logic (pi-agent-core based)
│   ├── service.ts      #   Main AgentService class
│   ├── memory/          #   Session persistence
│   └── tools/          #   Built-in tools (Typebox schemas)
├── bus/                # Event bus for message routing
├── channels/           # Telegram & WhatsApp integrations
├── cli/                # CLI commands with self-registration
├── config/             # Configuration management
├── cron/               # Scheduled tasks
├── gateway/            # HTTP/WebSocket gateway server
├── heartbeat/          # Proactive monitoring
├── providers/          # LLM provider registry
├── session/            # Conversation session management
├── types/              # Shared TypeScript types
└── ui/                 # Web UI components (Lit-based)
    └── src/
        ├── index.ts            #   Main entry with XopcbotChat
        ├── gateway-chat.ts    #   Gateway-connected chat component
        ├── components/        #   UI components
        │   ├── MessageEditor.ts
        │   ├── MessageList.ts
        │   └── StreamingMessageContainer.ts
        ├── dialogs/           #   Dialog components
        │   └── ConfigDialog.ts
        └── utils/             #   Utilities
            ├── i18n.ts
            ├── format.ts
            └── attachment-utils.ts
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

### Package Manager

**Use pnpm, NOT npm.**

```bash
# Install dependencies
pnpm install

# Add new dependency
pnpm add <package>

# Add dev dependency
pnpm add -D <package>

# Remove dependency
pnpm remove <package>

# Update lockfile
pnpm install --frozen-lockfile
```

⚠️ **Never commit `package-lock.json`** - This project uses `pnpm-lock.yaml`.

### Running Locally

```bash
# Install dependencies
pnpm install

# Run CLI command (no build needed)
pnpm run dev -- <command>

# Example: Interactive agent
pnpm run dev -- agent -i

# Example: Single message
pnpm run dev -- agent -m "Hello"
```

### Building

```bash
# Type check and compile
pnpm run build

# Output goes to dist/
```

### Testing

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm vitest run src/agent/tools/__tests__/filesystem.test.ts

# Watch mode
pnpm vitest --watch
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
| `lit` | Web component library for UI |

## Web UI (ui/)

The `ui/` directory contains web-based UI components for xopcbot, inspired by [pi-mono/web-ui](https://github.com/mariozechner/pi-mono/tree/main/packages/web-ui) and [openclaw/ui](https://github.com/openclaw/openclaw/tree/main/ui).

### Building the UI

```bash
# Install UI dependencies
cd ui
pnpm install

# Development mode with hot reload
pnpm run dev

# Build for production
pnpm run build
```

### UI Components

#### XopcbotChat
Main chat component that wraps an Agent instance:

```typescript
import { XopcbotChat } from '@xopcbot/web-ui';
import { Agent } from '@mariozechner/pi-agent-core';

const agent = new Agent({ /* config */ });
const chat = document.querySelector('xopcbot-chat') as XopcbotChat;
chat.agent = agent;
```

#### XopcbotGatewayChat
WebSocket-connected chat component for remote gateway access:

```typescript
import { XopcbotGatewayChat } from '@xopcbot/web-ui';

const chat = document.querySelector('xopcbot-gateway-chat') as XopcbotGatewayChat;
chat.config = {
  url: 'ws://localhost:3000/ws',
  token: 'optional-auth-token',
};
```

#### XopcbotConfig
Configuration dialog component:

```typescript
import { XopcbotConfig } from '@xopcbot/web-ui';

const config = document.querySelector('xopcbot-config') as XopcbotConfig;
config.sections = [
  {
    id: 'general',
    title: 'General',
    fields: [
      { key: 'language', label: 'Language', type: 'select', options: [
        { value: 'en', label: 'English' },
        { value: 'zh', label: '中文' },
      ]},
    ],
  },
];
config.onSave = (values) => console.log('Save:', values);
```

### Integration with Gateway

The UI connects to the gateway via WebSocket events:

| Event | Direction | Purpose |
|-------|-----------|---------|
| `chat.send` | UI → Gateway | Send user message |
| `chat.history` | UI → Gateway | Load chat history |
| `chat` | Gateway → UI | Chat updates (delta/final/error) |
| `config.get` | UI → Gateway | Load configuration |
| `config.set` | UI → Gateway | Save configuration |

### Styling

UI components use CSS variables for theming:

```css
:root {
  --background: #ffffff;
  --foreground: #0f172a;
  --muted: #f1f5f9;
  --muted-foreground: #64748b;
  --primary: #3b82f6;
  --primary-foreground: #ffffff;
  --border: #e2e8f0;
  --radius: 0.5rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0f172a;
    --foreground: #f8fafc;
    --muted: #1e293b;
    --muted-foreground: #94a3b8;
    --border: #334155;
  }
}
```

## When Making Changes

- **Agent logic** → Check `src/agent/service.ts`
- **Tools** → Update `src/agent/tools/`
- **CLI** → Add to `src/cli/commands/`
- **Config** → Update `src/config/schema.ts`
- **Tests** → Add to `__tests__/` alongside source

## Build & Deploy

```bash
# Full verification
pnpm run build && pnpm test

# The compiled output in dist/ is not committed to git
```

---

_Last updated: 2025-02-10_
