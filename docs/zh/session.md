# 会话管理

xopcbot 会自动管理对话会话，保持上下文连贯性。

## 会话存储

| 类型 | 位置 |
|------|------|
| 存储目录 | `~/.xopcbot/sessions/` |
| 文件格式 | JSON |

## 会话结构

```typescript
interface Session {
  key: string;           // 会话唯一标识
  messages: Message[];    // 消息历史
  created_at: string;    // 创建时间
  updated_at: string;    // 更新时间
  metadata?: Record<string, unknown>;  // 元数据
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
}
```

## 使用会话

### 默认会话

```bash
xopcbot agent -m "Hello"
```

使用默认会话键进行对话。

### 指定会话

```bash
xopcbot agent -m "Hello" --session my-chat
```

### 交互模式

```bash
xopcbot agent -i
```

按 `Ctrl+C` 退出交互模式。

## 会话生命周期

```
1. 创建会话 (如不存在)
       ↓
2. 加载历史消息
       ↓
3. 添加用户消息
       ↓
4. Agent 处理
       ↓
5. 保存助手回复
       ↓
6. 持久化到磁盘
```

## 消息角色

| 角色 | 用途 |
|------|------|
| `system` | 系统提示词 |
| `user` | 用户消息 |
| `assistant` | AI 回复 |
| `tool` | 工具调用结果 |

## 上下文窗口

Agent 默认使用完整会话历史。可以通过配置限制：

```json
{
  "agents": {
    "defaults": {
      "max_tokens": 8192
    }
  }
}
```

当消息过长时会自动压缩（compaction）。

## 会话压缩

当消息数量或 token 超过阈值时，会自动压缩：

1. **摘要早期消息**：保留关键信息
2. **移除冗余**：合并相似消息
3. **保留上下文**：确保对话连贯性

## 清空会话

### 通过 CLI

```bash
# 删除指定会话
rm ~/.xopcbot/sessions/<session-key>.json

# 清空所有会话
rm ~/.xopcbot/sessions/*.json
```

### 通过代码

```typescript
import { SessionManager } from '../session/manager.js';

const manager = new SessionManager();
manager.clearSession('my-chat');
```

## 最佳实践

1. **定期清理**：删除不需要的历史会话
2. **会话隔离**：不同项目使用不同会话键
3. **敏感信息**：避免在会话中存储敏感数据
4. **备份重要会话**：手动备份到安全位置

## 文件格式

会话文件示例 (`~/.xopcbot/sessions/default.json`)：

```json
{
  "key": "default",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Hello!"
    },
    {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    }
  ],
  "created_at": "2026-02-03T12:00:00.000Z",
  "updated_at": "2026-02-03T12:00:01.000Z",
  "metadata": {}
}
```

## 故障排除

**会话丢失？**
- 检查 `~/.xopcbot/sessions/` 目录存在
- 确认文件权限正确
- 查看日志中的错误信息

**上下文不连贯？**
- 确认会话未被意外清空
- 检查消息压缩是否过度
- 可能需要增加 `max_tokens` 配置

