import type { SessionMessagePage } from '../../query/sessions';
import { storage } from '../../storage/mmkv';

const STORAGE_KEY = 'xopc.chat.recentSessionHistoryHead:v1';

type CachedSessionHistoryHead = {
  v: 1;
  sessionKey: string;
  cachedAt: number;
  page: SessionMessagePage;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSessionMessagePage(value: unknown): value is SessionMessagePage {
  if (!isRecord(value)) return false;
  if (!isRecord(value.session)) return false;
  if (typeof value.session.key !== 'string' || !Array.isArray(value.session.messages)) return false;
  if (!isRecord(value.pagination)) return false;
  return typeof value.pagination.limit === 'number'
    && typeof value.pagination.hasMore === 'boolean';
}

export function readCachedSessionHistoryHead(sessionKey: string): SessionMessagePage | null {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey) return null;

  try {
    const raw = storage.getString(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.v !== 1 || parsed.sessionKey !== normalizedSessionKey) return null;
    if (!isSessionMessagePage(parsed.page)) return null;
    if (parsed.page.session.key !== normalizedSessionKey) return null;
    return parsed.page;
  } catch {
    return null;
  }
}

export function writeCachedSessionHistoryHead(sessionKey: string, page: SessionMessagePage | null): void {
  const normalizedSessionKey = sessionKey.trim();
  if (!normalizedSessionKey || !isSessionMessagePage(page)) return;
  if (page.session.key !== normalizedSessionKey) return;

  const snapshot: CachedSessionHistoryHead = {
    v: 1,
    sessionKey: normalizedSessionKey,
    cachedAt: Date.now(),
    page,
  };

  try {
    storage.set(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* ignore quota */
  }
}
