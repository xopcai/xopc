import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { CliAdapter } from './types.js';

const digest = (content: string) => createHash('sha256').update(content).digest('hex');

/** Install immutable, packaged provider specifications without touching credentials. */
export async function prepareCliAssets(adapter: CliAdapter, configPath: string): Promise<void> {
  if (!adapter.configAssets?.length) return;
  const root = await lstat(configPath);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Invalid CLI config directory.');
  for (const asset of adapter.configAssets) {
    const parts = asset.path.split('/');
    if (!parts.length || parts.some(part => !/^[a-zA-Z0-9_.-]+$/.test(part) || part === '.' || part === '..') || digest(asset.content) !== asset.sha256) throw new Error('Invalid packaged CLI asset.');
    let parent = configPath;
    for (const part of parts.slice(0, -1)) {
      parent = join(parent, part);
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid CLI asset directory.');
    }
    const path = join(configPath, asset.path);
    // Publish complete files atomically without replacing existing specs or following symlinks.
    const temporary = join(parent, `.asset-${randomUUID()}`);
    try {
      await writeFile(temporary, asset.content, { flag: 'wx', mode: 0o600 });
      try { await link(temporary, path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    } finally { await rm(temporary, { force: true }); }
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > Buffer.byteLength(asset.content) ||
      digest(await readFile(path, 'utf8')) !== asset.sha256) throw new Error('CLI specification integrity mismatch. Reconnect using a new account context.');
  }
}
