/**
 * CLI: Weixin QR login — start poll, show terminal QR, persist token + optional config merge.
 */

import type { Config } from '@xopcai/xopcbot/config/schema.js';
import { ConfigSchema } from '@xopcai/xopcbot/config/schema.js';
import { loadConfig, saveConfig } from '@xopcai/xopcbot/config/loader.js';

import {
  clearStaleAccountsForUserId,
  normalizeWeixinAccountId,
  registerWeixinAccountId,
  resolveWeixinAccount,
  saveWeixinAccount,
  DEFAULT_BASE_URL,
} from '../auth/accounts.js';
import { clearContextTokensForAccount } from '../messaging/inbound.js';
import {
  DEFAULT_ILINK_BOT_TYPE,
  startWeixinLoginWithQr,
  waitForWeixinLogin,
} from '../auth/login-qr.js';
import { logger } from '../util/logger.js';

export type WeixinQrLoginCliOptions = {
  /** Config file path (same as CLI --config / XOPCBOT_CONFIG). */
  configPath?: string;
  verbose?: boolean;
  /** Client wait for scan (ms). */
  timeoutMs?: number;
  /** Existing account id to re-login, or omit for a new account session. */
  account?: string;
  /** When true, merge `channels.weixin.enabled` and accounts entry after success. */
  writeConfig?: boolean;
};

function getLoginApiContext(cfg: Config, accountHint?: string): { baseUrl: string; routeTag?: string } {
  const section = cfg.channels?.weixin as { routeTag?: string | number } | undefined;
  const routeTagRaw = section?.routeTag;
  const sectionRouteTag =
    typeof routeTagRaw === 'number'
      ? String(routeTagRaw)
      : typeof routeTagRaw === 'string' && routeTagRaw.trim()
        ? routeTagRaw.trim()
        : undefined;

  if (accountHint?.trim()) {
    try {
      const r = resolveWeixinAccount(cfg, accountHint);
      return { baseUrl: r.baseUrl, routeTag: r.routeTag ?? sectionRouteTag };
    } catch {
      // ignore
    }
  }
  return { baseUrl: DEFAULT_BASE_URL, routeTag: sectionRouteTag };
}

function mergeWeixinConfigAfterLogin(cfg: Config, normalizedAccountId: string): Config {
  const prev = cfg.channels?.weixin as Record<string, unknown> | undefined;
  const prevAccounts = (prev?.accounts as Record<string, Record<string, unknown>> | undefined) ?? {};
  const merged = {
    ...cfg,
    channels: {
      ...cfg.channels,
      weixin: {
        ...(prev ?? {}),
        enabled: true,
        accounts: {
          ...prevAccounts,
          [normalizedAccountId]: {
            ...(prevAccounts[normalizedAccountId] ?? {}),
            enabled: true,
          },
        },
      },
    },
  };
  return ConfigSchema.parse(merged);
}

/**
 * Run interactive Weixin QR login (terminal QR + long-poll until confirmed or timeout).
 */
export async function runWeixinQrLoginCli(opts: WeixinQrLoginCliOptions): Promise<{
  ok: boolean;
  accountId?: string;
  message: string;
}> {
  const configPath = opts.configPath ?? process.env.XOPCBOT_CONFIG_PATH;
  const cfg = loadConfig(configPath);
  const { baseUrl, routeTag } = getLoginApiContext(cfg, opts.account);
  const timeoutMs = opts.timeoutMs ?? 480_000;
  const verbose = Boolean(opts.verbose);

  console.log('\n🔐 Weixin QR login');
  console.log(`   API base: ${baseUrl}\n`);

  const startResult = await startWeixinLoginWithQr({
    accountId: opts.account?.trim() || undefined,
    apiBaseUrl: baseUrl,
    botType: DEFAULT_ILINK_BOT_TYPE,
    routeTag,
    verbose,
  });

  if (!startResult.qrcodeUrl) {
    return { ok: false, message: startResult.message || 'Failed to get QR code' };
  }

  console.log('Scan this QR code with WeChat:\n');
  try {
    const qrcodeTerminal = await import('qrcode-terminal');
    await new Promise<void>((resolve) => {
      qrcodeTerminal.default.generate(startResult.qrcodeUrl!, { small: true }, (qr: string) => {
        console.log(qr);
        resolve();
      });
    });
  } catch {
    console.log('Open this URL in a browser to scan:\n');
    console.log(startResult.qrcodeUrl);
  }
  console.log('\nWaiting for confirmation...\n');

  const waitResult = await waitForWeixinLogin({
    sessionKey: startResult.sessionKey,
    apiBaseUrl: baseUrl,
    timeoutMs,
    verbose,
    routeTag,
    botType: DEFAULT_ILINK_BOT_TYPE,
  });

  if (!waitResult.connected || !waitResult.botToken || !waitResult.accountId) {
    return {
      ok: false,
      message: waitResult.message || 'Login did not complete',
    };
  }

  const normalizedId = normalizeWeixinAccountId(waitResult.accountId);

  try {
    saveWeixinAccount(normalizedId, {
      token: waitResult.botToken,
      baseUrl: waitResult.baseUrl?.trim() || baseUrl,
      userId: waitResult.userId,
    });
    registerWeixinAccountId(normalizedId);
    if (waitResult.userId) {
      clearStaleAccountsForUserId(normalizedId, waitResult.userId, clearContextTokensForAccount);
    }
  } catch (err) {
    logger.error(`Failed to save Weixin account: ${String(err)}`);
    return { ok: false, message: `Saved login failed: ${String(err)}` };
  }

  if (opts.writeConfig !== false) {
    try {
      const next = mergeWeixinConfigAfterLogin(cfg, normalizedId);
      await saveConfig(next, configPath);
    } catch (err) {
      logger.warn(`Config merge failed (credentials saved on disk): ${String(err)}`);
    }
  }

  console.log(`\n✅ Weixin connected as account "${normalizedId}".`);
  console.log('   Restart the gateway if it is already running.\n');

  return { ok: true, accountId: normalizedId, message: 'OK' };
}
