// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ElectronAPI } from '@/types/electron';

import { startAsyncOAuthLogin } from '../oauth-api';

describe('OAuth API', () => {
  afterEach(() => {
    delete window.electronAPI;
    window.location.hash = '';
    vi.unstubAllGlobals();
  });

  it('includes the current internal route for Desktop OAuth return', async () => {
    window.electronAPI = {} as ElectronAPI;
    window.location.hash = '#/chat/new?onboarding=1';
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({
      payload: { sessionId: 'oauth-1', provider: 'xopc-cloud', status: 'pending' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await startAsyncOAuthLogin('xopc-cloud');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      provider: 'xopc-cloud',
      client: 'desktop',
      returnPath: '/chat/new?onboarding=1',
    });
  });

  it('does not include a return route for browser OAuth', async () => {
    window.location.hash = '#/settings/capabilities/models';
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({
      payload: { sessionId: 'oauth-1', provider: 'xopc-cloud', status: 'pending' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await startAsyncOAuthLogin('xopc-cloud');

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      provider: 'xopc-cloud',
      client: 'web',
    });
  });
});
