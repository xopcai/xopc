import { afterEach, describe, expect, it, vi } from 'vitest';

const shutdown = vi.fn(async () => {});

vi.mock('../extension.js', () => ({
  ExtensionBrowserProvider: class {
    start = vi.fn(async () => {});
    shutdown = shutdown;
    isConnected = vi.fn(() => false);
  },
}));

describe('extension-ws-acquire', () => {
  afterEach(async () => {
    vi.resetModules();
    shutdown.mockClear();
  });

  it('keeps the listener until every holder releases it', async () => {
    const mod = await import('../extension-ws-acquire.js');
    const first = await mod.acquireExtensionBrowserServer({ port: 19820, host: '127.0.0.1' });
    const second = await mod.acquireExtensionBrowserServer({ port: 19820, host: '127.0.0.1' });

    expect(mod.getExtensionBrowserServerSnapshot().refCount).toBe(2);
    await first.release();
    expect(mod.getExtensionBrowserServerSnapshot().refCount).toBe(1);
    expect(shutdown).not.toHaveBeenCalled();
    await second.release();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(mod.getExtensionBrowserServerSnapshot().active).toBe(false);
  });
});
