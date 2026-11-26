import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { resolveUserPath } from '../../../agent-scope.js';
import { findHostExecutable } from '../../executable-search.js';
import { buildExternalRuntimeEnv } from '../../runtime-env.js';

/** Locate the Claude Code CLI executable on the host. */
export function findClaudeExecutable(override?: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const home = homedir();
  return findHostExecutable({
    names: ['claude'],
    configuredPath: override,
    envVar: 'XOPC_CLAUDE_BIN',
    extraSearchDirs: [join(home, '.claude', 'local')],
    env,
  });
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
