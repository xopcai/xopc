import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { runtimeManifestPath } from './paths.js';
import type { InstalledRuntimeManifest, RuntimeKind } from './types.js';

function isManifest(value: unknown, runtime: RuntimeKind): value is InstalledRuntimeManifest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<InstalledRuntimeManifest>;
  return item.schemaVersion === 1
    && item.runtime === runtime
    && typeof item.version === 'string'
    && typeof item.installDir === 'string'
    && !!item.executables
    && typeof item.executables.primary === 'string';
}
export async function readRuntimeManifest(
  stateDir: string,
  runtime: RuntimeKind,
): Promise<InstalledRuntimeManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(runtimeManifestPath(stateDir, runtime), 'utf8')) as unknown;
    return isManifest(parsed, runtime) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeRuntimeManifest(
  stateDir: string,
  manifest: InstalledRuntimeManifest,
): Promise<void> {
  const target = runtimeManifestPath(stateDir, manifest.runtime);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}
