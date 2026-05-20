import { loadProfileBootstrapFiles } from './load-bootstrap-files.js';
import type { WorkspaceBootstrapFile } from './types.js';

type BootstrapSnapshot = {
  profileDir: string;
  files: WorkspaceBootstrapFile[];
};

const cache = new Map<string, BootstrapSnapshot>();

function bootstrapFilesEqual(
  previous: WorkspaceBootstrapFile[],
  next: WorkspaceBootstrapFile[],
): boolean {
  if (previous.length !== next.length) {
    return false;
  }
  return previous.every((file, index) => {
    const updated = next[index];
    return (
      updated !== undefined &&
      file.name === updated.name &&
      file.path === updated.path &&
      file.content === updated.content &&
      file.missing === updated.missing
    );
  });
}

export async function getOrLoadBootstrapFiles(params: {
  profileDir: string;
  sessionKey: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const existing = cache.get(params.sessionKey);
  const files = loadProfileBootstrapFiles(params.profileDir);
  if (
    existing &&
    existing.profileDir === params.profileDir &&
    bootstrapFilesEqual(existing.files, files)
  ) {
    return existing.files;
  }
  cache.set(params.sessionKey, { profileDir: params.profileDir, files });
  return files;
}

export function clearBootstrapSnapshot(sessionKey: string): void {
  cache.delete(sessionKey);
}

export function clearAllBootstrapSnapshots(): void {
  cache.clear();
}
