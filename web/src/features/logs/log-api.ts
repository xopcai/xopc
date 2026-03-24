import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type { LogEntry, LogFile, LogQuery, LogStats } from '@/features/logs/log.types';

function buildQueryString(query?: LogQuery): string {
  const params = new URLSearchParams();
  if (!query) return '';
  if (query.level?.length) params.set('level', query.level.join(','));
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.q) params.set('q', query.q);
  if (query.module) params.set('module', query.module);
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.offset != null) params.set('offset', String(query.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function queryLogs(query?: LogQuery): Promise<{ logs: LogEntry[]; count: number }> {
  return fetchJson<{ logs: LogEntry[]; count: number }>(apiUrl(`/api/logs${buildQueryString(query)}`));
}

export async function getLogFiles(): Promise<LogFile[]> {
  const result = await fetchJson<{ files: LogFile[] }>(apiUrl('/api/logs/files'));
  return result.files ?? [];
}

export async function getLogModules(): Promise<string[]> {
  const result = await fetchJson<{ modules: string[] }>(apiUrl('/api/logs/modules'));
  return result.modules ?? [];
}

export async function getLogStats(): Promise<LogStats> {
  const raw = await fetchJson<Partial<LogStats>>(apiUrl('/api/logs/stats'));
  return { byLevel: raw.byLevel ?? {} };
}

export async function getLogDir(): Promise<string> {
  const result = await fetchJson<{ dir: string }>(apiUrl('/api/logs/dir'));
  return result.dir ?? '';
}
