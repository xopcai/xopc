# Heartbeat Mechanism

Heartbeat is a lightweight gateway service for periodic health checks and proactive wake logic. It is separate from automations: automations own scheduled/manual/webhook work, while heartbeat keeps long-running gateway state observable.

## Overview

```
┌─────────────────┐
│ Heartbeat       │
│ Service         │
└────────┬────────┘
         │
         ▼ (every intervalMs)
┌─────────────────┐
│ Check Status    │
│ - Runtime       │
│ - Memory        │
│ - Config        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Emit logs /     │
│ wake checks     │
└─────────────────┘
```

## Configuration

```typescript
interface HeartbeatConfig {
  intervalMs: number;
  enabled: boolean;
}
```

Default configuration:

```json
{
  "heartbeat": {
    "intervalMs": 300000,
    "enabled": true
  }
}
```

## Use Cases

- Check gateway runtime health on a steady cadence.
- Monitor memory and session pressure.
- Surface configuration reload or wake conditions without coupling them to user turns.

## Relationship with Automations

| Component | Responsibility |
|-----------|----------------|
| **Automations** | Execute agent or workflow actions from manual, scheduled, or webhook triggers |
| **Heartbeat** | Run periodic health checks and wake-related monitoring |

Automations do not depend on heartbeat to become due. The automation service computes and tracks its own `nextRunAtMs`; heartbeat remains a separate health and monitoring mechanism.

## Troubleshooting

**Heartbeat not working?**

- Confirm `heartbeat.enabled` is `true`.
- Check `heartbeat.intervalMs`.
- Check gateway logs for heartbeat service startup and runtime errors.

**Triggering too frequently?**

- Increase `heartbeat.intervalMs`.
- Review any wake condition tied to heartbeat checks.
