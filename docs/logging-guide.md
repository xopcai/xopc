# Logging Guide

## Log Levels

### TRACE (development only)
- Function entry/exit
- Variable values during execution
- Loop iterations
- **When to remove**: Before committing to production

### DEBUG
- Detailed troubleshooting info
- Request/response bodies (sanitized)
- State changes in complex flows
- Performance timing

### INFO (default level)
- Service startup/shutdown
- Major state transitions
- Important business events
- Configuration changes
- Session lifecycle (create, delete, compact)

### WARN
- Deprecated feature usage
- Recoverable errors
- Performance degradation
- Missing optional configuration
- Retry attempts

### ERROR
- Failed operations
- Unhandled exceptions
- Data corruption
- External service failures
- Authentication failures

### FATAL
- System cannot continue
- Critical initialization failure
- Data loss scenarios

## Best Practices

1. **Use structured logging**: `log.info({ userId, action }, 'User action')`
2. **Avoid logging sensitive data**: passwords, tokens, PII
3. **Use appropriate levels**: Don't use error for expected failures
4. **Include context**: session keys, user IDs, operation names
5. **Be concise**: Messages should be clear and actionable
6. **Remove debug logs**: Clean up temporary debugging logs

## Examples

```typescript
// Good: Structured with context
log.info({ sessionKey, messageCount }, 'Session loaded');

// Good: Error with context
log.error({ err, sessionKey }, 'Failed to save session');

// Bad: Unstructured
log.info('Session ' + sessionKey + ' loaded with ' + messageCount + ' messages');

// Bad: Missing context
log.error('Failed to save');
```

## Advanced Features

### Sensitive Data Redaction

xopcbot automatically redacts sensitive data from logs to prevent credential leaks:

**Supported Patterns:**
| Pattern | Example |
|--------|---------|
| OpenAI API Key | `sk-...` |
| Anthropic API Key | `sk-ant-...` |
| GitHub Token | `ghp_...`, `gho_...` |
| Slack Token | `xoxb-...`, `xoxp-...` |
| Telegram Token | `123456:ABC-...` |
| Generic Bearer Token | `Bearer ...` |
| JWT Token | `eyJ...` |
| AWS Keys | `AKIA...`, `aws_secret...` |

**Configuration:**

```bash
# Environment variable (default: tools)
export XOPCBOT_REDACT_MODE=tools    # Only redact in tool calls
export XOPCBOT_REDACT_MODE=always    # Always redact
export XOPCBOT_REDACT_MODE=off      # Disable redaction
```

**Programmatic Usage:**
```typescript
import { redact, redactForLog } from './utils/redact.js';

// Redact a single value
const safe = redact('sk-1234567890abcdef');
// Output: "sk-[REDACTED]"

// Redact log data
const logData = { apiKey: 'sk-xxx', message: 'Hello' };
const safeLog = redactForLog(logData);
```

### Diagnostic Events

Structured event logging for monitoring and debugging:

```typescript
import { emitDiagnosticEvent } from './utils/diagnostic-events.js';

// Webhook events
emitDiagnosticEvent('webhook', { url, status, duration });

// Message events
emitDiagnosticEvent('message', { channel, userId, type });

// Session events
emitDiagnosticEvent('session', { sessionKey, action });

// Model usage
emitDiagnosticEvent('model', { 
  model, 
  inputTokens, 
  outputTokens, 
  duration 
});
```

### Real-time Log Streaming (SSE)

Stream logs in real-time via Server-Sent Events:

```bash
# Subscribe to all logs
curl -N http://localhost:18790/api/logs/stream

# Filter by level
curl -N "http://localhost:18790/api/logs/stream?levels=info,warn,error"

# Filter by module
curl -N "http://localhost:18790/api/logs/stream?module=Agent"
```

**Response Format:**
```
data: {"timestamp":"2026-02-25T12:00:00.000Z","level":"info","message":"Server started"}
data: {"type":"heartbeat","subscribers":1}
```

**JavaScript Client:**
```javascript
const eventSource = new EventSource('/api/logs/stream?levels=info,warn,error');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
};

eventSource.onerror = () => eventSource.close();
```
