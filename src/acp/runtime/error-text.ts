/**
 * ACP Runtime Error Text Localization
 *
 * Provides user-friendly error messages with actionable next steps.
 */

import { AcpRuntimeError, type AcpRuntimeErrorCode, toAcpRuntimeError } from "../runtime/errors.js";

/** Get next step suggestion for an error */
function resolveErrorNextStep(error: AcpRuntimeError): string | undefined {
  switch (error.code) {
    case "ACP_BACKEND_MISSING":
    case "ACP_BACKEND_UNAVAILABLE":
      return "Run `acp doctor` to check backend status, install/enable the backend plugin, then retry.";
    
    case "ACP_SESSION_INIT_FAILED":
      return "If this session is stale, recreate it with a new session key.";
    
    case "ACP_BACKEND_UNSUPPORTED_CONTROL":
      return "This backend does not support that control; use a supported command or switch backend.";
    
    case "ACP_TURN_FAILED":
      return "Retry the request, or cancel current turn and try again.";
    
    default:
      return undefined;
  }
}

/** Format error for display with next step suggestion */
export function formatAcpErrorText(error: AcpRuntimeError): string {
  const next = resolveErrorNextStep(error);
  if (!next) {
    return `ACP error (${error.code}): ${error.message}`;
  }
  return `ACP error (${error.code}): ${error.message}\n💡 ${next}`;
}

/** Convert unknown error to formatted text */
export function toAcpErrorText(params: {
  error: unknown;
  fallbackCode: AcpRuntimeErrorCode;
  fallbackMessage: string;
}): string {
  const error = toAcpRuntimeError({
    error: params.error,
    fallbackCode: params.fallbackCode,
    fallbackMessage: params.fallbackMessage,
  });
  return formatAcpErrorText(error);
}

/** Format error for logging (without user suggestions) */
export function formatAcpErrorLog(error: AcpRuntimeError): string {
  return `[${error.code}] ${error.message}`;
}
