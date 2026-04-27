import { unlink } from 'node:fs/promises';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { testLockPath } = vi.hoisted(() => {
  const base = process.env.TMPDIR ?? process.env.TEMP ?? '/tmp';
  return { testLockPath: `${base.replace(/\/$/, '')}/xopc-ul-test-${process.pid}-${Date.now()}.json` };
});

vi.mock('../../config/paths.js', async (importActual) => {
  const actual = await importActual<typeof import('../../config/paths.js')>();
  return { ...actual, resolveUpdateLockPath: () => testLockPath };
});

import { acquireUpdateLock } from '../update-lock.js';

describe('acquireUpdateLock', () => {
  beforeEach(async () => {
    await unlink(testLockPath).catch(() => {});
  });

  afterAll(async () => {
    await unlink(testLockPath).catch(() => {});
  });

  it('acquire then release allows a second acquire', async () => {
    const a = await acquireUpdateLock('cli');
    expect(a).not.toBeNull();
    await a!.release();
    const b = await acquireUpdateLock('gateway');
    expect(b).not.toBeNull();
    await b!.release();
  });

  it('second acquire returns null while lock held by this process', async () => {
    const first = await acquireUpdateLock('cli');
    expect(first).not.toBeNull();
    const second = await acquireUpdateLock('gateway');
    expect(second).toBeNull();
    await first!.release();
  });
});
