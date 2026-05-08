import type { MessageBus } from '@xopcai/xopc/infra/bus/index.js';
import type { ChannelSecurityContext } from '@xopcai/xopc/channels/plugin-types.js';
import { generateSessionKey } from '@xopcai/xopc/chat-commands/session-key.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';

import type { ResolvedDingtalkAccount } from './accounts.js';
import { checkAndMarkDingtalkMessage } from './dedupe.js';

const log = createLogger('DingTalkStream');

export interface DingtalkStreamMonitorDeps {
  account: ResolvedDingtalkAccount;
  bus: MessageBus;
  abortSignal: AbortSignal;
  security: {
    checkAccess: (ctx: ChannelSecurityContext) => { allowed: boolean; reason?: string } | undefined;
  };
}

function extractTextFromData(data: Record<string, unknown>): string {
  const textObj = data.text as Record<string, unknown> | undefined;
  if (textObj && typeof textObj.content === 'string') {
    return textObj.content.trim();
  }
  if (typeof data.content === 'string') {
    try {
      const p = JSON.parse(data.content) as { text?: string };
      if (p && typeof p.text === 'string') return p.text.trim();
    } catch {
      return String(data.content).trim();
    }
  }
  return '';
}

/**
 * Start DingTalk Stream (robot) client; resolves when aborted or fatal error after logging.
 */
export async function runDingtalkStreamMonitor(deps: DingtalkStreamMonitorDeps): Promise<void> {
  const { account, bus, abortSignal, security } = deps;
  const { accountId, clientId, clientSecret, endpoint } = account;

  const mod = await import('dingtalk-stream');
  type StreamClient = {
    connect(): Promise<void>;
    disconnect(): void | Promise<void>;
    registerCallbackListener(topic: string, cb: (res: Record<string, unknown>) => void | Promise<void>): void;
    socketCallBackResponse(messageId: string, body: Record<string, unknown>): void;
    socket?: { readyState?: number };
  };
  const DWClient = mod.DWClient as unknown as new (opts: Record<string, unknown>) => StreamClient;
  const { TOPIC_ROBOT } = mod as { TOPIC_ROBOT: string };

  const client = new DWClient({
    clientId,
    clientSecret,
    debug: account.debug,
    endpoint: endpoint || 'https://api.dingtalk.com',
    autoReconnect: true,
    // dingtalk-stream does not clear its ws ping interval on socket close; during
    // reconnect the next tick can call ping() while readyState is CONNECTING and crash.
    // Server SYSTEM KEEPALIVE messages still refresh liveness without ws-level pings.
    keepAlive: false,
  });

  const onAbort = async () => {
    try {
      await client.disconnect();
    } catch {
      /* ignore */
    }
  };
  abortSignal.addEventListener('abort', () => void onAbort(), { once: true });

  await client.connect();

  client.registerCallbackListener(TOPIC_ROBOT, async (res: Record<string, unknown>) => {
    const headers = (res.headers ?? {}) as Record<string, unknown>;
    const messageId = typeof headers.messageId === 'string' ? headers.messageId : undefined;
    const rawData = res.data;
    if (typeof rawData !== 'string') {
      return;
    }

    if (messageId) {
      try {
        client.socketCallBackResponse(messageId, { success: true });
      } catch {
        /* ignore */
      }
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      return;
    }

    const businessMsgId = typeof data.msgId === 'string' ? data.msgId : undefined;
    if (checkAndMarkDingtalkMessage(accountId, messageId, businessMsgId)) {
      return;
    }

    const conversationType = String(data.conversationType ?? '');
    const isGroup = conversationType === '2';
    const conversationId = String(data.conversationId ?? '').trim();
    const senderId = String(data.senderStaffId ?? data.senderId ?? '').trim() || 'unknown';
    const sessionWebhook = String(data.sessionWebhook ?? '').trim();
    const text = extractTextFromData(data);
    if (!text && !sessionWebhook) {
      return;
    }
    const content = text || '[non-text message]';

    const access = security.checkAccess({
      accountId,
      chatId: conversationId || senderId,
      senderId,
      senderName: typeof data.senderNick === 'string' ? data.senderNick : undefined,
      isGroup,
    });
    if (access && access.allowed === false) {
      log.debug({ accountId, reason: access.reason }, 'DingTalk inbound denied');
      return;
    }

    if (account.requireMention && isGroup) {
      const textObj = data.text as Record<string, unknown> | undefined;
      const atUsers = (textObj?.atUsers ?? data.atUsers) as Array<Record<string, unknown>> | undefined;
      const mentioned = Array.isArray(atUsers) && atUsers.length > 0;
      if (!mentioned) {
        return;
      }
    }

    const chatId = conversationId || senderId;
    const sessionKey = generateSessionKey({
      source: 'dingtalk',
      chatId,
      senderId,
      isGroup,
      accountId,
    });

    await bus.publishInbound({
      channel: 'dingtalk',
      sender_id: senderId,
      chat_id: chatId,
      content,
      metadata: {
        sessionKey,
        accountId,
        isGroup,
        senderId,
        sessionWebhook: sessionWebhook || undefined,
        conversationId: conversationId || undefined,
        messageId: businessMsgId || messageId,
      },
    });
  });

  await new Promise<void>((resolve) => {
    if (abortSignal.aborted) {
      void onAbort().then(() => resolve());
      return;
    }
    abortSignal.addEventListener(
      'abort',
      () => {
        void onAbort().then(() => resolve());
      },
      { once: true },
    );
  });
}
