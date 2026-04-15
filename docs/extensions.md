# xopc Extension System

xopc provides a lightweight but powerful extension system for customizing and extending functionality.

## Features

- 🏗️ **Three-tier Storage** - Workspace / Global / Bundled
- 📋 **Manifest-first activation** - Discover and plan extension loads from `xopc.extension.json` before executing extension code; gateway and `xopc agent` use an activation plan (config, channels, model id, env vars declared in manifests)
- 🔌 **Extension SDK** - Official SDK with unified imports and optional **subpath** imports (`extension-sdk/core`, `extension-sdk/lazy`, …)
- ⚡ **Native TypeScript** - Instant loading via jiti, no compilation
- 📦 **Multi-source Installation** - npm, local directory, Git repository
- 🖥️ **Gateway console UI (optional)** — Extensions may declare a **`ui`** manifest and ship HTML panels for the React Web console; the host loads assets via HTTPS and embeds them in sandboxed iframes using **`@xopcai/extension-ui-sdk`** (see [Gateway console: Extension UI](#gateway-console-extension-ui-iframe)).

**Design reference (repository):** the internal RFC set under [`.docs/channel/`](../.docs/channel/00-overview.md) describes the full target architecture (aligned with ideas from OpenClaw). User-facing behavior is summarized below; Phase 3 items not yet in code are omitted. **Web UI extension** implementation notes live under [`.docs/ext/`](../.docs/ext/) (phased docs alongside `AGENTS.md`).

---

## Quick Start

### Install Extension

**Using CLI (recommended):**

```bash
# Install from npm to workspace
xopc extension install xopc-extension-hello

# Install to global (shared across projects)
xopc extension install xopc-extension-hello --global

# Install from local directory
xopc extension install ./my-local-extension

# View installed extensions
xopc extension list

# Remove extension
xopc extension remove hello
```

### Enable Extension

Configure in `~/.xopc/xopc.json`:

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

**Activation vs `enabled`:** The **gateway** and **`xopc agent`** resolve extensions with a **manifest-first activation plan**. You do **not** have to list every channel extension under `extensions.enabled` if activation is triggered elsewhere—for example, configuring **`channels.telegram`** / **`channels.weixin`** or setting an env var named in the extension manifest (e.g. `TELEGRAM_BOT_TOKEN` for the bundled Telegram extension). To **force-disable** an extension, add its id to **`extensions.disabled`**.

### Create New Extension

```bash
xopc extension create my-extension --name "My Extension" --kind utility
```

**Supported kinds:** `channel` | `provider` | `memory` | `tool` | `utility` | `tts` | `image-generation` | `web-search`

This creates:
- `package.json` - npm config
- `index.ts` - Extension entry (TypeScript)
- `xopc.extension.json` - Extension manifest
- `README.md` - Documentation template

---

## Three-tier Storage Architecture

xopc supports three-tier extension storage:

| Level | Path | Use Case | Priority |
|-------|------|----------|----------|
| **Workspace** | `workspace/.extensions/` | Project-private extensions | ⭐⭐⭐ Highest |
| **Global** | `~/.xopc/extensions/` | User-level shared extensions | ⭐⭐ Medium |
| **Bundled** | `xopc/extensions/` | Built-in extensions | ⭐ Lowest |

### Priority Rules

- **Workspace** extensions override **Global** and **Bundled** extensions with same name
- **Global** extensions override **Bundled** extensions with same name

**Use cases:**
- Workspace: Project-specific custom extensions
- Global: Commonly used shared extensions (like telegram-channel)
- Bundled: Official extensions shipped with xopc

**Monorepo note:** The Telegram channel is a **workspace package** under `extensions/telegram` (`@xopcai/xopc-extension-telegram`) and is wired into the core via `src/channels/plugins/bundled.ts`. It is not loaded from `xopc/extensions/` at runtime; that path refers to other bundled extension assets.

---

## Manifest-first control plane

xopc separates **reading manifests** (control plane) from **importing extension code** (runtime), following the RFC under `.docs/channel/`.

### Phases

| Phase | What happens | API / module |
|-------|----------------|--------------|
| **1 — Discovery + registry** | Scan extension directories and parse `xopc.extension.json` only (no `register()` yet) | `ExtensionLoader.buildManifestRegistry()`, `getManifestRegistry()` → `ManifestRegistry` |
| **2 — Activation planning** | Decide which extension ids should load, from merged **config + env + manifest metadata** | `ActivationPlanner` via `ExtensionLoader.planActivation()` |
| **3 — Runtime load** | Import entry module and run the extension | `ExtensionLoader.loadByActivationPlan()` (also still: `loadExtension`, `loadExtensions`, `loadAllExtensions`) |

### Activation decision order (high → low)

1. **`extensions.enabled` / `extensions.disabled`** in config (explicit allow/deny; enabled wins if both appear for the same id—avoid configuring both).
2. **Default agent model id** — if it matches `modelSupport.modelPrefixes` / `modelSupport.modelPatterns` on a manifest.
3. **Environment variables** — any name listed under `providerAuthEnvVars` or `channelEnvVars` on a manifest, if set in `process.env`.
4. **`autoEnableWhenConfiguredProviders`** — when `configuredProviderIds` derived from config includes a listed provider id.
5. **`activation.onProviders` / `activation.onChannels`** — when config-derived provider or channel ids match.
6. **`enabledByDefault: true`** on the manifest.

Loaded extension ids are sorted **lexicographically** for stable ordering.

### Where activation runs

| Entry | Behavior |
|-------|----------|
| **Gateway** | Calls `loadByActivationPlan()` when starting extensions (not limited to ids listed only in `extensions.enabled`). |
| **`xopc agent`** | Same: `loadByActivationPlan()` with current config. |
| **CLI (`registerExtensionCliCommands`)** | Skips loading entirely unless **at least one** of: non-empty `extensions.enabled`, configured channels that imply a channel extension, or an env var indexed by any discovered manifest—keeps plain CLI commands fast. |

### Optional manifest fields (`xopc.extension.json`)

All of these are **optional**; old manifests without them keep working.

| Field | Purpose |
|-------|---------|
| `enabledByDefault` | Auto-activate when no higher-priority rule applies |
| `providers`, `channels` | Declare ids this extension implements (indexed for lookup) |
| `providerAuthEnvVars`, `channelEnvVars` | Map logical id → env var names (for detection + onboarding) |
| `providerAuthChoices` | UI / CLI oriented auth metadata |
| `modelSupport` | `modelPrefixes`, `modelPatterns` for model-driven activation |
| `autoEnableWhenConfiguredProviders` | Provider ids that trigger activation when present in config |
| `activation` | `onProviders`, `onChannels`, `onCommands`, `onCapabilities` |
| `contracts`, `setup` | Declarative capability / setup hints |

### Onboarding helpers (advanced)

For tools or UI that need provider/channel lists **without** loading extension JS, the implementation exposes helpers over a `ManifestRegistry` (see `src/extensions/onboard-helpers.ts` in the repo): `listOnboardProviders`, `listOnboardChannels`, `resolveProviderForModel`.

---

## Extension SDK

The npm package name is **`@xopcai/xopc`**. Import the SDK through the published subpath:

```typescript
// Recommended: published package subpath
import type { ExtensionApi, ExtensionDefinition } from '@xopcai/xopc/extension-sdk';
```

When developing extensions against a local checkout, the loader resolves the alias `xopc/extension-sdk` to `src/extensions/sdk/index.ts` (jiti), including subpaths such as `xopc/extension-sdk/core` and `xopc/extension-sdk/lazy`.

### Exported Types

```typescript
// Core types
import type {
  ExtensionDefinition,      // Extension definition
  ExtensionApi,             // Extension API
  ExtensionLogger,          // Logger interface
} from '@xopcai/xopc/extension-sdk';

// Tools (re-exported from pi-agent-core)
import type {
  AgentTool,
  AgentToolResult,
} from '@xopcai/xopc/extension-sdk';

// Hooks
import type {
  ExtensionHookEvent,       // Hook event type
  ExtensionHookHandler,     // Hook handler
  HookOptions,              // Hook options
} from '@xopcai/xopc/extension-sdk';

// Channels (ChannelPlugin registry)
import type {
  ChannelPlugin,
  ChannelPluginInitOptions,
  ChannelPluginStartOptions,
} from '@xopcai/xopc/extension-sdk';

import {
  defineChannelPluginEntry,
  registerExtensionCliProgram,
} from '@xopcai/xopc/extension-sdk';

// Optional subpaths (smaller surface / tree-shaking), e.g.:
// import type { ExtensionApi } from '@xopcai/xopc/extension-sdk/core';
// import { lazyModule } from '@xopcai/xopc/extension-sdk/lazy';

// Commands
import type { ExtensionCommand } from '@xopcai/xopc/extension-sdk';

// Services
import type { ExtensionService } from '@xopcai/xopc/extension-sdk';
```

---

## Gateway console: Extension UI (iframe) {#gateway-console-extension-ui-iframe}

Extensions can ship a **Gateway Web console** front-end that runs **inside sandboxed iframes** in the React app (`web/`). This is **orthogonal** to the Node **[Extension SDK](#extension-sdk)** above: iframe code does **not** call `register()` on the gateway; it uses **`postMessage`**, wrapped by **`@xopcai/extension-ui-sdk`**.

### `manifest.ui` (optional)

| Field | Role |
|-------|------|
| `main` | Default panel entry (path relative to the extension package) |
| `icon` | Icon asset path |
| `permissions` | Strings gating SDK calls on the host (`theme`, `agent.send`, `agent.subscribe`, `storage`, …) |
| `contributions` | `pages`, `settingsPanels`, `chatWidgets`, `commands` — Apps routes, settings sidebar, chat widgets, and **⌘/Ctrl+K** command palette entries |

If `ui` is absent, the extension may still be a **backend-only** extension (tools, hooks, channels).

### Package: `@xopcai/extension-ui-sdk`

Import **`createExtensionClient()`** and use **`await client.whenReady()`** after the host sends the `init` message.

- **theme** — `getTheme()`, `onThemeChange`
- **agent** — `sendMessage` (JSON mode to the gateway), `onStreamEvent` (relies on **`GET /api/events`** SSE + host forwarding)
- **session** — `listSessions`, `navigateToSession`
- **config** / **storage** — backed by gateway REST (see below); storage is a JSON KV on disk per extension namespace
- **ui** — `showNotification`, `navigate`, `resize`, `closePanel`, **`onWidgetResult`** (tool/chat widget iframes receive tool output via the host `widget.data` event)
- **events** — `emit` / `on` use the `ext.*` namespace for **cross-extension** fan-out between iframes
- **onDispose**, **onDidChangeVisibility**

**Generated API docs (Markdown)** — from the repo root:

```bash
pnpm run docs:extension-sdk
```

Output directory: **`packages/extension-ui-sdk/docs/api/`**.

### Gateway REST (Bearer auth)

Same **`Authorization: Bearer <token>`** as the rest of the console API.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/extensions` | List discovered extensions and summarized `ui` |
| GET | `/api/extensions/:id` | Detail + full manifest |
| GET | `/api/extensions/:id/assets/*` | Serve static UI assets (HTML/JS/CSS/SVG); response includes a strict **Content-Security-Policy** |
| GET | `/api/extensions/:id/storage` | List storage keys |
| GET | `/api/extensions/:id/storage/:key` | Read `{ value }` |
| PUT | `/api/extensions/:id/storage/:key` | Body `{ value }` — write KV |
| DELETE | `/api/extensions/:id/storage/:key` | Remove key |
| GET | `/api/extensions/:id/config` | Read extension-scoped config object |
| PATCH | `/api/extensions/:id/config` | Merge JSON patch into that config |

**Persistence:** KV and config are stored as JSON under **`~/.xopc/extensions/<sanitized_namespace>/storage.json`**. Config uses a dedicated namespace **`__config__<extensionId>`**.

### Web shell behaviour

- **First-load permission prompt** — Before mounting an iframe, the shell may show a dialog listing **`ui.permissions`**; approval is stored under **`localStorage`** key **`xopc.extensionUiGrants.v1`** (keyed by extension id + permission-set fingerprint).
- **iframe `sandbox`** — Typically `allow-scripts allow-forms allow-popups` **without** `allow-same-origin` for stronger isolation (host communication uses `postMessage`, not same-origin cookie access).
- **Agent stream** — Webchat runs emit **`agent.stream`** on the gateway event bus; clients subscribed to **`GET /api/events`** receive them; the shell forwards matching chunks to iframes that subscribed via **`agent.subscribe`** for that **`sessionKey`**.
- **Command palette** — **⌘K / Ctrl+K** (or `open-command-palette` on `window`) lists **`contributions.commands`**; commands with **`opensPanel`** navigate to **`/apps/{extensionId}`**.
- **Debug** — **Settings → Extensions → Extension debug** lists gateway extensions and the raw **UI grants** JSON.

### Sample: `extensions/hello`

The bundled **Hello** extension demonstrates the SDK end-to-end. UI bundles are produced with **esbuild**:

```bash
pnpm run build:hello-ui
```

Rebuild after upgrading **`@xopcai/extension-ui-sdk`**. Sources: `extensions/hello/ui/*-entry.ts`, output: `ui/*.bundle.js` referenced from the HTML entrypoints.

---

## Extension Structure

### Manifest File

Each extension must include `xopc.extension.json`. Minimal example:

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

Channel / provider extensions can add the **optional** declaration fields described in [Manifest-first control plane](#manifest-first-control-plane) (see bundled `extensions/telegram/xopc.extension.json` and `extensions/custom-provider/xopc.extension.json` in the repo).

### Extension Entry File

```typescript
import type { ExtensionApi } from '@xopcai/xopc/extension-sdk';

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
import type { ExtensionApi } from '@xopcai/xopc/extension-sdk';

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

1. Create `xopc.extension.json` manifest
2. Create `index.ts` entry file
3. Push to GitHub or publish to npm

```bash
# Publish to npm (public)
npm publish --access public

# If using scoped package name (recommended)
# package.json: { "name": "@yourname/xopc-extension-name" }
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
xopc extension install <package-name>

# Install specific version
xopc extension install my-extension@1.0.0

# Install from local directory
xopc extension install ./local-extension-dir

# Set timeout (default 120 seconds)
xopc extension install slow-extension --timeout 300000
```

### extension list

```bash
xopc extension list
```

### extension remove / uninstall

```bash
xopc extension remove <extension-id>
xopc extension uninstall <extension-id>
```

### extension info

```bash
xopc extension info <extension-id>
```

### extension create

```bash
xopc extension create <extension-id> [options]

Options:
  --name <name>           Extension display name
  --description <desc>    Extension description
  --kind <kind>          Extension type: channel|provider|memory|tool|utility
```

---

## Troubleshooting

### Extension Not Loading

1. Check **`extensions.disabled`** does not include the extension id
2. For gateway / agent: confirm an **activation trigger** applies (`extensions.enabled`, matching `channels.*`, env vars declared in the manifest, model prefix, `enabledByDefault`, etc.)
3. For **CLI-only** commands: remember extension code may be skipped unless `extensions.enabled` is non-empty, channels are configured, or a manifest-indexed env var is set
4. Verify `xopc.extension.json` is valid JSON and the extension is discoverable under workspace / global / bundled paths
5. Check logs for loading errors

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
    "allow": ["hello", "echo", "xopc-feishu"],
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

By default, xopc performs security checks on extensions:
- Path safety (no symlink escape)
- Ownership validation
- Hardlink detection
- Provenance tracking

Set `allowPromptInjection: true` to allow extensions to modify system prompts via hook results.
