# 架构设计

本文档介绍 xopcbot 的整体架构设计和模块关系。

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      xopcbot                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    CLI Layer                         │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │   │
│  │  │ onboard │ │ agent   │ │ gateway │ │ cron    │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                     Core                              │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │              AgentService                    │   │   │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐      │   │   │
│  │  │  │ Prompt  │ │ Memory  │ │ Skills  │      │   │   │
│  │  │  │ Builder │ │ Search  │ │         │      │   │   │
│  │  │  └─────────┘ └─────────┘ └─────────┘      │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Providers                          │   │
│  │            @mariozechner/pi-ai (20+ providers)       │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
  ┌──────────┐        ┌──────────┐        ┌──────────┐
  │Telegram │        │  Cron    │        │ Gateway  │
  │ Channel │        │ Scheduler │        │   API    │
  └──────────┘        └──────────┘        └──────────┘
```

## 核心模块

### Agent Service (`src/agent/service.ts`)

AgentService 是核心编排器，负责：

1. **消息处理** - 接收用户消息，调用 LLM，处理工具调用
2. **Prompt 构建** - 从 SOUL.md/USER.md/AGENTS.md/TOOLS.md 构建系统 Prompt
3. **内存管理** - 会话消息存储和上下文压缩
4. **工具执行** - 内置工具 + 插件工具的统一执行
5. **插件集成** - 插件工具和 Hook 的加载

### Prompt Builder (`src/agent/prompt/`)

模块化 Prompt 构建系统：

```
src/agent/prompt/
├── index.ts         # PromptBuilder - 主构建器
│                    # buildIdentitySection, buildMemorySection 等
├── modes.ts         # Prompt 模式 (full/minimal/none)
├── memory/
│   └── index.ts     # memory_search, memory_get 工具
│                    # 语义搜索 MEMORY.md 和 memory/*.md
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

| 工具 | 文件 | 描述 |
|------|------|------|
| `read_file` | read.ts | 读取文件内容 |
| `write_file` | write.ts | 创建/覆盖文件 |
| `edit_file` | edit.ts | 精确编辑文件 |
| `list_dir` | list-dir.ts | 列出目录内容 |
| `shell` | shell.ts | 执行 Shell 命令 |
| `grep` | grep.ts | 文本搜索 |
| `find` | find.ts | 文件查找 |
| `web_search` | web.ts | 网页搜索 |
| `web_fetch` | web.ts | 网页抓取 |
| `send_message` | communication.ts | 发送消息 |
| `memory_search` | memory-tool.ts | 搜索记忆文件 |
| `memory_get` | memory-tool.ts | 读取记忆片段 |

### 会话内存 (`src/agent/memory/`)

```
src/agent/memory/
├── store.ts       # MemoryStore - 会话消息存储
└── compaction.ts  # SessionCompactor - 上下文压缩
                  # 支持 extractive/abstractive/structured 模式
```

### 插件系统 (`src/plugins/`)

```
src/plugins/
├── types.ts       # 插件类型定义
├── api.ts         # Plugin API
├── loader.ts      # 插件加载器
├── hooks.ts       # Hook 系统
└── index.ts      # 导出
```

**Hook 生命周期**：

```
before_agent_start → agent_end → message_received → 
before_tool_call → after_tool_call → message_sending → session_end
```

## 数据流

### 对话流程

```
User (Telegram/Gateway)
        │
        ▼
┌─────────────────────┐
│   Channel Handler   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   AgentService      │
│  ┌───────────────┐  │
│  │ Load Bootstrap │  │ ← SOUL.md, USER.md, TOOLS.md, AGENTS.md
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ Build Prompt  │  │ ← memory_search/memory_get
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ LLM (pi-ai)   │  │
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ Execute Tools │  │ ← Tools (filesystem, shell, web, memory...)
│  │ + Plugins     │  │
│  └───────┬───────┘  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Response          │
└──────────┬──────────┘
           │
           ▼
User Reply / Channel Response
```

## CLI 命令注册模式

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
  name: 'mycommand',
  description: 'My command',
  factory: createMyCommand,
  metadata: { category: 'utility' },
});
```

## 扩展点

### 添加新工具

1. 在 `src/agent/tools/` 创建新文件
2. 实现 `AgentTool` 接口
3. 导出并在 `src/agent/tools/index.ts` 注册
4. 在 `AgentService` 中添加到 tools 数组

### 添加 Hook

```typescript
api.registerHook('before_tool_call', async (event, ctx) => {
  // 拦截工具调用
  return { modified: true };
});
```

### 添加插件

1. 创建 `xopcbot.plugin.json` manifest
2. 实现 `register(api)` 函数
3. 发布或本地加载

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js 22+ |
| 语言 | TypeScript 5.x |
| LLM SDK | @mariozechner/pi-ai |
| CLI | Commander.js |
| Telegram | node-telegram-bot-api |
| 验证 | Zod + TypeBox |
| 日志 | Pino |
| 定时任务 | node-cron |
| HTTP Server | Hono |
