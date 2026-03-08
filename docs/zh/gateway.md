# Gateway API

REST API 网关，用于外部程序与 xopcbot 交互。

## 启动网关

### 前台模式（推荐）

```bash
xopcbot gateway --port 18790
```

默认端口：`18790`

网关默认在前台运行，按 `Ctrl+C` 停止。

### 强制启动（终止现有进程）

如果端口已被占用，使用 `--force` 自动终止现有进程：

```bash
xopcbot gateway --force
```

这将：
1. 向监听端口的进程发送 SIGTERM
2. 等待 700ms 优雅关闭
3. 如仍在运行则发送 SIGKILL
4. 启动新的网关实例

## 进程管理命令

### 查看状态

```bash
xopcbot gateway status
```

输出示例：
```
✅ Gateway is running

   Port: 18790

🌐 Access:
   URL: http://localhost:18790
   Token: abc12345...xyz67890

📝 Management:
   xopcbot gateway stop      # 停止网关
   xopcbot gateway restart   # 重启网关
```

### 停止网关

```bash
# 优雅停止（SIGTERM，5秒超时）
xopcbot gateway stop

# 强制停止（立即 SIGKILL）
xopcbot gateway stop --force

# 自定义超时（毫秒）
xopcbot gateway stop --timeout 3000
```

### 重启网关

```bash
# 发送 SIGUSR1 信号触发优雅重启
xopcbot gateway restart

# 强制重启（终止并重新启动）
xopcbot gateway restart --force
```

**注意**：SIGUSR1 重启需要设置环境变量 `XOPCBOT_ALLOW_SIGUSR1_RESTART=1`。

### 查看日志

```bash
# 查看最近 50 行
xopcbot gateway logs

# 查看指定行数
xopcbot gateway logs --lines 100

# 实时跟踪日志（类似 tail -f）
xopcbot gateway logs --follow
```

## 系统服务管理

xopcbot 支持将网关作为系统服务运行，实现开机自动启动。

### 支持的平台

| 平台 | 服务类型 |
|------|----------|
| Linux | systemd 用户服务 |
| macOS | LaunchAgent |
| Windows | 任务计划程序 |

### 安装为系统服务

```bash
xopcbot gateway install
```

**选项**：

| 选项 | 描述 |
|------|------|
| `--port <number>` | 网关端口 (默认: 18790) |
| `--host <address>` | 绑定地址 (默认: 0.0.0.0) |
| `--token <token>` | 认证令牌 |
| `--runtime <runtime>` | 运行时: node 或 binary (默认: node) |

**示例**：

```bash
xopcbot gateway install --port 8080 --token my-secret-token
```

安装后，网关将在登录时自动启动。

### 服务命令

```bash
# 通过系统服务启动
xopcbot gateway service-start

# 查看服务状态
xopcbot gateway service-status

# 卸载系统服务
xopcbot gateway uninstall
```

### 服务状态输出

```bash
xopcbot gateway service-status
```

示例输出：
```
📋 Service Status
────────────────
Installed: Yes
Status: running
PID: 12345

📝 Configuration
────────────────
Program: node
Args: /path/to/xopcbot gateway --port 18790
Working Dir: /home/user

🌐 Access
─────────
URL: http://localhost:18790

📝 Commands
───────────
  xopcbot gateway service-start   # 启动服务
  xopcbot gateway stop            # 停止（进程）
  xopcbot gateway restart         # 重启（进程）
  xopcbot gateway uninstall      # 移除服务
```

## 进程架构

### Gateway Lock

使用文件锁替代 PID 文件：

- **位置**：`~/.xopcbot/locks/gateway.{hash}.lock`
- **哈希**：配置路径的 SHA256（支持多配置）
- **内容**：`{ pid, createdAt, configPath, startTime }`

### 运行循环

```
┌─────────────────────────────────────────┐
│              运行循环                    │
├─────────────────────────────────────────┤
│  1. 获取 Gateway Lock                   │
│  2. 启动 Gateway Server                 │
│  3. 等待信号                            │
│     - SIGTERM/SIGINT -> 停止            │
│     - SIGUSR1 -> 重启                   │
│  4. 优雅关闭（5秒超时）                  │
│  5. 释放锁                              │
│  6. 退出或重新生成进程                   │
└─────────────────────────────────────────┘
```

### 进程重生

重启时：
1. 检测环境（受监督 vs 普通）
2. 如受监督：退出让监督器重启
3. 如普通：生成分离的子进程，然后退出

### 端口管理

```bash
# 检查端口是否可用
lsof -i :18790

# 强制释放端口（SIGTERM -> SIGKILL）
xopcbot gateway --force
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
# 启动网关（前台）
xopcbot gateway

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

## 锁文件

网关锁文件位置：`~/.xopcbot/locks/gateway.{hash}.lock`

哈希基于配置文件路径，允许不同配置运行多个网关。

### 端口冲突检测

启动时会自动检测端口占用，如果端口已被占用：

```
❌ Port 18790 is already in use. Use --force to kill existing process.
```

使用 `--force` 自动终止现有进程：

```bash
xopcbot gateway --force
```

### 优雅关闭

网关支持优雅关闭：
1. 收到停止信号后，等待 5 秒让现有请求完成
2. 如果 5 秒后仍有请求，强制终止
3. 自动释放锁文件

可通过 `--timeout` 参数自定义超时时间：

```bash
xopcbot gateway stop --timeout 10000  # 10 秒超时
```

## 环境变量

| 变量 | 描述 |
|------|------|
| `XOPCBOT_NO_RESPAWN` | 禁用进程重生，使用进程内重启 |
| `XOPCBOT_ALLOW_SIGUSR1_RESTART` | 允许 SIGUSR1 触发重启 |
| `XOPCBOT_SERVICE_MARKER` | 标记在监督器下运行（systemd/launchd） |

## CORS 配置

如需从浏览器访问，添加 CORS 头（通过代理或中间件）。

## 从旧版本迁移

如果你之前使用后台模式：

1. 停止旧网关：
   ```bash
   ps aux | grep xopcbot
   kill -9 <PID>
   rm ~/.xopcbot/gateway.pid
   ```

2. 启动新网关：
   ```bash
   xopcbot gateway
   ```

3. 使用 `Ctrl+C` 停止，或从另一个终端运行 `xopcbot gateway stop`。
