import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { dingtalkPlugin } from '../../../extensions/dingtalk/src/index.js';
import { wecomPlugin } from '../../../extensions/wecom/src/index.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import { ConfigSchema, type Config } from '../../config/schema.js';
import { loadConfig, saveConfig } from '../../config/loader.js';
import { MessageBus } from '../../infra/bus/index.js';
import { resolveRoute } from '../../routing/resolve-route.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';
import { issuePairingChallenge } from '../pairing/pairing-challenge.js';
import { approveChannelPairingBySender, listChannelPairingState, registerPairingChannelResolver } from '../pairing/pairing-service.js';
import type { ChannelPlugin } from '../plugin-types.js';
import type { InboundMessage } from '../transport-types.js';

const { sockets } = vi.hoisted(() => ({ sockets: { dingtalk: '', wecom: '' } }));

vi.mock('ws', async (load) => {
  const actual = await load<typeof import('ws')>();
  return {
    ...actual,
    default: class extends actual.default {
      constructor(url: string, options: import('ws').ClientOptions) {
        const endpoint = new URL(url);
        const target = endpoint.host === 'openws.work.weixin.qq.com' ? sockets.wecom : sockets.dingtalk;
        super(target + endpoint.search, options);
      }
    },
  };
});

import { WebSocketServer, type WebSocket } from 'ws';

const dingTopic = '/v1.0/im/bot/messages/get';
const host = { resolveRoute, issuePairingChallenge, registerPairingChannelResolver, warn: vi.fn() };

async function listen(channel: keyof typeof sockets) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  sockets[channel] = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return server;
}

function makeInbound(channel: string, id: string, group = false, mention = true) {
  if (channel === 'dingtalk') return {
    type: 'CALLBACK', headers: { topic: dingTopic, messageId: `callback-${id}` },
    data: JSON.stringify({
      conversationType: group ? '2' : '1', senderStaffId: 'owner', conversationId: 'team',
      msgId: id, msgtype: 'text', text: { content: id }, isInAtList: mention,
    }),
  };
  return {
    cmd: 'aibot_msg_callback', headers: { req_id: `reply-${id}` },
    body: { aibotid: 'bot', chattype: group ? 'group' : 'single', chatid: group ? 'team' : undefined,
      from: { userid: 'owner' }, msgid: id, msgtype: 'text',
      text: { content: group ? `@Assistant ${id}` : id },
    },
  };
}

it.each([dingtalkPlugin, wecomPlugin])('$id sets up, replies, reconnects, and restores durable messages', async (plugin: ChannelPlugin) => {
  const channel = plugin.id as keyof typeof sockets;
  const state = mkdtempSync(join(process.env.XOPC_STATE_DIR!, 'enterprise-channel-'));
  const configPath = join(state, 'xopc.json');
  vi.stubEnv('XOPC_STATE_DIR', state);
  openXopcDatabase({ path: join(state, 'xopc.db') });
  seedTestAgentCatalog();
  const server = await listen(channel);
  const connections: WebSocket[] = [];
  const frames: Array<Record<string, any>> = [];
  const sends: Array<{ path: string; body: Record<string, unknown> }> = [];
  let tickets = 0;
  let allowRegistration = true;
  let registrationPending = true;

  server.on('connection', (socket) => {
    connections.push(socket);
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      frames.push(frame);
      if (channel === 'wecom') socket.send(JSON.stringify({ headers: frame.headers, errcode: 0 }));
    });
  });

  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    switch (url.pathname) {
      case '/app/registration/init':
        expect(body).toEqual({ source: 'DING_DWS_CLAW' });
        return Response.json({ errcode: allowRegistration ? 0 : 1, nonce: 'nonce' });
      case '/app/registration/begin':
        return Response.json({ errcode: 0, device_code: 'device', verification_uri_complete: 'https://dingtalk.com/scan', interval: 1 });
      case '/app/registration/poll':
        expect(body).toEqual({ device_code: 'device' });
        return Response.json({ errcode: 0, status: registrationPending ? 'WAITING' : 'SUCCESS', client_id: 'bot', client_secret: 'fixture-secret' });
      case '/ai/qc/generate':
        return Response.json({ data: allowRegistration ? { scode: 'device', auth_url: 'https://work.weixin.qq.com/scan' } : null });
      case '/ai/qc/query_result':
        expect(url.searchParams.get('scode')).toBe('device');
        return Response.json({ data: { status: registrationPending ? 'pending' : 'success', bot_info: { botid: 'bot', secret: 'fixture-secret' } } });
      case '/v1.0/gateway/connections/open':
        expect(body).toMatchObject({ clientId: 'bot', clientSecret: 'fixture-secret', subscriptions: [{ type: 'CALLBACK', topic: dingTopic }] });
        return Response.json({ endpoint: 'wss://fixture.dingtalk.com', ticket: `ticket-${++tickets}` });
      case '/v1.0/oauth2/accessToken':
        return Response.json({ accessToken: 'fixture-token', expireIn: 7200 });
      case '/v1.0/robot/oToMessages/batchSend':
      case '/v1.0/robot/groupMessages/send':
        expect(new Headers(init?.headers).get('x-acs-dingtalk-access-token')).toBe('fixture-token');
        sends.push({ path: url.pathname, body });
        return Response.json({ processQueryKey: `sent-${sends.length}` });
      default:
        throw new Error(`Unexpected fixture request: ${url.pathname}`);
    }
  }));

  let cfg: Config = ConfigSchema.parse({});
  let bus = new MessageBus();
  let admitted: InboundMessage[] = [];
  bus.on('inbound', (msg) => admitted.push(msg));
  const action = (actionId: string, input?: unknown) => plugin.runtimeActions!.runAction({ cfg, actionId, input, locale: 'en' });
  const emit = (id: string, group = false, mention = true) => connections.at(-1)!.send(JSON.stringify(makeInbound(channel, id, group, mention)));
  const start = async () => {
    await plugin.init({ bus, config: cfg, channelConfig: {}, host });
    await plugin.start();
    await expect.poll(() => plugin.channelIsRunning?.(cfg)).toBe(true);
  };

  try {
    allowRegistration = false;
    expect(await action('setup.start')).toMatchObject({ ok: true, payload: { type: 'form', submitAction: 'setup.manual' } });
    const manual = channel === 'dingtalk' ? { clientId: 'bot', clientSecret: 'fixture-secret' } : { botId: 'bot', secret: 'fixture-secret' };
    expect(await action('setup.manual', manual)).toMatchObject({ ok: true, nextConfig: { channels: { [channel]: manual } } });
    allowRegistration = true;
    const qr = (await action('setup.start')).payload;
    expect(qr).toMatchObject({ type: 'qr', statusAction: 'setup.status' });
    if (qr?.type !== 'qr') throw new Error('Missing setup QR');
    const input = { conversationId: qr.conversationId };
    const time = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(time + qr.pollIntervalMs!);
    try {
      expect(await action('setup.status', input)).toMatchObject({ payload: { phase: 'pending' } });
      registrationPending = false;
      now.mockReturnValue(time + qr.pollIntervalMs! * 3);
      const result = await action('setup.status', input);
      expect(result).toMatchObject({ ok: true, payload: { type: 'poll', phase: 'done', configChanged: true } });
      result.beforeConfigSaved?.();
      cfg = result.nextConfig!;
      result.onConfigSaved?.();
    } finally {
      now.mockRestore();
    }
    cfg.channels[channel] = { ...cfg.channels[channel] as object, groupAllowFrom: ['owner'] };
    await saveConfig(cfg, configPath);
    cfg = loadConfig(configPath);
    expect(plugin.configSurface?.buildConfigSurface(cfg)).not.toHaveProperty(channel === 'dingtalk' ? 'clientSecret' : 'secret');
    await start();

    emit('pair-me');
    await expect.poll(() => listChannelPairingState({ channel, config: cfg }).pending.length).toBe(1);
    expect(admitted).toHaveLength(0);
    await expect.poll(() => channel === 'dingtalk' ? sends.length : frames.filter(frame => frame.cmd === 'aibot_respond_msg').length).toBe(1);
    expect(approveChannelPairingBySender({ channel, senderId: 'owner' })).toMatchObject({ ok: true });
    emit('direct');
    await expect.poll(() => admitted.length).toBe(1);
    expect(admitted[0]).toMatchObject({ content: 'direct', chat_id: 'user:owner', metadata: { isGroup: false } });
    if (channel === 'dingtalk') emit('not-mentioned', true, false);
    emit('group', true);
    await expect.poll(() => admitted.length).toBe(2);
    const group = admitted[1]!;
    expect(group).toMatchObject({ content: 'group', chat_id: 'group:team', metadata: { isGroup: true } });
    expect(group.metadata?.conversationId).not.toBe(admitted[0]!.metadata?.conversationId);

    const sendText = plugin.outbound!.sendText!;
    await sendText({ cfg, to: admitted[0]!.chat_id, text: 'direct reply', outboundMetadata: admitted[0]!.metadata });
    await sendText({ cfg, to: group.chat_id, text: 'group reply', outboundMetadata: group.metadata });
    if (channel === 'dingtalk') {
      expect(sends.at(-1)?.body).toMatchObject({ openConversationId: 'team', msgParam: '{"content":"group reply"}' });
      expect(frames.some(frame => frame.headers?.messageId === 'callback-group' && frame.code === 200)).toBe(true);
    } else {
      expect(frames.at(-1)).toMatchObject({
        cmd: 'aibot_respond_msg', headers: { req_id: 'reply-group' }, body: { markdown: { content: 'group reply' } },
      });
    }

    const connectionCount = connections.length;
    connections.at(-1)!.terminate();
    await expect.poll(() => connections.length, { timeout: 5000 }).toBe(connectionCount + 1);
    await expect.poll(() => plugin.channelIsRunning?.(cfg)).toBe(true);
    emit('after-reconnect');
    await expect.poll(() => admitted.length).toBe(3);
    expect(admitted.at(-1)).toMatchObject({ content: 'after-reconnect' });

    await plugin.stop();
    bus.shutdown();
    closeXopcDatabase();
    openXopcDatabase({ path: join(state, 'xopc.db') });
    cfg = loadConfig(configPath);
    admitted = [];
    bus = new MessageBus();
    bus.on('inbound', (msg) => admitted.push(msg));
    await start();
    expect(admitted.map((msg) => msg.content)).toEqual(['direct', 'group', 'after-reconnect']);
    emit('group', true);
    emit('after-restart', true);
    await expect.poll(() => admitted.length).toBe(4);
    expect(admitted.at(-1)).toMatchObject({ content: 'after-restart', metadata: { conversationId: group.metadata?.conversationId } });
    const restored = admitted.at(-1)!;
    await sendText({ cfg, to: restored.chat_id, text: 'restart reply', outboundMetadata: restored.metadata });
    if (channel === 'wecom') {
      expect(frames.at(-1)).toMatchObject({ cmd: 'aibot_respond_msg', headers: { req_id: 'reply-after-restart' } });
    }
  } finally {
    await plugin.stop();
    bus.shutdown();
    for (const socket of connections) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeXopcDatabase();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(state, { recursive: true, force: true });
  }
}, 25_000);
