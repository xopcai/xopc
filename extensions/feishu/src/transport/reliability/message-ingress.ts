import { Readable } from 'node:stream';

import { handleChannelConnectionProbe } from '@xopcai/xopc/channels/connection-probe.js';
import { ChannelMessageJournal } from '@xopcai/xopc/channels/message-journal.js';
import { getMimeType } from '@xopcai/xopc/channels/media.js';
import type { ChannelSecurityContext } from '@xopcai/xopc/channels/plugin-types.js';
import type { InboundMessage } from '@xopcai/xopc/channels/transport-types.js';
import { generateConversationId } from '@xopcai/xopc/chat-commands/session-key.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

import { sendFeishuPairingPromptIfNeeded } from '../../pairing/feishu-pairing-prompt.js';
import type { ResolvedFeishuAccount } from '../../state/accounts.js';
import { recordFeishuMessageBinding } from '../../state/message-bindings.js';
import { probeFeishuBot } from '../client/bot-info.js';
import { createFeishuClient } from '../client/client.js';
import { stripFeishuMentions } from '../text/mentions.js';
import type { FeishuInboundWork } from './inbound-pipeline.js';

const log = createLogger('FeishuIngress');
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export interface FeishuMessageIngressOptions {
  account: ResolvedFeishuAccount;
  abortSignal: AbortSignal;
  enqueueInbound: (work: FeishuInboundWork) => Promise<void>;
  inboundDebounceDefaultMs: number;
  security: { checkAccess(ctx: ChannelSecurityContext): { allowed: boolean; reason?: string } | undefined };
}

export function feishuInboundScope(account: ResolvedFeishuAccount): string {
  return JSON.stringify([account.accountId, account.domain, account.appId]);
}

function parseEvent(event: any) {
  const payload = event?.event ?? event?.data ?? event;
  const message = payload?.message;
  const sender = payload?.sender;
  const chatId = message?.chat_id ?? message?.chatId;
  const messageId = message?.message_id ?? message?.messageId;
  const senderId = sender?.sender_id?.open_id ?? sender?.sender_id?.user_id ?? sender?.open_id ?? sender?.user_id;
  if (![chatId, messageId, senderId].every(value => typeof value === 'string' && value.length > 0)) return;
  if (sender?.sender_type === 'app' || sender?.sender_type === 'bot') return;
  const threadId = message?.thread_id ?? message?.threadId;
  const chatType = message?.chat_type ?? message?.chatType;
  return {
    chatId: chatId as string,
    messageId: messageId as string,
    senderId: senderId as string,
    senderName: sender?.name,
    isGroup: chatType === 'group' || chatType === 'chat',
    threadId: typeof threadId === 'string' && threadId.trim() ? threadId : undefined,
    message,
  };
}

function readContent(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  } catch {
    return { text: raw };
  }
  return {};
}

function readPost(content: Record<string, unknown>): { text: string; imageKeys: string[] } {
  const localized = Object.values(content).find(value => value && typeof value === 'object' && 'content' in value);
  const post = Array.isArray(content.content) ? content : (localized as Record<string, unknown> | undefined) ?? {};
  const text: string[] = [];
  const imageKeys: string[] = [];
  if (typeof post.title === 'string') text.push(post.title);
  if (Array.isArray(post.content)) {
    for (const row of post.content) {
      if (!Array.isArray(row)) continue;
      text.push(row.map(element => {
        if (element?.tag === 'img' && typeof element.image_key === 'string') imageKeys.push(element.image_key);
        if (element?.tag === 'at') return '';
        return typeof element?.text === 'string' ? element.text : '';
      }).join(''));
    }
  }
  return { text: text.join('\n'), imageKeys };
}

export function createFeishuMessageIngress(options: FeishuMessageIngressOptions) {
  const { account, abortSignal, enqueueInbound, inboundDebounceDefaultMs, security } = options;
  const scope = feishuInboundScope(account);
  const journal = new ChannelMessageJournal<unknown, never>('feishu', scope);
  let pump: Promise<void> | undefined;
  let api: ReturnType<typeof createFeishuClient>['api'];
  let botOpenId: string | undefined;

  async function download(messageId: string, key: string, kind: 'image' | 'file', name: string, type: string) {
    api ??= createFeishuClient(account).api;
    const result = await api.im.messageResource.get({
      path: { message_id: messageId, file_key: key },
      params: { type: kind },
    }, { timeout: 15_000, signal: abortSignal });
    const stream = result.getReadableStream() as Readable;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const value of stream) {
      abortSignal.throwIfAborted();
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      size += chunk.length;
      if (size > MAX_ATTACHMENT_BYTES) throw new Error('Feishu attachment size limit exceeded');
      chunks.push(chunk);
    }
    const mimeType = kind === 'image' ? getMimeType('image', name) : getMimeType(type, name);
    return { type, mimeType, name, size, data: Buffer.concat(chunks).toString('base64') };
  }

  async function dispatch(event: unknown): Promise<void> {
    const parsed = parseEvent(event);
    if (!parsed) return;
    const { chatId, messageId, senderId, senderName, isGroup, threadId, message } = parsed;
    const raw = message.content ?? message.body?.content;
    const content = readContent(raw);
    if (!isGroup && typeof content.text === 'string' && await handleChannelConnectionProbe({
      channel: 'feishu', accountId: account.accountId, identity: account.appId, senderId, text: content.text,
      reply: async text => {
        api ??= createFeishuClient(account).api;
        const result = await api.im.message.reply({
          path: { message_id: messageId },
          data: { msg_type: 'text', content: JSON.stringify({ text }) },
        });
        if (result?.code !== 0 || !result?.data?.message_id) throw new Error('Feishu did not confirm the verification reply');
      },
    })) return;

    const access = security.checkAccess({ accountId: account.accountId, chatId, senderId, senderName, isGroup, threadId });
    if (access && !access.allowed) {
      if (!isGroup && access.reason === 'pairing-required') {
        await sendFeishuPairingPromptIfNeeded({ account, messageId, threadId, senderId, senderName, isGroup });
      }
      return;
    }

    if (isGroup && account.requireMention) {
      if (!Array.isArray(message.mentions) || !message.mentions.length) return;
      if (!botOpenId) {
        const identity = await probeFeishuBot(account, AbortSignal.any([abortSignal, AbortSignal.timeout(5000)]))
          .catch(() => ({ ok: false as const }));
        if (identity.ok) botOpenId = identity.openId;
      }
      if (!botOpenId || !message.mentions.some((mention: { id?: { open_id?: string } }) => mention.id?.open_id === botOpenId)) return;
    }

    const kind = message.message_type ?? message.msg_type ?? 'text';
    const post = kind === 'post' ? readPost(content) : undefined;
    const text = stripFeishuMentions(String(post?.text || content.text || content.title || '')).trim();
    const attachments: NonNullable<InboundMessage['attachments']> = [];
    const imageKeys = post?.imageKeys ?? [];
    if (typeof content.image_key === 'string' && kind === 'image') imageKeys.push(content.image_key);
    const media = imageKeys.map(key => ({ key, kind: 'image' as const, name: 'image.png', type: 'image' }));
    const fileKey = content.file_key;
    const files = typeof fileKey === 'string' && ['file', 'audio', 'media'].includes(kind)
      ? [{ key: fileKey, kind: 'file' as const, name: typeof content.file_name === 'string' ? content.file_name : (kind === 'audio' ? 'voice.opus' : kind === 'media' ? 'video.mp4' : 'attachment'), type: kind === 'audio' ? 'audio' : 'file' }]
      : [];
    for (const resource of [...media, ...files].slice(0, 8)) {
      try {
        attachments.push(await download(messageId, resource.key, resource.kind, resource.name, resource.type));
      } catch (err) {
        if (abortSignal.aborted) throw err;
        log.warn({ accountId: account.accountId, messageId }, 'Feishu message attachment unavailable');
      }
    }
    if (!text && !attachments.length) return;

    const conversationId = generateConversationId({ source: 'feishu', chatId, senderId, isGroup, threadId, accountId: account.accountId });
    recordFeishuMessageBinding({ messageId, conversationId, accountId: account.accountId, chatId, senderId, isGroup, threadId });
    await enqueueInbound({
      kind: 'text',
      accountId: account.accountId,
      chatId,
      debounceMs: attachments.length ? 0 : account.inboundDebounceMs ?? inboundDebounceDefaultMs,
      delivery: { scope, id: messageId },
      inbound: {
        channel: 'feishu', sender_id: senderId, chat_id: chatId, content: text,
        ...(attachments.length ? { attachments } : {}),
        metadata: { conversationId, accountId: account.accountId, messageId, threadId, isGroup, feishuEventType: 'im.message.receive_v1' },
      },
    });
  }

  function schedule(): void {
    if (pump || abortSignal.aborted) return;
    pump = Promise.resolve().then(async () => {
      while (!abortSignal.aborted) {
        const pending = journal.pending();
        if (!pending.length) return;
        const groups = new Map<string, typeof pending>();
        for (const entry of pending) {
          const parsed = parseEvent(entry.payload);
          const key = JSON.stringify([parsed?.chatId, parsed?.threadId, parsed?.senderId]);
          const group = groups.get(key) ?? [];
          group.push(entry);
          groups.set(key, group);
        }
        const batches = [...groups.values()];
        for (let index = 0; index < batches.length; index += 4) {
          await Promise.all(batches.slice(index, index + 4).map(async entries => {
            for (const { id, payload } of entries) {
              const message = parseEvent(payload)?.message;
              const content = readContent(message?.content ?? message?.body?.content);
              const replayable = !(typeof content.text === 'string' && /^xopc_[a-f0-9]{32}$/.test(content.text.trim()));
              if (abortSignal.aborted || !journal.begin(id, replayable)) return;
              try {
                await dispatch(payload);
                journal.finish(id, 'completed');
              } catch (err) {
                if (abortSignal.aborted && replayable) return;
                journal.finish(id, 'interrupted');
                log.warn({ accountId: account.accountId, messageId: id, errorType: err instanceof Error ? err.name : typeof err }, 'Feishu message dispatch interrupted');
              }
            }
          }));
        }
      }
    }).catch(err => {
      log.error({ accountId: account.accountId, err }, 'Feishu inbox could not dispatch queued messages');
    }).finally(() => {
      pump = undefined;
    });
  }

  return {
    start() {
      const interrupted = journal.recoverInterrupted();
      if (interrupted) log.warn({ accountId: account.accountId, interrupted }, 'Feishu messages interrupted during dispatch');
      schedule();
    },
    accept(event: unknown) {
      if (abortSignal.aborted) throw new Error('Feishu transport is stopping');
      const parsed = parseEvent(event);
      if (!parsed) return;
      journal.accept([{ id: parsed.messageId, payload: event }]);
      schedule();
    },
    async settled() {
      await pump;
    },
  };
}
