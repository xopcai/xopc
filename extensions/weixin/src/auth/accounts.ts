import fs from 'node:fs';
import path from 'node:path';

import type { Config } from '@xopcai/xopcbot/config/schema.js';
import { resolveStateDir as resolveXopcbotStateDir } from '@xopcai/xopcbot/config/paths.js';

import { clearContextTokensForAccount } from '../messaging/inbound.js';
import { resolveWeixinRootDir } from '../storage/state-dir.js';
import { logger } from '../util/logger.js';

export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';

export function normalizeWeixinAccountId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/@/g, '-')
    .replace(/\./g, '-')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function deriveRawAccountId(normalizedId: string): string | undefined {
  if (normalizedId.endsWith('-im-bot')) {
    return `${normalizedId.slice(0, -7)}@im.bot`;
  }
  if (normalizedId.endsWith('-im-wechat')) {
    return `${normalizedId.slice(0, -10)}@im.wechat`;
  }
  return undefined;
}

function resolveWeixinStateDir(): string {
  return resolveWeixinRootDir();
}

function resolveAccountIndexPath(): string {
  return path.join(resolveWeixinStateDir(), 'accounts.json');
}

export function listIndexedWeixinAccountIds(): string[] {
  const filePath = resolveAccountIndexPath();
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.trim() !== '');
  } catch {
    return [];
  }
}

export function registerWeixinAccountId(accountId: string): void {
  const dir = resolveWeixinStateDir();
  fs.mkdirSync(dir, { recursive: true });

  const existing = listIndexedWeixinAccountIds();
  if (existing.includes(accountId)) return;

  const updated = [...existing, accountId];
  fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify(updated, null, 2), 'utf-8');
}

export function unregisterWeixinAccountId(accountId: string): void {
  const existing = listIndexedWeixinAccountIds();
  const updated = existing.filter((id) => id !== accountId);
  if (updated.length !== existing.length) {
    fs.writeFileSync(resolveAccountIndexPath(), JSON.stringify(updated, null, 2), 'utf-8');
  }
}

export function clearStaleAccountsForUserId(
  currentAccountId: string,
  userId: string,
  onClearContextTokens?: (accountId: string) => void,
): void {
  if (!userId) return;
  const allIds = listIndexedWeixinAccountIds();
  for (const id of allIds) {
    if (id === currentAccountId) continue;
    const data = loadWeixinAccount(id);
    if (data?.userId?.trim() === userId) {
      logger.info(`clearStaleAccountsForUserId: removing stale account=${id} (same userId=${userId})`);
      onClearContextTokens?.(id);
      clearWeixinAccount(id);
      unregisterWeixinAccountId(id);
    }
  }
}

export type WeixinAccountData = {
  token?: string;
  savedAt?: string;
  baseUrl?: string;
  userId?: string;
};

function resolveAccountsDir(): string {
  return path.join(resolveWeixinStateDir(), 'accounts');
}

function resolveAccountPath(accountId: string): string {
  return path.join(resolveAccountsDir(), `${accountId}.json`);
}

function readAccountFile(filePath: string): WeixinAccountData | null {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as WeixinAccountData;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Legacy single-file token: `~/.xopcbot/credentials/openclaw-weixin/credentials.json`
 * (same layout as OpenClaw / openclaw-weixin before per-account files).
 */
function loadLegacyOpenclawWeixinToken(): string | undefined {
  const legacyPath = path.join(
    resolveXopcbotStateDir(),
    'credentials',
    'openclaw-weixin',
    'credentials.json',
  );
  try {
    if (!fs.existsSync(legacyPath)) return undefined;
    const raw = fs.readFileSync(legacyPath, 'utf-8');
    const parsed = JSON.parse(raw) as { token?: string };
    return typeof parsed.token === 'string' ? parsed.token : undefined;
  } catch {
    return undefined;
  }
}

export function loadWeixinAccount(accountId: string): WeixinAccountData | null {
  const primary = readAccountFile(resolveAccountPath(accountId));
  if (primary) return primary;

  const rawId = deriveRawAccountId(accountId);
  if (rawId) {
    const compat = readAccountFile(resolveAccountPath(rawId));
    if (compat) return compat;
  }

  const legacyToken = loadLegacyOpenclawWeixinToken();
  if (legacyToken) return { token: legacyToken };

  return null;
}

export function saveWeixinAccount(
  accountId: string,
  update: { token?: string; baseUrl?: string; userId?: string },
): void {
  const dir = resolveAccountsDir();
  fs.mkdirSync(dir, { recursive: true });

  const existing = loadWeixinAccount(accountId) ?? {};

  const token = update.token?.trim() || existing.token;
  const baseUrl = update.baseUrl?.trim() || existing.baseUrl;
  const userId =
    update.userId !== undefined ? update.userId.trim() || undefined : existing.userId?.trim() || undefined;

  const data: WeixinAccountData = {
    ...(token ? { token, savedAt: new Date().toISOString() } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(userId ? { userId } : {}),
  };

  const filePath = resolveAccountPath(accountId);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

export function clearWeixinAccount(accountId: string): void {
  const dir = resolveAccountsDir();
  const accountFiles = [
    `${accountId}.json`,
    `${accountId}.sync.json`,
    `${accountId}.context-tokens.json`,
  ];
  for (const file of accountFiles) {
    try {
      fs.unlinkSync(path.join(dir, file));
    } catch {
      // ignore
    }
  }
  try {
    fs.unlinkSync(resolveFrameworkAllowFromPath(accountId));
  } catch {
    // ignore
  }
}

export type ResolvedWeixinAccount = {
  accountId: string;
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  dmPolicy: 'pairing' | 'allowlist' | 'open' | 'disabled';
  allowFrom: string[];
  streamMode?: 'off' | 'partial' | 'block';
  routeTag?: string;
  debug?: boolean;
};

type WeixinAccountCfg = {
  name?: string;
  enabled?: boolean;
  cdnBaseUrl?: string;
  routeTag?: number | string;
  dmPolicy?: ResolvedWeixinAccount['dmPolicy'];
  allowFrom?: string[];
  streamMode?: ResolvedWeixinAccount['streamMode'];
  debug?: boolean;
  accounts?: Record<string, WeixinAccountCfg>;
};

function weixinSection(cfg: Config): (WeixinAccountCfg & { accounts?: Record<string, WeixinAccountCfg> }) | undefined {
  return cfg.channels?.weixin as
    | (WeixinAccountCfg & { accounts?: Record<string, WeixinAccountCfg> })
    | undefined;
}

export function listWeixinAccountIds(cfg: Config): string[] {
  const section = weixinSection(cfg);
  const fromConfig = section?.accounts ? Object.keys(section.accounts) : [];
  const indexed = listIndexedWeixinAccountIds();
  return [...new Set([...indexed, ...fromConfig])];
}

export function resolveWeixinAccount(cfg: Config, accountId?: string | null): ResolvedWeixinAccount {
  const raw = accountId?.trim();
  if (!raw) {
    throw new Error('weixin: accountId is required');
  }
  const id = normalizeWeixinAccountId(raw);
  const section = weixinSection(cfg);
  const fromAccount = section?.accounts?.[id];
  const { accounts: _omit, ...sectionRest } = section ?? {};
  void _omit;
  const accountCfg: WeixinAccountCfg = {
    ...sectionRest,
    ...(fromAccount ?? {}),
  };

  const accountData = loadWeixinAccount(id);
  const token = accountData?.token?.trim() || undefined;
  const stateBaseUrl = accountData?.baseUrl?.trim() || '';

  const routeTagRaw = accountCfg.routeTag;
  const routeTag =
    typeof routeTagRaw === 'number'
      ? String(routeTagRaw)
      : typeof routeTagRaw === 'string' && routeTagRaw.trim()
        ? routeTagRaw.trim()
        : undefined;

  return {
    accountId: id,
    baseUrl: stateBaseUrl || DEFAULT_BASE_URL,
    cdnBaseUrl: accountCfg.cdnBaseUrl?.trim() || CDN_BASE_URL,
    token,
    enabled: accountCfg.enabled !== false,
    configured: Boolean(token),
    name: accountCfg.name?.trim() || undefined,
    dmPolicy: accountCfg.dmPolicy ?? 'pairing',
    allowFrom: accountCfg.allowFrom ?? [],
    streamMode: accountCfg.streamMode,
    routeTag,
    debug: accountCfg.debug ?? false,
  };
}

export function resolveFrameworkAllowFromPath(accountId: string): string {
  const base = 'xopcbot-weixin'.replace(/[\\/:*?"<>|]/g, '_');
  const safeAccount = accountId.trim().toLowerCase().replace(/[\\/:*?"<>|]/g, '_').replace(/\.\./g, '_');
  const { join } = path;
  const credRoot = process.env.XOPCBOT_CREDENTIALS_DIR?.trim()
    ? process.env.XOPCBOT_CREDENTIALS_DIR!
    : join(resolveWeixinRootDir(), 'credentials');
  return join(credRoot, `${base}-${safeAccount}-allowFrom.json`);
}
