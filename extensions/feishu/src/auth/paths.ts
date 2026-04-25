import path from 'node:path';

import { resolveStateDir, ENV_VARS } from '@xopcai/xopc/config/paths-state.js';

export function resolveFeishuCredentialsDir(): string {
  const explicit = process.env[ENV_VARS.CREDENTIALS_DIR]?.trim();
  if (explicit) return explicit;
  return path.join(resolveStateDir(), 'credentials');
}

export function resolveFeishuFrameworkAllowFromPath(accountId: string): string {
  const base = 'xopc-feishu'.replace(/[\\/:*?"<>|]/g, '_');
  const safeAccount = accountId
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.\./g, '_');
  return path.join(resolveFeishuCredentialsDir(), `${base}-${safeAccount}-allowFrom.json`);
}

