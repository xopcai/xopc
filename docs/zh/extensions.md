# xopc 扩展系统

xopc 提供了一个轻量级但功能强大的扩展系统。

## 特性

- **三级存储** — 仅工作区、用户全局目录、或与安装包一并提供的内置扩展（见下表）。
- **按配置激活** — 根据 `xopc.extension.json` 与当前 **配置 / 环境** 决定加载哪些扩展（见 [何时加载扩展](#何时加载扩展)）。
- **Extension SDK** — 使用 `@xopcai/xopc/extension-sdk`（可选用 `extension-sdk/core`、`extension-sdk/lazy` 等子路径）。
- **TypeScript** — 扩展为普通 TS/JS 模块，由运行时直接加载，无需单独编译步骤。
- **安装来源** — 通过 `xopc extensions install` 支持 npm 包、本地目录或 xopc-store 扩展。
- **网关控制台 UI（可选）** — manifest 中可声明 **`ui`**，在 Web 控制台沙箱 iframe 中运行；iframe 侧使用 **`@xopcai/extension-ui-sdk`**（见 [网关控制台：扩展 UI](#gateway-extension-ui)）。

## 快速开始

### 安装扩展

**方式一：使用 CLI（推荐）**

```bash
# 从 npm 安装（目录 ~/.xopc/extensions）
xopc extensions install xopc-extension-hello

# 从本地目录安装
xopc extensions install ./my-local-extension

# 查看已安装扩展
xopc extensions list

# 检查扩展健康状态
xopc extensions health
```

**方式二：手动安装**

```bash
# Global 目录
cd ~/.xopc/extensions
git clone https://github.com/your/extension.git

# 或 Workspace 目录
cd workspace/.extensions
git clone https://github.com/your/extension.git
```

### 启用扩展

在 `~/.xopc/xopc.json` 中配置：

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

**激活与 `enabled`：** **网关** 与 **`xopc agent`** 按 [何时加载扩展](#何时加载扩展) 中的规则加载扩展。已配置 **`channels.telegram`** / **`channels.weixin`**，或环境中存在 manifest 声明的变量（例如 `TELEGRAM_BOT_TOKEN`）时，**不一定**要把对应扩展写进 `extensions.enabled`。若要 **强制不加载**，把扩展 id 写入 **`extensions.disabled`**。

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

### 本地开发扩展

```bash
xopc extensions dev ./my-extension
xopc extensions pack ./my-extension
```

一个有效的扩展项目通常包含：
- `package.json` - npm 配置
- `index.ts` 或 `index.js` - 扩展入口
- `xopc.extension.json` - 扩展清单
- `README.md` - 文档

---

## 三级存储架构

xopc 支持三级扩展存储，按优先级从高到低：

| 级别 | 路径 | 用途 | 优先级 |
|------|------|------|--------|
| **Workspace** | `workspace/.extensions/` | 项目私有扩展 | ⭐⭐⭐ 最高 |
| **Global** | `~/.xopc/extensions/` | 用户级共享扩展 | ⭐⭐ 中 |
| **Bundled** | 与 xopc 安装包同目录的内置扩展 | 随安装提供 | ⭐ 最低 |

### 优先级规则

- **Workspace** 优先于 **Global** 与 **Bundled**（同名扩展 id 时）。
- **Global** 优先于 **Bundled**。

常见用法：项目专用扩展放在工作区；多项目共用的放在 `~/.xopc/extensions/`；安装包自带的为内置能力。

---

## 何时加载扩展 {#何时加载扩展}

运行时先读取各扩展的 **`xopc.extension.json`**，再结合 **配置文件与环境变量** 决定要加载的扩展 id。多数情况下，**只要配好 `channels.telegram` / `channels.weixin`**，就不必再把对应通道扩展写进 `extensions.enabled`。

**判定优先级（高者优先）：**

1. **`extensions.enabled` / `extensions.disabled`** — 显式列表；同一 id 不要同时出现在两边。
2. **默认智能体所用模型** — 若匹配 manifest 中的 `modelSupport` 模式。
3. **环境变量** — manifest 中 `providerAuthEnvVars`、`channelEnvVars` 所列名称已设置时。
4. **`autoEnableWhenConfiguredProviders`** — 与配置中的 provider 匹配时。
5. **`activation.onProviders` / `activation.onChannels`** — 与已配置的 provider / channel 匹配时。
6. **`enabledByDefault: true`**。

**各入口：**

- **网关**、**`xopc agent`**：启动扩展时使用完整规则。
- **其它 CLI 子命令**：若 `extensions.enabled` 为空、无会触发扩展的通道类配置、且无 manifest 索引到的环境变量，则可能 **不加载** 扩展，以加快冷启动。

### `xopc.extension.json` 常用可选字段

均为可选。

| 字段 | 用途 |
|------|------|
| `enabledByDefault` | 无更高优先级规则时默认启用 |
| `providers`、`channels` | 声明实现的逻辑 id |
| `providerAuthEnvVars`、`channelEnvVars` | 逻辑 id 与环境变量名的对应 |
| `providerAuthChoices` | 认证方式等 UI/CLI 元数据 |
| `modelSupport` | 按模型 id 激活 |
| `autoEnableWhenConfiguredProviders` | 配置中出现对应 provider 时自动启用 |
| `activation` | `onProviders`、`onChannels`、`onCommands`、`onCapabilities` |
| `contracts`、`setup` | 能力与安装提示 |

编写自己的扩展时，可参考内置扩展的 manifest。

### Global 扩展目录

```bash
# 默认位置
~/.xopc/extensions/

# 自定义位置（环境变量）
export XOPC_GLOBAL_EXTENSIONS=/path/to/global/extensions
```

---

## Extension SDK

xopc 提供官方 Extension SDK。发布包名为 **`@xopcai/xopc`**，请通过子路径 **`@xopcai/xopc/extension-sdk`** 导入。

### 使用 SDK

```typescript
// 推荐：与 npm 发布包一致
import type { ExtensionApi, ExtensionDefinition } from '@xopcai/xopc/extension-sdk';

// 不推荐直接依赖内部路径
// import type { ... } from 'xopc/extensions';  ❌
```

### 导出的类型

```typescript
// 核心类型
import type {
  ExtensionDefinition,      // 扩展定义
  ExtensionApi,             // 扩展 API
  ExtensionLogger,          // 日志接口
} from '@xopcai/xopc/extension-sdk';

// 工具（由 pi-agent-core 再导出）
import type {
  AgentTool,
  AgentToolResult,
} from '@xopcai/xopc/extension-sdk';

// 钩子
import type {
  ExtensionHookEvent,       // 钩子事件类型
  ExtensionHookHandler,     // 钩子处理器
  HookOptions,              // 钩子选项
} from '@xopcai/xopc/extension-sdk';

// 通道（ChannelPlugin）
import type {
  ChannelPlugin,
  ChannelPluginInitOptions,
  ChannelPluginStartOptions,
} from '@xopcai/xopc/extension-sdk';

import {
  defineChannelPluginEntry,
  registerExtensionCliProgram,
} from '@xopcai/xopc/extension-sdk';

// 可选子路径（更小的导入面），例如：
// import type { ExtensionApi } from '@xopcai/xopc/extension-sdk/core';
// import { lazyModule } from '@xopcai/xopc/extension-sdk/lazy';

// 命令
import type { ExtensionCommand } from '@xopcai/xopc/extension-sdk';

// 服务
import type { ExtensionService } from '@xopcai/xopc/extension-sdk';
```

---

## 网关控制台：扩展 UI（iframe） {#gateway-extension-ui}

扩展除了可在 Node 侧用上面的 **Extension SDK** 注册工具/钩子外，还可为 **Gateway Web 控制台**（`web/`）提供在 **沙箱 iframe** 中运行的页面。iframe **不会**在网关进程里调用 `register()`；它通过 **`postMessage`** 与宿主通信，由 **`@xopcai/extension-ui-sdk`** 封装。

### Manifest：`ui`（可选）

| 字段 | 作用 |
|------|------|
| `main` | 默认面板入口路径（相对扩展包根目录） |
| `icon` | 图标资源路径 |
| `permissions` | 声明所需能力字符串；宿主据此做 **运行时校验** 与 **首次授权对话框**（如 `theme`、`agent.send`、`agent.subscribe`、`storage` 等） |
| `contributions` | `pages`、`settingsPanels`、`chatWidgets`、`commands` — 应用页、设置侧栏、聊天流挂件与 **⌘/Ctrl+K** 命令面板 |

未声明 `ui` 时，扩展仍可仅作为 **纯后端扩展**（工具、通道、钩子等）。

### npm 包：`@xopcai/extension-ui-sdk`

使用 **`createExtensionClient()`**，在宿主下发 **`init`**（含 theme、locale、permissions）后 **`await client.whenReady()`**。

- **theme** — `getTheme`、`onThemeChange`
- **agent** — `sendMessage`（走网关 JSON 模式的 `/api/agent`）、`onStreamEvent`（依赖 **`GET /api/events`** 的 SSE 与宿主转发）
- **session** — `listSessions`、`navigateToSession`
- **config** / **storage** — 对应下文 **Gateway REST**；存储为按扩展命名空间持久化的 JSON KV（进程内带缓存）
- **ui** — `showNotification`、`navigate`、`resize`、`closePanel`；**聊天挂件**可用 **`onWidgetResult`** 接收宿主下发的工具结果（`widget.data`）
- **events** — `emit` / `on` 使用 **`ext.*`** 前缀在扩展 iframe 之间 **广播**（跨扩展通信）
- **onDispose**、**onDidChangeVisibility**

### Gateway REST（需 Bearer）

与控制台其它接口相同，携带 **`Authorization: Bearer <网关 token>`**。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/extensions` | 列出已发现扩展及 `ui` 摘要 |
| GET | `/api/extensions/:id` | 详情 + 完整 manifest |
| GET | `/api/extensions/:id/assets/*` | 静态资源（HTML/JS/CSS 等），响应附带严格 **CSP** |
| GET | `/api/extensions/:id/storage` | 列出 storage 键 |
| GET | `/api/extensions/:id/storage/:key` | 读取 `{ value }` |
| PUT | `/api/extensions/:id/storage/:key` | 请求体 `{ value }` 写入 |
| DELETE | `/api/extensions/:id/storage/:key` | 删除键 |
| GET | `/api/extensions/:id/config` | 读取扩展配置对象 |
| PATCH | `/api/extensions/:id/config` | JSON 合并写入配置 |

**持久化路径：** **`~/.xopc/extensions/<经过净化的命名空间>/storage.json`**；配置使用独立命名空间 **`__config__<extensionId>`**。

### Web 宿主行为摘要

- **首次权限确认** — 展示 manifest **`ui.permissions`**；用户同意后写入 **`localStorage`** 键 **`xopc.extensionUiGrants.v1`**（按扩展 id + 权限集合指纹）。
- **iframe `sandbox`** — 一般为 `allow-scripts allow-forms allow-popups`，**不启用 `allow-same-origin`** 以降低与宿主同源混用风险（通信依赖 `postMessage`）。
- **Agent 流式事件** — 网关在 webchat 场景广播 **`agent.stream`**；控制台 **`/api/events`** SSE 收到后，由宿主转发给已通过 **`agent.subscribe`** 订阅对应 **`sessionKey`** 的 iframe。
- **命令面板** — **⌘K / Ctrl+K**（或 `window` 上的 `open-command-palette`）列出 **`contributions.commands`**；带 **`opensPanel`** 的命令会导航到 **`/extensions/{extensionId}`**。
- **调试** — **设置 → Extensions → 扩展调试** 可查看网关返回的扩展列表与 **UI 授权** JSON。

### 示例：Hello 扩展

xopc 仓库中的 **Hello** 示例演示了扩展 UI 的完整链路。若你提供 `ui` 面板，请把浏览器端脚本打包（例如用 esbuild），并在 manifest 中指向构建产物。

---

## CLI 命令参考

### extensions install

安装扩展。

```bash
# 从 npm 安装
xopc extensions install <package-name>

# 安装特定版本
xopc extensions install my-extension@1.0.0

# 从本地目录安装
xopc extensions install ./local-extension-dir
xopc extensions install /absolute/path/to/extension

# 仅从 xopc-store 安装
xopc extensions install --store weather
```

**安装流程**：
1. 下载或复制扩展文件
2. 验证 `xopc.extension.json` 清单
3. 安装依赖（如有 `package.json` 依赖）
4. 安装到 `~/.xopc/extensions/<id>/`

### extensions list

列出所有已安装扩展。

```bash
xopc extensions list
xopc extensions list --json
```

### extensions health / audit / verify

检查健康状态、安全问题和完整性。

```bash
xopc extensions health
xopc extensions audit
xopc extensions verify [extension-id]
```

### extensions dev / pack / publish

本地开发、打包和发布扩展。

```bash
xopc extensions dev ./local-extension-dir
xopc extensions pack ./local-extension-dir
xopc extensions publish ./local-extension-dir --dry-run
```

### extensions search / update / freeze

搜索、更新和锁定扩展版本。

```bash
xopc extensions search [keyword]
xopc extensions update [extension-id]
xopc extensions freeze
```

### 更新后扩展同步

**`xopc update`**（或 Gateway `POST /api/update/run`）成功后，会自动重装 **`~/.xopc/extensions.lock`** 中记录的扩展：

- **`npm`** — 按 `resolved` 规格安装到 `~/.xopc/extensions/`
- **`store`** — 从配置的 xopc-store 拉取最新 zip
- **`local` / `git`** — 跳过

**`dev`** 更新通道下，若扩展 id 在 **bundled** 中也存在，则跳过 npm 更新（以内置副本为准）。

手动等价命令：

```bash
xopc extensions update
xopc extensions update my-ext
```

完整流程见 [更新](./update.md)。

## 扩展结构

### Manifest 文件

每个扩展必须包含一个 `xopc.extension.json` 文件。最小示例见下。通道类 / 提供方类扩展可增加 [何时加载扩展](#何时加载扩展) 中的 **可选声明字段**；可参考内置扩展的 manifest。

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
import type { ExtensionApi } from '@xopcai/xopc/extension-sdk';

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

扩展可以注册自定义工具供智能体使用：

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

### 语音 Provider (TTS) {#speech-providers}

扩展可以注册 **`SpeechProviderPlugin`**，让 TTS 链接入新的服务商或本地二进制
而无需 fork 主仓。内置 provider（`openai`、`alibaba`、`edge`、`minimax`）和
内置的本地 CLI provider（`tts-local-cli`）共用同一份插件契约 — 完整接口见
`src/voice/tts/speech-provider-types.ts`。

提供 provider 的两种方式：

#### 1. 直接使用内置 `tts-local-cli` 扩展

针对任意本地 TTS 二进制（mlx-audio、sherpa-onnx-tts、piper 等），启用内置
扩展并在 `xopc.json` 中配置 shell 命令：

```json
{
  "messages": {
    "tts": {
      "enabled": true,
      "provider": "tts-local-cli",
      "tts-local-cli": {
        "command": "mlx_audio.tts.generate --text \"{{Text}}\" --file_prefix {{OutputBase}}",
        "outputFormat": "wav",
        "timeoutMs": 120000
      }
    }
  }
}
```

`command` 内可用占位符：**`{{Text}}`**、**`{{OutputPath}}`**、
**`{{OutputDir}}`**、**`{{OutputBase}}`**（大小写不敏感）。Provider 会启动
该二进制、扫描 `OutputDir` 找到产物文件并把字节回传。完整字段说明见
[`docs/zh/voice.md`](./voice.md) → *本地 CLI TTS*。

#### 2. 编写自定义 `SpeechProviderPlugin`

新建一个扩展，在模块加载时自注册插件（与 `src/voice/tts/providers/*-speech.ts`
中的内置 provider 模式一致）：

```typescript
import { registerSpeechProvider } from 'xopc/voice/tts/speech-registry';
import type { SpeechProviderPlugin } from 'xopc/voice/tts/speech-provider-types';

const myProvider: SpeechProviderPlugin = {
  id: 'my-vendor',
  resolveConfig: (ctx) => ctx.rawConfig,
  isConfigured: (ctx) => Boolean(ctx.providerConfig.apiKey),
  async synthesize(req) {
    // … 调用厂商 API，返回 { audioBuffer, outputFormat, fileExtension }
  },
  // 可选：synthesizeStream 用于流式消费方（Telegram draft）。
  // 不实现时，编排层会用 wrapBufferAsStream 把 synthesize 包成单 chunk 流。
};

registerSpeechProvider(myProvider);
```

随后在 `messages.tts.provider`（或 `messages.tts.fallback.order`）里写上
该 provider id，TTS 链就会拾取到它。所有出站 HTTP 调用**必须**走
`src/media-shared/http/`（**SSRF 守卫 + API Key 轮换** 是强制要求）。完整
设计见 `docs/voice-rearchitecture.md`。

### 钩子 (Hooks)

钩子允许扩展在各个生命周期点拦截和修改行为：

| 钩子 | 时机 | 用途 |
|------|------|------|
| `before_agent_start` | 智能体启动前 | 修改系统提示 |
| `agent_end` | 智能体结束后 | 后处理结果 |
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
import type { ExtensionApi } from '@xopcai/xopc/extension-sdk';

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

## 故障排查（扩展未加载）

1. 确认 **`extensions.disabled`** 未包含该扩展 id。
2. 网关 / agent：对照 [何时加载扩展](#何时加载扩展) 检查 `extensions.enabled`、`channels.*`、环境变量、模型、`enabledByDefault` 等条件。
3. **其它 CLI 子命令**：若 `extensions.enabled` 为空、无通道类触发配置、且无 manifest 索引到的环境变量，扩展可能 **不会加载**。
4. 确认 `xopc.extension.json` 为合法 JSON，且扩展位于 workspace / global / 安装包发现路径下。
5. 查看日志中的加载错误。

## 发布扩展

1. 创建 `xopc.extension.json` manifest
2. 创建 `index.js` 入口文件
3. 推送到 GitHub 或发布到 npm

```bash
# 发布到 npm（公开发布）
npm publish --access public

# 如果使用 scoped 包名（推荐）
# package.json: { "name": "@yourname/xopc-extension-name" }
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

### 全局选项

`~/.xopc/xopc.json` 中 `extensions` 下常见字段：

```json
{
  "extensions": {
    "enabled": ["hello", "echo"],
    "disabled": [],
    "security": {
      "checkPermissions": true,
      "allowUntrusted": false,
      "allow": ["hello", "echo", "xopc-feishu"],
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
| `enabled` | `string[]` | 与激活规则一起使用的扩展 id 列表 |
| `disabled` | `string[]` | 禁止加载的扩展 id |
| `security.checkPermissions` | `boolean` | 路径与安装安全检查 |
| `security.allowUntrusted` | `boolean` | 是否允许加载不在 `security.allow` 中的扩展 |
| `security.allow` | `string[]` | 可选扩展 id 白名单 |
| `security.trackProvenance` | `boolean` | 记录扩展安装来源 |
| `security.allowPromptInjection` | `boolean` | 是否允许钩子修改系统提示 |
| `slots.memory` | `string` | 首选 memory 后端扩展 id |
| `slots.tts` | `string` | 首选 TTS 扩展 id |
| `slots.imageGeneration` | `string` | 首选图像生成扩展 id |
| `slots.webSearch` | `string` | 首选网页搜索扩展 id |

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

默认情况下，xopc 对扩展执行安全检查：
- 路径安全（无 symlink 逃逸）
- 所有权验证
- Hardlink 检测
- 来源追踪

设置 `allowPromptInjection: true` 以允许扩展通过钩子结果修改 system prompt。
