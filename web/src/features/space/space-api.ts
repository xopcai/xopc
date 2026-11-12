import type { SpaceDetail, SpaceList } from '@xopcai/gateway-contract';

import { apiUrl } from '@/lib/url';
import { apiFetch, fetchJson } from '@/lib/fetch';

export const spacePath = '/api/spaces/items';

export function spaceItemPath(id: string): string {
  return `${spacePath}/${encodeURIComponent(id)}`;
}

export const getSpaceList = (path: string) => fetchJson<SpaceList>(apiUrl(path));
export const getSpaceDetail = (path: string) => fetchJson<SpaceDetail>(apiUrl(path));

export function saveReplyToSpace(conversationId: string, reference: { entryId: string } | { turnId: string }): Promise<{ id: string }> {
  return fetchJson(apiUrl(spacePath), { method: 'POST', body: JSON.stringify({ conversationId, ...reference }) });
}

export function spaceContentUrl(id: string, versionId: string): string {
  return apiUrl(`${spaceItemPath(id)}/versions/${encodeURIComponent(versionId)}/content`);
}

export async function spaceContent(id: string, versionId: string, signal?: AbortSignal): Promise<Blob> {
  const res = await apiFetch(spaceContentUrl(id, versionId), { signal });
  if (!res.ok) throw new Error(String(res.status));
  return res.blob();
}
