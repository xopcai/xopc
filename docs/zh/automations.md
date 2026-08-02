# 自动化

xopc 自动化是持久化的产品级规则，存储在 SQLite（`~/.xopc/xopc.db`）。一个自动化由一个触发器和一个动作组成，记录每次运行，并可执行 Agent 指令、工作流或已保存的[浏览器自动化](browser-workflows.md)。

在网关控制台打开 `#/automations` 可以创建、暂停、恢复、立即运行、删除和查看自动化。创建使用居中的 modal；页面同时展示下一次运行、最近历史和运行指标。

## 核心概念

| 概念 | 含义 |
| --- | --- |
| 触发器 | 自动化如何开始：手动、计划或 webhook |
| 动作 | 实际执行内容：Agent 指令、工作流或浏览器自动化 |
| 运行记录 | 一次执行尝试，包含状态、时间、摘要和错误 |
| 运行后处理 | 可选的保存到会话或调用 webhook |
| 可靠性 | 超时、重试、并发和连续失败后停用设置 |

## 触发器

计划触发支持单次、固定间隔和 cron 表达式三种形式：

```ts
type AutomationSchedule =
  | { kind: 'once'; at: string }
  | { kind: 'interval'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string };

type AutomationTrigger =
  | { kind: 'manual' }
  | { kind: 'schedule'; schedule: AutomationSchedule }
  | { kind: 'webhook'; secretId?: string };
```

精确单次提醒用 `once`，固定频率监控用 `interval`，按日历运行用 `cron`。依赖用户本地时间的 cron 表达式计划应在该 schedule 上显式设置 `tz`。

## 动作

自动化的动作面保持精简：

```ts
type AutomationAction =
  | {
      kind: 'agent';
      agentId?: string;
      instruction: string;
      workingDirectory?: string;
      model?: string;
      timeoutSeconds?: number;
    }
  | {
      kind: 'workflow';
      workflowId: string;
      agentId?: string;
      input?: unknown;
      goal?: string;
      timeoutSeconds?: number;
    }
  | {
      kind: 'browser_recipe';
      recipeId: string;
      args?: Record<string, unknown>;
      timeoutSeconds?: number;
    };
```

需要在会话中让 Agent 做事时选择 Agent 动作；需要直接调用已知工作流、不依赖模型判断如何触发时选择工作流动作；需要重复执行已经和助手创建并测试过的网页操作时，选择浏览器自动化。只有已启用的浏览器自动化可以被选择。

## 数据模型

运行状态保存在自动化行上：

```ts
type AutomationState = {
  nextRunAtMs?: number;
  runningRunId?: string;
  lastRunAtMs?: number;
  lastRunStatus?: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout';
  lastError?: string;
  consecutiveFailures?: number;
};
```

SQLite 表：

| 表 | 用途 |
| --- | --- |
| `automations` | 自动化定义、触发器、动作、可靠性、运行后处理与状态 |
| `automation_runs` | 执行历史与结果 |

自动化由数据库承载，不通过 `xopc.json` 配置。

## 调度行为

- 启动时会为计划型自动化重新计算 `nextRunAtMs`。
- 手动和 webhook 自动化只在显式触发时运行。
- 正在运行的自动化通过 `state.runningRunId` 跟踪。
- 运行记录会把状态、耗时、摘要、错误、会话 key 与工作流运行 id 写入 SQLite。
- 网关控制台和 API 都可查看运行历史。

## Gateway API

创建：

```http
POST /api/automations
Content-Type: application/json

{
  "name": "Daily review",
  "trigger": {
    "kind": "schedule",
    "schedule": { "kind": "cron", "expr": "0 9 * * 1-5", "tz": "Asia/Shanghai" }
  },
  "action": {
    "kind": "agent",
    "instruction": "总结昨天并规划今天。"
  },
  "afterRun": { "kind": "saveToSession" },
  "reliability": { "timeoutSeconds": 1800, "retryCount": 1 }
}
```

常用端点：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/automations` | 列出自动化 |
| POST | `/api/automations` | 创建自动化 |
| GET | `/api/automations/metrics` | 读取自动化指标 |
| GET | `/api/automations/:id` | 读取单个自动化 |
| PATCH | `/api/automations/:id` | 更新自动化 |
| DELETE | `/api/automations/:id` | 删除自动化 |
| POST | `/api/automations/:id/run` | 立即运行 |
| POST | `/api/automations/:id/pause` | 暂停自动化 |
| POST | `/api/automations/:id/resume` | 恢复自动化 |
| GET | `/api/automation-runs` | 列出运行记录 |
| GET | `/api/automation-runs/:runId` | 读取单次运行 |
| POST | `/api/automation-runs/:runId/cancel` | 取消运行 |

## Agent 工具

当网关运行时提供自动化服务时，Agent 可以使用 `automation` 工具列出、创建、更新、删除、运行、暂停、恢复自动化，并查看运行历史。工具使用与 API 相同的结构化 payload。
