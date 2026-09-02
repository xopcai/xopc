import {
  FileResourceSchema,
  FileResourcesResponseSchema,
  FileSpaceSchema,
  FileSpacesResponseSchema,
  type FileResource,
  type FileSpace,
} from '@xopcai/gateway-contract';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface WorkspaceEntry {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  mimeType: string;
  revision: string;
}

export type WorkspaceDirectoryListing = { entries: WorkspaceEntry[] };
export type WorkspaceFileSearchEntry = WorkspaceEntry;

export type WorkspaceEditorRequestOptions = {
  projectId?: string;
  sessionKey?: string;
  agentId?: string;
};

export type FileReferenceScope = 'workspace' | 'missing' | 'invalid';
export type FileReferenceLocationKind = 'workspace';
export type FileReferenceCapability = 'preview' | 'edit';
export type WorkspaceFileReference = {
  inputPath: string;
  displayName: string;
  scope: FileReferenceScope;
  locationKind?: FileReferenceLocationKind;
  exists: boolean;
  isDirectory?: boolean;
  workspaceRelativePath?: string;
  capabilities: FileReferenceCapability[];
  mtimeMs?: number;
  fileId?: string;
};

async function readApiError(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return new Error(body?.error?.message ?? `HTTP ${response.status}`);
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await apiFetch(apiUrl(path), init);
  if (!response.ok) throw await readApiError(response);
  return response.json();
}

async function resolveSpace(options?: WorkspaceEditorRequestOptions): Promise<FileSpace> {
  const context = options?.projectId
    ? { kind: 'project', id: options.projectId }
    : options?.sessionKey
      ? { kind: 'session', id: options.sessionKey }
      : options?.agentId
        ? { kind: 'agent', id: options.agentId }
        : null;
  if (context) {
    const body = await requestJson(`/api/files/contexts/${context.kind}/${encodeURIComponent(context.id)}`) as { space?: unknown };
    return FileSpaceSchema.parse(body.space);
  }
  const body = FileSpacesResponseSchema.parse(await requestJson('/api/files/spaces'));
  const space = body.spaces.find((item) => item.bindings.some((binding) => binding.kind === 'agent')) ?? body.spaces[0];
  if (!space) throw new Error('No file location is available');
  return space;
}

function toEntry(resource: FileResource): WorkspaceEntry {
  return {
    id: resource.id,
    name: resource.name,
    path: resource.relativePath,
    isDirectory: resource.kind === 'directory',
    mimeType: resource.mimeType,
    revision: resource.revision,
  };
}

async function resolveResource(path: string, options?: WorkspaceEditorRequestOptions): Promise<FileResource> {
  const space = await resolveSpace(options);
  const body = await requestJson('/api/files/resolve', {
    method: 'POST',
    body: JSON.stringify({ spaceId: space.id, path }),
  }) as { resource?: unknown };
  return FileResourceSchema.parse(body.resource);
}

export async function fetchWorkspaceDirectoryListing(
  dir = '',
  options?: WorkspaceEditorRequestOptions,
): Promise<WorkspaceDirectoryListing> {
  const space = await resolveSpace(options);
  const params = new URLSearchParams();
  if (dir) params.set('path', dir);
  const body = FileResourcesResponseSchema.parse(await requestJson(
    `/api/files/spaces/${encodeURIComponent(space.id)}/children${params.size ? `?${params}` : ''}`,
  ));
  return { entries: body.items.map(toEntry) };
}

export async function listWorkspaceDir(dir = '', options?: WorkspaceEditorRequestOptions): Promise<WorkspaceEntry[]> {
  return (await fetchWorkspaceDirectoryListing(dir, options)).entries;
}

export async function searchWorkspaceFiles(
  query: string,
  options?: WorkspaceEditorRequestOptions,
  limit = 50,
): Promise<WorkspaceFileSearchEntry[]> {
  const space = await resolveSpace(options);
  const params = new URLSearchParams({ q: query.trim(), limit: String(limit), spaceId: space.id });
  const body = FileResourcesResponseSchema.parse(await requestJson(`/api/files/search?${params}`));
  return body.items.map(toEntry);
}

export async function readWorkspaceFile(
  path: string,
  options?: WorkspaceEditorRequestOptions,
): Promise<{ content: string; path: string; mtimeMs?: number; revision: string }> {
  const resource = await resolveResource(path, options);
  const response = await apiFetch(apiUrl(`/api/files/${encodeURIComponent(resource.id)}/content`));
  if (!response.ok) throw await readApiError(response);
  return { content: await response.text(), path: resource.relativePath, mtimeMs: resource.modifiedAt, revision: resource.revision };
}

export async function readWorkspaceFileBase64(
  path: string,
  options?: WorkspaceEditorRequestOptions,
): Promise<{ contentBase64: string; path: string; mtimeMs?: number; revision: string }> {
  const resource = await resolveResource(path, options);
  const response = await apiFetch(apiUrl(`/api/files/${encodeURIComponent(resource.id)}/content`));
  if (!response.ok) throw await readApiError(response);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return { contentBase64: btoa(binary), path: resource.relativePath, mtimeMs: resource.modifiedAt, revision: resource.revision };
}

export async function resolveWorkspaceFileReference(
  path: string,
  options?: WorkspaceEditorRequestOptions,
): Promise<WorkspaceFileReference | null> {
  try {
    const resource = await resolveResource(path, options);
    return {
      fileId: resource.id,
      inputPath: path,
      displayName: resource.name,
      scope: 'workspace',
      locationKind: 'workspace',
      exists: true,
      isDirectory: resource.kind === 'directory',
      workspaceRelativePath: resource.relativePath,
      capabilities: resource.capabilities.filter((capability): capability is 'preview' | 'edit' => capability === 'preview' || capability === 'edit'),
      mtimeMs: resource.modifiedAt,
    };
  } catch {
    return null;
  }
}

export async function fetchWorkspaceFileBlob(path: string, options?: WorkspaceEditorRequestOptions): Promise<Blob> {
  const resource = await resolveResource(path, options);
  const response = await apiFetch(apiUrl(`/api/files/${encodeURIComponent(resource.id)}/content`), { headers: { Accept: '*/*' } });
  if (!response.ok) throw await readApiError(response);
  return response.blob();
}

export async function writeWorkspaceFile(
  path: string,
  content: string,
  options?: WorkspaceEditorRequestOptions,
): Promise<{ path: string; mtimeMs?: number; revision: string }> {
  const resource = await resolveResource(path, options);
  const body = await requestJson(`/api/files/${encodeURIComponent(resource.id)}/content`, {
    method: 'PUT',
    body: JSON.stringify({ content, revision: resource.revision }),
  }) as { resource?: unknown };
  const updated = FileResourceSchema.parse(body.resource);
  return { path: updated.relativePath, mtimeMs: updated.modifiedAt, revision: updated.revision };
}

export function downloadTextFile(fileName: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function downloadBinaryFile(fileName: string, data: ArrayBuffer, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
