import type { TuiAutocompleteProvider } from '../extensions/types/tui.js';
import type { TuiWorkspaceFileSearchEntry } from './tui-backend.js';

const FILE_PATH_CHAR_CLASS = String.raw`a-zA-Z0-9_./\-\p{L}\p{N}`;
const UNQUOTED_ONLY = new RegExp(`^[${FILE_PATH_CHAR_CLASS}]+$`, 'u');

function formatFilePathForWire(path: string): string {
  if (UNQUOTED_ONLY.test(path)) return path;
  const body = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${body}"`;
}

export function createTuiFileAutocompleteProvider(
  searchWorkspaceFiles: (
    sessionKey: string,
    query: string,
    options?: { limit?: number },
  ) => Promise<TuiWorkspaceFileSearchEntry[]>,
): TuiAutocompleteProvider {
  return async (query, { sessionKey }) => {
    const trimmed = query.trim();
    if (/^(skill|doc|url|symbol):/i.test(trimmed)) {
      return [];
    }
    const fileQuery = trimmed.replace(/^file:/i, '');
    const entries = await searchWorkspaceFiles(sessionKey, fileQuery, { limit: 15 });
    return entries.map((entry) => {
      const path = entry.isDirectory && !entry.path.endsWith('/') ? `${entry.path}/` : entry.path;
      const wire = `@file:${formatFilePathForWire(path)}`;
      return {
        name: path,
        value: wire,
        label: entry.name + (entry.isDirectory ? '/' : ''),
        description: entry.path,
      };
    });
  };
}
