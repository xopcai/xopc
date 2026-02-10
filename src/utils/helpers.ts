import { existsSync, mkdirSync } from 'fs';
import { dirname, resolve, isAbsolute } from 'path';
import { homedir } from 'os';
import { DEFAULT_PATHS } from '../config/paths.js';

export function ensureDir(path: string): void {
  if (!existsSync(dirname(path))) {
    mkdirSync(dirname(path), { recursive: true });
  }
}

export function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9\-_]/g, '_');
}

export function todayDate(): string {
  return new Date().toISOString().split('T')[0];
}

export function getWorkspacePath(customPath?: string): string {
  if (customPath) {
    return customPath.replace(/^~/, homedir());
  }
  return DEFAULT_PATHS.workspace;
}

export function createPathResolver(pluginDir: string, workspaceDir: string) {
  return (input: string): string => {
    if (input.startsWith('~')) {
      return input.replace('~', process.env.HOME || '');
    }
    if (input.startsWith('.')) {
      return resolve(pluginDir, input);
    }
    if (!isAbsolute(input)) {
      return resolve(workspaceDir, input);
    }
    return input;
  };
}
