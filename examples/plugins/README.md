# xopcbot Plugin Examples

This directory contains example plugins demonstrating the xopcbot plugin system.

## Available Examples

### 1. Hello World (`hello/`)

A comprehensive example showing all plugin features:

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

### 2. Echo (`echo/`)

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

## Creating Your Own Plugin

Use the CLI to scaffold a new plugin:

```bash
xopcbot plugin create my-plugin --name "My Plugin" --kind utility
```

Or copy an example and modify:

```bash
cp -r examples/plugins/hello workspace/.plugins/my-plugin
cd workspace/.plugins/my-plugin
# Edit index.ts and xopcbot.plugin.json
```

## Plugin Development Tips

1. **Use TypeScript**: Examples use `.ts` files which are loaded via jiti
2. **Import from SDK**: Always use `import type { ... } from 'xopcbot/plugin-sdk'`
3. **Test Locally**: Install from local path before publishing
4. **Add Config Schema**: Define your plugin's configuration options

## More Information

See [Plugin Development Guide](../../docs/plugins.md) for complete documentation.
