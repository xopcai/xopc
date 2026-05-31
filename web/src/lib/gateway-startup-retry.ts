import { apiFetch } from '@/lib/fetch';

const STARTUP_RETRY_TIMEOUT_MS = 60_000;
const STARTUP_RETRY_DEFAULT_MS = 500;
const STARTUP_RETRY_MAX_MS = 5_000;

export type StartupUnavailableErrorBody = {
  ok: false;
  error: string;
  code: 'STARTUP_UNAVAILABLE';
  retryable: true;
  retryAfterMs: number;
  method: string;
};

export function isStartupUnavailableBody(body: unknown): body is StartupUnavailableErrorBody {
  if (!body || typeof body !== 'object') {
    return false;
  }
  const record = body as Record<string, unknown>;
  return (
    record.code === 'STARTUP_UNAVAILABLE' &&
    record.retryable === true &&
    typeof record.retryAfterMs === 'number'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveStartupRetryDelayMs(body: StartupUnavailableErrorBody): number {
  const retryAfterMs =
    typeof body.retryAfterMs === 'number' ? body.retryAfterMs : STARTUP_RETRY_DEFAULT_MS;
  return Math.min(Math.max(retryAfterMs, 100), STARTUP_RETRY_MAX_MS);
}

/**
 * Retry gateway session/history requests while the server is still finishing startup.
 */
export async function apiFetchWithStartupRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { timeoutMs?: number },
): Promise<Response> {
  const startedAt = Date.now();
  const timeoutMs = options?.timeoutMs ?? STARTUP_RETRY_TIMEOUT_MS;

  for (;;) {
    const res = await apiFetch(input, init);
    if (res.status !== 503) {
      return res;
    }

    const body = (await res.clone().json().catch(() => null)) as unknown;
    if (!isStartupUnavailableBody(body)) {
      return res;
    }

    if (Date.now() - startedAt >= timeoutMs) {
      return res;
    }

    await sleep(resolveStartupRetryDelayMs(body));
  }
}
