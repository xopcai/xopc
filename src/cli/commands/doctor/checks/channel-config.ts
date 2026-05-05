import { existsSync } from 'node:fs';

import { loadConfig } from '../../../../config/loader.js';
import type { Config } from '../../../../config/schema.js';
import type { CheckResult, DoctorContext } from '../types.js';

type TelegramCfg = {
  enabled?: boolean;
  accounts?: Record<string, { botToken?: string; dmPolicy?: string; enabled?: boolean }>;
  dmPolicy?: string;
};

type WeixinCfg = {
  enabled?: boolean;
  accounts?: Record<string, unknown>;
};

function checkTelegram(cfg: Config): { ok: boolean; messages: string[]; hints: string[] } {
  const tg = cfg.channels?.telegram as TelegramCfg | undefined;
  if (!tg) {
    return { ok: true, messages: [], hints: [] };
  }

  const defaultAcc = tg.accounts?.default;
  const token = defaultAcc?.botToken?.trim() ?? '';
  const enabled = tg.enabled === true || token.length > 0;

  if (!enabled) {
    return { ok: true, messages: [], hints: [] };
  }

  const messages: string[] = [];
  const hints: string[] = [];

  if (!token) {
    messages.push('Telegram is enabled but no bot token is set.');
    hints.push('Set channels.telegram.accounts.default.botToken.');
  }

  const dm = (defaultAcc?.dmPolicy ?? tg.dmPolicy) || 'pairing';
  if (!['pairing', 'allowlist', 'open', 'disabled'].includes(dm)) {
    messages.push(`Telegram dmPolicy "${dm}" is not valid.`);
  }
  if (dm === 'open') {
    messages.push('Telegram DM policy is "open" (any user can message the bot).');
    hints.push('Consider "pairing" or "allowlist" for stricter access.');
  }

  return {
    ok: messages.length === 0,
    messages,
    hints,
  };
}

function checkWeixin(cfg: Config): { ok: boolean; messages: string[]; hints: string[] } {
  const wx = cfg.channels?.weixin as WeixinCfg | undefined;
  if (!wx || wx.enabled !== true) {
    return { ok: true, messages: [], hints: [] };
  }

  const messages: string[] = [];
  const hints: string[] = [];
  const accountKeys = wx.accounts ? Object.keys(wx.accounts).filter((k) => k.trim()) : [];
  if (accountKeys.length === 0) {
    messages.push('Weixin is enabled but no accounts are defined in config.');
    hints.push('Run: xopc channels weixin login (or add channels.weixin.accounts).');
  }

  return { ok: messages.length === 0, messages, hints };
}

export async function checkChannelConfig(ctx: DoctorContext): Promise<CheckResult> {
  if (!existsSync(ctx.configPath)) {
    return {
      id: 'channel-config',
      label: 'Channels',
      status: 'skip',
      message: 'No config file; skipped.',
      hints: [],
    };
  }

  let cfg: Config;
  try {
    cfg = loadConfig(ctx.configPath);
  } catch {
    return {
      id: 'channel-config',
      label: 'Channels',
      status: 'skip',
      message: 'Config could not be loaded; skipped.',
      hints: [],
    };
  }

  const tg = checkTelegram(cfg);
  const wx = checkWeixin(cfg);
  const allMsg = [...tg.messages, ...wx.messages];
  const allHints = [...tg.hints, ...wx.hints];

  const tgEnabled =
    (cfg.channels?.telegram as TelegramCfg | undefined)?.enabled === true ||
    Boolean((cfg.channels?.telegram as TelegramCfg | undefined)?.accounts?.default?.botToken?.trim());
  const wxOn = (cfg.channels?.weixin as WeixinCfg | undefined)?.enabled === true;
  if (!tgEnabled && !wxOn) {
    return {
      id: 'channel-config',
      label: 'Channels',
      status: 'skip',
      message: 'No channels enabled; skipped.',
      hints: [],
    };
  }

  if (allMsg.length === 0) {
    return {
      id: 'channel-config',
      label: 'Channels',
      status: 'pass',
      message: 'Enabled channel configuration looks valid.',
      hints: [],
    };
  }

  const hasFail = allMsg.some((m) => m.includes('no bot token') || m.includes('no accounts'));
  return {
    id: 'channel-config',
    label: 'Channels',
    status: hasFail ? 'fail' : 'warn',
    message: allMsg.join(' '),
    hints: allHints,
  };
}
