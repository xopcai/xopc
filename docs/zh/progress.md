# 进度反馈

> 长程任务实时进度反馈

## 概述

进度反馈系统为长时间运行的代理任务提供实时更新。它帮助用户了解代理正在做什么，减少在复杂操作期间的"卡住"或"无响应"感知。

## 功能特性

### 1. 工具执行反馈

当代理执行工具（读取、写入、执行命令、搜索等）时，用户会收到实时状态更新：

| 阶段 | Emoji | 说明 |
|------|-------|------|
| thinking | 🤔 | AI 正在思考/推理 |
| searching | 🔍 | 搜索或 grep 操作 |
| reading | 📖 | 读取磁盘文件 |
| writing | ✍️ | 写入或编辑文件 |
| executing | ⚙️ | 执行 shell 命令 |
| analyzing | 📊 | 分析数据 |

### 2. 进度阶段

系统自动将工具名称映射到适当的进度阶段：

```
工具名称           → 阶段
────────────────────────────
read_file          → reading
glob               → reading  
grep               → searching
web_search         → searching
bash               → executing
write_file         → writing
edit               → writing
```

### 3. 长任务心跳

对于超过 30 秒的任务，系统会发送定期心跳消息：

```
🔍 搜索中...
⏱️ 已进行 45 秒
```

心跳在 30 秒阈值后每 20 秒发送一次。

### 4. 流式集成

对于 Telegram 频道，进度指示器与流式消息一起显示：

```
🔍 搜索中

正在搜索: "how to build a react app"
```

## 配置

### 反馈级别

可以在进度管理器中配置反馈详细程度：

```typescript
const config = {
  // 反馈级别: minimal | normal | verbose
  level: 'normal',
  
  // 显示思考/推理更新
  showThinking: true,
  
  // 实时流式传输工具进度
  streamToolProgress: true,
  
  // 启用长任务心跳
  heartbeatEnabled: true,
  
  // 心跳间隔（毫秒）
  heartbeatIntervalMs: 20000,
  
  // "长任务"阈值（毫秒）
  longTaskThresholdMs: 30000,
};
```

### Telegram 流模式

在 `config.json` 中配置流行为：

```json
{
  "channels": {
    "telegram": {
      "accounts": {
        "default": {
          "streamMode": "partial"
        }
      }
    }
  }
}
```

| 模式 | 说明 |
|------|------|
| `off` | 不流式传输，一次性发送完整消息 |
| `partial` | 流式传输 AI 响应，为工具显示进度指示器 |
| `block` | 完整流式传输，包含所有中间更新 |

## 工作原理

### 事件流程

```
用户消息
    ↓
代理处理
    ↓
┌─────────────────────────────────────────────┐
│ 1. tool_execution_start                     │
│    → 在流上设置进度阶段                     │
│    → 显示 "🔍 搜索中" 指示器               │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ 2. tool_execution_update                    │
│    → （可选）流式传输部分结果               │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ 3. tool_execution_end                       │
│    → 清除进度指示器                         │
│    → 发送最终响应                           │
└─────────────────────────────────────────────┘
    ↓
任务完成
```

### 关键组件

| 组件 | 文件 | 说明 |
|------|------|------|
| `ProgressFeedbackManager` | `src/agent/progress.ts` | 核心进度跟踪和回调 |
| `DraftStream` | `src/channels/draft-stream.ts` | 带进度的 Telegram 消息流式传输 |
| `AgentService` | `src/agent/service.ts` | 将进度与代理事件集成 |

## API 参考

### ProgressFeedbackManager

```typescript
import { ProgressFeedbackManager, progressFeedbackManager } from './agent/progress';

const manager = new ProgressFeedbackManager({
  level: 'normal',
  showThinking: true,
  streamToolProgress: true,
  heartbeatEnabled: true,
});

// 设置进度事件回调
manager.setCallbacks({
  onProgress: (msg) => console.log(msg),
  onStreamStart: (toolName, args) => console.log(`开始: ${toolName}`),
  onStreamEnd: (toolName, result, isError) => console.log(`结束: ${toolName}`),
  onHeartbeat: (elapsed, stage) => console.log(`仍在工作中... ${elapsed}ms`),
});

// 触发进度更新
manager.startTask();
manager.onToolStart('read_file', { path: '/some/file.txt' });
manager.onToolEnd('read_file', { content: '...' });
manager.endTask();
```

### ProgressMessage

```typescript
interface ProgressMessage {
  type: 'start' | 'update' | 'complete' | 'error' | 'thinking';
  stage: ProgressStage;
  message: string;
  detail?: string;
  toolName?: string;
}

type ProgressStage = 'thinking' | 'searching' | 'reading' | 'writing' | 'executing' | 'analyzing' | 'idle';
```

## 故障排除

### 没有进度更新

1. **检查流模式**: 确保在配置中 `streamMode` 设置为 `partial` 或 `block`
2. **检查日志**: 查找 `ProgressFeedback` 或 `DraftStream` 日志
3. **检查频道支持**: 进度更新仅适用于 Telegram（目前）

### 更新太多

降低反馈详细程度：

```typescript
const manager = new ProgressFeedbackManager({
  level: 'minimal',  // 只显示错误
  streamToolProgress: false,  // 不流式传输工具更新
  heartbeatEnabled: false,  // 禁用心跳
});
```

## 相关文档

- [频道配置](channels.md) - Telegram 频道配置
- [架构设计](architecture.md) - 系统架构概述
