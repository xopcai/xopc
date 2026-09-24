import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { app } from 'electron';

export function resolvePackagedAppPath(...segments: string[]): string {
  const appPath = app.getAppPath();
  const unpacked = join(dirname(appPath), 'app.asar.unpacked', ...segments);
  if (existsSync(unpacked)) return unpacked;
  return join(appPath, ...segments);
}

/** Make SQLite assets available before the Electron main process opens the catalog database. */
export function configurePackagedSqliteAssetRoot(): void {
  if (!app.isPackaged || process.env.XOPC_SQLITE_ASSET_ROOT?.trim()) return;
  process.env.XOPC_SQLITE_ASSET_ROOT = resolvePackagedAppPath('out', 'server');
}
