import { setTimeout as delay } from 'node:timers/promises';

import type { InboundMessage } from '@xopcai/xopc/channels/transport-types.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import type { ChannelSecurityContext } from '@xopcai/xopc/channels/plugin-types.js';
import { generateConversationId } from '@xopcai/xopc/chat-commands/session-key.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

import type { ResolvedFeishuAccount } from '../../state/accounts.js';
import { createFeishuClient } from '../client/client.js';
import { createFeishuMessageIngress } from '../reliability/message-ingress.js';
import type { FeishuInboundWork } from '../reliability/inbound-pipeline.js';
import { computeBackoffMs } from './retry.js';
import { getFeishuBindingByMessageId } from '../../state/message-bindings.js';

const log = createLogger('FeishuSocketMode');

export interface FeishuSocketModeMonitorDeps {
  account: ResolvedFeishuAccount;
  config: Config;
  enqueueInbound: (work: FeishuInboundWork) => Promise<void>;
  /** Used when `account.inboundDebounceMs` is unset. */
  inboundDebounceDefaultMs: number;
  abortSignal: AbortSignal;
  onState?: (state: 'connecting' | 'online' | 'error') => void;
  security: {
    checkAccess: (ctx: ChannelSecurityContext) => { allowed: boolean; reason?: string } | undefined;
  };
}

export function createFeishuSocketModeMonitor(deps: FeishuSocketModeMonitorDeps) {
  const { account, enqueueInbound, inboundDebounceDefaultMs, abortSignal } = deps;
  const ingress = createFeishuMessageIngress(deps);

  function resolveTextDebounceMs(): number {
    if (typeof account.inboundDebounceMs === 'number' && Number.isFinite(account.inboundDebounceMs)) {
      return Math.max(0, Math.trunc(account.inboundDebounceMs));
    }
    return Math.max(0, Math.trunc(inboundDebounceDefaultMs));
  }

  async function pushInbound(kind: FeishuInboundWork['kind'], inbound: InboundMessage): Promise<void> {
    const debounceMs = kind === 'text' ? resolveTextDebounceMs() : 0;
    await enqueueInbound({
      kind,
      accountId: account.accountId,
      chatId: inbound.chat_id,
      debounceMs,
      inbound,
    });
  }

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
    if (!binding || binding.accountId !== account.accountId) return;

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

    await pushInbound('reaction', {
      channel: 'feishu',
      sender_id: senderId,
      chat_id: binding.chatId,
      content:
        kind === 'deleted'
          ? `撤回了一个表情（${emojiType}）${preview ? `，对应消息：「${preview}」` : ''}`
          : `对一条消息添加了表情（${emojiType}）${preview ? `：「${preview}」` : ''}`,
      metadata: {
        conversationId: binding.conversationId,
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

    if (!senderId || (!chatId && !binding) || (binding && binding.accountId !== account.accountId)) return;
    const isGroup = binding?.isGroup ?? chatId.startsWith('oc_');
    const access = deps.security.checkAccess({ accountId: account.accountId, chatId: chatId || binding!.chatId, senderId, isGroup });
    if (access && !access.allowed) return;
    const conversationId =
      binding?.conversationId ??
      generateConversationId({
        source: 'feishu',
        chatId: chatId || senderId,
        senderId: senderId || 'unknown',
        isGroup: Boolean(chatId) && isGroup,
        accountId: account.accountId,
      });

    const extracted = extractCardActionCommand(action);
    const content =
      extracted?.trim() ||
      `[card action: ${String(action?.tag ?? 'unknown')}]`;

    await pushInbound('card_action', {
      channel: 'feishu',
      sender_id: senderId || 'unknown',
      chat_id: chatId || senderId || 'unknown',
      content,
      metadata: {
        conversationId,
        accountId: account.accountId,
        isGroup: Boolean(chatId) && isGroup,
        feishuEventType: 'card.action.trigger',
        cardActionText: extracted ?? null,
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
    if ((!binding && !chatId) || (binding && binding.accountId !== account.accountId)) return;

    const isGroup = (binding?.isGroup ?? chatId.startsWith('oc_')) === true;
    const conversationId =
      binding?.conversationId ??
      generateConversationId({
        source: 'feishu',
        chatId: chatId || 'unknown',
        senderId: binding?.senderId ?? 'unknown',
        isGroup,
        accountId: account.accountId,
      });

    await pushInbound('recall', {
      channel: 'feishu',
      sender_id: binding?.senderId ?? 'system',
      chat_id: chatId || binding?.chatId || 'unknown',
      content: `撤回了一条消息（${recalledMessageId}）`,
      metadata: {
        conversationId,
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

  async function run(): Promise<void> {
    let attempt = 0;
    ingress.start();
    try {
      while (!abortSignal.aborted) {
        deps.onState?.('connecting');
        let onError!: (err: unknown) => void;
        const failure = new Promise<unknown>(resolve => { onError = resolve; });
        const online = () => {
          attempt = 0;
          if (!abortSignal.aborted) deps.onState?.('online');
        };
        const { wsClient, dispatcher, api } = createFeishuClient(account, {
          onReady: online,
          onReconnected: online,
          onReconnecting: () => { if (!abortSignal.aborted) deps.onState?.('connecting'); },
          onError,
        });

        dispatcher.register({
          'im.message.receive_v1': async (data: unknown) => { ingress.accept(data); },
          'im.message.reaction.created_v1': async (data: any) => handleReactionEvent('created', data, api),
          'im.message.reaction.deleted_v1': async (data: any) => handleReactionEvent('deleted', data, api),
          'im.message.recalled_v1': async (data: any) => handleMessageRecalled(data),
          'card.action.trigger': async (data: any) => handleCardAction(data),
        });

        const onAbort = () => onError(undefined);
        abortSignal.addEventListener('abort', onAbort, { once: true });
        try {
          if (abortSignal.aborted) return;
          void Promise.resolve(wsClient.start({ eventDispatcher: dispatcher })).catch(onError);
          const err = await failure;
          if (!abortSignal.aborted) {
            deps.onState?.('error');
            log.warn({ accountId: account.accountId, errorType: err instanceof Error ? err.name : typeof err }, 'Feishu socket disconnected');
          }
        } finally {
          abortSignal.removeEventListener('abort', onAbort);
          wsClient.close({ force: true });
        }
        if (!abortSignal.aborted) await delay(computeBackoffMs(++attempt), undefined, { signal: abortSignal });
      }
    } finally {
      await ingress.settled();
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

function extractCardActionCommand(action: any): string | null {
  const value = action?.value;
  if (!value || typeof value !== 'object') {
    return null;
  }
  const v = value as Record<string, unknown>;
  const command = typeof v.command === 'string' ? v.command.trim() : '';
  if (command) return command;
  const text = typeof v.text === 'string' ? v.text.trim() : '';
  if (text) return text;
  return null;
}

