# xopcbot Extension System

xopcbot provides a lightweight but powerful extension system for customizing and extending functionality.

## Features

- 🏗️ **Three-tier Storage** - Workspace / Global / Bundled
- 🔌 **Extension SDK** - Official SDK with unified imports
- ⚡ **Native TypeScript** - Instant loading via jiti, no compilation
- 📦 **Multi-source Installation** - npm, local directory, Git repository

---

## Quick Start

### Install Extension

**Using CLI (recommended):**

```bash
# Install from npm to workspace
xopcbot extension install xopcbot-extension-hello

# Install to global (shared across projects)
xopcbot extension install xopcbot-extension-hello --global

# Install from local directory
xopcbot extension install ./my-local-extension

# View installed extensions
xopcbot extension list

# Remove extension
xopcbot extension remove hello
```

### Enable Extension

Configure in `~/.xopcbot/config.json`:

```json
{
  "extensions": {
    "enabled": ["hello", "echo"],
    "hello": { "greeting": "Hi there!" },
    "echo": true
  }
}
```

**Configuration format:**

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `string[]` | List of extension IDs to enable |
| `disabled` | `string[]` | (Optional) List of extension IDs to disable |
| `[extension-id]` | `object \| boolean` | Extension-specific configuration |

### Create New Extension

```bash
xopcbot extension create my-extension --name "My Extension" --kind utility
```

**Supported kinds:** `channel` | `provider` | `memory` | `tool` | `utility`

This creates:
- `package.json` - npm config
- `index.ts` - Extension entry (TypeScript)
- `xopcbot.extension.json` - Extension manifest
- `README.md` - Documentation template

---

## Three-tier Storage Architecture

xopcbot supports three-tier extension storage:

| Level | Path | Use Case | Priority |
|-------|------|----------|----------|
| **Workspace** | `workspace/.extensions/` | Project-private extensions | ⭐⭐⭐ Highest |
| **Global** | `~/.xopcbot/extensions/` | User-level shared extensions | ⭐⭐ Medium |
| **Bundled** | `xopcbot/extensions/` | Built-in extensions | ⭐ Lowest |

### Priority Rules

- **Workspace** extensions override **Global** and **Bundled** extensions with same name
- **Global** extensions override **Bundled** extensions with same name

**Use cases:**
- Workspace: Project-specific custom extensions
- Global: Commonly used shared extensions (like telegram-channel)
- Bundled: Official extensions shipped with xopcbot

**Monorepo note:** The Telegram channel is a **workspace package** under `extensions/telegram` (`@xopcai/xopcbot-extension-telegram`) and is wired into the core via `src/channels/plugins/bundled.ts`. It is not loaded from `xopcbot/extensions/` at runtime; that path refers to other bundled extension assets.

---

## Extension SDK

The npm package name is **`@xopcai/xopcbot`**. Import the SDK through the published subpath:

```typescript
// Recommended: published package subpath
import type { ExtensionApi, ExtensionDefinition } from '@xopcai/xopcbot/extension-sdk';
```

When developing extensions against a local checkout, the loader may still resolve the legacy alias `xopcbot/extension-sdk` to `src/extension-sdk/index.ts`.

### Exported Types

```typescript
// Core types
import type {
  ExtensionDefinition,      // Extension definition
  ExtensionApi,             // Extension API
  ExtensionLogger,          // Logger interface
} from '@xopcai/xopcbot/extension-sdk';

// Tools (re-exported from pi-agent-core)
import type {
  AgentTool,
  AgentToolResult,
} from '@xopcai/xopcbot/extension-sdk';

// Hooks
import type {
  ExtensionHookEvent,       // Hook event type
  ExtensionHookHandler,     // Hook handler
  HookOptions,              // Hook options
} from '@xopcai/xopcbot/extension-sdk';

// Channels (ChannelPlugin registry)
import type {
  ChannelPlugin,
  ChannelPluginInitOptions,
  ChannelPluginStartOptions,
} from '@xopcai/xopcbot/extension-sdk';

import {
  defineChannelPluginEntry,
  registerExtensionCliProgram,
} from '@xopcai/xopcbot/extension-sdk';

// Commands
import type { ExtensionCommand } from '@xopcai/xopcbot/extension-sdk';

// Services
import type { ExtensionService } from '@xopcai/xopcbot/extension-sdk';
```

---

## Extension Structure

### Manifest File

Each extension must include `xopcbot.extension.json`:

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "description": "A description of my extension",
  "version": "1.0.0",
  "main": "index.js",
  "kind": "utility",
  "configSchema": {
    "type": "object",
    "properties": {
      "option1": {
        "type": "string",
        "default": "value"
      }
    }
  }
}
```

### Extension Entry File

```typescript
import type { ExtensionApi } from '@xopcai/xopcbot/extension-sdk';

const extension = {
  id: 'my-extension',
  name: 'My Extension',
  description: 'Description here',
  version: '1.0.0',
  kind: 'utility',

  // Called when extension is registered
  register(api: ExtensionApi) {
    // Register tool
    api.registerTool({...});
    
    // Register command
    api.registerCommand({...});
    
    // Register hook
    api.registerHook('message_received', async (event, ctx) => {...});
    
    // Register HTTP route
    api.registerHttpRoute('/my-route', async (req, res) => {...});
  },

  // Called when extension is enabled
  activate(api: ExtensionApi) {
    console.log('Extension activated');
  },

  // Called when extension is disabled
  deactivate(api: ExtensionApi) {
    console.log('Extension deactivated');
  },
};

export default extension;
```

---

## Core Concepts

### Tools

Extensions can register custom tools:

```typescript
api.registerTool({
  name: 'my_tool',
  description: 'Do something useful',
  parameters: {
    type: 'object',
    properties: {
      input: { 
        type: 'string', 
        description: 'Input value' 
      }
    },
    required: ['input']
  },
  async execute(params, ctx) {
    const input = params.input;
    // Perform operation
    return `Result: ${input}`;
  }
});
```

### Hooks

Hooks intercept and modify behavior at lifecycle points:

| Hook | Timing | Use Case |
|------|--------|----------|
| `before_agent_start` | Before Agent starts | Modify system prompt |
| `agent_end` | After Agent completes | Post-process results |
| `message_received` | When message received | Message pre-processing |
| `message_sending` | Before sending message | Intercept/modify content |
| `message_sent` | After message sent | Send logging |
| `before_tool_call` | Before tool call | Parameter validation |
| `after_tool_call` | After tool call | Result processing |
| `session_start` | Session start | Initialization |
| `session_end` | Session end | Cleanup |

**Example - Block sensitive content:**

```typescript
api.registerHook('message_sending', async (event, ctx) => {
  const { content } = event;

  // Block sensitive information
  if (content.includes('sensitive info')) {
    return {
      cancel: true,
      cancelReason: 'Content contains sensitive information'
    };
  }

  // Add signature
  if (content.includes('{{signature}}')) {
    return {
      content: content.replace(
        '{{signature}}', 
        '\n\n— Sent by AI Assistant'
      )
    };
  }
});
```

**Example - Block dangerous tools:**

```typescript
api.registerHook('before_tool_call', async (event, ctx) => {
  const { toolName } = event;

  // Block dangerous operations
  if (toolName === 'delete_file' || toolName === 'execute_command') {
    return {
      block: true,
      blockReason: 'This operation is disabled for safety'
    };
  }
});
```

### Commands

Register custom CLI commands:

```typescript
api.registerCommand({
  name: 'status',
  description: 'Check extension status',
  acceptArgs: false,
  requireAuth: true,
  handler: async (args, ctx) => {
    return {
      content: 'Extension is running!',
      success: true
    };
  }
});
```

### HTTP Routes

```typescript
api.registerHttpRoute('/my-extension/status', async (req, res) => {
  res.json({ status: 'running', extension: 'my-extension' });
});
```

### Gateway Methods

```typescript
api.registerGatewayMethod('my-extension.status', async (params) => {
  return { status: 'running' };
});
```

### Background Services

```typescript
api.registerService({
  id: 'my-service',
  start(context) {
    // Start background task
    this.interval = setInterval(() => {
      // Scheduled task
    }, 60000);
  },
  stop(context) {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }
});
```

---

## Configuration Management

### Define Configuration Schema

```json
{
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": {
        "type": "string",
        "description": "API Key for the service"
      },
      "maxResults": {
        "type": "number",
        "default": 10
      }
    },
    "required": ["apiKey"]
  }
}
```

### Access Configuration

```typescript
const apiKey = api.extensionConfig.apiKey;
const maxResults = api.extensionConfig.maxResults || 10;
```

---

## Logging

```typescript
api.logger.debug('Detailed debug information');
api.logger.info('General information');
api.logger.warn('Warning message');
api.logger.error('Error message');
```

---

## Path Resolution

```typescript
// Resolve workspace path
const configPath = api.resolvePath('config.json');

// Resolve extension relative path
const dataPath = api.resolvePath('./data.json');
```

---

## Event System

```typescript
// Emit event
api.emit('my-event', { key: 'value' });

// Listen for event
api.on('other-event', (data) => {
  console.log('Received:', data);
});

// Remove listener
api.off('my-event', handler);
```

---

## Complete Example

```typescript
import type { ExtensionApi } from '@xopcai/xopcbot/extension-sdk';

const extension = {
  id: 'example',
  name: 'Example Extension',
  description: 'A complete example extension',
  version: '1.0.0',
  kind: 'utility',
  configSchema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true }
    }
  },

  register(api) {
    // Register tool
    api.registerTool({
      name: 'example_tool',
      description: 'Example tool',
      parameters: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input']
      },
      async execute(params) {
        return `Processed: ${params.input}`;
      }
    });

    // Register hook
    api.registerHook('message_received', async (event) => {
      console.log('Received:', event.content);
    });

    // Register command
    api.registerCommand({
      name: 'example',
      description: 'Example command',
      handler: async (args) => {
        return { content: 'Example!', success: true };
      }
    });
  },

  activate(api) {
    console.log('Extension activated');
  },

  deactivate(api) {
    console.log('Extension deactivated');
  }
};

export default extension;
```

---

## Publishing Extensions

1. Create `xopcbot.extension.json` manifest
2. Create `index.ts` entry file
3. Push to GitHub or publish to npm

```bash
# Publish to npm (public)
npm publish --access public

# If using scoped package name (recommended)
# package.json: { "name": "@yourname/xopcbot-extension-name" }
npm publish --access public
```

---

## Best Practices

1. **Error handling**: All async operations should use try/catch
2. **Logging**: Use the API's logging system instead of console
3. **Resource cleanup**: Release resources in `deactivate`
4. **Configuration validation**: Use JSON Schema to validate configuration
5. **Version management**: Follow semantic versioning
6. **TypeScript**: Use TypeScript for better type safety
7. **Minimal dependencies**: Keep extensions lightweight

---

## CLI Command Reference

### extension install

```bash
# Install from npm
xopcbot extension install <package-name>

# Install specific version
xopcbot extension install my-extension@1.0.0

# Install from local directory
xopcbot extension install ./local-extension-dir

# Set timeout (default 120 seconds)
xopcbot extension install slow-extension --timeout 300000
```

### extension list

```bash
xopcbot extension list
```

### extension remove / uninstall

```bash
xopcbot extension remove <extension-id>
xopcbot extension uninstall <extension-id>
```

### extension info

```bash
xopcbot extension info <extension-id>
```

### extension create

```bash
xopcbot extension create <extension-id> [options]

Options:
  --name <name>           Extension display name
  --description <desc>    Extension description
  --kind <kind>          Extension type: channel|provider|memory|tool|utility
```

---

## Troubleshooting

### Extension Not Loading

1. Check if extension is in `enabled` array
2. Verify `xopcbot.extension.json` manifest is valid
3. Check logs for loading errors

### Installation Failed

1. Check network connection
2. Verify package name is correct
3. Check timeout setting for slow installations

### Hook Not Triggering

1. Verify hook name is correct
2. Check if hook is registered in `register()` method
3. Check logs for hook registration errors

---

## Extension Configuration

### Global Configuration

The `extensions` section in `config.json` supports the following global options:

```json
{
  "extensions": {
    "enabled": {
      "hello": true,
      "echo": false
    },
    "allow": ["hello", "echo", "xopcbot-feishu"],
    "security": {
      "checkPermissions": true,
      "allowUntrusted": false,
      "trackProvenance": true,
      "allowPromptInjection": false
    },
    "slots": {
      "memory": "memory-lancedb",
      "tts": "elevenlabs"
    }
  }
}
```

| Option | Type | Description |
|--------|------|-------------|
| `enabled` | `Record<string, boolean>` | Enable/disable specific extensions |
| `allow` | `string[]` | Allowlist of permitted extensions |
| `security.checkPermissions` | `boolean` | Enable path safety checks |
| `security.allowUntrusted` | `boolean` | Allow loading extensions not in allowlist |
| `security.trackProvenance` | `boolean` | Track extension install source |
| `security.allowPromptInjection` | `boolean` | Allow extensions to inject system prompts |
| `slots.memory` | `string` | Preferred memory backend extension |
| `slots.tts` | `string` | Preferred TTS provider extension |
| `slots.imageGeneration` | `string` | Preferred image generation extension |
| `slots.webSearch` | `string` | Preferred web search extension |

### Extension-Specific Configuration

Each extension can have its own custom configuration. Any fields not in the global config are treated as extension-specific:

```json
{
  "extensions": {
    "feishu": {
      "appId": "cli_xxx",
      "appSecret": "yyy",
      "verificationToken": "zzz"
    },
    "memory-lancedb": {
      "vectorDim": 1536,
      "persistencePath": "~/data/memory"
    }
  }
}
```

The extension can access its config via `api.extensionConfig`:

```typescript
// In your extension's register() or activate()
export function register(api: ExtensionApi) {
  const feishuConfig = api.extensionConfig as {
    appId: string;
    appSecret: string;
    verificationToken?: string;
  };
  
  console.log('Feishu App ID:', feishuConfig.appId);
}
```

### Slot Configuration

Slots ensure exclusive capabilities have only one active implementation. Configure which extension should claim each slot:

```json
{
  "extensions": {
    "slots": {
      "memory": "my-memory-extension",
      "tts": "my-tts-extension"
    }
  }
}
```

When a slot has a preferred plugin, other extensions requesting that slot will be rejected.

### Security

By default, xopcbot performs security checks on extensions:
- Path safety (no symlink escape)
- Ownership validation
- Hardlink detection
- Provenance tracking

Set `allowPromptInjection: true` to allow extensions to modify system prompts via hook results.
