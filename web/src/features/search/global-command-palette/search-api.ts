import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import type { Project } from '@/features/projects/api';

export type GlobalSearchHit = {
  kind: 'project';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  score: number;
  payload: {
    project: Project;
  };
};

export async function searchGlobal(query: string, options: { types?: string[]; limit?: number } = {}) {
  const params = new URLSearchParams();
  params.set('q', query.trim());
  if (options.types?.length) params.set('types', options.types.join(','));
  if (options.limit) params.set('limit', String(options.limit));
  const res = await fetchJson<{ ok: true; hits: GlobalSearchHit[]; total: number }>(
    apiUrl(`/api/search?${params.toString()}`),
  );
  return res.hits;
}
