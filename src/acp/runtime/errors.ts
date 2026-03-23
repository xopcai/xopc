/**
 * ACP Runtime Errors
 * 
 * Error types for ACP runtime operations.
 */

/** ACP runtime error code */
export type AcpRuntimeErrorCode =
  | "ACP_SESSION_INIT_FAILED"
  | "ACP_SESSION_RESET_FAILED"
  | "ACP_TURN_FAILED"
  | "ACP_BACKEND_MISSING"
  | "ACP_BACKEND_UNAVAILABLE"
  | "ACP_BACKEND_UNSUPPORTED_CONTROL";

/** ACP runtime error */
export class AcpRuntimeError extends Error {
  constructor(
    public readonly code: AcpRuntimeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AcpRuntimeError";
  }
}

/** Normalize string to a known ACP error code */
export function normalizeAcpErrorCode(code: string | undefined): AcpRuntimeErrorCode {
  const validCodes: AcpRuntimeErrorCode[] = [
    "ACP_SESSION_INIT_FAILED",
    "ACP_SESSION_RESET_FAILED",
    "ACP_TURN_FAILED",
    "ACP_BACKEND_MISSING",
    "ACP_BACKEND_UNAVAILABLE",
    "ACP_BACKEND_UNSUPPORTED_CONTROL",
  ];
  
  if (code && validCodes.includes(code as AcpRuntimeErrorCode)) {
    return code as AcpRuntimeErrorCode;
  }
  return "ACP_TURN_FAILED";
}

/** Wrap unknown errors as `AcpRuntimeError` */
export function toAcpRuntimeError(params: {
  error: unknown;
  fallbackCode: AcpRuntimeErrorCode;
  fallbackMessage: string;
}): AcpRuntimeError {
  const { error, fallbackCode, fallbackMessage } = params;
  
  if (error instanceof AcpRuntimeError) {
    return error;
  }
  
  const message = error instanceof Error ? error.message : fallbackMessage;
  return new AcpRuntimeError(fallbackCode, message, {
    cause: error instanceof Error ? error : undefined,
  });
}

/** Run async work and map failures to `AcpRuntimeError` */
export async function withAcpRuntimeErrorBoundary<T>(params: {
  run: () => Promise<T>;
  fallbackCode: AcpRuntimeErrorCode;
  fallbackMessage: string;
}): Promise<T> {
  try {
    return await params.run();
  } catch (error) {
    throw toAcpRuntimeError({
      error,
      fallbackCode: params.fallbackCode,
      fallbackMessage: params.fallbackMessage,
    });
  }
}

/** Build unsupported-control error */
export function createUnsupportedControlError(params: {
  backend: string;
  control: string;
}): AcpRuntimeError {
  return new AcpRuntimeError(
    "ACP_BACKEND_UNSUPPORTED_CONTROL",
    `ACP backend "${params.backend}" does not support control "${params.control}".`,
  );
}