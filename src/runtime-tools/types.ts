import type { RuntimeToolsConfig } from '../config/schema.js';

export type RuntimeKind = 'node' | 'uv' | 'python';
export type RuntimeSource = 'managed' | 'system';
export type RuntimeState =
  | 'disabled'
  | 'unsupported'
  | 'absent'
  | 'installing'
  | 'ready'
  | 'degraded'
  | 'corrupted'
  | 'failed';

export interface RuntimeExecutables {
  primary: string;
  node?: string;
  npm?: string;
  npx?: string;
  corepack?: string;
  uv?: string;
  uvx?: string;
  python?: string;
}
export interface InstalledRuntimeManifest {
  schemaVersion: 1;
  runtime: RuntimeKind;
  version: string;
  source: RuntimeSource;
  platform: string;
  arch: string;
  installDir: string;
  executables: RuntimeExecutables;
  installedAt: string;
  verifiedAt: string;
  distribution?: {
    url: string;
    sha256: string;
    archiveFile: string;
    catalogVersion: string;
  };
  probe: {
    versionOutput: string;
    packageManagerVersion?: string;
  };
}

export interface ResolvedRuntime {
  runtime: RuntimeKind;
  version: string;
  source: RuntimeSource;
  executable: string;
  executables: RuntimeExecutables;
  installDir?: string;
}

export interface RuntimeStatus {
  runtime: RuntimeKind;
  state: RuntimeState;
  requestedVersion: string;
  resolved?: ResolvedRuntime;
  message: string;
  repairable: boolean;
}

export interface RuntimeRequest {
  runtime: RuntimeKind;
  version?: string;
  allowProvision?: boolean;
  signal?: AbortSignal;
}

export interface RuntimeManagerOptions {
  stateDir: string;
  config: RuntimeToolsConfig;
}

export interface RuntimeProgressEvent {
  operationId: string;
  runtime: RuntimeKind;
  phase: 'resolve' | 'download' | 'verify' | 'extract' | 'install' | 'probe' | 'complete';
  message: string;
  downloadedBytes?: number;
  totalBytes?: number;
}
