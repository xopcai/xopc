# 心跳机制

Heartbeat 是网关里的轻量周期检查服务，用于健康检查和主动唤醒相关逻辑。它与自动化分离：自动化负责计划、手动和 webhook 触发的工作；Heartbeat 负责让长期运行的网关状态可观测。

## 概述

```
┌─────────────────┐
│ Heartbeat       │
│ Service         │
└────────┬────────┘
         │
         ▼ (every intervalMs)
┌─────────────────┐
│ Check Status    │
│ - Runtime       │
│ - Memory        │
│ - Config        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Emit logs /     │
│ wake checks     │
└─────────────────┘
```

## 配置

```typescript
interface HeartbeatConfig {
  intervalMs: number;
  enabled: boolean;
}
```

默认配置：

```json
{
  "heartbeat": {
    "intervalMs": 300000,
    "enabled": true
  }
}
```

## 使用场景

- 按固定周期检查网关运行状态。
- 监控内存和会话压力。
- 在不依赖用户对话轮次的情况下暴露配置重载或唤醒条件。

## 与自动化的关系

| 组件 | 职责 |
|------|------|
| **自动化** | 由手动、计划或 webhook 触发，执行 Agent 或工作流动作 |
| **Heartbeat** | 执行周期健康检查和唤醒相关监控 |

自动化不依赖 Heartbeat 来判断是否到期。自动化服务会自行计算并维护 `nextRunAtMs`；Heartbeat 仍然是独立的健康检查与监控机制。

## 故障排除

**心跳不工作？**

- 确认 `heartbeat.enabled` 为 `true`。
- 检查 `heartbeat.intervalMs`。
- 查看网关日志中的 Heartbeat 启动和运行错误。

**触发过于频繁？**

- 增加 `heartbeat.intervalMs`。
- 检查绑定在 Heartbeat 检查上的唤醒条件。
