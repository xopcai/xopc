import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { ConfigSchema, type Config } from '../../config/schema.js';
import { SelfConfigService, UnifiedSetupSceneService } from '../../self-config/index.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

it('serves user avatar, self-config inspect/rollback, and unified setup scenes through authenticated HTTP lazy bundles', async () => {
  const state = mkdtempSync(join(tmpdir(), 'xopc-self-config-http-'));
  vi.stubEnv('XOPC_STATE_DIR', state);
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: join(state, 'xopc.db') });

  const token = 'self-config-http-token';
  let currentConfig: Config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token } } });
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const saveConfig = async (next: Config) => {
    currentConfig = structuredClone(next);
    return { saved: true };
  };
  const selfConfig = new SelfConfigService({
    getConfig: () => currentConfig,
    saveConfig,
    getWorkspace: () => state,
    emitEvent: (event, payload) => emitted.push({ event, payload }),
  });
  const setupScenes = new UnifiedSetupSceneService({
    getConfig: () => currentConfig,
    saveConfig,
    saveProviderApiKey: async () => {},
    emitEvent: (event, payload) => emitted.push({ event, payload }),
  });

  const app = createHonoApp({
    service: {
      get currentConfig() { return currentConfig; },
      getResolvedAuth: () => ({ mode: 'token', token }),
      getAuthToken: () => token,
      isGatewayReady: () => true,
      emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
      selfConfig,
      setupScenes,
    } as unknown as GatewayService,
  });

  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing HTTP address');
    const origin = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    // 1. Auth gate on user avatar
    expect((await fetch(`${origin}/api/user-context/avatar`)).status).toBe(401);
    expect((await fetch(`${origin}/api/user-context/avatar`, { headers })).status).toBe(404);

    // 2. Upload, read, and delete user avatar
    const putAvatar = await fetch(`${origin}/api/user-context/avatar`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ base64: TINY_PNG_BASE64, mimeType: 'image/png' }),
    });
    expect(putAvatar.status).toBe(200);
    const getAvatar = await fetch(`${origin}/api/user-context/avatar`, { headers });
    expect(getAvatar.status).toBe(200);
    expect(getAvatar.headers.get('content-type')).toBe('image/png');

    // 3. Inspect self-config & verify user avatar appears configured
    const inspectRes = await fetch(`${origin}/api/self-config/inspect?domain=profile`, { headers });
    expect(inspectRes.status).toBe(200);
    const inspectBody = await inspectRes.json() as { ok: boolean; payload: { domains: Array<{ details: { userAvatar: { configured: boolean } } }> } };
    expect(inspectBody.ok).toBe(true);
    expect(inspectBody.payload.domains[0]?.details.userAvatar.configured).toBe(true);

    // 4. Patch via SelfConfigService and roll back via HTTP endpoint
    const patched = await selfConfig.patch({
      target: 'appearance.activity_detail',
      patch: { activityDetailDefault: 'stream' },
    });
    expect(patched.ok).toBe(true);
    const rollbackRes = await fetch(
      `${origin}/api/self-config/changes/${patched.receipt!.changeId}/rollback`,
      { method: 'POST', headers },
    );
    expect(rollbackRes.status).toBe(200);
    expect(currentConfig.gateway.webchat.activityDetailDefault).toBe('on');

    // 5. Unified setup scene via authenticated HTTP (/api/setup/web_search)
    const startSetup = await fetch(`${origin}/api/setup/web_search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conversationId: 'conv-http-1', action: 'start', resumeObjective: 'Search AI news' }),
    });
    expect(startSetup.status).toBe(200);
    const startJson = await startSetup.json() as { ok: boolean; payload: { id: string } };
    const submitSecret = await fetch(`${origin}/api/setup/web_search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conversationId: 'conv-http-1',
        setupId: startJson.payload.id,
        action: 'submit_secret',
        payload: { providerType: 'tavily', apiKey: 'tvly-http-secret' },
      }),
    });
    expect(submitSecret.status).toBe(200);
    expect(currentConfig.tools?.web?.search?.providers?.[0]?.type).toBe('tavily');

    // 6. Delete user avatar
    const delAvatar = await fetch(`${origin}/api/user-context/avatar`, { method: 'DELETE', headers });
    expect(delAvatar.status).toBe(200);
    expect((await fetch(`${origin}/api/user-context/avatar`, { headers })).status).toBe(404);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    vi.unstubAllEnvs();
    rmSync(state, { recursive: true, force: true });
  }
}, 30000);
