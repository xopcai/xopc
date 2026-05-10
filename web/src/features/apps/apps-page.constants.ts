export type AppsMainTab = 'marketplace' | 'builtin' | 'user';

export function parseAppsMainTab(raw: string | null): AppsMainTab {
  if (raw === 'builtin' || raw === 'user') return raw;
  return 'marketplace';
}
