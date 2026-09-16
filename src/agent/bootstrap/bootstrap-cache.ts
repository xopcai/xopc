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

export function wasBootstrapContextInjected(conversationId: string): boolean {
  return bootstrapContextInjected.has(conversationId);
}

export function markBootstrapContextInjected(conversationId: string): void {
  bootstrapContextInjected.add(conversationId);
}

export async function getOrLoadBootstrapFiles(params: {
  profileDir: string;
  conversationId: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const existing = cache.get(params.conversationId);
  const files = loadProfileBootstrapFiles(params.profileDir);
  if (
    existing &&
    existing.profileDir === params.profileDir &&
    bootstrapFilesEqual(existing.files, files)
  ) {
    return existing.files;
  }
  cache.set(params.conversationId, {
    profileDir: params.profileDir,
    files,
  });
  return files;
}

export function clearBootstrapSnapshot(conversationId: string): void {
  cache.delete(conversationId);
  bootstrapContextInjected.delete(conversationId);
}

export function clearAllBootstrapSnapshots(): void {
  cache.clear();
  bootstrapContextInjected.clear();
}
