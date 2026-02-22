# Heartbeat Mechanism

Heartbeat service is used to proactively monitor and wake up the Agent.

## Overview

The heartbeat mechanism regularly checks system status and proactively triggers the Agent when conditions are met.

## How It Works

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

## Configuration

```typescript
interface HeartbeatConfig {
  intervalMs: number;   // Check interval (milliseconds)
  enabled: boolean;     // Whether to enable
}
```

### Default Configuration

```json
{
  "heartbeat": {
    "intervalMs": 300000,  // 5 minutes
    "enabled": true
  }
}
```

## Use Cases

### Regular Checks

- Check pending scheduled tasks
- Monitor memory usage
- Check configuration changes

### Conditional Trigger

Proactively wake up when conditions are met:

```typescript
// Check if there are pending cron jobs
const pendingJobs = cronService.getPendingJobs();
if (pendingJobs.length > 0) {
  // Trigger Agent to process
}
```

## Programmatic Usage

```typescript
import { HeartbeatService } from '../heartbeat/service.js';
import { CronService } from '../cron/service.js';

const cronService = new CronService();
const heartbeat = new HeartbeatService(cronService);

// Start heartbeat
heartbeat.start({
  intervalMs: 60000,  // 1 minute
  enabled: true
});

// Stop heartbeat
heartbeat.stop();

// Check status
const status = heartbeat.isRunning();
```

## Monitoring Metrics

Heartbeat service monitors:

| Metric | Description |
|--------|-------------|
| `runningJobs` | Number of running cron jobs |
| `pendingJobs` | Pending scheduled tasks |
| `memoryUsage` | Memory usage |
| `sessionCount` | Active session count |

## Log Output

Heartbeat service outputs status logs:

```
[Heartbeat] Active - 5 cron jobs running
[Heartbeat] Checking pending jobs...
[Heartbeat] Triggering wake for pending task
```

## Best Practices

1. **Reasonable interval**: Set check frequency based on needs
2. **Resource consideration**: Avoid too frequent checks
3. **Log level**: Can reduce log level in production
4. **Error handling**: Heartbeat errors should not affect main service

## Relationship with Cron

| Component | Responsibility |
|-----------|----------------|
| **Cron** | Execute specific tasks on schedule |
| **Heartbeat** | Regular checks and wake triggers |

They work together: Heartbeat monitors Cron job execution status.

## Troubleshooting

**Heartbeat not working?**
- Confirm `enabled` is set to `true`
- Check `intervalMs` configuration is valid
- Check service logs

**Triggering too frequently?**
- Increase `intervalMs` value
- Check trigger condition logic

**Memory leak?**
- Regularly restart service
- Monitor memory usage trends
