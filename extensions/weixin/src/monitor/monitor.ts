import type { Config } from '@xopcai/xopcbot/config/schema.js';
import type { MessageBus } from '@xopcai/xopcbot/infra/bus/index.js';

import { getUpdates } from '../api/api.js';
import { WeixinConfigManager } from '../api/config-cache.js';
import { SESSION_EXPIRED_ERRCODE, pauseSession, getRemainingPauseMs } from '../api/session-guard.js';
import { processWeixinInboundMessage } from '../messaging/process-message.js';
import { setWeixinTypingTicket } from '../messaging/typing-ticket-store.js';
import { getSyncBufFilePath, loadGetUpdatesBuf, saveGetUpdatesBuf } from '../storage/sync-buf.js';
import { logger } from '../util/logger.js';
import { redactBody } from '../util/redact.js';
import type { ResolvedWeixinAccount } from '../auth/accounts.js';

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const BACKOFF_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 2_000;

export type MonitorWeixinOpts = {
  account: ResolvedWeixinAccount;
  config: Config;
  bus: MessageBus;
  abortSignal?: AbortSignal;
  longPollTimeoutMs?: number;
};

/**
 * Long-poll loop: getUpdates → process inbound (aligned with openclaw-weixin monitor behavior).
 */
export async function monitorWeixinProvider(opts: MonitorWeixinOpts): Promise<void> {
  const { account, config, bus, abortSignal, longPollTimeoutMs } = opts;
  const accountId = account.accountId;
  const baseUrl = account.baseUrl;
  const cdnBaseUrl = account.cdnBaseUrl;
  const token = account.token;
  const routeTag = account.routeTag;

  const aLog = logger;

  const syncFilePath = getSyncBufFilePath(accountId);
  aLog.debug(`syncFilePath: ${syncFilePath}`);

  const previousGetUpdatesBuf = loadGetUpdatesBuf(syncFilePath);
  let getUpdatesBuf = previousGetUpdatesBuf ?? '';

  if (previousGetUpdatesBuf) {
    aLog.debug(`Using previous get_updates_buf (${getUpdatesBuf.length} bytes)`);
  } else {
    aLog.info(`No previous get_updates_buf found, starting fresh`);
  }

  const configLog = (msg: string) => {
    aLog.debug(msg);
  };
  const configManager = new WeixinConfigManager({ baseUrl, token, routeTag }, configLog);

  let nextTimeoutMs = longPollTimeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  let consecutiveFailures = 0;

  aLog.info(
    `Weixin monitor started: baseUrl=${baseUrl} account=${accountId} timeoutMs=${nextTimeoutMs}`,
  );

  while (!abortSignal?.aborted) {
    try {
      aLog.debug(
        `getUpdates: get_updates_buf=${getUpdatesBuf.substring(0, 50)}..., timeoutMs=${nextTimeoutMs}`,
      );
      const resp = await getUpdates({
        baseUrl,
        token,
        get_updates_buf: getUpdatesBuf,
        timeoutMs: nextTimeoutMs,
        routeTag,
      });
      aLog.debug(
        `getUpdates response: ret=${resp.ret}, msgs=${resp.msgs?.length ?? 0}, get_updates_buf_length=${resp.get_updates_buf?.length ?? 0}`,
      );

      if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
        nextTimeoutMs = resp.longpolling_timeout_ms;
        aLog.debug(`Updated next poll timeout: ${nextTimeoutMs}ms`);
      }
      const isApiError =
        (resp.ret !== undefined && resp.ret !== 0) ||
        (resp.errcode !== undefined && resp.errcode !== 0);
      if (isApiError) {
        const isSessionExpired =
          resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE;

        if (isSessionExpired) {
          pauseSession(accountId);
          const pauseMs = getRemainingPauseMs(accountId);
          aLog.error(
            `getUpdates: session expired (errcode=${resp.errcode} ret=${resp.ret}), pausing all requests for ${Math.ceil(pauseMs / 60_000)} min`,
          );
          consecutiveFailures = 0;
          await sleep(pauseMs, abortSignal);
          continue;
        }

        consecutiveFailures += 1;
        aLog.error(
          `getUpdates failed: ret=${resp.ret} errcode=${resp.errcode} errmsg=${resp.errmsg ?? ''} response=${redactBody(JSON.stringify(resp))}`,
        );
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          aLog.error(
            `getUpdates: ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off 30s`,
          );
          consecutiveFailures = 0;
          await sleep(BACKOFF_DELAY_MS, abortSignal);
        } else {
          await sleep(RETRY_DELAY_MS, abortSignal);
        }
        continue;
      }
      consecutiveFailures = 0;
      if (resp.get_updates_buf != null && resp.get_updates_buf !== '') {
        saveGetUpdatesBuf(syncFilePath, resp.get_updates_buf);
        getUpdatesBuf = resp.get_updates_buf;
        aLog.debug(`Saved new get_updates_buf (${getUpdatesBuf.length} bytes)`);
      }
      const list = resp.msgs ?? [];
      for (const full of list) {
        aLog.info(
          `inbound message: from=${full.from_user_id} types=${full.item_list?.map((i) => i.type).join(',') ?? 'none'}`,
        );

        const fromUserId = full.from_user_id ?? '';
        const cached = await configManager.getForUser(fromUserId, full.context_token);
        setWeixinTypingTicket(accountId, fromUserId, cached.typingTicket);

        await processWeixinInboundMessage(full, {
          accountId,
          account,
          config,
          bus,
          baseUrl,
          cdnBaseUrl,
          token,
          routeTag,
        });
      }
    } catch (err) {
      if (abortSignal?.aborted) {
        aLog.info(`Weixin monitor stopped (aborted)`);
        return;
      }
      consecutiveFailures += 1;
      aLog.error(`getUpdates error: ${String(err)}, stack=${(err as Error).stack ?? ''}`);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        aLog.error(
          `getUpdates: ${MAX_CONSECUTIVE_FAILURES} consecutive failures, backing off 30s`,
        );
        consecutiveFailures = 0;
        await sleep(30_000, abortSignal);
      } else {
        await sleep(2000, abortSignal);
      }
    }
  }
  aLog.info(`Weixin monitor ended`);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}
