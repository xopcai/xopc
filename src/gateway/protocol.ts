/**
 * Gateway protocol types — Streamable HTTP / SSE transport.
 *
 * All client → server communication uses standard HTTP (POST/GET/PATCH/DELETE).
 * Server → client streaming uses SSE (text/event-stream).
 */

// ---------- HTTP response envelope ----------

export interface ApiResponse<T = unknown> {
  ok: boolean;
  payload?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
}

// ---------- SSE event shape ----------

export interface SSEEvent {
  id: string;
  event: string;        // e.g. "status", "token", "error", "result", "config.reload"
  data: unknown;
}

// ---------- Gateway config ----------

export interface GatewayConfig {
  host: string;
  port: number;
  token?: string;
  verbose?: boolean;
}

// ---------- Helpers ----------

export function apiOk<T>(payload: T): ApiResponse<T> {
  return { ok: true, payload };
}

export function apiError(code: string, message: string): ApiResponse<never> {
  return { ok: false, error: { code, message } };
}
