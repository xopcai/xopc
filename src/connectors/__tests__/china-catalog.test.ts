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
    expect(CHINA_CONNECTORS.filter(connector => connector.branding).map((connector) => connector.branding?.logoUrl)).toEqual([
      '/channel-icons/feishu.svg',
      '/connector-icons/dingtalk-mark.svg',
      '/connector-icons/wps-docs.svg',
      '/connector-icons/tencent-meeting-mark.svg',
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

  it('uses CLI authorization for Feishu without an MCP fallback', () => {
    expect(getConnectorDefinition('feishu-workspace')).toMatchObject({
      kind: 'cli', auth: { mode: 'cli' },
      runtime: { type: 'cli', adapterId: 'lark', adapterVersion: '1', binaryVersion: '1.0.96' },
    });
    expect(getConnectorDefinition('wecom-workspace')).toMatchObject({
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
