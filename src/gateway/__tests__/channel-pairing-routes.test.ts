import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { upsertPairingRequestSync } from '../../channels/pairing/pairing-store.js';
import { ENV_VARS } from '../../config/paths-state.js';
import type { Config } from '../../config/schema.js';
import { createHonoApp } from '../hono/app.js';
import type { GatewayService } from '../service.js';
import '../../../extensions/telegram/src/pairing-config-resolver.js';

const TOKEN = 'pairing-test-token';

function pairingConfig(): Partial<Config> {
  return {
    gateway: { port: 18790, corsOrigins: [] },
    agents: { defaultPreset: 'default', capabilityPresets: {}, list: [] },
    channels: {
      telegram: {
        enabled: true,
        defaults: { dmPolicy: 'pairing' },
        accounts: { default: {} },
      },
    },
  };
}

function createMockService(config: Partial<Config> = pairingConfig()): GatewayService {
  return {
    currentConfig: config,
    getHealth: () => ({ status: 'healthy', version: 'test', channels: [], uptime: 0 }),
    getChannelsStatus: () => [],
    getAuthToken: () => TOKEN,
    getAuthMode: () => 'token',
    getResolvedAuth: () => ({ mode: 'token', token: TOKEN }),
    sessionIndexInstance: {} as GatewayService['sessionIndexInstance'],
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
  } as unknown as GatewayService;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  };
}

describe('channel pairing routes', () => {
  let dir: string;
  let prevCredDir: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xopc-pair-routes-'));
    prevCredDir = process.env[ENV_VARS.CREDENTIALS_DIR];
    process.env[ENV_VARS.CREDENTIALS_DIR] = dir;
  });

  afterEach(() => {
    if (prevCredDir === undefined) delete process.env[ENV_VARS.CREDENTIALS_DIR];
    else process.env[ENV_VARS.CREDENTIALS_DIR] = prevCredDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns 401 without gateway token', async () => {
    const app = createHonoApp({ service: createMockService(), token: TOKEN });
    const res = await app.request('/api/channels/telegram/pairing');
    expect(res.status).toBe(401);
  });

  it('lists pending pairing state', async () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '916534770',
      accountId: 'default',
    });

    const app = createHonoApp({ service: createMockService(), token: TOKEN });
    const res = await app.request('/api/channels/telegram/pairing?account=default', {
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      payload: { pending: Array<{ senderId: string; codeLast4: string }> };
    };
    expect(body.ok).toBe(true);
    expect(body.payload.pending).toHaveLength(1);
    expect(body.payload.pending[0]?.senderId).toBe('916534770');
    expect(body.payload.pending[0]?.codeLast4).toMatch(/^[A-Z2-9]{4}$/);
  });

  it('approves pairing by code', async () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    const allowPath = path.join(dir, 'xopc-telegram-default-allowFrom.json');
    const upserted = upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '916534770',
      accountId: 'default',
    });

    const app = createHonoApp({ service: createMockService(), token: TOKEN });
    const res = await app.request('/api/channels/telegram/pairing/approve', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        accountId: 'default',
        code: upserted.code,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; payload: { senderId: string } };
    expect(body.ok).toBe(true);
    expect(body.payload.senderId).toBe('916534770');

    const allowRaw = JSON.parse(fs.readFileSync(allowPath, 'utf-8')) as { allowFrom: string[] };
    expect(allowRaw.allowFrom).toContain('916534770');
  });

  it('approves pairing by sender id', async () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '123456789',
      accountId: 'default',
    });

    const app = createHonoApp({ service: createMockService(), token: TOKEN });
    const res = await app.request('/api/channels/telegram/pairing/approve-sender', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        accountId: 'default',
        senderId: '123456789',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; payload: { senderId: string } };
    expect(body.ok).toBe(true);
    expect(body.payload.senderId).toBe('123456789');
  });

  it('returns pairing summary for enabled channels', async () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '111',
      accountId: 'default',
    });
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '222',
      accountId: 'default',
    });

    const app = createHonoApp({ service: createMockService(), token: TOKEN });
    const res = await app.request('/api/channels/pairing/summary', {
      headers: authHeaders(),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      payload: { summary: { telegram: { pending: number } } };
    };
    expect(body.ok).toBe(true);
    expect(body.payload.summary.telegram.pending).toBe(2);
  });

  it('rejects invalid channel on approve', async () => {
    const app = createHonoApp({ service: createMockService(), token: TOKEN });
    const res = await app.request('/api/channels/slack/pairing/approve', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ code: 'ABCDEFGH' }),
    });
    expect(res.status).toBe(400);
  });

  it('dismisses pending pairing without approving', async () => {
    const pairingPath = path.join(dir, 'xopc-telegram-default-pairing.json');
    upsertPairingRequestSync({
      pairingFilePath: pairingPath,
      id: '999888777',
      accountId: 'default',
    });

    const app = createHonoApp({ service: createMockService(), token: TOKEN });
    const res = await app.request('/api/channels/telegram/pairing/pending', {
      method: 'DELETE',
      headers: authHeaders(),
      body: JSON.stringify({
        accountId: 'default',
        senderId: '999888777',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; payload: { senderId: string } };
    expect(body.ok).toBe(true);
    expect(body.payload.senderId).toBe('999888777');

    const listRes = await app.request('/api/channels/telegram/pairing?account=default', {
      headers: authHeaders(),
    });
    const listBody = (await listRes.json()) as { payload: { pending: unknown[] } };
    expect(listBody.payload.pending).toHaveLength(0);
  });
});
