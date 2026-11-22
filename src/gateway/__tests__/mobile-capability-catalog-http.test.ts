import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { getMcpAuthorization, probeMcpConnection, startMcpAuthorization } from '../../agent/mcp/connection-setup.js';
import { createCapabilityCatalogTool } from '../../agent/tools/capability-catalog-tool.js';
import { CredentialResolver } from '../../auth/credentials.js';
import { buildChannelCatalogForConfig, getChannelSetupStatus } from '../../channels/catalog/channel-catalog-service.js';
import { ConfigSchema } from '../../config/schema.js';
import { resolveStateDir } from '../../config/paths.js';
import { validateChannelPluginConfigs } from '../../config/validate-channel-configs.js';
import { startConnectorAuthorization } from '../../connectors/auth-provider-registry.js';
import { listComposioConnections } from '../../connectors/composio.js';
import { assertComposioAccessConfigured } from '../../connectors/composio-sessions.js';
import { listConnectorInstances } from '../../connectors/instances.js';
import { installConnectorDefinition } from '../../connectors/install.js';
import type { ConnectorDefinition } from '../../connectors/types.js';
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

vi.mock('../../connectors/composio-sessions.js', async importActual => ({
  ...await importActual<typeof import('../../connectors/composio-sessions.js')>(),
  assertComposioAccessConfigured: vi.fn(async () => 'managed'),
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

vi.mock('../../capabilities/store-connector.js', async (importActual) => {
  const actual = await importActual<typeof import('../../capabilities/store-connector.js')>();
  const definition: ConnectorDefinition = {
    id: 'sample-service', version: '1.0.0', displayName: 'Sample service', description: 'Example service',
    source: 'store', kind: 'mcp', category: 'data', capabilities: ['tools', 'auth.oauth'],
    auth: { mode: 'oauth' }, setup: {
      links: [{ label: 'Open account settings', href: 'https://example.com/account' }],
      instructions: { en: 'Ask your administrator for an approved client ID.', 'zh-CN': '请向管理员获取已批准的客户端 ID。' },
    },
    provenance: { packageName: 'sample-service', sha256: 'fixture-sha' },
    runtime: { type: 'mcp', serverId: 'sample_service', serverTemplate: {
      type: 'http', url: 'https://example.com/sample', oauth: {}, headers: { 'X-Workspace': 'sample-workspace' },
    } },
  };
  const plan = { packageName: definition.id, version: definition.version, definition, permissions: {},
    requiresRestart: false, reviewHash: 'fixture-review' } as const;
  return {
    ...actual,
    getStoreConnectorInstallPlan: async () => plan,
    installStoreConnector: (async config => ({ plan, instance: await installConnectorDefinition(config, definition, {}) })) as typeof actual.installStoreConnector,
    listStoreConnectorCatalog: async () => [
      { name: 'sample-service', description: 'Example service', localizations: { 'zh-CN': { displayName: '示例服务' } },
        branding: { iconUrl: 'https://example.com/connector.svg', iconSha256: 'fixture-hash' } },
    ],
  };
});

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
    mcp: { servers: {
      calendar: { type: 'http', url: 'https://calendar.example/mcp', headers: { Authorization: 'private-secret' } },
      setup: { type: 'http', url: 'https://example.com/setup', enabled: false },
    } },
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
  const enterprisePending = new Set<string>();
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
        ...(channel === 'dingtalk' ? { deviceVerification: { url: 'https://example.com/verify', userCode: 'ABCD-1234' } } : {}),
      } };
      if (actionId === 'setup.status' && enterprisePending.delete(channel)) {
        return { ok: true, payload: { type: 'poll', phase: 'pending' } };
      }
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
    expect(connectionBody.payload.items).toContainEqual({ id: 'mcp:server:setup', targetId: 'setup', name: 'setup', group: 'disabled' });
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
    expect((await (await signed(connection)).json()).payload.chatPrompt).toBeUndefined();
    const checkedCalendar = (await (await signed(connection, 'POST', { action: 'configure-mcp' })).json()).payload;
    expect(checkedCalendar).toMatchObject({ tone: 'success' });
    expect((await signed(connection, 'POST', { action: 'save', flow: checkedCalendar.flow, revision: checkedCalendar.revision })).status).toBe(200);
    expect((await (await signed(connection)).json()).payload.chatPrompt).toBe('Use “calendar” to help me with:');
    expect((await signed(connection, 'POST', { action: 'save', values: { enabled: 'false' } })).status).toBe(200);
    expect(config.mcp?.servers?.calendar?.enabled).toBe(false);
    expect((await (await signed(connection)).json()).payload.chatPrompt).toBeUndefined();
    expect((await (await signed(panel('connections', 'mcp:server:setup'))).json()).payload.fields)
      .toContainEqual(expect.objectContaining({ id: 'enabled', value: 'false' }));
    const custom = panel('connections', 'mcp:setup');
    const setupMcp = (action: string, flow?: { flow: string; revision: number }, values?: Record<string, string>) =>
      signed(custom, 'POST', { action, ...(flow ? { flow: flow.flow, revision: flow.revision } : {}), values });
    const mcpByName = (name: string) => Object.values(config.mcp?.servers ?? {}).find(server => server.displayName === name);
    const entryPanel = (await (await signed(custom)).json()).payload;
    expect(entryPanel.fields.find((field: { id: string }) => field.id === 'authMethod')?.advanced).toBeUndefined();
    expect(entryPanel).toMatchObject({
      fields: expect.arrayContaining([
        expect.objectContaining({ id: 'mcp-mode', presentation: 'segmented', value: 'link' }),
        expect.objectContaining({ id: 'url' }),
        expect.objectContaining({ id: 'authMethod', value: 'auto', visibleWhen: { field: 'mcp-mode', value: 'link' },
          options: ['auto', 'oauth', 'bearer', 'apiKey', 'headers', 'none'].map(id => expect.objectContaining({ id })) }),
        expect.objectContaining({ id: 'mcp-json', retain: true, type: 'multiline' }),
      ]),
      actions: [expect.objectContaining({ id: 'create' }), expect.objectContaining({ id: 'preview' }), expect.objectContaining({ id: 'review-command' })],
    });
    for (const url of ['http://8.8.8.8/mcp', 'http://169.254.169.254/mcp', 'http://metadata.google.internal./mcp']) {
      expect((await setupMcp('create', undefined, { url })).status).toBe(400);
    }
    const probesBeforeLan = vi.mocked(probeMcpConnection).mock.calls.length;
    const lan = (await (await setupMcp('create', undefined, {
      url: 'http://127.0.0.1:53231/sse', id: 'Local SSE', transport: 'sse',
    })).json()).payload;
    expect(lan).toMatchObject({ subtitle: expect.stringContaining('Legacy SSE'),
      actions: [expect.objectContaining({ id: 'confirm-check' }), expect.objectContaining({ id: 'edit' })] });
    expect((await setupMcp('save', lan)).status).toBe(409);
    expect(vi.mocked(probeMcpConnection).mock.calls).toHaveLength(probesBeforeLan);
    const lanChecked = (await (await setupMcp('confirm-check', lan)).json()).payload;
    const [lanConfig, , lanId] = vi.mocked(probeMcpConnection).mock.lastCall!;
    expect(lanConfig.mcp?.servers?.[lanId]).toMatchObject({ type: 'sse', xopcPrivateNetwork: true, xopcPublicOnly: false });
    expect(mcpByName('Local SSE')).toBeUndefined();
    expect((await setupMcp('save', lanChecked)).status).toBe(200);
    expect(mcpByName('Local SSE')).toMatchObject({ type: 'sse', xopcPrivateNetwork: true });

    const commandInput = { command: 'node', args: 'fixture MCP.mjs\n--quiet', commandName: 'Local fixture',
      'mcp-env': JSON.stringify([['FIXTURE_API_KEY', '  fixture-secret-value  ']]) };
    expect((await setupMcp('review-command', undefined, commandInput)).status).toBe(409);
    config.gateway.mobileMcpAllowStdio = true;
    const beforeCommand = vi.mocked(probeMcpConnection).mock.calls.length;
    const commandReview = (await (await setupMcp('review-command', undefined, commandInput)).json()).payload;
    expect(commandReview.reviewText).toContain('["node","fixture MCP.mjs","--quiet"]');
    expect(commandReview.reviewText).toContain('FIXTURE_API_KEY');
    expect(JSON.stringify(commandReview)).not.toContain('fixture-secret-value');
    expect(vi.mocked(probeMcpConnection).mock.calls).toHaveLength(beforeCommand);
    config.gateway.mobileMcpAllowStdio = false;
    expect((await setupMcp('confirm-check', commandReview)).status).toBe(409);
    config.gateway.mobileMcpAllowStdio = true;
    const commandChecked = (await (await setupMcp('confirm-check', commandReview)).json()).payload;
    const [commandConfig, , commandId] = vi.mocked(probeMcpConnection).mock.lastCall!;
    expect(commandConfig.mcp?.servers?.[commandId]).toMatchObject({
      type: 'stdio', command: 'node', args: ['fixture MCP.mjs', '--quiet'], xopcManagedStdio: true,
      env: { FIXTURE_API_KEY: '  fixture-secret-value  ' },
    });
    expect(mcpByName('Local fixture')).toBeUndefined();
    config.gateway.mobileMcpAllowStdio = false;
    expect((await setupMcp('save', commandChecked)).status).toBe(409);
    config.gateway.mobileMcpAllowStdio = true;
    expect((await setupMcp('save', commandChecked)).status).toBe(200);
    const commandEnv = mcpByName('Local fixture')?.env?.FIXTURE_API_KEY;
    if (!commandEnv || typeof commandEnv === 'string') throw new Error('Missing stdio credential reference');
    expect(await new CredentialResolver().resolveApiKey(commandEnv.xopcSecretRef.provider)).toBe('  fixture-secret-value  ');
    const checked = (await (await setupMcp('create', undefined, {
      url: 'https://example.com/mcp', id: 'Calendar notes',
    })).json()).payload;
    expect(checked).toMatchObject({ headline: 'Calendar notes', tone: 'success',
      actions: [expect.objectContaining({ id: 'save', label: 'Add connection' }), expect.objectContaining({ id: 'edit' })] });
    expect(mcpByName('Calendar notes')).toBeUndefined();
    expect((await setupMcp('save', { ...checked, revision: checked.revision - 1 })).status).toBe(409);
    expect((await (await setupMcp('save', checked)).json()).payload).toMatchObject({ message: 'Connection added' });
    expect((await (await setupMcp('save', checked)).json()).payload).toMatchObject({ message: 'Connection added' });
    expect(mcpByName('Calendar notes')).toMatchObject({
      url: 'https://example.com/mcp', enabled: true, displayName: 'Calendar notes', xopcPublicOnly: true,
    });

    vi.mocked(probeMcpConnection).mockResolvedValueOnce({ state: 'auth_unknown' });
    const credentials = (await (await setupMcp('create', undefined, {
      url: 'https://example.com/bearer', id: 'Token service',
    })).json()).payload;
    expect(credentials).toMatchObject({
      message: expect.stringContaining('Choose the method'),
      fields: expect.arrayContaining([expect.objectContaining({ id: 'method', value: '' })]),
    });
    expect((await setupMcp('save', credentials)).status).toBe(409);
    vi.mocked(probeMcpConnection).mockResolvedValueOnce({ state: 'token_required' });
    const rejected = await setupMcp('verify', credentials, { method: 'bearer', token: 'rejected-fixture-token' });
    const rejectedBody = await rejected.text();
    expect(rejectedBody).not.toContain('rejected-fixture-token');
    const rejectedPanel = JSON.parse(rejectedBody).payload;
    expect(rejectedPanel).toMatchObject({
      fields: expect.arrayContaining([expect.objectContaining({ id: 'token', type: 'secret' })]),
      actions: [expect.objectContaining({ id: 'verify' }), expect.objectContaining({ id: 'edit' })],
    });
    const bearer = (await (await setupMcp('verify', rejectedPanel, {
      method: 'bearer', token: 'Bearer accepted-fixture-token',
    })).json()).payload;
    expect(bearer).toMatchObject({ tone: 'success' });
    expect(JSON.stringify(bearer)).not.toContain('accepted-fixture-token');
    expect(mcpByName('Token service')).toBeUndefined();
    const [bearerProbeConfig, , bearerServerId] = vi.mocked(probeMcpConnection).mock.lastCall!;
    expect(bearerProbeConfig.mcp?.servers?.[bearerServerId]?.headers?.Authorization).toBe('Bearer accepted-fixture-token');
    expect((await setupMcp('save', bearer)).status).toBe(200);
    const bearerServer = mcpByName('Token service');
    expect(JSON.stringify(bearerServer)).not.toContain('accepted-fixture-token');
    const header = bearerServer?.headers?.Authorization;
    expect(header).toMatchObject({ xopcSecretRef: { prefix: 'Bearer ' } });
    if (!header || typeof header === 'string') throw new Error('Missing bearer credential reference');
    expect(await new CredentialResolver().resolveApiKey(header.xopcSecretRef.provider)).toBe('accepted-fixture-token');

    const customHeaders = (await (await setupMcp('create', undefined, {
      url: 'https://example.com/headers', id: 'Headers service', authMethod: 'headers',
    })).json()).payload;
    expect(customHeaders.fields).toContainEqual(expect.objectContaining({ id: 'requestHeaders', type: 'headers' }));
    expect((await setupMcp('verify', customHeaders, {
      method: 'headers', requestHeaders: JSON.stringify([['X-API-Key', 'one'], ['x-api-key', 'two']]),
    })).status).toBe(400);
    const headerReview = (await (await setupMcp('verify', customHeaders, {
      method: 'headers', requestHeaders: JSON.stringify([['X-API-Key', 'header-fixture-key'], ['X-Team', 'team-fixture-key']]),
    })).json()).payload;
    expect(headerReview).toMatchObject({ tone: 'success' });
    expect(mcpByName('Headers service')).toBeUndefined();
    expect((await setupMcp('save', headerReview)).status).toBe(200);
    const customConfig = mcpByName('Headers service');
    expect(JSON.stringify(customConfig)).not.toMatch(/header-fixture-key|team-fixture-key/);
    for (const [name, secret] of [['X-API-Key', 'header-fixture-key'], ['X-Team', 'team-fixture-key']]) {
      const ref = customConfig?.headers?.[name];
      if (!ref || typeof ref === 'string') throw new Error('Missing custom header credential reference');
      expect(await new CredentialResolver().resolveApiKey(ref.xopcSecretRef.provider)).toBe(secret);
    }

    vi.mocked(probeMcpConnection).mockResolvedValueOnce({ state: 'auth_unknown' });
    const apiKeySetup = (await (await setupMcp('create', undefined, {
      url: 'https://example.com/key', id: 'Key service',
    })).json()).payload;
    expect(apiKeySetup.fields).toContainEqual(expect.objectContaining({
      id: 'method', options: expect.arrayContaining(['apiKey', 'none', 'oauth'].map(id => expect.objectContaining({ id }))),
    }));
    expect(apiKeySetup.fields).toContainEqual(expect.objectContaining({ id: 'apiKeyHeader', value: 'X-API-Key' }));
    expect(apiKeySetup.fields).toContainEqual(expect.objectContaining({
      id: 'apiKey', type: 'secret', visibleWhen: { field: 'method', value: 'apiKey' },
    }));
    expect((await setupMcp('verify', apiKeySetup, {
      method: 'apiKey', apiKeyHeader: 'Host', apiKey: 'fixture-key',
    })).status).toBe(400);
    const apiKeyResult = (await (await setupMcp('verify', apiKeySetup, {
      method: 'apiKey', apiKeyHeader: 'X-Service-Key', apiKey: 'fixture-key', token: 'unused-fixture-token',
    })).json()).payload;
    expect(apiKeyResult.tone).toBe('success');
    expect(JSON.stringify(apiKeyResult)).not.toContain('fixture-key');
    const [apiKeyProbeConfig, , apiKeyServerId] = vi.mocked(probeMcpConnection).mock.lastCall!;
    expect(apiKeyProbeConfig.mcp?.servers?.[apiKeyServerId]?.headers).toEqual({ 'X-Service-Key': 'fixture-key' });
    expect(mcpByName('Key service')).toBeUndefined();
    expect((await setupMcp('save', apiKeyResult)).status).toBe(200);
    const savedKey = mcpByName('Key service')?.headers?.['X-Service-Key'];
    if (!savedKey || typeof savedKey === 'string') throw new Error('Missing API Key credential reference');
    expect(await new CredentialResolver().resolveApiKey(savedKey.xopcSecretRef.provider)).toBe('fixture-key');

    const manualAuth = (await (await setupMcp('create', undefined, {
      url: 'https://example.com/public', id: 'Public service', authMethod: 'apiKey',
    })).json()).payload;
    expect(manualAuth.fields).toContainEqual(expect.objectContaining({ id: 'method', value: 'apiKey' }));
    vi.mocked(probeMcpConnection).mockResolvedValueOnce({ state: 'error', errorCode: 'access_denied' });
    const denied = (await (await setupMcp('verify', manualAuth, {
      method: 'apiKey', apiKeyHeader: 'X-Service-Key', apiKey: 'rejected-key',
    })).json()).payload;
    expect(denied.fields).toContainEqual(expect.objectContaining({ id: 'apiKeyHeader', value: 'X-Service-Key' }));
    expect(JSON.stringify(denied)).not.toContain('rejected-key');
    const publicResult = (await (await setupMcp('verify', denied, {
      method: 'none', apiKey: 'rejected-key', requestHeaders: JSON.stringify([['X-Service-Key', 'rejected-key']]),
    })).json()).payload;
    const [publicProbeConfig, , publicServerId] = vi.mocked(probeMcpConnection).mock.lastCall!;
    expect(publicProbeConfig.mcp?.servers?.[publicServerId]?.headers).toBeUndefined();
    expect(publicResult.tone).toBe('success');
    expect(mcpByName('Public service')).toBeUndefined();
    expect((await setupMcp('save', publicResult)).status).toBe(200);

    vi.mocked(probeMcpConnection).mockResolvedValueOnce({ state: 'oauth_required' });
    const noAuthDenied = (await (await setupMcp('create', undefined, {
      url: 'https://example.com/auth-required', authMethod: 'none',
    })).json()).payload;
    expect(noAuthDenied.fields).toContainEqual(expect.objectContaining({ id: 'method', value: 'none' }));
    expect(noAuthDenied.actions).not.toContainEqual(expect.objectContaining({ id: 'authorize' }));

    expect((await setupMcp('preview', undefined, { 'mcp-json': '{' })).status).toBe(400);
    expect((await setupMcp('preview', undefined, { 'mcp-json': JSON.stringify({
      mcpServers: { unsafe: { url: 'https://example.com/mcp', command: 'node' } },
    }) })).status).toBe(400);
    const probeCalls = vi.mocked(probeMcpConnection).mock.calls.length;
    const imported = await setupMcp('preview', undefined, { 'mcp-json': JSON.stringify({ mcpServers: {
      plain: { url: 'https://example.com/plain' },
      imported: { url: 'https://example.com/import', description: 'Imported service', headers: { 'X-Api-Key': 'import-fixture-key' }, enabled: false },
      skipped: { url: 'https://example.com/unsupported', command: 'node' },
    } }) });
    expect(imported.status).toBe(200);
    const importedBody = await imported.text();
    expect(importedBody).not.toContain('import-fixture-key');
    const preview = JSON.parse(importedBody).payload;
    expect(preview).toMatchObject({
      message: expect.stringContaining('1 other configurations'),
      fields: [expect.objectContaining({ id: 'selection', options: [
        { id: '0', label: 'plain · example.com/plain' }, { id: '1', label: 'imported · example.com/import' },
      ] })],
    });
    expect(vi.mocked(probeMcpConnection).mock.calls).toHaveLength(probeCalls);
    expect((await setupMcp('save', preview)).status).toBe(409);
    const importedReview = (await (await setupMcp('select', preview, { selection: '1' })).json()).payload;
    expect(config.mcp?.servers?.imported).toBeUndefined();
    const selectedAgain = (await (await setupMcp('edit', importedReview)).json()).payload;
    expect(selectedAgain.fields[0].value).toBe('1');
    expect((await setupMcp('save', importedReview)).status).toBe(409);
    const importRetry = (await (await setupMcp('select', selectedAgain, { selection: '1' })).json()).payload;
    const importedSaved = (await (await setupMcp('save', importRetry)).json()).payload;
    expect(importedSaved).toMatchObject({ message: 'Connection added · Disabled' });
    expect(config.mcp?.servers?.imported).toMatchObject({ description: 'Imported service', enabled: false });
    expect(JSON.stringify(config.mcp?.servers?.imported)).not.toContain('import-fixture-key');
    expect(config.mcp?.servers?.plain).toBeUndefined();
    expect((await (await setupMcp('add-another', importedSaved)).json()).payload.fields[0].options)
      .toEqual([{ id: '0', label: 'plain · example.com/plain' }]);

    const advancedImport = (await (await setupMcp('preview', undefined, { 'mcp-json': JSON.stringify({ mcpServers: {
      legacy: { url: 'https://legacy.example.com/sse', type: 'sse' },
      lan: { url: 'https://mcp.corp.example.com/mcp', network: 'private' },
      stdio: { command: 'node', args: ['fixture path.mjs'], env: { FIXTURE_API_KEY: 'imported-stdio-secret' } },
    } }) })).json()).payload;
    const importedStdio = (await (await setupMcp('select', advancedImport, { selection: '2' })).json()).payload;
    expect(importedStdio.reviewText).toContain('["node","fixture path.mjs"]');
    expect(JSON.stringify(importedStdio)).not.toContain('imported-stdio-secret');
    const advancedPreview = (await (await setupMcp('edit', importedStdio)).json()).payload;
    const importedLan = (await (await setupMcp('select', advancedPreview, { selection: '1' })).json()).payload;
    expect(importedLan.actions[0].id).toBe('confirm-check');
    const legacyPreview = (await (await setupMcp('edit', importedLan)).json()).payload;
    const importedLegacy = (await (await setupMcp('select', legacyPreview, { selection: '0' })).json()).payload;
    expect(importedLegacy).toMatchObject({ tone: 'success', subtitle: expect.stringContaining('Legacy SSE') });
    expect(config.mcp?.servers?.legacy).toBeUndefined();

    vi.mocked(probeMcpConnection).mockResolvedValueOnce({ state: 'oauth_required' });
    const oauthDraft = (await (await setupMcp('create', undefined, {
      url: 'https://example.com/oauth', id: 'OAuth service',
    })).json()).payload;
    expect(oauthDraft.actions).toContainEqual({ id: 'authorize', label: 'Authorize in browser' });
    const oauthOptions = (await (await setupMcp('oauth-settings', oauthDraft)).json()).payload;
    expect(oauthOptions.fields).toContainEqual(expect.objectContaining({ id: 'requestHeaders', type: 'headers' }));
    expect((await setupMcp('save-oauth-settings', oauthOptions, {
      requestHeaders: JSON.stringify([['authorization', 'Bearer conflict']]),
    })).status).toBe(400);
    const withHeaders = (await (await setupMcp('save-oauth-settings', oauthOptions, {
      requestHeaders: JSON.stringify([['X-Workspace', 'custom-oauth-workspace']]),
    })).json()).payload;
    const waitingForOAuth = (await (await setupMcp('authorize', withHeaders)).json()).payload;
    const customOAuth = Object.values(vi.mocked(startMcpAuthorization).mock.lastCall?.[0].mcp?.servers ?? {});
    expect(customOAuth).toContainEqual(expect.objectContaining({
      displayName: 'OAuth service', oauth: {}, headers: { 'X-Workspace': 'custom-oauth-workspace' },
    }));
    expect(waitingForOAuth.pollAction).toBe('status');
    vi.mocked(getMcpAuthorization).mockReturnValueOnce({ id: 'test-authorization', serverId: 'test', state: 'connected', toolCount: 1 });
    const authorized = (await (await setupMcp('status', waitingForOAuth)).json()).payload;
    expect(authorized).toMatchObject({ tone: 'success', message: expect.stringContaining('Connection verified') });
    expect(mcpByName('OAuth service')).toBeUndefined();
    expect((await (await setupMcp('status', waitingForOAuth)).json()).payload).toEqual(authorized);
    vi.mocked(getMcpAuthorization).mockReturnValueOnce({ id: 'test-authorization', serverId: 'test', state: 'connected', toolCount: 1 });
    expect((await (await setupMcp('save', authorized)).json()).payload).toMatchObject({ message: 'Connection added' });
    expect(mcpByName('OAuth service')).toBeDefined();
    const oauthImport = await setupMcp('preview', undefined, { 'mcp-json': JSON.stringify({ mcp: { servers: {
      confidential: { url: 'https://example.com/confidential', oauth: { clientId: 'fixture-client', clientSecret: 'fixture-client-secret' } },
    } } }) });
    const oauthImportBody = await oauthImport.text();
    expect(oauthImportBody).not.toContain('fixture-client-secret');
    const confidential = (await (await setupMcp('select', JSON.parse(oauthImportBody).payload, { selection: '0' })).json()).payload;
    expect(confidential.actions).toContainEqual({ id: 'authorize', label: 'Authorize in browser' });
    const confidentialWaiting = (await (await setupMcp('authorize', confidential)).json()).payload;
    const connectedOAuth = { id: 'test-authorization', serverId: 'confidential', state: 'connected' as const, toolCount: 1 };
    vi.mocked(getMcpAuthorization).mockReturnValueOnce(connectedOAuth);
    const confidentialReview = (await (await setupMcp('status', confidentialWaiting)).json()).payload;
    expect(config.mcp?.servers?.confidential).toBeUndefined();
    vi.mocked(getMcpAuthorization).mockReturnValueOnce(connectedOAuth);
    expect((await setupMcp('save', confidentialReview)).status).toBe(200);
    const confidentialConfig = config.mcp?.servers?.confidential?.oauth;
    expect(confidentialConfig).toMatchObject({ clientId: 'fixture-client', clientSecret: { xopcSecretRef: {} } });
    const oauthSecret = confidentialConfig?.clientSecret;
    if (!oauthSecret || typeof oauthSecret === 'string') throw new Error('Missing OAuth credential reference');
    expect(await new CredentialResolver().resolveApiKey(oauthSecret.xopcSecretRef.provider)).toBe('fixture-client-secret');

    const storeConnector = panel('connections', 'sample-service');
    const storeAction = async (action: string, previous?: { flow: string; revision?: number }, values?: Record<string, string>) => {
      const response = await signed(storeConnector, 'POST', { action, flow: previous?.flow, revision: previous?.revision, values });
      expect(response.status).toBe(200);
      return (await response.json()).payload;
    };
    const storeReview = await storeAction('inspect');
    expect(storeReview).toMatchObject({ fields: [], message: 'After installation, authorize with the provider.' });
    expect(storeReview.steps).toContain('Ask your administrator for an approved client ID.');
    expect(storeReview.links).toContainEqual({ label: 'Open account settings', url: 'https://example.com/account' });
    const pendingConnector = await storeAction('install', storeReview);
    expect(pendingConnector.actions).toContainEqual(expect.objectContaining({ id: 'configure-mcp', label: 'Connect account' }));
    expect(pendingConnector.chatPrompt).toBeUndefined();
    const originalServer = structuredClone(config.mcp?.servers?.sample_service);
    const initialAuthorization = await storeAction('configure-mcp');
    expect(initialAuthorization.links).toEqual(storeReview.links);
    const startingAuthorization = await storeAction('authorize', initialAuthorization);
    vi.mocked(getMcpAuthorization).mockReturnValueOnce({ id: 'test-authorization', serverId: 'sample_service',
      state: 'error', errorCode: 'client_registration_failed', error: 'provider body with confidential information' });
    const rejectedRegistration = await storeAction('status', startingAuthorization);
    expect(rejectedRegistration.message).toContain('rejected OAuth client registration');
    expect(JSON.stringify(rejectedRegistration)).not.toContain('confidential information');
    expect(config.mcp?.servers?.sample_service).toEqual(originalServer);
    expect((await setupMcp('oauth-settings', rejectedRegistration)).status).toBe(409);
    const clientSettings = await storeAction('oauth-settings', rejectedRegistration);
    expect(clientSettings.links).toEqual(storeReview.links);
    expect(clientSettings.fields).not.toContainEqual(expect.objectContaining({ id: 'requestHeaders' }));
    const clientConfigured = await storeAction('save-oauth-settings', clientSettings, {
      oauthClientId: 'provider-approved-client', oauthClientSecret: 'managed-oauth-secret', oauthCallbackPort: '8471',
    });
    const providerAuthorization = await storeAction('authorize', clientConfigured);
    expect(vi.mocked(startMcpAuthorization).mock.lastCall?.[0].mcp?.servers?.sample_service).toMatchObject({
      oauth: { clientId: 'provider-approved-client', callbackPort: 8471 },
      headers: { 'X-Workspace': 'sample-workspace' },
    });
    const connectedManagedOAuth = { ...connectedOAuth, serverId: 'sample_service', toolCount: 2 };
    vi.mocked(getMcpAuthorization).mockReturnValueOnce(connectedManagedOAuth);
    const verifiedConnector = await storeAction('status', providerAuthorization);
    expect(verifiedConnector).toMatchObject({ tone: 'success' });
    expect(config.mcp?.servers?.sample_service).toEqual(originalServer);
    vi.mocked(getMcpAuthorization).mockReturnValueOnce(connectedManagedOAuth);
    expect(await storeAction('save', verifiedConnector)).toMatchObject({ message: 'Connection verified and saved' });
    expect(config.mcp?.servers?.sample_service).toMatchObject({
      oauth: { clientId: 'provider-approved-client', callbackPort: 8471, clientSecret: { xopcSecretRef: {} } },
      xopcConnector: { connectorId: 'sample-service', usage: { lastHealthStatus: 'ok', lastToolCount: 2 } },
    });
    expect(JSON.stringify(config.mcp?.servers?.sample_service)).not.toContain('managed-oauth-secret');
    expect(listConnectorInstances(config).find(instance => instance.connectorId === 'sample-service')).toMatchObject({
      authStatus: 'connected', connectionStatus: 'connected',
    });
    expect((await (await signed(storeConnector)).json()).payload.chatPrompt).toContain('sample-service');
    const marker = config.mcp?.servers?.sample_service?.xopcConnector as { definition: ConnectorDefinition };
    marker.definition.setup = {};
    const legacyDetails = (await (await signed(storeConnector)).json()).payload;
    expect(legacyDetails.actions).toContainEqual(expect.objectContaining({ id: 'setup-guide' }));
    expect(await storeAction('setup-guide')).toMatchObject({ links: storeReview.links, steps: storeReview.steps });
    expect(marker.definition.setup).toEqual({});
    const signIn = panel('connections', 'composio-gmail');
    expect((await (await signed(signIn)).json()).payload.actions).toContainEqual({ id: 'authorize', label: 'Connect account' });
    vi.mocked(assertComposioAccessConfigured).mockRejectedValueOnce(new Error('Missing connection service'));
    const missingService = await signed(signIn, 'POST', { action: 'authorize' });
    expect(missingService.status).toBe(400);
    expect((await missingService.json()).error).toContain('Set up Composio');
    expect(startConnectorAuthorization).not.toHaveBeenCalled();
    const auth = await signed(signIn, 'POST', { action: 'authorize' });
    expect(auth.status).toBe(200);
    const pending = (await auth.json()).payload;
    expect(pending).toMatchObject({
      authorizationUrl: 'https://example.com/authorize', pollAction: 'check',
      actions: [{ id: 'cancel-sign-in', label: 'Cancel sign-in' }],
    });
    expect(startConnectorAuthorization).toHaveBeenCalledWith(expect.objectContaining({ id: 'composio-gmail' }), config);
    expect(listConnectorInstances(config)).toContainEqual(expect.objectContaining({ connectorId: 'composio-gmail', enabled: true }));
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
    const afterSignIn = (await (await signed(path + '?category=connections')).json()).payload;
    expect(afterSignIn.items).toContainEqual(expect.objectContaining({ id: 'composio-gmail', group: 'connected' }));
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
    expect(qr.authorizationUrl).toBeUndefined();
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
    expect(feishuStart.actions[0]).toEqual({ id: 'pair', label: 'Start connection' });
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
      expect(beforePair.actions).toContainEqual({ id: 'pair', label: 'Start connection' });
      const qr = (await (await signed(route, 'POST', { action: 'pair' })).json()).payload;
      expect(qr).toMatchObject({ qrUrl: 'https://example.com/' + id, pollAction: 'pair-status' });
      if (id === 'dingtalk') {
        const verification = { authorizationUrl: 'https://example.com/verify', deviceVerificationCode: 'ABCD-1234' };
        expect(qr).toMatchObject(verification);
        expect(qr.expiresAt).toBeGreaterThan(Date.now());
        expect((await (await signed(route)).json()).payload).toMatchObject({ ...verification, flow: qr.flow });
        enterprisePending.add(id);
        expect((await (await signed(route, 'POST', { action: 'pair-status', flow: qr.flow })).json()).payload)
          .toMatchObject({ ...verification, flow: qr.flow, qrUrl: qr.qrUrl, expiresAt: qr.expiresAt });
      } else {
        expect(qr.authorizationUrl).toBeUndefined();
      }
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
