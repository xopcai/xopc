import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { createEnterpriseChannel, type EnterpriseMessage } from '@xopcai/xopc/channels/enterprise/plugin.js';
import type { ChannelSetupLink, EnterpriseCredentials } from '@xopcai/xopc/channels/enterprise/setup.js';
import { fetchJson, record, string } from '@xopcai/xopc/channels/enterprise/socket.js';
import { defineChannelPluginEntry } from '@xopcai/xopc/extensions/sdk/channel-entry.js';
import { chunkText } from '@xopcai/xopc/markdown/chunk.js';

import { runDiscordGateway, snowflake } from './gateway.js';

const api = 'https://discord.com/api/v10';

async function verifyBot(credentials: EnterpriseCredentials, signal?: AbortSignal) {
  const user = record(await fetchJson(`${api}/users/@me`, {
    headers: { authorization: `Bot ${credentials.id}` }, signal,
  }));
  const id = string(user.id);
  if (user.bot !== true || !snowflake.test(id) ||
      (credentials.identity && credentials.identity.split(':')[0] !== id)) {
    throw new Error('Discord did not confirm the configured bot identity');
  }
  return id;
}

async function verifySetup(credentials: EnterpriseCredentials) {
  const [botId, application] = await Promise.all([
    verifyBot(credentials),
    fetchJson(`${api}/applications/@me`, { headers: { authorization: `Bot ${credentials.id}` } }),
  ]);
  const applicationId = string(record(application).id);
  if (!snowflake.test(applicationId)) throw new Error('Discord did not confirm the bot application');
  return `${botId}:${applicationId}`;
}

const setupLink: ChannelSetupLink = (locale, identity) => {
  const zh = locale?.toLowerCase().startsWith('zh');
  const applicationId = identity?.split(':')[1];
  if (applicationId && snowflake.test(applicationId)) {
    const url = new URL('https://discord.com/oauth2/authorize');
    // View Channel, Send Messages, Read Message History, and Send Messages in Threads.
    const permissions = (1n << 10n) | (1n << 11n) | (1n << 16n) | (1n << 38n);
    url.search = new URLSearchParams({ client_id: applicationId, scope: 'bot', permissions: String(permissions) }).toString();
    return {
      url: url.href,
      label: zh ? '邀请机器人加入服务器' : 'Invite bot to a server',
      message: zh ? 'Bot Token 已验证并保存。私聊机器人即可配对。' : 'Bot Token verified and saved. Send the bot a DM to pair.',
    };
  }
  return {
    url: 'https://discord.com/developers/applications',
    label: zh ? '打开 Discord 开发者后台' : 'Open Discord Developer Portal',
    message: zh ? '创建应用后，在 Bot 页面获取 Bot Token。' : 'Create an application and copy its token from the Bot page.',
  };
};

function parseMessage(message: Record<string, unknown>, botId: string): EnterpriseMessage | undefined {
  const author = record(message.author);
  const senderId = string(author.id);
  const messageId = string(message.id);
  const channelId = string(message.channel_id);
  const guild = string(message.guild_id);
  if (author.bot === true || author.system === true || message.webhook_id || senderId === botId ||
      ![senderId, messageId, channelId].every((id) => snowflake.test(id)) ||
      (message.type !== 0 && message.type !== 19)) return;
  if (guild && (!snowflake.test(guild) || !Array.isArray(message.mentions) ||
      !message.mentions.some((mention) => record(mention).id === botId))) return;
  const text = string(message.content).replaceAll(`<@${botId}>`, '').replaceAll(`<@!${botId}>`, '').trim();
  if (!text) return;
  return {
    senderId, messageId, text, replyId: messageId,
    ...(guild ? { groupId: channelId } : { directChatId: channelId }),
  };
}

function discordTransport(credentials: EnterpriseCredentials, receive: (message: EnterpriseMessage) => Promise<void>) {
  const headers = { authorization: `Bot ${credentials.id}`, 'content-type': 'application/json' };
  let signal: AbortSignal | undefined;
  let botCheck: Promise<string> | undefined;
  function ensureBot(signal?: AbortSignal) {
    botCheck ??= verifyBot(credentials, signal).catch((error) => {
      botCheck = undefined;
      throw error;
    });
    return botCheck;
  }
  async function sendChunk(target: string, body: object) {
    const post = () => fetch(`${api}/channels/${target}/messages`, {
      method: 'POST', headers, body: JSON.stringify(body), redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    let response = await post();
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await response.body?.cancel();
      if (retryAfter > 0 && retryAfter <= 10) {
        await delay(retryAfter * 1000, undefined, { signal });
        response = await post();
      }
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Discord message delivery failed (${response.status})`);
    }
    const id = string(record(await response.json()).id);
    if (!snowflake.test(id)) throw new Error('Discord did not confirm message delivery');
    return id;
  }

  return {
    async send(target: string, _group: boolean, text: string, replyId?: string) {
      if (!snowflake.test(target) || (replyId && !snowflake.test(replyId))) throw new Error('Invalid Discord message target');
      const chunks = chunkText(text, 1900);
      if (!chunks.length) throw new Error('Discord message is empty');
      // REST delivery remains available while the Gateway socket is reconnecting.
      await ensureBot(signal);
      let sent = '';
      for (const [index, content] of chunks.entries()) {
        const nonce = replyId
          ? createHash('sha256').update(JSON.stringify([target, replyId, index, content])).digest('hex').slice(0, 24)
          : undefined;
        sent = await sendChunk(target, {
          content,
          allowed_mentions: { parse: [], replied_user: false },
          ...(replyId && index === 0 ? { message_reference: { message_id: replyId, fail_if_not_exists: false } } : {}),
          ...(nonce ? { nonce, enforce_nonce: true } : {}),
        });
      }
      return sent;
    },
    run(abort: AbortSignal, online: Parameters<typeof runDiscordGateway>[0]['online'], onFailure: (message?: string) => void) {
      signal = abort;
      return runDiscordGateway({
        token: credentials.id, signal: abort, online, onFailure,
        async authenticate(currentSignal) {
          const [botId, endpoint] = await Promise.all([
            ensureBot(currentSignal),
            fetchJson(`${api}/gateway/bot`, { headers, signal: currentSignal }),
          ]);
          return { botId, gateway: record(endpoint).url };
        },
        async receive(raw, botId) {
          const message = parseMessage(raw, botId);
          if (message) await receive(message);
        },
      });
    },
  };
}

export const discordPlugin = createEnterpriseChannel({
  id: 'discord', label: 'Discord', order: 70,
  credentialFields: ['botToken'], credentialLabels: ['Bot Token'],
  credentialIdIsSecret: true,
  threads: true,
  sendWhileDisconnected: true,
  setupLink,
  verify: verifySetup,
  transport: discordTransport,
});

export default defineChannelPluginEntry({ id: 'discord', name: 'Discord', plugin: discordPlugin });
