import { once } from 'node:events';

import { serve } from '@hono/node-server';
import { afterEach, expect, it, vi } from 'vitest';

import { ConfigSchema } from '../../../../config/schema.js';
import { openXopcDatabase, closeXopcDatabase } from '../../../../storage/sqlite/connection.js';
import { buckets } from '../../../rate-limit/index.js';
import type { GatewayService } from '../../../service.js';
import { createHonoApp } from '../../app.js';

afterEach(() => { closeXopcDatabase(); buckets.resetAllForTests(); });

it('resolves development handoffs through an authenticated running Gateway and lazy bundle', async () => {
  openXopcDatabase({ path: ':memory:' });
  const auth = { mode: 'token' as const, token: 'local-app-development-test' };
  const resolve = vi.fn(() => 'app-developer');
  const service = { currentConfig: ConfigSchema.parse({ gateway: { auth } }),
    getResolvedAuth: () => auth, getEffectiveListenPort: () => 18790,
    localApps: { resolveDevelopmentConversation: resolve },
  } as unknown as GatewayService;
  const app = createHonoApp({ service });
  const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing Gateway address');
  const url = `http://127.0.0.1:${address.port}/api/local-apps/reading-list/development-conversation`;
  try {
    expect((await fetch(url, { method: 'POST' })).status).toBe(401);
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ conversationId: 'app-developer' });
    expect(resolve).toHaveBeenCalledExactlyOnceWith('reading-list');
  } finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); }
});
