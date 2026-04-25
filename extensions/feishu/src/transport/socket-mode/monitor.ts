import type { MessageBus } from '@xopcai/xopc/infra/bus/index.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelSecurityContext } from '@xopcai/xopc/channels/plugin-types.js';
import { generateSessionKey } from '@xopcai/xopc/chat-commands/session-key.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

import type { ResolvedFeishuAccount } from '../../state/accounts.js';
import { createFeishuClient } from '../client/client.js';
import { createFeishuDedupe } from '../reliability/dedupe.js';
import { stripFeishuMentions } from '../text/mentions.js';
import { computeBackoffMs } from './retry.js';
import { getFeishuBindingByMessageId, recordFeishuMessageBinding } from '../../state/message-bindings.js';

const log = createLogger('FeishuSocketMode');

export interface FeishuSocketModeMonitorDeps {
  account: ResolvedFeishuAccount;
  config: Config;
  bus: MessageBus;
  abortSignal: AbortSignal;
  security: {
    checkAccess: (ctx: ChannelSecurityContext) => { allowed: boolean; reason?: string } | undefined;
  };
}

export function createFeishuSocketModeMonitor(deps: FeishuSocketModeMonitorDeps) {
  const { account, config: _config, bus, abortSignal, security } = deps;
  const dedupe = createFeishuDedupe();
  let lastEventAt = 0;

  async function handleReactionEvent(kind: 'created' | 'deleted', event: any, api: any): Promise<void> {
    const msgId = event?.event?.message_id ?? event?.message_id ?? '';
    const emojiType = event?.event?.reaction_type?.emoji_type ?? event?.reaction_type?.emoji_type ?? '';
    const operatorType = event?.event?.operator_type ?? event?.operator_type ?? '';
    const userOpenId =
      event?.event?.user_id?.open_id ?? event?.user_id?.open_id ?? event?.event?.open_id ?? event?.open_id ?? '';
    if (!msgId || !emojiType) return;
    if (operatorType === 'app') return;

    const notifMode = account.reactionNotifications ?? 'own';
    if (notifMode === 'off') {
      return;
    }

    const binding = getFeishuBindingByMessageId(msgId);
    if (!binding) return;

    const reacted = await fetchFeishuMessageForReaction(api, msgId, 1500);
    if (!reacted && notifMode === 'own') {
      // In own-mode, we must be sure this is a bot message.
      return;
    }

    const isBotMessage = reacted?.sender_type === 'app' || reacted?.senderType === 'app';
    if (notifMode === 'own' && !isBotMessage) {
      return;
    }

    const senderId = userOpenId || binding.senderId;
    const preview = reacted ? extractFeishuMessagePreview(reacted) : '';

    await bus.publishInbound({
      channel: 'feishu',
      sender_id: senderId,
      chat_id: binding.chatId,
      content:
        kind === 'deleted'
          ? `撤回了一个表情（${emojiType}）${preview ? `，对应消息：「${preview}」` : ''}`
          : `对一条消息添加了表情（${emojiType}）${preview ? `：「${preview}」` : ''}`,
      metadata: {
        sessionKey: binding.sessionKey,
        accountId: binding.accountId,
        isGroup: binding.isGroup,
        threadId: binding.threadId,
        feishuEventType: `im.message.reaction.${kind}_v1`,
        reactedMessageId: msgId,
        emojiType,
        raw: event,
        reactedMessage: reacted ?? null,
      },
    });
  }

  async function handleCardAction(event: any): Promise<void> {
    const ctx = event?.event?.context ?? event?.context ?? {};
    const operator = event?.event?.operator ?? event?.operator ?? {};
    const action = event?.event?.action ?? event?.action ?? {};
    const chatId = (ctx?.chat_id ?? '').trim();
    const senderId = (operator?.open_id ?? '').trim();
    const openMessageId = (ctx?.open_message_id ?? '').trim();
    const binding = openMessageId ? getFeishuBindingByMessageId(openMessageId) : null;

    const isGroup = chatId.startsWith('oc_');
    const sessionKey =
      binding?.sessionKey ??
      generateSessionKey({
        source: 'feishu',
        chatId: chatId || senderId,
        senderId: senderId || 'unknown',
        isGroup: Boolean(chatId) && isGroup,
        accountId: account.accountId,
      });

    await bus.publishInbound({
      channel: 'feishu',
      sender_id: senderId || 'unknown',
      chat_id: chatId || senderId || 'unknown',
      content: `[card action: ${String(action?.tag ?? 'unknown')}]`,
      metadata: {
        sessionKey,
        accountId: account.accountId,
        isGroup: Boolean(chatId) && isGroup,
        feishuEventType: 'card.action.trigger',
        cardAction: action,
        cardContext: ctx,
        raw: event,
      },
    });
  }

  async function handleMessageRecalled(event: any): Promise<void> {
    const e = event?.event ?? event ?? {};
    const recalledMessageId = (e?.message_id ?? '').trim();
    const chatId = (e?.chat_id ?? '').trim();
    if (!recalledMessageId) return;

    const binding = getFeishuBindingByMessageId(recalledMessageId);
    if (!binding && !chatId) return;

    const isGroup = (binding?.isGroup ?? chatId.startsWith('oc_')) === true;
    const sessionKey =
      binding?.sessionKey ??
      generateSessionKey({
        source: 'feishu',
        chatId: chatId || 'unknown',
        senderId: binding?.senderId ?? 'unknown',
        isGroup,
        accountId: account.accountId,
      });

    await bus.publishInbound({
      channel: 'feishu',
      sender_id: binding?.senderId ?? 'system',
      chat_id: chatId || binding?.chatId || 'unknown',
      content: `撤回了一条消息（${recalledMessageId}）`,
      metadata: {
        sessionKey,
        accountId: account.accountId,
        isGroup,
        threadId: binding?.threadId,
        feishuEventType: 'im.message.recalled_v1',
        recalledMessageId,
        recallTime: e?.recall_time,
        recallType: e?.recall_type,
        raw: event,
      },
    });
  }

  async function handleMessageReceive(event: any): Promise<void> {
    lastEventAt = Date.now();
    const msg = event?.event?.message ?? event?.message ?? event?.data?.message;
    const sender = event?.event?.sender ?? event?.sender ?? event?.data?.sender;
    const chatId = msg?.chat_id ?? msg?.chatId ?? '';
    const messageId = msg?.message_id ?? msg?.messageId ?? '';
    const chatType = msg?.chat_type ?? msg?.chatType ?? '';

    const senderId =
      sender?.sender_id?.open_id ??
      sender?.sender_id?.user_id ??
      sender?.open_id ??
      sender?.user_id ??
      '';
    const senderName = sender?.sender_id?.name ?? sender?.sender_name ?? undefined;

    if (!chatId || !messageId || !senderId) {
      log.warn({ accountId: account.accountId }, 'Feishu inbound missing ids; dropping');
      return;
    }

    if (!dedupe.claim(messageId)) {
      return;
    }

    const isGroup = chatType === 'group' || chatType === 'chat';
    const text =
      msg?.content && typeof msg.content === 'string'
        ? safeJsonText(msg.content)
        : safeJsonText(msg?.body?.content);

    const normalizedText = stripFeishuMentions(text ?? '').trim();
    if (!normalizedText) {
      return;
    }

    const threadId = msg?.thread_id ?? msg?.threadId ?? undefined;

    const sessionKey = generateSessionKey({
      source: 'feishu',
      chatId,
      senderId,
      isGroup,
      threadId: typeof threadId === 'string' && threadId.trim() ? threadId : undefined,
      accountId: account.accountId,
    });

    recordFeishuMessageBinding({
      messageId,
      sessionKey,
      accountId: account.accountId,
      chatId,
      senderId,
      isGroup,
      threadId: typeof threadId === 'string' && threadId.trim() ? threadId : undefined,
    });

    const securityCtx: ChannelSecurityContext = {
      accountId: account.accountId,
      chatId,
      senderId,
      senderName,
      isGroup,
      threadId,
    };

    const access = security.checkAccess(securityCtx);
    if (access && !access.allowed) {
      log.warn(
        { accountId: account.accountId, chatId, senderId, reason: access.reason },
        'Feishu: message dropped by channel security',
      );
      return;
    }

    if (isGroup && account.requireMention) {
      const rawText = text ?? '';
      // Minimal mention gate: require at-tag markup. Later we tighten to bot-identity mention.
      if (!rawText.includes('<at ') && !rawText.includes('@')) {
        return;
      }
    }

    await bus.publishInbound({
      channel: 'feishu',
      sender_id: senderId,
      chat_id: chatId,
      content: normalizedText,
      metadata: {
        sessionKey,
        accountId: account.accountId,
        messageId,
        threadId,
        isGroup,
        raw: event,
      },
    });
  }

  async function run(): Promise<void> {
    let attempt = 0;

    const heartbeatTimer = setInterval(() => {
      if (abortSignal.aborted) return;
      if (lastEventAt === 0) return;
      const silentForMs = Date.now() - lastEventAt;
      if (silentForMs > 5 * 60_000) {
        log.warn({ accountId: account.accountId, silentForMs }, 'Feishu socket mode: no events recently');
      }
    }, 60_000);

    try {
      while (!abortSignal.aborted) {
        attempt++;
        const client = createFeishuClient(account);
        const { wsClient, dispatcher, api } = client;

        dispatcher.register({
          'im.message.receive_v1': async (data: any) => {
            await handleMessageReceive(data);
          },
          'im.message.reaction.created_v1': async (data: any) => {
            await handleReactionEvent('created', data, api);
          },
          'im.message.reaction.deleted_v1': async (data: any) => {
            await handleReactionEvent('deleted', data, api);
          },
          'im.message.recalled_v1': async (data: any) => {
            await handleMessageRecalled(data);
          },
          'card.action.trigger': async (data: any) => {
            await handleCardAction(data);
          },
        });

        try {
          wsClient.start({ eventDispatcher: dispatcher });
        } catch (err) {
          const delayMs = computeBackoffMs(attempt);
          log.error({ err, accountId: account.accountId, delayMs }, 'Feishu socket mode start failed; retrying');
          await sleep(delayMs, abortSignal);
          continue;
        }

        // Wait until abort or wsClient errors out.
        const exited = await new Promise<{ ok: boolean; err?: unknown }>((resolve) => {
          const onAbort = () => resolve({ ok: true });
          if (abortSignal.aborted) return resolve({ ok: true });
          abortSignal.addEventListener('abort', onAbort, { once: true });
          (wsClient as any)?.on?.('error', (err: unknown) => resolve({ ok: false, err }));
          (wsClient as any)?.on?.('close', () => resolve({ ok: false, err: new Error('ws closed') }));
        });

        try {
          wsClient.stop();
        } catch {
          // ignore
        }

        if (abortSignal.aborted) {
          return;
        }

        const delayMs = computeBackoffMs(attempt);
        log.warn(
          { accountId: account.accountId, delayMs, err: exited.err ? String(exited.err) : undefined },
          'Feishu socket mode disconnected; restarting',
        );
        await sleep(delayMs, abortSignal);
      }
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  return { run };
}

async function fetchFeishuMessageForReaction(api: any, messageId: string, timeoutMs: number): Promise<any | null> {
  const t = messageId.trim();
  if (!t) return null;
  try {
    const result = await Promise.race([
      (api as any).im.message.get({ path: { message_id: t } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return (result as any)?.data ?? result;
  } catch {
    return null;
  }
}

function extractFeishuMessagePreview(msg: any): string {
  const raw = msg?.body?.content ?? msg?.content ?? msg?.message?.content;
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    const parsed = JSON.parse(raw);
    const t =
      typeof parsed?.text === 'string'
        ? parsed.text
        : typeof parsed?.content === 'string'
          ? parsed.content
          : '';
    return summarizeText(String(t || ''), 80);
  } catch {
    return summarizeText(raw, 80);
  }
}

function summarizeText(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function safeJsonText(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    const t =
      typeof parsed?.text === 'string'
        ? parsed.text
        : typeof parsed?.content === 'string'
          ? parsed.content
          : typeof parsed?.title === 'string'
            ? parsed.title
            : undefined;
    return typeof t === 'string' ? t : raw;
  } catch {
    return raw;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

