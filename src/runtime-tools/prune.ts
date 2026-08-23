import { lstat, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { RuntimeToolsConfig } from '../config/schema.js';
import { readRuntimeManifest } from './manifest-store.js';
import { runtimeToolsRoot } from './paths.js';
import type { RuntimeKind } from './types.js';

const RUNTIMES: RuntimeKind[] = ['node', 'uv', 'python'];
const STALE_TEMP_MS = 24 * 60 * 60 * 1_000;

export type RuntimePruneResult = { removed: string[]; reclaimedBytes: number };

async function pathSize(path: string): Promise<number> {
  const details = await lstat(path);
  if (details.isSymbolicLink()) return details.size;
  if (!details.isDirectory()) return details.size;
  let total = 0;
  for (const entry of await readdir(path)) total += await pathSize(join(path, entry));
  return total;
}

async function listEntries(path: string): Promise<Array<{ path: string; mtimeMs: number; size: number }>> {
  try {
    return await Promise.all((await readdir(path)).map(async (name) => {
      const entryPath = join(path, name);
      const details = await stat(entryPath);
      return { path: entryPath, mtimeMs: details.mtimeMs, size: await pathSize(entryPath) };
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function pruneRuntimeTools(params: {
  stateDir: string;
  config: RuntimeToolsConfig;
  now?: number;
}): Promise<RuntimePruneResult> {
  const removed: string[] = [];
  let reclaimedBytes = 0;
  const root = runtimeToolsRoot(params.stateDir);

  for (const runtime of RUNTIMES) {
    const versionsRoot = join(root, runtime, 'versions');
    const entries = (await listEntries(versionsRoot)).sort((a, b) => b.mtimeMs - a.mtimeMs);
    const manifest = await readRuntimeManifest(params.stateDir, runtime);
    const entryPaths = new Set(entries.map((entry) => resolve(entry.path)));
    const activePath = manifest && entryPaths.has(resolve(manifest.installDir))
      ? resolve(manifest.installDir)
      : null;
    const keep = new Set<string>();
    if (activePath) keep.add(activePath);
    for (const entry of entries) {
      if (keep.size >= params.config.retention.keepVersions) break;
      keep.add(resolve(entry.path));
    }
    for (const entry of entries) {
      if (keep.has(resolve(entry.path))) continue;
      await rm(entry.path, { recursive: true, force: true });
      removed.push(entry.path);
      reclaimedBytes += entry.size;
    }
  }

  const now = params.now ?? Date.now();
  for (const entry of await listEntries(join(root, 'staging'))) {
    if (now - entry.mtimeMs < STALE_TEMP_MS) continue;
    await rm(entry.path, { recursive: true, force: true });
    removed.push(entry.path);
    reclaimedBytes += entry.size;
  }

  const maxCacheBytes = params.config.retention.maxCacheBytes;
  if (maxCacheBytes !== undefined) {
    const cacheEntries = (await listEntries(join(root, 'downloads')))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    let retained = 0;
    for (const entry of cacheEntries) {
      if (retained + entry.size <= maxCacheBytes) {
        retained += entry.size;
        continue;
      }
      await rm(entry.path, { recursive: true, force: true });
      removed.push(entry.path);
      reclaimedBytes += entry.size;
    }
  }
  return { removed, reclaimedBytes };
}
