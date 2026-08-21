import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeDesktopEndpointTool } from './desktop-tools';

describe('desktop endpoint tools', () => {
  const writeText = vi.fn(async () => true);
  const readText = vi.fn(async () => 'copied text');
  const openExternalUrl = vi.fn(async () => ({ ok: true as const }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', {
      electronAPI: {
        platform: 'darwin',
        clipboard: { writeText, readText },
        shell: { openExternalUrl },
      },
    });
  });

  it('uses the constrained Electron clipboard bridge', async () => {
    await expect(executeDesktopEndpointTool('desktop.clipboard.read', {}))
      .resolves.toEqual({ text: 'copied text' });
    await expect(executeDesktopEndpointTool('desktop.clipboard.write', { text: 'next' }))
      .resolves.toEqual({ text: 'Clipboard updated.' });
    expect(writeText).toHaveBeenCalledWith('next');
  });

  it('allows only HTTP(S) external URLs', async () => {
    await expect(executeDesktopEndpointTool('desktop.app.open_external', { url: 'file:///tmp/a' }))
      .rejects.toThrow('Only HTTP and HTTPS');
    await executeDesktopEndpointTool('desktop.app.open_external', { url: 'https://example.com/a' });
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/a');
  });
});
