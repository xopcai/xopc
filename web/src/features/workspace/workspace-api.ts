import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface WorkspaceEntry {
  name: string;
  path: string;
  /** Host absolute path (gateway ≥ this change). Used for copy-path; `path` stays workspace-relative. */
  absolutePath?: string;
  isDirectory: boolean;
}

interface ListResponse {
  ok: boolean;
  payload: { entries: WorkspaceEntry[] };
}

interface ReadResponse {
  ok: boolean;
  payload: { content: string; path: string; mtimeMs?: number };
}

interface ReadBase64Response {
  ok: boolean;
  payload: { contentBase64: string; path: string; absolutePath?: string; mtimeMs?: number };
}

interface WriteResponse {
  ok: boolean;
  payload: { path: string; mtimeMs?: number };
}

export type WorkspaceEditorRequestOptions = {
  /** When set, lists/reads/writes that agent's Markdown workspace (`resolveAgentWorkspaceDir`). */
  agentId?: string;
};

function editorQuery(dir: string, options?: WorkspaceEditorRequestOptions): string {
  const params = new URLSearchParams();
  if (dir) params.set('dir', dir);
  const aid = options?.agentId?.trim();
  if (aid) params.set('agentId', aid);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** List a single directory level under the workspace. */
export async function listWorkspaceDir(
  dir = '',
  options?: WorkspaceEditorRequestOptions,
): Promise<WorkspaceEntry[]> {
  const res = await fetchJson<ListResponse>(
    apiUrl(`/api/workspace/editor/list${editorQuery(dir, options)}`),
  );
  return res.payload.entries;
}

/** Read a workspace file's text content. */
export async function readWorkspaceFile(
  path: string,
  options?: WorkspaceEditorRequestOptions,
): Promise<{ content: string; path: string; mtimeMs?: number }> {
  const params = new URLSearchParams({ path });
  const aid = options?.agentId?.trim();
  if (aid) params.set('agentId', aid);
  const res = await fetchJson<ReadResponse>(
    apiUrl(`/api/workspace/editor/read?${params.toString()}`),
  );
  return res.payload;
}

/** Read a workspace file as base64 (binary-safe; use for PDF preview). */
export async function readWorkspaceFileBase64(
  path: string,
  options?: WorkspaceEditorRequestOptions,
): Promise<{ contentBase64: string; path: string; absolutePath?: string; mtimeMs?: number }> {
  const params = new URLSearchParams({ path });
  const aid = options?.agentId?.trim();
  if (aid) params.set('agentId', aid);
  const res = await fetchJson<ReadBase64Response>(
    apiUrl(`/api/workspace/editor/read-base64?${params.toString()}`),
  );
  return res.payload;
}

/** Write (overwrite) a workspace file. */
export async function writeWorkspaceFile(
  path: string,
  content: string,
  options?: WorkspaceEditorRequestOptions,
): Promise<{ path: string; mtimeMs?: number }> {
  const aid = options?.agentId?.trim();
  const qs = aid ? `?agentId=${encodeURIComponent(aid)}` : '';
  const res = await fetchJson<WriteResponse>(apiUrl(`/api/workspace/editor/write${qs}`), {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
  });
  return res.payload;
}

/** Trigger a browser download for a text file read from the workspace. */
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

/** Download binary data (e.g. PDF from workspace preview). */
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
