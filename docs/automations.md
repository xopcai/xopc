# Automations

xopc automations are durable, product-level rules stored in SQLite (`~/.xopc/xopc.db`). An automation combines one trigger with one action, records every run, and can execute either an agent instruction or a workflow.

Use the Gateway console at `#/automations` to create, pause, resume, run, delete, and inspect automations. The page keeps creation in a centered modal and shows upcoming runs, recent history, and operational metrics in one place.

## Concepts

| Concept | Meaning |
| --- | --- |
| Trigger | How the automation starts: manual, schedule, or webhook |
| Action | What runs: agent instruction or workflow |
| Run | One execution attempt with status, timestamps, summary, and errors |
| After-run | Optional post-run behavior such as saving to session or posting a webhook |
| Reliability | Timeout, retry, concurrency, and failure-disable settings |

## Triggers

Scheduled automations support one-time, interval, and cron-expression schedules:

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

Use `once` for exact one-time reminders, `interval` for fixed-frequency monitoring, and `cron` for calendar schedules. Put `tz` on each cron-expression schedule that depends on a human local time.

## Actions

Automations intentionally have a small action surface:

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
    };
```

Choose an agent action when the automation should ask an agent to do work in a session. Choose a workflow action when the job should call a known workflow directly without relying on a model to decide the invocation.

## Data Model

Runtime state is stored on the automation row:

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

SQLite tables:

| Table | Purpose |
| --- | --- |
| `automations` | Automation definitions, triggers, actions, reliability, after-run behavior, and state |
| `automation_runs` | Execution history and outcomes |

Automations are database-backed. They are not configured through `xopc.json`.

## Scheduler Behavior

- On startup, scheduled automations recompute `nextRunAtMs`.
- Manual and webhook automations only run when explicitly invoked.
- Running automations are tracked through `state.runningRunId`.
- Runs write status, timing, summaries, errors, session keys, and workflow run ids to SQLite.
- The service exposes history through the Gateway console and API.

## Gateway API

Create:

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
    "instruction": "Summarize yesterday and plan today."
  },
  "afterRun": { "kind": "saveToSession" },
  "reliability": { "timeoutSeconds": 1800, "retryCount": 1 }
}
```

Common endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/automations` | List automations |
| POST | `/api/automations` | Create automation |
| GET | `/api/automations/metrics` | Read automation metrics |
| GET | `/api/automations/:id` | Read one automation |
| PATCH | `/api/automations/:id` | Update automation |
| DELETE | `/api/automations/:id` | Delete automation |
| POST | `/api/automations/:id/run` | Run now |
| POST | `/api/automations/:id/pause` | Pause automation |
| POST | `/api/automations/:id/resume` | Resume automation |
| GET | `/api/automation-runs` | List runs |
| GET | `/api/automation-runs/:runId` | Read one run |
| POST | `/api/automation-runs/:runId/cancel` | Cancel a run |

## Agent Tool

When the gateway runtime exposes the automation service, agents can use the `automation` tool to list, create, update, delete, run, pause, resume, and inspect history. The tool uses the same structured payloads as the API.
