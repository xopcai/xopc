import { normalizeSessionFilters, type SessionFilters } from './session-discovery-state';

export interface SavedSessionView {
  id: string;
  name: string;
  filters: SessionFilters;
  search: string;
}

const storageKey = (gateway: string) => `xopc-session-views-v1:${gateway}`;

export function readSavedSessionViews(gateway: string): SavedSessionView[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(storageKey(gateway)) ?? '[]');
    if (!Array.isArray(rows)) return [];
    return rows.filter((row) => row && typeof row.id === 'string' && typeof row.name === 'string' && row.name.trim())
      .slice(0, 20).map((row) => ({
        id: row.id, name: row.name.slice(0, 60), filters: normalizeSessionFilters(row.filters ?? {}), search: typeof row.search === 'string' ? row.search.slice(0, 500) : '',
      }));
  } catch { return []; }
}

export function writeSavedSessionViews(gateway: string, views: SavedSessionView[]): boolean {
  try { localStorage.setItem(storageKey(gateway), JSON.stringify(views)); return true; }
  catch { return false; }
}
