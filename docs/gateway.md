# Gateway API

REST API 网关，用于外部程序与 xopcbot 交互。

## 启动网关

### 前台模式（Foreground Mode）

```bash
xopcbot gateway --port 18790
```

默认端口：`18790`

### 后台模式（Background Mode）

```bash
# 启动后台服务
xopcbot gateway --background

# 或简写
xopcbot gateway -b

# 指定日志文件
xopcbot gateway --background --log-file ~/.xopcbot/gateway.log
```

后台模式将网关作为守护进程运行，适合生产环境使用。

## 进程管理命令

### 查看状态

```bash
xopcbot gateway status
```

输出示例：
```
✅ Gateway is running

   PID: 12345
   Host: 0.0.0.0
   Port: 18790
   Uptime: 5m 32s
   Health: healthy

🌐 Access:
   URL: http://localhost:18790
   Token: abc12345...xyz67890
   Direct: http://localhost:18790?token=abc12345...
```

### 停止网关

```bash
# 优雅停止（默认 5 秒超时）
xopcbot gateway stop

# 强制停止
xopcbot gateway stop --force

# 自定义超时时间（毫秒）
xopcbot gateway stop --timeout 3000
```

### 重启网关

```bash
# 使用现有配置重启
xopcbot gateway restart

# 更改配置重启
xopcbot gateway restart --port 8080 --host 127.0.0.1
```

### 查看日志

```bash
# 查看最近 50 行
xopcbot gateway logs

# 查看指定行数
xopcbot gateway logs --lines 100

# 实时跟踪日志（类似 tail -f）
xopcbot gateway logs --follow
```

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
| GET | `/api/logs` | 查询日志（需认证） |
| POST | `/api/cron/create` | 创建定时任务 |
| DELETE | `/api/cron/:id` | 删除定时任务 |
| POST | `/api/cron/:id/toggle` | 启用/禁用定时任务 |

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

### 命令行管理

```bash
# 启动后台网关
xopcbot gateway --background

# 检查状态
xopcbot gateway status

# 查看日志
xopcbot gateway logs --lines 20

# 重启网关
xopcbot gateway restart

# 停止网关
xopcbot gateway stop
```

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

# 带认证的请求
curl -X POST http://localhost:18790/api/agent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"message": "Hello"}'
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
    "port": 18790,
    "auth": {
      "token": "your-secret-token"
    }
  }
}
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `host` | `0.0.0.0` | 绑定地址 |
| `port` | `18790` | 端口号 |
| `auth.token` | `null` | API 认证令牌（可选） |

## 后台模式配置

### PID 文件

后台模式运行时，PID 文件保存在：`~/.xopcbot/gateway.pid`

### 日志文件

默认日志位置：`~/.xopcbot/logs/gateway.log`

可通过 `--log-file` 参数自定义：

```bash
xopcbot gateway --background --log-file /var/log/xopcbot/gateway.log
```

### 端口冲突检测

启动时会自动检测端口占用，如果端口已被占用，会提示：

```
❌ Failed to start gateway
   Port 18790 is already in use.
   💡 Use a different port: xopcbot gateway --port 8080
   💡 Or stop the existing process first
```

### 优雅关闭

后台模式支持优雅关闭：
1. 收到停止信号后，等待 5 秒让现有请求完成
2. 如果 5 秒后仍有请求，强制终止进程
3. 自动清理 PID 文件

可通过 `--timeout` 参数自定义超时时间：

```bash
xopcbot gateway stop --timeout 10000  # 10 秒超时
```

## CORS 配置

如需从浏览器访问，添加 CORS 头（通过代理或中间件）。
