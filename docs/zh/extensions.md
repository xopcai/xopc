# xopc 扩展系统

xopc 提供了一个轻量级但功能强大的扩展系统。

## 特性

- 🏗️ **三级存储架构** - Workspace / Global / Bundled
- 📋 **Manifest-first 激活** - 先读 `xopc.extension.json` 再按需加载扩展代码；网关与 `xopc agent` 按激活计划（配置、`channels.*`、模型 id、manifest 声明的环境变量等）决定加载哪些扩展
- 🔌 **Extension SDK** - 官方 SDK；除总入口外可选用 **子路径**（`extension-sdk/core`、`extension-sdk/lazy` 等）
- ⚡ **TypeScript 原生** - 通过 jiti 即时加载，无需编译
- 📦 **多源安装** - 支持 npm、本地目录、Git 仓库
- 🖥️ **网关 Web 控制台 UI（可选）** — 扩展可在 manifest 中声明 **`ui`**，由 React 控制台通过 HTTPS 加载静态资源并在沙箱 iframe 中运行；iframe 侧使用 **`@xopcai/extension-ui-sdk`**（见 [网关控制台：扩展 UI](#gateway-extension-ui)）。

**设计方案（仓库内 RFC）：** [`.docs/channel/`](../.docs/channel/00-overview.md) 描述与 OpenClaw 思路对齐的完整目标架构；下文概括**当前已实现**的用户可见行为。**浏览器端扩展 UI** 的分阶段说明见仓库内 [`.docs/ext/`](../.docs/ext/)（与 `AGENTS.md` 配套）。

## 快速开始

### 安装扩展

**方式一：使用 CLI（推荐）**

```bash
# 从 npm 安装到 workspace
xopc extension install xopc-extension-hello

# 安装到 global（跨项目共享）
xopc extension install xopc-extension-hello --global

# 从本地目录安装
xopc extension install ./my-local-extension

# 查看已安装扩展
xopc extension list

# 移除扩展
xopc extension remove hello
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

**激活与 `enabled`：** **网关** 与 **`xopc agent`** 使用 **基于 manifest 的激活计划**。只要满足 manifest 中的触发条件，**不一定**要把通道扩展写进 `extensions.enabled`——例如已配置 **`channels.telegram`** / **`channels.weixin`**，或环境中存在 manifest 声明的变量（如 bundled Telegram 的 `TELEGRAM_BOT_TOKEN`）。若要 **强制不加载** 某扩展，请把其 id 写入 **`extensions.disabled`**。

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
xopc extension create my-extension --name "My Extension" --kind utility

# 支持的 kind: channel|provider|memory|tool|utility|tts|image-generation|web-search
```

这将创建：
- `package.json` - npm 配置
- `index.ts` - 扩展入口（TypeScript，推荐使用 `@xopcai/xopc/extension-sdk`）
- `xopc.extension.json` - 扩展清单
- `README.md` - 文档模板

---

## 三级存储架构

xopc 支持三级扩展存储，按优先级从高到低：

| 级别 | 路径 | 用途 | 优先级 |
|------|------|------|--------|
| **Workspace** | `workspace/.extensions/` | 项目私有扩展 | ⭐⭐⭐ 最高 |
| **Global** | `~/.xopc/extensions/` | 用户级共享扩展 | ⭐⭐ 中 |
| **Bundled** | `xopc/extensions/` | 内置扩展 | ⭐ 最低 |

### 优先级规则

- **Workspace** 扩展可以覆盖 **Global** 和 **Bundled** 同名扩展
- **Global** 扩展可以覆盖 **Bundled** 同名扩展
- 适合场景：
  - Workspace：项目特定的定制扩展
  - Global：常用的共享扩展（如 telegram-channel）
  - Bundled：随 xopc 发布的官方扩展

**Monorepo 说明：** Telegram 通道是仓库内 **`extensions/telegram`** 工作区包（`@xopcai/xopc-extension-telegram`），由核心通过 `src/channels/plugins/bundled.ts` 接入；与上表中 **Bundled** 扩展目录 `xopc/extensions/` 不是同一条加载路径。

---

## Manifest-first 控制平面 {#manifest-first-control-plane}

实现上将 **只读 manifest**（控制面）与 **加载并执行扩展代码**（运行时）分开，对应 `.docs/channel` 中 RFC-01 / RFC-02。

### 三阶段

| 阶段 | 作用 | API / 模块 |
|------|------|------------|
| **1 — 发现与注册表** | 扫描扩展目录，仅解析 `xopc.extension.json`，不执行 `register()` | `ExtensionLoader.buildManifestRegistry()`、`getManifestRegistry()` → `ManifestRegistry` |
| **2 — 激活规划** | 根据 **配置 + 环境变量 + manifest 元数据** 计算应加载的扩展 id | `ActivationPlanner`，`ExtensionLoader.planActivation()` |
| **3 — 运行时加载** | 按入口加载模块并注册 | `ExtensionLoader.loadByActivationPlan()`（仍保留 `loadExtension` / `loadExtensions` / `loadAllExtensions`） |

### 激活判定优先级（高 → 低）

1. 配置中的 **`extensions.enabled` / `extensions.disabled`**（同一 id 同时出现时以 enabled 为先——应避免这样配置）。
2. **默认智能体模型 id** — 匹配 manifest 中 `modelSupport.modelPrefixes` / `modelPatterns`。
3. **环境变量** — manifest 中 `providerAuthEnvVars`、`channelEnvVars` 列出的变量名在 `process.env` 中有值。
4. **`autoEnableWhenConfiguredProviders`** — 与从配置推导的 `configuredProviderIds` 相交。
5. **`activation.onProviders` / `activation.onChannels`** — 与配置中的 provider / channel 引用匹配。
6. **`enabledByDefault: true`**。

最终待加载的扩展 id 按 **字典序** 排序，保证顺序稳定。

### 各入口行为

| 入口 | 行为 |
|------|------|
| **网关** | 启动扩展时调用 `loadByActivationPlan()`，**不仅依赖** `extensions.enabled` 列表。 |
| **`xopc agent`** | 同样使用 `loadByActivationPlan()`。 |
| **CLI（`registerExtensionCliCommands`）** | 仅当 **`extensions.enabled` 非空**、或 **已配置会触发通道扩展的 channels**、或 **任意 manifest 索引到的环境变量已设置** 时才加载扩展并注册 CLI，避免每个子命令都扫描加载。 |

### `xopc.extension.json` 可选声明字段

均为 **可选**，旧 manifest 不加字段仍可工作。常用字段：

| 字段 | 用途 |
|------|------|
| `enabledByDefault` | 无更高优先级规则时默认激活 |
| `providers`、`channels` | 声明实现的逻辑 id（供索引与查询） |
| `providerAuthEnvVars`、`channelEnvVars` | 逻辑 id → 环境变量名（检测与 onboarding） |
| `providerAuthChoices` | 认证方式等展示/CLI 元数据 |
| `modelSupport` | `modelPrefixes`、`modelPatterns`，按模型激活 |
| `autoEnableWhenConfiguredProviders` | 配置中出现对应 provider 时自动激活 |
| `activation` | `onProviders`、`onChannels`、`onCommands`、`onCapabilities` |
| `contracts`、`setup` | 能力与 setup 提示 |

示例见仓库内 `extensions/telegram/xopc.extension.json`、`extensions/custom-provider/xopc.extension.json`。

### Onboarding 辅助（进阶）

在不加载扩展 JS 的情况下枚举 provider/channel 等信息，可使用 `src/extensions/onboard-helpers.ts` 中的 `listOnboardProviders`、`listOnboardChannels`、`resolveProviderForModel`（需先构造 `ManifestRegistry`）。

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

### SDK 路径解析

在本地开发时，xopc 通过 jiti 将 `xopc/extension-sdk` 解析到 `src/extensions/sdk/index.ts`，并支持子路径别名（如 `xopc/extension-sdk/core`、`xopc/extension-sdk/lazy`）。使用已安装的 **`@xopcai/xopc`** 时，请优先使用 **`@xopcai/xopc/extension-sdk`** 或对应子路径。

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

**Markdown API 文档生成**（仓库根目录执行）：

```bash
pnpm run docs:extension-sdk
```

生成目录：**`packages/extension-ui-sdk/docs/api/`**。

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
- **命令面板** — **⌘K / Ctrl+K**（或 `window` 上的 `open-command-palette`）列出 **`contributions.commands`**；带 **`opensPanel`** 的命令会导航到 **`/apps/{extensionId}`**。
- **调试** — **设置 → Extensions → 扩展调试** 可查看网关返回的扩展列表与 **UI 授权** JSON。

### 示例扩展：`extensions/hello`

仓库内 **Hello** 示例使用 **esbuild** 将 TS 入口打成 **`ui/*.bundle.js`**，在 HTML 中引用：

```bash
pnpm run build:hello-ui
```

升级 **`@xopcai/extension-ui-sdk`** 后请重新打包。入口源文件：`extensions/hello/ui/*-entry.ts`。

---

## CLI 命令参考

### extension install

安装扩展。

```bash
# 从 npm 安装
xopc extension install <package-name>

# 安装特定版本
xopc extension install my-extension@1.0.0

# 从本地目录安装
xopc extension install ./local-extension-dir
xopc extension install /absolute/path/to/extension

# 设置超时时间（默认 120 秒）
xopc extension install slow-extension --timeout 300000
```

**安装流程**：
1. 下载/复制扩展文件
2. 验证 `xopc.extension.json` 清单
3. 安装依赖（如有 `package.json` 依赖）
4. 复制到工作区 `.extensions/` 目录

### extension list

列出所有已安装扩展。

```bash
xopc extension list
```

**输出示例**：
```
📦 Installed Extensions

════════════════════════════════════════════════════════════

  📁 Telegram Channel
     ID: telegram-channel
     Version: 1.2.0
     Path: /home/user/.xopc/workspace/.extensions/telegram-channel

  📁 My Custom Extension
     ID: my-custom-extension
     Version: 0.1.0
     Path: /home/user/.xopc/workspace/.extensions/my-custom-extension
```

### extension remove / uninstall

移除已安装扩展。

```bash
xopc extension remove <extension-id>
xopc extension uninstall <extension-id>
```

**注意**：移除扩展后，如果已启用，还需要从配置文件中删除。

### extension info

查看扩展详情。

```bash
xopc extension info <extension-id>
```

### extension create

创建新扩展脚手架。

```bash
xopc extension create <extension-id> [options]

Options:
  --name <name>           扩展显示名称
  --description <desc>    扩展描述
  --kind <kind>          扩展类型: channel|provider|memory|tool|utility
```

**示例**：
```bash
# 创建一个工具类扩展
xopc extension create weather-tool --name "Weather Tool" --kind tool

# 创建一个通道类扩展
xopc extension create discord-channel --name "Discord Channel" --kind channel
```

## 扩展结构

### Manifest 文件

每个扩展必须包含一个 `xopc.extension.json` 文件。最小示例见下。通道类 / 提供方类扩展可增加 [Manifest-first 控制平面](#manifest-first-控制平面) 一节中的 **可选声明字段**（参考仓库内 `extensions/telegram`、`extensions/custom-provider` 的 manifest）。

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
2. 网关 / agent：检查是否存在 **激活条件**（`extensions.enabled`、匹配的 `channels.*`、manifest 声明的环境变量、模型前缀、`enabledByDefault` 等）。
3. **纯 CLI 子命令**：若 `extensions.enabled` 为空、未配置通道、且无 manifest 索引到的环境变量，扩展可能 **故意不加载**（避免每个子命令都扫盘）。
4. 确认 `xopc.extension.json` 为合法 JSON，且扩展位于 workspace / global / bundled 发现路径下。
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

### 全局配置

`config.json` 中的 `extensions` 部分支持以下全局选项：

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

| 选项 | 类型 | 说明 |
|------|------|------|
| `enabled` | `Record<string, boolean>` | 启用/禁用特定扩展 |
| `allow` | `string[]` | 允许的扩展白名单 |
| `security.checkPermissions` | `boolean` | 启用路径安全检查 |
| `security.allowUntrusted` | `boolean` | 允许加载不在白名单中的扩展 |
| `security.trackProvenance` | `boolean` | 追踪扩展安装来源 |
| `security.allowPromptInjection` | `boolean` | 允许扩展注入 system prompt |
| `slots.memory` | `string` | 首选 memory 后端扩展 |
| `slots.tts` | `string` | 首选 TTS 服务商扩展 |
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

默认情况下，xopc 对扩展执行安全检查：
- 路径安全（无 symlink 逃逸）
- 所有权验证
- Hardlink 检测
- 来源追踪

设置 `allowPromptInjection: true` 以允许扩展通过钩子结果修改 system prompt。
