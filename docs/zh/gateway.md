# Gateway API

REST API 网关，用于外部程序与 xopc 交互。

## 启动网关

### 前台模式（推荐）

```bash
xopc gateway --port 18790
```

默认端口：`18790`

网关默认在前台运行，按 `Ctrl+C` 停止。

### 后台运行

需要终端立刻返回、网关常驻后台时：

```bash
xopc gateway --background
```

启动成功后会打印 **PID** 与 **URL**。之后用 **`xopc gateway status`**、**`xopc gateway stop`**、**`xopc gateway restart`**、**`xopc gateway logs`** 管理进程（见下文 [进程管理命令](#进程管理命令)）。

### 强制启动（终止现有进程）

如果端口已被占用，使用 `--force` 自动终止现有进程：

```bash
xopc gateway --force
```

这将：
1. 向监听端口的进程发送 SIGTERM
2. 等待 700ms 优雅关闭
3. 如仍在运行则发送 SIGKILL
4. 启动新的网关实例

## 进程管理命令

### 查看状态

```bash
xopc gateway status
```

输出示例：
```
✅ Gateway is running

   Port: 18790

🌐 Access:
   URL: http://localhost:18790
   Token: abc12345...xyz67890（网关访问令牌）

📝 Management:
   xopc gateway stop      # 停止网关
   xopc gateway restart   # 重启网关
```

### 停止网关

```bash
# 优雅停止（通过 OS 服务管理器发送 SIGTERM）
xopc gateway stop

# 停止并禁用 KeepAlive（网关不会自动重启）
xopc gateway stop --disable

# JSON 输出
xopc gateway stop --json
```

### 重启网关

```bash
# 通过 OS 服务管理器优雅重启
xopc gateway restart

# 强制重启（立即终止，KeepAlive 会自动重启新进程）
xopc gateway restart --force

# 重启后等待健康检查（指定超时）
xopc gateway restart --wait 30s

# JSON 输出
xopc gateway restart --json
```

重启流程：
1. 写入 **restart intent** 文件到磁盘
2. 通知 OS 服务管理器重启进程
3. 如指定 `--wait`，轮询服务运行状态 + 端口 + HTTP 健康检查直到确认健康
4. 清理 intent 文件

### 查看日志

```bash
# 查看最近 50 行
xopc gateway logs

# 查看指定行数
xopc gateway logs --lines 100

# 实时跟踪日志（类似 tail -f）
xopc gateway logs --follow
```

## 系统服务管理

xopc 支持将网关作为 OS 级服务运行，具备 **KeepAlive**（崩溃自动重启）、优雅重启协调、版本/令牌审计等能力。

### 支持的平台

| 平台 | 服务类型 | KeepAlive 机制 |
|------|----------|----------------|
| macOS | LaunchAgent | `SuccessfulExit=false` + ThrottleInterval 10s |
| Linux | systemd 用户服务 | `Restart=always` + RestartSec 5s |
| Windows | 任务计划程序 | RepetitionInterval 轮询 |

### 安装为系统服务

```bash
xopc gateway service install
```

**选项**：

| 选项 | 描述 |
|------|------|
| `--port <number>` | 网关端口（默认: 18790） |
| `--token <token>` | 认证令牌 |
| `--force` | 强制重装（已安装时） |
| `--json` | JSON 输出 |

**示例**：

```bash
xopc gateway service install --port 8080 --token my-secret-token
xopc gateway service install --force   # 以最新配置重装
```

安装后，网关会在登录时自动启动，崩溃后自动重启。

### 服务命令

```bash
# 安装 / 重装
xopc gateway service install [--force] [--port N] [--token T]

# 通过 OS 服务管理器启动
xopc gateway service start

# 查看 OS 服务状态（是否加载、运行 PID、版本）
xopc gateway service-status [--json]

# 卸载服务
xopc gateway service uninstall [--json]
```

### KeepAlive 与优雅停止

默认情况下，OS 服务管理器会在网关异常退出后 **自动重启**。如果想停止且不再重启：

```bash
xopc gateway stop --disable
```

这会卸载服务（macOS `bootout` / Linux `disable`），直到你显式启动或重装。

### 服务审计

`status` 命令会进行基本的服务健康检查：
- **版本不匹配**：已安装的服务版本 vs 当前 CLI 版本
- **令牌漂移**：服务内嵌令牌 vs 配置文件令牌
- **程序缺失**：安装时的二进制路径已不存在

检测到问题时会给出建议：
```
⚠️  令牌漂移：服务令牌与配置不一致。
💡 执行 `xopc gateway service install --force` 同步。
```

### 重启健康探测

使用 `--wait` 时，restart 命令会执行健康验证循环：

1. 轮询服务运行状态（PID）
2. 检查端口占用（确认新进程正在监听）
3. HTTP 探测 `/api/health` 端点
4. 验证版本匹配（可选）

```bash
xopc gateway restart --wait 30s
```

超时内健康检查失败会报告错误和诊断信息。

## 进程架构

### Gateway Lock

使用文件锁替代 PID 文件：

- **位置**：`~/.xopc/locks/gateway.{hash}.lock`
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

### 进程生命周期（Daemon 托管）

安装为系统服务后，网关的生命周期由 OS 管理：

| 事件 | macOS (LaunchAgent) | Linux (systemd) | Windows (Task) |
|------|---------------------|-----------------|----------------|
| 崩溃 | 10s 节流后重启 | 5s 后重启 | 轮询重启 |
| 优雅停止 | `launchctl kill SIGTERM` | `systemctl --user stop` | `schtasks /End` |
| 永久停止 | `bootout`（卸载服务） | `disable` + `stop` | `schtasks /End` |
| 强制重启 | `kickstart -k` | `systemctl restart` | Stop + Run |
| 主动退出（code 78） | 不重启 | `RestartPreventExitStatus=78` | — |

### 端口检查

daemon 使用跨平台端口检查来验证健康状态：

```bash
# 查看网关状态（含端口检查）
xopc gateway status

# 底层检查（macOS/Linux）
lsof -nP -iTCP:18790 -sTCP:LISTEN

# 强制释放端口
xopc gateway --force
```

## 频道启动与 HTTP 监听顺序 {#频道启动与-http-监听顺序}

使用前台 **`xopc gateway`**（`GatewayServer`）时，部分外连型通道会把 **`ChannelPlugin.start()`**（建立 Telegram polling、飞书 Socket 等）放到 **HTTP 已成功 `listen` 之后**，让 REST 与静态控制台先就绪：

1. **阶段一**：所有通道执行 **`init()`**；未延后列表中的通道立刻 **`start()`**。会话、cron、heartbeat、智能体服务与原先一致。若启用了延后策略，**出站消费循环**会在阶段二之后再启动，避免与尚未 `start` 的通道抢跑。
2. **阶段二**：在 HTTP **`listen`** 回调中，对延后通道执行 **`start()`**，再 **重放持久化出站队列**，最后启动出站处理器。

内置消息通道（**Telegram、微信、飞书**）在插件 meta 中声明延后；可通过 **`gateway.channelConnectDeferMode`** / **`channelConnectDeferIds`** / **`channelConnectDeferSkipIds`** 覆盖，详见 [配置说明 — 频道连接延后](configuration.md#频道连接延后)。

启动时会输出结构化 **`info`** 日志：`phase: "gateway.channel_startup"`，`stage: "phase1"` 或 `"phase2"`，含各阶段毫秒数、`channelConnectDeferMode`、`channelConnectDeferSource` 与 `deferredChannelIds`。

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

### 智能体对话

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

### 创建会话（`POST /api/sessions`）

创建或复用 Web 侧会话。请求体为 JSON，字段均可选：

| 字段 | 说明 |
|------|------|
| `channel` | 写入 session key 的来源段，默认 `webchat`。 |
| `chat_id` | 若指定，则使用该 peer id 构造会话键。 |
| `agentId` | 若指定，须为 **`agents.list` 中已启用**的 id；会话键第一段为该 agent。未指定时使用 **`agents.default`** 或列表中第一个启用的 id（见 [Session 路由](/zh/routing-system)）。 |

## 完整 API 列表

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/message` | 发送消息 (异步) |
| POST | `/api/message/sync` | 发送消息 (同步) |
| POST | `/api/agent` | 智能体对话 |
| POST | `/api/sessions` | 创建或复用会话（JSON 可含 `agentId`） |
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
| GET | `/api/providers` | 列出 LLM 提供方 |
| GET | `/api/models` | 列出可用模型 |
| GET | `/api/models-json` | 读取 models.json |
| PATCH | `/api/models-json` | 保存 models.json |
| GET | `/api/image/capabilities` | 图像生成 / 视觉能力快照（需认证） |
| POST | `/api/image/validate-model` | 校验 `provider/model` 引用（需认证） |
| GET | `/api/events` | Server-Sent Events 广播（需认证），包含 **`agent.stream`** 等事件，供网页控制台与扩展 iframe 消费 |
| GET | `/api/extensions` | 列出已发现扩展（含可选 `ui` 摘要）（需认证） |
| GET | `/api/extensions/:id` | 扩展详情与完整 manifest（需认证） |
| GET | `/api/extensions/:id/assets/*` | 扩展 UI 静态资源（HTML/JS/CSS；严格 CSP）（需认证） |
| GET | `/api/extensions/:id/storage` | 列出扩展 KV 存储键（需认证） |
| GET | `/api/extensions/:id/storage/:key` | 读取存储值（需认证） |
| PUT | `/api/extensions/:id/storage/:key` | 写入存储值（需认证） |
| DELETE | `/api/extensions/:id/storage/:key` | 删除存储键（需认证） |
| GET | `/api/extensions/:id/config` | 读取扩展作用域配置对象（需认证） |
| PATCH | `/api/extensions/:id/config` | 合并写入扩展作用域配置（需认证） |

`GET` / `PATCH` **`/api/config`**（需认证）会返回智能体默认项，其中包括 **`imageModel`**、**`imageGenerationModel`** 以及 **`imageModelFallbacks`**、**`imageGenerationModelFallbacks`**；`PATCH` 对图像字段支持与对话 **`model`** 相同的 **`{ primary, fallbacks }`** 对象形式。详见 [图像与视觉](image-multimodal.md)。

**扩展 UI：** manifest **`ui`**、**`@xopcai/extension-ui-sdk`**、`/api/events` 转发与权限说明见 [扩展系统 — 网关控制台：扩展 UI](extensions.md#gateway-extension-ui)。

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
| `AGENT_ERROR` | 智能体处理错误 |
| `INTERNAL_ERROR` | 内部错误 |

## 使用示例

### 命令行管理

```bash
# 启动网关（前台）
xopc gateway

# 检查状态
xopc gateway status

# 查看日志
xopc gateway logs --lines 20

# 重启网关
xopc gateway restart

# 停止网关
xopc gateway stop
```

### cURL

```bash
# 发送消息
curl -X POST http://localhost:18790/api/message \
  -H "Content-Type: application/json" \
  -d '{"channel": "telegram", "chat_id": "123", "content": "Hello!"}'

# 智能体对话
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

网关认证支持 3 种模式：
- `token`（默认）：通过 `Authorization: Bearer <token>` 或 `X-Api-Key` 传递凭证。
- `password`：密码模式（沿用同一传输与校验链路）。
- `none`：关闭认证（仅建议本地开发）。

### 配置认证（`token` 模式）

```json
{
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "${XOPC_GATEWAY_TOKEN}"
    }
  }
}
```

### 配置认证（`password` 模式）

```json
{
  "gateway": {
    "auth": {
      "mode": "password",
      "password": "${XOPC_GATEWAY_PASSWORD}"
    }
  }
}
```

### 认证相关环境变量

- `XOPC_GATEWAY_AUTH_MODE`（`none` | `token` | `password`）
- `XOPC_GATEWAY_TOKEN`
- `XOPC_GATEWAY_PASSWORD`

说明：
- `token` 与 `password` 互斥，同时配置会导致启动失败。
- `token` 模式下若未配置 token，会自动生成随机 token。
- token 比较采用常量时间比较，降低时序攻击风险。
- 示例占位/弱 token 与短 token（<16）会在启动时被拒绝。
- 启动时会执行安全审计（例如：非回环地址下 `mode: none`、`corsOrigins: ["*"]`、自动生成 token 告警）。

### 浏览器来源校验（CSRF 防护）

- 带 `Origin` 的浏览器请求会按 `gateway.corsOrigins` 校验来源。
- 支持同 host 回退与本地回环回退（用于受控本地开发场景）。
- 不带 `Origin` 的请求（CLI/服务间）跳过来源校验，改由认证层验证。

### 路由 Scope 校验

已认证 API 会做 operator scope 校验（`operator.read`、`operator.write`、`operator.admin`）。当前默认授予完整 operator scopes，这一层为后续细粒度权限收敛做准备。

### 认证失败限流

同一客户端 IP 的重复认证失败由 `gateway.auth.rateLimit`（启用时）统计；超过阈值后网关返回 **429 Too Many Requests** 并携带 `Retry-After`，以降低撞库与滥用风险。

## 配置

```json
{
  "gateway": {
    "host": "127.0.0.1",
    "port": 18790,
    "auth": {
      "mode": "token",
      "token": "${XOPC_GATEWAY_TOKEN}",
      "rateLimit": {
        "enabled": true,
        "maxAttempts": 5,
        "windowMs": 900000,
        "blockDurationMs": 300000
      }
    },
    "corsOrigins": ["http://localhost:5173"]
  }
}
```

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `bind` | `loopback` | 绑定模式（`loopback`、`lan`、`auto`、`tailnet`、`custom`） |
| `customBindHost` | - | 当 `bind` 为 `custom` 时的 IPv4 监听地址 |
| `port` | `18790` | 端口号 |
| `auth.mode` | `token` | 认证模式（`none` / `token` / `password`） |
| `auth.token` | token 模式下自动生成 | token 凭证 |
| `auth.password` | 未设置 | password 凭证 |
| `auth.rateLimit.*` | 见上方示例默认值 | 认证失败限流配置 |
| `corsOrigins` | `[]` | 允许的浏览器来源 |
| `channelConnectDeferMode` | 未写视为 `auto` | `auto` / `off` / `explicit`，见 [配置 — 频道连接延后](configuration.md#频道连接延后) |
| `channelConnectDeferIds` | - | `explicit` 模式下的延后通道 id 列表 |
| `channelConnectDeferSkipIds` | - | 从自动或显式延后集合中剔除的 id |

## 锁文件

网关锁文件位置：`~/.xopc/locks/gateway.{hash}.lock`

哈希基于配置文件路径，允许不同配置运行多个网关。

### 端口冲突检测

启动时会自动检测端口占用，如果端口已被占用：

```
❌ Port 18790 is already in use. Use --force to kill existing process.
```

使用 `--force` 自动终止现有进程：

```bash
xopc gateway --force
```

### 优雅关闭

网关支持优雅关闭：
1. 收到停止信号后，等待 5 秒让现有请求完成
2. 如果 5 秒后仍有请求，强制终止
3. 自动释放锁文件

可通过 `--timeout` 参数自定义超时时间：

```bash
xopc gateway stop --timeout 10000  # 10 秒超时
```

## 环境变量

| 变量 | 描述 |
|------|------|
| `XOPC_GATEWAY_AUTH_MODE` | 覆盖认证模式（`none` / `token` / `password`） |
| `XOPC_GATEWAY_TOKEN` | `token` 模式下的网关 token |
| `XOPC_GATEWAY_PASSWORD` | `password` 模式下的网关密码 |
| `XOPC_NO_RESPAWN` | 禁用进程重生，使用进程内重启 |
| `XOPC_ALLOW_SIGUSR1_RESTART` | 允许 SIGUSR1 触发重启 |
| `XOPC_SERVICE_MARKER` | 标记在监督器下运行（systemd/launchd） |

## CORS 配置

如需从浏览器访问，添加 CORS 头（可经由反向代理或中间件注入）。

```json
{
  "gateway": {
    "corsOrigins": ["http://localhost:5173"]
  }
}
```

## 从旧版本迁移

如果你之前使用后台模式：

1. 停止旧网关：
   ```bash
   ps aux | grep xopc
   kill -9 <PID>
   rm ~/.xopc/gateway.pid
   ```

2. 启动新网关：
   ```bash
   xopc gateway
   ```

3. 使用 `Ctrl+C` 停止，或从另一个终端运行 `xopc gateway stop`。
