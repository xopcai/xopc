# Cron Jobs

xopcbot has a built-in Cron service that supports scheduled message sending with two execution modes: **Direct** and **AI Agent**.

## Usage

### List Tasks

```bash
npm run dev -- cron list
```

Output example:

```
ID       | Schedule      | Mode     | Enabled | Next Run
---------|---------------|----------|---------|-------------------
abc12345 | 0 9 * * *    | main     | true    | 2026-02-21T09:00
def67890 | 0 10 * * *   | isolated | true    | 2026-02-21T10:00
```

### Add Task

```bash
npm run dev -- cron add --schedule "0 9 * * *" --message "Good morning!"
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `--schedule` | Cron expression |
| `--message` | Message to send |
| `--name` | (Optional) Task name |
| `--target` | Execution mode: `main` (direct) or `isolated` (AI agent) |
| `--model` | (Optional) Model for AI agent mode |
| `--channel` | (Optional) Target channel: `telegram`, `whatsapp`, `cli` |
| `--to` | (Optional) Recipient chat ID |

### Remove Task

```bash
npm run dev -- cron remove <task-id>
```

### Enable/Disable Task

```bash
npm run dev -- cron enable <task-id>
npm run dev -- cron disable <task-id>
```

### Run Now

```bash
npm run dev -- cron run <task-id>
```

## Execution Modes

### 1. Direct Mode (`main`)

Sends messages directly to the specified channel without AI processing.

```bash
npm run dev -- cron add "0 9 * *" "Good morning!" \
  --name "Morning" \
  --target main \
  --channel telegram \
  --to 123456789
```

### 2. AI Agent Mode (`isolated`)

Uses AI agent to process the message, then sends the response to the channel.

```bash
npm run dev -- cron add "0 10 * * *" "What's the weather today?" \
  --name "Weather" \
  --target isolated \
  --model minimax/minimax-m2.5 \
  --channel telegram \
  --to 123456789
```

## Cron Expression Format

```
┌───────────── minute (0 - 59)
│ ┌─────────── hour (0 - 23)
│ │ ┌───────── day of month (1 - 31)
│ │ │ ┌─────── month (1 - 12)
│ │ │ │ ┌───── day of week (0 - 6, Sunday=0)
│ │ │ │ │
* * * * *
```

## Common Examples

| Expression | Description |
|-----------|-------------|
| `0 9 * * *` | Daily at 9:00 AM |
| `0 18 * * 1-5` | Weekdays at 6:00 PM |
| `30 8 * * 1` | Every Monday at 8:30 AM |
| `0 0 1 * *` | First day of every month |
| `*/15 * * * *` | Every 15 minutes |
| `*/1 * * * *` | Every minute (for testing) |

## Task Storage

Tasks are saved in `~/.xopcbot/cron-jobs.json`:

```json
{
  "jobs": [
    {
      "id": "abc12345",
      "name": "Morning",
      "schedule": "0 9 * * *",
      "message": "Good morning!",
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
      "name": "Weather",
      "schedule": "0 10 * * *",
      "message": "What's the weather today?",
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

## Programmatic Usage

```typescript
import { CronService } from '../cron/index.js';

const cronService = new CronService({
  filePath: '~/.xopcbot/cron-jobs.json',
  agentService: agentServiceInstance,
  messageBus: messageBusInstance,
});

// Initialize
await cronService.initialize();

// Add task - Direct mode
await cronService.addJob('0 9 * * *', 'Good morning!', {
  name: 'Morning',
  sessionTarget: 'main',
  delivery: {
    mode: 'direct',
    channel: 'telegram',
    to: '123456789',
  },
});

// Add task - AI Agent mode
await cronService.addJob('0 10 * * *', 'Query weather', {
  name: 'Weather',
  sessionTarget: 'isolated',
  model: 'minimax/minimax-m2.5',
  delivery: {
    mode: 'direct',
    channel: 'telegram',
    to: '123456789',
  },
});

// List tasks
const jobs = await cronService.listJobs();
console.log(jobs);

// Get task history
const history = cronService.getHistory(jobId, 10);

// Run task immediately
await cronService.runJobNow(jobId);

// Stop service
await cronService.stop();
```

## Configuration

Cron jobs are enabled in the config:

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

Make sure the gateway service is running to receive scheduled messages.

## Error Backoff

When a job fails consecutively, the system applies exponential backoff:

| Consecutive Errors | Delay |
|-------------------|-------|
| 1 | 30 seconds |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 15 minutes |
| 5+ | 60 minutes |

## Best Practices

1. **Test expressions**: Use `cron-parser` to validate expressions
2. **Reasonable frequency**: Avoid overly frequent tasks
3. **Error handling**: Check logs to confirm task execution success
4. **Timezone**: Cron uses server timezone

## Troubleshooting

**Task not executing?**
- Ensure gateway service is running
- Check Cron expression format is correct
- Check error logs

**Timezone issues?**
- Cron uses system timezone
- Ensure server timezone is set correctly

**Message not sent?**
- Check channel configuration is enabled
- Verify API Key is valid

**AI mode not working?**
- Ensure model is configured in providers
- Check agent service is initialized
