import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStateDir } from '@xopcai/xopc/config/paths.js';

const STORE_VERSION = 2;

type TelegramUpdateOffsetState = {
  version: number;
  lastUpdateId: number | null;
  botId: string | null;
};

function normalizeAccountId(accountId?: string): string {
  const trimmed = accountId?.trim();
  if (!trimmed) return 'default';
  return trimmed.replace(/[^a-z0-9._-]+/gi, '_');
}

function resolveOffsetPath(accountId?: string): string {
  const stateDir = resolveStateDir();
  const dir = join(stateDir, 'telegram');
  mkdirSync(dir, { recursive: true });
  return join(dir, `update-offset-${normalizeAccountId(accountId)}.json`);
}

function extractBotIdFromToken(token?: string): string | null {
  const trimmed = token?.trim();
  if (!trimmed) return null;
  const [rawBotId] = trimmed.split(':', 1);
  if (!rawBotId || !/^\d+$/.test(rawBotId)) return null;
  return rawBotId;
}

function safeParseState(raw: string): TelegramUpdateOffsetState | null {
  try {
    const parsed = JSON.parse(raw) as {
      version?: number;
      lastUpdateId?: number | null;
      botId?: string | null;
    };
    if (parsed?.version !== STORE_VERSION && parsed?.version !== 1) return null;
    if (parsed.lastUpdateId != null && (!Number.isSafeInteger(parsed.lastUpdateId) || parsed.lastUpdateId < 0)) {
      return null;
    }
    return {
      version: STORE_VERSION,
      lastUpdateId: parsed.lastUpdateId ?? null,
      botId: parsed.version === STORE_VERSION ? (parsed.botId ?? null) : null,
    };
  } catch {
    return null;
  }
}

export function readTelegramUpdateOffset(params: {
  accountId?: string;
  botToken?: string;
}): number | undefined {
  const path = resolveOffsetPath(params.accountId);
  try {
    const raw = readFileSync(path, 'utf8');
    const state = safeParseState(raw);
    if (!state || state.lastUpdateId == null) return undefined;
    const botId = extractBotIdFromToken(params.botToken);
    if (state.botId && botId && state.botId !== botId) return undefined;
    return state.lastUpdateId;
  } catch {
    return undefined;
  }
}

export function writeTelegramUpdateOffset(params: {
  accountId?: string;
  botToken?: string;
  lastUpdateId: number;
}): void {
  if (!Number.isSafeInteger(params.lastUpdateId) || params.lastUpdateId < 0) return;
  const path = resolveOffsetPath(params.accountId);
  const tmp = `${path}.tmp`;
  const state: TelegramUpdateOffsetState = {
    version: STORE_VERSION,
    lastUpdateId: params.lastUpdateId,
    botId: extractBotIdFromToken(params.botToken),
  };
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  renameSync(tmp, path);
}
