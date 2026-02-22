# xopcbot Plugin System

xopcbot provides a lightweight but powerful plugin system, inspired by [OpenClaw](https://github.com/openclaw/openclaw).

## Features

- 🏗️ **Three-tier Storage Architecture** - Workspace / Global / Bundled
- 🔌 **Plugin SDK** - Official SDK, unified import paths
- ⚡ **Native TypeScript** - Instant loading via jiti, no compilation needed
- 📦 **Multi-source Installation** - Support npm, local directory, Git repository

## Quick Start

### Install Plugin

**Method One: Using CLI (recommended)**

```bash
# Install from npm to workspace
xopcbot plugin install xopcbot-plugin-hello

# Install to global (shared across projects)
xopcbot plugin install xopcbot-plugin-hello --global

# Install from local directory
xopcbot plugin install ./my-local-plugin

# View installed plugins
xopcbot plugin list

# Remove plugin
xopcbot plugin remove hello
```

**Method Two: Manual Installation**

```bash
# Global directory
cd ~/.xopcbot/plugins
git clone https://github.com/your/plugin.git

# Or Workspace directory
cd workspace/.plugins
git clone https://github.com/your/plugin.git
```

### Enable Plugin

Configure in `~/.xopcbot/config.json`:

```json
{
  "plugins": {
    "enabled": ["hello", "echo"],
    "hello": { "greeting": "Hi there!" },
    "echo": true
  }
}
```

**Configuration format explanation:**

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | `string[]` | List of plugin IDs to enable |
| `disabled` | `string[]` | (Optional) List of plugin IDs to disable |
| `[plugin-id]` | `object \| boolean` | Plugin-specific configuration |

**Example configuration:**

```json
{
  "plugins": {
    "enabled": ["telegram-channel", "weather-tool", "echo"],
    "disabled": ["deprecated-plugin"],
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

- Plugins in `enabled` array will be loaded
- Plugin ID as key can configure plugin-specific options
- If plugin doesn't need configuration, can set to `true`

### Create New Plugin

```bash
# Create plugin scaffold
xopcbot plugin create my-plugin --name "My Plugin" --kind utility

# Supported kinds: channel|provider|memory|tool|utility
```

This will create:
- `package.json` - npm config
- `index.ts` - Plugin entry (TypeScript, using xopcbot/plugin-sdk)
- `xopcbot.plugin.json` - Plugin manifest
- `README.md` - Documentation template

---

## Three-tier Storage Architecture

xopcbot supports three-tier plugin storage, from highest to lowest priority:

| Level | Path | Use Case | Priority |
|-------|------|----------|----------|
| **Workspace** | `workspace/.plugins/` | Project-private plugins | ⭐⭐⭐ Highest |
| **Global** | `~/.xopcbot/plugins/` | User-level shared plugins | ⭐⭐ Medium |
| **Bundled** | `xopcbot/plugins/` | Built-in plugins | ⭐ Lowest |

### Priority Rules

- **Workspace** plugins can override **Global** and **Bundled** plugins with the same name
- **Global** plugins can override **Bundled** plugins with the same name
- Use cases:
  - Workspace: Project-specific custom plugins
  Global: Commonly used shared plugins (like telegram-channel)
  - Bundled: Official plugins shipped with xopcbot

### Global Plugin Directory

```bash
# Default location
~/.xopcbot/plugins/

# Custom location (environment variable)
export XOPCBOT_GLOBAL_PLUGINS=/path/to/global/plugins
```

---

## Plugin SDK

xopcbot provides an official Plugin SDK, exporting all types and interfaces needed for plugin development.

### Using the SDK

```typescript
// Recommended: Use official SDK
import type { PluginApi, PluginDefinition } from 'xopcbot/plugin-sdk';

// Not recommended to use internal paths
// import type { ... } from 'xopcbot/plugins';  ❌
```

### Exported Types

```typescript
// Core types
import type {
  PluginDefinition,      // Plugin definition
  PluginApi,             // Plugin API
  PluginLogger,          // Logger interface
} from 'xopcbot/plugin-sdk';

// Tools
import type {
  PluginTool,            // Tool definition
  PluginToolContext,     // Tool context
} from 'xopcbot/plugin-sdk';

// Hooks
import type {
  PluginHookEvent,       // Hook event type
  PluginHookHandler,     // Hook handler
  HookOptions,           // Hook options
} from 'xopcbot/plugin-sdk';

// Channels
import type {
  ChannelPlugin,         // Channel plugin
  OutboundMessage,       // Outbound message
} from 'xopcbot/plugin-sdk';

// Commands
import type {
  PluginCommand,         // Command definition
  CommandContext,        // Command context
  CommandResult,         // Command result
} from 'xopcbot/plugin-sdk';

// Services
import type {
  PluginService,         // Service definition
  ServiceContext,        // Service context
} from 'xopcbot/plugin-sdk';
```

### SDK Path Resolution

Under the hood, xopcbot uses jiti to configure path aliases:

```typescript
// jiti configuration
{
  alias: {
    'xopcbot/plugin-sdk': './src/plugin-sdk/index.ts'
  }
}
```

This means plugin developers don't need to worry about xopcbot source code location - SDK paths are automatically resolved.
```

This will create:
- `package.json` - npm config
- `index.ts` - Plugin entry (TypeScript, supports jiti instant loading)
- `xopcbot.plugin.json` - Plugin manifest
- `README.md` - Documentation template

## CLI Command Reference

### plugin install

Install a plugin.

```bash
# Install from npm
xopcbot plugin install <package-name>

# Install specific version
xopcbot plugin install my-plugin@1.0.0

# Install from local directory
xopcbot plugin install ./local-plugin-dir
xopcbot plugin install /absolute/path/to/plugin

# Set timeout (default 120 seconds)
xopcbot plugin install slow-plugin --timeout 300000
```

**Installation flow**:
1. Download/copy plugin files
2. Validate `xopcbot.plugin.json` manifest
3. Install dependencies (if `package.json` has dependencies)
4. Copy to workspace `.plugins/` directory

### plugin list

List all installed plugins.

```bash
xopcbot plugin list
```

**Example output**:
```
📦 Installed Plugins

════════════════════════════════════════════════════════════

  📁 Telegram Channel
     ID: telegram-channel
     Version: 1.2.0
     Path: /home/user/.xopcbot/workspace/.plugins/telegram-channel

  📁 My Custom Plugin
     ID: my-custom-plugin
     Version: 0.1.0
     Path: /home/user/.xopcbot/workspace/.plugins/my-custom-plugin
```

### plugin remove / uninstall

Remove an installed plugin.

```bash
xopcbot plugin remove <plugin-id>
xopcbot plugin uninstall <plugin-id>
```

**Note**: After removing a plugin, if it was enabled, you also need to delete it from the configuration file.

### plugin info

View plugin details.

```bash
xopcbot plugin info <plugin-id>
```

### plugin create

Create new plugin scaffold.

```bash
xopcbot plugin create <plugin-id> [options]

Options:
  --name <name>           Plugin display name
  --description <desc>    Plugin description
  --kind <kind>          Plugin type: channel|provider|memory|tool|utility
```

**Example**:
```bash
# Create a tool plugin
xopcbot plugin create weather-tool --name "Weather Tool" --kind tool

# Create a channel plugin
xopcbot plugin create discord-channel --name "Discord Channel" --kind channel
```

## Plugin Structure

### Manifest File

Each plugin must include a `xopcbot.plugin.json` file:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "A description of my plugin",
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

### Plugin Entry File

```javascript
// index.js
import type { PluginApi } from 'xopcbot-plugin-sdk';

const plugin = {
  id: 'my-plugin',
  name: 'My Plugin',
  description: 'Description here',
  version: '1.0.0',

  // Called when plugin is registered
  register(api: PluginApi) {
    // Register tool
    api.registerTool({...});
    
    // Register command
    api.registerCommand({...});
    
    // Register hook
    api.registerHook('message_received', async (event, ctx) => {...});
    
    // Register HTTP route
    api.registerHttpRoute('/my-route', async (req, res) => {...});
  },

  // Called when plugin is enabled
  activate(api: PluginApi) {
    console.log('Plugin activated');
  },

  // Called when plugin is disabled
  deactivate(api: PluginApi) {
    console.log('Plugin deactivated');
  },
};

export default plugin;
```

## Core Concepts

### Tools

Plugins can register custom tools for the Agent to use:

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

Hooks allow plugins to intercept and modify behavior at various lifecycle points:

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
  description: 'Check plugin status',
  acceptArgs: false,
  requireAuth: true,
  handler: async (args, ctx) => {
    return {
      content: 'Plugin is running!',
      success: true
    };
  }
});
```

### HTTP Routes

```javascript
api.registerHttpRoute('/my-plugin/status', async (req, res) => {
  res.json({ status: 'running', plugin: 'my-plugin' });
});
```

### Gateway Methods

```javascript
api.registerGatewayMethod('my-plugin.status', async (params) => {
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
const apiKey = api.pluginConfig.apiKey;
const maxResults = api.pluginConfig.maxResults || 10;
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

// Resolve plugin relative path
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
import type { PluginApi } from 'xopcbot-plugin-sdk';

const plugin = {
  id: 'example',
  name: 'Example Plugin',
  description: 'A complete example plugin',
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
    console.log('Plugin activated');
  },

  deactivate(api) {
    console.log('Plugin deactivated');
  }
};

export default plugin;
```

## Publishing Plugins

1. Create `xopcbot.plugin.json` manifest
2. Create `index.js` entry file
3. Push to GitHub or publish to npm

```bash
# Publish to npm (public)
npm publish --access public

# If using scoped package name (recommended)
# package.json: { "name": "@yourname/xopcbot-plugin-name" }
npm publish --access public
```

## Best Practices

1. **Error handling**: All async operations should use try/catch
2. **Logging**: Use the API's logging system instead of console
3. **Resource cleanup**: Release resources in `deactivate`
4. **Configuration validation**: Use JSON Schema to validate configuration
5. **Version management**: Follow semantic versioning

## Related Links

- [Plugin Examples](examples/)
- [API Reference](./api.md)
- [Hooks Reference](./hooks.md)
