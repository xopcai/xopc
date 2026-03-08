import { resolve, isAbsolute } from 'path';
import { homedir } from 'os';
import { DEFAULT_PATHS } from '../config/paths.js';

export function getWorkspacePath(customPath?: string): string {
  if (customPath) {
    return customPath.replace(/^~/, homedir());
  }
  return DEFAULT_PATHS.workspace;
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
