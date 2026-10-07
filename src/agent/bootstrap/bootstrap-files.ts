import type { Config } from '../../config/schema.js';
import {
  getOrLoadBootstrapFiles,
  markBootstrapContextInjected,
  wasBootstrapContextInjected,
} from './bootstrap-cache.js';
import {
  buildBootstrapContextFiles,
  resolveBootstrapMaxChars,
  resolveBootstrapTotalMaxChars,
} from './bootstrap-context.js';
import { loadProfileBootstrapFiles } from './load-bootstrap-files.js';
import type { EmbeddedContextFile, WorkspaceBootstrapFile } from './types.js';

export { clearAllBootstrapSnapshots, clearBootstrapSnapshot } from './bootstrap-cache.js';

export function resolveBootstrapFilesSync(params: {
  profileDir: string;
  conversationId?: string;
}): WorkspaceBootstrapFile[] {
  return loadProfileBootstrapFiles(params.profileDir);
}

export async function resolveBootstrapFilesForRun(params: {
  profileDir: string;
  conversationId?: string;
  warn?: (message: string) => void;
}): Promise<WorkspaceBootstrapFile[]> {
  const conversationId = params.conversationId;
  const rawFiles = conversationId
    ? await getOrLoadBootstrapFiles({
        profileDir: params.profileDir,
        conversationId,
      })
    : loadProfileBootstrapFiles(params.profileDir);
  return rawFiles;
}

export function resolveBootstrapContextSync(params: {
  profileDir: string;
  config?: Config;
  conversationId?: string;
  contextInjection?: 'always' | 'continuation-skip' | 'never';
}): {
  bootstrapFiles: WorkspaceBootstrapFile[];
  contextFiles: EmbeddedContextFile[];
} {
  const mode = params.contextInjection ?? 'always';
  if (mode === 'never') {
    return { bootstrapFiles: [], contextFiles: [] };
  }
  if (
    mode === 'continuation-skip' &&
    params.conversationId &&
    wasBootstrapContextInjected(params.conversationId)
  ) {
    return { bootstrapFiles: [], contextFiles: [] };
  }
  const bootstrapFiles = resolveBootstrapFilesSync(params);
  const contextFiles = buildBootstrapContextFiles(bootstrapFiles, {
    maxChars: resolveBootstrapMaxChars(params.config),
    totalMaxChars: resolveBootstrapTotalMaxChars(params.config),
  });
  if (mode === 'continuation-skip' && params.conversationId && contextFiles.length > 0) {
    markBootstrapContextInjected(params.conversationId);
  }
  return { bootstrapFiles, contextFiles };
}

export async function resolveBootstrapContextForRun(params: {
  profileDir: string;
  config?: Config;
  conversationId?: string;
  contextInjection?: 'always' | 'continuation-skip' | 'never';
  warn?: (message: string) => void;
}): Promise<{
  bootstrapFiles: WorkspaceBootstrapFile[];
  contextFiles: EmbeddedContextFile[];
}> {
  const mode = params.contextInjection ?? 'always';
  if (mode === 'never') {
    return { bootstrapFiles: [], contextFiles: [] };
  }
  if (
    mode === 'continuation-skip' &&
    params.conversationId &&
    wasBootstrapContextInjected(params.conversationId)
  ) {
    return { bootstrapFiles: [], contextFiles: [] };
  }
  const bootstrapFiles = await resolveBootstrapFilesForRun(params);
  const contextFiles = buildBootstrapContextFiles(bootstrapFiles, {
    maxChars: resolveBootstrapMaxChars(params.config),
    totalMaxChars: resolveBootstrapTotalMaxChars(params.config),
    warn: params.warn,
  });
  if (mode === 'continuation-skip' && params.conversationId && contextFiles.length > 0) {
    markBootstrapContextInjected(params.conversationId);
  }
  return { bootstrapFiles, contextFiles };
}
