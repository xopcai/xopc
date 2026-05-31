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

  it('forceShutdownExtensionBrowserServer clears shared state regardless of refCount', async () => {
    const mod = await import('../extension-ws-acquire.js');
    const { release } = await mod.acquireExtensionBrowserServer({ port: 19820, host: '127.0.0.1' });
    await mod.acquireExtensionBrowserServer({ port: 19820, host: '127.0.0.1' });

    expect(mod.getExtensionBrowserServerSnapshot().refCount).toBe(2);

    const forced = await mod.forceShutdownExtensionBrowserServer();
    expect(forced).toBe(true);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(mod.getExtensionBrowserServerSnapshot().active).toBe(false);

    await release();
    expect(mod.getExtensionBrowserServerSnapshot().active).toBe(false);
  });
});
