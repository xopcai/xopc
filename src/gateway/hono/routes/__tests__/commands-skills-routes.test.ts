import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seedTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { BROWSER_EXTENSION_ID } from '../../../../browser/extension-identity.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { createConversation } from '../../../../storage/sqlite/conversation-repository.js';
import { createDevice, issueDeviceTokenPair } from '../../../../storage/sqlite/device-access-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest } from '../../../../storage/sqlite/index.js';
import { signedDeviceHeaders } from '../../../security/__tests__/signed-device-headers.js';
import { DEFAULT_BROWSER_EXTENSION_SCOPES } from '../../../security/gateway-scopes.js';
import type { GatewayService } from '../../../service.js';
import { createHonoApp } from '../../app.js';
import { registerCommandsSkillsRoutes } from '../commands-skills.js';

function createApp() {
  const app = new Hono();
  const getAgentSkillsApi = vi.fn(() => ({ agentId: 'main', skills: [] }));
  const getSessionSkillsApi = vi.fn(async (conversationId: string) => ({
    agentId: 'main',
    workspacePath: '/project',
    conversationId,
    skills: [{ name: 'project-skill' }],
  }));
  const getSessionWorkspaceTrustApi = vi.fn(async () => ({
    workspacePath: '/project',
    required: true,
    decision: null,
    trusted: false,
  }));
  const setSessionWorkspaceTrustApi = vi.fn(async (_conversationId: string, trusted: boolean) => ({
    workspacePath: '/project',
    required: true,
    decision: trusted,
    trusted,
  }));
  const fetchSkillsPackageDetail = vi.fn(async (name: string) => ({ id: name }));
  const auth = { mode: 'token' as const, token: 'commands-skills-http-test-token' };
  const service = {
    getConfig: () => ({ agents: { default: 'main' } }),
    currentConfig: ConfigSchema.parse({ gateway: { bind: 'loopback', auth } }),
    getResolvedAuth: () => auth,
    isGatewayReady: () => true,
    getExtensionLoader: () => null,
    marketplace: {
      fetchSkillsPackageDetail,
      getAgentSkillsApi,
      getSessionSkillsApi,
      getSessionWorkspaceTrustApi,
      setSessionWorkspaceTrustApi,
    },
  } as unknown as GatewayService;
  registerCommandsSkillsRoutes(app, { service } as Parameters<typeof registerCommandsSkillsRoutes>[1]);
  return {
    app,
    service,
    fetchSkillsPackageDetail,
    getAgentSkillsApi,
    getSessionSkillsApi,
    getSessionWorkspaceTrustApi,
    setSessionWorkspaceTrustApi,
  };
}

describe('commands and skills routes', () => {
  const conversationId = '1698ede7-5aa5-473e-96f8-502d99fd7713';

  beforeEach(() => {
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: ':memory:' });
    createConversation({ agentId: 'main' }, '/project', conversationId);
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
  });

  it('serves composer discovery through the Gateway using an existing Chrome device grant', async () => {
    const { service } = createApp();
    seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: '/project' }] });
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const device = createDevice({
      displayName: 'Test Chrome',
      platform: 'chrome',
      extensionId: BROWSER_EXTENSION_ID,
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! },
      scopes: DEFAULT_BROWSER_EXTENSION_SCOPES,
    });
    const { accessToken } = issueDeviceTokenPair(device.id);
    const gateway = serve({ fetch: createHonoApp({ service }).fetch, hostname: '127.0.0.1', port: 0 });
    try {
      if (!gateway.listening) await once(gateway, 'listening');
      const address = gateway.address();
      if (!address || typeof address === 'string') throw new Error('Missing Gateway listener');
      const base = `http://127.0.0.1:${address.port}`;
      const request = (path: string, method = 'GET') => fetch(`${base}${path}`, {
        method,
        headers: signedDeviceHeaders(privateKey, accessToken, path, method, '', { Origin: `chrome-extension://${BROWSER_EXTENSION_ID}` }),
      });
      const path = `/api/chat/skills?conversationId=${conversationId}`;
      expect((await fetch(`${base}${path}`)).status).toBe(401);
      expect((await request('/api/commands')).status).toBe(200);
      const response = await request(path);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, payload: { skills: [{ name: 'project-skill' }] } });
      expect((await request(path, 'POST')).status).toBe(403);
      expect((await request(`/api/chat/workspace-trust?conversationId=${conversationId}`)).status).toBe(403);
    } finally {
      gateway.closeAllConnections();
      await new Promise<void>(resolve => gateway.close(() => resolve()));
    }
  });

  it('passes the publisher-qualified ClawHub reference to the detail service', async () => {
    const { app, fetchSkillsPackageDetail } = createApp();
    const reference = 'publisher/self-improving-agent';
    const response = await app.request(
      `/api/skills/marketplace/packages/${encodeURIComponent(reference)}?provider=clawhub`,
    );

    expect(response.status).toBe(200);
    expect(fetchSkillsPackageDetail).toHaveBeenCalledWith(reference, 'clawhub');
  });

  it('loads chat skills from the effective session workspace when conversationId is present', async () => {
    const { app, getAgentSkillsApi, getSessionSkillsApi } = createApp();

    const response = await app.request(
      `/api/chat/skills?agentId=main&conversationId=${encodeURIComponent(conversationId)}`,
    );

    expect(response.status).toBe(200);
    expect(getSessionSkillsApi).toHaveBeenCalledWith(conversationId);
    expect(getAgentSkillsApi).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      payload: { workspacePath: '/project', skills: [{ name: 'project-skill' }] },
    });
  });

  it('keeps the agent workspace fallback for callers without a session', async () => {
    const { app, getAgentSkillsApi, getSessionSkillsApi } = createApp();

    const response = await app.request('/api/chat/skills?agentId=main');

    expect(response.status).toBe(200);
    expect(getAgentSkillsApi).toHaveBeenCalledWith('main');
    expect(getSessionSkillsApi).not.toHaveBeenCalled();
  });

  it('reads and persists trust only for the session workspace', async () => {
    const { app, getSessionWorkspaceTrustApi, setSessionWorkspaceTrustApi } = createApp();

    const read = await app.request(
      `/api/chat/workspace-trust?conversationId=${encodeURIComponent(conversationId)}`,
    );
    expect(read.status).toBe(200);
    expect(getSessionWorkspaceTrustApi).toHaveBeenCalledWith(conversationId);

    const update = await app.request('/api/chat/workspace-trust', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId, trusted: true }),
    });
    expect(update.status).toBe(200);
    expect(setSessionWorkspaceTrustApi).toHaveBeenCalledWith(conversationId, true);
  });

  it('rejects malformed trust updates', async () => {
    const { app, setSessionWorkspaceTrustApi } = createApp();

    const response = await app.request('/api/chat/workspace-trust', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trusted: true }),
    });

    expect(response.status).toBe(400);
    expect(setSessionWorkspaceTrustApi).not.toHaveBeenCalled();
  });

  it.each(['skills', 'workspace-trust'])('returns 404 for %s when the conversation does not exist', async (resource) => {
    const { app, getAgentSkillsApi, getSessionSkillsApi, getSessionWorkspaceTrustApi } = createApp();
    const missingId = '11111111-1111-4111-8111-111111111111';
    const response = await app.request(`/api/chat/${resource}?conversationId=${missingId}`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'Conversation not found' });
    expect(getAgentSkillsApi).not.toHaveBeenCalled();
    expect(getSessionSkillsApi).not.toHaveBeenCalled();
    expect(getSessionWorkspaceTrustApi).not.toHaveBeenCalled();
  });

  it('does not change workspace trust for a missing conversation', async () => {
    const { app, setSessionWorkspaceTrustApi } = createApp();
    const response = await app.request('/api/chat/workspace-trust', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: '11111111-1111-4111-8111-111111111111', trusted: true }),
    });

    expect(response.status).toBe(404);
    expect(setSessionWorkspaceTrustApi).not.toHaveBeenCalled();
  });
});
