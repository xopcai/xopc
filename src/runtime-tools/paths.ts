import { join } from 'node:path';

import type { RuntimeKind } from './types.js';

export function runtimeToolsRoot(stateDir: string): string {
  return join(stateDir, 'tools');
}
export function runtimeVersionDir(stateDir: string, runtime: RuntimeKind, version: string): string {
  return join(runtimeToolsRoot(stateDir), runtime, 'versions', version);
}

export function runtimeManifestPath(stateDir: string, runtime: RuntimeKind): string {
  return join(runtimeToolsRoot(stateDir), 'manifests', `${runtime}.json`);
}

export function runtimeLockPath(stateDir: string, runtime: RuntimeKind, version: string): string {
  return join(runtimeToolsRoot(stateDir), 'locks', `${runtime}-${version}.lock`);
}

export function runtimeDownloadPath(stateDir: string, archiveFile: string): string {
  return join(runtimeToolsRoot(stateDir), 'downloads', `${archiveFile}.partial`);
}

export function runtimeStagingDir(
  stateDir: string,
  runtime: RuntimeKind,
  version: string,
  operationId: string,
): string {
  return join(runtimeToolsRoot(stateDir), 'staging', `${runtime}-${version}-${operationId}`);
}
