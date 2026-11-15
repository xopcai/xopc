import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { once } from 'node:events';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { createCapabilityCatalogTool } from '../../agent/tools/capability-catalog-tool.js';
import { ConfigSchema } from '../../config/schema.js';
import { personalAgentId } from '../../personal-agent/repository.js';
import { closeXopcDatabase } from '../../storage/sqlite/connection.js';
import { createDevice, issueDeviceTokenPair } from '../../storage/sqlite/device-access-repository.js';
import { getOrCreateGatewayIdentity } from '../../storage/sqlite/gateway-identity-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createHonoApp } from '../hono/app.js';
import { proofDigest, requestProofMessage } from '../security/device-request-proof.js';
import { DEFAULT_MOBILE_SCOPES } from '../security/gateway-scopes.js';
import type { GatewayService } from '../service.js';

vi.mock('../../extensions/marketplace.js', () => ({
  fetchRegistry: async () => ({ extensions: [
    { id: 'meeting-plugin', name: 'Meeting Plugin', description: 'Manage meetings', packageType: 'plugin' },
    { id: 'desktop-app', name: 'Desktop App', packageType: 'extension' },
  ] }),
}));

vi.mock('../../agent/skills/marketplace/search.js', () => ({
  searchSkillMarketplaces: async () => ({ sources: [{ ok: true }], results: [{ id: 'safe-test-skill', name: 'Sample skill',
    provider: 'store', description: 'A test fixture', author: 'owner', install: { reference: 'safe-test-skill' }, security: { status: 'pass' } }] }),
}));

vi.mock('../../extensions/agent-plugins/inventory.js', () => ({
  listAgentPluginInventory: () => [{
    pluginId: 'installed-plugin', name: 'Installed Plugin', installationState: 'installed',
    installationSource: '/private/installation', workspacePaths: ['/private/workspace'],
  }],
}));

vi.mock('../../capabilities/store-connector.js', async (importActual) => ({
  ...await importActual<typeof import('../../capabilities/store-connector.js')>(),
  listStoreConnectorCatalog: async () => [
    { name: 'sample-service', description: 'Example service', localizations: { 'zh-CN': { displayName: '示例服务' } } },
  ],
}));

it('serves only category metadata to a signed mobile device through the authenticated Gateway', async () => {
  initializeTestAgentCatalog({ agents: [
    { id: 'main', enabled: true },
    { id: 'coder', enabled: true, workspace: '/private/workspace', profile: { name: 'Coding Expert' } },
    { id: 'disabled', enabled: false },
    { id: personalAgentId('local-owner'), enabled: true, profile: { name: 'Ada' } },
  ] });
  const ownerToken = 'mobile-catalog-owner-token';
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const device = createDevice({ displayName: 'Test mobile', platform: 'ios',
    publicKeyJwk: keys.publicKey.export({ format: 'jwk' }), scopes: [...DEFAULT_MOBILE_SCOPES] });
  getSqliteDatabase().prepare('UPDATE devices SET request_proof_version = 1 WHERE device_id = ?').run(device.id);
  const credential = issueDeviceTokenPair(device.id).accessToken;
  const gatewayId = getOrCreateGatewayIdentity().id;
  const config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token: ownerToken } },
    mcp: { servers: { calendar: { type: 'http', url: 'https://calendar.example/mcp', headers: { Authorization: 'private-secret' } } } },
  });
  const installSkill = vi.fn(async () => ({ skillId: 'safe-test-skill' }));
  const app = createHonoApp({ service: {
    currentConfig: config,
    getResolvedAuth: () => ({ mode: 'token', token: ownerToken }), getAuthToken: () => ownerToken, isGatewayReady: () => true,
    getExtensionLoader: () => null, getRunningChannelIds: () => [], refreshAgentCatalog: vi.fn(),
    marketplace: {
      installSkill,
      getSkillsApi: () => ({ catalog: [{ directoryId: 'meeting-skill', name: 'Meeting Skill',
        description: 'Summarize meetings', enabled: true, path: '/private/workspace/SKILL.md' },
      { directoryId: 'retired-skill', name: 'Retired Skill', enabled: false }] }),
    },
  } as unknown as GatewayService });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing catalog test server address');
    const origin = `http://127.0.0.1:${address.port}`;
    const signed = (target: string, method = 'GET', input?: object) => {
      const body = input ? JSON.stringify(input) : undefined;
      const contentType = body ? 'application/json' : undefined;
      const proof = { timestamp: Date.now(), nonce: randomBytes(24).toString('base64url'), digest: proofDigest(body ?? '') };
      const message = requestProofMessage({ gatewayId, credential, method, target, headers: name => name.toLowerCase() === 'content-type' ? contentType : undefined, proof });
      const signature = sign('sha256', Buffer.from(message), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return fetch(origin + target, { method, body, headers: {
        Authorization: `Bearer ${credential}`, 'X-Xopc-Proof': `${proof.timestamp}.${proof.nonce}.${proof.digest}.${signature}`,
        ...(contentType ? { 'Content-Type': contentType } : {}),
      } });
    };

    const path = '/api/capabilities/mobile-catalog';
    expect((await fetch(origin + path)).status).toBe(401);
    const plugins = await signed(path);
    expect(plugins.status).toBe(200);
    expect(await plugins.json()).toEqual({ ok: true, payload: { items: [
      { id: 'installed-plugin', name: 'Installed Plugin', group: 'installed' },
      { id: 'meeting-plugin', name: 'Meeting Plugin', description: 'Manage meetings', group: 'available' },
    ] } });
    const skills = await signed(path + '?category=skills');
    expect(skills.status).toBe(200);
    expect(await skills.json()).toEqual({ ok: true, payload: { items: [
      { id: 'meeting-skill', name: 'Meeting Skill', description: 'Summarize meetings', group: 'installed' },
      { id: 'retired-skill', name: 'Retired Skill', group: 'disabled' },
    ] } });
    const connections = await signed(path + '?category=connections&locale=zh-CN');
    expect(connections.status).toBe(200);
    const connectionBody = await connections.json();
    expect(connectionBody.payload.items).toContainEqual({
      id: 'sample-service', name: '示例服务', description: 'Example service', group: 'available',
    });
    expect(connectionBody.payload.items).toContainEqual({ id: 'mcp:calendar', targetId: 'calendar', name: 'calendar', group: 'configured' });
    expect(JSON.stringify(connectionBody)).not.toMatch(/private-secret|calendar\.example/);
    const tool = createCapabilityCatalogTool(() => ({ config, skills: [] }));
    const result = await tool.execute('inspect', { category: 'connections', id: 'mcp:calendar' });
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({
      items: [{ id: 'mcp:calendar', targetId: 'calendar', name: 'calendar', group: 'configured' }], matches: 1, incomplete: false,
    }) }]);
    expect((await signed(path + '?category=channels')).status).toBe(200);
    const agents = await signed(path + '?category=agents');
    expect(agents.status).toBe(200);
    expect((await agents.json()).payload.items).toEqual([
      { id: 'coder', name: 'Coding Expert', group: 'expert' },
      { id: 'disabled', name: 'disabled', group: 'disabled' },
      { id: 'main', name: 'main', group: 'assistant' },
    ]);
    expect((await signed(path + '?category=invalid')).status).toBe(400);
    expect((await signed(path, 'POST')).status).toBe(403);
    expect((await signed('/api/connectors/installed')).status).toBe(403);
    const actions = '/api/capabilities/mobile-actions';
    expect((await signed(actions + '/skills', 'POST', { selection: 'ffffffff-ffff-4fff-bfff-ffffffffffff' })).status).toBe(409);
    const search = await signed(actions + '/skills?q=sample');
    expect(search.status).toBe(200);
    const [{ selection }] = (await search.json()).payload.items;
    expect((await signed(actions + '/skills', 'POST', { selection })).status).toBe(200);
    expect(installSkill).toHaveBeenCalledExactlyOnceWith({ name: 'safe-test-skill', provider: 'store', target: 'global', overwrite: false });
    expect((await signed(actions + '/skills', 'POST', { selection })).status).toBe(409);
    for (const url of ['https://127.0.0.1/mcp', 'https://example.com/mcp?token=secret']) {
      expect((await signed(actions + '/mcp', 'POST', { serverId: 'test', url })).status).toBe(400);
    }
    expect((await signed('/api/mcp/servers')).status).toBe(403);
    const editAgent = actions + '/agent/coder';
    const editable = await signed(editAgent);
    expect(editable.status).toBe(200);
    const profile = (await editable.json()).payload;
    expect(profile).toEqual({ revision: expect.any(Number), name: 'Coding Expert', description: '' });
    expect((await signed(editAgent, 'POST', { expectedRevision: profile.revision + 1, name: 'New', description: '' })).status).toBe(409);
    expect((await signed(editAgent, 'POST', { expectedRevision: profile.revision, name: 'New', description: '', workspace: '/tmp' })).status).toBe(400);
    expect((await signed(actions + '/agent/' + personalAgentId('local-owner'))).status).toBe(404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase();
  }
});
