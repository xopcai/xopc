import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { discordPlugin } from '../../../extensions/discord/src/index.js';
import { seedTestAgentCatalog } from '../../agent-catalog/test-support.js';
import type { HookHandler } from '../../agent/lifecycle/hook-handler.js';
import { OutboundCoordinator } from '../../agent/messaging/outbound-coordinator.js';
import type { StreamManager } from '../../agent/messaging/stream-manager.js';
import { loadConfig, saveConfig } from '../../config/loader.js';
import { ConfigSchema, type Config } from '../../config/schema.js';
import { MessageBus, type InboundMessage } from '../../infra/bus/index.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';
import { ChannelManager } from '../manager.js';
import { approveChannelPairingBySender, listChannelPairingState } from '../pairing/pairing-service.js';

const { fixture } = vi.hoisted(() => ({ fixture: { endpoint: '' } }));
vi.mock('ws', async (load) => {
  const actual = await load<typeof import('ws')>();
  return {
    ...actual,
    default: class extends actual.default {
      constructor(url: string, options: import('ws').ClientOptions) {
        const provider = new URL(url);
        if (!['gateway.discord.gg', 'gateway-resume.discord.gg'].includes(provider.host)) throw new Error('Unexpected Gateway origin');
        super(fixture.endpoint + provider.search + '&host=' + provider.host, options);
      }
    },
  };
});
import { WebSocketServer, type WebSocket } from 'ws';

const token = 'discord-bot-fixture';
const bot = '100000000000000001';
const app = '100000000000000002';
const member = '100000000000000003';
const dm = '100000000000000004';
const guild = '100000000000000005';
const channel = '100000000000000006';
const thread = '100000000000000007';
const messageId = (id: number) => String(200000000000000000n + BigInt(id));

it('configures Discord and preserves direct, mention and thread delivery across Gateway resume and restart', async () => {
  const state = mkdtempSync(join(process.env.XOPC_STATE_DIR!, 'discord-channel-'));
  const configPath = join(state, 'xopc.json');
  vi.stubEnv('XOPC_STATE_DIR', state);
  openXopcDatabase({ path: join(state, 'xopc.db') });
  seedTestAgentCatalog();
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  fixture.endpoint = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;

  let seq = 0;
  let identifyCount = 0;
  const connections: WebSocket[] = [];
  const connectionHosts: string[] = [];
  const resumes: Array<{ session_id: string; seq: number }> = [];
  const heartbeats: Array<number | null> = [];
  const sends: Array<{ channel: string; body: Record<string, unknown> }> = [];
  let cfg: Config = ConfigSchema.parse({});
  let bus: MessageBus | undefined;
  let manager: ChannelManager | undefined;
  let admitted: InboundMessage[] = [];
  let rejectResume = false;
  let replay: Record<string, unknown>[] = [];

  const dispatch = (socket: WebSocket, type: string, data: unknown) =>
    socket.send(JSON.stringify({ op: 0, s: ++seq, t: type, d: data }));
  server.on('connection', (socket, request) => {
    connections.push(socket);
    connectionHosts.push(new URL(request.url!, fixture.endpoint).searchParams.get('host')!);
    socket.on('message', (message) => {
      const packet = JSON.parse(message.toString());
      switch (packet.op) {
        case 1:
          heartbeats.push(packet.d);
          socket.send(JSON.stringify({ op: 11 }));
          break;
        case 2:
          expect(packet.d).toMatchObject({ token, intents: 4609 });
          seq = 0;
          dispatch(socket, 'READY', {
            session_id: `session-${++identifyCount}`,
            user: { id: bot },
            resume_gateway_url: 'wss://gateway-resume.discord.gg',
          });
          break;
        case 6:
          expect(packet.d.token).toBe(token);
          resumes.push({ session_id: packet.d.session_id, seq: packet.d.seq });
          if (rejectResume) {
            socket.send(JSON.stringify({ op: 9, d: false }));
          } else {
            for (const item of replay) dispatch(socket, 'MESSAGE_CREATE', item);
            replay = [];
            dispatch(socket, 'RESUMED', {});
          }
          break;
      }
    });
    socket.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 60000 } }));
  });

  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://discord.com');
    if (new Headers(init?.headers).get('authorization') !== `Bot ${token}`) return Response.json({}, { status: 401 });
    if (url.pathname === '/api/v10/users/@me') return Response.json({ id: bot, bot: true });
    if (url.pathname === '/api/v10/applications/@me') return Response.json({ id: app });
    if (url.pathname === '/api/v10/gateway/bot') return Response.json({ url: 'wss://gateway.discord.gg' });
    const target = /^\/api\/v10\/channels\/(\d+)\/messages$/.exec(url.pathname);
    if (target) {
      sends.push({ channel: target[1], body: JSON.parse(String(init?.body)) });
      return Response.json({ id: messageId(1000 + sends.length) });
    }
    throw new Error(`Unexpected Discord API: ${url.pathname}`);
  }));

  const payload = (id: number, channelId: string, mention = false) => ({
    id: messageId(id), type: 0, channel_id: channelId, author: { id: member },
    guild_id: channelId === dm ? undefined : guild,
    mentions: mention ? [{ id: bot }] : [],
    content: mention ? `<@${bot}> hello ${id}` : `hello ${id}`,
  });
  const emit = (value: Record<string, unknown>) => dispatch(connections.at(-1)!, 'MESSAGE_CREATE', value);
  const setup = (input?: unknown) => discordPlugin.runtimeActions!.runAction({ cfg, actionId: 'setup.manual', input });
  const start = async () => {
    bus = new MessageBus();
    bus.on('inbound', (msg) => admitted.push(msg));
    manager = new ChannelManager(cfg, bus);
    manager.registerPlugin(discordPlugin);
    await manager.initialize();
    await manager.start();
    await expect.poll(() => manager?.getRunningChannels()).toContain('discord');
  };
  const reply = async (message: InboundMessage, text: string) => {
    const coordinator = new OutboundCoordinator({
      bus: bus!,
      hookHandler: { runMessageSending: async () => ({ send: true, content: text }) } as unknown as HookHandler,
      streamManager: { consumeSkipFinalOutbound: () => false } as unknown as StreamManager,
      getLastAssistantPlainText: () => text,
      reviewTaskTurn: async () => {},
    });
    await coordinator.sendFinalResponse(message, {
      channel: message.channel,
      chatId: message.chat_id,
      senderId: message.sender_id,
      conversationId: String(message.metadata?.conversationId),
      isGroup: message.metadata?.isGroup === true,
      origin: { type: 'channel', channel: 'discord' },
    });
    await manager!.send(await bus!.consumeOutbound(), { requireDelivery: true });
  };

  try {
    expect(await setup()).toMatchObject({ ok: true, payload: {
      type: 'form', setupLink: { url: 'https://discord.com/developers/applications' },
      schema: { required: ['botToken'], properties: { botToken: { format: 'password' } } },
    } });
    expect(await setup({ botToken: 'bad-token' })).toMatchObject({ ok: false });
    const verified = await setup({ botToken: token });
    expect(verified).toMatchObject({
      ok: true, nextConfig: { channels: { discord: { botToken: token, credentialIdentity: `${bot}:${app}`, enabled: true } } },
    });
    if (verified.payload?.type !== 'ok' || !verified.payload.setupLink) throw new Error('Missing Discord invite');
    const invite = new URL(verified.payload.setupLink.url);
    expect(invite.origin + invite.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(invite.searchParams.get('client_id')).toBe(app);
    expect(invite.searchParams.get('scope')).toBe('bot');
    cfg = verified.nextConfig!;
    cfg.channels.discord = { ...cfg.channels.discord as object, groupAllowFrom: [member] };
    await saveConfig(cfg, configPath);
    cfg = loadConfig(configPath);
    expect(discordPlugin.configSurface?.buildConfigSurface(cfg)).toEqual({ enabled: true, groupAllowFrom: [member] });
    await start();

    emit(payload(1, dm));
    await expect.poll(() => listChannelPairingState({ channel: 'discord', config: cfg }).pending.length).toBe(1);
    expect(admitted).toHaveLength(0);
    await expect.poll(() => sends.length).toBe(1);
    expect(approveChannelPairingBySender({ channel: 'discord', senderId: member })).toMatchObject({ ok: true });
    emit(payload(2, dm));
    await expect.poll(() => admitted.length).toBe(1);
    expect(admitted[0]).toMatchObject({ chat_id: `user:${dm}`, content: 'hello 2' });
    await reply(admitted[0]!, 'private reply');
    expect(sends.at(-1)).toMatchObject({ channel: dm, body: {
      content: 'private reply', allowed_mentions: { parse: [], replied_user: false },
      message_reference: { message_id: messageId(2) }, enforce_nonce: true,
    } });

    emit(payload(3, channel));
    emit({ ...payload(4, channel, true), author: { id: member, bot: true } });
    emit(payload(5, channel, true));
    emit(payload(6, thread, true));
    await expect.poll(() => admitted.length).toBe(3);
    expect(admitted[1]).toMatchObject({ chat_id: `group:${channel}`, content: 'hello 5' });
    expect(admitted[2]).toMatchObject({ chat_id: `group:${thread}`, content: 'hello 6' });
    expect(admitted[2]?.metadata?.conversationId).not.toBe(admitted[1]?.metadata?.conversationId);
    await reply(admitted[1]!, 'channel reply');
    expect(sends.at(-1)?.channel).toBe(channel);
    await reply(admitted[2]!, 'thread reply');
    expect(sends.at(-1)).toMatchObject({ channel: thread, body: { message_reference: { message_id: messageId(6) } } });

    const resumeSequence = seq;
    connections.at(-1)!.send(JSON.stringify({ op: 1 }));
    await expect.poll(() => heartbeats.at(-1)).toBe(resumeSequence);
    replay = [payload(6, thread, true), payload(7, thread, true)];
    connections.at(-1)!.terminate();
    await expect.poll(() => manager?.getRunningChannels()).not.toContain('discord');
    await reply(admitted[2]!, 'thread reply during reconnect');
    expect(sends.at(-1)).toMatchObject({ channel: thread, body: { content: 'thread reply during reconnect' } });
    await expect.poll(() => resumes.length, { timeout: 5000 }).toBe(1);
    await expect.poll(() => manager?.getRunningChannels()).toContain('discord');
    expect(resumes[0]).toEqual({ session_id: 'session-1', seq: resumeSequence });
    expect(connectionHosts.at(-1)).toBe('gateway-resume.discord.gg');
    expect(admitted.at(-1)).toMatchObject({ content: 'hello 7' });
    expect(admitted).toHaveLength(4);

    rejectResume = true;
    connections.at(-1)!.send(JSON.stringify({ op: 7 }));
    await expect.poll(() => identifyCount, { timeout: 10000 }).toBe(2);
    await expect.poll(() => manager?.getRunningChannels()).toContain('discord');
    expect(resumes).toHaveLength(2);
    expect(connectionHosts.at(-1)).toBe('gateway.discord.gg');

    await manager?.stop();
    bus?.shutdown();
    closeXopcDatabase();
    openXopcDatabase({ path: join(state, 'xopc.db') });
    cfg = loadConfig(configPath);
    admitted = [];
    await start();
    expect(identifyCount).toBe(3);
    expect(admitted).toHaveLength(4);
    emit(payload(6, thread, true));
    emit(payload(8, thread, true));
    await expect.poll(() => admitted.length).toBe(5);
    expect(admitted.at(-1)).toMatchObject({ content: 'hello 8' });
    await reply(admitted.at(-1)!, 'thread after restart');
    expect(sends.at(-1)).toMatchObject({ channel: thread, body: { message_reference: { message_id: messageId(8) } } });
  } finally {
    await manager?.stop();
    bus?.shutdown();
    for (const socket of connections) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeXopcDatabase();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(state, { recursive: true, force: true });
  }
}, 30_000);
