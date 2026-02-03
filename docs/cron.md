# 定时任务

xopcbot 内置 Cron 服务，支持定时发送消息。

## 使用方法

### 查看任务列表

```bash
npm run dev -- cron list
```

输出示例：

```
ID   | Schedule      | Message                    | Enabled
-----|---------------|----------------------------|--------
abc1 | 0 9 * * *    | Good morning!             | true
abc2 | 0 18 * * *   | Good evening!             | true
```

### 添加任务

```bash
npm run dev -- cron add --schedule "0 9 * * *" --message "Good morning!"
```

参数：

| 参数 | 描述 |
|------|------|
| `--schedule` | Cron 表达式 |
| `--message` | 定时发送的消息 |
| `--name` | (可选) 任务名称 |

### 删除任务

```bash
npm run dev -- cron remove <task-id>
```

### 启用/禁用任务

```bash
npm run dev -- cron enable <task-id>
npm run dev -- cron disable <task-id>
```

## Cron 表达式格式

```
┌───────────── 分钟 (0 - 59)
│ ┌─────────── 小时 (0 - 23)
│ │ ┌───────── 日 (1 - 31)
│ │ │ ┌─────── 月 (1 - 12)
│ │ │ │ ┌───── 周几 (0 - 6, 周日=0)
│ │ │ │ │
* * * * *
```

## 常用示例

| 表达式 | 描述 |
|--------|------|
| `0 9 * * *` | 每天 9:00 |
| `0 18 * * 1-5` | 工作日 18:00 |
| `30 8 * * 1` | 每周一 8:30 |
| `0 0 1 * *` | 每月 1 号 |
| `*/15 * * * *` | 每 15 分钟 |

## 任务存储

任务保存在 `~/.xopcbot/cron-jobs.json`：

```json
{
  "jobs": [
    {
      "id": "abc123",
      "name": "Morning",
      "schedule": "0 9 * * *",
      "message": "Good morning!",
      "enabled": true,
      "created_at": "2026-02-03T12:00:00.000Z"
    }
  ]
}
```

## 程序化使用

```typescript
import { CronService } from '../cron/service.js';

const cronService = new CronService();

// 添加任务
const id = await cronService.addJob({
  schedule: '0 9 * * *',
  message: 'Daily reminder!',
  name: 'Daily'
});

// 列出任务
const jobs = cronService.listJobs();
console.log(jobs);

// 删除任务
cronService.removeJob(id);

// 获取运行中的任务数
const count = cronService.getRunningCount();
```

## 配置

定时任务在配置文件中启用：

```json
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 18790
  }
}
```

确保网关服务运行以接收定时消息。

## 最佳实践

1. **测试表达式**：使用 `cron-parser` 验证表达式
2. **合理频率**：避免过于频繁的任务
3. **错误处理**：查看日志确认任务执行成功
4. **时区注意**：Cron 使用服务器时区

## 故障排除

**任务不执行？**
- 确认网关服务正在运行
- 检查 Cron 表达式格式正确
- 查看日志中的错误信息

**时区问题？**
- Cron 使用系统时区
- 确认服务器时区设置正确

**消息未发送？**
- 检查通道配置是否启用
- 确认 API Key 有效
