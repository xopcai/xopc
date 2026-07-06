import { apiFetch, formatApiHttpError } from '../api/client';

export type WorkspaceScope =
  | { kind: 'session'; sessionKey: string }
  | { kind: 'agent'; agentId: string }
  | { kind: 'default' };

export type WorkspaceEntry = {
  name: string;
  path: string;
  absolutePath?: string;
  isDirectory: boolean;
  size?: number;
  mtimeMs?: number;
};

type ListWorkspaceDirResponse = {
  ok?: boolean;
  payload?: { entries?: WorkspaceEntry[] };
};

type WorkspaceEntryWire = Partial<Omit<WorkspaceEntry, 'isDirectory'>> & {
  isDirectory?: unknown;
  type?: unknown;
  kind?: unknown;
};

function appendScope(params: URLSearchParams, scope?: WorkspaceScope): void {
  if (!scope || scope.kind === 'default') return;
  if (scope.kind === 'session') {
    const sessionKey = scope.sessionKey.trim();
    if (sessionKey) params.set('sessionKey', sessionKey);
    return;
  }
  const agentId = scope.agentId.trim();
  if (agentId) params.set('agentId', agentId);
}

async function parseErrorMessage(res: Response): Promise<string | undefined> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message;
}

export function workspaceScopeKey(scope?: WorkspaceScope): string {
  if (!scope || scope.kind === 'default') return 'default';
  if (scope.kind === 'session') return `session:${scope.sessionKey.trim()}`;
  return `agent:${scope.agentId.trim()}`;
}

export function normalizeWorkspaceDir(dir: string | undefined | null): string {
  return (dir ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
}

export function parentWorkspaceDir(dir: string): string {
  const normalized = normalizeWorkspaceDir(dir);
  if (!normalized) return '';
  const parts = normalized.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeWorkspaceEntry(entry: WorkspaceEntryWire): WorkspaceEntry {
  const rawPath = asString(entry.path);
  const path = normalizeWorkspaceDir(rawPath);
  const name = asString(entry.name) || path.split('/').filter(Boolean).pop() || path || '';
  const type = asString(entry.type || entry.kind).toLowerCase();
  const isDirectory = entry.isDirectory === true || type === 'directory' || type === 'folder';
  const absolutePath = asString(entry.absolutePath);
  const size = typeof entry.size === 'number' && Number.isFinite(entry.size) ? entry.size : undefined;
  const mtimeMs = typeof entry.mtimeMs === 'number' && Number.isFinite(entry.mtimeMs) ? entry.mtimeMs : undefined;

  return {
    name,
    path,
    isDirectory,
    ...(absolutePath ? { absolutePath } : {}),
    ...(size != null ? { size } : {}),
    ...(mtimeMs != null ? { mtimeMs } : {}),
  };
}

export async function fetchWorkspaceDir({
  dir = '',
  scope,
}: {
  dir?: string;
  scope?: WorkspaceScope;
}): Promise<WorkspaceEntry[]> {
  const params = new URLSearchParams();
  const normalizedDir = normalizeWorkspaceDir(dir);
  if (normalizedDir) params.set('dir', normalizedDir);
  appendScope(params, scope);

  const query = params.toString();
  const res = await apiFetch(`/api/workspace/editor/list${query ? `?${query}` : ''}`);
  if (!res.ok) {
    throw new Error(formatApiHttpError(res.status, res.statusText, await parseErrorMessage(res)));
  }
  const data = (await res.json()) as ListWorkspaceDirResponse;
  if (!data.ok || !Array.isArray(data.payload?.entries)) {
    throw new Error('Invalid workspace list response');
  }
  return data.payload.entries.map(normalizeWorkspaceEntry);
}
