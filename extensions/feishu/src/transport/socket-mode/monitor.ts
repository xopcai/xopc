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
        const { wsClient, dispatcher } = client;

        dispatcher.register({
          'im.message.receive_v1': async (data: any) => {
            await handleMessageReceive(data);
          },
        });

        try {
          wsClient.start();
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

