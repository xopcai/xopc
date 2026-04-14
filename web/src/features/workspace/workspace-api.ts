import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface WorkspaceEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface ListResponse {
  ok: boolean;
  payload: { entries: WorkspaceEntry[] };
}

interface ReadResponse {
  ok: boolean;
  payload: { content: string; path: string };
}

interface WriteResponse {
  ok: boolean;
  payload: { path: string };
}

/** List a single directory level under the workspace. */
export async function listWorkspaceDir(dir = ''): Promise<WorkspaceEntry[]> {
  const params = dir ? `?dir=${encodeURIComponent(dir)}` : '';
  const res = await fetchJson<ListResponse>(apiUrl(`/api/workspace/editor/list${params}`));
  return res.payload.entries;
}

/** Read a workspace file's text content. */
export async function readWorkspaceFile(
  path: string,
): Promise<{ content: string; path: string }> {
  const res = await fetchJson<ReadResponse>(
    apiUrl(`/api/workspace/editor/read?path=${encodeURIComponent(path)}`),
  );
  return res.payload;
}

/** Write (overwrite) a workspace file. */
export async function writeWorkspaceFile(path: string, content: string): Promise<void> {
  await fetchJson<WriteResponse>(apiUrl('/api/workspace/editor/write'), {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
  });
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
