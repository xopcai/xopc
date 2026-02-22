# Gateway API

REST API 网关，用于外部程序与 xopcbot 交互。

## 启动网关

```bash
xopcbot gateway --port 18790
```

默认端口：`18790`

## API 端点

### 发送消息

```http
POST /api/message
Content-Type: application/json

{
  "channel": "telegram",
  "chat_id": "123456789",
  "content": "Hello from API!"
}
```

**响应**：

```json
{
  "status": "ok",
  "message_id": "abc123"
}
```

### 发送消息 (同步)

```http
POST /api/message/sync
Content-Type: application/json

{
  "channel": "telegram",
  "chat_id": "123456789",
  "content": "Hello and reply!"
}
```

**响应**：

```json
{
  "status": "ok",
  "reply": "Hello! How can I help?"
}
```

### Agent 对话

```http
POST /api/agent
Content-Type: application/json

{
  "message": "What is the weather?",
  "session": "default"
}
```

**响应**：

```json
{
  "status": "ok",
  "reply": "The weather is sunny...",
  "session": "default"
}
```

### 触发 Cron 任务

```http
POST /api/cron/trigger
Content-Type: application/json

{
  "job_id": "abc123"
}
```

**响应**：

```json
{
  "status": "ok",
  "message": "Task triggered"
}
```

### 健康检查

```http
GET /health
```

**响应**：

```json
{
  "status": "healthy",
  "uptime": 3600
}
```

## 完整 API 列表

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/message` | 发送消息 (异步) |
| POST | `/api/message/sync` | 发送消息 (同步) |
| POST | `/api/agent` | Agent 对话 |
| GET | `/api/sessions` | 列出会话 |
| GET | `/api/sessions/:key` | 获取会话 |
| DELETE | `/api/sessions/:key` | 删除会话 |
| GET | `/api/cron` | 列出定时任务 |
| POST | `/api/cron/trigger` | 触发任务 |
| GET | `/health` | 健康检查 |

## 错误响应

所有 API 错误格式：

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid message content"
  }
}
```

**错误码**：

| 错误码 | 描述 |
|--------|------|
| `INVALID_REQUEST` | 请求参数错误 |
| `CHANNEL_NOT_FOUND` | 通道不存在 |
| `SESSION_NOT_FOUND` | 会话不存在 |
| `AGENT_ERROR` | Agent 处理错误 |
| `INTERNAL_ERROR` | 内部错误 |

## 使用示例

### cURL

```bash
# 发送消息
curl -X POST http://localhost:18790/api/message \
  -H "Content-Type: application/json" \
  -d '{"channel": "telegram", "chat_id": "123", "content": "Hello!"}'

# Agent 对话
curl -X POST http://localhost:18790/api/agent \
  -H "Content-Type: application/json" \
  -d '{"message": "What is 2+2?"}'

# 健康检查
curl http://localhost:18790/health
```

### JavaScript/Node.js

```javascript
async function sendMessage(content, chatId) {
  const res = await fetch('http://localhost:18790/api/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: 'telegram',
      chat_id: chatId,
      content: content
    })
  });
  return res.json();
}

async function chatWithAgent(message) {
  const res = await fetch('http://localhost:18790/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  return res.json();
}
```

### Python

```python
import requests

def send_message(content, chat_id):
    resp = requests.post(
        'http://localhost:18790/api/message',
        json={
            'channel': 'telegram',
            'chat_id': chat_id,
            'content': content
        }
    )
    return resp.json()

def chat(message):
    resp = requests.post(
        'http://localhost:18790/api/agent',
        json={'message': message}
    )
    return resp.json()
```

## Webhook 集成

支持接收 webhook 回调：

```http
POST /api/webhook/:channel
Content-Type: application/json

{
  "event": "message",
  "data": { ... }
}
```

## 认证

⚠️ 当前版本 API 无认证。

生产环境建议：
- 使用 Nginx/Traefik 添加 Basic Auth
- 或通过 `.env` 配置 API Key
- 限制可访问 IP

## 配置

```json
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790
  }
}
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `host` | `0.0.0.0` | 绑定地址 |
| `port` | `18790` | 端口号 |

## CORS 配置

如需从浏览器访问，添加 CORS 头（通过代理或中间件）。
