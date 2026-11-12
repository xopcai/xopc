import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { slackPlugin } from '../../../extensions/slack/src/index.js';
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

const { socketFixture } = vi.hoisted(() => ({ socketFixture: { endpoint: '' } }));

vi.mock('ws', async (load) => {
  const actual = await load<typeof import('ws')>();
  return {
    ...actual,
    default: class extends actual.default {
      constructor(url: string, options: import('ws').ClientOptions) {
        const provider = new URL(url);
        if (provider.host !== 'wss.slack.com') throw new Error('Unexpected WebSocket host');
        super(socketFixture.endpoint + provider.search, options);
      }
    },
  };
});

import { WebSocketServer, type WebSocket } from 'ws';

const botToken = 'xoxb-fixture';
const appToken = 'xapp-fixture';
const botUser = 'UBOT';
const workspace = 'TWORK';
const app = 'AAPP';
const sender = 'UMEMBER';

it('connects Slack, confirms durable events, replies in the original thread and recovers across reconnect and restart', async () => {
  const state = mkdtempSync(join(process.env.XOPC_STATE_DIR!, 'slack-channel-'));
  const configPath = join(state, 'xopc.json');
  vi.stubEnv('XOPC_STATE_DIR', state);
  openXopcDatabase({ path: join(state, 'xopc.db') });
  seedTestAgentCatalog();

  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  socketFixture.endpoint = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const sockets: WebSocket[] = [];
  const usedTickets: string[] = [];
  const acknowledged = new Set<string>();
  const sends: Array<Record<string, unknown>> = [];
  let tickets = 0;
  let cfg: Config = ConfigSchema.parse({});
  let manager: ChannelManager | undefined;
  let bus: MessageBus;
  let admitted: InboundMessage[] = [];

  server.on('connection', (socket, request) => {
    sockets.push(socket);
    usedTickets.push(new URL(request.url!, 'https://wss.slack.com').searchParams.get('ticket')!);
    socket.on('message', (message) => {
      acknowledged.add(JSON.parse(message.toString()).envelope_id);
    });
    socket.send(JSON.stringify({ type: 'hello', connection_info: { app_id: app } }));
  });

  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://slack.com');
    const authorization = new Headers(init?.headers).get('authorization');
    switch (url.pathname) {
      case '/api/auth.test':
        return authorization === `Bearer ${botToken}`
          ? Response.json({ ok: true, team_id: workspace, user_id: botUser, bot_id: 'BBOT' })
          : Response.json({ ok: false, error: 'invalid_auth' });
      case '/api/apps.connections.open':
        return authorization === `Bearer ${appToken}`
          ? Response.json({ ok: true, url: `wss://wss.slack.com/link/?ticket=${++tickets}` })
          : Response.json({ ok: false, error: 'invalid_auth' });
      case '/api/chat.postMessage':
        expect(authorization).toBe(`Bearer ${botToken}`);
        sends.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: true, ts: `1900000000.${sends.length}` });
      default:
        throw new Error(`Unexpected Slack API: ${url.pathname}`);
    }
  }));

  const setup = (input?: unknown) => slackPlugin.runtimeActions!.runAction({ cfg, actionId: 'setup.manual', input });
  const start = async () => {
    bus = new MessageBus();
    bus.on('inbound', (message) => admitted.push(message));
    manager = new ChannelManager(cfg, bus);
    manager.registerPlugin(slackPlugin);
    await manager.initialize();
    await manager.start();
    await expect.poll(() => manager?.getRunningChannels()).toContain('slack');
  };
  const receive = async (id: string, event: Record<string, unknown>, payload: Record<string, unknown> = {}) => {
    sockets.at(-1)!.send(JSON.stringify({
      type: 'events_api',
      envelope_id: id,
      payload: {
        type: 'event_callback', event_id: `Ev-${id}`, api_app_id: app, team_id: workspace,
        authorizations: [{ team_id: workspace, user_id: botUser, is_bot: true }],
        event: { user: sender, ...event },
        ...payload,
      },
    }));
    await expect.poll(() => acknowledged.has(id)).toBe(true);
  };
  const reply = async (message: InboundMessage, text: string) => {
    const coordinator = new OutboundCoordinator({
      bus,
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
      origin: { type: 'channel', channel: 'slack' },
    });
    const outgoing = await bus.consumeOutbound();
    await manager!.send(outgoing, { requireDelivery: true });
  };

  try {
    const form = (await setup()).payload;
    if (form?.type !== 'form') throw new Error('Missing Slack setup form');
    expect(JSON.parse(form.setupTemplate!.content)).toMatchObject({
      oauth_config: { scopes: { bot: ['app_mentions:read', 'chat:write', 'im:history'] } },
      settings: { socket_mode_enabled: true, event_subscriptions: { bot_events: ['app_mention', 'message.im'] } },
    });
    expect(form.schema.properties).toMatchObject({
      botToken: { format: 'password' },
      appToken: { format: 'password' },
    });
    expect(await setup({ botToken: 'xoxb-invalid', appToken })).toMatchObject({ ok: false });
    expect(await setup({ botToken, appToken: 'xapp-invalid' })).toMatchObject({ ok: false });
    const configured = await setup({ botToken, appToken });
    expect(configured).toMatchObject({
      ok: true, nextConfig: { channels: { slack: { credentialIdentity: 'TWORK:UBOT', enabled: true } } },
    });
    cfg = configured.nextConfig!;
    cfg.channels.slack = { ...cfg.channels.slack as object, groupAllowFrom: [sender] };
    await saveConfig(cfg, configPath);
    cfg = loadConfig(configPath);
    expect(slackPlugin.configSurface?.buildConfigSurface(cfg)).toEqual({ enabled: true, groupAllowFrom: [sender] });
    await start();

    const dm = { type: 'message', channel_type: 'im', channel: 'DDIRECT', text: 'Private hello', ts: '1800000000.01' };
    await receive('pair', dm);
    expect(admitted).toHaveLength(0);
    expect(listChannelPairingState({ channel: 'slack', config: cfg }).pending).toHaveLength(1);
    await expect.poll(() => sends.length).toBe(1);
    expect(approveChannelPairingBySender({ channel: 'slack', senderId: sender })).toMatchObject({ ok: true });

    await receive('dm', { ...dm, ts: '1800000000.02' });
    expect(admitted[0]).toMatchObject({ content: 'Private hello', chat_id: 'user:DDIRECT', metadata: { isGroup: false } });
    await reply(admitted[0]!, 'Private reply');
    expect(sends.at(-1)).toMatchObject({ channel: 'DDIRECT', text: 'Private reply' });
    expect(sends.at(-1)).not.toHaveProperty('thread_ts');

    const mention = { type: 'app_mention', channel: 'CGENERAL', ts: '1800000001.10', text: '<@UBOT> Channel hello' };
    await receive('unmentioned', { ...mention, text: 'Channel hello' });
    await receive('other-bot', { ...mention, bot_id: 'BOTHER' });
    await receive('ordinary-channel-message', { ...mention, type: 'message', channel_type: 'channel' });
    await receive('wrong-workspace', mention, { team_id: 'TOTHER' });
    await receive('wrong-installation', mention, {
      authorizations: [{ team_id: workspace, user_id: 'UOTHER', is_bot: true }],
    });
    expect(admitted).toHaveLength(1);

    await receive('root', mention);
    const root = admitted.at(-1)!;
    expect(root).toMatchObject({ content: 'Channel hello', chat_id: 'group:CGENERAL', metadata: { threadId: mention.ts, isGroup: true } });
    await reply(root, 'Start a Slack thread');
    expect(sends.at(-1)).toMatchObject({ channel: 'CGENERAL', thread_ts: mention.ts });

    await receive('reply', { ...mention, thread_ts: mention.ts, ts: '1800000001.20' });
    const threaded = admitted.at(-1)!;
    expect(threaded.metadata).toMatchObject({ conversationId: root.metadata?.conversationId, threadId: mention.ts });
    await reply(threaded, 'Stay in the original thread');
    expect(sends.at(-1)).toMatchObject({ channel: 'CGENERAL', thread_ts: mention.ts });
    await receive('reply-redelivered', { ...mention, thread_ts: mention.ts, ts: '1800000001.20' });
    expect(admitted).toHaveLength(3);

    const connections = sockets.length;
    sockets.at(-1)!.terminate();
    await expect.poll(() => sockets.length, { timeout: 5000 }).toBe(connections + 1);
    await expect.poll(() => manager?.getRunningChannels()).toContain('slack');
    sockets.at(-1)!.send(JSON.stringify({ type: 'disconnect', reason: 'refresh_requested' }));
    await expect.poll(() => sockets.length, { timeout: 5000 }).toBe(connections + 2);
    await expect.poll(() => manager?.getRunningChannels()).toContain('slack');
    expect(new Set(usedTickets).size).toBe(usedTickets.length);
    await receive('reconnected', { ...dm, ts: '1800000002.01' });
    expect(admitted).toHaveLength(4);

    await manager?.stop();
    bus.shutdown();
    closeXopcDatabase();
    openXopcDatabase({ path: join(state, 'xopc.db') });
    cfg = loadConfig(configPath);
    admitted = [];
    await start();
    expect(admitted).toHaveLength(4);
    await receive('duplicate-after-restart', mention);
    expect(admitted).toHaveLength(4);
    await receive('fresh-after-restart', { ...mention, thread_ts: mention.ts, ts: '1800000003.01' });
    const restored = admitted.at(-1)!;
    expect(admitted).toHaveLength(5);
    expect(restored.metadata).toMatchObject({ conversationId: root.metadata?.conversationId, threadId: mention.ts });
    await reply(restored, 'Reply after restart');
    expect(sends.at(-1)).toMatchObject({ channel: 'CGENERAL', thread_ts: mention.ts, text: 'Reply after restart' });

    await receive('private-thread', { ...dm, thread_ts: '1800000000.02', ts: '1800000004.01' });
    expect(admitted.at(-1)).toMatchObject({ chat_id: 'user:DDIRECT', metadata: { threadId: '1800000000.02' } });
    await reply(admitted.at(-1)!, 'Reply in the private thread');
    expect(sends.at(-1)).toMatchObject({ channel: 'DDIRECT', thread_ts: '1800000000.02' });
  } finally {
    await manager?.stop();
    bus?.shutdown();
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeXopcDatabase();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(state, { recursive: true, force: true });
  }
}, 30_000);
