import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { getMcpAuthorization, probeMcpConnection } from '../../agent/mcp/connection-setup.js';
import { createCapabilityCatalogTool } from '../../agent/tools/capability-catalog-tool.js';
import { buildChannelCatalogForConfig, getChannelSetupStatus } from '../../channels/catalog/channel-catalog-service.js';
import { ConfigSchema } from '../../config/schema.js';
import { resolveStateDir } from '../../config/paths.js';
import { validateChannelPluginConfigs } from '../../config/validate-channel-configs.js';
import { startConnectorAuthorization } from '../../connectors/auth-provider-registry.js';
import { listComposioConnections } from '../../connectors/composio.js';
import { AgentPluginStore } from '../../extensions/agent-plugins/store.js';
import { withAgentPluginSource } from '../../extensions/agent-plugins/sources.js';
import { personalAgentId } from '../../personal-agent/repository.js';
import { closeXopcDatabase } from '../../storage/sqlite/connection.js';
import { createDevice, issueDeviceTokenPair } from '../../storage/sqlite/device-access-repository.js';
import { upsertConnectorConnection } from '../../storage/sqlite/connector-repository.js';
import { getOrCreateGatewayIdentity } from '../../storage/sqlite/gateway-identity-repository.js';
import { getSqliteDatabase } from '../../storage/sqlite/transaction.js';
import { createHonoApp } from '../hono/app.js';
import { proofDigest, requestProofMessage } from '../security/device-request-proof.js';
import { DEFAULT_MOBILE_SCOPES } from '../security/gateway-scopes.js';
import type { GatewayService } from '../service.js';

vi.mock('../../extensions/marketplace.js', () => ({
  findExtension: async (id: string) => id === 'meeting-plugin'
    ? { id, name: 'Meeting Plugin', version: '1.0.0', packageType: 'plugin' } : undefined,
  fetchRegistry: async () => ({ extensions: [
    { id: 'meeting-plugin', name: 'Meeting Plugin', description: 'Manage meetings', packageType: 'plugin',
      branding: { iconUrl: 'https://example.com/meeting.svg', iconSha256: 'fixture-hash' } },
    { id: 'desktop-app', name: 'Desktop App', packageType: 'extension' },
  ] }),
}));
vi.mock('../../extensions/agent-plugins/sources.js', () => ({ withAgentPluginSource: vi.fn() }));

vi.mock('../../connectors/auth-provider-registry.js', () => ({
  startConnectorAuthorization: vi.fn(async () => ({
    connectorId: 'composio-gmail', provider: 'composio', status: 'pending', authorizationUrl: 'https://example.com/authorize',
    connectionId: 'fixture-provider-account',
  })),
}));

vi.mock('../../connectors/composio.js', async importActual => ({
  ...await importActual<typeof import('../../connectors/composio.js')>(),
  listComposioConnections: vi.fn(async () => []),
}));

vi.mock('../../agent/mcp/connection-setup.js', async importActual => ({
  ...await importActual<typeof import('../../agent/mcp/connection-setup.js')>(),
  probeMcpConnection: vi.fn(async () => ({ state: 'connected', toolCount: 1 })),
  startMcpAuthorization: vi.fn((_config, _workspace, serverId: string) => ({ id: 'test-authorization', serverId, state: 'starting' })),
  getMcpAuthorization: vi.fn(() => ({ id: 'test-authorization', serverId: 'test', state: 'authorizing',
    authorizationUrl: 'https://example.com/plugin-sign-in', acceptsRedirect: true })),
}));

vi.mock('../../extensions/agent-plugins/cli-authorization.js', async importActual => {
  const challenge = {
    id: 'test-qr-attempt', state: 'awaiting_user', expiresAt: Date.now() + 60_000,
    challenge: { type: 'qr', url: 'https://example.com/plugin-qr' },
  };
  return {
    ...await importActual<typeof import('../../extensions/agent-plugins/cli-authorization.js')>(),
    startPluginCliAuthorization: () => challenge,
    getPluginCliAuthorization: () => challenge,
  };
});

vi.mock('../../agent/skills/marketplace/search.js', () => ({
  searchSkillMarketplaces: async () => ({ sources: [{ ok: true }], results: [{ id: 'safe-test-skill', name: 'Sample skill',
    provider: 'store', description: 'A test fixture', author: 'owner', iconUrl: 'https://example.com/skill.svg',
    install: { reference: 'safe-test-skill' }, security: { status: 'pass' } }] }),
}));

vi.mock('../../extensions/agent-plugins/inventory.js', () => ({
  listAgentPluginInventory: () => [{
    pluginId: 'installed-plugin', name: 'Installed Plugin', installationState: 'installed',
    installationSource: '/private/installation', workspacePaths: ['/private/workspace'],
    branding: { iconUrl: 'data:image/png;base64,AAAA', iconSha256: 'fixture-hash' },
  }],
}));

vi.mock('../../capabilities/store-connector.js', async (importActual) => ({
  ...await importActual<typeof import('../../capabilities/store-connector.js')>(),
  listStoreConnectorCatalog: async () => [
    { name: 'sample-service', description: 'Example service', localizations: { 'zh-CN': { displayName: '示例服务' } },
      branding: { iconUrl: 'https://example.com/connector.svg', iconSha256: 'fixture-hash' } },
  ],
}));

it.each(['dingtalk', 'wecom', 'slack', 'discord'])('saves disabled %s preferences while preserving activation requirements', id => {
  initializeTestAgentCatalog();
  vi.stubEnv('XOPC_BUNDLED_EXTENSIONS_ROOT', fileURLToPath(new URL('../../../extensions', import.meta.url)));
  try {
    const preferences = { enabled: false, groupPolicy: 'allowlist' as const, groupAllowFrom: ['112233445566778899'] };
    const config = ConfigSchema.parse({ channels: { [id]: preferences } });
    expect(validateChannelPluginConfigs(config)).toEqual([]);
    const entry = buildChannelCatalogForConfig(config).byId.get(id);
    expect(getChannelSetupStatus(config, id, entry)).toMatchObject({ enabled: false, ready: false });
    const active = ConfigSchema.parse({ channels: { [id]: { ...preferences, enabled: true } } });
    expect(validateChannelPluginConfigs(active)).toContainEqual(expect.stringContaining('must have required property'));
  } finally {
    vi.unstubAllEnvs();
    closeXopcDatabase();
  }
});

it('serves only category metadata to a signed mobile device through the authenticated Gateway', async () => {
  initializeTestAgentCatalog({ agents: [
    { id: 'main', enabled: true },
    { id: 'coder', enabled: true, profile: { name: 'Coding Expert' } },
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
  let config = ConfigSchema.parse({ gateway: { auth: { mode: 'token', token: ownerToken } },
    mcp: { servers: { calendar: { type: 'http', url: 'https://calendar.example/mcp', headers: { Authorization: 'private-secret' } } } },
    channels: { telegram: { enabled: true, defaultAccount: 'default',
      accounts: { default: { botToken: 'fixture-bot-secret', groupPolicy: 'allowlist' } } } },
  });
  const installSkill = vi.fn(async () => ({ skillId: 'safe-test-skill' }));
  const enabledSkills = new Map<string, boolean>();
  const patchSkillEnabled = vi.fn((id: string, enabled: boolean) => { enabledSkills.set(id, enabled); });
  const setupConversation = '9970c1da-a50e-4ca3-ad8f-ebe31b35f532';
  const setupGoal = { setupId: 'native-conversation-mcp', conversationId: setupConversation,
    displayName: 'Test service', serverId: 'test-service', version: 3, phase: 'approval_required', approveWithToken: true,
    planApproval: { endpoint: 'https://example.com/mcp', sources: [{ url: 'https://example.com/setup' }] },
    secretFields: [{ id: 'token', label: 'Access key' }] };
  const mcpInteract = vi.fn(async (_id: string, action: string) =>
    action === 'token' ? { ...setupGoal, phase: 'ready', version: 4 } : setupGoal);
  let setupAvailable = true;
  const persistWeChat = vi.fn(() => {
    const accountsDir = join(resolveStateDir(), 'weixin', 'accounts');
    mkdirSync(accountsDir, { recursive: true });
    writeFileSync(join(accountsDir, 'fixture-wechat.json'), JSON.stringify({ token: 'fixture-wechat-token' }));
  });
  const pluginSource = mkdtempSync(join(tmpdir(), 'xopc-mobile-plugin-'));
  mkdirSync(join(pluginSource, '.claude-plugin'));
  writeFileSync(join(pluginSource, '.claude-plugin/plugin.json'), JSON.stringify({
    name: 'mobile-plugin-test', mcpServers: './.mcp.json',
    userConfig: { nickname: { type: 'string', required: true, title: 'Nickname' } },
  }));
  writeFileSync(join(pluginSource, '.mcp.json'), JSON.stringify({ mcpServers: { sample: { type: 'http', url: 'https://example.com/mcp' } } }));
  const pluginStore = new AgentPluginStore();
  const plan = pluginStore.inspect(pluginSource, 'test');
  const pluginId = pluginStore.install(pluginSource, { reviewHash: plan.reviewHash, sourceLabel: 'test' }).id;
  const qrPluginSource = join(pluginSource, 'qr-plugin');
  mkdirSync(qrPluginSource);
  writeFileSync(join(qrPluginSource, 'plugin.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'mobile-qr-plugin-test',
    extensions: { 'ai.xopc': { setup: { authorizations: [{
      id: 'account', title: 'Account', servers: ['sample'],
      methods: [{ id: 'scan', title: 'Scan', type: 'cli', login: { command: 'node' }, check: { command: 'node' } }],
    }] } } },
  }));
  writeFileSync(join(qrPluginSource, 'mcp.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: { sample: { type: 'stdio', command: 'node' } },
  }));
  const qrPlan = pluginStore.inspect(qrPluginSource, 'test');
  const qrPluginId = pluginStore.install(qrPluginSource, { reviewHash: qrPlan.reviewHash, sourceLabel: 'test' }).id;
  const storePluginSource = join(pluginSource, 'store-package');
  mkdirSync(join(storePluginSource, 'skills', 'meeting-summary'), { recursive: true });
  writeFileSync(join(storePluginSource, 'plugin.json'), JSON.stringify({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'meeting-plugin',
  }));
  writeFileSync(join(storePluginSource, 'skills', 'meeting-summary', 'SKILL.md'), '---\nname: meeting-summary\ndescription: Summarize meeting notes.\n---\nSummarize the notes.\n');
  vi.mocked(withAgentPluginSource).mockImplementation(async (source, _config, inspect) => {
    if (source !== 'store:meeting-plugin') throw new Error('Unexpected store source');
    return inspect(storePluginSource);
  });
  const app = createHonoApp({ service: {
    get currentConfig() { return config; },
    saveConfig: async (next: typeof config, _previous: typeof config, beforeSave?: () => void) => {
      beforeSave?.();
      config = next;
      return { saved: true };
    },
    getResolvedAuth: () => ({ mode: 'token', token: ownerToken }), getAuthToken: () => ownerToken, isGatewayReady: () => true,
    getExtensionLoader: () => null, getRunningChannelIds: () => [], refreshAgentCatalog: vi.fn(),
    mcpSetup: { currentForConversation: (id: string) => ({ setup: id === setupConversation && setupAvailable ? setupGoal : null }), interact: mcpInteract },
    ensureChannelRuntimePlugin: async (channel: string) => ({ runtimeActions: { runAction: async ({ actionId, input }: {
      actionId: string; input?: Record<string, string>;
    }) => {
      if (channel === 'telegram') return { ok: false, message: 'Could not verify bot token' };
      if (['dingtalk', 'wecom'].includes(channel) && actionId === 'setup.start') return { ok: true, payload: {
        type: 'qr', conversationId: channel + '-pair', qrPayload: 'https://example.com/' + channel,
      } };
      if (['dingtalk', 'wecom'].includes(channel) && actionId === 'setup.status') return { ok: true,
        nextConfig: { ...config, channels: { ...config.channels, [channel]: channel === 'dingtalk'
          ? { enabled: true, clientId: 'test-client', clientSecret: 'test-enterprise-secret' }
          : { enabled: true, botId: 'test-bot', secret: 'test-enterprise-secret' } } },
      };
      if (['slack', 'discord'].includes(channel) && actionId === 'setup.manual') {
        if (input?.botToken !== 'test-bot-token' || (channel === 'slack' && input.appToken !== 'test-app-token')) {
          return { ok: false, message: 'Invalid credentials' };
        }
        return { ok: true, nextConfig: { ...config, channels: { ...config.channels, [channel]: { enabled: true, ...input } } } };
      }
      if (channel === 'feishu' && actionId === 'setup.start') return { ok: true, payload: {
        type: 'qr', conversationId: 'feishu-pair', qrPayload: 'https://example.com/feishu',
      } };
      if (channel === 'feishu' && actionId === 'setup.status') return { ok: true,
        nextConfig: { ...config, channels: { ...config.channels, feishu: { enabled: true, appId: 'fixture', appSecret: 'fixture-private' } } },
      };
      if (actionId === 'login.start') return { ok: true, payload: {
        type: 'qr', conversationId: 'wechat-pair', qrcodeUrl: 'https://example.com/pair',
      } };
      if (actionId === 'login.status') return { ok: true, payload: { type: 'poll', phase: 'pending', pinAction: 'login.verify-code' } };
      if (actionId === 'login.verify-code' && input?.code === '123456') return { ok: true,
        nextConfig: { ...config, channels: { ...config.channels, weixin: { enabled: true,
          accounts: { 'fixture-wechat': { enabled: true, dmPolicy: 'allowlist', allowFrom: ['fixture-owner'] } },
        } } },
        beforeConfigSaved: persistWeChat };
      return { ok: false, message: 'Invalid verification code' };
    } } }),
    marketplace: {
      installSkill, patchSkillEnabled, reloadSkills: vi.fn(),
      getSkillsApi: () => ({ catalog: [{ directoryId: 'meeting-skill', name: 'Meeting Skill',
        description: 'Summarize meetings', enabled: true, path: '/private/workspace/SKILL.md', plugin: { id: 'installed-plugin' } },
      { directoryId: 'retired-skill', name: 'Retired Skill', enabled: false },
      { directoryId: '阅读清单', name: '阅读清单', enabled: enabledSkills.get('阅读清单') ?? true },
      ...(installSkill.mock.calls.length > 1
        ? [{ directoryId: 'safe-test-skill', name: 'safe-test-skill', enabled: true }] : [])] }),
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
      { id: 'installed-plugin', name: 'Installed Plugin', group: 'installed', iconUrl: 'data:image/png;base64,AAAA' },
      { id: 'meeting-plugin', name: 'Meeting Plugin', description: 'Manage meetings', group: 'available',
        iconUrl: 'https://example.com/meeting.svg' },
    ] } });
    const skills = await signed(path + '?category=skills');
    expect(skills.status).toBe(200);
    expect(await skills.json()).toEqual({ ok: true, payload: { items: [
      { id: 'meeting-skill', name: 'Meeting Skill', description: 'Summarize meetings', group: 'installed', iconUrl: 'data:image/png;base64,AAAA' },
      { id: 'retired-skill', name: 'Retired Skill', group: 'disabled' },
      { id: '阅读清单', name: '阅读清单', group: 'installed' },
    ] } });
    const connections = await signed(path + '?category=connections&locale=zh-CN');
    expect(connections.status).toBe(200);
    const connectionBody = await connections.json();
    expect(connectionBody.payload.items).toContainEqual({
      id: 'sample-service', name: '示例服务', description: 'Example service', group: 'available', iconUrl: 'https://example.com/connector.svg',
    });
    expect(connectionBody.payload.items).toContainEqual({ id: 'mcp:calendar', targetId: 'calendar', name: 'calendar', group: 'configured' });
    expect(JSON.stringify(connectionBody)).not.toMatch(/private-secret|calendar\.example/);
    const tool = createCapabilityCatalogTool(() => ({ config, skills: [] }));
    const result = await tool.execute('inspect', { category: 'connections', id: 'mcp:calendar' });
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({
      items: [{ id: 'mcp:calendar', targetId: 'calendar', name: 'calendar', group: 'configured' }], matches: 1, incomplete: false,
    }) }]);
    const brandedResult = await tool.execute('inspect', { category: 'connections', id: 'sample-service' });
    expect(JSON.stringify(brandedResult.content)).not.toContain('iconUrl');
    const channels = await signed(path + '?category=channels');
    expect(channels.status).toBe(200);
    expect((await channels.json()).payload.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'telegram', iconUrl: '/channel-icons/telegram.svg' }),
    ]));
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

    const panel = (category: string, id: string) => actions + '/panel/' + category + '?id=' + encodeURIComponent(id);
    const chatMcp = panel('connections', 'conversation:' + setupConversation);
    expect((await (await signed(chatMcp)).json()).payload).toMatchObject({
      available: true, flow: setupGoal.setupId, revision: 3, fields: [{ id: 'token', type: 'secret', value: '' }],
      details: 'https://example.com/mcp\nhttps://example.com/setup', message: expect.stringContaining('example.com'),
      actions: [expect.objectContaining({ id: 'token', confirmation: 'Test service\nhttps://example.com/mcp\nhttps://example.com/setup', inlineReview: true }),
        expect.objectContaining({ id: 'cancel' })],
    });
    expect((await signed(chatMcp, 'POST', { action: 'token', revision: 3, flow: 'other-flow', values: { token: 'invalid' } })).status).toBe(409);
    const verification = Promise.withResolvers<void>();
    mcpInteract.mockImplementationOnce(async () => {
      await verification.promise;
      return { ...setupGoal, phase: 'ready', version: 4 };
    });
    const verifying = await signed(chatMcp, 'POST', { action: 'token', revision: 3, flow: setupGoal.setupId, values: { token: 'test-credential' } });
    expect(verifying.status).toBe(200);
    expect((await verifying.json()).payload).toMatchObject({ pollAction: 'check', flow: setupGoal.setupId });
    expect((await (await signed(chatMcp, 'POST', { action: 'check', flow: setupGoal.setupId })).json()).payload).toMatchObject({ pollAction: 'check' });
    expect(mcpInteract).toHaveBeenCalledWith(setupGoal.setupId, 'token', { token: 'test-credential' }, 3, expect.any(String));
    setupAvailable = false;
    verification.resolve();
    mcpInteract.mockImplementationOnce(async () => ({ ...setupGoal, phase: 'ready', version: 4 }));
    expect((await (await signed(chatMcp, 'POST', { action: 'check', flow: setupGoal.setupId })).json()).payload)
      .toMatchObject({ message: 'Connection complete.', chatPrompt: 'Use “Test service (test-service)” to help me with:' });
    expect((await signed(panel('connections', 'conversation:ef1832d4-35ec-47e0-995f-e5ca5a8d6b26'), 'POST',
      { action: 'check', flow: setupGoal.setupId })).status).toBe(404);
    setupAvailable = true;
    mcpInteract.mockImplementationOnce(async () => ({ ...setupGoal, phase: 'token_required', approveWithToken: false,
      version: 5, errorCode: 'credential_rejected' }));
    expect((await (await signed(chatMcp)).json()).payload).toMatchObject({ revision: 5,
      message: 'Test service · The service rejected the access key. Check it and try again.',
      fields: [{ id: 'token', type: 'secret', value: '' }],
    });
    const skillPanel = panel('skills', 'meeting-skill');
    expect((await signed(skillPanel)).status).toBe(200);
    expect((await signed(skillPanel, 'POST', { action: 'save', values: { enabled: 'false' } })).status).toBe(200);
    expect(patchSkillEnabled).toHaveBeenCalledExactlyOnceWith('meeting-skill', false);
    const localizedSkill = panel('skills', '阅读清单');
    expect((await (await signed(localizedSkill)).json()).payload.chatPrompt).toBe('Use “阅读清单” to help me with:');
    expect((await signed(localizedSkill, 'POST', { action: 'save', values: { enabled: 'false' } })).status).toBe(200);
    expect((await (await signed(localizedSkill)).json()).payload.chatPrompt).toBeUndefined();
    const market = panel('skills', 'marketplace:search');
    const marketResult = await signed(market, 'POST', { action: 'search', values: { query: 'sample' } });
    const marketplace = (await marketResult.json()).payload;
    expect(marketplace.actions.map((item: { id: string }) => item.id)).toEqual(['search']);
    expect(marketplace.results[0]).toMatchObject({
      name: 'Sample skill', source: 'Skill store', iconUrl: 'https://example.com/skill.svg', action: { label: 'Install' },
    });
    const installation = marketplace.results[0].action;
    expect((await (await signed(market, 'POST', { action: installation.id, values: { query: 'sample' } })).json()).payload)
      .toMatchObject({ fields: [{ id: 'query', value: 'sample' }], message: 'Skill installed', chatPrompt: '/skill:safe-test-skill ' });
    expect((await signed(market, 'POST', { action: installation.id })).status).toBe(409);
    const agentPanel = panel('agents', 'coder');
    const editablePanel = (await (await signed(agentPanel)).json()).payload;
    expect((await signed(agentPanel, 'POST', { action: 'save', revision: editablePanel.revision,
      values: { name: 'Mobile Expert', description: 'Mobile configuration' } })).status).toBe(200);
    expect((await (await signed(agentPanel)).json()).payload.fields).toContainEqual({
      id: 'name', label: 'Name', type: 'text', value: 'Mobile Expert',
    });
    const connection = panel('connections', 'mcp:calendar');
    expect(await (await signed(connection)).text()).not.toMatch(/private-secret|calendar\.example/);
    expect((await (await signed(connection)).json()).payload.chatPrompt).toBe('Use “calendar” to help me with:');
    expect((await signed(connection, 'POST', { action: 'save', values: { enabled: 'false' } })).status).toBe(200);
    expect(config.mcp?.servers?.calendar?.enabled).toBe(false);
    expect((await (await signed(connection)).json()).payload.chatPrompt).toBeUndefined();
    const custom = panel('connections', 'mcp:setup');
    expect((await signed(custom, 'POST', { action: 'create', values: { url: 'https://127.0.0.1/mcp' } })).status).toBe(400);
    expect((await (await signed(custom, 'POST', { action: 'create', values: {
      url: 'https://example.com/mcp', id: 'Calendar notes',
    } })).json()).payload).toMatchObject({ message: 'Connection added', chatPrompt: expect.stringContaining('Calendar notes') });
    expect(Object.values(config.mcp?.servers ?? {})).toContainEqual(expect.objectContaining({
      url: 'https://example.com/mcp', enabled: true, displayName: 'Calendar notes', xopcPublicOnly: true,
    }));
    const signIn = panel('connections', 'composio-gmail');
    const auth = await signed(signIn, 'POST', { action: 'authorize' });
    expect(auth.status).toBe(200);
    const pending = (await auth.json()).payload;
    expect(pending).toMatchObject({
      authorizationUrl: 'https://example.com/authorize', pollAction: 'check',
      actions: [{ id: 'cancel-sign-in', label: 'Cancel sign-in' }],
    });
    expect(startConnectorAuthorization).toHaveBeenCalledWith(expect.objectContaining({ id: 'composio-gmail' }), config);
    vi.mocked(listComposioConnections).mockImplementationOnce(async () => {
      upsertConnectorConnection({
        id: 'fixture-connection', principalId: 'local-owner', connectorId: 'composio-gmail', provider: 'composio',
        providerConnectionId: 'fixture-provider-account', isDefault: false, status: 'active', identity: {}, metadata: {},
      });
      return [];
    });
    const connected = (await (await signed(signIn, 'POST', { action: 'check', flow: pending.flow })).json()).payload;
    expect(connected.message).toBe('Connected');
    expect(connected.pollAction).toBeUndefined();
    expect(connected.chatPrompt).toContain('composio-gmail');
    const marketPlugin = panel('plugins', 'meeting-plugin');
    const review = (await (await signed(marketPlugin)).json()).payload;
    expect(review).toMatchObject({ flow: expect.any(String), message: expect.stringContaining('Adds skills to the assistant'),
      details: expect.stringContaining('Skill meeting-summary'),
      actions: [expect.objectContaining({ id: 'install', label: 'Install and enable', inlineReview: true })] });
    expect(review.chatPrompt).toBeUndefined();
    expect(pluginStore.get('meeting-plugin')).toBeUndefined();
    expect((await (await signed(marketPlugin, 'POST', { action: 'install', flow: review.flow })).json()).payload)
      .toMatchObject({ pollAction: 'refresh' });
    await vi.waitFor(() => expect(pluginStore.get('meeting-plugin')?.receipt.enabled).toBe(true));
    expect((await (await signed(marketPlugin)).json()).payload.chatPrompt).toContain('meeting-plugin');
    const installedPlugin = panel('plugins', pluginId);
    const settingUp = (await (await signed(installedPlugin, 'POST', { action: 'start' })).json()).payload;
    expect(settingUp).toMatchObject({ revision: expect.any(Number) });
    const pluginPanel = async () => (await (await signed(installedPlugin, 'POST', { action: 'refresh' })).json()).payload;
    await vi.waitFor(async () => expect((await pluginPanel()).actions).toContainEqual({ id: 'configure', label: 'Save settings', advanced: false }));
    const editablePlugin = await pluginPanel();
    vi.mocked(probeMcpConnection).mockResolvedValueOnce({ state: 'oauth_required' });
    expect((await signed(installedPlugin, 'POST', { action: 'configure', revision: editablePlugin.revision,
      values: { nickname: 'Mobile' } })).status).toBe(200);
    const pluginSignIn = 'authorize-server:' + Buffer.from('sample').toString('base64url');
    await vi.waitFor(async () => expect((await pluginPanel()).actions).toContainEqual({
      id: pluginSignIn, label: 'Connect account', advanced: false,
    }));
    const needsSignIn = await pluginPanel();
    const pluginAuth = (await (await signed(installedPlugin, 'POST', { action: pluginSignIn, revision: needsSignIn.revision })).json()).payload;
    expect(pluginAuth).toMatchObject({ authorizationUrl: 'https://example.com/plugin-sign-in',
      pollAction: expect.stringMatching(/^status-server:/), fields: [{ id: 'callback', advanced: true }] });
    expect(pluginStore.get(pluginId)?.receipt.enabled).toBe(false);
    vi.mocked(getMcpAuthorization).mockReturnValueOnce({ id: 'test-authorization', serverId: 'test', state: 'connected' });
    expect((await signed(installedPlugin, 'POST', { action: pluginAuth.pollAction, revision: pluginAuth.revision })).status).toBe(200);
    await vi.waitFor(async () => expect((await pluginPanel()).actions).toContainEqual({ id: 'complete', label: 'Enable plugin' }));
    const preparedPlugin = await pluginPanel();
    expect((await signed(installedPlugin, 'POST', { action: 'complete', revision: preparedPlugin.revision })).status).toBe(200);
    expect(pluginStore.get(pluginId)?.receipt.enabled).toBe(true);
    const qrPlugin = panel('plugins', qrPluginId);
    expect((await signed(qrPlugin, 'POST', { action: 'start' })).status).toBe(200);
    const qrPluginPanel = async () => (await (await signed(qrPlugin)).json()).payload;
    const authorizeByQR = 'authorize:' + Buffer.from(JSON.stringify(['account', 'scan'])).toString('base64url');
    await vi.waitFor(async () => expect((await qrPluginPanel()).actions).toContainEqual({
      id: authorizeByQR, label: 'Connect Account', advanced: false,
    }));
    const qrPluginReady = await qrPluginPanel();
    const qrPluginAuth = (await (await signed(qrPlugin, 'POST', {
      action: authorizeByQR, revision: qrPluginReady.revision,
    })).json()).payload;
    expect(qrPluginAuth).toMatchObject({ qrUrl: 'https://example.com/plugin-qr', pollAction: expect.stringMatching(/^status:/) });
    expect(qrPluginAuth.authorizationUrl).toBeUndefined();
    const weChat = panel('channels', 'weixin');
    const qr = (await (await signed(weChat, 'POST', { action: 'pair' })).json()).payload;
    expect(qr).toMatchObject({ qrUrl: 'https://example.com/pair', pollAction: 'pair-status' });
    expect((await (await signed(weChat)).json()).payload).toMatchObject({
      flow: qr.flow, qrUrl: qr.qrUrl, pollAction: 'pair-status',
    });
    const pin = (await (await signed(weChat, 'POST', { action: qr.pollAction, flow: qr.flow })).json()).payload;
    expect(pin.fields[0].id).toBe('code');
    expect(pin.pollAction).toBeUndefined();
    const resumedPin = (await (await signed(weChat)).json()).payload;
    expect(resumedPin).toMatchObject({ flow: qr.flow, fields: [{ id: 'code' }] });
    expect(resumedPin.qrUrl).toBeUndefined();
    expect(resumedPin.pollAction).toBeUndefined();
    expect(persistWeChat).not.toHaveBeenCalled();
    expect((await (await signed(weChat, 'POST', { action: 'pair-code', flow: qr.flow, values: { code: '123456' } })).json()).payload)
      .toMatchObject({ message: 'WeChat paired and saved.' });
    expect(persistWeChat).toHaveBeenCalledOnce();
    const configuredWeChat = (await (await signed(weChat)).json()).payload;
    expect(configuredWeChat.flow).toBeUndefined();
    expect(configuredWeChat.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'enabled', value: 'true' }), expect.objectContaining({ id: 'scope', value: 'saved' }),
    ]));
    expect(JSON.stringify(configuredWeChat)).not.toContain('fixture-wechat-token');
    expect((await signed(weChat, 'POST', { action: 'save', values: { enabled: 'true', scope: 'pairing' } })).status).toBe(200);
    expect((await (await signed(weChat)).json()).payload.fields).toContainEqual(expect.objectContaining({
      id: 'scope', value: 'pairing',
    }));
    const feishu = panel('channels', 'feishu');
    const feishuStart = (await (await signed(feishu)).json()).payload;
    expect(feishuStart.actions[0]).toEqual({ id: 'pair', label: 'Scan to connect' });
    expect(feishuStart.fields.every((field: { advanced?: boolean }) => field.advanced)).toBe(true);
    expect((await (await signed(feishu, 'POST', { action: 'manual' })).json()).payload.fields)
      .toContainEqual(expect.objectContaining({ id: 'appId', advanced: false }));
    const feishuQR = (await (await signed(feishu, 'POST', { action: 'pair' })).json()).payload;
    expect(feishuQR).toMatchObject({ qrUrl: 'https://example.com/feishu', pollAction: 'pair-status' });
    expect((await (await signed(feishu, 'POST', { action: feishuQR.pollAction, flow: feishuQR.flow })).json()).payload)
      .toMatchObject({ message: 'Feishu authorization saved.' });
    expect(await (await signed(feishu)).text()).not.toContain('fixture-private');
    const telegram = panel('channels', 'telegram');
    expect(await (await signed(telegram)).text()).not.toContain('fixture-bot-secret');
    expect((await signed(telegram, 'POST', { action: 'save', values: { enabled: 'true', token: 'unverified' } })).status).toBe(400);
    expect((await signed(telegram, 'POST', { action: 'save', values: { enabled: 'true', scope: 'private' } })).status).toBe(200);
    expect(config.channels?.telegram).toMatchObject({ enabled: true,
      accounts: { default: { botToken: 'fixture-bot-secret', groupPolicy: 'disabled' } } });
    expect((await signed(telegram, 'POST', { action: 'save', values: { enabled: 'true', scope: 'groups',
      groupAllowFrom: '-10042' } })).status).toBe(200);
    expect((await (await signed(telegram)).json()).payload.fields).toContainEqual(expect.objectContaining({
      id: 'groupAllowFrom', type: 'list', value: '-10042', visibleWhen: { field: 'scope', value: 'groups' },
    }));
    for (const id of ['dingtalk', 'wecom']) {
      const route = panel('channels', id);
      const beforePair = (await (await signed(route)).json()).payload;
      expect(beforePair.actions).toContainEqual({ id: 'pair', label: 'Scan to connect' });
      const qr = (await (await signed(route, 'POST', { action: 'pair' })).json()).payload;
      expect(qr).toMatchObject({ qrUrl: 'https://example.com/' + id, pollAction: 'pair-status' });
      expect((await (await signed(route, 'POST', { action: 'pair-status', flow: qr.flow })).json()).payload)
        .toMatchObject({ message: 'Channel paired and saved.' });
      const reloaded = await (await signed(route)).text();
      expect(reloaded).not.toContain('test-enterprise-secret');
      expect(JSON.parse(reloaded).payload.message).toBe('Configured');
    }
    const discord = panel('channels', 'discord');
    expect((await signed(discord, 'POST', { action: 'save', values: { enabled: 'false', scope: 'groups' } })).status).toBe(200);
    const discordSettings = (await (await signed(discord)).json()).payload;
    expect(discordSettings.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'enabled', value: 'false' }), expect.objectContaining({ id: 'scope', value: 'groups' }),
    ]));
    expect(discordSettings.actions).toContainEqual({ id: 'save', label: 'Save', advanced: true });
    for (const id of ['slack', 'discord']) {
      const route = panel('channels', id);
      const options = (await (await signed(route)).json()).payload;
      expect(options.fields).toContainEqual(expect.objectContaining({ id: 'botToken', type: 'secret', value: '', advanced: false }));
      expect(options.fields).toContainEqual(expect.objectContaining({ id: 'scope', advanced: true }));
      const values = { enabled: 'true', scope: 'groups', botToken: 'test-bot-token',
        ...(id === 'slack' ? { appToken: 'test-app-token' } : {}), dmPolicy: 'allowlist', allowFrom: 'U1\nU2', groupAllowFrom: 'C1' };
      const credentialValues = { botToken: values.botToken, ...(values.appToken ? { appToken: values.appToken } : {}) };
      expect((await signed(route, 'POST', { action: 'connect', values: { ...credentialValues, botToken: 'invalid' } })).status).toBe(400);
      const connectResult = (await (await signed(route, 'POST', { action: 'connect', values: credentialValues })).json()).payload;
      expect(connectResult.message).toContain('Channel connected');
      expect(connectResult.fields).toContainEqual(expect.objectContaining({ id: 'scope', value: id === 'slack' ? 'private' : 'groups' }));
      expect((await signed(route, 'POST', { action: 'save', values: { enabled: values.enabled, scope: values.scope,
        dmPolicy: values.dmPolicy, allowFrom: values.allowFrom, groupAllowFrom: values.groupAllowFrom } })).status).toBe(200);
      expect(config.channels?.[id]).toMatchObject({ enabled: true, botToken: 'test-bot-token',
        dmPolicy: 'allowlist', groupPolicy: 'allowlist', allowFrom: ['U1', 'U2'], groupAllowFrom: ['C1'] });
      const reloaded = await (await signed(route)).text();
      expect(reloaded).not.toContain('test-bot-token');
      expect(reloaded).not.toContain('test-app-token');
      expect(JSON.parse(reloaded).payload.fields).toContainEqual(expect.objectContaining({ id: 'allowFrom', value: 'U1\nU2' }));
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    closeXopcDatabase();
    rmSync(pluginSource, { recursive: true, force: true });
  }
});
