import { expect, it, vi } from 'vitest';

import { establishRemoteConsoleSession } from '../gateway/remote-console.js';

it('logs into the configured Gateway and verifies its cookie without exposing the saved token to the renderer', async () => {
  const fetch = vi.fn(async () => Response.json({ conversationId: 'gateway:browser:session' }));
  await establishRemoteConsoleSession({ fetch }, 'https://remote.example', 'saved-token');
  expect(fetch).toHaveBeenNthCalledWith(1, 'https://remote.example/api/browser-session', expect.objectContaining({
    method: 'POST', credentials: 'include', redirect: 'error',
    headers: { Authorization: 'Bearer saved-token', Origin: 'https://remote.example' },
  }));
  expect(fetch).toHaveBeenNthCalledWith(2, 'https://remote.example/api/browser-session', expect.objectContaining({
    credentials: 'include', redirect: 'error',
  }));
  expect(fetch.mock.calls[1][1]).not.toHaveProperty('headers');
});

it.each([401, 403, 409, 500])('rejects an unsuccessful credential exchange (%s)', async status => {
  const fetch = vi.fn(async () => new Response(null, { status }));
  await expect(establishRemoteConsoleSession({ fetch }, 'https://remote.example', 'saved-token')).rejects.toThrow('GATEWAY_CONSOLE_LOGIN_FAILED');
  expect(fetch).toHaveBeenCalledOnce();
});

it('requires a compatible console and a working cookie before loading the page', async () => {
  await expect(establishRemoteConsoleSession({ fetch: vi.fn(async () => Response.json({ authenticated: true })) },
    'https://remote.example', 'saved-token')).rejects.toThrow('GATEWAY_CONSOLE_INCOMPATIBLE');
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ conversationId: 'gateway:browser:session' }))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(establishRemoteConsoleSession({ fetch }, 'https://remote.example', 'saved-token')).rejects.toThrow('GATEWAY_CONSOLE_SESSION_REQUIRED');
});
