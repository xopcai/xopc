import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Source and unbundled builds keep assets beside this module. Packaged Electron
// explicitly points the gateway subprocess at its unpacked asset tree because
// import.meta.url can retain an app.asar path after an in-app update.
const DEFAULT_SQL_ASSET_ROOT = dirname(fileURLToPath(import.meta.url));

export function resolveSqliteAssetRoot(): string {
  return process.env.XOPC_SQLITE_ASSET_ROOT?.trim() || DEFAULT_SQL_ASSET_ROOT;
}

export function resolveSqliteAssetPath(relativePath: string): string {
  return join(resolveSqliteAssetRoot(), relativePath);
}

export function readSqliteAsset(relativePath: string): string {
  return readFileSync(resolveSqliteAssetPath(relativePath), 'utf8');
}
