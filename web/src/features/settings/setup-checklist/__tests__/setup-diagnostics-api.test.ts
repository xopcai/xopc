import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchBrowserDiagnostics } from '@/features/settings/setup-checklist/setup-diagnostics-api';

describe('fetchBrowserDiagnostics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('links extension diagnostics to the browser extension settings tab', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            running: true,
            connected: false,
            artifacts: { installed: true },
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(fetchBrowserDiagnostics({ enabled: true, backend: 'extension' })).resolves.toEqual([
      {
        id: 'browser-extension',
        label: 'Browser: Chrome extension',
        status: 'warn',
        message: 'Chrome extension is installed but not connected.',
        path: '/settings/agent-browser?tab=extension',
      },
    ]);
  });
});
