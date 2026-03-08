# xopcbot Extension System

xopcbot provides a lightweight but powerful extension system.

## Features

- 🏗️ **Three-tier Storage Architecture** - Workspace / Global / Bundled
- 🔌 **Extension SDK** - Official SDK, unified import paths
- ⚡ **Native TypeScript** - Instant loading via jiti, no compilation needed
- 📦 **Multi-source Installation** - Support npm, local directory, Git repository

## Quick Start

### Install Extension

**Method One: Using CLI (recommended)**

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

**Method Two: Manual Installation**

```bash
# Global directory
cd ~/.xopcbot/extensions
git clone https://github.com/your/extension.git

# Or Workspace directory
cd workspace/.extensions
git clone https://github.com/your/extension.git
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

**Configuration format explanation:**

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `string[]` | List of extension IDs to enable |
| `disabled` | `string[]` | (Optional) List of extension IDs to disable |
| `[extension-id]` | `object \| boolean` | Extension-specific configuration |

**Example configuration:**

```json
{
  "extensions": {
    "enabled": ["telegram-channel", "weather-tool", "echo"],
    "disabled": ["deprecated-extension"],
    "telegram-channel": {
      "token": "bot-token-here",
      "webhookUrl": "https://example.com/webhook"
    },
    "weather-tool": {
      "apiKey": "weather-api-key",
      "defaultCity": "Beijing"
    },
    "echo": true
  }
}
```

- Extensions in `enabled` array will be loaded
- Extension ID as key can configure extension-specific options
- If extension doesn't need configuration, can set to `true`

### Create New Extension

```bash
# Create extension scaffold
xopcbot extension create my-extension --name "My Extension" --kind utility

# Supported kinds: channel|provider|memory|tool|utility
```

This will create:
- `package.json` - npm config
- `index.ts` - Extension entry (TypeScript, using xopcbot/extension-sdk)
- `xopcbot.extension.json` - Extension manifest
- `README.md` - Documentation template

---

## Three-tier Storage Architecture

xopcbot supports three-tier extension storage, from highest to lowest priority:

| Level | Path | Use Case | Priority |
|-------|------|----------|----------|
| **Workspace** | `workspace/.extensions/` | Project-private extensions | ⭐⭐⭐ Highest |
| **Global** | `~/.xopcbot/extensions/` | User-level shared extensions | ⭐⭐ Medium |
| **Bundled** | `xopcbot/extensions/` | Built-in extensions | ⭐ Lowest |

### Priority Rules

- **Workspace** extensions can override **Global** and **Bundled** extensions with the same name
- **Global** extensions can override **Bundled** extensions with the same name
- Use cases:
  - Workspace: Project-specific custom extensions
  Global: Commonly used shared extensions (like telegram-channel)
  - Bundled: Official extensions shipped with xopcbot

### Global Extension Directory

```bash
# Default location
~/.xopcbot/extensions/

# Custom location (environment variable)
export XOPCBOT_GLOBAL_EXTENSIONS=/path/to/global/extensions
```

---

## Extension SDK

xopcbot provides an official Extension SDK, exporting all types and interfaces needed for extension development.

### Using the SDK

```typescript
// Recommended: Use official SDK
import type { ExtensionApi, ExtensionDefinition } from 'xopcbot/extension-sdk';

// Not recommended to use internal paths
// import type { ... } from 'xopcbot/extensions';  ❌
```

### Exported Types

```typescript
// Core types
import type {
  ExtensionDefinition,      // Extension definition
  ExtensionApi,             // Extension API
  ExtensionLogger,          // Logger interface
} from 'xopcbot/extension-sdk';

// Tools
import type {
  ExtensionTool,            // Tool definition
  ExtensionToolContext,     // Tool context
} from 'xopcbot/extension-sdk';

// Hooks
import type {
  ExtensionHookEvent,       // Hook event type
  ExtensionHookHandler,     // Hook handler
  HookOptions,           // Hook options
} from 'xopcbot/extension-sdk';

// Channels
import type {
  ChannelExtension,         // Channel extension
  OutboundMessage,       // Outbound message
} from 'xopcbot/extension-sdk';

// Commands
import type {
  ExtensionCommand,         // Command definition
  CommandContext,        // Command context
  CommandResult,         // Command result
} from 'xopcbot/extension-sdk';

// Services
import type {
  ExtensionService,         // Service definition
  ServiceContext,        // Service context
} from 'xopcbot/extension-sdk';
```

### SDK Path Resolution

Under the hood, xopcbot uses jiti to configure path aliases:

```typescript
// jiti configuration
{
  alias: {
    'xopcbot/extension-sdk': './src/extension-sdk/index.ts'
  }
}
```

This means extension developers don't need to worry about xopcbot source code location - SDK paths are automatically resolved.
```

This will create:
- `package.json` - npm config
- `index.ts` - Extension entry (TypeScript, supports jiti instant loading)
- `xopcbot.extension.json` - Extension manifest
- `README.md` - Documentation template

## CLI Command Reference

### extension install

Install a extension.

```bash
# Install from npm
xopcbot extension install <package-name>

# Install specific version
xopcbot extension install my-extension@1.0.0

# Install from local directory
xopcbot extension install ./local-extension-dir
xopcbot extension install /absolute/path/to/extension

# Set timeout (default 120 seconds)
xopcbot extension install slow-extension --timeout 300000
```

**Installation flow**:
1. Download/copy extension files
2. Validate `xopcbot.extension.json` manifest
3. Install dependencies (if `package.json` has dependencies)
4. Copy to workspace `.extensions/` directory

### extension list

List all installed extensions.

```bash
xopcbot extension list
```

**Example output**:
```
📦 Installed Extensions

════════════════════════════════════════════════════════════

  📁 Telegram Channel
     ID: telegram-channel
     Version: 1.2.0
     Path: /home/user/.xopcbot/workspace/.extensions/telegram-channel

  📁 My Custom Extension
     ID: my-custom-extension
     Version: 0.1.0
     Path: /home/user/.xopcbot/workspace/.extensions/my-custom-extension
```

### extension remove / uninstall

Remove an installed extension.

```bash
xopcbot extension remove <extension-id>
xopcbot extension uninstall <extension-id>
```

**Note**: After removing a extension, if it was enabled, you also need to delete it from the configuration file.

### extension info

View extension details.

```bash
xopcbot extension info <extension-id>
```

### extension create

Create new extension scaffold.

```bash
xopcbot extension create <extension-id> [options]

Options:
  --name <name>           Extension display name
  --description <desc>    Extension description
  --kind <kind>          Extension type: channel|provider|memory|tool|utility
```

**Example**:
```bash
# Create a tool extension
xopcbot extension create weather-tool --name "Weather Tool" --kind tool

# Create a channel extension
xopcbot extension create discord-channel --name "Discord Channel" --kind channel
```

## Extension Structure

### Manifest File

Each extension must include a `xopcbot.extension.json` file:

```json
{
  "id": "my-extension",
  "name": "My Extension",
  "description": "A description of my extension",
  "version": "1.0.0",
  "main": "index.js",
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

```javascript
// index.js
import type { ExtensionApi } from 'xopcbot-extension-sdk';

const extension = {
  id: 'my-extension',
  name: 'My Extension',
  description: 'Description here',
  version: '1.0.0',

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

## Core Concepts

### Tools

Extensions can register custom tools for the Agent to use:

```javascript
api.registerTool({
  name: 'my_tool',
  description: 'Do something useful',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Input value' }
    },
    required: ['input']
  },
  async execute(params) {
    const input = params.input;
    // Perform operation
    return `Result: ${input}`;
  }
});
```

### Hooks

Hooks allow extensions to intercept and modify behavior at various lifecycle points:

| Hook | Timing | Use Case |
|------|--------|-----------|
| `before_agent_start` | Before Agent starts | Modify system prompt |
| `agent_end` | After Agent completes | Post-process results |
| `message_received` | When message received | Message pre-processing |
| `message_sending` | Before sending message | Intercept/modify message content |
| `message_sent` | After message sent | Send logging |
| `before_tool_call` | Before tool call | Parameter validation |
| `after_tool_call` | After tool call | Result processing |
| `session_start` | Session start | Initialization |
| `session_end` | Session end | Cleanup |
| `gateway_start` | Gateway starts | Configuration |
| `gateway_stop` | Gateway stops | Cleanup |

```javascript
// message_sending hook - intercept or modify AI sent messages
api.registerHook('message_sending', async (event, ctx) => {
  const { to, content } = event;

  // 1. Block message sending (e.g., content moderation)
  if (content.includes('sensitive info')) {
    return {
      cancel: true,
      cancelReason: 'Content contains sensitive information'
    };
  }

  // 2. Modify message content (e.g., add signature, replace content)
  if (content.includes('{{signature}}')) {
    return {
      content: content.replace('{{signature}}', '\n\n— Sent by AI Assistant')
    };
  }

  // 3. Block for specific chat
  if (to === 'blocked-chat-id') {
    return {
      cancel: true,
      cancelReason: 'This chat is blocked'
    };
  }
});

// before_tool_call hook - block or modify tool calls
api.registerHook('before_tool_call', async (event, ctx) => {
  const { toolName, params } = event;

  // Block dangerous operations
  if (toolName === 'delete_file' || toolName === 'execute_command') {
    return {
      block: true,
      blockReason: 'This operation is disabled for safety'
    };
  }

  // Modify parameters
  if (toolName === 'write_file' && params.path?.includes('/etc/')) {
    return {
      params: { ...params, path: params.path.replace('/etc/', '/safe/') }
    };
  }
});
```

### Commands

Register custom commands:

```javascript
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

```javascript
api.registerHttpRoute('/my-extension/status', async (req, res) => {
  res.json({ status: 'running', extension: 'my-extension' });
});
```

### Gateway Methods

```javascript
api.registerGatewayMethod('my-extension.status', async (params) => {
  return { status: 'running' };
});
```

### Background Services

```javascript
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

```javascript
const apiKey = api.extensionConfig.apiKey;
const maxResults = api.extensionConfig.maxResults || 10;
```

## Logging

```javascript
api.logger.debug('Detailed debug information');
api.logger.info('General information');
api.logger.warn('Warning message');
api.logger.error('Error message');
```

## Path Resolution

```javascript
// Resolve workspace path
const configPath = api.resolvePath('config.json');

// Resolve extension relative path
const dataPath = api.resolvePath('./data.json');
```

## Event System

```javascript
// Emit event
api.emit('my-event', { key: 'value' });

// Listen for event
api.on('other-event', (data) => {
  console.log('Received:', data);
});

// Remove listener
api.off('my-event', handler);
```

## Complete Example

```javascript
import type { ExtensionApi } from 'xopcbot-extension-sdk';

const extension = {
  id: 'example',
  name: 'Example Extension',
  description: 'A complete example extension',
  version: '1.0.0',
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

## Publishing Extensions

1. Create `xopcbot.extension.json` manifest
2. Create `index.js` entry file
3. Push to GitHub or publish to npm

```bash
# Publish to npm (public)
npm publish --access public

# If using scoped package name (recommended)
# package.json: { "name": "@yourname/xopcbot-extension-name" }
npm publish --access public
```

## Best Practices

1. **Error handling**: All async operations should use try/catch
2. **Logging**: Use the API's logging system instead of console
3. **Resource cleanup**: Release resources in `deactivate`
4. **Configuration validation**: Use JSON Schema to validate configuration
5. **Version management**: Follow semantic versioning

## Related Links

- [Extension Examples](examples/)
- [API Reference](./api.md)
- [Hooks Reference](./hooks.md)
