import { SESSION_PURPOSES, SessionDiscoveryQuerySchema, type SessionListQuery, type SessionPurpose, type SessionSource } from '@xopcai/gateway-contract';

export interface SessionFilters {
  sources: SessionSource[];
  purposes: SessionPurpose[];
  activity: '' | 'manual' | 'automatic';
  project: string;
  days: string;
  status: 'visible' | 'pinned' | 'archived';
  agentId: string;
  details: boolean;
}

export const DEFAULT_SESSION_FILTERS: SessionFilters = {
  sources: [], purposes: [], activity: '', project: '', days: '', status: 'visible', agentId: '', details: false,
};

export function hasSessionFilters(filters: SessionFilters): boolean {
  return Boolean(filters.sources.length || filters.purposes.length || filters.activity || filters.project || filters.days || filters.agentId || filters.status !== 'visible');
}

export function buildDiscoveryQuery(filters: SessionFilters, search: string, now = Date.now()): SessionListQuery {
  return {
    search: search.trim() || undefined,
    sources: filters.sources.length ? filters.sources : undefined,
    purposes: filters.purposes.length ? filters.purposes : [...SESSION_PURPOSES],
    activity: filters.activity || undefined,
    projectId: filters.project && filters.project !== '__unassigned' ? filters.project : undefined,
    unassigned: filters.project === '__unassigned' || undefined,
    updatedAfter: filters.days ? now - Number(filters.days) * 86_400_000 : undefined,
    status: filters.status === 'visible' ? undefined : filters.status,
    excludeArchived: filters.status !== 'archived',
    agentId: filters.agentId || undefined,
    sortBy: 'updatedAt', sortOrder: 'desc',
  };
}

function preferenceKey(gateway: string): string {
  return `xopc-session-filters-v1:${gateway}`;
}

export function normalizeSessionFilters(saved: Record<string, unknown>): SessionFilters {
  try {
    const valid = SessionDiscoveryQuerySchema.safeParse({ sources: saved.sources, purposes: saved.purposes, activity: saved.activity || undefined, agentId: saved.agentId || undefined });
    if (!valid.success) return { ...DEFAULT_SESSION_FILTERS };
    return {
      ...DEFAULT_SESSION_FILTERS,
      ...valid.data,
      sources: valid.data.sources ?? [], purposes: valid.data.purposes ?? [], activity: valid.data.activity ?? '', agentId: valid.data.agentId ?? '',
      project: typeof saved.project === 'string' ? saved.project : '',
      days: typeof saved.days === 'string' && ['', '7', '30', '60'].includes(saved.days) ? saved.days : '',
      status: saved.status === 'pinned' || saved.status === 'archived' ? saved.status : 'visible',
      details: saved.details === true,
    };
  } catch { return { ...DEFAULT_SESSION_FILTERS }; }
}

export function readSessionFilters(gateway: string): SessionFilters {
  try { return normalizeSessionFilters(JSON.parse(localStorage.getItem(preferenceKey(gateway)) ?? '{}')); }
  catch { return { ...DEFAULT_SESSION_FILTERS }; }
}

export function writeSessionFilters(gateway: string, filters: SessionFilters): void {
  try { localStorage.setItem(preferenceKey(gateway), JSON.stringify(filters)); } catch { /* Private storage may be unavailable. */ }
}
