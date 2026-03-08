# xopcbot Plugin Examples

This directory contains example plugins demonstrating the xopcbot plugin system.

## Available Examples

### Phase 3: Inter-Extension Communication (New!)

#### 6. Cross-Plugin Communication (`cross-plugin-comm/`)

Demonstrates **TypedEventBus** for inter-extension communication:

- **Type-safe Events**: `api.events.on()` and `api.events.emit()`
- **Request-Response Pattern**: `api.events.request()` and `api.events.onRequest()`
- **Wildcard Subscriptions**: `api.events.onWildcard('user:*')`
- **Automatic Cleanup**: Listeners removed when plugin unloads

**Installation:**
```bash
xopcbot plugin install ./examples/plugins/cross-plugin-comm
```

**Features:**
- Provides weather service via `weather:get` request
- Broadcasts weather updates via `weather:updated` events
- Other plugins can request data or subscribe to updates
- Demonstrates full Phase 3 capabilities

---

### Phase 2: Enhanced Tool System (New!)

#### 5. Progress Tracker (`progress-tracker/`)

Demonstrates the **Enhanced Tool System** with streaming and state persistence:

- **EnhancedTool Interface**: Tools with streaming updates (`onUpdate`)
- **State Persistence**: Save data to session via `details` field
- **Cancellation**: Support `AbortSignal` for long-running tasks
- **Lifecycle Hooks**: `tool_execution_start/update/end`

**Installation:**
```bash
xopcbot plugin install ./examples/plugins/progress-tracker
```

**Features:**
- `long_task` tool streams progress updates to the user
- Tool execution history tracking
- Cancellation support (type `/cancel` or similar)
- Demonstrates all Phase 2 capabilities

---

### Phase 1: Enhanced Hooks (New!)

#### 3. Context Injector (`context-injector/`)

Demonstrates the **context hook** - modify messages before sending to LLM:

- **Context Hook**: Inject system messages into LLM context
- **Input Hook**: Transform user input with shortcuts (!summarize, !status)
- **Turn Lifecycle**: Track conversation turns with start/end hooks
- **Configuration**: Customizable injected context and timestamps

**Installation:**
```bash
xopcbot plugin install ./examples/plugins/context-injector
```

**Configuration:**
```json
{
  "plugins": {
    "enabled": ["context-injector"],
    "context-injector": {
      "injectedContext": "Always respond in Chinese.",
      "enableTimestamp": true
    }
  }
}
```

**Features:**
- Every LLM request automatically includes your custom context
- Use `!summarize <text>` to auto-expand to full prompt
- Use `!status` for instant plugin status (no LLM call)
- Track turn statistics automatically

---

#### 4. Input Guard (`input-guard/`)

Demonstrates the **input hook** - intercept and process user input:

- **Content Moderation**: Block messages with forbidden words
- **Quick Commands**: Handle !ping, !help, !time without LLM
- **Input Transformation**: Auto-correct typos and normalize input
- **Statistics**: Track blocked, transformed, and handled messages

**Installation:**
```bash
xopcbot plugin install ./examples/plugins/input-guard
```

**Configuration:**
```json
{
  "plugins": {
    "enabled": ["input-guard"],
    "input-guard": {
      "blockedWords": ["spam", "scam", "inappropriate"],
      "enableQuickCommands": true,
      "logAllInput": false
    }
  }
}
```

**Quick Commands:**
- `!ping` - Check if bot is online
- `!help` - Show available commands
- `!time` - Show current time
- `!stats` - Show input guard statistics

---

### Basic Examples

#### 1. Hello World (`hello/`)

A comprehensive example showing all basic plugin features:

- **Tool Registration**: Custom `hello` tool with parameters
- **Command Registration**: `/hello` command
- **Hook Registration**: `before_tool_call` and `after_tool_call` hooks
- **HTTP Routes**: `/hello` endpoint
- **Gateway Methods**: `hello` method
- **Configuration**: Custom greeting and verbose options

**Installation:**
```bash
xopcbot plugin install ./examples/plugins/hello
```

**Usage:**
```
# Use the tool
/hello World

# Or configure in config.json
{
  "plugins": {
    "enabled": ["hello"],
    "hello": {
      "greeting": "Hi",
      "verbose": true
    }
  }
}
```

---

#### 2. Echo (`echo/`)

Demonstrates message processing and modification:

- **Tool Registration**: `echo` tool with text transformations
- **Message Hooks**: `message_sending` and `message_received`
- **Text Transformations**: Uppercase, reverse, prefix options

**Installation:**
```bash
xopcbot plugin install ./examples/plugins/echo
```

**Usage:**
```
# Echo with transformations
/echo Hello World uppercase=true

# Configure defaults
{
  "plugins": {
    "enabled": ["echo"],
    "echo": {
      "prefix": "[Bot]",
      "uppercase": false
    }
  }
}
```

---

## Phase 1 Enhancement Summary

The new enhanced hooks provide powerful capabilities:

| Hook | Capability | Example Use Case |
|------|-----------|------------------|
| `context` | Modify LLM messages | Add system context, filter history |
| `input` | Transform/intercept input | Content moderation, quick commands |
| `turn_start/end` | Track conversation turns | Analytics, rate limiting |

See the [Context Injector](#3-context-injector) and [Input Guard](#4-input-guard) examples for complete implementations.

---

## Creating Your Own Plugin

Use the CLI to scaffold a new plugin:

```bash
xopcbot plugin create my-plugin --name "My Plugin" --kind utility
```

Or copy an example and modify:

```bash
cp -r examples/plugins/context-injector workspace/.plugins/my-plugin
cd workspace/.plugins/my-plugin
# Edit index.ts and xopcbot.plugin.json
```

---

## Plugin Development Tips

1. **Use TypeScript**: Examples use `.ts` files which are loaded via jiti
2. **Import from SDK**: Always use `import type { ... } from 'xopcbot/plugin-sdk'`
3. **Test Locally**: Install from local path before publishing
4. **Add Config Schema**: Define your plugin's configuration options
5. **Handle Errors**: Wrap async operations in try/catch
6. **Use Logger**: Use `api.logger` instead of console

---

## More Information

See [Plugin Development Guide](../../docs/plugins.md) for complete documentation.
