# Scheduled Tasks

xopc scheduled tasks are durable jobs stored in SQLite (`~/.xopc/xopc.db`). The scheduler supports one-time, interval, and cron-expression schedules, records every run, and can execute agent turns, workflow runs, goal continuations, or system events.

## CLI

Create exactly one schedule and exactly one payload.

```bash
xopc cron add --at 2026-06-24T09:00:00+08:00 --message "Prepare tomorrow's briefing"
xopc cron add --every 30m --message "Check urgent inbox items"
xopc cron add --cron "0 9 * * 1-5" --tz Asia/Shanghai --message "Daily workday review"
xopc cron add --cron "0 17 * * 5" --workflow weekly_review --goal "Weekly review"
```

Schedule options:

| Option | Meaning |
| --- | --- |
| `--at <time>` | One-time ISO timestamp, or relative duration such as `20m`, `2h`, `1d` |
| `--every <duration>` | Fixed interval such as `10m`, `1h`, `1d` |
| `--cron <expr>` | Cron expression |
| `--tz <iana>` | Optional timezone for `--cron` |

Payload options:

| Option | Meaning |
| --- | --- |
| `--message <text>` | Create an agent/system message task |
| `--workflow <id>` | Start a workflow definition |
| `--goal <text>` | Workflow goal override |
| `--input-json <json>` | Workflow input payload |
| `--agent-id <id>` | Agent profile for isolated jobs |
| `--channel <name>` + `--to <id>` | Announce result to a channel |

Manage jobs:

```bash
xopc cron list
xopc cron enable <job-id>
xopc cron disable <job-id>
xopc cron remove <job-id>
```

## Data Model

Jobs use structured schedules:

```ts
type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string; staggerMs?: number };
```

Runtime state is stored on the job row:

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

SQLite tables:

| Table | Purpose |
| --- | --- |
| `cron_jobs` | Job definitions, schedule, payload, delivery, failure alert, state |
| `cron_runs` | Run history and execution outcome |

There is no JSON job file and no legacy `schedule: string` contract.

## Scheduler Behavior

- On startup, missed jobs are recomputed and staggered to avoid a thundering herd.
- Top-of-hour cron jobs receive a deterministic default stagger unless `staggerMs` is set.
- Running jobs are marked in state; interrupted runs are surfaced as errors on restart.
- `deleteAfterRun` one-time jobs are removed after a successful scheduled run.
- Run history is written to SQLite and exposed through the gateway UI and API.

## Gateway API

Create:

```http
POST /api/cron
Content-Type: application/json

{
  "name": "Daily review",
  "schedule": { "kind": "cron", "expr": "0 9 * * 1-5", "tz": "Asia/Shanghai" },
  "sessionTarget": "isolated",
  "delivery": { "mode": "announce", "channel": "telegram", "to": "123456" },
  "payload": { "kind": "agentTurn", "message": "Summarize yesterday and plan today." }
}
```

List:

```http
GET /api/cron
```

Each job returns `createdAtMs`, `updatedAtMs`, structured `schedule`, and `state.nextRunAtMs`.

## Product Notes

Use `at` for exact one-time reminders, `every` for fixed interval monitoring, and `cron` for calendar schedules. Put timezone on each cron schedule that depends on a human local time; there is no global scheduler timezone.
