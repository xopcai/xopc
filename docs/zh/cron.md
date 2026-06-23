# 定时任务

xopc 定时任务是持久化任务，存储在 SQLite（`~/.xopc/xopc.db`）。调度器支持单次、固定间隔和 cron 表达式三种计划，记录每次运行，并可执行 agent turn、workflow run、goal continuation 或 system event。

## CLI

创建任务时必须选择一种计划和一种执行内容。

```bash
xopc cron add --at 2026-06-24T09:00:00+08:00 --message "准备明天简报"
xopc cron add --every 30m --message "检查紧急收件箱"
xopc cron add --cron "0 9 * * 1-5" --tz Asia/Shanghai --message "工作日晨间复盘"
xopc cron add --cron "0 17 * * 5" --workflow weekly_review --goal "周复盘"
```

计划参数：

| 参数 | 含义 |
| --- | --- |
| `--at <time>` | 单次 ISO 时间，或 `20m`、`2h`、`1d` 这类相对时间 |
| `--every <duration>` | 固定间隔，例如 `10m`、`1h`、`1d` |
| `--cron <expr>` | Cron 表达式 |
| `--tz <iana>` | `--cron` 的可选 IANA 时区 |

执行内容参数：

| 参数 | 含义 |
| --- | --- |
| `--message <text>` | 创建消息/Agent 任务 |
| `--workflow <id>` | 启动 workflow 定义 |
| `--goal <text>` | 覆盖 workflow 目标 |
| `--input-json <json>` | Workflow 输入 |
| `--agent-id <id>` | 隔离任务使用的 Agent Profile |
| `--channel <name>` + `--to <id>` | 将结果 announce 到频道 |

管理任务：

```bash
xopc cron list
xopc cron enable <job-id>
xopc cron disable <job-id>
xopc cron remove <job-id>
```

## 数据模型

任务使用结构化计划：

```ts
type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string; staggerMs?: number };
```

运行状态保存在任务行上：

```ts
type JobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: 'ok' | 'error' | 'skipped';
  consecutiveErrors?: number;
  lastDeliveryStatus?: 'delivered' | 'not-delivered' | 'unknown' | 'not-requested';
};
```

SQLite 表：

| 表 | 用途 |
| --- | --- |
| `cron_jobs` | 任务定义、计划、payload、投递、失败提醒、状态 |
| `cron_runs` | 运行历史与执行结果 |

没有 JSON 任务文件，也没有旧的 `schedule: string` 契约。

## 调度行为

- 启动时会重新计算错过的任务，并分散触发，避免集中执行。
- 整点类 cron 会获得确定性的默认 stagger，除非显式设置 `staggerMs`。
- 正在执行的任务会写入 state；进程中断后重启会暴露为错误状态。
- `deleteAfterRun` 的单次任务在计划执行成功后删除。
- 运行历史写入 SQLite，并通过网关 UI/API 展示。

## Gateway API

创建任务：

```http
POST /api/cron
Content-Type: application/json

{
  "name": "Daily review",
  "schedule": { "kind": "cron", "expr": "0 9 * * 1-5", "tz": "Asia/Shanghai" },
  "sessionTarget": "isolated",
  "delivery": { "mode": "announce", "channel": "telegram", "to": "123456" },
  "payload": { "kind": "agentTurn", "message": "总结昨天并规划今天。" }
}
```

列表：

```http
GET /api/cron
```

返回任务包含 `createdAtMs`、`updatedAtMs`、结构化 `schedule` 和 `state.nextRunAtMs`。

## 产品说明

精确单次提醒用 `at`，固定频率监控用 `every`，按日历运行用 `cron`。依赖用户本地时间的 cron 计划应在 schedule 上显式设置 `tz`；不再存在全局默认调度时区。
