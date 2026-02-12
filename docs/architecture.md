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
│  │                     Core                            │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │   │
│  │  │ Agent   │ │ Session  │ │ Memory  │ │ Subagent│   │   │
│  │  │ Loop    │ │ Manager  │ │ Store   │ │         │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Providers                        │   │
│  │            @mariozechner/pi-ai (20+ providers)      │   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
└────────────────────────────┼────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
  ┌──────────┐        ┌──────────┐        ┌──────────┐
  │Telegram  │        │WhatsApp  │        │ Gateway  │
  │ Channel  │        │ Channel  │        │   API   │
  └──────────┘        └──────────┘        └──────────┘
```

## 模块说明

### CLI Layer (`src/cli/`)

命令行入口，负责解析和分发命令。

| 模块 | 职责 |
|------|------|
| `core.ts` | CLI 核心逻辑 |
| `commands/` | 具体命令实现 |
| `index.ts` | 入口点 |

### Agent Core (`src/agent/`)

核心 Agent 逻辑。

```
src/agent/
├── loop.ts         # Agent 主循环 (LLM ↔ 工具)
├── context.ts      # 上下文构建
├── memory.ts       # 记忆存储
├── skills.ts       # 技能加载
└── tools/          # 内置工具
    ├── base.ts
    ├── registry.ts
    ├── filesystem.ts
    ├── shell.ts
    ├── web_search.ts
    ├── web_fetch.ts
    └── ...
```

**Agent Loop 流程**：

```
1. 接收用户消息
       ↓
2. 构建上下文 (消息历史 + 技能)
       ↓
3. 调用 LLM (pi-ai)
       ↓
4. LLM 返回响应
       ↓
5. 解析工具调用 (如有)
       ↓
6. 执行工具
       ↓
7. 返回结果给 LLM
       ↓
8. 返回最终回复
```

### Providers (`src/providers/`)

LLM 提供商抽象层，基于 `@mariozechner/pi-ai`。

```
src/providers/
└── pi-ai.ts        # PiAIProvider 适配器
```

**支持的提供商**：

| 提供商 | 类型 |
|--------|------|
| OpenAI | 官方 API |
| Anthropic | 官方 API |
| Google | Gemini API |
| Groq | OpenAI 兼容 |
| MiniMax | 官方 API |
| OpenRouter | OpenAI 兼容 |
| + 更多 | via pi-ai |

### Channels (`src/channels/`)

通信通道实现。

```
src/channels/
├── base.ts         # 通道基类
├── manager.ts      # 通道管理
├── telegram.ts     # Telegram 实现
└── whatsapp.ts     # WhatsApp 实现 (占位)
```

### Services (`src/`)

后台服务。

```
src/
├── cron/           # 定时任务
│   ├── service.ts
│   └── index.ts
├── heartbeat/      # 心跳监控
│   ├── service.ts
│   └── index.ts
└── bus/            # 事件总线
    └── index.ts
```

### Session (`src/session/`)

会话管理。

```
src/session/
├── manager.ts      # 会话管理器
└── index.ts
```

### Plugins (`src/plugins/`)

插件系统。

```
src/plugins/
├── types.ts        # 类型定义
├── api.ts          # Plugin API
├── loader.ts       # 插件加载器
├── hooks.ts        # Hook 系统
└── index.ts       # 导出
```

**Hook 生命周期**：

```
┌────────────────────────────────────────────────┐
│                  Lifecycle                     │
├────────────────────────────────────────────────┤
│ before_agent_start                            │
│      ↓                                        │
│ agent_end                                     │
│      ↓                                        │
│ message_received                              │
│      ↓                                        │
│ before_tool_call                              │
│      ↓                                        │
│ after_tool_call                               │
│      ↓                                        │
│ message_sending                                │
│      ↓                                        │
│ session_end                                    │
└────────────────────────────────────────────────┘
```

### Config (`src/config/`)

配置管理。

```
src/config/
├── loader.ts       # 配置加载
├── schema.ts       # Zod Schema
└── index.ts
```

## 数据流

### 对话流程

```
User (Telegram/WhatsApp/API)
        │
        ▼
┌─────────────────────┐
│   Channel Handler   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Session Manager   │  ← Load history
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Agent Loop        │
│  ┌───────────────┐  │
│  │ Build Context │  │
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ LLM (pi-ai)   │  │
│  └───────┬───────┘  │
│          ▼          │
│  ┌───────────────┐  │
│  │ Execute Tools │  │  ← Tools (filesystem, shell, web...)
│  └───────┬───────┘  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Response          │
└──────────┬──────────┘
           │
           ▼
User Reply
```

### 文件结构

```
xopcbot/
├── src/
│   ├── agent/          # 核心 Agent
│   │   ├── loop.ts    #   主循环
│   │   ├── context.ts #   上下文
│   │   ├── tools/     #   工具
│   │   └── skills/    #   技能
│   ├── bus/           # 事件总线
│   ├── channels/      # 通道
│   ├── cli/           # CLI
│   ├── config/        # 配置
│   ├── cron/          # 定时任务
│   ├── heartbeat/     # 心跳
│   ├── plugins/       # 插件
│   ├── providers/     # LLM
│   ├── session/       # 会话
│   ├── types/         # 类型
│   └── main.ts        # 入口
├── docs/              # 文档
├── scripts/           # 脚本
├── package.json
└── tsconfig.json
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Node.js 22+ |
| 语言 | TypeScript 5.x |
| LLM SDK | @mariozechner/pi-ai |
| CLI | Commander.js |
| Telegram | node-telegram-bot-api |
| 验证 | Zod |
| 日志 | Pino |
| 定时任务 | node-cron |
| HTTP Server | Hono |

## 扩展点

### 添加新通道

1. 继承 `BaseChannel` 类
2. 实现 `start()`, `stop()`, `send()` 方法
3. 注册到 Channel Manager

### 添加新工具

1. 继承 `Tool` 类
2. 实现 `name`, `description`, `parameters`
3. 实现 `execute()` 方法
4. 注册到 Tool Registry

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
