import { classifyFailoverReason, type FailoverReason } from './reason.js';

export type { FailoverReason };

export class FailoverError extends Error {
  constructor(
    message: string,
    readonly reason: FailoverReason,
    readonly provider?: string,
    readonly model?: string,
    readonly status?: number,
    readonly code?: string,
    cause?: unknown
  ) {
    super(message, { cause });
    this.name = 'FailoverError';
  }
}

export function isFailoverError(err: unknown): err is FailoverError {
  return err instanceof FailoverError;
}

export function describeFailoverError(err: unknown) {
  if (isFailoverError(err)) {
    return { message: err.message, reason: err.reason, status: err.status, code: err.code };
  }
  return { message: String(err), reason: classifyFailoverReason(err) };
}
