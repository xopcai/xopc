# Agent Control Protocol（ACP）

> ACP 是运行时抽象层，为不同 Agent 运行时提供统一的会话生命周期与多轮对话接口。

## 概述

通过 ACP，xopcbot 可以用同一套接口对接多种后端（例如各类 coding agent 运行时）。主要职责包括：

- **会话生命周期**：创建、恢复、关闭会话  
- **轮次执行**：发送用户消息并消费流式事件  
- **状态与资源**：会话元数据、运行时句柄缓存（含空闲淘汰）  
- **并发**：按会话串行化操作，会话之间可并行  

实现代码位于 `src/acp/`。更完整的类型说明、自定义后端示例与英文原文见 [ACP（英文）](/acp)。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    AcpSessionManager                         │
│  ┌─────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ TurnManager │  │RuntimeCacheMgr  │  │LifecycleManager │  │
│  └─────────────┘  └─────────────────┘  └─────────────────┘  │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────┐
│                  SessionActorQueue                         │
│            （按会话串行执行）                                 │
└────────────────────────────┬──────────────────────────────┘
                             │
┌────────────────────────────▼──────────────────────────────┐
│                  AcpRuntime Backend                        │
└────────────────────────────────────────────────────────────┘
```

## 配置

在 `~/.xopcbot/config.json` 中增加 `acp` 段（完整字段以 [配置参考](/zh/configuration) 与运行时为准）：

```json
{
  "acp": {
    "enabled": true,
    "backend": "acpx",
    "defaultAgent": "main",
    "maxConcurrentSessions": 5,
    "dispatch": { "enabled": true },
    "stream": {
      "coalesceIdleMs": 100,
      "maxChunkChars": 4000,
      "deliveryMode": "live"
    },
    "runtime": {
      "ttlMinutes": 30,
      "installCommand": "npm install -g @acpx/cli"
    }
  }
}
```

| 选项 | 类型 | 说明 |
|------|------|------|
| `enabled` | `boolean` | 总开关 |
| `backend` | `string` | 默认后端 ID |
| `defaultAgent` | `string` | 新会话默认 Agent |
| `maxConcurrentSessions` | `number` | 最大并发会话数 |
| `dispatch.enabled` | `boolean` | 是否启用调度 |
| `stream.coalesceIdleMs` | `number` | 流式合并空闲窗口（毫秒） |
| `stream.maxChunkChars` | `number` | 单块最大字符数 |
| `stream.deliveryMode` | `live` \| `final_only` | 投递模式 |
| `runtime.ttlMinutes` | `number` | 空闲会话 TTL |
| `runtime.installCommand` | `string` | `doctor` 等场景建议的安装命令 |

## CLI

```bash
xopcbot acp status
xopcbot acp status -s <session-key>
xopcbot acp doctor
xopcbot acp list
xopcbot acp close -s <session-key>
xopcbot acp cancel -s <session-key>
```

## 错误码（节选）

| Code | 含义 | 可重试 |
|------|------|--------|
| `ACP_SESSION_INIT_FAILED` | 会话初始化失败 | 否 |
| `ACP_TURN_FAILED` | 单轮执行失败 | 是 |
| `ACP_BACKEND_MISSING` | 未注册后端 | 否 |
| `ACP_BACKEND_UNAVAILABLE` | 后端暂时不可用 | 是 |

## 相关代码路径

- `src/acp/runtime/` — 运行时接口与后端注册  
- `src/acp/control-plane/` — 会话与轮次编排  
- `src/acp/routing-integration.ts` — 与 Session 路由集成  

## 延伸阅读

- [英文 ACP 文档](/acp)（完整 API、`AcpRuntime` 实现示例、可观测性与最佳实践）  
- [CLI 参考](/zh/cli)  
- [Session 路由](/zh/routing-system)  
