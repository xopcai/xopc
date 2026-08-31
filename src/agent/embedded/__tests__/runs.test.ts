import { describe, expect, it, vi } from 'vitest';

import { EmbeddedRunConflictError, EmbeddedRunRegistry } from '../runs.js';

const identity = {
  sessionKey: 'agent:main:test',
  sessionId: 'session-1',
  runId: 'run-1',
};

describe('EmbeddedRunRegistry', () => {
  it('reserves ownership before the runner is attached', () => {
    const registry = new EmbeddedRunRegistry();
    const lease = registry.acquire(identity);

    expect(() => registry.acquire({ ...identity, runId: 'run-2' }))
      .toThrow(EmbeddedRunConflictError);
    lease.release();
    expect(() => registry.acquire({ ...identity, runId: 'run-2' })).not.toThrow();
  });

  it('honors an abort requested while runner acquisition is pending', async () => {
    const registry = new EmbeddedRunRegistry();
    const lease = registry.acquire(identity);
    const abort = vi.fn().mockResolvedValue(undefined);

    await expect(registry.abortBySessionKey(identity.sessionKey)).resolves.toBe(true);
    expect(lease.signal.aborted).toBe(true);
    await lease.attach({ steer: vi.fn() } as any, abort);
    expect(abort).toHaveBeenCalledOnce();
  });

  it('keeps steering available without changing run ownership', async () => {
    const registry = new EmbeddedRunRegistry();
    const lease = registry.acquire(identity);
    const steer = vi.fn().mockResolvedValue(undefined);
    await lease.attach({ steer } as any, vi.fn());

    await expect(registry.steerBySessionKey(identity.sessionKey, 'change course')).resolves.toBe(true);
    expect(steer).toHaveBeenCalledWith('change course');
    expect(registry.size()).toBe(1);
  });
});
