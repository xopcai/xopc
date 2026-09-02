import { describe, expect, it, vi } from 'vitest';

import { collectSupportReport } from '../collect-support-report.js';

describe('collectSupportReport', () => {
  it('builds a bounded, redacted report from doctor and correlated logs', async () => {
    const queryLogs = vi.fn(async () => [{
      timestamp: '2026-09-02T02:00:00.000Z',
      level: 'error' as const,
      message: 'Failed request-private at /Users/alice/.xopc/xopc.json token=super-secret-token-value',
      module: 'Gateway',
      requestId: 'request-private',
      sessionId: 'session-private',
      meta: {
        phase: 'startup',
        ignoredPrivateField: 'must not be exported',
        err: { name: 'Error', message: 'boom', stack: 'at /Users/alice/workspace/a.ts:1' },
      },
    }]);
    const report = await collectSupportReport({
      problem: 'Gateway cannot start',
      occurredAt: '2026-09-02T02:00:00.000Z',
      requestId: 'request-private',
      clientContext: { surface: 'electron', currentPage: 'http://localhost/#/settings?token=x' },
    }, {
      now: () => new Date('2026-09-02T02:01:00.000Z'),
      paths: {
        homeDir: '/Users/alice',
        stateDir: '/Users/alice/.xopc',
        workspaceDir: '/Users/alice/workspace',
      },
      collectDoctor: async () => [{
        id: 'state-integrity',
        label: 'State directory',
        status: 'fail',
        message: 'Cannot read /Users/alice/.xopc',
        hints: ['/Users/alice/.xopc'],
      }],
      queryLogs,
    });

    expect(queryLogs).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'request-private',
      levels: ['warn', 'error', 'fatal'],
      limit: 100,
    }));
    expect(report.markdown).toContain('Gateway cannot start');
    expect(report.markdown).toContain('<STATE_DIR>');
    expect(report.markdown).not.toContain('super-secret-token-value');
    expect(report.markdown).not.toContain('request-private');
    expect(JSON.stringify(report)).not.toContain('must not be exported');
    expect(report.logs[0]?.requestId).toMatch(/^request_/);
    expect(report.logs[0]?.sessionId).toMatch(/^session_/);
  });

  it('still creates a report when diagnostics cannot be collected', async () => {
    const report = await collectSupportReport({ problem: 'Gateway is unavailable' }, {
      now: () => new Date('2026-09-02T02:00:00.000Z'),
      collectDoctor: async () => { throw new Error('doctor failed'); },
      queryLogs: async () => { throw new Error('logs unavailable'); },
    });

    expect(report.markdown).toContain('Gateway is unavailable');
    expect(report.doctor.map((check) => check.id)).toEqual([
      'support-doctor-collection',
      'support-log-collection',
    ]);
  });

  it('falls back from an empty request query to a session query', async () => {
    const queryLogs = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ timestamp: '2026-09-02T02:00:00.000Z', level: 'warn', message: 'retry' }]);
    const report = await collectSupportReport({
      problem: 'No reply',
      requestId: 'request-1',
      sessionKey: 'session-1',
    }, {
      now: () => new Date('2026-09-02T02:00:00.000Z'),
      collectDoctor: async () => [],
      queryLogs,
    });

    expect(queryLogs).toHaveBeenCalledTimes(2);
    expect(queryLogs.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ sessionKey: 'session-1' }));
    expect(report.logs).toHaveLength(1);
  });

  it('does not collect unrelated logs when a correlation id has no matches', async () => {
    const queryLogs = vi.fn().mockResolvedValue([]);
    const report = await collectSupportReport({
      problem: 'No reply',
      requestId: 'request-1',
      sessionKey: 'session-1',
    }, {
      now: () => new Date('2026-09-02T02:00:00.000Z'),
      collectDoctor: async () => [],
      queryLogs,
    });

    expect(queryLogs).toHaveBeenCalledTimes(2);
    expect(report.logs).toEqual([]);
  });
});
