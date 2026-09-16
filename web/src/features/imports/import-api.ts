import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
export type { DetectedImportSource, ProductImportResult, ImportSource } from '../../../../src/imports/types';
export async function importRequest<T>(path: string, body?: unknown): Promise<T> {
  return (await fetchJson<{ data: T }>(apiUrl(`/api/imports${path}`), body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })).data;
}
