import { describe, expect, it, vi } from 'vitest';

import type { ChannelPlugin } from '../../channels/plugin-types.js';
import type { Config } from '../../config/schema.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';

const TOKEN = 'channel-actions-test-token';

function createConfig(): Partial<Config> {
  return {
    gateway: { port: 18791, corsOrigins: [] },
    agents: { defaults: {} },
    channels: {
      feishu: { enabled: true },
    },
  };
}

function createMockService(plugin: Partial<ChannelPlugin>): GatewayService {
  const config = createConfig();
  return {
    currentConfig: config,
    getHealth: () => ({ status: 'healthy', version: 'test', channels: [], uptime: 0 }),
    getChannelsStatus: () => [],
    getChannelsHubMeta: () => ({ channels: [] }),
    getAuthToken: () => TOKEN,
    getAuthMode: () => 'token',
    sessionIndexInstance: {} as GatewayService['sessionIndexInstance'],
    cronServiceInstance: {} as GatewayService['cronServiceInstance'],
    emit: () => {},
    listSessions: async () => ({ items: [], total: 0 }),
    getSession: async () => null,
    reloadConfig: async () => ({ success: true }),
    saveConfig: async () => ({ saved: true }),
    refreshAuthToken: async () => 'new-token',
    getSkillsApi: () => [],
    reloadSkillsFromDisk: () => {},
    installManagedSkillZip: () => ({ success: true }),
    deleteManagedSkill: () => {},
    getExtensionLoader: () => null,
    ensureChannelRuntimePlugin: async () => plugin,
  } as unknown as GatewayService;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  };
}

describe('channel action routes', () => {
  it('runs doctor.run via doctor adapter before generic runtime actions', async () => {
    const runtimeRunAction = vi.fn(async () => ({ ok: false, message: 'Unsupported Feishu action: doctor.run' }));
    const doctorCheck = vi.fn(async () => [
      { id: 'feishu.config', label: 'Config', status: 'pass' as const, message: 'ok', hints: [] },
    ]);
    const app = createHonoApp({
      service: createMockService({
        id: 'feishu',
        runtimeActions: { runAction: runtimeRunAction },
        doctor: { check: doctorCheck },
      }),
      token: TOKEN,
    });

    const res = await app.request('/api/channels/feishu/actions/doctor.run?locale=zh', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      payload: {
        type: 'diagnostics',
        checks: [{ id: 'feishu.config', label: 'Config', status: 'pass', message: 'ok', hints: [] }],
      },
    });
    expect(doctorCheck).toHaveBeenCalledOnce();
    expect(runtimeRunAction).not.toHaveBeenCalled();
  });
});
