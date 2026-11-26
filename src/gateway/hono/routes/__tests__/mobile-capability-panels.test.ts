import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeTestAgentCatalog } from '../../../../agent-catalog/test-support.js';
import { AgentCatalogRepository } from '../../../../agent-catalog/repository.js';
import * as externalAgentRegistry from '../../../../agent/external/registry.js';
import { ConfigSchema } from '../../../../config/schema.js';
import { assertComposioAccessConfigured } from '../../../../connectors/composio-sessions.js';
import { AgentPluginStore } from '../../../../extensions/agent-plugins/store.js';
import type { ExtensionMetadataSnapshot } from '../../../../extensions/extension-metadata-snapshot.js';
import { closeXopcDatabase } from '../../../../storage/sqlite/connection.js';
import { setGatewayPrincipal } from '../../../security/gateway-principal.js';
import type { GatewayService } from '../../../service.js';
import { registerMobileCapabilityActions } from '../mobile-capability-actions.js';

vi.mock('../../../../connectors/composio-sessions.js', async importActual => ({
  ...await importActual<typeof import('../../../../connectors/composio-sessions.js')>(),
  assertComposioAccessConfigured: vi.fn(async () => 'managed'),
}));

vi.mock('../../../../agent/mcp/connection-setup.js', async importActual => ({
  ...await importActual<typeof import('../../../../agent/mcp/connection-setup.js')>(),
  probeMcpConnection: vi.fn(async () => ({ state: 'oauth_required' })),
}));

const tempDirs: string[] = [];

afterEach(() => {
  closeXopcDatabase();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

function createPanelHarness(options: {
  initialConfig?: Record<string, unknown>;
  snapshot?: ExtensionMetadataSnapshot;
  runChannelAction?: (channel: string, args: { actionId: string; input?: Record<string, string>; locale?: string }) => Promise<unknown>;
} = {}) {
  initializeTestAgentCatalog();
  let config = ConfigSchema.parse(options.initialConfig ?? {});
  const app = new Hono();
  app.use('*', async (c, next) => {
    setGatewayPrincipal(c, { kind: 'owner', principalId: 'test-owner-device', scopes: ['agents.read', 'sessions.write'] });
    await next();
  });
  registerMobileCapabilityActions(app, {
    service: {
      get currentConfig() { return config; },
      saveConfig: async (next: typeof config) => {
        config = next;
        return { saved: true };
      },
      getExtensionLoader: () => options.snapshot ? { getManifestSnapshot: () => options.snapshot } : null,
      ensureChannelRuntimePlugin: async (channel: string) => options.runChannelAction
        ? { runtimeActions: { runAction: (args: { actionId: string; input?: Record<string, string>; locale?: string }) => options.runChannelAction!(channel, args) } }
        : null,
      marketplace: { reloadSkills: vi.fn(), getSkillsApi: () => ({ catalog: [] }) },
      refreshAgentCatalog: vi.fn(),
    } as unknown as GatewayService,
    strictRateLimitMiddleware: async (_c, next) => next(),
  } as never);

  const getPanel = async (category: string, id: string, locale = 'zh-CN') => {
    const res = await app.request(`/api/capabilities/mobile-actions/panel/${category}?id=${encodeURIComponent(id)}&locale=${locale}`);
    return { status: res.status, body: await res.json() };
  };
  const postPanel = async (category: string, id: string, body: object, locale = 'zh-CN') => {
    const res = await app.request(`/api/capabilities/mobile-actions/panel/${category}?id=${encodeURIComponent(id)}&locale=${locale}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return { getPanel, postPanel, readConfig: () => config };
}

describe('mobile capability panels guidance and schema-driven setup', () => {
  it('surfaces channel setup templates, links, post-connect invite links, and supports schema-declared channels without hardcoding', async () => {
    const customSnapshot = {
      discovered: [],
      manifestRegistry: {
        getAllEntries: () => [
          {
            id: 'custom-chat',
            source: 'workspace',
            path: '/tmp/custom-chat',
            manifest: {
              id: 'custom-chat',
              name: 'Custom Chat',
              version: '1.0.0',
              channelContributions: {
                'custom-chat': {
                  label: 'Custom Chat',
                  description: 'Schema-driven custom channel',
                  order: 99,
                  configPath: 'channels.custom-chat',
                  capabilities: { login: true, pairing: true },
                  configSchema: {
                    type: 'object',
                    properties: {
                      enabled: { type: 'boolean', default: false },
                      apiKey: { type: 'string', title: 'Workspace API Key', format: 'password' },
                      workspaceId: { type: 'string', title: 'Workspace ID' },
                      dmPolicy: { type: 'string', enum: ['pairing', 'allowlist', 'open', 'disabled'], default: 'pairing' },
                      groupPolicy: { type: 'string', enum: ['allowlist', 'open', 'disabled'], default: 'disabled' },
                    },
                    if: { properties: { enabled: { const: false } }, required: ['enabled'] },
                    else: { required: ['workspaceId', 'apiKey'] },
                  },
                  uiHints: {
                    apiKey: { sensitive: true, help: 'Copy from Custom Chat Admin → Integrations.' },
                    workspaceId: { help: 'Your Custom Chat workspace slug.' },
                  },
                  actions: {
                    'setup.manual': { label: 'Configure Custom Chat', result: 'form' },
                  },
                },
              },
            },
          },
        ],
      },
    } as unknown as ExtensionMetadataSnapshot;

    const { getPanel, postPanel, readConfig } = createPanelHarness({
      snapshot: customSnapshot,
      runChannelAction: async (channel, { actionId, input }) => {
        if (channel === 'slack' && actionId === 'setup.manual' && !input?.botToken) {
          return {
            ok: true,
            payload: {
              type: 'form',
              message: '使用 App Manifest 创建 Slack 应用。',
              setupTemplate: { content: '{"display_information":{"name":"xopc"}}', url: 'https://api.slack.com/apps' },
            },
          };
        }
        if (channel === 'discord' && actionId === 'setup.manual' && input?.botToken === 'valid-discord-token') {
          return {
            ok: true,
            nextConfig: { channels: { discord: { enabled: true, botToken: 'valid-discord-token' } } },
            payload: {
              type: 'ok',
              message: 'Bot Token 已验证并保存。私聊机器人即可配对。',
              setupLink: { url: 'https://discord.com/oauth2/authorize?client_id=123456789012345678', label: '邀请机器人加入服务器' },
            },
          };
        }
        if (channel === 'custom-chat' && actionId === 'setup.manual') {
          if (!input?.apiKey || !input?.workspaceId) {
            return {
              ok: true,
              payload: {
                type: 'form',
                message: '在 Custom Chat 控制台创建 API Key 后填写下方字段。',
                setupLink: { url: 'https://custom-chat.example.com/settings/tokens', label: '打开 Custom Chat 控制台' },
              },
            };
          }
          return {
            ok: true,
            nextConfig: { channels: { 'custom-chat': { enabled: true, apiKey: input.apiKey, workspaceId: input.workspaceId } } },
            payload: { type: 'ok' },
          };
        }
        return { ok: false };
      },
    });

    // Slack exposes copyable manifest, links, steps, and required credential fields
    const slack = await getPanel('channels', 'slack', 'zh-CN');
    expect(slack.status).toBe(200);
    expect(slack.body.payload.copyable).toMatchObject({
      content: '{"display_information":{"name":"xopc"}}',
    });
    expect(slack.body.payload.links).toContainEqual(expect.objectContaining({ url: 'https://api.slack.com/apps' }));
    expect(slack.body.payload.steps).toContain('使用 App Manifest 创建 Slack 应用。');
    expect(slack.body.payload.fields).toContainEqual(expect.objectContaining({ id: 'botToken', required: true }));

    // Discord surfaces post-connect OAuth invite link right after connecting
    const discordConnected = await postPanel('channels', 'discord', { action: 'connect', values: { botToken: 'valid-discord-token' } }, 'zh-CN');
    expect(discordConnected.status).toBe(200);
    expect(discordConnected.body.payload.links).toContainEqual({
      url: 'https://discord.com/oauth2/authorize?client_id=123456789012345678',
      label: '邀请机器人加入服务器',
    });
    expect(discordConnected.body.payload.steps).toContain('Bot Token 已验证并保存。私聊机器人即可配对。');

    // Brand-new custom channel declared only via ChannelCatalogEntry works automatically
    const customPanel = await getPanel('channels', 'custom-chat', 'en');
    expect(customPanel.status).toBe(200);
    expect(customPanel.body.payload.links).toContainEqual({
      url: 'https://custom-chat.example.com/settings/tokens',
      label: '打开 Custom Chat 控制台',
    });
    expect(customPanel.body.payload.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'workspaceId', label: 'Workspace ID', type: 'text', required: true, description: 'Your Custom Chat workspace slug.', advanced: false }),
      expect.objectContaining({ id: 'apiKey', label: 'Workspace API Key', type: 'secret', required: true, description: 'Copy from Custom Chat Admin → Integrations.', advanced: false }),
      expect.objectContaining({ id: 'groupAllowFrom', type: 'list', addLabel: 'Add group' }),
    ]));
    const customConnect = await postPanel('channels', 'custom-chat', {
      action: 'connect',
      values: { workspaceId: 'acme', apiKey: 'secret-key-value' },
    }, 'en');
    expect(customConnect.status).toBe(200);
    expect(readConfig().channels?.['custom-chat']).toMatchObject({ enabled: true, workspaceId: 'acme', apiKey: 'secret-key-value' });
    expect(JSON.stringify(customConnect.body)).not.toContain('secret-key-value');
  });

  it('surfaces plugin userConfig descriptions, required markers, authorization instructions, and helpUrl', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xopc-mobile-plugin-guide-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, '.codex-plugin'), { recursive: true });
    writeFileSync(join(dir, '.codex-plugin/plugin.json'), JSON.stringify({
      name: 'guided-plugin',
      userConfig: {
        region: { type: 'string', title: 'Service Region', description: 'Use us or eu based on your account.', required: true },
        apiToken: { type: 'string', title: 'API Token', description: 'Generate under Account → API Keys.', required: true, sensitive: true },
      },
      extensions: {
        'ai.xopc': {
          setup: {
            version: 1,
            authorizations: [{
              id: 'primary',
              title: 'Primary Account',
              description: 'Connect your workspace account to unlock tools.',
              servers: ['svc'],
              methods: [{
                id: 'token-form',
                title: 'API Token',
                type: 'form',
                fields: ['apiToken'],
                instructions: ['Open the provider dashboard and create a read-only API token.'],
                helpUrl: 'https://docs.example.com/api-token',
              }],
            }],
          },
        },
      },
    }));
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: { svc: { type: 'http', url: 'https://svc.example.com/mcp' } },
    }));

    const { getPanel, postPanel } = createPanelHarness();
    const store = new AgentPluginStore();
    const review = store.inspect(dir, 'test');
    expect(review.diagnostics).toEqual([]);
    const pluginId = store.install(dir, { reviewHash: review.reviewHash, sourceLabel: 'test' }).id;

    // Before starting setup, preview steps inform the user what will happen
    const beforeStart = await getPanel('plugins', pluginId, 'en');
    expect(beforeStart.status).toBe(200);
    expect(beforeStart.body.payload).toMatchObject({ steps: expect.any(Array) });
    expect(beforeStart.body.payload.steps.length).toBeGreaterThanOrEqual(2);

    // After starting & preparing, field descriptions, required markers, method instructions, and helpUrl surface
    await postPanel('plugins', pluginId, { action: 'start' }, 'en');
    await vi.waitFor(async () => {
      const panel = (await getPanel('plugins', pluginId, 'en')).body.payload;
      expect(panel.fields).toContainEqual(expect.objectContaining({
        id: 'region',
        description: 'Use us or eu based on your account.',
        required: true,
      }));
    });
    const configStep = (await getPanel('plugins', pluginId, 'en')).body.payload;
    await postPanel('plugins', pluginId, { action: 'configure', revision: configStep.revision, values: { region: 'us' } }, 'en');
    await vi.waitFor(async () => {
      const panel = (await getPanel('plugins', pluginId, 'en')).body.payload;
      expect(panel.steps).toContain('Connect your workspace account to unlock tools.');
      expect(panel.steps).toContain('Open the provider dashboard and create a read-only API token.');
      expect(panel.links).toContainEqual({ label: 'View setup guide', url: 'https://docs.example.com/api-token' });
      expect(panel.fields).toContainEqual(expect.objectContaining({
        id: 'apiToken',
        description: 'Generate under Account → API Keys.',
        required: true,
      }));
    });
  });

  it('surfaces connector field descriptions, Composio prerequisites on GET, stdio enable command, and safe MCP removal', async () => {
    const { getPanel, postPanel, readConfig } = createPanelHarness({
      initialConfig: {
        mcp: {
          servers: {
            notes: { type: 'http', url: 'https://secret-host.example/mcp', headers: { Authorization: 'Bearer top-secret' } },
          },
        },
      },
    });

    // Built-in local-files connector surfaces Gateway path description, required marker, and steps
    const localFiles = await getPanel('connections', 'local-files', 'zh-CN');
    expect(localFiles.status).toBe(200);
    expect(localFiles.body.payload.steps?.length).toBeGreaterThan(0);
    expect(localFiles.body.payload.fields).toContainEqual(expect.objectContaining({
      id: 'rootPath',
      required: true,
      description: expect.stringContaining('Gateway'),
    }));

    // Composio connector immediately explains desktop prerequisite on GET when unconfigured
    vi.mocked(assertComposioAccessConfigured).mockRejectedValueOnce(new Error('not configured'));
    const composioUnready = await getPanel('connections', 'composio-gmail', 'zh-CN');
    expect(composioUnready.status).toBe(200);
    expect(composioUnready.body.payload.message).toContain('电脑端');
    expect(composioUnready.body.payload.steps?.join('\n')).toContain('Composio');

    // mcp:setup exposes copyable enable command when allowStdio is false and structured field metadata
    const mcpSetup = await getPanel('connections', 'mcp:setup', 'zh-CN');
    expect(mcpSetup.status).toBe(200);
    expect(mcpSetup.body.payload.copyable).toMatchObject({
      content: 'xopc config set gateway.mobileMcpAllowStdio true',
      visibleWhen: { field: 'mcp-mode', value: 'stdio' },
    });
    expect(mcpSetup.body.payload.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'url', format: 'url', required: true, description: expect.any(String) }),
      expect.objectContaining({ id: 'mcp-json', format: 'json', required: true, description: expect.any(String) }),
      expect.objectContaining({ id: 'mcp-env', keyLabel: '变量名', valueLabel: '变量值', maxItems: 32 }),
    ]));

    // Existing custom MCP exposes safe transport subtitle and removal without leaking URL or headers
    const existingMcp = await getPanel('connections', 'mcp:notes', 'zh-CN');
    expect(existingMcp.status).toBe(200);
    expect(JSON.stringify(existingMcp.body)).not.toMatch(/secret-host|top-secret/);
    expect(existingMcp.body.payload.subtitle).toContain('Streamable HTTP');
    expect(existingMcp.body.payload.actions).toContainEqual(expect.objectContaining({ id: 'remove', advanced: true }));

    const removed = await postPanel('connections', 'mcp:notes', { action: 'remove' }, 'zh-CN');
    expect(removed.status).toBe(200);
    expect(removed.body.payload.actions).toContainEqual(expect.objectContaining({ id: 'done', dismiss: true }));
    expect(readConfig().mcp?.servers?.notes).toBeUndefined();
  });

  it('surfaces external runtime status, Codex quota, default model, fast mode, and recheck in the mobile agent panel', async () => {
    const { getPanel, postPanel } = createPanelHarness();
    const repo = new AgentCatalogRepository();
    repo.create({
      id: 'codex-mobile',
      profile: { name: 'Codex', description: 'Host coding runtime' },
      execution: { kind: 'codex', permissionMode: 'full_access' },
    }, { ready: true });

    const probeSpy = vi.spyOn(externalAgentRegistry, 'probeExternalAgentRuntimeCached').mockResolvedValue({
      kind: 'codex',
      label: 'Codex',
      installed: true,
      status: 'ready',
      version: '0.114.0',
      models: [
        {
          id: 'gpt-6.1-sol',
          label: 'GPT-6.1 Sol',
          isDefault: true,
          thinking: { mode: 'levels', options: ['low', 'medium', 'high'], initialValue: 'high', supportsAdaptive: false },
          serviceTiers: [{ id: 'priority', label: 'Fast', description: '1.5x speed, increased usage' }],
        },
      ],
      rateLimits: {
        primary: { usedPercent: 20, windowDurationMins: 300 },
        secondary: { usedPercent: 10, windowDurationMins: 10080 },
      },
    });
    const modelsSpy = vi.spyOn(externalAgentRegistry, 'resolveExternalRuntimeModelsPayload').mockResolvedValue({
      runtimeKind: 'codex',
      runtimeLabel: 'Codex',
      status: 'ready',
      defaultModel: 'gpt-6.1-sol',
      models: [
        {
          id: 'gpt-6.1-sol',
          name: 'GPT-6.1 Sol',
          provider: 'Codex',
          isDefault: true,
          reasoning: true,
          thinking: { mode: 'levels', options: ['low', 'medium', 'high'], initialValue: 'high', supportsAdaptive: false },
          serviceTiers: [{ id: 'priority', label: 'Fast', description: '1.5x speed, increased usage' }],
        },
      ],
    });

    try {
      const loaded = await getPanel('agents', 'codex-mobile', 'zh-CN');
      expect(loaded.status).toBe(200);
      expect(loaded.body.payload.headline).toBe('Codex · 已就绪');
      expect(loaded.body.payload.subtitle).toContain('0.114.0');
      expect(loaded.body.payload.subtitle).toContain('5h 剩余 80%');
      expect(loaded.body.payload.subtitle).toContain('周额度剩余 90%');
      expect(loaded.body.payload.fields).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'defaultModel', type: 'select', value: '__auto__' }),
        expect.objectContaining({ id: 'fastMode', type: 'toggle', value: 'false' }),
        expect.objectContaining({ id: 'permissionMode', type: 'select', advanced: true, value: 'full_access' }),
      ]));

      const saved = await postPanel('agents', 'codex-mobile', {
        action: 'save',
        revision: loaded.body.payload.revision,
        values: {
          name: 'Codex Pro',
          description: 'Updated host runtime',
          defaultModel: 'gpt-6.1-sol',
          fastMode: 'true',
          permissionMode: 'auto_edit',
        },
      }, 'zh-CN');
      expect(saved.status).toBe(200);
      expect(saved.body.payload.message).toBe('已保存');
      const updated = repo.get('codex-mobile');
      expect(updated?.profile?.name).toBe('Codex Pro');
      expect(updated?.execution).toMatchObject({
        kind: 'codex',
        model: 'gpt-6.1-sol',
        serviceTier: 'priority',
        permissionMode: 'auto_edit',
      });

      const rechecked = await postPanel('agents', 'codex-mobile', { action: 'recheck', values: {} }, 'zh-CN');
      expect(rechecked.status).toBe(200);
      expect(probeSpy).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'codex' }), true);
    } finally {
      probeSpy.mockRestore();
      modelsSpy.mockRestore();
    }
  });
});
