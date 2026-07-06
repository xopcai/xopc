import { apiFetch, formatApiHttpError } from '../../api/client';

export type WorkspaceRequestOptions = {
  /** Per-chat session workspace. */
  sessionKey?: string | null;
  /** Optional agent workspace fallback. */
  agentId?: string | null;
};

type ReadWorkspaceFileResult = {
  content: string;
  path: string;
  absolutePath?: string;
  mtimeMs?: number;
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

type ReadWorkspaceFileBase64Result = {
  contentBase64: string;
  path: string;
  absolutePath?: string;
  mtimeMs?: number;
};

function appendWorkspaceScope(params: URLSearchParams, options?: WorkspaceRequestOptions): void {
  const sessionKey = options?.sessionKey?.trim();
  if (sessionKey) {
    params.set('sessionKey', sessionKey);
    return;
  }
  const agentId = options?.agentId?.trim();
  if (agentId) {
    params.set('agentId', agentId);
  }
}

async function parseErrorMessage(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message;
}

export async function resolveWorkspaceAbsoluteToRelative(
  absolutePath: string,
  options?: WorkspaceRequestOptions,
): Promise<string | null> {
  const params = new URLSearchParams({ absolutePath });
  appendWorkspaceScope(params, options);
  const res = await apiFetch(`/api/workspace/editor/resolve-path?${params.toString()}`);
  if (res.status === 400 || res.status === 403 || res.status === 404) {
    return null;
  }
  if (!res.ok) {
    return null;
  }
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    payload?: { workspaceRelativePath?: string };
  } | null;
  const rel = data?.payload?.workspaceRelativePath;
  return data?.ok && typeof rel === 'string' && rel.trim() ? rel : null;
}

export async function resolveWorkspaceFileReference(
  path: string,
  options?: WorkspaceRequestOptions,
): Promise<WorkspaceFileReference | null> {
  const params = new URLSearchParams({ path });
  appendWorkspaceScope(params, options);
  const res = await apiFetch(`/api/workspace/editor/resolve-reference?${params.toString()}`);
  if (!res.ok) {
    return null;
  }
  const data = (await res.json().catch(() => null)) as {
    ok?: boolean;
    payload?: WorkspaceFileReference;
  } | null;
  return data?.ok && data.payload ? data.payload : null;
}

export async function readWorkspaceFile(
  path: string,
  options?: WorkspaceRequestOptions,
): Promise<ReadWorkspaceFileResult> {
  const params = new URLSearchParams({ path });
  appendWorkspaceScope(params, options);
  const res = await apiFetch(`/api/workspace/editor/read?${params.toString()}`);
  if (!res.ok) {
    throw new Error(formatApiHttpError(res.status, res.statusText, await parseErrorMessage(res)));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: ReadWorkspaceFileResult };
  if (!data.ok || !data.payload) {
    throw new Error('Invalid workspace read response');
  }
  return data.payload;
}

export async function readWorkspaceFileBase64(
  path: string,
  options?: WorkspaceRequestOptions,
): Promise<ReadWorkspaceFileBase64Result> {
  const params = new URLSearchParams({ path });
  appendWorkspaceScope(params, options);
  const res = await apiFetch(`/api/workspace/editor/read-base64?${params.toString()}`);
  if (!res.ok) {
    throw new Error(formatApiHttpError(res.status, res.statusText, await parseErrorMessage(res)));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: ReadWorkspaceFileBase64Result };
  if (!data.ok || !data.payload) {
    throw new Error('Invalid workspace read-base64 response');
  }
  return data.payload;
}
