# 架构设计

本文档介绍 xopcbot 的整体架构设计和模块关系。

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      xopcbot                                │
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
├── agent/              # 核心代理逻辑（基于 pi-agent-core）
│   ├── service.ts      #   主 AgentService 类
│   ├── memory/         #   会话持久化和压缩
│   ├── prompt/         #   Prompt 构建系统
│   ├── tools/          #   内置工具（Typebox schema）
│   └── progress.ts     #   进度反馈系统
├── bus/                # 消息路由事件总线
├── channels/           # 通道集成
│   ├── telegram/       #   Telegram 扩展（多账户）
│   │   ├── extension.ts   #     主实现
│   │   ├── client.ts      #     机器人客户端包装
│   │   ├── webhook.ts     #     Webhook 服务器支持
│   │   └── command-handler.ts  # 机器人命令处理器
│   ├── types.ts        #   通道扩展接口
│   ├── manager.ts      #   通道生命周期管理器
│   ├── access-control.ts     # 访问控制策略
│   ├── draft-stream.ts       # 流式消息预览
│   └── format.ts             # Markdown 到 HTML 格式化
├── cli/                # CLI 命令（自注册）
│   ├── commands/       #   独立命令模块
│   ├── registry.ts     #   命令注册系统
│   └── index.ts        #   CLI 入口
├── config/             # 配置管理（Zod schemas）
├── cron/               # 定时任务
├── gateway/            # HTTP/WebSocket gateway 服务器
├── heartbeat/          # 主动监控
├── providers/          # LLM 提供商注册表（pi-ai 包装）
├── session/            # 对话会话管理
├── types/              # 共享 TypeScript 类型
├── ui/                 # Web UI 组件（基于 Lit）
│   └── src/
│       ├── index.ts              # 主入口
│       ├── gateway-chat.ts       # Gateway 连接聊天
│       ├── components/           # UI 组件
│       ├── dialogs/              # 对话框组件
│       └── utils/                # 工具函数（i18n, format）
└── utils/              # 共享工具函数
    ├── logger.ts       #   上下文日志
    ├── log-store.ts    #   日志存储和查询
    └── markdown/       #   Markdown 处理
```

## 核心模块

### Agent Service (`src/agent/service.ts`)

AgentService 是核心编排器，负责：

1. **消息处理** - 接收用户消息，调用 LLM，处理工具调用
2. **Prompt 构建** - 从 SOUL.md/USER.md/AGENTS.md/TOOLS.md 构建系统 Prompt
3. **内存管理** - 会话消息存储和上下文压缩
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
| Identity | "You are a personal assistant running in xopcbot" |
| Version | xopcbot 版本信息 |
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
| 🔍 记忆搜索 | `memory_search` | 搜索记忆文件 |
| 📄 记忆读取 | `memory_get` | 读取记忆片段 |

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

### 会话内存 (`src/agent/memory/`)

```
src/agent/memory/
├── store.ts       # MemoryStore - 会话消息存储
└── compaction.ts  # SessionCompactor - 上下文压缩
```

**压缩模式**：
- `extractive` - 使用关键句摘要
- `abstractive` - 基于 LLM 的摘要
- `structured` - 保留结构化数据

### 通道扩展 (`src/channels/`)

基于扩展的通道架构：

```typescript
import { telegramExtension } from './channels/index.js';

// 初始化
await telegramExtension.init({ bus, config, channelConfig });
await telegramExtension.start();

// 发送消息
await telegramExtension.send({
  chatId: '123456',
  content: 'Hello World',
  accountId: 'personal',
});

// 流式预览
const stream = telegramExtension.startStream({ chatId: '123456' });
stream.update('Processing...');
await stream.end();
```

**功能**：
- 多账户支持
- 访问控制（白名单、群组策略）
- 流式消息预览
- 语音消息（STT/TTS）
- 文档/文件支持

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
2. **Global** (`~/.xopcbot/extensions/`) - 用户级共享
3. **Bundled** (`xopcbot/extensions/`) - 内置

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
│  │ 构建 Prompt   │  │ ← memory_search/memory_get
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

xopcbot 使用自注册模式：

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
| Agent 框架 | @mariozechner/pi-agent-core |
| CLI | Commander.js |
| 验证 | Zod (配置) + TypeBox (工具) |
| 日志 | Pino |
| Cron | node-cron |
| HTTP 服务器 | Hono |
| Web UI | Lit (Web Components) |
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

### 添加通道扩展

1. 创建 `src/channels/<name>/` 目录
2. 实现 `ChannelExtension` 接口
3. 添加到 `src/channels/index.ts` 导出
4. 在 `ChannelManager` 中注册
