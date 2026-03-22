# xopcbot 扩展系统

xopcbot 提供了一个轻量级但功能强大的扩展系统。

## 特性

- 🏗️ **三级存储架构** - Workspace / Global / Bundled
- 🔌 **Extension SDK** - 官方 SDK，统一导入路径
- ⚡ **TypeScript 原生** - 通过 jiti 即时加载，无需编译
- 📦 **多源安装** - 支持 npm、本地目录、Git 仓库

## 快速开始

### 安装扩展

**方式一：使用 CLI（推荐）**

```bash
# 从 npm 安装到 workspace
xopcbot extension install xopcbot-extension-hello

# 安装到 global（跨项目共享）
xopcbot extension install xopcbot-extension-hello --global

# 从本地目录安装
xopcbot extension install ./my-local-extension

# 查看已安装扩展
xopcbot extension list

# 移除扩展
xopcbot extension remove hello
```

**方式二：手动安装**

```bash
# Global 目录
cd ~/.xopcbot/extensions
git clone https://github.com/your/extension.git

# 或 Workspace 目录
cd workspace/.extensions
git clone https://github.com/your/extension.git
```

### 启用扩展

在 `~/.xopcbot/config.json` 中配置：

```json
{
  "extensions": {
    "enabled": ["hello", "echo"],
    "hello": { "greeting": "Hi there!" },
    "echo": true
  }
}
```

**配置格式说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | `string[]` | 要启用的扩展 ID 列表 |
| `disabled` | `string[]` | （可选）禁用的扩展 ID 列表 |
| `[extension-id]` | `object \| boolean` | 扩展特定配置 |

**示例配置：**

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

- `enabled` 数组中的扩展会被加载
- 扩展 ID 作为 key 可以配置扩展特定的选项
- 如果扩展不需要配置，可以设为 `true`

### 创建新扩展

```bash
# 创建扩展脚手架
xopcbot extension create my-extension --name "My Extension" --kind utility

# 支持的 kind: channel|provider|memory|tool|utility
```

这将创建：
- `package.json` - npm 配置
- `index.ts` - 扩展入口（TypeScript，推荐使用 `@xopcai/xopcbot/extension-sdk`）
- `xopcbot.extension.json` - 扩展清单
- `README.md` - 文档模板

---

## 三级存储架构

xopcbot 支持三级扩展存储，按优先级从高到低：

| 级别 | 路径 | 用途 | 优先级 |
|------|------|------|--------|
| **Workspace** | `workspace/.extensions/` | 项目私有扩展 | ⭐⭐⭐ 最高 |
| **Global** | `~/.xopcbot/extensions/` | 用户级共享扩展 | ⭐⭐ 中 |
| **Bundled** | `xopcbot/extensions/` | 内置扩展 | ⭐ 最低 |

### 优先级规则

- **Workspace** 扩展可以覆盖 **Global** 和 **Bundled** 同名扩展
- **Global** 扩展可以覆盖 **Bundled** 同名扩展
- 适合场景：
  - Workspace：项目特定的定制扩展
  - Global：常用的共享扩展（如 telegram-channel）
  - Bundled：随 xopcbot 发布的官方扩展

**Monorepo 说明：** Telegram 通道是仓库内 **`extensions/telegram`** 工作区包（`@xopcai/xopcbot-extension-telegram`），由核心通过 `src/channels/plugins/bundled.ts` 接入；与上表中 **Bundled** 扩展目录 `xopcbot/extensions/` 不是同一条加载路径。

### Global 扩展目录

```bash
# 默认位置
~/.xopcbot/extensions/

# 自定义位置（环境变量）
export XOPCBOT_GLOBAL_EXTENSIONS=/path/to/global/extensions
```

---

## Extension SDK

xopcbot 提供官方 Extension SDK。发布包名为 **`@xopcai/xopcbot`**，请通过子路径 **`@xopcai/xopcbot/extension-sdk`** 导入。

### 使用 SDK

```typescript
// 推荐：与 npm 发布包一致
import type { ExtensionApi, ExtensionDefinition } from '@xopcai/xopcbot/extension-sdk';

// 不推荐直接依赖内部路径
// import type { ... } from 'xopcbot/extensions';  ❌
```

### 导出的类型

```typescript
// 核心类型
import type {
  ExtensionDefinition,      // 扩展定义
  ExtensionApi,             // 扩展 API
  ExtensionLogger,          // 日志接口
} from '@xopcai/xopcbot/extension-sdk';

// 工具（由 pi-agent-core 再导出）
import type {
  AgentTool,
  AgentToolResult,
} from '@xopcai/xopcbot/extension-sdk';

// 钩子
import type {
  ExtensionHookEvent,       // 钩子事件类型
  ExtensionHookHandler,     // 钩子处理器
  HookOptions,              // 钩子选项
} from '@xopcai/xopcbot/extension-sdk';

// 通道（ChannelPlugin）
import type {
  ChannelPlugin,
  ChannelPluginInitOptions,
  ChannelPluginStartOptions,
} from '@xopcai/xopcbot/extension-sdk';

import {
  defineChannelPluginEntry,
  registerExtensionCliProgram,
} from '@xopcai/xopcbot/extension-sdk';

// 命令
import type { ExtensionCommand } from '@xopcai/xopcbot/extension-sdk';

// 服务
import type { ExtensionService } from '@xopcai/xopcbot/extension-sdk';
```

### SDK 路径解析

在本地开发时，xopcbot 可通过 jiti 将别名 `xopcbot/extension-sdk` 解析到 `src/extension-sdk/index.ts`，便于不依赖发布包路径。使用已安装的 **`@xopcai/xopcbot`** 时，请优先使用 **`@xopcai/xopcbot/extension-sdk`**。

---

## CLI 命令参考

### extension install

安装扩展。

```bash
# 从 npm 安装
xopcbot extension install <package-name>

# 安装特定版本
xopcbot extension install my-extension@1.0.0

# 从本地目录安装
xopcbot extension install ./local-extension-dir
xopcbot extension install /absolute/path/to/extension

# 设置超时时间（默认 120 秒）
xopcbot extension install slow-extension --timeout 300000
```

**安装流程**：
1. 下载/复制扩展文件
2. 验证 `xopcbot.extension.json` 清单
3. 安装依赖（如有 `package.json` 依赖）
4. 复制到工作区 `.extensions/` 目录

### extension list

列出所有已安装扩展。

```bash
xopcbot extension list
```

**输出示例**：
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

移除已安装扩展。

```bash
xopcbot extension remove <extension-id>
xopcbot extension uninstall <extension-id>
```

**注意**：移除扩展后，如果已启用，还需要从配置文件中删除。

### extension info

查看扩展详情。

```bash
xopcbot extension info <extension-id>
```

### extension create

创建新扩展脚手架。

```bash
xopcbot extension create <extension-id> [options]

Options:
  --name <name>           扩展显示名称
  --description <desc>    扩展描述
  --kind <kind>          扩展类型: channel|provider|memory|tool|utility
```

**示例**：
```bash
# 创建一个工具类扩展
xopcbot extension create weather-tool --name "Weather Tool" --kind tool

# 创建一个通道类扩展
xopcbot extension create discord-channel --name "Discord Channel" --kind channel
```

## 扩展结构

### Manifest 文件

每个扩展必须包含一个 `xopcbot.extension.json` 文件：

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

### 扩展入口文件

```javascript
// index.js
import type { ExtensionApi } from '@xopcai/xopcbot/extension-sdk';

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
    
    // 注册 HTTP 路由
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

## 核心概念

### 工具 (Tools)

扩展可以注册自定义工具供 Agent 使用：

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

钩子允许扩展在各个生命周期点拦截和修改行为：

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

### HTTP 路由

```javascript
api.registerHttpRoute('/my-extension/status', async (req, res) => {
  res.json({ status: 'running', extension: 'my-extension' });
});
```

### 网关方法

```javascript
api.registerGatewayMethod('my-extension.status', async (params) => {
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
const apiKey = api.extensionConfig.apiKey;
const maxResults = api.extensionConfig.maxResults || 10;
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

// Resolve extension relative path
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
import type { ExtensionApi } from '@xopcai/xopcbot/extension-sdk';

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

## 发布扩展

1. 创建 `xopcbot.extension.json` manifest
2. 创建 `index.js` 入口文件
3. 推送到 GitHub 或发布到 npm

```bash
# 发布到 npm（公开发布）
npm publish --access public

# 如果使用 scoped 包名（推荐）
# package.json: { "name": "@yourname/xopcbot-extension-name" }
npm publish --access public
```

## 最佳实践

1. **错误处理**：所有异步操作都应使用 try/catch
2. **日志记录**：使用 API 的日志系统而非 console
3. **资源清理**：在 `deactivate` 中释放资源
4. **配置验证**：使用 JSON Schema 验证配置
5. **版本管理**：遵循语义化版本

## 相关链接

- [扩展示例](examples/)
- [API 参考](./api.md)
- [钩子参考](./hooks.md)

---

## 扩展配置

### 全局配置

`config.json` 中的 `extensions` 部分支持以下全局选项：

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

| 选项 | 类型 | 说明 |
|------|------|------|
| `enabled` | `Record<string, boolean>` | 启用/禁用特定扩展 |
| `allow` | `string[]` | 允许的扩展白名单 |
| `security.checkPermissions` | `boolean` | 启用路径安全检查 |
| `security.allowUntrusted` | `boolean` | 允许加载不在白名单中的扩展 |
| `security.trackProvenance` | `boolean` | 追踪扩展安装来源 |
| `security.allowPromptInjection` | `boolean` | 允许扩展注入 system prompt |
| `slots.memory` | `string` | 首选 memory 后端扩展 |
| `slots.tts` | `string` | 首选 TTS 提供商扩展 |
| `slots.imageGeneration` | `string` | 首选图像生成扩展 |
| `slots.webSearch` | `string` | 首选网页搜索扩展 |

### 扩展自定义配置

每个扩展都可以有自己的自定义配置。任何不在全局配置中的字段都会被视为扩展特定配置：

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

扩展可以通过 `api.extensionConfig` 访问其配置：

```typescript
// 在扩展的 register() 或 activate() 中
export function register(api: ExtensionApi) {
  const feishuConfig = api.extensionConfig as {
    appId: string;
    appSecret: string;
    verificationToken?: string;
  };
  
  console.log('飞书 App ID:', feishuConfig.appId);
}
```

### Slot 配置

Slot 确保独占能力只有一个活动实现。配置哪个扩展应该声明每个 slot：

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

当 slot 有首选插件时，其他请求该 slot 的扩展将被拒绝。

### 安全

默认情况下，xopcbot 对扩展执行安全检查：
- 路径安全（无 symlink 逃逸）
- 所有权验证
- Hardlink 检测
- 来源追踪

设置 `allowPromptInjection: true` 以允许扩展通过钩子结果修改 system prompt。
