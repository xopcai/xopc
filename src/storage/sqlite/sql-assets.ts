import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Source and unbundled builds keep assets beside this module. Electron copies
// the same tree beside its single gateway bundle, where import.meta.url points.
const SQL_ASSET_ROOT = dirname(fileURLToPath(import.meta.url));

export function resolveSqliteAssetPath(relativePath: string): string {
  return join(SQL_ASSET_ROOT, relativePath);
}

export function readSqliteAsset(relativePath: string): string {
  return readFileSync(resolveSqliteAssetPath(relativePath), 'utf8');
}
