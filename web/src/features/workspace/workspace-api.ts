import { apiFetch, fetchJson } from '@/lib/fetch';
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
  payload: { content: string; path: string; absolutePath?: string; mtimeMs?: number };
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
  /** When set, uses that chat session's effective workspace (override or agent default). Takes priority over `agentId`. */
  sessionKey?: string;
  /** When set, lists/reads/writes that agent's Markdown workspace (`resolveAgentWorkspaceDir`). */
  agentId?: string;
};

export type FileReferenceScope =
  | 'workspace'
  | 'external'
  | 'agent-profile'
  | 'session-artifact'
  | 'missing'
  | 'invalid';

export type FileReferenceLocationKind =
  | 'agent-profile'
  | 'xopc-skills'
  | 'xopc-config'
  | 'xopc-agents'
  | 'xopc-sessions'
  | 'host';

export type FileReferenceCapability =
  | 'preview'
  | 'edit'
  | 'openExternal'
  | 'revealInFolder'
  | 'copyPath'
  | 'importToWorkspace';

export type WorkspaceFileReference = {
  fileRefId?: string;
  inputPath: string;
  displayName: string;
  scope: FileReferenceScope;
  locationKind?: FileReferenceLocationKind;
  manageRoute?: string;
  exists: boolean;
  isDirectory?: boolean;
  absolutePath?: string;
  workspaceRelativePath?: string;
  capabilities: FileReferenceCapability[];
  mtimeMs?: number;
  errorCode?: string;
};

export type FileReferenceAction = 'openExternal' | 'revealInFolder';

function editorQuery(dir: string, options?: WorkspaceEditorRequestOptions): string {
  const params = new URLSearchParams();
  if (dir) params.set('dir', dir);
  const sk = options?.sessionKey?.trim();
  if (sk) {
    params.set('sessionKey', sk);
  } else {
    const aid = options?.agentId?.trim();
    if (aid) params.set('agentId', aid);
  }
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
): Promise<{ content: string; path: string; absolutePath?: string; mtimeMs?: number }> {
  const params = new URLSearchParams({ path });
  const sk = options?.sessionKey?.trim();
  if (sk) {
    params.set('sessionKey', sk);
  } else {
    const aid = options?.agentId?.trim();
    if (aid) params.set('agentId', aid);
  }
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
  const sk = options?.sessionKey?.trim();
  if (sk) {
    params.set('sessionKey', sk);
  } else {
    const aid = options?.agentId?.trim();
    if (aid) params.set('agentId', aid);
  }
  const res = await fetchJson<ReadBase64Response>(
    apiUrl(`/api/workspace/editor/read-base64?${params.toString()}`),
  );
  return res.payload;
}

export async function resolveWorkspaceFileReference(
  path: string,
  options?: WorkspaceEditorRequestOptions,
): Promise<WorkspaceFileReference | null> {
  const params = new URLSearchParams({ path });
  const sk = options?.sessionKey?.trim();
  if (sk) {
    params.set('sessionKey', sk);
  } else {
    const aid = options?.agentId?.trim();
    if (aid) params.set('agentId', aid);
  }
  const res = await apiFetch(apiUrl(`/api/workspace/editor/resolve-reference?${params.toString()}`));
  if (!res.ok) return null;
  const data = (await res.json()) as { ok?: boolean; payload?: WorkspaceFileReference };
  return data.ok && data.payload ? data.payload : null;
}

export async function resolveFileReferenceAction(
  fileRefId: string,
  action: FileReferenceAction,
  options?: WorkspaceEditorRequestOptions,
): Promise<{ absolutePath: string; isDirectory: boolean } | null> {
  const params = new URLSearchParams();
  const sk = options?.sessionKey?.trim();
  if (sk) {
    params.set('sessionKey', sk);
  } else {
    const aid = options?.agentId?.trim();
    if (aid) params.set('agentId', aid);
  }
  const qs = params.toString();
  const res = await apiFetch(
    apiUrl(`/api/workspace/file-ref/${encodeURIComponent(fileRefId)}/resolve-action${qs ? `?${qs}` : ''}`),
    {
      method: 'POST',
      body: JSON.stringify({ action }),
    },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    ok?: boolean;
    payload?: { absolutePath?: string; isDirectory?: boolean };
  };
  if (!data.ok || typeof data.payload?.absolutePath !== 'string') return null;
  return { absolutePath: data.payload.absolutePath, isDirectory: Boolean(data.payload.isDirectory) };
}

/** Fetch raw file bytes from the workspace (authenticated; use blob / object URL for images). */
export async function fetchWorkspaceFileBlob(
  path: string,
  options?: WorkspaceEditorRequestOptions,
): Promise<Blob> {
  const params = new URLSearchParams({ path });
  const sk = options?.sessionKey?.trim();
  if (sk) {
    params.set('sessionKey', sk);
  } else {
    const aid = options?.agentId?.trim();
    if (aid) params.set('agentId', aid);
  }
  const res = await apiFetch(apiUrl(`/api/workspace/editor/raw?${params.toString()}`), {
    headers: { Accept: '*/*' },
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const msg = err.error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return res.blob();
}

export type ImportFileReferenceResult = {
  workspaceRelativePath: string;
  absolutePath: string;
  bytesCopied: number;
  sourceAbsolutePath: string;
  sourceScope: FileReferenceScope;
  sourceLocationKind?: FileReferenceLocationKind;
  renamed: boolean;
  overwrote: boolean;
  mtimeMs?: number;
  newFileRefId: string;
};

export type ImportFileReferenceError = {
  code:
    | 'INVALID_FILE_REF'
    | 'FILE_REF_EXPIRED'
    | 'FILE_REF_FORBIDDEN'
    | 'IMPORT_NOT_ALLOWED'
    | 'SOURCE_NOT_FOUND'
    | 'SOURCE_NOT_FILE'
    | 'SOURCE_TOO_LARGE'
    | 'WORKSPACE_RESOLUTION_FAILED'
    | 'INVALID_CONFLICT_MODE'
    | 'OVERWRITE_DISABLED'
    | 'INVALID_DESTINATION'
    | 'DESTINATION_BLOCKED'
    | 'SAME_LOCATION'
    | 'DESTINATION_EXISTS'
    | 'IMPORT_FAILED'
    | 'UNKNOWN';
  message: string;
};

/**
 * Copy an external file (identified by a registered fileRef) into the current
 * session's workspace. The source ref is consumed; on success the response
 * carries a fresh workspace-scoped fileRef ready to render in-place.
 */
export async function importFileReferenceToWorkspace(
  fileRefId: string,
  options?: WorkspaceEditorRequestOptions & {
    destination?: string;
    onConflict?: 'rename' | 'overwrite' | 'error';
  },
): Promise<{ ok: true; payload: ImportFileReferenceResult } | { ok: false; error: ImportFileReferenceError }> {
  const params = new URLSearchParams();
  const sk = options?.sessionKey?.trim();
  if (sk) {
    params.set('sessionKey', sk);
  } else {
    const aid = options?.agentId?.trim();
    if (aid) params.set('agentId', aid);
  }
  const qs = params.toString();
  const res = await apiFetch(
    apiUrl(`/api/workspace/import-file-ref/${encodeURIComponent(fileRefId)}${qs ? `?${qs}` : ''}`),
    {
      method: 'POST',
      body: JSON.stringify({
        destination: options?.destination,
        onConflict: options?.onConflict ?? 'rename',
      }),
    },
  );

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: { code: 'UNKNOWN', message: `HTTP ${res.status}` } };
  }
  const body = data as { ok?: boolean; payload?: ImportFileReferenceResult; error?: { code?: string; message?: string } };
  if (body.ok && body.payload) {
    return { ok: true, payload: body.payload };
  }
  return {
    ok: false,
    error: {
      code: (body.error?.code as ImportFileReferenceError['code']) ?? 'UNKNOWN',
      message: body.error?.message ?? `HTTP ${res.status}`,
    },
  };
}

export async function writeWorkspaceFile(
  path: string,
  content: string,
  options?: WorkspaceEditorRequestOptions,
): Promise<{ path: string; mtimeMs?: number }> {
  const sk = options?.sessionKey?.trim();
  const qs = sk
    ? `?sessionKey=${encodeURIComponent(sk)}`
    : options?.agentId?.trim()
      ? `?agentId=${encodeURIComponent(options.agentId.trim())}`
      : '';
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
