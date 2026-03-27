import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface EditorFileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface EditorSearchHit {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

export interface WorkspaceFilesAdapter {
  kind: 'electron' | 'gateway';
  /** Short label for the header (Electron: folder path; gateway: workspace hint). */
  displayRootLabel: string;
  list(dir: string): Promise<EditorFileEntry[]>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  search(query: string, dir: string): Promise<EditorSearchHit[]>;
}

export function createGatewayWorkspaceAdapter(): WorkspaceFilesAdapter {
  return {
    kind: 'gateway',
    displayRootLabel: 'Gateway workspace',
    async list(dir) {
      const res = await apiFetch(apiUrl(`/api/workspace/editor/list?dir=${encodeURIComponent(dir)}`));
      const data = (await res.json()) as {
        ok?: boolean;
        error?: { message?: string };
        payload?: { entries: EditorFileEntry[] };
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error?.message || `HTTP ${res.status}`);
      }
      return data.payload?.entries ?? [];
    },
    async read(path) {
      const res = await apiFetch(apiUrl(`/api/workspace/editor/read?path=${encodeURIComponent(path)}`));
      const data = (await res.json()) as {
        ok?: boolean;
        error?: { message?: string };
        payload?: { content: string };
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error?.message || `HTTP ${res.status}`);
      }
      return data.payload?.content ?? '';
    },
    async write(path, content) {
      const res = await apiFetch(apiUrl('/api/workspace/editor/write'), {
        method: 'PUT',
        body: JSON.stringify({ path, content }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: { message?: string } };
      if (!res.ok || !data.ok) {
        throw new Error(data.error?.message || `HTTP ${res.status}`);
      }
    },
    async search(query, dir) {
      const res = await apiFetch(
        apiUrl(`/api/workspace/editor/search?q=${encodeURIComponent(query)}&dir=${encodeURIComponent(dir)}`),
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: { message?: string };
        payload?: { results: EditorSearchHit[] };
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error?.message || `HTTP ${res.status}`);
      }
      return data.payload?.results ?? [];
    },
  };
}

export function createElectronWorkspaceAdapter(rootDir: string | null): WorkspaceFilesAdapter | null {
  const api = window.electronAPI;
  if (!api) return null;
  return {
    kind: 'electron',
    displayRootLabel: rootDir ?? '',
    async list(dir) {
      const p = dir === '' ? rootDir : dir;
      if (!p) return [];
      return api.file.listDirectory(p);
    },
    read: (path) => api.file.readFile(path),
    write: (path, content) => api.file.writeFile(path, content).then(() => undefined),
    search: (query, dir) => {
      const d = dir === '' ? rootDir : dir;
      if (!d) return Promise.resolve([]);
      return api.search.ripgrep(query, d);
    },
  };
}
