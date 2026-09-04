import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  runtimeManifestPath,
  runtimeVersionManifestDir,
  runtimeVersionManifestPath,
} from './paths.js';
import type { InstalledRuntimeManifest, RuntimeKind } from './types.js';

function isManifest(value: unknown, runtime: RuntimeKind): value is InstalledRuntimeManifest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<InstalledRuntimeManifest>;
  return item.schemaVersion === 1
    && item.runtime === runtime
    && typeof item.version === 'string'
    && typeof item.verifiedAt === 'string'
    && typeof item.installDir === 'string'
    && !!item.executables
    && typeof item.executables.primary === 'string';
}
export async function readRuntimeManifest(
  stateDir: string,
  runtime: RuntimeKind,
): Promise<InstalledRuntimeManifest | null> {
  const manifests = await readRuntimeManifests(stateDir, runtime);
  return manifests[0] ?? null;
}

async function readManifestFile(path: string, runtime: RuntimeKind): Promise<InstalledRuntimeManifest | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return isManifest(parsed, runtime) ? parsed : null;
  } catch {
    return null;
  }
}

export async function readRuntimeManifests(
  stateDir: string,
  runtime: RuntimeKind,
): Promise<InstalledRuntimeManifest[]> {
  const manifests: InstalledRuntimeManifest[] = [];
  const versionRoot = runtimeVersionManifestDir(stateDir, runtime);
  try {
    const names = (await readdir(versionRoot)).filter((name) => name.endsWith('.json')).sort();
    for (const name of names) {
      const manifest = await readManifestFile(join(versionRoot, name), runtime);
      if (manifest) manifests.push(manifest);
    }
  } catch {
    // Older installations only have the legacy per-runtime manifest below.
  }
  const legacy = await readManifestFile(runtimeManifestPath(stateDir, runtime), runtime);
  if (legacy && !manifests.some((manifest) => manifest.version === legacy.version)) {
    manifests.push(legacy);
  }
  return manifests.sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));
}

export async function writeRuntimeManifest(
  stateDir: string,
  manifest: InstalledRuntimeManifest,
): Promise<void> {
  const target = runtimeVersionManifestPath(stateDir, manifest.runtime, manifest.version);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

export async function removeRuntimeManifest(
  stateDir: string,
  runtime: RuntimeKind,
  version: string,
): Promise<void> {
  await rm(runtimeVersionManifestPath(stateDir, runtime, version), { force: true });
  const legacyPath = runtimeManifestPath(stateDir, runtime);
  const legacy = await readManifestFile(legacyPath, runtime);
  if (legacy?.version === version) await rm(legacyPath, { force: true });
}
