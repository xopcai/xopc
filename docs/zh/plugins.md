# xopcbot 插件系统

xopcbot 提供了一个轻量级但功能强大的插件系统。

## 特性

- 🏗️ **三级存储架构** - Workspace / Global / Bundled
- 🔌 **Plugin SDK** - 官方 SDK，统一导入路径
- ⚡ **TypeScript 原生** - 通过 jiti 即时加载，无需编译
- 📦 **多源安装** - 支持 npm、本地目录、Git 仓库

## 快速开始

### 安装插件

**方式一：使用 CLI（推荐）**

```bash
# 从 npm 安装到 workspace
xopcbot plugin install xopcbot-plugin-hello

# 安装到 global（跨项目共享）
xopcbot plugin install xopcbot-plugin-hello --global

# 从本地目录安装
xopcbot plugin install ./my-local-plugin

# 查看已安装插件
xopcbot plugin list

# 移除插件
xopcbot plugin remove hello
```

**方式二：手动安装**

```bash
# Global 目录
cd ~/.xopcbot/plugins
git clone https://github.com/your/plugin.git

# 或 Workspace 目录
cd workspace/.plugins
git clone https://github.com/your/plugin.git
```

### 启用插件

在 `~/.xopcbot/config.json` 中配置：

```json
{
  "plugins": {
    "enabled": ["hello", "echo"],
    "hello": { "greeting": "Hi there!" },
    "echo": true
  }
}
```

**配置格式说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | `string[]` | 要启用的插件 ID 列表 |
| `disabled` | `string[]` | （可选）禁用的插件 ID 列表 |
| `[plugin-id]` | `object \| boolean` | 插件特定配置 |

**示例配置：**

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

- `enabled` 数组中的插件会被加载
- 插件 ID 作为 key 可以配置插件特定的选项
- 如果插件不需要配置，可以设为 `true`

### 创建新插件

```bash
# 创建插件脚手架
xopcbot plugin create my-plugin --name "My Plugin" --kind utility

# 支持的 kind: channel|provider|memory|tool|utility
```

这将创建：
- `package.json` - npm 配置
- `index.ts` - 插件入口（TypeScript，使用 xopcbot/plugin-sdk）
- `xopcbot.plugin.json` - 插件清单
- `README.md` - 文档模板

---

## 三级存储架构

xopcbot 支持三级插件存储，按优先级从高到低：

| 级别 | 路径 | 用途 | 优先级 |
|------|------|------|--------|
| **Workspace** | `workspace/.plugins/` | 项目私有插件 | ⭐⭐⭐ 最高 |
| **Global** | `~/.xopcbot/plugins/` | 用户级共享插件 | ⭐⭐ 中 |
| **Bundled** | `xopcbot/plugins/` | 内置插件 | ⭐ 最低 |

### 优先级规则

- **Workspace** 插件可以覆盖 **Global** 和 **Bundled** 同名插件
- **Global** 插件可以覆盖 **Bundled** 同名插件
- 适合场景：
  - Workspace：项目特定的定制插件
  - Global：常用的共享插件（如 telegram-channel）
  - Bundled：随 xopcbot 发布的官方插件

### Global 插件目录

```bash
# 默认位置
~/.xopcbot/plugins/

# 自定义位置（环境变量）
export XOPCBOT_GLOBAL_PLUGINS=/path/to/global/plugins
```

---

## Plugin SDK

xopcbot 提供官方 Plugin SDK，统一导出所有插件开发所需的类型和接口。

### 使用 SDK

```typescript
// 推荐方式：使用官方 SDK
import type { PluginApi, PluginDefinition } from 'xopcbot/plugin-sdk';

// 不推荐使用内部路径
// import type { ... } from 'xopcbot/plugins';  ❌
```

### 导出的类型

```typescript
// 核心类型
import type {
  PluginDefinition,      // 插件定义
  PluginApi,             // 插件 API
  PluginLogger,          // 日志接口
} from 'xopcbot/plugin-sdk';

// 工具
import type {
  PluginTool,            // 工具定义
  PluginToolContext,     // 工具上下文
} from 'xopcbot/plugin-sdk';

// 钩子
import type {
  PluginHookEvent,       // 钩子事件类型
  PluginHookHandler,     // 钩子处理器
  HookOptions,           // 钩子选项
} from 'xopcbot/plugin-sdk';

// 通道
import type {
  ChannelPlugin,         // 通道插件
  OutboundMessage,       // 出站消息
} from 'xopcbot/plugin-sdk';

// 命令
import type {
  PluginCommand,         // 命令定义
  CommandContext,        // 命令上下文
  CommandResult,         // 命令结果
} from 'xopcbot/plugin-sdk';

// 服务
import type {
  PluginService,         // 服务定义
  ServiceContext,        // 服务上下文
} from 'xopcbot/plugin-sdk';
```

### SDK 路径解析

在底层，xopcbot 使用 jiti 配置路径别名：

```typescript
// jiti 配置
{
  alias: {
    'xopcbot/plugin-sdk': './src/plugin-sdk/index.ts'
  }
}
```

这意味着插件开发时无需关心 xopcbot 源码位置，SDK 路径会自动解析。
```

这将创建：
- `package.json` - npm 配置
- `index.ts` - 插件入口（TypeScript，支持 jiti 即时加载）
- `xopcbot.plugin.json` - 插件清单
- `README.md` - 文档模板

## CLI 命令参考

### plugin install

安装插件。

```bash
# 从 npm 安装
xopcbot plugin install <package-name>

# 安装特定版本
xopcbot plugin install my-plugin@1.0.0

# 从本地目录安装
xopcbot plugin install ./local-plugin-dir
xopcbot plugin install /absolute/path/to/plugin

# 设置超时时间（默认 120 秒）
xopcbot plugin install slow-plugin --timeout 300000
```

**安装流程**：
1. 下载/复制插件文件
2. 验证 `xopcbot.plugin.json` 清单
3. 安装依赖（如有 `package.json` 依赖）
4. 复制到工作区 `.plugins/` 目录

### plugin list

列出所有已安装插件。

```bash
xopcbot plugin list
```

**输出示例**：
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

移除已安装插件。

```bash
xopcbot plugin remove <plugin-id>
xopcbot plugin uninstall <plugin-id>
```

**注意**：移除插件后，如果已启用，还需要从配置文件中删除。

### plugin info

查看插件详情。

```bash
xopcbot plugin info <plugin-id>
```

### plugin create

创建新插件脚手架。

```bash
xopcbot plugin create <plugin-id> [options]

Options:
  --name <name>           插件显示名称
  --description <desc>    插件描述
  --kind <kind>          插件类型: channel|provider|memory|tool|utility
```

**示例**：
```bash
# 创建一个工具类插件
xopcbot plugin create weather-tool --name "Weather Tool" --kind tool

# 创建一个通道类插件
xopcbot plugin create discord-channel --name "Discord Channel" --kind channel
```

## 插件结构

### Manifest 文件

每个插件必须包含一个 `xopcbot.plugin.json` 文件：

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

### 插件入口文件

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
    
    // 注册 HTTP 路由
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

## 核心概念

### 工具 (Tools)

插件可以注册自定义工具供 Agent 使用：

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

### 钩子 (Hooks)

钩子允许插件在各个生命周期点拦截和修改行为：

| 钩子 | 时机 | 用途 |
|------|------|------|
| `before_agent_start` | Agent 启动前 | 修改系统提示 |
| `agent_end` | Agent 完成后 | 后处理结果 |
| `message_received` | 收到消息时 | 消息预处理 |
| `message_sending` | 发送消息前 | 拦截/修改消息内容 |
| `message_sent` | 消息发送后 | 发送日志 |
| `before_tool_call` | 工具调用前 | 参数验证 |
| `after_tool_call` | 工具调用后 | 结果处理 |
| `session_start` | 会话开始 | 初始化 |
| `session_end` | 会话结束 | 清理 |
| `gateway_start` | 网关启动 | 配置 |
| `gateway_stop` | 网关关闭 | 清理 |

```javascript
// message_sending hook - intercept or modify AI sent messages
api.registerHook('message_sending', async (event, ctx) => {
  const { to, content } = event;

  // 1. Block message sending (e.g., content moderation)
  if (content.includes('敏感信息')) {
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

### 命令 (Commands)

注册自定义命令：

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

### HTTP 路由

```javascript
api.registerHttpRoute('/my-plugin/status', async (req, res) => {
  res.json({ status: 'running', plugin: 'my-plugin' });
});
```

### 网关方法

```javascript
api.registerGatewayMethod('my-plugin.status', async (params) => {
  return { status: 'running' };
});
```

### 后台服务

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

## 配置管理

### 定义配置模式

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

### 访问配置

```javascript
const apiKey = api.pluginConfig.apiKey;
const maxResults = api.pluginConfig.maxResults || 10;
```

## 日志记录

```javascript
api.logger.debug('Detailed debug information');
api.logger.info('General information');
api.logger.warn('Warning message');
api.logger.error('Error message');
```

## 路径解析

```javascript
// Resolve workspace path
const configPath = api.resolvePath('config.json');

// Resolve plugin relative path
const dataPath = api.resolvePath('./data.json');
```

## 事件系统

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

## 完整示例

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

## 发布插件

1. 创建 `xopcbot.plugin.json` manifest
2. 创建 `index.js` 入口文件
3. 推送到 GitHub 或发布到 npm

```bash
# 发布到 npm（公开发布）
npm publish --access public

# 如果使用 scoped 包名（推荐）
# package.json: { "name": "@yourname/xopcbot-plugin-name" }
npm publish --access public
```

## 最佳实践

1. **错误处理**：所有异步操作都应使用 try/catch
2. **日志记录**：使用 API 的日志系统而非 console
3. **资源清理**：在 `deactivate` 中释放资源
4. **配置验证**：使用 JSON Schema 验证配置
5. **版本管理**：遵循语义化版本

## 相关链接

- [插件示例](examples/)
- [API 参考](./api.md)
- [钩子参考](./hooks.md)
