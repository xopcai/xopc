# Logger Module - Usage Guide

## Overview

The logger module provides:

- Contextual logging with `requestId` / `sessionId` via AsyncLocalStorage
- Automatic log rotation and cleanup
- Graceful shutdown with log flushing
- Configuration via `XOPC_*` environment variables
- File query, SSE live stream, and gateway Log Manager UI

---

## Quick Start

```typescript
import { logger, createLogger } from './utils/logger.js';

logger.info('Application started');
logger.error({ err }, 'Failed to connect');

const log = createLogger('MyModule');
log.info('Module initialized');
```

### Request correlation

```typescript
import { createLogger, runWithLogContext } from './utils/logger.js';

const log = createLogger('Gateway:HTTP');

runWithLogContext({ requestId: 'req-123', userId: 'user-456' }, () => {
  log.info({ phase: 'gateway.request' }, 'Processing request');
});
```

### Child loggers with extra context

```typescript
const baseLog = createLogger('AgentService');

const sessionLog = baseLog.withContext({
  sessionId: 'session-789',
  userId: 'user-456',
});

sessionLog.info('Session created');
```

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `XOPC_LOG_LEVEL` | `info` | Minimum log level |
| `XOPC_LOG_DIR` | `~/.xopc/logs` | Log directory |
| `XOPC_LOG_CONSOLE` | `true` | Enable console output |
| `XOPC_LOG_FILE` | `true` | Enable file output |
| `XOPC_LOG_RETENTION_DAYS` | `7` | Days to keep logs |
| `XOPC_PRETTY_LOGS` | `false` | Pretty print (dev) |
| `XOPC_LOG_LLM_PAYLOAD` | `false` | Include complete AI request context in debug logs (sensitive) |

---

## Querying logs

```typescript
import { queryLogs, getFileLogStats } from './utils/logger/log-store.js';
import { getRuntimeLogStats } from './utils/logger.js';

const errors = await queryLogs({
  levels: ['error', 'fatal'],
  module: 'Gateway:Service',
  limit: 100,
});

const fileStats = await getFileLogStats();
const runtimeStats = getRuntimeLogStats();
```

---

## Best practices

1. Use `{ err }` for errors (not `{ error }`).
2. Put structured fields first, short human message second.
3. Use stable module prefixes (e.g. `Gateway:HTTP`, `Agent:Tools`).
4. Set correlation with `runWithLogContext` at HTTP/channel entry points.

Implementation details: `src/utils/logger/` and [AGENTS.md](../../AGENTS.md#logging-conventions).
