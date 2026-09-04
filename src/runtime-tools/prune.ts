import { lstat, readdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import type { RuntimeToolsConfig } from '../config/schema.js';
import { DEFAULT_RUNTIME_VERSIONS } from './catalog.js';
import { readRuntimeManifests, removeRuntimeManifest } from './manifest-store.js';
import { runtimeLockPath, runtimeToolsRoot } from './paths.js';
import { withInstallLock } from './install-lock.js';
import { versionSatisfies } from './probe.js';
import type { RuntimeKind } from './types.js';

const RUNTIMES: RuntimeKind[] = ['node', 'uv', 'python'];
const STALE_TEMP_MS = 24 * 60 * 60 * 1_000;

function configuredVersion(config: RuntimeToolsConfig, runtime: RuntimeKind): string {
  if (runtime === 'node') return config.node.version ?? DEFAULT_RUNTIME_VERSIONS.node;
  if (runtime === 'python') return config.python.version ?? DEFAULT_RUNTIME_VERSIONS.python;
  return config.uv.version ?? DEFAULT_RUNTIME_VERSIONS.uv;
}

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
    await withInstallLock(runtimeLockPath(params.stateDir, runtime, 'prune'), {
      pid: process.pid,
      runtime,
      action: 'prune',
    }, async () => {
      const versionsRoot = join(root, runtime, 'versions');
      const entries = (await listEntries(versionsRoot)).sort((a, b) => b.mtimeMs - a.mtimeMs);
      const manifests = await readRuntimeManifests(params.stateDir, runtime);
      const manifest = manifests.find((item) => (
        versionSatisfies(item.version, configuredVersion(params.config, runtime))
      )) ?? manifests[0];
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
        await removeRuntimeManifest(params.stateDir, runtime, basename(entry.path));
        removed.push(entry.path);
        reclaimedBytes += entry.size;
      }
    });
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
      .filter((entry) => !entry.path.endsWith('.partial'))
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
