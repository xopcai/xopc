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
import { loadProfileBootstrapFiles, loadUserProfileBootstrapFile } from './load-bootstrap-files.js';
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
  userProfilePath?: string;
  sessionKey?: string;
  excludeHeartbeat?: boolean;
}): WorkspaceBootstrapFile[] {
  const rawFiles = [
    ...loadUserProfileBootstrapFile(params.userProfilePath),
    ...loadProfileBootstrapFiles(params.profileDir),
  ];
  const filtered = filterBootstrapFilesForSession(rawFiles, params.sessionKey);
  return filterHeartbeatBootstrapFile(filtered, params.excludeHeartbeat ?? false);
}

export async function resolveBootstrapFilesForRun(params: {
  profileDir: string;
  userProfilePath?: string;
  sessionKey?: string;
  excludeHeartbeat?: boolean;
  warn?: (message: string) => void;
}): Promise<WorkspaceBootstrapFile[]> {
  const sessionKey = params.sessionKey;
  const rawFiles = sessionKey
    ? await getOrLoadBootstrapFiles({
        profileDir: params.profileDir,
        userProfilePath: params.userProfilePath,
        sessionKey,
      })
    : [
        ...loadUserProfileBootstrapFile(params.userProfilePath),
        ...loadProfileBootstrapFiles(params.profileDir),
      ];
  const filtered = filterBootstrapFilesForSession(rawFiles, sessionKey);
  return filterHeartbeatBootstrapFile(filtered, params.excludeHeartbeat ?? false);
}

export function resolveBootstrapContextSync(params: {
  profileDir: string;
  userProfilePath?: string;
  config?: Config;
  sessionKey?: string;
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
    params.sessionKey &&
    wasBootstrapContextInjected(params.sessionKey)
  ) {
    return { bootstrapFiles: [], contextFiles: [] };
  }
  const bootstrapFiles = resolveBootstrapFilesSync(params);
  const contextFiles = buildBootstrapContextFiles(bootstrapFiles, {
    maxChars: resolveBootstrapMaxChars(params.config),
    totalMaxChars: resolveBootstrapTotalMaxChars(params.config),
  });
  if (mode === 'continuation-skip' && params.sessionKey && contextFiles.length > 0) {
    markBootstrapContextInjected(params.sessionKey);
  }
  return { bootstrapFiles, contextFiles };
}

export async function resolveBootstrapContextForRun(params: {
  profileDir: string;
  userProfilePath?: string;
  config?: Config;
  sessionKey?: string;
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
    params.sessionKey &&
    wasBootstrapContextInjected(params.sessionKey)
  ) {
    return { bootstrapFiles: [], contextFiles: [] };
  }
  const bootstrapFiles = await resolveBootstrapFilesForRun(params);
  const contextFiles = buildBootstrapContextFiles(bootstrapFiles, {
    maxChars: resolveBootstrapMaxChars(params.config),
    totalMaxChars: resolveBootstrapTotalMaxChars(params.config),
    warn: params.warn,
  });
  if (mode === 'continuation-skip' && params.sessionKey && contextFiles.length > 0) {
    markBootstrapContextInjected(params.sessionKey);
  }
  return { bootstrapFiles, contextFiles };
}
