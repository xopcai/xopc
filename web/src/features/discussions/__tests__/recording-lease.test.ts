// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { acquireRecordingLease } from '../recording-lease';
afterEach(() => vi.restoreAllMocks());
it('refuses concurrent recovery and releases ownership explicitly without a stale timeout', async () => {
  const held = new Set<string>();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (name: string, _options: unknown, callback: (lock: object | null) => Promise<void>) => {
      if (held.has(name)) return callback(null);
      held.add(name); try { await callback({ name }); } finally { held.delete(name); }
    },
  } });
  try {
    const release = await acquireRecordingLease('same-source');
    await expect(acquireRecordingLease('same-source')).rejects.toThrow('another tab');
    const other = await acquireRecordingLease('different-source'); other();
    release(); await Promise.resolve(); await Promise.resolve();
    const resumed = await acquireRecordingLease('same-source'); resumed();
  } finally { Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }); }
});
