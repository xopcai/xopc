import {
  FileResourceSchema,
  FileResourcesResponseSchema,
  FileSpaceSchema,
  FileSpacesResponseSchema,
  type FileResource,
  type FileSpace,
} from '@xopcai/gateway-contract';

import { apiFetch, formatApiHttpError } from '../api/client';

async function apiError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return new Error(formatApiHttpError(response.status, response.statusText, body?.error?.message));
}

export type FileContextKind = 'agent' | 'project' | 'session';

export function fileContentPath(fileId: string): string {
  return `/api/files/${encodeURIComponent(fileId)}/content`;
}

export async function fetchFileSpaces(): Promise<FileSpace[]> {
  const response = await apiFetch('/api/files/spaces');
  if (!response.ok) throw await apiError(response);
  return FileSpacesResponseSchema.parse(await response.json()).spaces;
}

export async function fetchFileSpaceForContext(kind: FileContextKind, id: string): Promise<FileSpace> {
  const response = await apiFetch(`/api/files/contexts/${kind}/${encodeURIComponent(id)}`);
  if (!response.ok) throw await apiError(response);
  return FileSpaceSchema.parse((await response.json() as { space?: unknown }).space);
}

export async function fetchFileChildren(spaceId: string, path = ''): Promise<FileResource[]> {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  const response = await apiFetch(`/api/files/spaces/${encodeURIComponent(spaceId)}/children${params.size ? `?${params}` : ''}`);
  if (!response.ok) throw await apiError(response);
  return FileResourcesResponseSchema.parse(await response.json()).items;
}

export async function fetchRecentFiles(limit = 50): Promise<FileResource[]> {
  const response = await apiFetch(`/api/files/recent?limit=${limit}`);
  if (!response.ok) throw await apiError(response);
  return FileResourcesResponseSchema.parse(await response.json()).items;
}

export async function searchFiles(query: string, spaceId?: string): Promise<FileResource[]> {
  const params = new URLSearchParams({ q: query.trim(), limit: '50' });
  if (spaceId) params.set('spaceId', spaceId);
  const response = await apiFetch(`/api/files/search?${params}`);
  if (!response.ok) throw await apiError(response);
  return FileResourcesResponseSchema.parse(await response.json()).items;
}

export async function resolveFileResource(spaceId: string, path: string): Promise<FileResource> {
  const response = await apiFetch('/api/files/resolve', {
    method: 'POST',
    body: JSON.stringify({ spaceId, path }),
  });
  if (!response.ok) throw await apiError(response);
  return FileResourceSchema.parse((await response.json() as { resource?: unknown }).resource);
}

export async function fetchFileContent(fileId: string): Promise<Response> {
  const response = await apiFetch(fileContentPath(fileId));
  if (!response.ok) throw await apiError(response);
  return response;
}

export async function fetchFileResource(fileId: string): Promise<FileResource> {
  const response = await apiFetch(`/api/files/${encodeURIComponent(fileId)}`);
  if (!response.ok) throw await apiError(response);
  return FileResourceSchema.parse((await response.json() as { resource?: unknown }).resource);
}

export async function fetchFileHostPath(fileId: string): Promise<string> {
  const response = await apiFetch(`/api/files/${encodeURIComponent(fileId)}/host-path`);
  if (!response.ok) throw await apiError(response);
  return (await response.json() as { absolutePath: string }).absolutePath;
}

export async function resolveContextFileResources(
  kind: FileContextKind,
  id: string,
  paths: Array<string | null | undefined>,
): Promise<Array<FileResource | null>> {
  const space = await fetchFileSpaceForContext(kind, id);
  return Promise.all(paths.map(async (path) => {
    const relativePath = path?.replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!relativePath) return null;
    try { return await resolveFileResource(space.id, relativePath); } catch { return null; }
  }));
}

export async function uploadFileResource(input: {
  spaceId: string;
  directory: string;
  uri: string;
  name: string;
  mimeType?: string;
}): Promise<FileResource> {
  const form = new FormData();
  form.append('directory', input.directory);
  form.append('file', {
    uri: input.uri,
    name: input.name,
    type: input.mimeType || 'application/octet-stream',
  } as unknown as Blob);
  const response = await apiFetch(`/api/files/spaces/${encodeURIComponent(input.spaceId)}/upload`, {
    method: 'POST', body: form, timeoutMs: 30_000,
  });
  if (!response.ok) throw await apiError(response);
  return FileResourceSchema.parse((await response.json() as { resource?: unknown }).resource);
}
