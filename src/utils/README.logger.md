# Logger Module - Usage Guide

## Overview

The optimized logger module provides:
- ✅ Contextual logging with `requestId`/`sessionId` tracking
- ✅ Automatic log rotation and cleanup
- ✅ Sampling for high-frequency debug logs
- ✅ Graceful shutdown with log flushing
- ✅ Unified configuration via `XOPCBOT_*` environment variables
- ✅ Support for compressed log files

---

## Quick Start

### Basic Usage

```typescript
import { logger, createLogger } from './utils/logger.js';

// Use the default logger
logger.info('Application started');
logger.error({ err }, 'Failed to connect');

// Create a module-specific logger
const log = createLogger('MyModule');
log.info('Module initialized');
```

### Contextual Logging

```typescript
import { createRequestLogger, clearRequestContext } from './utils/logger.js';

// Create a request-scoped logger
const requestLogger = createRequestLogger('req-123', {
  userId: 'user-456',
});

// All logs automatically include context
requestLogger.info('Processing request');
requestLogger.warn('Slow query detected');

// Clean up when done
clearRequestContext('req-123');
```

### Child Loggers with Context

```typescript
const baseLog = createLogger('AgentService');

// Add context to child logger
const sessionLog = baseLog.childContext({
  sessionId: 'session-789',
  userId: 'user-456',
});

sessionLog.info('Session created');
// Output includes: { sessionId: 'session-789', userId: 'user-456', ... }
```

---

## Log Levels

| Level | When to Use | Example |
|-------|-------------|---------|
| `trace` | Development debugging only | Function entry/exit |
| `debug` | Troubleshooting details | Request payloads, state changes |
| `info` | Normal operations (default) | Startup, shutdown, major events |
| `warn` | Recoverable issues | Deprecated usage, fallbacks |
| `error` | Failures with impact | API errors, validation failures |
| `fatal` | System cannot continue | Critical initialization failure |

```typescript
logger.trace('Entering function with params:', params);
logger.debug('Processing item:', { id, data });
logger.info('User logged in:', { userId });
logger.warn('Rate limit approaching:', { current, limit });
logger.error({ err }, 'Database connection failed');
logger.fatal('Cannot start without config');
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `XOPCBOT_LOG_LEVEL` | `info` | Minimum log level |
| `XOPCBOT_LOG_DIR` | `~/.xopcbot/logs` | Log directory |
| `XOPCBOT_LOG_CONSOLE` | `true` | Enable console output |
| `XOPCBOT_LOG_FILE` | `true` | Enable file output |
| `XOPCBOT_LOG_RETENTION_DAYS` | `7` | Days to keep logs |
| `XOPCBOT_PRETTY_LOGS` | `false` | Pretty print (dev) |

### Example Configuration

```bash
# Development with verbose logging
export XOPCBOT_LOG_LEVEL=debug
export XOPCBOT_PRETTY_LOGS=true

# Production with minimal logging
export XOPCBOT_LOG_LEVEL=warn
export XOPCBOT_LOG_RETENTION_DAYS=14

# Custom log directory
export XOPCBOT_LOG_DIR=/var/log/xopcbot
```

---

## Advanced Features

### Log Sampling

For high-frequency debug logs, use sampling to avoid flooding:

```typescript
import { logWithSample } from './utils/logger.js';

// Only log 10% of debug messages
logWithSample(logger, 'debug', 0.1, 'Processing item', { id });

// Log all warnings (sample rate = 1.0)
logWithSample(logger, 'warn', 1.0, 'High memory usage', { percent: 85 });
```

### Temporary Log Level Change

```typescript
import { withLogLevel } from './utils/logger.js';

// Temporarily enable debug logging
withLogLevel('debug', () => {
  logger.debug('This will be logged');
});

// Back to original level
logger.debug('This will NOT be logged');
```

### Log Rotation

```typescript
import { rotateLogs, cleanOldLogs } from './utils/logger.js';

// Rotate logs exceeding size limit
const rotation = await rotateLogs();
console.log(`Rotated: ${rotation.rotated}, Compressed: ${rotation.compressed}`);

// Clean logs older than 7 days
const cleanup = cleanOldLogs(7);
console.log(`Deleted: ${cleanup.deleted}, Errors: ${cleanup.errors}`);
```

---

## Querying Logs

```typescript
import { queryLogs, searchLogs, getLogStats } from './utils/log-store.js';

// Query by level and module
const errors = await queryLogs({
  levels: ['error', 'fatal'],
  module: 'AgentService',
  limit: 100,
});

// Search by keyword
const results = await searchLogs('connection failed', {
  from: '2024-01-01',
  to: '2024-01-31',
  limit: 50,
});

// Get logs for a specific request
const requestLogs = await queryLogs({
  requestId: 'req-123',
  order: 'asc',
});

// Get statistics
const stats = await getLogStats();
console.log(`Total files: ${stats.totalFiles}`);
console.log(`Total size: ${stats.totalSize} bytes`);
console.log(`Errors: ${stats.byLevel.error}`);
```

---

## Best Practices

### 1. Use Appropriate Log Levels

```typescript
// ❌ Bad: Using error for expected conditions
if (!user) {
  logger.error('User not found');
}

// ✅ Good: Using warn for expected conditions
if (!user) {
  logger.warn('User not found:', { userId });
}
```

### 2. Include Context

```typescript
// ❌ Bad: Missing context
logger.error('Failed to process');

// ✅ Good: With context
logger.error({ err, userId, itemId }, 'Failed to process item');
```

### 3. Avoid Sensitive Data

```typescript
// ❌ Bad: Logging sensitive data
logger.info('User login:', { password, token });

// ✅ Good: Sanitized
logger.info('User login:', { userId, ip: maskIp(ip) });
```

### 4. Use Structured Data

```typescript
// ❌ Bad: String concatenation
logger.info(`User ${userId} purchased item ${itemId} for $${price}`);

// ✅ Good: Structured data
logger.info('Purchase completed', { userId, itemId, price, currency: 'USD' });
```

### 5. Request Tracing

```typescript
// In middleware
app.use(async (req, res, next) => {
  const requestId = generateId();
  const logger = createRequestLogger(requestId, {
    method: req.method,
    path: req.path,
  });
  
  req.logger = logger;
  res.on('finish', () => clearRequestContext(requestId));
  
  next();
});

// In handlers
async function handleRequest(req, res) {
  req.logger.info('Processing request');
  // ... all logs include requestId
}
```

---

## Migration from Old API

### Before

```typescript
import { createLogger, setLogLevel } from './utils/logger.js';

const log = createLogger('MyModule');
log.info('Message');
setLogLevel('debug');
```

### After (Backward Compatible)

```typescript
import { createLogger, setLogLevel, LogLevel } from './utils/logger.js';

const log = createLogger('MyModule');
log.info('Message');
setLogLevel(LogLevel.DEBUG);

// New features available:
log.withContext({ requestId: '123' }).info('Message with context');
```

---

## Troubleshooting

### Logs Not Appearing

1. Check log level: `getLogLevel()`
2. Verify environment: `echo $XOPCBOT_LOG_LEVEL`
3. Check output streams: console vs file

### Log Files Growing Too Large

1. Enable rotation: `await rotateLogs()`
2. Set retention: `XOPCBOT_LOG_RETENTION_DAYS=7`
3. Use sampling for debug logs

### Missing Context in Logs

1. Ensure context is set before logging
2. Use `childContext()` for persistent context
3. Call `clearRequestContext()` when done

---

## Performance Tips

1. **Use sampling** for high-frequency debug logs
2. **Avoid logging in tight loops** - aggregate instead
3. **Use appropriate levels** - don't log debug in production
4. **Batch log queries** - don't query on every request
5. **Enable async logging** (default) for better throughput
