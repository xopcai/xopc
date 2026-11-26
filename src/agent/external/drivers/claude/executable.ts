import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { buildExternalRuntimeEnv } from '../../runtime-env.js';
import { resolveUserPath } from '../../../agent-scope.js';

function isExecutableFile(candidate: string): boolean {
  try {
    accessSync(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function candidateNames(): string[] {
  return process.platform === 'win32' ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
}

/** Locate the Claude Code CLI executable on the host. */
export function findClaudeExecutable(override?: string): string | undefined {
  const trimmed = override?.trim();
  if (trimmed) {
    const expanded = resolveUserPath(trimmed);
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      return existsSync(expanded) ? expanded : undefined;
    }
    const envPath = process.env.PATH ?? '';
    for (const dir of envPath.split(delimiter).filter(Boolean)) {
      const full = join(dir, trimmed);
      if (isExecutableFile(full)) return full;
    }
    return undefined;
  }

  const names = candidateNames();
  const envPath = process.env.PATH ?? '';
  for (const dir of envPath.split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const full = join(dir, name);
      if (isExecutableFile(full)) return full;
    }
  }

  const home = homedir();
  const fallbackDirs = [
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  for (const dir of fallbackDirs) {
    for (const name of names) {
      const full = join(dir, name);
      if (isExecutableFile(full)) return full;
    }
  }
  return undefined;
}

function readClaudeApiKeyHelperVariable(settingsDir: string): string | undefined {
  try {
    const settings = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf8')) as { apiKeyHelper?: unknown } | null;
    if (typeof settings?.apiKeyHelper !== 'string') return undefined;
    // Only the user profile may opt in a credential. Project settings and arbitrary shell helpers cannot.
    const key = /^(?:(?:\/usr)?\/bin\/)?printenv[ \t]+(["']?)([A-Z][A-Z0-9_]*_API_KEY)\1$/
      .exec(settings.apiKeyHelper.trim())?.[2];
    return key && !key.startsWith('XOPC_') ? key : undefined;
  } catch {
    return undefined;
  }
}

/** Build the process environment for spawning Claude Code CLI. */
export function buildClaudeEnv(configDir?: string): NodeJS.ProcessEnv {
  const env = buildExternalRuntimeEnv('claude');
  const configuredDir = configDir?.trim() || env.CLAUDE_CONFIG_DIR?.trim();
  const settingsDir = configuredDir ? resolve(resolveUserPath(configuredDir)) : join(homedir(), '.claude');
  if (configuredDir) env.CLAUDE_CONFIG_DIR = settingsDir;
  const key = readClaudeApiKeyHelperVariable(settingsDir);
  if (key && process.env[key]) env[key] = process.env[key];
  return env;
}
