# 定时任务

xopc 内置 Cron 服务，支持定时发送消息，支持两种执行模式：**直接发送** 与 **AI 智能体**。

## 使用方法

### 查看任务列表

```bash
xopc cron list
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
xopc cron add --schedule "0 9 * * *" --message "Good morning!"
```

参数：

| 参数 | 描述 |
|------|------|
| `--schedule` | Cron 表达式 |
| `--message` | 定时发送的消息 |
| `--name` | (可选) 任务名称 |
| `--target` | 执行模式：`main`（直接发送）或 `isolated`（AI 智能体） |
| `--model` | (可选) AI 智能体模式使用的模型 |
| `--channel` | (可选) 目标渠道：`telegram`、`cli` |
| `--to` | (可选) 接收方会话 ID（如 Telegram 的 chat id） |

### 删除任务

```bash
xopc cron remove <task-id>
```

### 启用/禁用任务

```bash
xopc cron enable <task-id>
xopc cron disable <task-id>
```

### 立即运行

```bash
xopc cron run <task-id>
```

## 执行模式

CLI 的 `cron add` 通过标志创建 **system event** 任务（类似 heartbeat 消息）：

```bash
xopc cron add --schedule "0 9 * * *" --message "早安！" --name "早安提醒"
```

带 **渠道投递**、**isolated 智能体轮次** 或更复杂 payload 的任务，请在 **网关控制台**（`#/settings/cron`）或编辑磁盘上的 cron jobs 存储中配置。

### 示例（CLI system event）

```bash
xopc cron add --schedule "0 9 * * *" --message "早安！" --name "Morning"
xopc cron add --schedule "0 18 * * 1-5" --message "收工提醒" --name "EOD"
```

### 高级任务（网关 / JSON）

直接发渠道、isolated 智能体运行等（文档中曾用 positional `cron add` 示例）**尚未**在 CLI 暴露，请使用 Web UI 或 jobs 文件。

**工作流运行：** 可直接定时执行工作流（无需助手轮次）：

```bash
xopc cron add --schedule "0 17 * * 5" --workflow weekly_review --goal "周复盘"
xopc cron add --schedule "30 8 * * 1-5" --workflow inbox_triage \
  --input-json '{"inbox":"在此粘贴待分拣内容"}' \
  --channel telegram --to <chat-id>
```

在 `#/settings/cron` 中选择任务类型 **工作流运行** 可获得相同能力（结构化参数 + 可选投递）。默认等待工作流完成（超时约 35 分钟）。详见 [动态工作流](workflows.md)。

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

任务保存在 `~/.xopc/cron-jobs.json`：

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
  filePath: '~/.xopc/cron-jobs.json',
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

// 添加任务 - AI 智能体模式
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
- 确保模型已在 models 配置中
- 检查 agent service 已正确初始化
