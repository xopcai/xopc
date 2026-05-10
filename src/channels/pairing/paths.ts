import { join } from 'node:path';

import { ENV_VARS, resolveStateDir } from '../../config/paths-state.js';

import type { StandardPairingChannel } from './pairing-channel.js';

export function resolveDefaultCredentialsDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env[ENV_VARS.CREDENTIALS_DIR]?.trim();
  if (explicit) return explicit;
  return join(resolveStateDir(env), 'credentials');
}

function safeAccountKey(accountId: string): string {
  return accountId
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\.\./g, '_');
}

/** Same layout as `extensions/feishu` `resolveFeishuFrameworkAllowFromPath` for `feishu`. */
export function resolveStandardAllowFromPath(
  channel: StandardPairingChannel,
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = `xopc-${channel}`.replace(/[\\/:*?"<>|]/g, '_');
  const safe = safeAccountKey(accountId);
  return join(resolveDefaultCredentialsDir(env), `${base}-${safe}-allowFrom.json`);
}

export function resolveStandardPairingPath(
  channel: StandardPairingChannel,
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = `xopc-${channel}`.replace(/[\\/:*?"<>|]/g, '_');
  const safe = safeAccountKey(accountId);
  return join(resolveDefaultCredentialsDir(env), `${base}-${safe}-pairing.json`);
}

/** Weixin stores under `~/.xopc/weixin/credentials/` (matches `extensions/weixin` accounts helper). */
export function resolveWeixinAllowFromPath(accountId: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = 'xopc-weixin'.replace(/[\\/:*?"<>|]/g, '_');
  const safe = safeAccountKey(accountId);
  const credRoot = env[ENV_VARS.CREDENTIALS_DIR]?.trim()
    ? env[ENV_VARS.CREDENTIALS_DIR]!
    : join(resolveStateDir(env), 'weixin', 'credentials');
  return join(credRoot, `${base}-${safe}-allowFrom.json`);
}

export function resolveWeixinPairingPath(accountId: string, env: NodeJS.ProcessEnv = process.env): string {
  const allow = resolveWeixinAllowFromPath(accountId, env);
  return allow.replace(/-allowFrom\.json$/i, '-pairing.json');
}
