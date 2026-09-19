import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getConnectorDefinition, listConnectorProviders } from '../catalog.js';
import { CHINA_CONNECTORS } from '../china-catalog.js';
import { materializeConnectorMcpServer } from '../materialize.js';
import { resolveConnectorSecretReferences } from '../secret-store.js';

describe('China connector catalog', () => {
  it('publishes only executable, pinned MCP connectors', () => {
    expect(CHINA_CONNECTORS.map((connector) => connector.id)).toEqual([
      'feishu-workspace',
      'dingtalk-workspace',
      'wps-cloud-docs',
      'tencent-meeting',
      'wps-calendar',
      'wps-mail',
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
        expect(connector.runtime.serverTemplate).toMatchObject({ transport: 'streamable-http' });
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
    expect(CHINA_CONNECTORS.map((connector) => connector.branding?.logoUrl)).toEqual([
      '/channel-icons/feishu.svg',
      '/connector-icons/dingtalk-mark.svg',
      '/connector-icons/wps-docs.svg',
      '/connector-icons/tencent-meeting-mark.svg',
      '/connector-icons/wps-calendar.svg',
      '/connector-icons/wps-mail.svg',
    ]);
    for (const connector of CHINA_CONNECTORS) {
      expect(connector.branding?.source).toBe('builtin');
      const logoUrl = connector.branding?.logoUrl;
      expect(logoUrl).toBeDefined();
      expect(existsSync(resolve('web/public', logoUrl!.slice(1))), `${connector.id}: ${logoUrl}`).toBe(true);
    }
  });

  it('materializes authenticated official remote MCP servers', () => {
    const wps = getConnectorDefinition('wps-cloud-docs');
    const meeting = getConnectorDefinition('tencent-meeting');
    expect(wps).toBeDefined();
    expect(meeting).toBeDefined();

    const wpsServer = materializeConnectorMcpServer(wps!, { secrets: { accessToken: 'wps-secret-value' } }).server;
    expect(wpsServer).toMatchObject({
      url: 'https://openapi.wps.cn/mcp/v2/kso-yundoc/message',
      transport: 'streamable-http',
      headers: {
        Authorization: {
          xopcSecretRef: {
            provider: 'connector-wps-cloud-docs-accesstoken',
            fieldKey: 'accessToken',
            prefix: 'Bearer ',
          },
        },
      },
    });

    const meetingServer = materializeConnectorMcpServer(meeting!, { secrets: { token: 'meeting-secret-value' } }).server;
    expect(meetingServer).toMatchObject({
      url: 'https://mcp.meeting.tencent.com/mcp',
      headers: {
        'X-Tencent-Meeting-Token': {
          xopcSecretRef: { provider: 'connector-tencent-meeting-token', fieldKey: 'token' },
        },
      },
    });
    expect(JSON.stringify([wpsServer, meetingServer])).not.toContain('wps-secret-value');
    expect(JSON.stringify([wpsServer, meetingServer])).not.toContain('meeting-secret-value');
  });

  it('adds authentication schemes only after resolving stored secrets', async () => {
    const resolved = await resolveConnectorSecretReferences(
      {
        Authorization: {
          xopcSecretRef: {
            provider: 'connector-wps-cloud-docs-accesstoken',
            fieldKey: 'accessToken',
            prefix: 'Bearer ',
          },
        },
      },
      { resolveApiKey: async () => 'stored-token' } as never,
    );
    expect(resolved).toEqual({ Authorization: 'Bearer stored-token' });
  });

  it('materializes Feishu without placing credentials in arguments', () => {
    const connector = getConnectorDefinition('feishu-workspace');
    expect(connector).toBeDefined();
    const result = materializeConnectorMcpServer(connector!, {
      secrets: { appId: 'cli_test', appSecret: 'secret-value' },
      config: { tools: 'preset.light' },
    });

    expect(result).toMatchObject({
      serverId: 'feishu_workspace',
      server: {
        command: 'npx',
        args: ['-y', '@larksuiteoapi/lark-mcp@0.5.1', 'mcp'],
        env: {
          APP_ID: { xopcSecretRef: { provider: 'connector-feishu-workspace-appid', fieldKey: 'appId' } },
          APP_SECRET: {
            xopcSecretRef: { provider: 'connector-feishu-workspace-appsecret', fieldKey: 'appSecret' },
          },
          LARK_TOOLS: 'preset.light',
        },
      },
    });
    expect(JSON.stringify(result.server.args)).not.toContain('secret-value');
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
