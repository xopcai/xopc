import { describe, expect, it } from 'vitest';

import { logEntrySearchText, pinoRecordToLogEntry } from '../pino-record.js';

describe('pinoRecordToLogEntry', () => {
  it('maps pino JSON level and msg to LogEntry', () => {
    const entry = pinoRecordToLogEntry({
      time: '2026-06-13T10:00:00.000Z',
      level: 'error',
      msg: 'Agent processing failed: rate limit',
      module: 'Gateway:Service',
      requestId: 'req-1',
      phase: 'gateway.agent_run',
      err: { name: 'Error', message: 'rate limit', stack: 'Error: rate limit\n  at run' },
    });

    expect(entry.level).toBe('error');
    expect(entry.message).toBe('Agent processing failed: rate limit');
    expect(entry.module).toBe('Gateway:Service');
    expect(entry.requestId).toBe('req-1');
    expect(entry.meta?.phase).toBe('gateway.agent_run');
    expect(entry.meta?.err).toEqual({
      name: 'Error',
      message: 'rate limit',
      stack: 'Error: rate limit\n  at run',
    });
  });

  it('includes phase and err.message in search text', () => {
    const entry = pinoRecordToLogEntry({
      time: '2026-06-13T10:00:00.000Z',
      level: 'warn',
      msg: 'warn msg',
      phase: 'mcp.bridge.sse',
      err: { message: 'connection reset' },
    });

    const text = logEntrySearchText(entry);
    expect(text).toContain('mcp.bridge.sse');
    expect(text).toContain('connection reset');
  });
});
