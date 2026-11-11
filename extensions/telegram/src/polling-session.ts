import { setTimeout as delay } from 'node:timers/promises';

import type { Update } from '@grammyjs/types';
import { GrammyError, type Bot } from 'grammy';

import { ChannelMessageJournal } from '@xopcai/xopc/channels/message-journal.js';
import { createLogger } from '@xopcai/xopc/utils/logger.js';
import { createTimeoutAbortSignal } from './timeout-abort.js';
import { readTelegramUpdateOffset, telegramInboundScope } from './update-offset-store.js';

const log = createLogger('TelegramPolling');
const POLL_TIMEOUT_SECONDS = 25;
const OFFSET_MAX_IDLE_MS = 6 * 24 * 60 * 60_000;
const ALLOWED_UPDATES = ['message', 'channel_post', 'message_reaction', 'callback_query'] as const;

type TelegramCursor = { updateId: number; receivedAt: number };

export function resolvePollingStallThresholdMs(value?: number): number {
  if (value == null || !Number.isFinite(value)) return 120_000;
  return Math.min(600_000, Math.max(30_000, Math.floor(value)));
}

export interface TelegramPollingSessionOptions {
  accountId: string;
  botToken: string;
  bot: Bot;
  stallThresholdMs?: number;
  onPoll?: () => void;
  onExit?: (err: unknown) => void;
}

export interface TelegramPollingSession {
  stop: () => Promise<void>;
}

export function startTelegramPollingSession(options: TelegramPollingSessionOptions): TelegramPollingSession {
  const controller = new AbortController();
  const task = poll(options, controller.signal).catch(err => {
    if (controller.signal.aborted) return;
    const message = err instanceof Error ? err.message : String(err);
    log.error({ accountId: options.accountId, errorMessage: message }, 'Telegram polling stopped');
    options.onExit?.(err);
  });
  return {
    stop: async () => {
      controller.abort();
      await task;
    },
  };
}

async function poll(options: TelegramPollingSessionOptions, signal: AbortSignal): Promise<void> {
  const { accountId, bot, botToken } = options;
  const journal = new ChannelMessageJournal<Update, TelegramCursor>('telegram', telegramInboundScope(accountId, botToken));
  const interrupted = journal.recoverInterrupted();
  if (interrupted) log.warn({ accountId, interrupted }, 'Telegram updates interrupted during dispatch');
  let cursor = journal.cursor();
  const legacyOffset = cursor === undefined ? readTelegramUpdateOffset(options) : undefined;
  if (legacyOffset !== undefined) cursor = { updateId: legacyOffset, receivedAt: Date.now() };
  let failures = 0;

  while (!signal.aborted) {
    const pending = journal.pending();
    if (pending.length) {
      // Dispatch the whole received page so Telegram albums and text fragments can coalesce.
      const dispatched = await Promise.all(pending.map(async ({ id, payload }) => {
        const message = payload.message ?? payload.channel_post;
        const text = message?.text ?? message?.caption;
        const replayable = Boolean(message && !text?.trimStart().startsWith('/'));
        if (signal.aborted || !journal.begin(id, replayable)) return;
        try {
          await bot.handleUpdate(payload);
          return { id, outcome: 'completed' as const };
        } catch (err) {
          log.error({ accountId, updateId: id, errorMessage: err instanceof Error ? err.name : typeof err }, 'Telegram update dispatch interrupted');
          return { id, outcome: 'interrupted' as const };
        }
      }));
      journal.finishBatch(dispatched.filter(entry => entry !== undefined));
      continue;
    }

    const timeout = createTimeoutAbortSignal(resolvePollingStallThresholdMs(options.stallThresholdMs), signal);
    try {
      const offset = cursor && Date.now() - cursor.receivedAt < OFFSET_MAX_IDLE_MS ? cursor.updateId + 1 : undefined;
      const updates = await bot.api.getUpdates({
        timeout: POLL_TIMEOUT_SECONDS,
        ...(offset === undefined ? {} : { offset }),
        allowed_updates: [...ALLOWED_UPDATES],
      }, timeout.signal);
      if (signal.aborted) return;
      if (updates.length) {
        const next = { updateId: Math.max(...updates.map(update => update.update_id)), receivedAt: Date.now() };
        journal.accept(updates.map(update => ({ id: String(update.update_id), payload: update })), next);
        cursor = next;
      }
      failures = 0;
      options.onPoll?.();
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof GrammyError && err.error_code === 409) {
        throw new Error('Telegram Bot is already being polled or has a webhook configured');
      }
      if (err instanceof GrammyError && err.error_code >= 400 && err.error_code < 500 && err.error_code !== 429) {
        throw new Error(`Telegram rejected polling (HTTP ${err.error_code})`);
      }
      failures += 1;
      const retryAfter = err instanceof GrammyError ? err.parameters.retry_after ?? 0 : 0;
      const retryMs = Math.max(retryAfter * 1000, Math.min(30_000, 1000 * 2 ** Math.min(5, failures - 1)));
      if (failures === 1) log.warn({ accountId, retryMs }, 'Telegram polling failed; retrying');
      await delay(retryMs, undefined, { signal });
    } finally {
      timeout.dispose();
    }
  }
}
