import { randomUUID } from 'node:crypto';

import type WebSocket from 'ws';

import { defineChannelPluginEntry } from '@xopcai/xopc/extensions/sdk/channel-entry.js';
import { createEnterpriseChannel, type EnterpriseMessage } from '@xopcai/xopc/channels/enterprise/plugin.js';
import type { EnterpriseCredentials, EnterpriseRegistration } from '@xopcai/xopc/channels/enterprise/setup.js';
import { fetchJson, record, runChannelSocket, string } from '@xopcai/xopc/channels/enterprise/socket.js';

const qrOrigin = 'https://work.weixin.qq.com/ai/qc';
const endpoint = 'wss://openws.work.weixin.qq.com';

async function begin(signal: AbortSignal): Promise<EnterpriseRegistration> {
  const response = record(await fetchJson(`${qrOrigin}/generate?source=xopc`, { signal }));
  const data = record(response.data);
  const code = string(data.scode);
  const qrPayload = string(data.auth_url);
  if (!code || new URL(qrPayload).protocol !== 'https:') throw new Error('WeCom did not issue a setup QR');
  return {
    qrPayload, expiresInSec: 300, intervalMs: 3000,
    async poll(pollSignal) {
      const result = record(await fetchJson(`${qrOrigin}/query_result?scode=${encodeURIComponent(code)}`, { signal: pollSignal }));
      const status = record(result.data);
      const phase = string(status.status).toLowerCase();
      if (phase === 'expired' || phase === 'fail') return 'expired';
      if (phase !== 'success') return;
      const bot = record(status.bot_info);
      const credentials = { id: string(bot.botid) || string(bot.bot_id), secret: string(bot.secret) };
      return credentials.id && credentials.secret ? credentials : 'expired';
    },
  };
}

class WeComCommandError extends Error {
  constructor(readonly code: number) {
    super(`WeCom rejected the command (${code})`);
  }
}

function connection(credentials: EnterpriseCredentials, receive?: (message: EnterpriseMessage) => Promise<void>, replaced?: () => void) {
  let authenticated: WebSocket | undefined;
  const pending = new Map<string, { finish: (code?: number) => void }>();
  function command(socket: WebSocket, cmd: string, body?: object, requestId = `${cmd}-${randomUUID()}`): Promise<string> {
    return new Promise((resolve, reject) => {
      if (pending.has(requestId) || socket.readyState !== socket.OPEN) {
        reject(new Error('WeCom connection is unavailable'));
        return;
      }
      const closed = () => finish();
      const timer = setTimeout(closed, 9000);
      const finish = (code?: number) => {
        clearTimeout(timer);
        socket.off('close', closed);
        pending.delete(requestId);
        if (code === 0) resolve(requestId);
        else if (code !== undefined) reject(new WeComCommandError(code));
        else reject(new Error('WeCom did not confirm the command'));
      };
      pending.set(requestId, { finish });
      socket.once('close', closed);
      socket.send(JSON.stringify({ cmd, headers: { req_id: requestId }, ...(body ? { body } : {}) }), (error) => {
        if (error) finish();
      });
    });
  }

  return {
    endpoint,
    async authenticate(socket: WebSocket) {
      await command(socket, 'aibot_subscribe', { bot_id: credentials.id, secret: credentials.secret });
      authenticated = socket;
      socket.once('close', () => { if (authenticated === socket) authenticated = undefined; });
    },
    heartbeat: (socket: WebSocket) => command(socket, 'ping').then(() => undefined),
    async send(socket: WebSocket, target: string, group: boolean, text: string, replyId?: string) {
      const body = { msgtype: 'markdown', markdown: { content: text } };
      if (replyId) {
        try {
          return await command(socket, 'aibot_respond_msg', body, replyId);
        } catch (error) {
          // Only fall back after a definite rejection to avoid duplicate replies.
          if (group || !(error instanceof WeComCommandError)) throw error;
        }
      }
      if (group) throw new Error('WeCom group replies require an active mention');
      return command(socket, 'aibot_send_msg', { chatid: target, ...body });
    },
    async receive(value: unknown, socket: WebSocket) {
      const frame = record(value);
      const reqId = string(record(frame.headers).req_id);
      if (!reqId) return;
      if (typeof frame.errcode === 'number' && pending.has(reqId)) {
        pending.get(reqId)?.finish(frame.errcode);
        return;
      }
      if (authenticated !== socket) return;
      if (frame.cmd === 'aibot_event_callback' && record(record(frame.body).event).eventtype === 'disconnected_event') {
        replaced?.();
        return;
      }
      if (frame.cmd !== 'aibot_msg_callback' || !receive) return;
      const body = record(frame.body);
      if (typeof body.aibotid === 'string' && body.aibotid !== credentials.id) return;
      // WeCom sends group callbacks when members @ the robot.
      if (body.chattype !== 'single' && body.chattype !== 'group') return;
      const senderId = string(record(body.from).userid);
      const groupId = body.chattype === 'group' ? string(body.chatid) : undefined;
      const messageId = string(body.msgid);
      const content = body.msgtype === 'text' ? string(record(body.text).content) : '';
      const text = groupId ? content.replace(/^@\S+\s+/, '').trim() : content;
      if (!senderId || !messageId || !text || (body.chattype === 'group' && !groupId)) return;
      await receive({
        senderId, groupId, messageId, text, replyId: reqId,
        reply: (content) => command(socket, 'aibot_respond_msg', {
          msgtype: 'stream', stream: { id: randomUUID(), finish: true, content },
        }, reqId),
      });
    },
  };
}

function transport(credentials: EnterpriseCredentials, receive: (message: EnterpriseMessage) => Promise<void>) {
  let socket: WebSocket | undefined;
  const replaced = new AbortController();
  const protocol = connection(credentials, receive, () => replaced.abort());
  return {
    run(signal: AbortSignal, online: Parameters<typeof runChannelSocket>[2], onFailure: () => void) {
      return runChannelSocket(AbortSignal.any([signal, replaced.signal]), async () => protocol, (current) => {
        socket = current;
        online(current);
      }, onFailure);
    },
    send(target: string, group: boolean, text: string, replyId?: string) {
      if (!socket) throw new Error('WeCom is disconnected');
      return protocol.send(socket, target, group, text, replyId);
    },
  };
}

async function verify(credentials: EnterpriseCredentials) {
  const controller = new AbortController();
  const protocol = connection(credentials);
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(11_000)]);
  let authenticated = false;
  await runChannelSocket(signal, async () => ({
    ...protocol,
    async authenticate(socket) {
      try {
        await protocol.authenticate(socket);
        authenticated = true;
      } finally {
        controller.abort();
      }
    },
  }), () => undefined);
  if (!authenticated) throw new Error('WeCom authentication failed');
}

export const wecomPlugin = createEnterpriseChannel({
  id: 'wecom', label: 'WeCom', order: 50,
  credentialFields: ['botId', 'secret'], credentialLabels: ['Bot ID', 'Secret'],
  begin, verify, transport,
});

export default defineChannelPluginEntry({ id: 'wecom', name: 'WeCom', plugin: wecomPlugin });
