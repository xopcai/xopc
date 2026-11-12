import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { serve } from '@hono/node-server';
import { expect, it, vi } from 'vitest';

import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';
import { createHonoApp } from '../hono/app.js';
import { GatewayService } from '../service.js';

async function listen(fetch: Parameters<typeof serve>[0]['fetch']) {
  const server = serve({ fetch, hostname: '127.0.0.1', port: 0 });
  if (!server.listening) await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections?.();
      return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

it('controls built-in channel connections exclusively through Channels settings', async ({ onTestFinished }) => {
  const state = mkdtempSync(join(process.env.XOPC_STATE_DIR!, 'bundled-channels-'));
  vi.stubEnv('XOPC_STATE_DIR', state);
  onTestFinished(() => {
    closeXopcDatabase();
    vi.unstubAllEnvs();
    rmSync(state, { recursive: true, force: true });
  });
  openXopcDatabase({ path: join(state, 'xopc.db') });
  seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, workspace: state }] });
  const webhook = await listen(() => new Response());
  const webhookPort = Number(new URL(webhook.url).port);
  await webhook.close();

  const telegramToken = '123456:telegram-fixture';
  const weixinToken = 'weixin-fixture';
  const requests = new Set<string>();
  const provider = await listen(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === `/bot${telegramToken}/getMe`) {
      requests.add('telegram');
      return Response.json({ ok: true, result: { id: 123456, is_bot: true, first_name: 'Fixture', username: 'fixture_bot' } });
    }
    if (path === `/bot${telegramToken}/deleteWebhook`) return Response.json({ ok: true, result: true });
    if (path === `/bot${telegramToken}/getUpdates`) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return Response.json({ ok: true, result: [] });
    }
    if (path === '/ilink/bot/getupdates' && request.headers.get('authorization') === `Bearer ${weixinToken}`) {
      requests.add('weixin');
      await new Promise((resolve) => setTimeout(resolve, 50));
      return Response.json({ ret: 0, msgs: [] });
    }
    return new Response(null, { status: 404 });
  });

  const configPath = join(state, 'bundled-channels.json');
  const accountId = 'fixture-im-bot';
  const accountPath = join(state, 'weixin', 'accounts', `${accountId}.json`);
  const weixinCredentials = JSON.stringify({ token: weixinToken, baseUrl: provider.url });
  const gatewayToken = 'bundled-channels-test-token';
  const channelIds = ['feishu', 'telegram', 'weixin'];
  const extensionIds = ['feishu-tools', 'telegram', 'weixin'];
  const channels = {
    feishu: {
      enabled: true,
      accounts: { default: { appId: 'cli_fixture', appSecret: 'feishu-fixture' } },
      connectionMode: 'webhook',
      webhookPort,
      verificationToken: 'verify-fixture',
      encryptKey: 'encrypt-fixture',
    },
    telegram: { enabled: true, accounts: { default: { botToken: telegramToken, apiRoot: provider.url } } },
    weixin: { enabled: true, accounts: { [accountId]: { enabled: true } } },
  };
  mkdirSync(join(state, 'weixin', 'accounts'), { recursive: true });
  writeFileSync(join(state, 'weixin', 'accounts.json'), JSON.stringify([accountId]));
  writeFileSync(accountPath, weixinCredentials);
  const otherExtension = join(state, 'extensions', 'inventory-fixture');
  mkdirSync(otherExtension, { recursive: true });
  writeFileSync(join(otherExtension, 'xopc.extension.json'), JSON.stringify({
    id: 'inventory-fixture',
    name: 'Inventory fixture',
    version: '1.0.0',
  }));
  const initialConfig = {
    gateway: { auth: { mode: 'token', token: gatewayToken }, heartbeat: { enabled: false } },
    channels: Object.fromEntries(Object.entries(channels).map(([id, channel]) => [id, { ...channel, enabled: false }])),
    extensions: { disabled: extensionIds },
  };
  writeFileSync(configPath, JSON.stringify(initialConfig));

  async function withGateway(check: (request: (path: string, patch?: unknown, method?: string) => Promise<Response>) => Promise<void>) {
    const service = new GatewayService({ configPath, enableHotReload: false });
    await service.start();
    try {
      const app = createHonoApp({ service, listenHost: '127.0.0.1' });
      const server = await listen(app.fetch);
      try {
        await check((path, patch, method) => fetch(server.url + path, {
          method: method ?? (patch === undefined ? 'GET' : 'PATCH'),
          headers: { authorization: `Bearer ${gatewayToken}`, 'content-type': 'application/json' },
          body: patch === undefined ? undefined : JSON.stringify(patch),
        }));
      } finally {
        await server.close();
      }
    } finally {
      await service.stop();
    }
  }

  function expectChannels(request: (path: string) => Promise<Response>, enabled: boolean) {
    return expect.poll(async () => {
      const response = await request('/api/channels/catalog');
      if (!response.ok) return response.status;
      const catalog = (await response.json()).payload.channels as {
        id: string; enabled: boolean; configured: boolean; runtime: string;
      }[];
      return catalog
        .filter(({ id }) => channelIds.includes(id))
        .map(({ id, enabled, configured, runtime }) => ({ id, enabled, configured, runtime }))
        .sort((a, b) => a.id.localeCompare(b.id));
    }, { timeout: 10_000 }).toEqual(channelIds.map((id) => ({
      id,
      enabled,
      configured: true,
      runtime: enabled ? 'loaded' : 'missing',
    })));
  }

  try {
    await withGateway(async (request) => {
      await expectChannels(request, false);
      expect(requests.size).toBe(0);
      const list = await request('/api/extensions');
      expect(list.status).toBe(200);
      const listedIds = (await list.json()).extensions.map((entry: { id: string }) => entry.id);
      expect(listedIds).toContain('inventory-fixture');
      for (const id of ['dingtalk', 'wecom', 'slack']) {
        expect(listedIds).not.toContain(id);
        const setup = await request(`/api/channels/${id}/actions/setup.manual`, {}, 'POST');
        expect(setup.status).toBe(200);
        const result = await setup.json();
        expect(result).toMatchObject({ payload: { type: 'form', submitAction: 'setup.manual' } });
        if (id === 'slack') {
          expect(JSON.parse(result.payload.setupTemplate.content)).toMatchObject({
            settings: { socket_mode_enabled: true, event_subscriptions: { bot_events: ['app_mention', 'message.im'] } },
          });
        }
      }
      for (const id of extensionIds) {
        expect(listedIds).not.toContain(id);
        const response = await request(`/api/extensions/${id}/activation`, { enabled: true }, 'POST');
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining('Channels settings') } });
      }
      const savedConfig = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(savedConfig.extensions).toEqual(initialConfig.extensions);
      expect(savedConfig.channels).toEqual(initialConfig.channels);
      const response = await request('/api/config', {
        channels: Object.fromEntries(channelIds.map((id) => [id, { enabled: true }])),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      await expectChannels(request, true);
    });

    requests.clear();
    await withGateway(async (request) => {
      await expectChannels(request, true);
      expect(requests).toEqual(new Set(['telegram', 'weixin']));
      expect(JSON.parse(readFileSync(configPath, 'utf8')).channels).toEqual(channels);
      expect(readFileSync(accountPath, 'utf8')).toBe(weixinCredentials);
      const response = await request('/api/config', {
        channels: Object.fromEntries(channelIds.map((id) => [id, { enabled: false }])),
      });
      expect(response.status, await response.clone().text()).toBe(200);
      await expectChannels(request, false);
    });

    requests.clear();
    await withGateway(async (request) => {
      await expectChannels(request, false);
      expect(requests.size).toBe(0);
    });
  } finally {
    await provider.close();
  }
}, 60_000);
