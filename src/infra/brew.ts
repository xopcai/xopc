import os from 'node:os';
import path from 'node:path';

function normalizePathValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function resolveBrewPathDirs(opts?: { homeDir?: string; env?: NodeJS.ProcessEnv }): string[] {
  const homeDir = opts?.homeDir ?? os.homedir();
  const env = opts?.env ?? process.env;
  const dirs: string[] = [];
  const prefix = normalizePathValue(env.HOMEBREW_PREFIX);
  if (prefix) {
    dirs.push(path.join(prefix, 'bin'), path.join(prefix, 'sbin'));
  }
  dirs.push(
    path.join(homeDir, '.linuxbrew', 'bin'),
    path.join(homeDir, '.linuxbrew', 'sbin'),
    '/home/linuxbrew/.linuxbrew/bin',
    '/home/linuxbrew/.linuxbrew/sbin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
  );
  return dirs;
}
