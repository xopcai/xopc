import type { Config } from '@xopcai/xopc/config/index.js';
import type { ChannelDoctorCheckResult } from '@xopcai/xopc/channels/plugin-types.js';
import { hasTelegramBotEndpointApiRoot, normalizeTelegramApiRoot } from './api-root.js';
import { resolveTelegramBotToken } from './token-resolver.js';

type TelegramCfg = {
  enabled?: boolean;
  dmPolicy?: string;
  allowFrom?: Array<string | number>;
  apiRoot?: string;
  accounts?: Record<
    string,
    {
      botToken?: string;
      tokenFile?: string;
      apiRoot?: string;
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

export async function runTelegramDoctorChecks(params: {
  cfg: Config;
}): Promise<ChannelDoctorCheckResult[]> {
  const results: ChannelDoctorCheckResult[] = [];
  const tg = params.cfg.channels?.telegram as TelegramCfg | undefined;
  if (!tg) {
    return results;
  }

  if (tg.enabled && tg.dmPolicy === 'open') {
    const allow = tg.allowFrom ?? [];
    const hasWildcard = allow.some((e) => String(e).trim() === '*');
    results.push({
      id: 'telegram-dm-open-wildcard',
      label: 'Telegram DM open policy',
      status: hasWildcard ? 'pass' : 'warn',
      message: hasWildcard
        ? 'DM policy is open with allowFrom wildcard.'
        : 'dmPolicy "open" should include allowFrom: ["*"] for explicit opt-in.',
      hints: hasWildcard ? [] : ['Add `"allowFrom": ["*"]` or switch to pairing/allowlist.'],
    });
  }

  if (hasTelegramBotEndpointApiRoot(tg.apiRoot)) {
    results.push({
      id: 'telegram-api-root-bot-endpoint',
      label: 'Telegram apiRoot',
      status: 'warn',
      message: 'apiRoot includes a bot token path segment; it will be normalized to the API root.',
      hints: [`Use "${normalizeTelegramApiRoot(tg.apiRoot)}" instead.`],
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
  }

  return results;
}
