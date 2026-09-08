import { describe, expect, it, vi } from 'vitest';

import type { ExtensionBrowserProvider } from '../../providers/extension.js';
import { ExtensionDriver } from '../extension-driver.js';

describe('ExtensionDriver', () => {
  it('sends the runtime-owned session id to the extension', async () => {
    const send = vi.fn().mockResolvedValue({
      id: 'command-1',
      result: {
        ok: true,
        receipt: { action: 'navigate', risk: 'read', durationMs: 1, verified: true },
      },
    });
    const provider = {
      start: vi.fn(),
      waitForConnection: vi.fn(),
      send,
    } as unknown as ExtensionBrowserProvider;
    const driver = new ExtensionDriver(provider, 1_000, true, vi.fn());

    await driver.navigate('runtime-session', {
      action: 'navigate',
      sessionId: '',
      url: 'https://www.google.com/',
    });

    expect(send).toHaveBeenCalledWith({
      action: 'navigate',
      sessionId: 'runtime-session',
      url: 'https://www.google.com/',
    }, 1_000, true);
  });
});
