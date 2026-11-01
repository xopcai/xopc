import { expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../config/schema.js';
import { RemoteDeviceBrowserRuntime } from '../remote/device-runtime.js';

it('retains expired device admission until close confirms stop instead of forgetting an uncertain executor', async () => {
  vi.useFakeTimers();
  try {
    const config = ConfigSchema.parse({ browser: { enabled: true } }).browser;
    config.limits.sessionTimeoutMs = 1;
    const close = vi.fn(async () => { throw new Error('stop-unconfirmed'); });
    const driver = { kind: 'desktop' as const, connect: vi.fn(async () => {}), createSession: vi.fn(async () => {}), closeSession: close,
      disconnect: close, navigate: vi.fn(), perform: vi.fn(), tabs: vi.fn(),
      observe: vi.fn(async (sessionId: string) => ({ sessionId, tabId: 'tab', documentId: 'doc', revision: 1,
        url: 'https://fixture.invalid/', title: 'Fixture', nodes: [], changes: { added: [], changed: [], removed: [] } })),
    };
    const idle = vi.fn(), runtime = new RemoteDeviceBrowserRuntime({ getConfig: () => config, createDriver: async () => driver }, idle);
    expect(await runtime.execute('owner', { action: 'observe' })).toMatchObject({ ok: true });
    vi.setSystemTime(Date.now() + 10000);
    expect(await runtime.execute('owner', { action: 'observe' })).toMatchObject({ ok: true });
    expect(close).not.toHaveBeenCalled(); expect(driver.createSession).toHaveBeenCalledOnce();
    await expect(runtime.closeTaskSession('owner')).rejects.toThrow('stop-unconfirmed');
    expect(runtime.hasSessions()).toBe(true); expect(idle).not.toHaveBeenCalled();
    await expect(runtime.shutdown()).rejects.toThrow('stop-unconfirmed'); expect(runtime.hasSessions()).toBe(true);
  } finally { vi.useRealTimers(); }
});
