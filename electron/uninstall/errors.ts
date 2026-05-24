import type { UninstallErrorCode } from './types.js';

export class UninstallError extends Error {
  readonly code: UninstallErrorCode;

  constructor(code: UninstallErrorCode) {
    super(code);
    this.name = 'UninstallError';
    this.code = code;
  }
}

export function isUninstallError(err: unknown): err is UninstallError {
  return err instanceof UninstallError;
}
