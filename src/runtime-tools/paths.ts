import { join, relative, resolve } from 'node:path';

import type { RuntimeKind } from './types.js';

export function runtimeToolsRoot(stateDir: string): string {
  return join(stateDir, 'tools');
}
export function runtimeVersionDir(stateDir: string, runtime: RuntimeKind, version: string): string {
  return containedPath(join(runtimeToolsRoot(stateDir), runtime, 'versions'), version, 'runtime version');
}

export function runtimeVersionManifestDir(stateDir: string, runtime: RuntimeKind): string {
  return join(runtimeToolsRoot(stateDir), 'manifests', runtime);
}

export function runtimeVersionManifestPath(stateDir: string, runtime: RuntimeKind, version: string): string {
  return containedPath(runtimeVersionManifestDir(stateDir, runtime), `${version}.json`, 'runtime version');
}

export function runtimeLockPath(stateDir: string, runtime: RuntimeKind, version: string): string {
  void version;
  return join(runtimeToolsRoot(stateDir), 'locks', `${runtime}.lock`);
}

export function runtimeDownloadPath(stateDir: string, archiveFile: string): string {
  return containedPath(join(runtimeToolsRoot(stateDir), 'downloads'), `${archiveFile}.partial`, 'archive file');
}

export function runtimeStagingDir(
  stateDir: string,
  runtime: RuntimeKind,
  version: string,
  operationId: string,
): string {
  return containedPath(
    join(runtimeToolsRoot(stateDir), 'staging'),
    `${runtime}-${version}-${operationId}`,
    'runtime staging directory',
  );
}

function containedPath(root: string, child: string, label: string): string {
  if (child.includes('/') || child.includes('\\') || child.includes('\0')) {
    throw new Error(`Invalid ${label}: ${child}`);
  }
  const absoluteRoot = resolve(root);
  const target = resolve(absoluteRoot, child);
  const rel = relative(absoluteRoot, target);
  if (!rel || rel.startsWith('..') || rel.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`Invalid ${label}: ${child}`);
  }
  return target;
}
