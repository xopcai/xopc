# 心跳机制

心跳服务用于主动监控和唤醒 Agent。

## 概述

心跳机制定期检查系统状态，并在满足条件时主动触发 Agent。

## 工作原理

```
┌─────────────────┐
│  Heartbeat       │
│  Service        │
└────────┬────────┘
         │
         ▼ (every intervalMs)
┌─────────────────┐
│  Check Status   │
│  - Cron Jobs    │
│  - Memory       │
│  - Config       │
└────────┬────────┘
         │
         ▼ (if condition met)
┌─────────────────┐
│  Wake Agent     │
│  (if enabled)   │
└─────────────────┘
```

## 配置

```typescript
interface HeartbeatConfig {
  intervalMs: number;   // 检查间隔（毫秒）
  enabled: boolean;     // 是否启用
}
```

### 默认配置

```json
{
  "heartbeat": {
    "intervalMs": 300000,  // 5 分钟
    "enabled": true
  }
}
```

## 使用场景

### 定期检查

- 检查待处理的定时任务
- 监控内存使用情况
- 检查配置变更

### 条件触发

当满足条件时主动唤醒：

```typescript
// 检查是否有待处理的 cron 任务
const pendingJobs = cronService.getPendingJobs();
if (pendingJobs.length > 0) {
  // 触发 Agent 处理
}
```

## 程序化使用

```typescript
import { HeartbeatService } from '../heartbeat/service.js';
import { CronService } from '../cron/service.js';

const cronService = new CronService();
const heartbeat = new HeartbeatService(cronService);

// 启动心跳
heartbeat.start({
  intervalMs: 60000,  // 1 分钟
  enabled: true
});

// 停止心跳
heartbeat.stop();

// 检查状态
const status = heartbeat.isRunning();
```

## 监控指标

心跳服务会监控：

| 指标 | 描述 |
|------|------|
| `runningJobs` | 运行中的 cron 任务数 |
| `pendingJobs` | 待处理的定时任务 |
| `memoryUsage` | 内存使用情况 |
| `sessionCount` | 活动会话数 |

## 日志输出

心跳服务会输出状态日志：

```
[Heartbeat] Active - 5 cron jobs running
[Heartbeat] Checking pending jobs...
[Heartbeat] Triggering wake for pending task
```

## 最佳实践

1. **合理间隔**：根据需求设置检查频率
2. **资源考虑**：避免过于频繁的检查
3. **日志级别**：生产环境可降低日志级别
4. **错误处理**：心跳错误不应影响主服务

## 与 Cron 的关系

| 组件 | 职责 |
|------|------|
| **Cron** | 按时执行特定任务 |
| **Heartbeat** | 定期检查并触发唤醒 |

两者协同工作：Heartbeat 监控 Cron 任务的执行状态。

## 故障排除

**心跳不工作？**
- 确认 `enabled` 设为 `true`
- 检查 `intervalMs` 配置有效
- 查看服务日志

**触发过于频繁？**
- 增加 `intervalMs` 值
- 检查触发条件逻辑

**内存泄漏？**
- 定期重启服务
- 监控内存使用趋势
