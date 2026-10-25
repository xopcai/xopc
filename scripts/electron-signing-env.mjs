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
export function loadElectronSigningEnv(root, inherited = process.env, platform = process.platform) {
  const path = join(root, '.env.local');
  const local = existsSync(path) ? parse(readFileSync(path)) : {};
  const env = { ...inherited };
  for (const [key, alias] of Object.entries(aliases)) {
    if (platform === 'win32' && key.startsWith('CSC_')) continue;
    const value = inherited[key] || inherited[alias] || local[key] || local[alias];
    if (value) env[key] = value;
  }
  if (platform === 'win32') {
    // Generic CSC_* may contain a macOS Developer ID certificate.
    delete env.CSC_LINK;
    delete env.CSC_KEY_PASSWORD;
    for (const key of ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'XOPC_WINDOWS_PUBLISHER']) {
      const alias = key.startsWith('XOPC_') ? key : `XOPC_${key}`;
      const value = inherited[key] ?? inherited[alias] ?? local[key] ?? local[alias];
      if (value !== undefined) env[key] = value;
    }
    if (env.WIN_CSC_LINK) {
      env.CSC_LINK = env.WIN_CSC_LINK;
      env.CSC_KEY_PASSWORD = env.WIN_CSC_KEY_PASSWORD ?? '';
    }
  }
  return env;
}
