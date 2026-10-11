import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getConnectorDefinition, listConnectorProviders } from '../catalog.js';
import { CHINA_CONNECTORS } from '../china-catalog.js';
import { materializeConnectorMcpServer } from '../materialize.js';
import { resolveConnectorSecretReferences } from '../secret-store.js';

describe('China connector catalog', () => {
  it('publishes pinned CLI and MCP connectors', () => {
    expect(CHINA_CONNECTORS.map((connector) => connector.id)).toEqual([
      'feishu-workspace',
      'wecom-workspace',
      'dingtalk-workspace',
      'wps365-workspace',
      'tencent-meeting',
      'tencent-docs',
      'yuque',
      'amap-maps',
      'bailian-web-search',
      'dida365',
      'flomo',
      'railway-12306',
      'antv-chart',
    ]);
    for (const connector of CHINA_CONNECTORS.filter((item) => item.runtime.type === 'mcp')) {
      expect(connector).toMatchObject({
        source: 'builtin',
        kind: 'mcp',
        runtime: { type: 'mcp' },
        integrationStrategy: { lane: 'mcp', preferred: true },
      });
      if (connector.runtime.type !== 'mcp') throw new Error('Expected an MCP connector.');
      if (connector.runtime.localPackage) {
        expect(connector.runtime.localPackage.version).toMatch(/^\d+\.\d+\.\d+$/);
      } else {
        expect(connector.runtime.serverTemplate).toMatchObject({ type: 'http' });
      }
      expect(JSON.stringify(connector.runtime.serverTemplate)).not.toContain('@latest');
    }
    expect(listConnectorProviders().map((provider) => provider.id)).toContain('china');
  });

  it('provides an acquisition path for every credential', () => {
    for (const connector of CHINA_CONNECTORS) {
      if ((connector.setup.secrets ?? []).length === 0) continue;
      expect(connector.setup.links?.length, connector.id).toBeGreaterThan(0);
      for (const link of connector.setup.links ?? []) {
        expect(() => new URL(link.href), `${connector.id}: ${link.href}`).not.toThrow();
        expect(link.href).toMatch(/^https:\/\//);
      }
    }
  });

  it('uses bundled brand icons for every catalog entry', () => {
    expect(CHINA_CONNECTORS.filter(connector => connector.branding).map((connector) => connector.branding?.logoUrl)).toEqual([
      '/channel-icons/feishu.svg',
      '/connector-icons/wecom.svg',
      '/connector-icons/dingtalk-mark.svg',
      '/connector-icons/wps-docs.svg',
      '/connector-icons/tencent-meeting-mark.svg',
      '/connector-icons/tencent-docs.ico',
      '/connector-icons/yuque.png',
      '/connector-icons/amap.ico',
      '/connector-icons/bailian.png',
      '/connector-icons/dida365.png',
      '/connector-icons/flomo.png',
      '/connector-icons/railway-12306.jpg',
      '/connector-icons/antv-chart.png',
    ]);
    for (const connector of CHINA_CONNECTORS.filter(connector => connector.branding)) {
      expect(connector.branding?.source).toBe('builtin');
      const logoUrl = connector.branding?.logoUrl;
      expect(logoUrl).toBeDefined();
      expect(existsSync(resolve('web/public', logoUrl!.slice(1))), `${connector.id}: ${logoUrl}`).toBe(true);
    }
  });

  it('materializes authenticated official remote MCP servers', () => {
    const meeting = getConnectorDefinition('tencent-meeting');
    expect(meeting).toBeDefined();

    const meetingServer = materializeConnectorMcpServer(meeting!, { secrets: { token: 'meeting-secret-value' } }).server;
    expect(meetingServer).toMatchObject({
      url: 'https://mcp.meeting.tencent.com/mcp',
      headers: {
        'X-Tencent-Meeting-Token': {
          xopcSecretRef: { provider: 'connector-tencent-meeting-token', fieldKey: 'token' },
        },
      },
    });
    expect(JSON.stringify(meetingServer)).not.toContain('meeting-secret-value');
  });

  it('adds authentication schemes only after resolving stored secrets', async () => {
    const resolved = await resolveConnectorSecretReferences(
      {
        Authorization: {
          xopcSecretRef: {
            provider: 'test-bearer-token',
            fieldKey: 'accessToken',
            prefix: 'Bearer ',
          },
        },
      },
      { resolveApiKey: async () => 'stored-token' } as never,
    );
    expect(resolved).toEqual({ Authorization: 'Bearer stored-token' });
  });

  it.each([
    ['tencent-docs', 'token', 'https://docs.qq.com/openapi/mcp', 'stored-token'],
    ['bailian-web-search', 'apiKey', 'https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp', 'Bearer stored-token'],
    ['dida365', 'token', 'https://mcp.dida365.com', 'Bearer stored-token'],
    ['flomo', 'token', 'https://flomoapp.com/mcp', 'Bearer stored-token'],
  ])('preserves the official authentication contract for %s', async (id, key, url, authorization) => {
    const definition = getConnectorDefinition(id)!;
    const { server } = materializeConnectorMcpServer(definition, { secrets: { [key]: 'input-secret' } });
    expect(server).toMatchObject({ url, type: 'http' });
    expect(JSON.stringify(server)).not.toContain('input-secret');
    const resolved = await resolveConnectorSecretReferences(server, { resolveApiKey: async () => 'stored-token' } as never);
    expect(resolved).toMatchObject({ headers: { Authorization: authorization } });
  });

  it.each([
    ['yuque', 'token', 'yuque-mcp@1.0.0', 'YUQUE_PERSONAL_TOKEN'],
    ['amap-maps', 'apiKey', '@amap/amap-maps-mcp-server@0.0.8', 'AMAP_MAPS_API_KEY'],
  ])('uses the published package credential variable for %s', async (id, key, pkg, envKey) => {
    const { server } = materializeConnectorMcpServer(getConnectorDefinition(id)!, { secrets: { [key]: 'input-secret' } });
    expect(server).toMatchObject({ command: 'npx', args: ['-y', pkg] });
    expect(JSON.stringify(server)).not.toContain('input-secret');
    const resolved = await resolveConnectorSecretReferences(server, { resolveApiKey: async () => 'stored-token' } as never);
    expect(resolved).toMatchObject({ env: { [envKey]: 'stored-token' } });
  });

  it.each(['tencent-docs', 'yuque', 'amap-maps', 'bailian-web-search', 'dida365', 'flomo'])('requires credentials before materializing %s', (id) => {
    expect(() => materializeConnectorMcpServer(getConnectorDefinition(id)!, {})).toThrow('Missing required secret');
  });

  it.each([
    ['railway-12306', '12306-mcp@0.3.10', 'experimental'],
    ['antv-chart', '@antv/mcp-server-chart@0.9.10', 'beta'],
  ])('materializes the credential-free utility %s', (id, pkg, verificationLevel) => {
    const definition = getConnectorDefinition(id)!;
    expect(definition).toMatchObject({ auth: { mode: 'none' }, verificationLevel });
    const { server } = materializeConnectorMcpServer(definition, {});
    expect(server).toMatchObject({ command: 'npx', args: ['-y', pkg] });
    expect(server.headers).toBeUndefined();
    expect(server.env).toBeUndefined();
  });

  it('uses CLI authorization for Feishu without an MCP fallback', () => {
    expect(getConnectorDefinition('feishu-workspace')).toMatchObject({
      kind: 'cli', auth: { mode: 'cli' },
      runtime: { type: 'cli', adapterId: 'lark', adapterVersion: '1', binaryVersion: '1.0.96' },
    });
    expect(getConnectorDefinition('wecom-workspace')).toMatchObject({
      displayName: '企业微信',
      branding: { logoUrl: '/connector-icons/wecom.svg', source: 'builtin' },
      runtime: { type: 'cli', adapterId: 'wecom', binaryVersion: '1.3.0' },
    });
  });

  it('replaces WPS MCP entries with one managed read-only CLI connector', () => {
    expect(getConnectorDefinition('wps365-workspace')).toMatchObject({
      kind: 'cli', auth: { mode: 'cli' }, verificationLevel: 'beta',
      runtime: { type: 'cli', adapterId: 'wps365', binaryVersion: '0.3.6' },
    });
    for (const id of ['wps-cloud-docs', 'wps-calendar', 'wps-mail']) expect(getConnectorDefinition(id)).toBeUndefined();
  });

  it('materializes DingTalk with an explicit service allowlist', () => {
    const connector = getConnectorDefinition('dingtalk-workspace');
    expect(connector).toBeDefined();
    const result = materializeConnectorMcpServer(connector!, {
      secrets: { clientId: 'ding-id', clientSecret: 'secret-value' },
      config: { activeProfiles: 'dingtalk-calendar,dingtalk-todo' },
    });

    expect(result).toMatchObject({
      serverId: 'dingtalk_workspace',
      server: {
        command: 'npx',
        args: ['-y', 'dingtalk-mcp@1.1.21'],
        env: {
          DINGTALK_Client_ID: {
            xopcSecretRef: { provider: 'connector-dingtalk-workspace-clientid', fieldKey: 'clientId' },
          },
          DINGTALK_Client_Secret: {
            xopcSecretRef: { provider: 'connector-dingtalk-workspace-clientsecret', fieldKey: 'clientSecret' },
          },
          ACTIVE_PROFILES: 'dingtalk-calendar,dingtalk-todo',
        },
      },
    });
  });
});
