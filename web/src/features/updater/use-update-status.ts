import { useCallback, useEffect, useRef, useState } from 'react';

import { apiUrl } from '@/lib/url';
import { apiFetch } from '@/lib/fetch';

const SSE_BLOCK_DELIM = '\n\n';
const CRLF_RE = /\r\n/g;

/** Session flag: npm install finished but gateway process still on older `currentVersion`. */
export const NPM_PENDING_RESTART_KEY = 'xopc.npmPendingRestart';

// --- Types ---

export type NpmUpdateStatus = {
  currentVersion: string;
  updateAvailable: boolean;
  latestVersion: string | null;
  channel: string | null;
};

export type ElectronUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export type ElectronUpdateStatus = {
  state: ElectronUpdateState;
  version?: string;
  releaseNotes?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  message?: string;
};

export type UpdateStatus = {
  npm: NpmUpdateStatus | null;
  electron: ElectronUpdateStatus | null;
  isElectron: boolean;
};

export type NpmUpdateRunResult =
  | { ok: true; result: Record<string, unknown> | null }
  | { ok: false; error: string; message: string; status: number; result?: Record<string, unknown> | null };

const isElectronEnv =
  typeof window !== 'undefined' && (window as unknown as { electronAPI?: { updater?: unknown } }).electronAPI?.updater !== undefined;
const DEV_MOCK_STORAGE_KEY = 'xopc.dev.mockElectron';
const DEV_MOCK_EVENT = 'xopc:dev:mock-electron-changed';

type DevMockWindow = Window & {
  __xopcSetMockElectron?: (next: ElectronUpdateStatus | null) => void;
};

function readDevMockState(): ElectronUpdateStatus | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DEV_MOCK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ElectronUpdateStatus | null;
    return parsed && typeof parsed === 'object' && typeof parsed.state === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as DevMockWindow;
  if (!w.__xopcSetMockElectron) {
    w.__xopcSetMockElectron = (next: ElectronUpdateStatus | null) => {
      try {
        if (next === null) {
          window.localStorage.removeItem(DEV_MOCK_STORAGE_KEY);
        } else {
          window.localStorage.setItem(DEV_MOCK_STORAGE_KEY, JSON.stringify(next));
        }
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent<ElectronUpdateStatus | null>(DEV_MOCK_EVENT, { detail: next }));
    };
  }
}

function clearNpmPendingRestartIfMatched(currentVersion: string): void {
  if (!currentVersion || typeof window === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(NPM_PENDING_RESTART_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as { installedVersion?: string };
    const v = typeof p.installedVersion === 'string' ? p.installedVersion.trim() : '';
    if (v && v === currentVersion) {
      sessionStorage.removeItem(NPM_PENDING_RESTART_KEY);
    }
  } catch {
    /* ignore */
  }
}

function applyNpmStatus(next: NpmUpdateStatus): NpmUpdateStatus {
  clearNpmPendingRestartIfMatched(next.currentVersion);
  return next;
}

export function useUpdateStatus(): UpdateStatus & {
  /** Resolves true when the server returned a fresh npm status payload. */
  checkNow: () => Promise<boolean>;
  runNpmUpdate: () => Promise<NpmUpdateRunResult>;
  npmUpdateRunning: boolean;
  electronCheck: () => void;
  electronQuitAndInstall: () => void;
} {
  const [npm, setNpm] = useState<NpmUpdateStatus | null>(null);
  const [npmUpdateRunning, setNpmUpdateRunning] = useState(false);
  const [devMockElectron, setDevMockElectron] = useState<ElectronUpdateStatus | null>(() => readDevMockState());
  const [electron, setElectron] = useState<ElectronUpdateStatus | null>(
    isElectronEnv ? { state: 'idle' } : readDevMockState(),
  );
  const mockCheckTimeoutRef = useRef<number | null>(null);
  const isEffectiveElectron = isElectronEnv || devMockElectron !== null;

  useEffect(() => {
    if (isEffectiveElectron) return;
    void fetchNpmStatus().then((payload) => setNpm(applyNpmStatus(payload))).catch(() => {});

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (detail === null) {
        setNpm((prev) =>
          prev ? applyNpmStatus({ ...prev, updateAvailable: false, latestVersion: null, channel: null }) : prev,
        );
      } else if (detail && typeof detail === 'object') {
        const d = detail as { currentVersion?: string; latestVersion?: string; channel?: string };
        setNpm(
          applyNpmStatus({
            currentVersion: d.currentVersion ?? '',
            updateAvailable: true,
            latestVersion: d.latestVersion ?? null,
            channel: d.channel ?? null,
          }),
        );
      }
    };
    window.addEventListener('update-available', handler);
    return () => window.removeEventListener('update-available', handler);
  }, [isEffectiveElectron]);

  useEffect(() => {
    if (!isElectronEnv) return;
    const api = (window as unknown as { electronAPI: { updater: {
      getStatus: () => Promise<ElectronUpdateStatus>;
      onStatusChanged: (cb: (s: ElectronUpdateStatus) => void) => () => void;
    } } }).electronAPI.updater;

    void api.getStatus().then((s) => setElectron(s));

    const cleanup = api.onStatusChanged((s) => setElectron(s));
    return cleanup;
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ElectronUpdateStatus | null>).detail;
      setDevMockElectron(detail);
    };
    window.addEventListener(DEV_MOCK_EVENT, handler);
    return () => window.removeEventListener(DEV_MOCK_EVENT, handler);
  }, []);

  useEffect(
    () => () => {
      if (mockCheckTimeoutRef.current !== null) {
        window.clearTimeout(mockCheckTimeoutRef.current);
        mockCheckTimeoutRef.current = null;
      }
    },
    [],
  );

  const checkNow = useCallback(async (): Promise<boolean> => {
    if (isEffectiveElectron) return false;
    try {
      const res = await apiFetch(apiUrl('/api/update/check'), { method: 'POST' });
      if (!res.ok) return false;
      const json = (await res.json()) as { payload?: NpmUpdateStatus };
      if (json.payload) {
        setNpm(applyNpmStatus(json.payload));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [isEffectiveElectron]);

  const runNpmUpdate = useCallback(async (): Promise<NpmUpdateRunResult> => {
    if (isEffectiveElectron) {
      return {
        ok: false,
        error: 'not-applicable',
        message: 'npm update is not used in the desktop app.',
        status: 400,
      };
    }
    setNpmUpdateRunning(true);
    try {
      const res = await apiFetch(apiUrl('/api/update/run/stream'), {
        method: 'POST',
        headers: { Accept: 'text/event-stream' },
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        let message = `HTTP ${res.status}`;
        try {
          const j = JSON.parse(text) as { message?: string };
          if (typeof j.message === 'string') message = j.message;
        } catch {
          if (text) message = text.slice(0, 500);
        }
        return {
          ok: false,
          error: res.status === 409 ? 'busy' : 'unknown',
          message,
          status: res.status,
        };
      }

      const final = await consumeNpmUpdateSse(res.body);
      if (final.ok && final.result) {
        const r = final.result;
        if (r && typeof r === 'object' && r.status === 'ok' && typeof r.installedVersion === 'string') {
          try {
            sessionStorage.setItem(
              NPM_PENDING_RESTART_KEY,
              JSON.stringify({ installedVersion: r.installedVersion }),
            );
          } catch {
            /* ignore */
          }
          window.dispatchEvent(
            new CustomEvent('xopc:npm-update-installed', { detail: { version: r.installedVersion } }),
          );
        } else if (
          r &&
          typeof r === 'object' &&
          r.status === 'up-to-date' &&
          typeof r.latestVersion === 'string'
        ) {
          window.dispatchEvent(
            new CustomEvent('xopc:npm-update-installed', { detail: { version: r.latestVersion } }),
          );
        }
      }
      return final;
    } catch (err) {
      return {
        ok: false,
        error: 'network',
        message: err instanceof Error ? err.message : String(err),
        status: 0,
      };
    } finally {
      setNpmUpdateRunning(false);
    }
  }, [isEffectiveElectron]);

  const electronCheck = useCallback(() => {
    if (isElectronEnv) {
      void (window as unknown as { electronAPI: { updater: { check: () => void } } }).electronAPI.updater.check();
      return;
    }
    if (import.meta.env.DEV && devMockElectron !== null) {
      const w = window as DevMockWindow;
      w.__xopcSetMockElectron?.({ ...devMockElectron, state: 'checking' });
      if (mockCheckTimeoutRef.current !== null) {
        window.clearTimeout(mockCheckTimeoutRef.current);
      }
      mockCheckTimeoutRef.current = window.setTimeout(() => {
        w.__xopcSetMockElectron?.({ ...devMockElectron, state: 'not-available' });
        mockCheckTimeoutRef.current = null;
      }, 1500);
    }
  }, [devMockElectron]);

  const electronQuitAndInstall = useCallback(() => {
    if (isElectronEnv) {
      void (window as unknown as { electronAPI: { updater: { quitAndInstall: () => void } } }).electronAPI.updater.quitAndInstall();
    }
  }, []);

  const resolvedElectron = isElectronEnv ? electron : (devMockElectron ?? electron);

  return {
    npm,
    electron: resolvedElectron,
    isElectron: isEffectiveElectron,
    checkNow,
    runNpmUpdate,
    npmUpdateRunning,
    electronCheck,
    electronQuitAndInstall,
  };
}

let _npmStatusInflight: Promise<NpmUpdateStatus> | null = null;

/** Concurrent callers share one request (Strict Mode remounts + multiple `useUpdateStatus` mounts). */
async function fetchNpmStatus(): Promise<NpmUpdateStatus> {
  if (_npmStatusInflight) return _npmStatusInflight;
  _npmStatusInflight = (async () => {
    const res = await apiFetch(apiUrl('/api/update/status'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as { payload: NpmUpdateStatus };
    return json.payload;
  })().finally(() => {
    _npmStatusInflight = null;
  });
  return _npmStatusInflight;
}

/**
 * Parse POST /api/update/run/stream SSE until a `result` event.
 */
async function consumeNpmUpdateSse(body: ReadableStream<Uint8Array>): Promise<NpmUpdateRunResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: NpmUpdateRunResult | null = null;

  const dispatchProgress = (dataLine: string) => {
    try {
      const o = JSON.parse(dataLine) as { line?: string; source?: string };
      if (typeof o.line === 'string') {
        window.dispatchEvent(
          new CustomEvent('xopc:npm-update-progress', {
            detail: { line: o.line, source: o.source === 'stderr' ? 'stderr' : 'stdout' },
          }),
        );
      }
    } catch {
      /* ignore malformed chunk */
    }
  };

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
      dispatchProgress(dataPayload);
      return;
    }
    if (ev === 'result') {
      try {
        const json = JSON.parse(dataPayload) as {
          ok?: boolean;
          error?: string;
          message?: string;
          result?: Record<string, unknown> | null;
        };
        if (json.ok) {
          final = { ok: true, result: json.result ?? null };
        } else {
          final = {
            ok: false,
            error: String(json.error ?? 'unknown'),
            message: String(json.message ?? 'Update failed'),
            status: json.error === 'busy' ? 409 : 400,
            result: json.result ?? null,
          };
        }
      } catch {
        final = {
          ok: false,
          error: 'parse',
          message: 'Invalid update stream',
          status: 0,
        };
      }
    }
  };

  try {
    const readChunk = async (): Promise<NpmUpdateRunResult | null> => {
      if (final !== null) return final;
      const { done, value } = await reader.read();
      if (done) return final;
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
  } finally {
    reader.releaseLock();
  }

  return (
    final ?? {
      ok: false,
      error: 'no-result',
      message: 'Update stream ended without a result',
      status: 0,
    }
  );
}
