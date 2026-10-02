import { afterEach, describe, expect, it, vi } from 'vitest';
import { serve } from '@hono/node-server';
import { once } from 'node:events';

import { ConfigSchema } from '../../../../config/schema.js';
import { closeXopcDatabase, openXopcDatabase } from '../../../../storage/sqlite/connection.js';
import { createHonoApp } from '../../app.js';
import { buckets } from '../../../rate-limit/index.js';
import type { GatewayService } from '../../../service.js';

const token = 'execution-detail-test-token';
const origin = 'https://test.frp.xopc.ai';

describe('authenticated execution detail route', () => {
  afterEach(() => { closeXopcDatabase(); buckets.resetAllForTests(); });

  it('reaches the eager sessions route through the Gateway app and requires auth', async () => {
    openXopcDatabase({ path: ':memory:' });
    buckets.resetAllForTests();
    const getExecutionDetail = vi.fn().mockResolvedValue({ turnId: 'turn-1', steps: [{ id: 's1', kind: 'thinking' }] });
    const auth = { mode: 'token' as const, token };
    const service = {
      currentConfig: ConfigSchema.parse({ gateway: { port: 18790, corsOrigins: [origin], auth } }),
      getResolvedAuth: () => auth,
      getEffectiveListenPort: () => 18790,
      isGatewayReady: () => true,
      getHealth: () => ({ status: 'healthy' }),
      sessions: { getExecutionDetail },
    } as unknown as GatewayService;
    const app = createHonoApp({ service });
    const url = `${origin}/api/sessions/conversation/execution-detail?turnId=turn-1`;
    const headers = { Host: 'test.frp.xopc.ai', Origin: origin };
    expect((await app.request(url, { headers })).status).toBe(401);
    const response = await app.request(url, { headers: { ...headers, Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect((await response.json()).detail.steps).toEqual([{ id: 's1', kind: 'thinking' }]);
    expect(getExecutionDetail).toHaveBeenCalledWith('conversation', 'turn-1');

    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
    try {
      if (!server.listening) await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
      const path = `http://127.0.0.1:${address.port}/api/sessions/conversation/execution-detail?turnId=turn-1`;
      expect((await fetch(path)).status).toBe(401);
      const liveResponse = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
      expect(liveResponse.status).toBe(200);
      expect((await liveResponse.json()).detail.turnId).toBe('turn-1');
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
