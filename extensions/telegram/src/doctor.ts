import type { Config } from '@xopcai/xopc/config/index.js';
import type { ChannelDoctorCheckResult } from '@xopcai/xopc/channels/plugin-types.js';
import { hasTelegramBotEndpointApiRoot, normalizeTelegramApiRoot } from './api-root.js';
import { createProxyFetch } from './proxy-fetch.js';
import { isTelegramUnauthorizedTokenError } from './startup-errors.js';
import { resolveTelegramBotToken } from './token-resolver.js';

const TELEGRAM_DOCTOR_GETME_TIMEOUT_MS = 10_000;

type TelegramCfg = {
  enabled?: boolean;
  defaults?: {
    dmPolicy?: string;
    apiRoot?: string;
    proxy?: string;
  };
  accounts?: Record<
    string,
    {
      enabled?: boolean;
      botToken?: string;
      tokenFile?: string;
      apiRoot?: string;
      proxy?: string;
      dmPolicy?: string;
      allowFrom?: Array<string | number>;
    }
  >;
};

function collectTokens(cfg: TelegramCfg): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const accounts = cfg.accounts ?? {};
  for (const [id, acc] of Object.entries(accounts)) {
    const { token } = resolveTelegramBotToken({
      botToken: acc.botToken,
      tokenFile: acc.tokenFile,
    });
    if (!token) continue;
    const list = map.get(token) ?? [];
    list.push(id);
    map.set(token, list);
  }
  return map;
}

function formatGetMeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  };
}

async function checkGetMe(params: {
  accountId: string;
  token: string;
  apiRoot?: string;
  proxy?: string;
  fetchImpl?: typeof fetch;
}): Promise<ChannelDoctorCheckResult> {
  const apiRoot = normalizeTelegramApiRoot(params.apiRoot);
  const url = `${apiRoot}/bot${params.token}/getMe`;
  const timeout = createTimeoutSignal(TELEGRAM_DOCTOR_GETME_TIMEOUT_MS);
  const fetchImpl = params.proxy ? createProxyFetch(params.proxy) : (params.fetchImpl ?? fetch);

  try {
    const startedAt = Date.now();
    const response = await fetchImpl(url, { signal: timeout.signal });
    const elapsedMs = Date.now() - startedAt;
    const body = (await response.json().catch(() => undefined)) as
      | { ok?: boolean; result?: { username?: string }; description?: string }
      | undefined;

    if (response.ok && body?.ok === true) {
      const username = body.result?.username ? ` @${body.result.username}` : '';
      return {
        id: `telegram-account-getme-${params.accountId}`,
        label: `Telegram getMe (${params.accountId})`,
        status: 'pass',
        message: `getMe succeeded${username} in ${elapsedMs}ms.`,
        hints: params.proxy ? [`Using proxy: ${params.proxy}`] : [],
      };
    }

    const description = body?.description || `HTTP ${response.status}`;
    return {
      id: `telegram-account-getme-${params.accountId}`,
      label: `Telegram getMe (${params.accountId})`,
      status: isTelegramUnauthorizedTokenError(description) ? 'fail' : 'warn',
      message: `getMe failed: ${description}`,
      hints: isTelegramUnauthorizedTokenError(description)
        ? ['Verify the bot token from @BotFather.']
        : ['Check channels.telegram.defaults.apiRoot / account apiRoot and network access.'],
    };
  } catch (err) {
    const message = formatGetMeError(err);
    return {
      id: `telegram-account-getme-${params.accountId}`,
      label: `Telegram getMe (${params.accountId})`,
      status: 'fail',
      message: `getMe network check failed: ${message}`,
      hints: [
        'Verify this host can reach the Telegram Bot API.',
        'If your shell uses HTTP(S)_PROXY, also set channels.telegram.defaults.proxy because Node fetch does not use env proxy automatically.',
        `Effective apiRoot: ${apiRoot}`,
      ],
    };
  } finally {
    timeout.dispose();
  }
}

export async function runTelegramDoctorChecks(params: {
  cfg: Config;
  fetchImpl?: typeof fetch;
}): Promise<ChannelDoctorCheckResult[]> {
  const results: ChannelDoctorCheckResult[] = [];
  const tg = params.cfg.channels?.telegram as TelegramCfg | undefined;
  if (!tg) {
    return results;
  }

  if (hasTelegramBotEndpointApiRoot(tg.defaults?.apiRoot)) {
    results.push({
      id: 'telegram-api-root-bot-endpoint',
      label: 'Telegram apiRoot',
      status: 'warn',
      message: 'apiRoot includes a bot token path segment; it will be normalized to the API root.',
      hints: [`Use "${normalizeTelegramApiRoot(tg.defaults?.apiRoot)}" instead.`],
    });
  }

  const tokenMap = collectTokens(tg);
  for (const [token, accountIds] of tokenMap) {
    if (accountIds.length > 1) {
      results.push({
        id: `telegram-duplicate-token-${accountIds.join('-')}`,
        label: 'Telegram duplicate bot token',
        status: 'fail',
        message: `Bot token is shared by accounts: ${accountIds.join(', ')}.`,
        hints: ['Use one token per account or disable duplicate accounts.'],
      });
    }
    void token;
  }

  for (const [id, acc] of Object.entries(tg.accounts ?? {})) {
    const effectiveDmPolicy = acc.dmPolicy ?? tg.defaults?.dmPolicy ?? 'pairing';
    if (tg.enabled && effectiveDmPolicy === 'open') {
      const allow = acc.allowFrom ?? [];
      const hasWildcard = allow.some((e) => String(e).trim() === '*');
      results.push({
        id: `telegram-dm-open-wildcard-${id}`,
        label: `Telegram DM open policy (${id})`,
        status: hasWildcard ? 'pass' : 'warn',
        message: hasWildcard
          ? `Account "${id}" DM policy is open with allowFrom wildcard.`
          : `Account "${id}" dmPolicy "open" should include allowFrom: ["*"] for explicit opt-in.`,
        hints: hasWildcard ? [] : [`Add "allowFrom": ["*"] to channels.telegram.accounts.${id} or switch to pairing/allowlist.`],
      });
    }
    if (hasTelegramBotEndpointApiRoot(acc.apiRoot)) {
      results.push({
        id: `telegram-account-api-root-${id}`,
        label: `Telegram apiRoot (${id})`,
        status: 'warn',
        message: `Account "${id}" apiRoot includes bot endpoint; will be normalized.`,
        hints: [`Use "${normalizeTelegramApiRoot(acc.apiRoot)}"`],
      });
    }
    const { token, source } = resolveTelegramBotToken({
      botToken: acc.botToken,
      tokenFile: acc.tokenFile,
    });
    if (tg.enabled && acc && source === 'none' && (acc as { enabled?: boolean }).enabled !== false) {
      results.push({
        id: `telegram-account-token-${id}`,
        label: `Telegram token (${id})`,
        status: 'fail',
        message: `Account "${id}" has no bot token or readable tokenFile.`,
        hints: ['Set botToken or tokenFile in channels.telegram.accounts.' + id],
      });
    }
    if (token && token.length < 20) {
      results.push({
        id: `telegram-account-token-short-${id}`,
        label: `Telegram token (${id})`,
        status: 'warn',
        message: `Account "${id}" bot token looks too short.`,
        hints: ['Verify the token from @BotFather.'],
      });
    }

    if (tg.enabled && token && acc.enabled !== false) {
      results.push(
        await checkGetMe({
          accountId: id,
          token,
          apiRoot: acc.apiRoot || tg.defaults?.apiRoot,
          proxy: acc.proxy || tg.defaults?.proxy,
          fetchImpl: params.fetchImpl,
        }),
      );
    }
  }

  return results;
}
