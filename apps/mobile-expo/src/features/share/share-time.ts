/**
 * Pure helpers for share-related time rendering.
 *
 * Kept here (not inside React components) so it can be unit-tested without
 * pulling in react-native. The templater is inlined for the same reason —
 * importing from i18n/messages transitively pulls react-native into the
 * vitest module graph and Rolldown fails to parse it.
 */

export type ShareTimeMessages = {
  timeJustNow: string;
  timeMinutes: string;
  timeHours: string;
  timeDays: string;
};

function fill(template: string, n: number): string {
  return template.replace(/\{\{n\}\}/g, String(n));
}

/** Best-effort relative duration: "5m" / "3h" / "2d" / "a moment". */
export function formatRelativeDuration(deltaMs: number, m: ShareTimeMessages): string {
  const abs = Math.abs(deltaMs);
  if (abs < 60_000) return m.timeJustNow;
  const minutes = Math.floor(abs / 60_000);
  if (minutes < 60) return fill(m.timeMinutes, minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return fill(m.timeHours, hours);
  const days = Math.floor(hours / 24);
  return fill(m.timeDays, days);
}

/** Status derived from a ShareListItem-like record. */
export type ShareStatus = 'active' | 'expired' | 'revoked';

export function shareStatus(record: { revoked: boolean; expired: boolean }): ShareStatus {
  if (record.revoked) return 'revoked';
  if (record.expired) return 'expired';
  return 'active';
}
