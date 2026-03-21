import { resolve, isAbsolute } from 'path';
import { homedir } from 'os';
import { resolveWorkspaceDir } from '../config/paths.js';

export function getWorkspacePath(customPath?: string): string {
  if (customPath) {
    return customPath.replace(/^~/, homedir());
  }
  return resolveWorkspaceDir();
}

export function createPathResolver(extensionDir: string, workspaceDir: string) {
  return (input: string): string => {
    if (input.startsWith('~')) {
      return input.replace('~', process.env.HOME || '');
    }
    if (input.startsWith('.')) {
      return resolve(extensionDir, input);
    }
    if (!isAbsolute(input)) {
      return resolve(workspaceDir, input);
    }
    return input;
  };
}

/**
 * Resolve a path to absolute, supporting ~ home directory and cwd-relative paths.
 */
export function resolveToCwd(path: string, cwd: string): string {
  if (path.startsWith('~')) {
    return path.replace(/^~/, process.env.HOME || process.env.USERPROFILE || '');
  }
  if (path.startsWith('/')) {
    return path;
  }
  return `${cwd}/${path}`;
}
