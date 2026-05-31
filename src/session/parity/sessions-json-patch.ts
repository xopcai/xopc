import type { XopcSessionDiskEntry } from './xopc-session-disk-entry.js';

export type SessionsJsonStatsPatch = {
  messageCount: number;
  estimatedTokens: number;
  lastTurnAt: number;
};

export function buildSessionsJsonStatsPatch(
  messageCount: number,
  estimatedTokens: number,
): SessionsJsonStatsPatch {
  const now = Date.now();
  return {
    messageCount,
    estimatedTokens,
    lastTurnAt: now,
  };
}

/** Apply stats + timestamps to a single sessions.json entry (in-memory patch). */
export function patchSessionsJsonEntryStats(
  entry: XopcSessionDiskEntry,
  stats: SessionsJsonStatsPatch,
): void {
  if (!entry.pluginExtensions?.xopc?.metadata) {
    return;
  }
  const meta = entry.pluginExtensions.xopc.metadata;
  meta.messageCount = stats.messageCount;
  meta.estimatedTokens = stats.estimatedTokens;
  meta.updatedAt = new Date().toISOString();
  meta.lastAccessedAt = meta.updatedAt;
  meta.stats = {
    messageCount: stats.messageCount,
    tokenCount: stats.estimatedTokens,
    lastTurnAt: stats.lastTurnAt,
  };
  entry.updatedAt = stats.lastTurnAt;
}

export function isAppendOnlyLlmTranscriptMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }
  const role = (message as { role?: string }).role;
  return role === 'user' || role === 'assistant' || role === 'tool' || role === 'toolResult';
}

/** Increment stats for a single appended LLM row (hot path). */
export function incrementSessionsJsonStatsForAppend(
  entry: XopcSessionDiskEntry,
  opts?: { tokenDelta?: number },
): void {
  if (!entry.pluginExtensions?.xopc?.metadata) {
    return;
  }
  const meta = entry.pluginExtensions.xopc.metadata;
  const nextCount = (meta.messageCount ?? 0) + 1;
  const tokenDelta = opts?.tokenDelta ?? 0;
  const nextTokens = (meta.estimatedTokens ?? 0) + tokenDelta;
  patchSessionsJsonEntryStats(entry, buildSessionsJsonStatsPatch(nextCount, nextTokens));
}
