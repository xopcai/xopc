# 定时任务

xopcbot 内置 Cron 服务，支持定时发送消息，支持两种执行模式：**直接发送** 和 **AI Agent**。

## 使用方法

### 查看任务列表

```bash
npm run dev -- cron list
```

输出示例：

```
ID       | Schedule      | Mode     | Enabled | Next Run
---------|---------------|----------|---------|-------------------
abc12345 | 0 9 * * *    | main     | true    | 2026-02-21T09:00
def67890 | 0 10 * * *   | isolated | true    | 2026-02-21T10:00
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
| `--target` | 执行模式：`main`（直接发送）或 `isolated`（AI Agent） |
| `--model` | (可选) AI Agent 模式使用的模型 |
| `--channel` | (可选) 目标渠道：`telegram`、`whatsapp`、`cli` |
| `--to` | (可选) 接收者 Chat ID |

### 删除任务

```bash
npm run dev -- cron remove <task-id>
```

### 启用/禁用任务

```bash
npm run dev -- cron enable <task-id>
npm run dev -- cron disable <task-id>
```

### 立即运行

```bash
npm run dev -- cron run <task-id>
```

## 执行模式

### 1. 直接发送模式 (`main`)

不经过 AI 处理，直接向指定渠道发送消息。

```bash
npm run dev -- cron add "0 9 * * *" "早安！" \
  --name "早安提醒" \
  --target main \
  --channel telegram \
  --to 123456789
```

### 2. AI Agent 模式 (`isolated`)

使用 AI Agent 处理消息，然后将回复发送到指定渠道。

```bash
npm run dev -- cron add "0 10 * * *" "今天天气怎么样？" \
  --name "天气查询" \
  --target isolated \
  --model minimax/minimax-m2.5 \
  --channel telegram \
  --to 123456789
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
| `*/1 * * * *` | 每分钟（测试用） |

## 任务存储

任务保存在 `~/.xopcbot/cron-jobs.json`：

```json
{
  "jobs": [
    {
      "id": "abc12345",
      "name": "早安提醒",
      "schedule": "0 9 * * *",
      "message": "早安！",
      "enabled": true,
      "sessionTarget": "main",
      "delivery": {
        "mode": "direct",
        "channel": "telegram",
        "to": "123456789"
      },
      "created_at": "2026-02-20T12:00:00.000Z",
      "updated_at": "2026-02-20T12:00:00.000Z"
    },
    {
      "id": "def67890",
      "name": "天气查询",
      "schedule": "0 10 * * *",
      "message": "今天天气怎么样？",
      "enabled": true,
      "sessionTarget": "isolated",
      "model": "minimax/minimax-m2.5",
      "delivery": {
        "mode": "direct",
        "channel": "telegram",
        "to": "123456789"
      },
      "created_at": "2026-02-20T12:00:00.000Z",
      "updated_at": "2026-02-20T12:00:00.000Z"
    }
  ],
  "version": 1
}
```

## 程序化使用

```typescript
import { CronService } from '../cron/index.js';

const cronService = new CronService({
  filePath: '~/.xopcbot/cron-jobs.json',
  agentService: agentServiceInstance,
  messageBus: messageBusInstance,
});

// 初始化
await cronService.initialize();

// 添加任务 - 直接发送模式
await cronService.addJob('0 9 * * *', '早安！', {
  name: '早安提醒',
  sessionTarget: 'main',
  delivery: {
    mode: 'direct',
    channel: 'telegram',
    to: '123456789',
  },
});

// 添加任务 - AI Agent 模式
await cronService.addJob('0 10 * * *', '查询天气', {
  name: '天气查询',
  sessionTarget: 'isolated',
  model: 'minimax/minimax-m2.5',
  delivery: {
    mode: 'direct',
    channel: 'telegram',
    to: '123456789',
  },
});

// 列出任务
const jobs = await cronService.listJobs();
console.log(jobs);

// 获取任务历史
const history = cronService.getHistory(jobId, 10);

// 立即运行任务
await cronService.runJobNow(jobId);

// 停止服务
await cronService.stop();
```

## 配置

定时任务在配置文件中启用：

```json
{
  "cron": {
    "enabled": true,
    "maxConcurrentJobs": 5,
    "defaultTimezone": "UTC",
    "historyRetentionDays": 7
  }
}
```

确保网关服务运行以接收定时消息。

## 错误退避

当任务连续失败时，系统会应用指数退避：

| 连续错误次数 | 延迟 |
|-------------|------|
| 1 | 30 秒 |
| 2 | 1 分钟 |
| 3 | 5 分钟 |
| 4 | 15 分钟 |
| 5+ | 60 分钟 |

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

**AI 模式不工作？**
- 确保模型已在 providers 中配置
- 检查 agent service 已正确初始化
