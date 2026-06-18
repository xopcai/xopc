import type { SessionMetadata } from '../session/types.js';
import type { TuiSessionItem } from './tui-backend.js';

function homeDir(): string | undefined {
  return process.env.HOME || process.env.USERPROFILE;
}

export function shortenSessionPath(path: string): string {
  const home = homeDir();
  if (home && path.startsWith(home)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

/** Compact relative time for session picker rows (pi-style). */
export function formatSessionAge(updatedAtMs: number | null | undefined): string {
  if (updatedAtMs == null || !Number.isFinite(updatedAtMs)) return '';
  const diffMs = Date.now() - updatedAtMs;
  if (diffMs < 60_000) return 'now';
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMs / 3_600_000);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays < 7) return `${diffDays}d`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`;
  return `${Math.floor(diffDays / 365)}y`;
}

export function sessionMetadataToTuiItem(meta: SessionMetadata): TuiSessionItem {
  const cd = meta.customData;
  const modelRef =
    typeof cd?.model === 'string'
      ? cd.model
      : typeof cd?.modelRef === 'string'
        ? cd.modelRef
        : null;
  return {
    key: meta.key,
    displayName: meta.name,
    updatedAt: Date.parse(meta.updatedAt),
    totalTokens: meta.estimatedTokens ?? null,
    messageCount: meta.messageCount,
    model: modelRef,
    forkedFromSessionKey:
      typeof cd?.forkedFromSessionKey === 'string' ? cd.forkedFromSessionKey : undefined,
    cwd: meta.cwd,
  };
}

export function formatSessionPickerDescription(
  session: TuiSessionItem,
  options: { showKey?: boolean } = {},
): string {
  const parts: string[] = [];
  const age = formatSessionAge(session.updatedAt ?? null);
  if (age) parts.push(age);
  if (session.messageCount != null) parts.push(`${session.messageCount} msgs`);
  if (session.totalTokens != null) parts.push(`${session.totalTokens} tok`);
  if (session.model) parts.push(String(session.model));
  if (options.showKey) {
    if (session.cwd) parts.push(shortenSessionPath(session.cwd));
    parts.push(session.key);
  }
  return parts.join(' · ');
}
