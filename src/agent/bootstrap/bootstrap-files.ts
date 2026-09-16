import type { Config } from '../../config/schema.js';
import { DEFAULT_HEARTBEAT_FILENAME } from '../context/workspace.js';
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
import { filterBootstrapFilesForSession } from './filter-bootstrap-files.js';
import { loadProfileBootstrapFiles } from './load-bootstrap-files.js';
import type { EmbeddedContextFile, WorkspaceBootstrapFile } from './types.js';

export { clearAllBootstrapSnapshots, clearBootstrapSnapshot } from './bootstrap-cache.js';

function filterHeartbeatBootstrapFile(
  files: WorkspaceBootstrapFile[],
  exclude: boolean,
): WorkspaceBootstrapFile[] {
  if (!exclude) {
    return files;
  }
  return files.filter((file) => file.name !== DEFAULT_HEARTBEAT_FILENAME);
}

export function resolveBootstrapFilesSync(params: {
  profileDir: string;
  conversationId?: string;
  excludeHeartbeat?: boolean;
}): WorkspaceBootstrapFile[] {
  const rawFiles = loadProfileBootstrapFiles(params.profileDir);
  const filtered = filterBootstrapFilesForSession(rawFiles, params.conversationId);
  return filterHeartbeatBootstrapFile(filtered, params.excludeHeartbeat ?? false);
}

export async function resolveBootstrapFilesForRun(params: {
  profileDir: string;
  conversationId?: string;
  excludeHeartbeat?: boolean;
  warn?: (message: string) => void;
}): Promise<WorkspaceBootstrapFile[]> {
  const conversationId = params.conversationId;
  const rawFiles = conversationId
    ? await getOrLoadBootstrapFiles({
        profileDir: params.profileDir,
        conversationId,
      })
    : loadProfileBootstrapFiles(params.profileDir);
  const filtered = filterBootstrapFilesForSession(rawFiles, conversationId);
  return filterHeartbeatBootstrapFile(filtered, params.excludeHeartbeat ?? false);
}

export function resolveBootstrapContextSync(params: {
  profileDir: string;
  config?: Config;
  conversationId?: string;
  excludeHeartbeat?: boolean;
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
  excludeHeartbeat?: boolean;
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
