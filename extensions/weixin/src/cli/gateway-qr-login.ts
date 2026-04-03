/**
 * Gateway / web UI: start Weixin QR login, poll status, persist credentials (same as CLI).
 */

import type { Config } from "@xopcai/xopcbot/config/schema.js";
import { loadConfig, saveConfig } from "@xopcai/xopcbot/config/loader.js";

import {
  clearStaleAccountsForUserId,
  normalizeWeixinAccountId,
  registerWeixinAccountId,
  saveWeixinAccount,
} from "../auth/accounts.js";
import {
  DEFAULT_ILINK_BOT_TYPE,
  getWeixinActiveLoginSnapshot,
  startWeixinLoginWithQr,
  waitForWeixinLogin,
} from "../auth/login-qr.js";
import { clearContextTokensForAccount } from "../messaging/inbound.js";
import { logger } from "../util/logger.js";

import { getWeixinLoginApiContext, mergeWeixinConfigAfterLogin } from "./qr-login.js";

export type WeixinGatewayQrLoginStatus =
  | {
      phase: "polling";
      qrcodeUrl: string;
      /** Sub-state from ilink while waiting */
      qrStatus?: string;
    }
  | { phase: "done"; ok: true; accountId: string }
  | { phase: "done"; ok: false; message: string }
  | { phase: "unknown"; message: string };

type TerminalRecord =
  | { phase: "done"; ok: true; accountId: string }
  | { phase: "done"; ok: false; message: string };

const completedSessions = new Map<string, TerminalRecord>();

function rememberCompleted(sessionKey: string, state: TerminalRecord): void {
  completedSessions.set(sessionKey, state);
  setTimeout(() => completedSessions.delete(sessionKey), 10 * 60_000);
}

export function getWeixinGatewayQrLoginStatus(sessionKey: string): WeixinGatewayQrLoginStatus {
  const done = completedSessions.get(sessionKey);
  if (done) {
    if (done.ok === true) {
      return { phase: "done", ok: true, accountId: done.accountId };
    }
    return { phase: "done", ok: false, message: done.message };
  }

  const snap = getWeixinActiveLoginSnapshot(sessionKey);
  if (snap) {
    return {
      phase: "polling",
      qrcodeUrl: snap.qrcodeUrl,
      qrStatus: snap.status,
    };
  }

  return {
    phase: "unknown",
    message: "No active login for this session. Start again or the QR may have expired.",
  };
}

export type WeixinGatewayQrLoginStartOptions = {
  configPath?: string;
  account?: string;
  timeoutMs?: number;
  verbose?: boolean;
  /** After credentials + config file are written (or login failed after wait). */
  onPersisted?: (r: { ok: boolean; accountId?: string; message: string }) => void | Promise<void>;
};

/**
 * Begin QR login and wait in the background; poll with {@link getWeixinGatewayQrLoginStatus}.
 */
export async function startWeixinGatewayQrLogin(
  opts: WeixinGatewayQrLoginStartOptions,
): Promise<{ ok: true; sessionKey: string; qrcodeUrl: string } | { ok: false; message: string }> {
  const configPath = opts.configPath ?? process.env.XOPCBOT_CONFIG_PATH;
  const cfg = loadConfig(configPath);
  const { baseUrl, routeTag } = getWeixinLoginApiContext(cfg, opts.account);
  const timeoutMs = opts.timeoutMs ?? 480_000;
  const verbose = Boolean(opts.verbose);

  const startResult = await startWeixinLoginWithQr({
    accountId: opts.account?.trim() || undefined,
    apiBaseUrl: baseUrl,
    botType: DEFAULT_ILINK_BOT_TYPE,
    routeTag,
    verbose,
  });

  if (!startResult.qrcodeUrl) {
    return { ok: false, message: startResult.message || "Failed to get QR code" };
  }

  const sessionKey = startResult.sessionKey;

  void (async () => {
    const waitResult = await waitForWeixinLogin({
      sessionKey,
      apiBaseUrl: baseUrl,
      timeoutMs,
      verbose,
      routeTag,
      botType: DEFAULT_ILINK_BOT_TYPE,
      silent: true,
    });

    if (!waitResult.connected || !waitResult.botToken || !waitResult.accountId) {
      const message = waitResult.message || "Login did not complete";
      rememberCompleted(sessionKey, { phase: "done", ok: false, message });
      await opts.onPersisted?.({ ok: false, message });
      return;
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
      const message = `Saved login failed: ${String(err)}`;
      logger.error(message);
      rememberCompleted(sessionKey, { phase: "done", ok: false, message });
      await opts.onPersisted?.({ ok: false, message });
      return;
    }

    try {
      const nextCfg = mergeWeixinConfigAfterLogin(cfg as Config, normalizedId);
      await saveConfig(nextCfg, configPath);
    } catch (err) {
      logger.warn(`Config merge failed (credentials saved on disk): ${String(err)}`);
    }

    await opts.onPersisted?.({ ok: true, accountId: normalizedId, message: "OK" });
    rememberCompleted(sessionKey, { phase: "done", ok: true, accountId: normalizedId });
  })();

  return { ok: true, sessionKey, qrcodeUrl: startResult.qrcodeUrl };
}
