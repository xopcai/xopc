import { describe, expect, it, vi } from 'vitest';

import type { PlatformRuntimeClient, RuntimeCommand } from '../client.js';
import { processRuntimeCommand } from '../worker.js';

function command(): RuntimeCommand {
  return {
    id: 'command_1',
    runId: 'run_1',
    type: 'run.start',
    payload: {
      organizationId: 'org_1', workspaceId: 'workspace_1', runtimeId: 'runtime_1', traceId: 'trace_1',
    },
    leaseToken: 'xopc_lease_token',
    leaseExpiresAt: Date.now() + 60_000,
  };
}

describe('runtime worker', () => {
  it('reports ordered lifecycle events around successful execution', async () => {
    const report = vi.fn().mockResolvedValue('accepted');
    const client = { lease: vi.fn().mockResolvedValue(command()), report } as unknown as PlatformRuntimeClient;
    await expect(processRuntimeCommand(client, async () => ({ output: 'done' }))).resolves.toBe('completed');
    expect(report.mock.calls.map(([event]) => [event.type, event.sequence])).toEqual([
      ['xopc.run.started', 1], ['xopc.run.succeeded', 2],
    ]);
  });

  it('reports a failed terminal event without leaking an exception object', async () => {
    const report = vi.fn().mockResolvedValue('accepted');
    const client = { lease: vi.fn().mockResolvedValue(command()), report } as unknown as PlatformRuntimeClient;
    await expect(processRuntimeCommand(client, async () => { throw new Error('boom'); })).resolves.toBe('failed');
    expect(report.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      type: 'xopc.run.failed', sequence: 2, payload: { error: 'boom' },
    }));
  });

  it('waits for an in-flight renewal and fails the run when the lease is lost', async () => {
    vi.useFakeTimers();
    try {
      const report = vi.fn().mockResolvedValue('accepted');
      const client = {
        lease: vi.fn().mockResolvedValue(command()),
        renew: vi.fn().mockRejectedValue(new Error('lease lost')),
        report,
      } as unknown as PlatformRuntimeClient;
      await expect(processRuntimeCommand(client, async (_command, signal) => {
        await vi.advanceTimersByTimeAsync(30_000);
        expect(signal.aborted).toBe(true);
        return { output: 'must not succeed' };
      })).resolves.toBe('failed');
      expect(report.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
        type: 'xopc.run.failed', payload: { error: 'lease lost' },
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts execution and reports cancellation when the platform requests it', async () => {
    vi.useFakeTimers();
    try {
      const report = vi.fn().mockResolvedValue('accepted');
      const client = {
        lease: vi.fn().mockResolvedValue(command()),
        renew: vi.fn().mockResolvedValue({ leaseExpiresAt: Date.now() + 60_000, cancelRequested: true }),
        report,
      } as unknown as PlatformRuntimeClient;
      await expect(processRuntimeCommand(client, async (_command, signal) => {
        await vi.advanceTimersByTimeAsync(30_000);
        expect(signal.aborted).toBe(true);
        throw new Error('handler cleanup failed after cancellation');
      })).resolves.toBe('cancelled');
      expect(report.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
        type: 'xopc.run.cancelled', sequence: 2, payload: {},
      }));
    } finally {
      vi.useRealTimers();
    }
  });
});
