import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionInputCoordinator } from '../session-input-coordinator.js';
import {
  closeXopcDatabase,
  openXopcDatabase,
  resetXopcDatabaseSingletonForTest,
} from '../../../storage/sqlite/index.js';

describe('SessionInputCoordinator', () => {
  let dir: string;
  const sessionKey = 'agent:main:webchat:default:direct:test';
  const origin = { type: 'channel' as const, channel: 'webchat' };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'xopc-input-coordinator-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(dir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps one active run and publishes revisioned full snapshots', async () => {
    const completions: Array<(value: { status: string; summary: string }) => void> = [];
    const execute = vi.fn(() => new Promise<{ status: string; summary: string }>((resolve) => {
      completions.push(resolve);
    }));
    const emitted: unknown[] = [];
    const coordinator = new SessionInputCoordinator({
      sessionExists: async () => true,
      execute,
      prepareAttachments: async (_key, attachments) => attachments,
      steer: async () => false,
      emit: (_type, payload) => emitted.push(payload),
    });

    const first = await coordinator.submit({
      sessionKey, clientMessageId: 'client-1', delivery: 'next', content: 'one', origin,
    });
    const second = await coordinator.submit({
      sessionKey, clientMessageId: 'client-2', delivery: 'next', content: 'two', origin,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot(sessionKey).inputs.map((row) => row.status)).toEqual(['running', 'queued']);

    completions.shift()?.({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    completions.shift()?.({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(coordinator.snapshot(sessionKey).inputs).toEqual([]));

    const revisions = emitted.map((value) => (value as { revision: number }).revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(new Set(revisions).size).toBeGreaterThan(2);
  });

  it('deduplicates retries and falls back from unavailable steer to FIFO next delivery', async () => {
    let complete!: (value: { status: string; summary: string }) => void;
    const execute = vi.fn(() => new Promise<{ status: string; summary: string }>((resolve) => {
      complete = resolve;
    }));
    const coordinator = new SessionInputCoordinator({
      sessionExists: async () => true,
      execute,
      prepareAttachments: async (_key, attachments) => attachments,
      steer: async () => false,
      emit: () => {},
    });

    await coordinator.submit({ sessionKey, clientMessageId: 'active', delivery: 'next', content: 'active', origin });
    const fallback = await coordinator.submit({
      sessionKey, clientMessageId: 'steer-retry', delivery: 'steer', content: 'guide', origin,
    });
    const duplicate = await coordinator.submit({
      sessionKey, clientMessageId: 'steer-retry', delivery: 'steer', content: 'duplicate', origin,
    });

    expect(fallback.ok && fallback.effectiveDelivery).toBe('next');
    expect(duplicate.ok && duplicate.state.inputs.filter((row) => row.clientMessageId === 'steer-retry')).toHaveLength(1);
    expect(coordinator.snapshot(sessionKey).inputs.map((row) => row.status)).toEqual(['running', 'queued']);

    complete({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    complete({ status: 'ok', summary: 'done' });
    await vi.waitFor(() => expect(coordinator.snapshot(sessionKey).inputs).toEqual([]));
  });

  it('tracks an accepted steer against the active run until that run completes', async () => {
    let complete!: (value: { status: string; summary: string }) => void;
    const coordinator = new SessionInputCoordinator({
      sessionExists: async () => true,
      execute: () => new Promise<{ status: string; summary: string }>((resolve) => { complete = resolve; }),
      prepareAttachments: async (_key, attachments) => attachments,
      steer: async () => true,
      emit: () => {},
    });

    await coordinator.submit({ sessionKey, clientMessageId: 'active', delivery: 'next', content: 'active', origin });
    const steered = await coordinator.submit({
      sessionKey, clientMessageId: 'steer-1', delivery: 'steer', content: 'adjust', origin,
    });

    expect(steered.ok && steered.effectiveDelivery).toBe('steer');
    expect(coordinator.snapshot(sessionKey).inputs.map((row) => row.status)).toEqual(['running', 'injecting']);

    complete({ status: 'ok', summary: 'done' });
    await expect(coordinator.waitForCompletion(sessionKey, 'steer-1')).resolves.toBeUndefined();
    expect(coordinator.snapshot(sessionKey).inputs).toEqual([]);
  });
});
