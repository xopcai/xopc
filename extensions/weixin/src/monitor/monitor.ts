import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { ChannelMessageJournal } from '@xopcai/xopc/channels/message-journal.js';
import type { Config } from '@xopcai/xopc/config/schema.js';
import type { MessageBus } from '@xopcai/xopc/infra/bus/index.js';

import { getUpdates } from '../api/api.js';
import { WeixinConfigManager } from '../api/config-cache.js';
import { SESSION_EXPIRED_ERRCODE, pauseSession, getRemainingPauseMs } from '../api/session-guard.js';
import { MessageItemType, type WeixinMessage } from '../api/types.js';
import type { ResolvedWeixinAccount } from '../auth/accounts.js';
import { processWeixinInboundMessage } from '../messaging/process-message.js';
import { setWeixinTypingTicket } from '../messaging/typing-ticket-store.js';
import { loadGetUpdatesBuf } from '../storage/sync-buf.js';
import { logger } from '../util/logger.js';

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_LONG_POLL_TIMEOUT_MS = 90_000;

export type WeixinMonitorState = 'connecting' | 'polling' | 'reconnect-required';

export type MonitorWeixinOpts = {
  account: ResolvedWeixinAccount;
  config: Config;
  bus: MessageBus;
  abortSignal?: AbortSignal;
  longPollTimeoutMs?: number;
  onState?: (state: WeixinMonitorState) => void;
};

function inboundId(message: WeixinMessage): string {
  const messageId = String(message.message_id ?? '');
  const sequence = String(message.seq ?? '');
  const identity = (messageId !== '0' ? messageId : '') || message.client_id || (sequence !== '0' ? sequence : '')
    || createHash('sha256').update(JSON.stringify(message)).digest('hex');
  return JSON.stringify([message.from_user_id, String(identity)]);
}

/** Persist each fetched batch before using the next platform cursor. */
export async function monitorWeixinProvider(opts: MonitorWeixinOpts): Promise<void> {
  const { account, config, bus, abortSignal, longPollTimeoutMs } = opts;
  const { accountId, baseUrl, cdnBaseUrl, token, routeTag } = account;
  const scope = JSON.stringify([accountId, baseUrl]);
  const journal = new ChannelMessageJournal<WeixinMessage, string>('weixin', scope);
  const interrupted = journal.recoverInterrupted();
  if (interrupted) logger.warn({ accountId, interrupted }, 'Weixin messages interrupted during dispatch');
  bus.restoreDurableInbound?.('weixin', scope);
  let cursor = journal.cursor() ?? loadGetUpdatesBuf(accountId) ?? '';
  const configManager = new WeixinConfigManager({ baseUrl, token, routeTag }, msg => logger.debug(msg));
  let timeoutMs = longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  let consecutiveFailures = 0;

  opts.onState?.('connecting');
  while (!abortSignal?.aborted) {
    const pending = journal.pending();
    if (pending.length) {
      // Preserve order for one sender without coupling all senders to a single attachment.
      const senders = new Map<string, typeof pending>();
      for (const entry of pending) {
        const sender = entry.payload.from_user_id ?? '';
        const entries = senders.get(sender) ?? [];
        entries.push(entry);
        senders.set(sender, entries);
      }
      const groups = [...senders.values()];
      for (let index = 0; index < groups.length; index += 4) {
        await Promise.all(groups.slice(index, index + 4).map(async entries => {
          for (const { id, payload } of entries) {
            const text = payload.item_list?.find(item => item.type === MessageItemType.TEXT)?.text_item?.text?.trim() ?? '';
            const replayable = !text.startsWith('/') && !/^xopc_[a-f0-9]{32}$/.test(text);
            if (abortSignal?.aborted || !journal.begin(id, replayable)) return;
            try {
              const senderId = payload.from_user_id;
              if (senderId) {
                void configManager.getForUser(senderId, payload.context_token).then(cached => {
                  if (!abortSignal?.aborted) setWeixinTypingTicket(accountId, senderId, cached.typingTicket);
                }).catch(() => {});
              }
              await processWeixinInboundMessage(payload, {
                account, accountId, config, bus, baseUrl, cdnBaseUrl, token, routeTag,
                delivery: { scope, id },
                abortSignal,
              });
              journal.finish(id, 'completed');
            } catch (err) {
              if (abortSignal?.aborted && replayable) return;
              journal.finish(id, 'interrupted');
              logger.warn({ accountId, errorType: err instanceof Error ? err.name : typeof err }, 'Weixin message dispatch interrupted');
            }
          }
        }));
      }
      continue;
    }

    try {
      const response = await getUpdates({
        baseUrl, token, get_updates_buf: cursor, timeoutMs, routeTag, abortSignal,
      });
      if (abortSignal?.aborted) return;

      if (response.ret === SESSION_EXPIRED_ERRCODE || response.errcode === SESSION_EXPIRED_ERRCODE) {
        opts.onState?.('reconnect-required');
        pauseSession(accountId);
        await delay(getRemainingPauseMs(accountId), undefined, { signal: abortSignal });
        continue;
      }
      if ((response.ret ?? 0) !== 0 || (response.errcode ?? 0) !== 0) {
        throw new Error(`Weixin poll rejected (ret=${response.ret ?? 0}, errcode=${response.errcode ?? 0})`);
      }

      const next = response.get_updates_buf || cursor;
      const messages = response.msgs ?? [];
      if (next !== cursor || messages.length) {
        journal.accept(messages.map(payload => ({ id: inboundId(payload), payload })), next);
        cursor = next;
      }
      if (!response.timedOut) opts.onState?.('polling');
      consecutiveFailures = 0;
      if (response.longpolling_timeout_ms && response.longpolling_timeout_ms > 0) {
        timeoutMs = Math.min(response.longpolling_timeout_ms, MAX_LONG_POLL_TIMEOUT_MS);
      }
    } catch (err) {
      if (abortSignal?.aborted) return;
      opts.onState?.('connecting');
      consecutiveFailures += 1;
      const retryMs = Math.min(30_000, 2000 * 2 ** Math.min(4, consecutiveFailures - 1));
      if (consecutiveFailures === 1) {
        logger.warn({ accountId, retryMs, errorType: err instanceof Error ? err.name : typeof err }, 'Weixin polling failed; retrying');
      }
      await delay(retryMs, undefined, { signal: abortSignal });
    }
  }
}
