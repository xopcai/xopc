import { useCallback, useRef, useState } from 'react';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

const SSE_BLOCK_DELIM = '\n\n';
const CRLF_RE = /\r\n/g;

export type BrowserInstallKind = 'playwright' | 'cloakbrowser';

export type BrowserInstallPhase =
  | 'starting'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'running'
  | 'ready';

export type BrowserInstallProgressEvent = {
  phase: BrowserInstallPhase;
  message?: string;
  percent?: number | null;
  bytesReceived?: number;
  totalBytes?: number | null;
  line?: string;
  source?: 'stdout' | 'stderr';
};

export type BrowserInstallStreamState = {
  phase: BrowserInstallPhase | null;
  message: string | null;
  percent: number | null;
  lines: string[];
};

export type BrowserInstallStreamResult<T = unknown> =
  | { ok: true; payload: T }
  | { ok: false; error: string; message?: string; status?: number };

const INSTALL_PATH: Record<BrowserInstallKind, string> = {
  playwright: '/api/browser/playwright/install/stream',
  cloakbrowser: '/api/browser/cloakbrowser/install/stream',
};

const CANCEL_PATH: Record<BrowserInstallKind, string> = {
  playwright: '/api/browser/playwright/install/cancel',
  cloakbrowser: '/api/browser/cloakbrowser/install/cancel',
};

const MAX_LOG_LINES = 8;

function emptyState(): BrowserInstallStreamState {
  return { phase: null, message: null, percent: null, lines: [] };
}

function applyProgress(
  prev: BrowserInstallStreamState,
  event: BrowserInstallProgressEvent,
): BrowserInstallStreamState {
  const next: BrowserInstallStreamState = {
    phase: event.phase,
    message: event.message ?? event.line ?? prev.message,
    percent: event.percent ?? prev.percent,
    lines: prev.lines,
  };

  if (event.line) {
    const lines = [...prev.lines, event.line];
    next.lines = lines.length > MAX_LOG_LINES ? lines.slice(-MAX_LOG_LINES) : lines;
  }

  return next;
}

async function consumeBrowserInstallSse<T>(
  body: ReadableStream<Uint8Array>,
  onProgress: (event: BrowserInstallProgressEvent) => void,
  signal?: AbortSignal,
): Promise<BrowserInstallStreamResult<T>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: BrowserInstallStreamResult<T> | null = null;

  const handleSseBlock = (block: string) => {
    let ev = '';
    let dataPayload = '';
    for (const line of block.split('\n')) {
      const L = line.replace(/\r$/, '');
      if (L.startsWith('event:')) ev = L.slice(6).trim();
      else if (L.startsWith('data:')) dataPayload += L.slice(5).trimStart();
    }
    if (!dataPayload) return;

    if (ev === 'progress') {
      try {
        const parsed = JSON.parse(dataPayload) as BrowserInstallProgressEvent;
        if (parsed && typeof parsed === 'object' && typeof parsed.phase === 'string') {
          onProgress(parsed);
        }
      } catch {
        /* ignore malformed chunk */
      }
      return;
    }

    if (ev === 'result') {
      try {
        const json = JSON.parse(dataPayload) as {
          ok?: boolean;
          error?: string;
          message?: string;
          payload?: T;
        };
        if (json.ok) {
          final = { ok: true, payload: json.payload as T };
        } else {
          final = {
            ok: false,
            error: String(json.error ?? 'unknown'),
            message: typeof json.message === 'string' ? json.message : undefined,
            status:
              json.error === 'busy' ? 409 : json.error === 'cancelled' ? 499 : 500,
          };
        }
      } catch {
        final = { ok: false, error: 'parse', status: 0 };
      }
    }
  };

  try {
    const readChunk = async (): Promise<BrowserInstallStreamResult<T>> => {
      if (final !== null) return final;
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        return { ok: false, error: 'cancelled', status: 499 };
      }
      const { done, value } = await reader.read();
      if (done) return final ?? { ok: false, error: 'no-result', status: 0 };
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(CRLF_RE, '\n');
      const parts = buffer.split(SSE_BLOCK_DELIM);
      buffer = parts.pop() ?? '';
      for (const chunk of parts) {
        if (chunk.length) handleSseBlock(chunk);
      }
      return readChunk();
    };
    const result = await readChunk();
    if (result) return result;
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      return { ok: false, error: 'cancelled', status: 499 };
    }
    throw err;
  } finally {
    reader.releaseLock();
  }

  if (final) return final;

  return signal?.aborted
    ? { ok: false, error: 'cancelled', status: 499 }
    : { ok: false, error: 'no-result', status: 0 };
}

/**
 * One instance per browser backend (playwright / cloakbrowser).
 * State survives switching backend tabs in the settings panel.
 */
export function useBrowserInstallStream(kind: BrowserInstallKind) {
  const [progress, setProgress] = useState<BrowserInstallStreamState>(emptyState);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    if (runningRef.current) return;
    setProgress(emptyState());
  }, []);

  const cancel = useCallback(async () => {
    if (!runningRef.current) return;
    setCancelling(true);
    try {
      await apiFetch(apiUrl(CANCEL_PATH[kind]), { method: 'POST' }).catch(() => {});
      abortRef.current?.abort();
    } finally {
      setCancelling(false);
    }
  }, [kind]);

  const run = useCallback(
    async <T,>(opts: {
      body?: unknown;
      fallbackError: string;
    }): Promise<BrowserInstallStreamResult<T> & { errorMessage?: string }> => {
      if (runningRef.current) {
        return {
          ok: false,
          error: 'busy',
          status: 409,
          errorMessage: 'An install for this browser type is already in progress.',
        };
      }

      const ac = new AbortController();
      abortRef.current = ac;
      runningRef.current = true;
      setRunning(true);
      setProgress(emptyState());

      try {
        const res = await apiFetch(apiUrl(INSTALL_PATH[kind]), {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: ac.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '');
          let message = `HTTP ${res.status}`;
          try {
            const j = JSON.parse(text) as { message?: string; error?: string };
            if (typeof j.message === 'string') message = j.message;
            else if (typeof j.error === 'string') message = j.error;
          } catch {
            if (text) message = text.slice(0, 500);
          }
          return {
            ok: false,
            error: res.status === 409 ? 'busy' : 'http',
            status: res.status,
            errorMessage: message,
          };
        }

        const result = await consumeBrowserInstallSse<T>(
          res.body,
          (event) => {
            setProgress((prev) => applyProgress(prev, event));
          },
          ac.signal,
        );

        if (!result.ok) {
          if (result.error === 'cancelled') {
            return { ...result, errorMessage: undefined };
          }
          return {
            ...result,
            errorMessage:
              result.message ??
              (result.error === 'busy'
                ? 'An install for this browser type is already in progress.'
                : opts.fallbackError),
          };
        }

        return result;
      } catch (err) {
        if (ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return { ok: false, error: 'cancelled', status: 499 };
        }
        return {
          ok: false,
          error: 'network',
          errorMessage: err instanceof Error ? err.message : opts.fallbackError,
        };
      } finally {
        if (abortRef.current === ac) {
          abortRef.current = null;
        }
        runningRef.current = false;
        setRunning(false);
        setCancelling(false);
      }
    },
    [kind],
  );

  return { progress, running, cancelling, run, reset, cancel };
}

export type BrowserInstallStream = ReturnType<typeof useBrowserInstallStream>;
