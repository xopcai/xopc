/**
 * ACP Runtime Errors
 * 
 * Error types for ACP runtime operations.
 */

/** ACP Runtime 错误代码 */
export type AcpRuntimeErrorCode =
  | "ACP_SESSION_INIT_FAILED"
  | "ACP_TURN_FAILED"
  | "ACP_BACKEND_MISSING"
  | "ACP_BACKEND_UNAVAILABLE"
  | "ACP_BACKEND_UNSUPPORTED_CONTROL";

/** ACP Runtime 错误 */
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

/** 标准化 ACP 错误代码 */
export function normalizeAcpErrorCode(code: string | undefined): AcpRuntimeErrorCode {
  const validCodes: AcpRuntimeErrorCode[] = [
    "ACP_SESSION_INIT_FAILED",
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

/** 转换为 AcpRuntimeError */
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

/** ACP Runtime 错误边界 */
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

/** 创建不支持的控制错误 */
export function createUnsupportedControlError(params: {
  backend: string;
  control: string;
}): AcpRuntimeError {
  return new AcpRuntimeError(
    "ACP_BACKEND_UNSUPPORTED_CONTROL",
    `ACP backend "${params.backend}" does not support control "${params.control}".`,
  );
}