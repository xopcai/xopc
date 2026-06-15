import { loadProfileBootstrapFiles } from './load-bootstrap-files.js';
import type { WorkspaceBootstrapFile } from './types.js';

type BootstrapSnapshot = {
  profileDir: string;
  files: WorkspaceBootstrapFile[];
};

const cache = new Map<string, BootstrapSnapshot>();
const bootstrapContextInjected = new Set<string>();

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

export function wasBootstrapContextInjected(sessionKey: string): boolean {
  return bootstrapContextInjected.has(sessionKey);
}

export function markBootstrapContextInjected(sessionKey: string): void {
  bootstrapContextInjected.add(sessionKey);
}

export async function getOrLoadBootstrapFiles(params: {
  profileDir: string;
  sessionKey: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const existing = cache.get(params.sessionKey);
  const files = loadProfileBootstrapFiles(params.profileDir);
  if (existing && existing.profileDir === params.profileDir && bootstrapFilesEqual(existing.files, files)) {
    return existing.files;
  }
  cache.set(params.sessionKey, {
    profileDir: params.profileDir,
    files,
  });
  return files;
}

export function clearBootstrapSnapshot(sessionKey: string): void {
  cache.delete(sessionKey);
  bootstrapContextInjected.delete(sessionKey);
}

export function clearAllBootstrapSnapshots(): void {
  cache.clear();
  bootstrapContextInjected.clear();
}
