import { ProxyAgent, fetch as undiciFetch } from 'undici';

function toNativeAbortSignal(signal: unknown): AbortSignal | undefined {
  if (!signal) return undefined;
  if (signal instanceof AbortSignal) return signal;

  const maybeSignal = signal as {
    aborted?: boolean;
    reason?: unknown;
    addEventListener?: (type: 'abort', listener: () => void, opts?: { once?: boolean }) => void;
  };
  if (typeof maybeSignal.addEventListener !== 'function') return undefined;

  const controller = new AbortController();
  if (maybeSignal.aborted) {
    controller.abort(maybeSignal.reason);
    return controller.signal;
  }
  maybeSignal.addEventListener('abort', () => controller.abort(maybeSignal.reason), { once: true });
  return controller.signal;
}

/** Build a fetch compatible with grammY client when an HTTP proxy is configured. */
export function createProxyFetch(proxyUrl: string): typeof fetch {
  const dispatcher = new ProxyAgent(proxyUrl);
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const { agent: _agent, compress: _compress, signal, ...rest } = (init ?? {}) as Record<string, unknown>;
    return undiciFetch(input as string, {
      ...rest,
      signal: toNativeAbortSignal(signal),
      dispatcher,
    }) as unknown as Promise<Response>;
  }) as typeof fetch;
}
