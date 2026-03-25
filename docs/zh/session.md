# 会话管理

xopcbot 提供全面的会话管理功能，支持通过 CLI 和 Web UI 管理对话历史。

---

## 功能概览

| 功能 | CLI | Web UI |
|------|-----|--------|
| 列出会话 | ✅ | ✅ |
| 搜索会话 | ✅ | ✅ |
| 查看详情 | ✅ | ✅ |
| 归档/取消归档 | ✅ | ✅ |
| 置顶/取消置顶 | ✅ | ✅ |
| 导出 (JSON) | ✅ | ✅ |
| 删除 | ✅ | ✅ |
| 会话内搜索 | ❌ | ✅ |

---

## 会话存储

| 属性 | 值 |
|------|-----|
| 存储目录 | `workspace/.sessions/` |
| 索引文件 | `workspace/.sessions/index.json` |
| 文件格式 | JSON |
| 归档目录 | `workspace/.sessions/archive/` |

---

## 会话状态

| 状态 | 描述 |
|------|------|
| `active` | 当前活动会话（默认） |
| `pinned` | 置顶会话，快速访问 |
| `archived` | 已归档，移动到归档文件夹 |

---

## CLI 使用

### 列出会话

```bash
# 列出所有会话
xopcbot session list

# 按状态筛选
xopcbot session list --status active
xopcbot session list --status archived
xopcbot session list --status pinned

# 按名称或内容搜索
xopcbot session list --query "project"

# 排序和限制
xopcbot session list --sort updatedAt --order desc --limit 50
```

### 查看会话详情

```bash
# 显示会话信息和最近消息
xopcbot session info telegram:123456

# 在会话内搜索
xopcbot session grep telegram:123456 "API design"
```

### 管理会话

```bash
# 重命名会话
xopcbot session rename telegram:123456 "Project Discussion"

# 添加标签
xopcbot session tag telegram:123456 work important

# 移除标签
xopcbot session untag telegram:123456 important

# 归档会话
xopcbot session archive telegram:123456

# 取消归档
xopcbot session unarchive telegram:123456

# 置顶会话
xopcbot session pin telegram:123456

# 取消置顶
xopcbot session unpin telegram:123456

# 删除会话
xopcbot session delete telegram:123456

# 导出会话为 JSON
xopcbot session export telegram:123456 \
  --format json \
  --output backup.json
```

### 批量操作

```bash
# 按筛选条件删除多个会话
xopcbot session delete-many --status archived --force

# 归档旧会话（30+ 天未活动）
xopcbot session cleanup --days 30
```

### 统计信息

```bash
xopcbot session stats
```

**示例输出：**
```
📊 会话统计

  总会话数:     42
  活动:         28
  已归档:       12
  置顶:         2
  总消息数:     1,847
  总 Token:     452.3k

  按通道:
    telegram: 35
    gateway: 5
    cli: 2
```

---

## Web UI

Web UI 在网关根路径提供可视化会话管理（hash 路由，会话列表为 `#/sessions`）。

### 功能

1. **会话列表**: 网格/列表视图，支持筛选
2. **搜索**: 跨会话实时搜索
3. **筛选器**: 按状态筛选（全部/活动/置顶/归档）
4. **统计**: 可视化统计卡片
5. **详情抽屉**: 点击任意会话查看：
   - 完整消息历史
   - 会话内搜索（高亮显示）
   - 归档/置顶/导出/删除操作

### 访问 UI

```bash
# 启动 gateway
xopcbot gateway start

# 在浏览器中打开
open http://localhost:18790/#/sessions
```

---

## 会话结构

```typescript
interface SessionMetadata {
  key: string;              // 唯一标识符
  name?: string;            // 可选自定义名称
  status: 'active' | 'idle' | 'archived' | 'pinned';
  tags: string[];           // 用户定义的标签
  createdAt: string;        // ISO 时间戳
  updatedAt: string;
  lastAccessedAt: string;
  messageCount: number;
  estimatedTokens: number;
  compactedCount: number;   // 压缩次数
  sourceChannel: string;    // telegram, gateway, cli
  sourceChatId: string;
}

interface SessionDetail extends SessionMetadata {
  messages: Message[];
}

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'toolResult';
  content: string;
  timestamp?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
}
```

---

## 会话索引

`index.json` 文件维护所有会话元数据的缓存：

```json
{
  "version": "1.0",
  "lastUpdated": "2026-02-14T10:00:00Z",
  "sessions": [
    {
      "key": "telegram:123456",
      "status": "active",
      "tags": ["work"],
      "messageCount": 42,
      ...
    }
  ]
}
```

---

## 自动维护

### 压缩

当会话超出上下文窗口限制时：

1. 使用 LLM 摘要早期消息
2. 保留最近消息（默认：最后 10 条）
3. 始终保留系统消息

在 `config.json` 中配置：

```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "enabled": true,
        "mode": "abstractive",
        "triggerThreshold": 0.8,
        "keepRecentMessages": 10
      }
    }
  }
}
```

**压缩模式：**
- `extractive` - 使用关键句摘要
- `abstractive` - 基于 LLM 的摘要
- `structured` - 保留结构化数据

### 滑动窗口

防止内存问题：
- 最大消息数：100
- 超出限制时保留最近消息
- 保留系统上下文

---

## 最佳实践

1. **使用标签**: 按项目或主题标记会话
2. **置顶重要会话**: 将常用会话置顶
3. **归档旧会话**: 归档不常用的会话
4. **定期清理**: 使用 `session cleanup` 清理旧会话
5. **删除前导出**: 删除重要会话前先导出

---

## 故障排除

### Web UI 无法加载会话

1. 检查 gateway 是否运行：`xopcbot gateway status`
2. 在浏览器控制台验证 WebSocket 连接
3. 检查 gateway 日志中的错误

### 会话索引损坏

索引将在下次访问时自动重建。强制重建：

```bash
# 删除索引文件
rm workspace/.sessions/index.json

# 下次列出会话时会重建
xopcbot session list
```

### 会话丢失

如果 `.sessions/` 中存在但无法显示：

```bash
# 通过迁移强制重建索引
xopcbot session list --limit 1000
```

---

## API 参考

### WebSocket API 方法

| 方法 | 描述 |
|------|------|
| `session.list` | 分页列出会话 |
| `session.get` | 获取会话详情 |
| `session.delete` | 删除会话 |
| `session.rename` | 重命名会话 |
| `session.tag` | 添加标签 |
| `session.untag` | 移除标签 |
| `session.archive` | 归档会话 |
| `session.unarchive` | 取消归档 |
| `session.pin` | 置顶会话 |
| `session.unpin` | 取消置顶 |
| `session.search` | 搜索会话 |
| `session.searchIn` | 会话内搜索 |
| `session.export` | 导出会话 |
| `session.stats` | 获取统计信息 |
