import { useCallback, useRef, useState } from 'react';

import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

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
            status: json.error === 'busy' ? 409 : 500,
          };
        }
      } catch {
        final = { ok: false, error: 'parse', status: 0 };
      }
    }
  };

  try {
    while (final === null) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (chunk.length) handleSseBlock(chunk);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (final) return final;

  return { ok: false, error: 'no-result', status: 0 };
}

export function useBrowserInstallStream() {
  const [progress, setProgress] = useState<BrowserInstallStreamState>(emptyState);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const reset = useCallback(() => {
    setProgress(emptyState());
  }, []);

  const run = useCallback(
    async <T,>(opts: {
      path: string;
      body?: unknown;
      fallbackError: string;
    }): Promise<BrowserInstallStreamResult<T> & { errorMessage?: string }> => {
      if (runningRef.current) {
        return { ok: false, error: 'busy', errorMessage: opts.fallbackError };
      }

      runningRef.current = true;
      setRunning(true);
      setProgress(emptyState());

      try {
        const res = await apiFetch(apiUrl(opts.path), {
          method: 'POST',
          headers: {
            Accept: 'text/event-stream',
            ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
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

        const result = await consumeBrowserInstallSse<T>(res.body, (event) => {
          setProgress((prev) => applyProgress(prev, event));
        });

        if (!result.ok) {
          return {
            ...result,
            errorMessage:
              result.message ??
              (result.error === 'busy'
                ? 'Another browser install is already in progress.'
                : opts.fallbackError),
          };
        }

        return result;
      } catch (err) {
        return {
          ok: false,
          error: 'network',
          errorMessage: err instanceof Error ? err.message : opts.fallbackError,
        };
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [],
  );

  return { progress, running, run, reset };
}
