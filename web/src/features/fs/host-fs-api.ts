import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type HostFsEntry = {
  name: string;
  absolutePath: string;
  isDirectory: boolean;
};

export type HostFsListPayload = {
  currentPath: string;
  parentPath: string | null;
  entries: HostFsEntry[];
};

export type HostFsMetaPayload = {
  hostname: string;
  platform: string;
  pathSeparator: string;
};

interface ListResponse {
  ok: boolean;
  payload: HostFsListPayload;
}

interface MetaResponse {
  ok: boolean;
  payload: HostFsMetaPayload;
}

interface CreateDirectoryResponse {
  ok: boolean;
  payload: {
    absolutePath: string;
  };
}

/** List one directory level on the gateway host. Omit `path` for OS root (POSIX `/` or Windows drives). */
export async function listHostFs(path?: string): Promise<HostFsListPayload> {
  const params = new URLSearchParams();
  if (path != null && path !== '') {
    params.set('path', path);
  }
  const qs = params.toString();
  const res = await fetchJson<ListResponse>(apiUrl(`/api/host/fs/list${qs ? `?${qs}` : ''}`));
  return res.payload;
}

export async function getHostFsMeta(): Promise<HostFsMetaPayload> {
  const res = await fetchJson<MetaResponse>(apiUrl('/api/host/fs/meta'));
  return res.payload;
}

/** Create a single child directory on the gateway host. */
export async function createHostFsDirectory(parentPath: string, name: string): Promise<string> {
  const res = await fetchJson<CreateDirectoryResponse>(apiUrl('/api/host/fs/directory'), {
    method: 'POST',
    body: JSON.stringify({ parentPath, name }),
  });
  return res.payload.absolutePath;
}
