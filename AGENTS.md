# AGENTS.md - xopcbot Development Guide

> This file guides AI assistants working on the xopcbot codebase.

---

## Table of Contents

- [Project Overview](#project-overview)
- [Quick Start](#quick-start)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Code Style Guidelines](#code-style-guidelines)
- [Key Patterns](#key-patterns)
- [Common Tasks](#common-tasks)
- [Configuration](#configuration)
- [Environment Variables](#environment-variables)
- [Testing](#testing)
- [Web UI](#web-ui)
- [Debugging](#debugging)
- [Troubleshooting](#troubleshooting)

---

## Project Overview

**xopcbot** is an ultra-lightweight personal AI assistant built with Node.js + TypeScript. It provides a CLI-based interface to LLMs with multi-channel support (Telegram, WhatsApp).

| Metric | Value |
|--------|-------|
| Codebase | ~6,000 lines of TypeScript |
| Test Coverage | 99+ unit tests |
| LLM Providers | 20+ via `@mariozechner/pi-ai` |
| Node.js | >= 22 |

---

## Quick Start

```bash
# 1. Install dependencies (use pnpm, NOT npm)
pnpm install

# 2. Run CLI commands directly (no build needed)
pnpm run dev -- <command>

# Examples:
pnpm run dev -- agent -i              # Interactive agent
pnpm run dev -- agent -m "Hello"      # Single message

# 3. Build for production
pnpm run build

# 4. Run tests
pnpm test
```

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js >=22 |
| Language | TypeScript 5.x |
| AI Framework | `@mariozechner/pi-agent-core` |
| CLI Framework | `commander` |
| Validation | `zod` (config), `@sinclair/typebox` (tools) |
| Testing | `vitest` |
| UI Components | `lit` (Web Components) |

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `@mariozechner/pi-agent-core` | Agent loop, tools, events |
| `@mariozechner/pi-ai` | LLM providers, streaming |
| `@sinclair/typebox` | JSON Schema generation |
| `commander` | CLI framework |
| `zod` | Config validation |
| `lit` | Web component library |

---

## Project Structure

```
src/
├── agent/              # Core agent logic (pi-agent-core based)
│   ├── service.ts      #   Main AgentService class
│   ├── memory/         #   Session persistence
│   └── tools/          #   Built-in tools (Typebox schemas)
├── bus/                # Event bus for message routing
├── channels/           # Channel integrations (Telegram, WhatsApp)
│   ├── telegram/       #   Telegram plugin architecture
│   │   ├── plugin.ts   #     Main plugin implementation
│   │   ├── client.ts   #     Bot client wrapper
│   │   ├── webhook.ts  #     Webhook server support
│   │   └── command-handler.ts  # Bot command handlers
│   ├── whatsapp/       #   WhatsApp plugin
│   ├── types.ts        #   Channel plugin interfaces
│   ├── manager.ts      #   Channel lifecycle manager
│   ├── access-control.ts     # Access control policies
│   ├── draft-stream.ts       # Streaming message preview
│   ├── format.ts             # Markdown to HTML formatter
│   └── update-offset-store.ts # Polling offset persistence
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
        ├── index.ts              # Main entry with XopcbotChat
        ├── gateway-chat.ts       # Gateway-connected chat component
        ├── components/           # UI components
        │   ├── MessageEditor.ts
        │   ├── MessageList.ts
        │   └── StreamingMessageContainer.ts
        ├── dialogs/              # Dialog components
        │   └── ConfigDialog.ts
        └── utils/                # Utilities
            ├── i18n.ts
            ├── format.ts
            └── attachment-utils.ts
```

---

## Code Style Guidelines

### Comments

- **All comments must be in English**
- **Keep comments minimal** - only for:
  - Complex logic that isn't self-explanatory
  - Non-obvious business rules or edge cases
  - Public API documentation (JSDoc for exported functions)
- **Avoid obvious comments** - don't state what the code already shows
- Prefer self-documenting code with clear variable/function names

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Variables, functions, methods | `camelCase` | `getUserById()` |
| Classes, interfaces, types | `PascalCase` | `AgentService` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| Unused parameters | Prefix with `_` | `_unusedParam` |
| Private methods | Prefix with `_` | `_internalHelper()` |

### Import Organization

Order of imports (separate groups with blank lines):

```typescript
// 1. External dependencies
import { Type } from '@sinclair/typebox';
import { Command } from 'commander';

// 2. Internal absolute imports
import { AgentService } from './agent/index.js';
import { MessageBus } from './bus/index.js';

// 3. Relative imports (sibling files last)
import { register } from '../registry.js';
import { utils } from './utils.js';
```

### File Naming

| File Type | Pattern | Example |
|-----------|---------|---------|
| Source files | `camelCase.ts` | `agentService.ts` |
| Test files | `<name>.test.ts` | `filesystem.test.ts` |
| Type definitions | `<name>.types.ts` | `config.types.ts` |
| Index exports | `index.ts` | `index.ts` |

---

## Key Patterns

### 1. Command Self-Registration

Commands register themselves via side-effect imports:

```typescript
// src/cli/commands/mycommand.ts
import { register } from '../registry.js';

function createCommand(ctx: CLIContext): Command {
  return new Command('mycommand')
    .description('My command')
    .action(async () => { 
      // Implementation
    });
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

### 4. Channel Plugin Usage (New)

Channels now use a plugin-based architecture inspired by openclaw:

```typescript
import { telegramPlugin } from './channels/index.js';
import { ChannelManager } from './channels/manager.js';

// Initialize plugin
await telegramPlugin.init({ bus, config, channelConfig });
await telegramPlugin.start();

// Send message
await telegramPlugin.send({
  chatId: '123456',
  content: 'Hello World',
  accountId: 'personal',
});

// Streaming message preview
const stream = telegramPlugin.startStream({ chatId: '123456' });
stream.update('Processing...');
stream.update('Still working...');
await stream.end();
```

### 5. Channel Access Control

Channels support hierarchical access control:

```typescript
// DM policies: 'pairing' | 'allowlist' | 'open' | 'disabled'
// Group policies: 'open' | 'disabled' | 'allowlist'

// Config example
{
  "channels": {
    "telegram": {
      "accounts": {
        "personal": {
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456, 789012]
        }
      }
    }
  }
}
```

---

## Common Tasks

### Adding a New CLI Command

1. Create `src/cli/commands/<name>.ts`
2. Use the [self-registration pattern](#1-command-self-registration)
3. Import it in `src/cli/index.ts`

### Adding a New Tool

1. Add to `src/agent/tools/<category>.ts`
2. Export from `src/agent/tools/index.ts`
3. Add to `AgentService` constructor

### Adding a New Provider

1. Update `src/config/schema.ts` - add to `ProvidersConfigSchema`
2. Update `src/providers/registry.ts` - add provider details
3. Update environment variable handling if needed

### Adding a New Channel Plugin

1. Create plugin directory: `src/channels/<name>/`
2. Implement `ChannelPlugin` interface from `src/channels/types.ts`
3. Add to `src/channels/index.ts` exports
4. Register in `ChannelManager` for lifecycle management

### Working with Channel Streaming

```typescript
import { DraftStreamManager } from './channels/draft-stream.js';

const manager = new DraftStreamManager(bot);
const stream = manager.getOrCreate('chat-123', { chatId: 123 });

// Update preview message
stream.update('Processing your request...');

// Finalize
await stream.flush();
```

### Package Management

⚠️ **Always use pnpm, NEVER npm.**

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

> ⚠️ **Never commit `package-lock.json`** - This project uses `pnpm-lock.yaml`.

---

## Configuration

**Config location:** `~/.xopcbot/config.json`

**Key sections:**

| Section | Description |
|---------|-------------|
| `providers` | LLM API keys |
| `agents.defaults` | Default model, tokens, temperature |
| `channels` | Telegram/WhatsApp settings |
| `gateway` | HTTP server settings |
| `cron` | Scheduled task settings |
| `plugins` | Plugin enable/disable configuration |

### Telegram Multi-Account Configuration

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "personal": {
          "name": "Personal Bot",
          "token": "BOT_TOKEN_1",
          "dmPolicy": "allowlist",
          "groupPolicy": "open",
          "allowFrom": [123456789],
          "streamMode": "partial"
        },
        "work": {
          "name": "Work Bot",
          "token": "BOT_TOKEN_2",
          "dmPolicy": "disabled",
          "groupPolicy": "allowlist",
          "groups": {
            "-1001234567890": {
              "requireMention": true,
              "systemPrompt": "You are a work assistant"
            }
          }
        }
      }
    }
  }
}
```

**Policies:**
- `dmPolicy`: `pairing` | `allowlist` | `open` | `disabled`
- `groupPolicy`: `open` | `disabled` | `allowlist`
- `streamMode`: `off` | `partial` | `block`

---

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `OPENAI_API_KEY` | OpenAI API authentication | Optional* |
| `ANTHROPIC_API_KEY` | Anthropic API authentication | Optional* |
| `BRAVE_API_KEY` | Brave Search API key | Optional |
| `TELEGRAM_BOT_TOKEN` | Telegram bot integration | Optional |
| `WHATSAPP_API_KEY` | WhatsApp integration | Optional |
| `XOPCBOT_CONFIG` | Custom config file path | Optional |
| `XOPCBOT_WORKSPACE` | Custom workspace directory | Optional |
| `XOPCBOT_LOG_LEVEL` | Log level (trace/debug/info/warn/error/fatal) | Optional |
| `XOPCBOT_LOG_DIR` | Log directory path | Optional |
| `XOPCBOT_LOG_CONSOLE` | Enable console output (true/false) | Optional |
| `XOPCBOT_LOG_FILE` | Enable file output (true/false) | Optional |
| `XOPCBOT_LOG_RETENTION_DAYS` | Days to retain log files | Optional |
| `XOPCBOT_PRETTY_LOGS` | Pretty print logs for development | Optional |

\* At least one LLM provider key is required

---

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm vitest run src/agent/tools/__tests__/filesystem.test.ts

# Watch mode
pnpm vitest --watch

# With coverage
pnpm vitest run --coverage
```

### Test Guidelines

- Tests live alongside source: `src/**/__tests__/*.test.ts`
- Use `vitest` APIs: `describe`, `it`, `expect`, `vi.mock`
- Mock filesystem operations with `vi.mock('fs')`

### Example Test Structure

```typescript
import { describe, it, expect, vi } from 'vitest';
import { myFunction } from '../myModule.js';

describe('myModule', () => {
  it('should do something', async () => {
    // Arrange
    const input = 'test';
    
    // Act
    const result = await myFunction(input);
    
    // Assert
    expect(result).toBe('expected');
  });
});
```

---

## Web UI

The `ui/` directory contains web-based UI components for xopcbot, inspired by [pi-mono/web-ui](https://github.com/mariozechner/pi-mono/tree/main/packages/web-ui) and [openclaw/ui](https://github.com/openclaw/openclaw/tree/main/ui).

### Building the UI

```bash
cd ui

# Install dependencies
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
      { 
        key: 'language', 
        label: 'Language', 
        type: 'select', 
        options: [
          { value: 'en', label: 'English' },
          { value: 'zh', label: '中文' },
        ]
      },
    ],
  },
];
config.onSave = (values) => console.log('Save:', values);
```

### Gateway Integration

WebSocket events between UI and Gateway:

| Event | Direction | Purpose |
|-------|-----------|---------|
| `chat.send` | UI → Gateway | Send user message |
| `chat.history` | UI → Gateway | Load chat history |
| `chat` | Gateway → UI | Chat updates (delta/final/error) |
| `config.get` | UI → Gateway | Load configuration |
| `config.set` | UI → Gateway | Save configuration |
| `logs.query` | UI → Gateway | Query log entries |
| `logs.files` | UI → Gateway | List log files |
| `logs.stats` | UI → Gateway | Get log statistics |
| `cron.jobs` | UI → Gateway | List cron jobs |
| `cron.create` | UI → Gateway | Create cron job |
| `cron.delete` | UI → Gateway | Delete cron job |
| `cron.toggle` | UI → Gateway | Enable/disable cron job |
| `cron.run` | UI → Gateway | Trigger cron job manually |

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

---

## Debugging

### Log Levels

Set via `XOPCBOT_LOG_LEVEL` environment variable:

| Level | Description |
|-------|-------------|
| `trace` | Development debugging only (function entry/exit) |
| `debug` | Verbose logging including internal details |
| `info` | General information (default) |
| `warn` | Warnings and non-critical issues |
| `error` | Failures with impact |
| `fatal` | System cannot continue |

### Contextual Logging

```typescript
import { createRequestLogger, clearRequestContext } from './utils/logger.js';

// Create request-scoped logger
const requestLogger = createRequestLogger('req-123', { userId: 'user-456' });
requestLogger.info('Processing request');  // Includes requestId automatically

// Clean up when done
clearRequestContext('req-123');
```

### Debug Commands

```bash
# Run with debug logging
XOPCBOT_LOG_LEVEL=debug pnpm run dev -- agent -i

# Check config
pnpm run dev -- config --show

# Validate config
pnpm run dev -- config --validate

# View logs via Log Manager UI
# Access: http://localhost:18790 → Log Manager tab
```

### Log Querying

```typescript
import { queryLogs, getLogStats } from './utils/log-store.js';

// Query by level and module
const errors = await queryLogs({
  levels: ['error', 'fatal'],
  module: 'AgentService',
  limit: 100,
});

// Get statistics
const stats = await getLogStats();
console.log(`Errors: ${stats.byLevel.error}`);
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `ERR_MODULE_NOT_FOUND` | Run `pnpm install` to ensure dependencies are installed |
| `Cannot find module '@xopcbot/...'` | Run `pnpm run build` to compile the project |
| Tests failing with timeout | Check if LLM API keys are set and valid |
| Config not loading | Verify `~/.xopcbot/config.json` syntax is valid JSON |
| UI not connecting | Check gateway is running and WebSocket URL is correct |
| `package-lock.json` conflicts | Remove it and run `pnpm install` |
| Telegram bot not responding | Check `TELEGRAM_BOT_TOKEN` and bot status with BotFather |
| Telegram @mention not working | Verify bot username is correct in group settings |
| Logs not appearing in UI | Check `XOPCBOT_LOG_LEVEL` and `XOPCBOT_LOG_FILE` settings |
| Log files growing too large | Enable rotation with `XOPCBOT_LOG_RETENTION_DAYS` |
| Cron jobs not triggering | Verify `cron.enabled: true` in config |
| Streaming preview not showing | Check `streamMode` setting in Telegram account config |

### Getting Help

1. Check existing tests for usage examples
2. Review similar implementations in the codebase
3. Verify environment variables are set correctly
4. Check logs via Log Manager UI for error details

---

## When Making Changes

| If you're changing... | Check these files |
|----------------------|-------------------|
| **Agent logic** | `src/agent/service.ts` |
| **Tools** | `src/agent/tools/` |
| **CLI commands** | `src/cli/commands/` |
| **Configuration** | `src/config/schema.ts` |
| **Tests** | `src/**/__tests__/` alongside source |
| **UI components** | `ui/src/components/` |
| **Providers** | `src/providers/registry.ts` |
| **Channel plugins** | `src/channels/` |
| **Logging system** | `src/utils/logger.ts`, `src/utils/log-store.ts` |
| **Log UI** | `ui/src/pages/LogManager.ts` |

---

_Last updated: 2026-02-21_
