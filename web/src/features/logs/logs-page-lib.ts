import { LOG_LEVELS, type LogEntry, type LogLevel } from '@/features/logs/log.types';

function logEntryTimeMs(entry: LogEntry): number {
  const t = new Date(String(entry.timestamp)).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Newest first (descending by timestamp). */
export function sortLogsByTimeDesc(entries: readonly LogEntry[]): LogEntry[] {
  return entries.toSorted((a, b) => logEntryTimeMs(b) - logEntryTimeMs(a));
}

export const PAGE_LIMIT = 50;

const LOG_LEVEL_SET = new Set<LogLevel>(LOG_LEVELS);

export type LevelPreset = 'all' | 'errors' | 'warnPlus' | 'infoPlus' | 'verbose' | 'custom';
export type LevelSegmentValue = Exclude<LevelPreset, 'custom'> | 'other';

const PRESET_ERRORS: LogLevel[] = ['error', 'fatal'];
const PRESET_WARN_PLUS: LogLevel[] = ['warn', 'error', 'fatal'];
const PRESET_INFO_PLUS: LogLevel[] = ['info', 'warn', 'error', 'fatal'];

export function parseLogLevelsParam(raw: string | null): Set<LogLevel> {
  if (!raw) return new Set<LogLevel>();
  const out = new Set<LogLevel>();
  for (const part of raw.split(',')) {
    const level = part.trim() as LogLevel;
    if (LOG_LEVEL_SET.has(level)) out.add(level);
  }
  return out;
}

export function isSameLogLevelSet(a: Set<LogLevel>, b: Set<LogLevel>): boolean {
  if (a.size !== b.size) return false;
  for (const level of a) {
    if (!b.has(level)) return false;
  }
  return true;
}

function setMatchesLevels(s: Set<LogLevel>, levels: readonly LogLevel[]): boolean {
  if (s.size !== levels.length) return false;
  return levels.every((l) => s.has(l));
}

function derivePreset(levels: Set<LogLevel>): LevelPreset {
  if (levels.size === 0) return 'all';
  if (setMatchesLevels(levels, PRESET_ERRORS)) return 'errors';
  if (setMatchesLevels(levels, PRESET_WARN_PLUS)) return 'warnPlus';
  if (setMatchesLevels(levels, PRESET_INFO_PLUS)) return 'infoPlus';
  if (levels.size === LOG_LEVELS.length && LOG_LEVELS.every((l) => levels.has(l))) return 'verbose';
  return 'custom';
}

export function segmentValueFromLevels(levels: Set<LogLevel>): LevelSegmentValue {
  const p = derivePreset(levels);
  return p === 'custom' ? 'other' : p;
}

export function levelsForPreset(preset: Exclude<LevelPreset, 'custom'>): Set<LogLevel> {
  switch (preset) {
    case 'all':
      return new Set();
    case 'errors':
      return new Set(PRESET_ERRORS);
    case 'warnPlus':
      return new Set(PRESET_WARN_PLUS);
    case 'infoPlus':
      return new Set(PRESET_INFO_PLUS);
    case 'verbose':
      return new Set(LOG_LEVELS);
  }
}

export function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

export function moduleLabel(log: LogEntry): string {
  return String(log.module || log.service || log.extension || '—');
}

export function messagePreview(log: LogEntry): string {
  if (typeof log.message === 'string' && log.message) return log.message;
  try {
    return JSON.stringify(log);
  } catch {
    return '';
  }
}

export function formatTimeCompact(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return timestamp;
  }
}

export function formatTimestampFull(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return timestamp;
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function requestIdPreview(id: string): string {
  const t = id.trim();
  if (t.length <= 10) return t;
  return `${t.slice(0, 8)}…`;
}

export function levelLabel(level: string): string {
  return String(level).toLowerCase();
}

export function phaseLabel(log: LogEntry): string {
  const phase = log.phase ?? log.meta?.phase;
  if (typeof phase === 'string' && phase.trim()) return phase;
  return '—';
}

export function logEntryKey(log: LogEntry): string {
  return `${log.timestamp}-${log.requestId ?? ''}-${log.message}`;
}

export function extractErrorDetail(log: LogEntry): { name?: string; message?: string; stack?: string } | null {
  const err = log.err ?? log.meta?.err;
  if (!err || typeof err !== 'object') return null;
  const e = err as Record<string, unknown>;
  return {
    name: typeof e.name === 'string' ? e.name : undefined,
    message: typeof e.message === 'string' ? e.message : undefined,
    stack: typeof e.stack === 'string' ? e.stack : undefined,
  };
}

export function logMatchesClientFilters(
  log: LogEntry,
  filters: {
    debouncedSearch: string;
    selectedLevels: Set<LogLevel>;
    moduleFilter: string;
    dateFrom: string;
    dateTo: string;
    requestIdFilter: string;
    sessionIdFilter: string;
  },
): boolean {
  if (filters.selectedLevels.size > 0 && !filters.selectedLevels.has(log.level)) return false;
  if (filters.moduleFilter && moduleLabel(log) !== filters.moduleFilter) return false;
  if (filters.requestIdFilter && log.requestId !== filters.requestIdFilter) return false;
  if (
    filters.sessionIdFilter &&
    log.sessionId !== filters.sessionIdFilter &&
    log.sessionKey !== filters.sessionIdFilter
  ) return false;

  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom).getTime();
    const t = new Date(String(log.timestamp)).getTime();
    if (Number.isFinite(from) && Number.isFinite(t) && t < from) return false;
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo).getTime();
    const t = new Date(String(log.timestamp)).getTime();
    if (Number.isFinite(to) && Number.isFinite(t) && t > to) return false;
  }

  if (filters.debouncedSearch) {
    const q = filters.debouncedSearch.toLowerCase();
    const haystack = [
      log.message,
      moduleLabel(log),
      phaseLabel(log),
      log.requestId,
      log.sessionKey,
      log.sessionId,
      extractErrorDetail(log)?.message,
      extractErrorDetail(log)?.stack,
    ]
      .filter(Boolean)
      .map(String)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  return true;
}

export function formatStatsLine(
  byLevel: Partial<Record<LogLevel | 'silent', number>>,
  labels: Record<LogLevel, string>,
): string {
  const parts: string[] = [];
  for (const lv of LOG_LEVELS) {
    const n = byLevel[lv] ?? 0;
    if (n > 0) parts.push(`${labels[lv]} ${n}`);
  }
  return parts.join(' · ');
}
