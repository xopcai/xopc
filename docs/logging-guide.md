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
