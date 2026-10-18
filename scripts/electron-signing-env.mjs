import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';

const aliases = {
  CSC_LINK: 'XOPC_CSC_LINK',
  CSC_KEY_PASSWORD: 'XOPC_CSC_KEY_PASSWORD',
  APPLE_ID: 'XOPC_APPLE_ID',
  APPLE_APP_SPECIFIC_PASSWORD: 'XOPC_APPLE_APP_SPECIFIC_PASSWORD',
  APPLE_TEAM_ID: 'XOPC_APPLE_TEAM_ID',
  APPLE_API_KEY: 'XOPC_APPLE_API_KEY',
  APPLE_API_KEY_ID: 'XOPC_APPLE_API_KEY_ID',
  APPLE_API_ISSUER: 'XOPC_APPLE_API_ISSUER',
  APPLE_KEYCHAIN_PROFILE: 'XOPC_APPLE_KEYCHAIN_PROFILE',
  APPLE_KEYCHAIN: 'XOPC_APPLE_KEYCHAIN',
};

/** Load only signing settings; explicit environment values take precedence. */
export function loadElectronSigningEnv(root, inherited = process.env) {
  const path = join(root, '.env.local');
  const local = existsSync(path) ? parse(readFileSync(path)) : {};
  const env = { ...inherited };
  for (const [key, alias] of Object.entries(aliases)) {
    const value = inherited[key] || inherited[alias] || local[key] || local[alias];
    if (value) env[key] = value;
  }
  return env;
}
