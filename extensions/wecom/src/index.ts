import { createHash, randomUUID } from 'node:crypto';

import type WebSocket from 'ws';

import { defineChannelPluginEntry } from '@xopcai/xopc/extensions/sdk/channel-entry.js';
import { formatWeComOutboundChunks } from '@xopcai/xopc/channels/enterprise/format.js';
import { createEnterpriseChannel, type EnterpriseMedia, type EnterpriseMessage } from '@xopcai/xopc/channels/enterprise/plugin.js';
import type { EnterpriseCredentials, EnterpriseRegistration } from '@xopcai/xopc/channels/enterprise/setup.js';
import { ChannelConnectionRejectedError, fetchJson, record, runChannelSocket, string, type OnSocketFailure } from '@xopcai/xopc/channels/enterprise/socket.js';

const qrOrigin = 'https://work.weixin.qq.com/ai/qc';
const endpoint = 'wss://openws.work.weixin.qq.com';
const wecomUploadChunkBytes = 512 * 1024;
const wecomImageMimes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif']);

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

function selectWeComMediaType(media: EnterpriseMedia): 'image' | 'video' | 'voice' | 'file' {
  const mime = media.mimeType.toLowerCase();
  if (media.kind === 'image' && wecomImageMimes.has(mime) && media.buffer.length <= 10 * 1024 * 1024) {
    return 'image';
  }
  if (media.kind === 'video' && mime === 'video/mp4' && media.buffer.length <= 10 * 1024 * 1024) {
    return 'video';
  }
  if (media.kind === 'audio' && (mime === 'audio/amr' || media.filename.toLowerCase().endsWith('.amr'))
      && media.buffer.length <= 2 * 1024 * 1024) {
    return 'voice';
  }
  return 'file';
}

function connection(credentials: EnterpriseCredentials, receive?: (message: EnterpriseMessage) => Promise<void>, replaced?: () => void) {
  let authenticated: WebSocket | undefined;
  const pending = new Map<string, { finish: (code?: number, body?: Record<string, unknown>) => void }>();
  function commandWithBody(
    socket: WebSocket,
    cmd: string,
    body?: object,
    requestId = `${cmd}-${randomUUID()}`,
    timeoutMs = 9000,
  ): Promise<{ requestId: string; body: Record<string, unknown> }> {
    return new Promise((resolve, reject) => {
      if (pending.has(requestId) || socket.readyState !== socket.OPEN) {
        reject(new Error('WeCom connection is unavailable'));
        return;
      }
      const closed = () => finish();
      const timer = setTimeout(closed, timeoutMs);
      const finish = (code?: number, responseBody?: Record<string, unknown>) => {
        clearTimeout(timer);
        socket.off('close', closed);
        pending.delete(requestId);
        if (code === 0) resolve({ requestId, body: responseBody ?? {} });
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
  const command = (socket: WebSocket, cmd: string, body?: object, requestId?: string): Promise<string> =>
    commandWithBody(socket, cmd, body, requestId).then((res) => res.requestId);

  async function uploadMedia(socket: WebSocket, media: EnterpriseMedia) {
    const type = selectWeComMediaType(media);
    const totalChunks = Math.max(1, Math.ceil(media.buffer.length / wecomUploadChunkBytes));
    const md5 = createHash('md5').update(media.buffer).digest('hex');
    const init = await commandWithBody(socket, 'aibot_upload_media_init', {
      type,
      filename: media.filename,
      total_size: media.buffer.length,
      total_chunks: totalChunks,
      md5,
    }, undefined, 15_000);
    const uploadId = string(init.body.upload_id);
    if (!uploadId) throw new Error('WeCom did not issue an upload_id');
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
      const start = chunkIndex * wecomUploadChunkBytes;
      const chunk = media.buffer.subarray(start, Math.min(media.buffer.length, start + wecomUploadChunkBytes));
      await commandWithBody(socket, 'aibot_upload_media_chunk', {
        upload_id: uploadId,
        chunk_index: chunkIndex,
        base64_data: chunk.toString('base64'),
      }, undefined, 15_000);
    }
    const finished = await commandWithBody(socket, 'aibot_upload_media_finish', {
      upload_id: uploadId,
    }, undefined, 15_000);
    const mediaId = string(finished.body.media_id);
    if (!mediaId) throw new Error('WeCom did not confirm uploaded media_id');
    return { type, mediaId };
  }

  return {
    endpoint,
    async authenticate(socket: WebSocket) {
      try {
        await command(socket, 'aibot_subscribe', { bot_id: credentials.id, secret: credentials.secret });
      } catch (error) {
        if (error instanceof WeComCommandError && error.code === 40001) {
          throw new ChannelConnectionRejectedError('credentials_rejected', error.message);
        }
        throw error;
      }
      authenticated = socket;
      socket.once('close', () => { if (authenticated === socket) authenticated = undefined; });
    },
    heartbeat: (socket: WebSocket) => command(socket, 'ping').then(() => undefined),
    async send(socket: WebSocket, target: string, group: boolean, text: string, replyId?: string) {
      const formatted = formatWeComOutboundChunks(text);
      const chunks = formatted.length > 0 ? formatted : [text];
      let lastId = '';
      for (const [index, content] of chunks.entries()) {
        const body = { msgtype: 'markdown', markdown: { content } };
        if (index === 0 && replyId) {
          try {
            lastId = await command(socket, 'aibot_respond_msg', body, replyId);
            continue;
          } catch (error) {
            // Only fall back after a definite rejection to avoid duplicate replies.
            if (group || !(error instanceof WeComCommandError)) throw error;
          }
        }
        if (group && index === 0) throw new Error('WeCom group replies require an active mention');
        lastId = await command(socket, 'aibot_send_msg', { chatid: target, ...body });
      }
      return lastId;
    },
    async sendMedia(socket: WebSocket, target: string, _group: boolean, media: EnterpriseMedia, caption?: string, replyId?: string) {
      const { type, mediaId } = await uploadMedia(socket, media);
      const body = { msgtype: type, [type]: { media_id: mediaId } };
      let messageId: string;
      let usedProactiveSend = false;
      try {
        messageId = await command(socket, 'aibot_send_msg', { chatid: target, ...body });
        usedProactiveSend = true;
      } catch (error) {
        if (!replyId || !(error instanceof WeComCommandError)) throw error;
        messageId = await command(socket, 'aibot_respond_msg', body, replyId);
      }
      if (caption && usedProactiveSend) {
        const captionChunks = formatWeComOutboundChunks(caption);
        for (const content of captionChunks.length > 0 ? captionChunks : [caption]) {
          await command(socket, 'aibot_send_msg', { chatid: target, msgtype: 'markdown', markdown: { content } });
        }
      }
      return messageId;
    },
    async receive(value: unknown, socket: WebSocket) {
      const frame = record(value);
      const reqId = string(record(frame.headers).req_id);
      if (!reqId) return;
      if (typeof frame.errcode === 'number' && pending.has(reqId)) {
        pending.get(reqId)?.finish(frame.errcode, record(frame.body));
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
    run(signal: AbortSignal, online: Parameters<typeof runChannelSocket>[2], onFailure: OnSocketFailure) {
      return runChannelSocket(AbortSignal.any([signal, replaced.signal]), async () => protocol, (current) => {
        socket = current;
        online(current);
      }, onFailure);
    },
    send(target: string, group: boolean, text: string, replyId?: string) {
      if (!socket) throw new Error('WeCom is disconnected');
      return protocol.send(socket, target, group, text, replyId);
    },
    sendMedia(target: string, group: boolean, media: EnterpriseMedia, caption?: string, replyId?: string) {
      if (!socket) throw new Error('WeCom is disconnected');
      return protocol.sendMedia(socket, target, group, media, caption, replyId);
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
  media: true,
  credentialFields: ['botId', 'secret'], credentialLabels: ['Bot ID', 'Secret'],
  begin, verify, transport,
});

export default defineChannelPluginEntry({ id: 'wecom', name: 'WeCom', plugin: wecomPlugin });
