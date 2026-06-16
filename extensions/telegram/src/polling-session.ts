import type { Bot } from 'grammy';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { createLogger } from '@xopcai/xopc/utils/logger.js';
import { isRecoverableTelegramNetworkError } from './network-errors.js';
import { readTelegramUpdateOffset, writeTelegramUpdateOffset } from './update-offset-store.js';

const log = createLogger('TelegramPolling');

const DEFAULT_STALL_THRESHOLD_MS = 120_000;
const MIN_STALL_THRESHOLD_MS = 30_000;
const MAX_STALL_THRESHOLD_MS = 600_000;
const WATCHDOG_INTERVAL_MS = 30_000;

export function resolvePollingStallThresholdMs(value?: number): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_STALL_THRESHOLD_MS;
  return Math.min(MAX_STALL_THRESHOLD_MS, Math.max(MIN_STALL_THRESHOLD_MS, Math.floor(value)));
}

export interface TelegramPollingSessionOptions {
  accountId: string;
  botToken: string;
  bot: Bot;
  stallThresholdMs?: number;
  onExit?: (err?: unknown) => void;
}

export interface TelegramPollingSession {
  stop: () => Promise<void>;
}

export function wireTelegramUpdateOffsetPersistence(
  bot: Bot,
  params: { accountId: string; botToken: string },
): void {
  const savedOffset = readTelegramUpdateOffset(params);
  if (savedOffset != null) {
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === 'getUpdates') {
        const nextPayload = { ...(payload as object), offset: savedOffset + 1 } as typeof payload;
        return prev(method, nextPayload, signal);
      }
      return prev(method, payload, signal);
    });
  }

  bot.use(async (ctx, next) => {
    const updateId = ctx.update.update_id;
    if (Number.isSafeInteger(updateId)) {
      writeTelegramUpdateOffset({ ...params, lastUpdateId: updateId });
    }
    await next();
  });
}

export function startTelegramPollingSession(
  options: TelegramPollingSessionOptions,
): TelegramPollingSession {
  const { accountId, botToken, bot } = options;
  const stallThresholdMs = resolvePollingStallThresholdMs(options.stallThresholdMs);

  wireTelegramUpdateOffsetPersistence(bot, { accountId, botToken });

  let lastUpdateAt = Date.now();
  bot.use(async (_ctx, next) => {
    lastUpdateAt = Date.now();
    await next();
  });

  const runner = run(bot, {
    runner: {
      fetch: { timeout: 30 },
      silent: true,
      maxRetryTime: Number.POSITIVE_INFINITY,
      retryInterval: 'exponential',
    },
  });

  const watchdog = setInterval(() => {
    const idleMs = Date.now() - lastUpdateAt;
    if (idleMs < stallThresholdMs) return;
    log.warn({ accountId, idleMs, stallThresholdMs }, 'Telegram polling stall detected; restarting runner');
    lastUpdateAt = Date.now();
    void restartRunner(runner, accountId).catch((err) => {
      log.error({ err, accountId }, 'Telegram polling restart failed');
    });
  }, WATCHDOG_INTERVAL_MS);
  watchdog.unref?.();

  void attachRunnerExit(runner, accountId, options.onExit);

  return {
    stop: async () => {
      clearInterval(watchdog);
      await runner.stop();
    },
  };
}

async function restartRunner(runner: RunnerHandle, accountId: string): Promise<void> {
  try {
    await runner.stop();
    runner.start();
    log.info({ accountId }, 'Telegram polling runner restarted');
  } catch (err) {
    if (isRecoverableTelegramNetworkError(err)) {
      log.warn({ err, accountId }, 'Telegram polling restart hit network error');
      return;
    }
    throw err;
  }
}

async function attachRunnerExit(
  runner: RunnerHandle,
  accountId: string,
  onExit?: (err?: unknown) => void,
): Promise<void> {
  const task = runner.task();
  if (!task) return;
  void task.catch((err) => {
    log.error({ err, accountId }, 'Telegram polling runner exited');
    onExit?.(err);
  });
}
