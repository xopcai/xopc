import { describe, expect, it, vi } from 'vitest';

import { EmbeddedRunConflictError, EmbeddedRunRegistry } from '../runs.js';

const identity = {
  conversationId: 'agent:main:test',
  transcriptId: 'session-1',
  runId: 'run-1',
};

describe('EmbeddedRunRegistry', () => {
  it('keeps an execution cancellation requested before its lease exists', async () => {
    const registry = new EmbeddedRunRegistry();
    const control = registry.reserveCancellation(identity);
    expect(await registry.abortByConversationId(identity.conversationId, 'user_cancelled', identity.runId)).toBe(true);
    expect(control.signal.aborted).toBe(true);
    const lease = registry.acquire(identity);
    expect(lease.signal).toBe(control.signal);
    const stop = vi.fn(async () => {});
    await lease.attach({} as never, stop);
    expect(stop).toHaveBeenCalledOnce();
    lease.release(); control.release();
  });

  it('keeps a prepared old cancellation and its release isolated from a new execution', async () => {
    const registry = new EmbeddedRunRegistry();
    const old = registry.reserveCancellation(identity);
    const next = { ...identity, runId: 'run-2' };
    const control = registry.reserveCancellation(next);
    const lease = registry.acquire(next);
    expect(await registry.abortByConversationId(identity.conversationId, 'user_cancelled', identity.runId)).toBe(true);
    expect(old.signal.aborted).toBe(true);
    expect(control.signal.aborted).toBe(false);
    expect(lease.signal.aborted).toBe(false);
    old.release();
    expect(await registry.abortByConversationId(identity.conversationId, 'user_cancelled', identity.runId)).toBe(false);
    expect(lease.signal.aborted).toBe(false);
    lease.release(); control.release();
  });

  it('does not retain cancellation after an execution leaves startup', async () => {
    const registry = new EmbeddedRunRegistry();
    const old = registry.reserveCancellation(identity);
    await registry.abortByConversationId(identity.conversationId, 'user_cancelled', identity.runId);
    old.release();
    const fresh = registry.reserveCancellation(identity);
    expect(fresh.signal.aborted).toBe(false);
    expect(await registry.abortByConversationId('another-conversation', 'user_cancelled', identity.runId)).toBe(false);
    expect(fresh.signal.aborted).toBe(false);
    fresh.release();
  });

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

    await expect(registry.abortByConversationId(identity.conversationId)).resolves.toBe(true);
    expect(lease.signal.aborted).toBe(true);
    await lease.attach({ steer: vi.fn() } as any, abort);
    expect(abort).toHaveBeenCalledOnce();
  });

  it('rejects steering for an earlier or cancelled execution', async () => {
    const registry = new EmbeddedRunRegistry();
    const lease = registry.acquire({ ...identity, runId: 'new-run' });
    const steer = vi.fn(async () => {});
    await lease.attach({ steer } as never, async () => {});
    expect(await registry.steerByConversationId(identity.conversationId, 'old steer', identity.runId)).toBe(false);
    expect(steer).not.toHaveBeenCalled();
    await registry.abortByConversationId(identity.conversationId);
    expect(await registry.steerByConversationId(identity.conversationId, 'late steer', 'new-run')).toBe(false);
    expect(steer).not.toHaveBeenCalled();
    lease.release();
  });

  it('keeps steering available without changing run ownership', async () => {
    const registry = new EmbeddedRunRegistry();
    const lease = registry.acquire(identity);
    const steer = vi.fn().mockResolvedValue(undefined);
    await lease.attach({ steer } as any, vi.fn());

    await expect(registry.steerByConversationId(identity.conversationId, 'change course')).resolves.toBe(true);
    expect(steer).toHaveBeenCalledWith('change course');
    expect(registry.size()).toBe(1);
  });
  it('ignores an old run cancellation after the conversation lease moves to a new run', async () => {
    const registry = new EmbeddedRunRegistry();
    const old = registry.acquire(identity);
    old.release();
    const current = registry.acquire({ ...identity, runId: 'run-2' });
    const abort = vi.fn().mockResolvedValue(undefined);
    await current.attach({ steer: vi.fn() } as any, abort);
    expect(await registry.abortByConversationId(identity.conversationId, 'user_cancelled', identity.runId)).toBe(false);
    expect(current.signal.aborted).toBe(false);
    expect(abort).not.toHaveBeenCalled();
    expect(await registry.abortByConversationId(identity.conversationId, 'user_cancelled', 'run-2')).toBe(true);
    expect(abort).toHaveBeenCalledOnce();
    current.release();
  });
});

it('propagates explicit user cancellation through the execution lease', async () => {
  const registry = new EmbeddedRunRegistry();
  const lease = registry.acquire(identity);
  await registry.abortByConversationId(identity.conversationId, 'user_cancelled');
  expect(lease.signal.reason).toMatchObject({ code: 'user_cancelled', message: 'Embedded run aborted' });
});
