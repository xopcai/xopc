# 架构

本文页说明 xopc 的整体结构与主要模块之间的关系。

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      xopc                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    CLI Layer                         │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │   │
│  │  │ setup   │ │ onboard │ │ agent   │ │ gateway │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                     Core                             │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │              AgentService                    │   │   │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐       │   │   │
│  │  │  │ Prompt  │ │ Memory  │ │ Skills  │       │   │   │
│  │  │  │ Builder │ │ Search  │ │         │       │   │   │
│  │  │  └─────────┘ └─────────┘ └─────────┘       │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Providers                          │   │
│  │            @mariozechner/pi-ai (20+ providers)      │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
  ┌──────────┐        ┌──────────┐        ┌──────────┐
  │ Telegram │        │   Cron   │        │ Gateway  │
  │ Channel  │        │ Scheduler│        │   API    │
  └──────────┘        └──────────┘        └──────────┘
```

## 项目结构

```
src/
├── agent/              # 智能体核心逻辑（基于 pi-agent-core）
│   ├── service.ts      #   主 AgentService 类
│   ├── memory/         #   托管记忆、MemoryManager、prefetch；会话 transcript 在 session/ 下
│   ├── prompt/         #   Prompt 构建系统
│   ├── tools/          #   内置工具（Typebox schema）
│   └── progress.ts     #   进度反馈系统
├── infra/
│   └── bus/            # 消息总线原语（队列等）
├── channels/           # 通道集成（ChannelPlugin + 管理器）
│   ├── plugin-types.ts #   ChannelPlugin 接口与适配器
│   ├── manager.ts      #   通道生命周期管理器
│   ├── plugins/
│   │   ├── bundled.ts  #   内置工作区插件（如 Telegram）
│   │   ├── registry.ts #   插件注册表 / 查询
│   │   └── types.*.ts  #   注册表类型辅助
│   ├── telegram/
│   │   └── index.ts    #   从 @xopcai/xopc-extension-telegram 再导出（兼容路径）
│   ├── outbound/       #   出站投递 pipeline
│   ├── security.ts     #   访问控制辅助
│   ├── draft-stream.ts #   流式消息预览
│   └── format.ts       #   Markdown 到 HTML 格式化
├── extensions/         # 扩展运行时（loader、hooks）；`sdk/` → @xopcai/xopc/extension-sdk
├── routing/            # Session key、bindings、路由解析
├── acp/                # Agent Control Protocol（可选多运行时桥接）
├── cli/                # CLI 命令（自注册）
│   ├── commands/       #   独立命令模块
│   ├── registry.ts     #   命令注册系统
│   └── index.ts        #   CLI 入口
├── config/             # 配置管理（Zod schemas）
├── cron/               # 定时任务
├── gateway/            # HTTP/WebSocket gateway 服务器
├── heartbeat/          # 主动监控
├── providers/          # LLM 服务商注册表（pi-ai 包装）
├── session/            # 对话会话管理
├── types/              # 共享 TypeScript 类型
└── utils/              # 共享工具
    ├── logger.ts       #   日志入口，实现见 `logger/`（context、log-store 等）
    └── helpers.ts      #   杂项辅助函数

web/                    # 网关控制台 SPA（React + Vite + Tailwind v4）
└── src/                #   应用源码；生产构建输出至 dist/gateway/static/root

extensions/
└── telegram/           # 工作区包：Telegram 通道（@xopcai/xopc-extension-telegram）
```

## 磁盘上的状态目录与工作空间

运行时数据（配置、凭据、按智能体划分的会话、作为工具 cwd 与用户内容的 Markdown **工作空间**、以及位于 `agents/<id>/bootstrap/` 的人格 Markdown）位于仓库之外的 **状态目录**（默认 `~/.xopc`）。路径总览（bootstrap、智能体主目录、迁移）见 [磁盘与目录布局](disk-layout.md)。初始化、环境变量与默认路径说明见 [状态目录与工作空间布局](workspace.md)。

## 核心模块

### Agent Service (`src/agent/service.ts`)

AgentService 是核心编排器，负责：

1. **消息处理** - 接收用户消息，调用 LLM，处理工具调用
2. **Prompt 构建** - 从 SOUL.md/USER.md/AGENTS.md/TOOLS.md 构建系统 Prompt
3. **记忆与会话** - 会话消息持久化与压缩（`src/session/`）；agent 主目录 `memories/` 托管记忆、可插拔 provider 与工具（`src/agent/memory/`）
4. **工具执行** - 内置工具 + 扩展工具的统一执行
5. **进度反馈** - 长任务实时更新

### Prompt Builder (`src/agent/prompt/`)

模块化 Prompt 构建系统：

```
src/agent/prompt/
├── index.ts         # PromptBuilder - 主构建器
├── modes.ts         # Prompt 模式 (full/minimal/none)
├── memory/
│   └── index.ts     # memory_search, memory_get 工具
└── skills.ts        # Skills 加载系统
```

**Prompt Sections**：

| Section | 描述 |
|---------|------|
| Identity | "You are a personal assistant running in xopc" |
| Version | xopc 版本信息 |
| Tool Call Style | 工具调用风格 (verbose/brief/minimal) |
| Safety | 安全原则 |
| Memory | memory_search/memory_get 使用指南 |
| Workspace | 工作目录 |
| Skills | 技能系统 |
| Messaging | 消息发送 |
| Heartbeats | 心跳监控 |
| Runtime | 运行时信息 |

### 内置工具 (`src/agent/tools/`)

| 工具 | 名称 | 描述 |
|------|------|------|
| 📄 读取 | `read_file` | 读取文件内容（截断至 50KB/500 行） |
| ✍️ 写入 | `write_file` | 创建或覆盖文件 |
| ✏️ 编辑 | `edit_file` | 替换文件中的文本 |
| 📂 列表 | `list_dir` | 列出目录内容 |
| 💻 Shell | `shell` | 执行 Shell 命令（5 分钟超时） |
| 🔍 搜索 | `grep` | 在文件中搜索文本 |
| 📄 查找 | `find` | 按模式查找文件 |
| 🔍 网页搜索 | `web_search` | 使用 Brave Search 搜索网页 |
| 📄 网页抓取 | `web_fetch` | 获取网页内容 |
| 📨 消息 | `send_message` | 发送消息到通道 |
| 🔍 记忆搜索 | `memory_search` | 搜索工作区内 `memory/*.md` 片段 |
| 📄 记忆读取 | `memory_get` | 读取记忆片段 |
| 🧠 托管记忆 | `curated_memory` | 编辑 agent 主目录 `memories/` 中有上限的条目（启用时） |
| 🔎 会话搜索 | `session_search` | 检索其他会话的 transcript（接入会话存储时） |

### 进度反馈 (`src/agent/progress.ts`)

长任务实时进度跟踪：

```typescript
// 工具执行反馈
manager.onToolStart('read_file', { path: '/file.txt' });
// → 显示：📖 读取中...

// 长任务心跳（> 30 秒）
manager.onHeartbeat(elapsed, stage);
// → 显示：⏱️ 已进行 45 秒
```

**进度阶段**：

| 阶段 | Emoji | 触发 |
|------|-------|------|
| thinking | 🤔 | LLM 推理 |
| searching | 🔍 | web_search, grep |
| reading | 📖 | read_file |
| writing | ✍️ | write_file, edit_file |
| executing | ⚙️ | shell 命令 |
| analyzing | 📊 | 数据分析 |

### 会话 transcript 与压缩（`src/session/`）

会话消息持久化、`session_search` 用的检索索引辅助、压缩逻辑位于 **`src/session/`**（磁盘路径为 `agents/<id>/sessions/`，不在 Markdown 工作空间树内）。

### 托管与可插拔记忆（`src/agent/memory/`）

```
src/agent/memory/
├── builtin-memory-store.ts  # agent 主目录 memories/MEMORY.md + USER.md（有上限、§ 分隔）
├── manager.ts               # MemoryManager — 提供方、prefetch、sync、onMemoryWrite
├── create-memory-manager.ts # 内置 + 配置中的可选 stub
├── inject-prefetch.ts       # 按配置为用户消息加 <memory-context> 前缀
└── …                        # 围栏、provider、插件发现等
```

由 **`agents.defaults.memory`** 配置（[配置参考](zh/configuration.md)）。关闭总开关后，curated 工具与外部 prefetch 均不启用。

**对话压缩**（上下文长度）由 **`agents.defaults.compaction`** / `pruning` 等同级的默认项配置，与上述托管记忆文件不是同一套机制。

### 通道插件 (`src/channels/`)

通道以 **`ChannelPlugin`** 实例实现。核心 **`ChannelManager`** 从 `src/channels/plugins/bundled.ts` 中的 `bundledChannelPlugins` 加载插件（Telegram 由工作区包 `extensions/telegram` 提供）。每个插件在生命周期中暴露 `init` / `start`、出站投递与可选适配器（配置、安全、流式、网关，以及 **`cronDelivery`**、**`cliLogin`**、**`configSurface`**、**`onboard`** 等，合约见 `src/channels/plugins/types.adapters.ts`）。配置里的根 **`channels`** 在解析阶段为开放映射；内置 Telegram/微信 的字段级 schema 位于 `extensions/*/src/config-schema.ts`（详见 [通道配置](zh/channels.md)）。

**功能**（Telegram）：
- 多账户支持
- 访问控制（白名单、群组策略）
- 流式消息预览
- 语音消息（STT/TTS）
- 文档/文件支持

**导入示例**（扩展或核心代码）：

```typescript
import { telegramPlugin } from '@xopcai/xopc-extension-telegram';
// 稳定路径再导出：import { telegramPlugin } from './channels/telegram/index.js';
```

### 扩展系统 (`src/extensions/`)

```
src/extensions/
├── types.ts       # 扩展类型定义
├── api.ts         # Extension API
├── loader.ts      # 扩展加载器
├── hooks.ts       # Hook 系统
└── index.ts       # 导出
```

**Hook 生命周期**：

```
before_agent_start → agent_end → message_received → 
before_tool_call → after_tool_call → message_sending → session_end
```

**三级存储**：
1. **Workspace** (`workspace/.extensions/`) - 项目私有
2. **Global** (`~/.xopc/extensions/`) - 用户级共享
3. **Bundled** (`xopc/extensions/`) - 内置

## 数据流

### 对话流程

```
用户 (Telegram/Gateway/CLI)
        │
        ▼
┌─────────────────────┐
│   通道处理器        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   AgentService      │
│  ┌───────────────┐  │
│  │ 加载引导文件  │  │ ← SOUL.md, USER.md, TOOLS.md, AGENTS.md
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ 构建 Prompt   │  │ ← 引导文件、托管快照、memory_search / memory_get 等
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ LLM (pi-ai)   │  │
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ 执行工具      │  │ ← 工具 + 扩展
│  │ + 进度反馈    │  │ ← 进度反馈
│  └───────┬───────┘  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   响应              │
└──────────┬──────────┘
           │
           ▼
用户回复 / 通道响应
```

## CLI 命令注册

xopc 使用自注册模式：

```typescript
// src/cli/commands/mycommand.ts
import { register } from '../registry.js';

function createMyCommand(ctx: CLIContext): Command {
  return new Command('mycommand')
    .description('My command')
    .action(async () => { ... });
}

register({
  id: 'mycommand',
  factory: createMyCommand,
  metadata: { category: 'utility' },
});
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js 22+ |
| 语言 | TypeScript 5.x |
| LLM SDK | @mariozechner/pi-ai |
| 智能体框架（pi-agent-core） | @mariozechner/pi-agent-core |
| CLI | Commander.js |
| 验证 | Zod (配置) + TypeBox (工具) |
| 日志 | Pino |
| Cron | node-cron |
| HTTP 服务器 | Hono |
| Web UI | React + Vite + Tailwind v4（网关控制台 `web/`） |
| 测试 | Vitest |

## 扩展点

### 添加新工具

1. 创建 `src/agent/tools/<name>.ts`
2. 使用 Typebox schema 实现 `AgentTool` 接口
3. 从 `src/agent/tools/index.ts` 导出
4. 在 `AgentService` 中添加到 tools 数组

### 添加 Hook

```typescript
api.registerHook('before_tool_call', async (event, ctx) => {
  // 拦截工具调用
  return { modified: true };
});
```

### 添加通道插件

1. 在包或 `extensions/<name>/` 下实现 `ChannelPlugin`（见 `src/channels/plugin-types.ts` 与 `@xopcai/xopc/extension-sdk` 中的 `defineChannelPluginEntry`）。
2. 导出插件对象；若需随核心二进制发布，将其加入 `src/channels/plugins/bundled.ts` 的 `bundledChannelPlugins`。
3. 确保启动时加载该插件（`bundled.ts` 中列出的内置插件会由管理器自动注册）。
