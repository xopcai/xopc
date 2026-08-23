import type { RuntimeKind } from './types.js';

export type RuntimeErrorCode =
  | 'RUNTIME_DISABLED'
  | 'RUNTIME_UNSUPPORTED'
  | 'RUNTIME_NOT_FOUND'
  | 'RUNTIME_VERSION_MISMATCH'
  | 'RUNTIME_DOWNLOAD_FAILED'
  | 'RUNTIME_CHECKSUM_MISMATCH'
  | 'RUNTIME_ARCHIVE_INVALID'
  | 'RUNTIME_INSTALL_LOCKED'
  | 'RUNTIME_PROBE_FAILED'
  | 'RUNTIME_CORRUPTED'
  | 'RUNTIME_PERMISSION_DENIED';

export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly code: RuntimeErrorCode,
    readonly runtime: RuntimeKind,
    readonly phase: string,
    readonly repairable: boolean,
    readonly hints: string[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RuntimeError';
  }
}
