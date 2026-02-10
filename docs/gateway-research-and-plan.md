# OpenClaw Gateway 调研报告 + xopcbot 重构方案

## OpenClaw Gateway 架构分析

### 核心设计

OpenClaw 的 Gateway 是一个**独立服务进程**，具有以下特点：

#### 1. 架构分层
```
┌─────────────────────────────────────────────────────────┐
│  Gateway Service (独立进程)                                │
│  ├─ WebSocket Server (控制平面)                           │
│  ├─ HTTP Server (多路复用同一端口)                         │
│  │   ├─ /v1/chat/completions (OpenAI API)              │
│  │   ├─ /v1/responses (OpenResponses)                  │
│  │   ├─ /tools/invoke (工具调用)                         │
│  │   └─ Control UI (Web 界面)                           │
│  ├─ Canvas File Server (端口+4)                          │
│  └─ Browser Control Service (端口+2)                     │
└─────────────────────────────────────────────────────────┘
```

#### 2. 核心组件

| 组件 | 职责 | 实现 |
|------|------|------|
| **Protocol Handler** | WebSocket 协议处理 | JSON-RPC like，req/res + events |
| **Auth Manager** | 身份验证 | token/password based |
| **Agent Runner** | 执行 Agent 任务 | 流式响应 |
| **Channel Manager** | 消息渠道管理 | Telegram/WhatsApp/Signal 等 |
| **Node Manager** | 配对设备管理 | 手机/平板等 |
| **Cron Scheduler** | 定时任务 | 内嵌 |
| **Config Reloader** | 热重载 | SIGUSR1 触发 |

#### 3. 关键设计模式

**协议设计**:
- 客户端必须先发送 `connect` 请求
- 双工通信: Requests (req/res) + Events (push)
- 结构化事件流: `agent` 事件用于流式输出

**生命周期管理**:
- 长期运行进程（daemon/service）
- 由 systemd/launchd 管理
- SIGTERM 优雅关闭，SIGUSR1 热重启

**多实例支持**:
- 通过 `--profile` 或环境变量隔离
- 独立端口、配置、状态目录

---

## xopcbot 当前 Gateway 问题

### 现状
```
src/cli/commands/gateway.ts  (140行)
├─ 内嵌简单的 HTTP server
├─ 仅支持 /health 端点
└─ 通过 CLI 直接启动
```

### 问题

| 问题 | 影响 |
|------|------|
| **与 CLI 耦合** | 无法作为独立服务运行 |
| **功能简陋** | 只有 health check，无实际功能 |
| **无 WebSocket** | 无法支持实时通信 |
| **无协议设计** | 无法扩展复杂功能 |
| **无状态管理** | 无法管理连接、会话 |
| **无认证** | 安全性不足 |

---

## xopcbot Gateway 重构方案

### 目标架构

```
src/
├── gateway/
│   ├── index.ts              # 入口，创建并启动服务
│   ├── server.ts             # HTTP + WebSocket 服务器
│   ├── router.ts             # 路由注册
│   ├── auth.ts               # 认证中间件
│   ├── protocol.ts           # 协议定义 (req/res/event)
│   ├── handlers/             # 请求处理器
│   │   ├── health.ts         # health check
│   │   ├── agent.ts          # agent 执行
│   │   ├── channels.ts       # 消息渠道
│   │   └── system.ts         # 系统信息
│   ├── middleware/           # 中间件
│   │   ├── auth.ts
│   │   ├── logging.ts
│   │   └── error.ts
│   └── types.ts              # Gateway 类型定义
├── cli/commands/gateway.ts   # CLI 命令（简化版，仅启动服务）
```

### 实施步骤

#### Phase 1: 基础架构 (2-3小时)
1. 创建 `src/gateway/` 目录结构
2. 实现基础 HTTP + WebSocket 服务器
3. 实现协议层 (req/res/event 格式)
4. 简单的 health handler

#### Phase 2: 核心功能 (3-4小时)
1. 添加认证中间件
2. 实现 agent handler（流式响应）
3. 实现 channels handler（接入现有 Telegram）
4. 添加错误处理和日志

#### Phase 3: CLI 简化 (1小时)
1. 重写 `cli/commands/gateway.ts`
2. 仅保留启动逻辑，调用 gateway 模块
3. 添加 `--port`, `--host`, `--daemon` 等选项

#### Phase 4: 增强功能 (可选)
1. 添加 Config 热重载
2. 实现 session 管理
3. 添加 node/cron 支持

### 关键代码结构

```typescript
// src/gateway/server.ts
export class GatewayServer {
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private handlers: Map<string, RequestHandler>;

  async start(config: GatewayConfig): Promise<void> {
    // 创建 HTTP 服务器
    // 创建 WebSocket 服务器
    // 注册路由和处理器
  }

  async stop(): Promise<void> {
    // 优雅关闭
  }
}

// src/gateway/protocol.ts
export interface GatewayRequest {
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface GatewayResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string };
}

export interface GatewayEvent {
  type: 'event';
  event: string;
  payload: unknown;
}
```

### 与 OpenClaw 的差异

| 特性 | OpenClaw | xopcbot (建议) |
|------|----------|----------------|
| 协议复杂度 | 完整 (connect握手 + 多方法) | 简化版 |
| 渠道支持 | 多 (TG/WA/Signal/Slack/...) | 仅 Telegram (现阶段) |
| Node 管理 | 完整配对系统 | 暂不实现 |
| Canvas | 独立服务 | 暂不实现 |
| 认证 | Token/Password | 简单 Token |
| 热重载 | SIGUSR1 | 重启即可 |

---

## 建议的 CLI 使用方式

```bash
# 开发模式（前台运行）
xopcbot gateway --port 18790

# 后台守护进程
xopcbot gateway --daemon

# 带认证
xopcbot gateway --token my-secret-token

# 客户端连接
websocat ws://localhost:18790
# -> { "type": "req", "id": "1", "method": "health" }
```

---

## 下一步

1. 确认重构方案
2. 开始 Phase 1 实施
3. 每阶段完成后测试并推送
