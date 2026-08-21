# 会话管理

xopc 提供全面的会话管理功能，支持通过 CLI 和 Web UI 管理对话历史。

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
| 数据库 | `~/.xopc/xopc.db`（SQLite，WAL） |
| 主要表 | `sessions`、`transcripts`、`transcript_entries`、`session_config`、`transcript_fts`（FTS5） |
| 会话级覆盖配置 | SQLite `session_config`（模型、thinking、verbose 等） |
| 遗留路径 | 旧版可能在 `agents/<agentId>/sessions/` 留有文件；新安装不再向该目录写入 transcript |

会话元数据、追加式压缩边界、transcript 行与全文检索均存储在 SQLite 中。压缩边界是 `transcript_entries` 中的强类型行。网关启动时打开数据库（`openXopcDatabase()`）。

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
xopc session list

# 按状态筛选
xopc session list --status active
xopc session list --status archived
xopc session list --status pinned

# 按名称或内容搜索
xopc session list --query "project"

# 排序和限制
xopc session list --sort updatedAt --order desc --limit 50
```

### 查看会话详情

```bash
# 显示会话信息和最近消息
xopc session info telegram:123456

# 在会话内搜索
xopc session grep telegram:123456 "API design"
```

### 管理会话

```bash
# 重命名会话
xopc session rename telegram:123456 "Project Discussion"

# 添加标签
xopc session tag telegram:123456 work important

# 移除标签
xopc session untag telegram:123456 important

# 归档会话
xopc session archive telegram:123456

# 取消归档
xopc session unarchive telegram:123456

# 置顶会话
xopc session pin telegram:123456

# 取消置顶
xopc session unpin telegram:123456

# 删除会话
xopc session delete telegram:123456

# 导出会话为 JSON
xopc session export telegram:123456 \
  --format json \
  --output backup.json
```

### 批量操作

```bash
# 按筛选条件删除多个会话
xopc session delete-many --status archived --force

# 归档旧会话（30+ 天未活动）
xopc session cleanup --days 30
```

### 统计信息

```bash
xopc session stats
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
# 安装并启动网关 OS 服务（或前台运行：xopc gateway）
xopc gateway service install
xopc gateway service start

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

## 自动维护

### 压缩

当完整模型输入达到配置阈值，或活动 transcript 超过字节上限时：

1. 按完整用户轮次与工具调用单元规划压缩范围，不拆分工具调用及其结果。
2. 使用配置的摘要模型生成分块、结构化摘要，同时原样保留最近轮次与最近 token 尾部。
3. 质量门检查必需章节与精确标识符；失败时依次尝试配置的候选模型。
4. 将精简后的模型上下文作为压缩边界追加到 `transcript_entries`；原始 transcript 行继续用于展示、导出和搜索。
5. 摘要生成或质量检查失败时关闭式失败，不覆盖原始模型上下文。

重复压缩只会替换模型输入中的有效边界，磁盘 transcript 仍保持追加式。可通过边界 ID 进行逻辑恢复，不删除历史行。

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

1. 检查 gateway 是否运行：`xopc gateway status`
2. 在浏览器开发者工具 **Network** 中确认 `/api/sessions` REST 请求成功，并且 **`/api/realtime/v1/ws`** WebSocket 保持连接
3. 检查 gateway 日志中的错误

### 会话存储异常

运行深度完整性检查：

```bash
xopc doctor --deep
```

会校验 `sessions` 与 `transcripts` 的 SQLite 关联、扫描孤立 transcript，并执行 `PRAGMA integrity_check`。

### 会话丢失

若已创建会话但界面未显示：

```bash
xopc session list --limit 1000
```

检查 gateway 日志，并确认 `~/.xopc/xopc.db` 存在且可写。

---

## API 参考

网关在 **`/api/sessions`** 下提供会话快照与命令的 **HTTP JSON API**（需认证）；实时更新与运行输出使用 **`/api/realtime/v1/ws`** WebSocket。

### 网关 HTTP 路由（摘要）

| 操作 | HTTP |
|------|------|
| 列出 / 筛选 / 搜索 | `GET /api/sessions`（`status`、`search`、`channel`、`limit`、`offset` 等） |
| 统计 | `GET /api/sessions/stats` |
| 获取会话 | `GET /api/sessions/:key` |
| 更新元数据（如标签） | `PATCH /api/sessions/:key` |
| 创建会话 | `POST /api/sessions` |
| 重命名 | `POST /api/sessions/:key/rename` |
| 归档 / 取消归档 | `POST /api/sessions/:key/archive` · `POST /api/sessions/:key/unarchive` |
| 置顶 / 取消置顶 | `POST /api/sessions/:key/pin` · `POST /api/sessions/:key/unpin` |
| 导出 | `GET /api/sessions/:key/export` |
| 删除 | `DELETE /api/sessions/:key` |

在会话正文里搜索可用 CLI：`xopc session grep <sessionKey> <pattern>`。
