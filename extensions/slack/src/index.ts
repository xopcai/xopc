import type WebSocket from 'ws';

import { createEnterpriseChannel, type EnterpriseMessage } from '@xopcai/xopc/channels/enterprise/plugin.js';
import type { EnterpriseCredentials } from '@xopcai/xopc/channels/enterprise/setup.js';
import { postJson, record, runChannelSocket, string } from '@xopcai/xopc/channels/enterprise/socket.js';
import { defineChannelPluginEntry } from '@xopcai/xopc/extensions/sdk/channel-entry.js';

import { slackAppManifest } from './manifest.js';

const slackId = /^[A-Z][A-Z0-9]+$/;
const timestamp = /^\d+\.\d+$/;

type BotIdentity = { teamId: string; userId: string; botId: string };

async function slackCall(method: string, token: string, body: object, signal?: AbortSignal) {
  const result = record(await postJson(`https://slack.com/api/${method}`, body, signal, { authorization: `Bearer ${token}` }));
  if (result.ok !== true) {
    const code = string(result.error);
    throw new Error(`Slack ${method} failed (${/^[a-z_]+$/.test(code) ? code : 'invalid_response'})`);
  }
  return result;
}

async function authenticateBot(token: string, signal?: AbortSignal): Promise<BotIdentity> {
  if (!/^(?:xoxe\.)?xoxb-\S+$/.test(token)) throw new Error('A Slack Bot Token is required');
  const response = await slackCall('auth.test', token, {}, signal);
  const teamId = string(response.team_id);
  const userId = string(response.user_id);
  const botId = string(response.bot_id);
  if (![teamId, userId, botId].every((id) => slackId.test(id))) throw new Error('Slack did not identify a workspace bot');
  return { teamId, userId, botId };
}

async function openSocket(token: string, signal?: AbortSignal): Promise<string> {
  if (!/^(?:xoxe\.)?xapp-\S+$/.test(token)) throw new Error('A Slack App Token is required');
  const result = await slackCall('apps.connections.open', token, {}, signal);
  const url = new URL(string(result.url));
  if (url.protocol !== 'wss:' || !url.hostname.endsWith('.slack.com') || url.username || url.password) {
    throw new Error('Slack returned an invalid Socket Mode URL');
  }
  return url.href;
}

const identityKey = ({ teamId, userId }: BotIdentity) => `${teamId}:${userId}`;

async function verify(credentials: EnterpriseCredentials) {
  const [bot] = await Promise.all([authenticateBot(credentials.id), openSocket(credentials.secret)]);
  return identityKey(bot);
}

function readEvent(payload: Record<string, unknown>, bot: BotIdentity, appId: string) {
  if (!appId || payload.type !== 'event_callback' || payload.api_app_id !== appId ||
      payload.team_id !== bot.teamId || !Array.isArray(payload.authorizations) ||
      !payload.authorizations.some((entry) => {
        const auth = record(entry);
        return auth.is_bot === true && auth.team_id === bot.teamId && auth.user_id === bot.userId;
      })) return;

  const event = record(payload.event);
  const senderId = string(event.user);
  const channelId = string(event.channel);
  const ts = string(event.ts);
  const thread = string(event.thread_ts);
  if (event.bot_id || event.subtype || senderId === bot.userId ||
      !slackId.test(senderId) || !slackId.test(channelId) || !timestamp.test(ts) ||
      (thread && !timestamp.test(thread))) return;

  const direct = event.type === 'message' && event.channel_type === 'im';
  const mention = `<@${bot.userId}>`;
  const text = string(event.text);
  if (!direct && (event.type !== 'app_mention' || !text.includes(mention))) return;
  const content = text.replaceAll(mention, '').trim();
  if (!content) return;

  return {
    senderId, channelId, text: content,
    messageId: `${channelId}:${ts}`,
    groupId: direct ? undefined : channelId,
    directChatId: direct ? channelId : undefined,
    threadId: thread || (direct ? undefined : ts),
  };
}

function slackTransport(credentials: EnterpriseCredentials, receive: (message: EnterpriseMessage) => Promise<void>) {
  let bot: BotIdentity | undefined;
  const send = async (target: string, _group: boolean, text: string, threadId?: string) => {
    if (!slackId.test(target) || (threadId && !timestamp.test(threadId))) throw new Error('Invalid Slack message target');
    const result = await slackCall('chat.postMessage', credentials.id, {
      channel: target,
      text,
      mrkdwn: false,
      unfurl_links: false,
      unfurl_media: false,
      ...(threadId ? { thread_ts: threadId } : {}),
    });
    const ts = string(result.ts);
    if (!timestamp.test(ts)) throw new Error('Slack did not confirm message delivery');
    return ts;
  };

  return {
    send,
    run(signal: AbortSignal, online: Parameters<typeof runChannelSocket>[2], onFailure: (message?: string) => void) {
      return runChannelSocket(signal, async () => {
        const identity = bot ??= await authenticateBot(credentials.id, signal);
        if (credentials.identity && credentials.identity !== identityKey(identity)) {
          throw new Error('Slack workspace or bot changed; reconfigure the channel');
        }
        const endpoint = await openSocket(credentials.secret, signal);
        let appId = '';
        let onHello: (() => void) | undefined;
        return {
          endpoint,
          async authenticate(socket: WebSocket) {
            if (appId) return;
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => finish(new Error('Slack did not send a Socket Mode hello')), 5000);
              const closed = () => finish(new Error('Slack closed before Socket Mode hello'));
              function finish(error?: Error) {
                clearTimeout(timeout);
                socket.off('close', closed);
                onHello = undefined;
                if (error) reject(error);
                else resolve();
              }
              onHello = () => finish();
              socket.once('close', closed);
              if (socket.readyState !== socket.OPEN) closed();
            });
          },
          async receive(value: unknown, socket: WebSocket) {
            const frame = record(value);
            if (frame.type === 'hello') {
              const id = string(record(frame.connection_info).app_id);
              if (!slackId.test(id) || (appId && appId !== id)) throw new Error('Invalid Slack Socket Mode hello');
              appId = id;
              onHello?.();
              return;
            }
            if (frame.type === 'disconnect') {
              socket.terminate();
              return;
            }

            const envelopeId = string(frame.envelope_id);
            if (!envelopeId) return;
            const event = frame.type === 'events_api' ? readEvent(record(frame.payload), identity, appId) : undefined;
            if (event) {
              await receive({
                ...event,
                reply: async (text) => {
                  // Pairing state has been written before issuing the Web API call.
                  void send(event.channelId, false, text, event.threadId)
                    .catch(() => onFailure('Slack pairing prompt could not be delivered'));
                },
              });
            }
            if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ envelope_id: envelopeId }));
          },
        };
      }, online, onFailure);
    },
  };
}

export const slackPlugin = createEnterpriseChannel({
  id: 'slack',
  label: 'Slack',
  order: 60,
  credentialFields: ['botToken', 'appToken'],
  credentialLabels: ['Bot Token (xoxb-)', 'App Token (xapp-)'],
  credentialIdIsSecret: true,
  threads: true,
  setupTemplate: {
    content: JSON.stringify(slackAppManifest, null, 2),
    url: 'https://api.slack.com/apps',
    instructions: {
      zh: '在 Slack 中使用 App Manifest 创建应用并安装到工作区，再填写 Bot Token 和具有 connections:write 权限的 App Token。',
      en: 'Create a Slack app from the App Manifest and install it to your workspace. Enter the Bot Token and an App Token with connections:write.',
    },
  },
  verify,
  transport: slackTransport,
});

export default defineChannelPluginEntry({ id: 'slack', name: 'Slack', plugin: slackPlugin });
