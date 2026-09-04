import { apiFetch, formatApiHttpError } from '../api/client';

export type HostDirectory = { name: string; absolutePath: string; isDirectory: boolean };
export type HostDirectoryPage = { currentPath: string; parentPath: string | null; entries: HostDirectory[] };

export async function fetchHostDirectories(path?: string): Promise<HostDirectoryPage> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  const response = await apiFetch(`/api/host/fs/list${query}`);
  if (!response.ok) throw new Error(formatApiHttpError(response.status, response.statusText));
  const body = await response.json() as { payload?: HostDirectoryPage };
  if (!body.payload) throw new Error('Host directories are unavailable');
  return { ...body.payload, entries: body.payload.entries.filter((entry) => entry.isDirectory) };
}
